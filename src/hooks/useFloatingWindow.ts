// 悬浮窗预警联动 Hook
// 监听活跃预警事件，自动管理悬浮窗的显示/隐藏与倒计时更新
//
// 工作流程：
// 1. 当 event 非空且 alertLevel >= blue（烈度 ≥ 1）时，检查悬浮窗权限
// 2. 有权限则显示悬浮窗并启动每秒倒计时更新
// 3. 当 event 变空或 alertLevel 降级时，隐藏悬浮窗
// 4. 倒计时归零时显示"地震波已到达"（不自动关闭，停止声音/震动/闪光灯，等用户手动关闭）
// 5. 取消报（isCancel=true）显示"地震预警取消"，3 秒后自动隐藏
// 6. 首次显示时触发声音警报（循环播放，受 soundEnabled 控制）
// 7. 首次显示时触发震动警报（循环震动，受 vibrationEnabled 控制）
// 8. 橙红级（烈度 ≥ 5）触发闪光灯循环闪烁（受 flashlightEnabled 控制）
// 9. 用户点击✕关闭按钮后，同一事件不再自动弹出（直到新事件到来）
// 10. 隐藏悬浮窗或组件卸载时停止声音、震动和闪光灯
// 11. 无权限时不显示（不自动请求，由权限引导页处理）
// 12. 组件卸载时自动隐藏悬浮窗并清理定时器
//
// 竞态处理（P1-12/13/20 修复）：
// - 引入自增 requestId，每次 showFloatingWindow 调用前递增
// - .then 回调中校验 requestId 是否为最新，过期的回调直接 return
// - mountedRef 守卫组件卸载后的 setState
// - interval 启动移入 show().then() 内，确保窗口创建成功后才开始 tick
// - show() 失败时 .catch 回退 hideFloatingWindow 重置状态

import {useCallback, useEffect, useRef, useState} from 'react';
import {DeviceEventEmitter} from 'react-native';
import {EewEvent, AlertLevel, UserLocation} from '../types';
import {computeSWaveArrival, calcCsis, haversineDistance} from '../utils/eew';
import {FloatingWindowManager, FloatingWindowContent} from '../native/FloatingWindowManager';
import {SoundManager} from '../native/SoundManager';
import {FlashlightManager} from '../native/FlashlightManager';
import {VibratorManager} from '../native/VibratorManager';
import {log} from '../utils/logger';

/** AlertLevel 严重程度排序（数字越大越严重，DB/T 113.1-2026 标准） */
const ALERT_LEVEL_ORDER: Record<AlertLevel, number> = {
  silent: 0,
  blue: 1,
  yellow: 2,
  orange: 3,
  red: 4,
};

/** 触发悬浮窗的最低预警级别（烈度 ≥ 1 即显示） */
const MIN_SHOW_LEVEL: AlertLevel = 'blue';

/** 倒计时刷新间隔（毫秒） */
const COUNTDOWN_INTERVAL_MS = 1000;

/** 倒计时归零后延迟隐藏时间（毫秒），给用户阅读"地震波已到达" */
const ARRIVED_HIDE_DELAY_MS = 5000;

/**
 * 地震波到达后警报继续持续的秒数（到 -30 秒停止）
 *
 * 规则：倒计时归零（remainSec <= 0）时文字显示"地震波已到达"，
 * 但声音/震动/闪光灯继续响到 remainSec <= -30 才停止。
 * 响完不关闭悬浮窗，等用户手动关闭。
 */
const ALERT_CONTINUE_AFTER_ARRIVAL_SEC = -30;

/** 取消报显示后延迟隐藏时间（毫秒） */
const CANCEL_HIDE_DELAY_MS = 3000;

/** 闪光灯触发阈值（烈度 ≥ 5，即橙红级） */
const FLASHLIGHT_INTENSITY_THRESHOLD = 5;

/** 闪光灯闪烁间隔（毫秒），开/关各持续此时间 */
const FLASHLIGHT_BLINK_INTERVAL_MS = 1000;

/**
 * 震动循环参数（毫秒），与音频循环同步
 * - 警报主音时长 2.0s（DB/T 113.1-2026），音频播放后静音 1s 再循环
 * - 震动同步：振动 2000ms + 静默 1000ms = 3000ms 循环
 */
const VIBRATE_MS = 2000;
const SILENT_MS = 1000;

/** useFloatingWindow 参数 */
export interface UseFloatingWindowParams {
  /** 当前活跃预警事件，null 表示无活跃预警 */
  event: EewEvent | null;
  /** 预警级别（按烈度分档） */
  alertLevel: AlertLevel;
  /** 用户位置（用于计算 S 波到达时间），null 表示未知 */
  userLocation: UserLocation | null;
  /** 是否启用声音警报 */
  soundEnabled: boolean;
  /** 是否启用震动警报 */
  vibrationEnabled: boolean;
  /** 是否启用闪光灯警报 */
  flashlightEnabled: boolean;
}

/** useFloatingWindow 返回值 */
export interface UseFloatingWindowResult {
  /** 手动显示悬浮窗（会先检查权限） */
  showFloatingWindow: () => void;
  /** 手动隐藏悬浮窗 */
  hideFloatingWindow: () => void;
  /** 是否有悬浮窗权限（null 表示尚未检查） */
  hasPermission: boolean | null;
}

/**
 * 悬浮窗预警联动 Hook
 *
 * @param params 包含 event / alertLevel / userLocation / soundEnabled / flashlightEnabled
 * @returns 显示/隐藏控制方法与权限状态
 */
export function useFloatingWindow(
  params: UseFloatingWindowParams,
): UseFloatingWindowResult {
  const {event, alertLevel, userLocation, soundEnabled, vibrationEnabled, flashlightEnabled} = params;

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  /** 倒计时定时器引用 */
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 倒计时归零后的延迟隐藏定时器 */
  const arrivedHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 取消报显示后的延迟隐藏定时器 */
  const cancelHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 悬浮窗是否可见（避免重复 show/hide 调用） */
  const isVisibleRef = useRef(false);
  /** S 波到达时间戳缓存（Unix 毫秒），避免每次 tick 重新计算 */
  const arrivalRef = useRef<number | null>(null);
  /** 预估烈度缓存，事件生命周期内不变，避免每次 tick 重新计算 */
  const intensityRef = useRef<number>(0);
  /** 震中距缓存（km），事件生命周期内不变 */
  const distanceRef = useRef<number>(0);
  /** 组件是否已挂载（防止卸载后 setState） */
  const mountedRef = useRef(true);
  /**
   * 用户手动关闭标志位：记录被用户点击✕关闭的事件 id
   * 同一事件 id 不再自动弹出，直到新事件到来（id 变化）才重置
   */
  const userDismissedRef = useRef<string | null>(null);
  /** 倒计时是否已归零（已到达），防止重复处理 */
  const arrivedRef = useRef(false);
  /** 警报是否已停止（到达后继续响 -30 秒后停止），防止重复停止 */
  const alertsStoppedRef = useRef(false);
  /**
   * 自增请求 ID，用于取消过期的异步回调
   * 每次 showFloatingWindow 调用前递增，.then 回调中校验是否为最新
   */
  const requestIdRef = useRef(0);
  /**
   * buildContent 的最新版本引用
   * interval 闭包通过此 ref 调用最新的 buildContent，避免捕获过期闭包
   */
  const buildContentRef = useRef<(() => FloatingWindowContent | null) | null>(null);

  /** 清除倒计时定时器 */
  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /** 清除倒计时归零延迟隐藏定时器 */
  const clearArrivedHideTimeout = useCallback(() => {
    if (arrivedHideTimeoutRef.current !== null) {
      clearTimeout(arrivedHideTimeoutRef.current);
      arrivedHideTimeoutRef.current = null;
    }
  }, []);

  /** 清除取消报延迟隐藏定时器 */
  const clearCancelHideTimeout = useCallback(() => {
    if (cancelHideTimeoutRef.current !== null) {
      clearTimeout(cancelHideTimeoutRef.current);
      cancelHideTimeoutRef.current = null;
    }
  }, []);

  /** 计算剩余秒数（向上取整，允许负数用于判断 -30 秒停止警报） */
  const computeCountdown = useCallback((): number => {
    if (arrivalRef.current === null) {
      return 0;
    }
    return Math.ceil((arrivalRef.current - Date.now()) / 1000);
  }, []);

  /** 构建悬浮窗内容对象（countdown 最小 0，原生层映射为"地震波已到达"） */
  const buildContent = useCallback((): FloatingWindowContent | null => {
    if (!event) {
      return null;
    }
    return {
      magnitude: event.magnitude,
      countdown: Math.max(0, computeCountdown()),
      location: event.location,
      level: alertLevel,
      intensity: intensityRef.current,
      epicenterDistance: distanceRef.current,
      originTime: event.originTime,
      isCancel: event.isCancel === true,
    };
  }, [event, alertLevel, computeCountdown]);

  // 同步 buildContent 到 ref，供 interval 闭包使用
  // 解决 interval 闭包捕获过期 buildContent 的问题
  useEffect(() => {
    buildContentRef.current = buildContent;
  }, [buildContent]);

  /** 隐藏悬浮窗并清理状态（同时停止声音、震动和闪光灯） */
  const hideFloatingWindow = useCallback(() => {
    const wasVisible = isVisibleRef.current;
    clearTick();
    clearArrivedHideTimeout();
    clearCancelHideTimeout();
    arrivalRef.current = null;
    arrivedRef.current = false;
    alertsStoppedRef.current = false;
    if (wasVisible) {
      // 停止声音、震动和闪光灯（循环播放/震动/闪烁）
      SoundManager.stopAlertSound().catch(() => {
        // 停止失败忽略
      });
      VibratorManager.stopVibrating().catch(() => {
        // 停止失败忽略
      });
      FlashlightManager.stopBlinking().catch(() => {
        // 停止失败忽略
      });
      FloatingWindowManager.hide().catch(() => {
        // 隐藏失败忽略，状态仍重置
      });
      isVisibleRef.current = false;
    }
    log('FLOAT', 'hide', {wasVisible});
  }, [clearTick, clearArrivedHideTimeout, clearCancelHideTimeout]);

  /**
   * 启动每秒倒计时 tick
   *
   * 设计要点：
   * - 不接收 requestId 参数，改用 isVisibleRef/mountedRef 校验
   * - 内部通过 buildContentRef.current() 调用最新的 buildContent，
   *   避免 interval 闭包捕获过期 buildContent
   * - tick 一旦启动就稳定运行，event 更新不会重启 tick
   * - 倒计时归零时不立即隐藏，改为显示"地震波已到达"，5 秒后隐藏
   */
  const startCountdownTick = useCallback(() => {
    clearTick();
    log('FLOAT', 'tick 启动', {});
    intervalRef.current = setInterval(() => {
      // 校验：组件已卸载或悬浮窗已隐藏，停止 tick
      if (!mountedRef.current || !isVisibleRef.current) {
        clearTick();
        return;
      }
      const remain = computeCountdown();

      // 地震波已到达（remain <= 0）：文字显示"地震波已到达"，警报继续响
      if (!arrivedRef.current && remain <= 0) {
        log('FLOAT', '地震波已到达，警报继续响到 -30 秒', {});
        arrivedRef.current = true;
      }

      // 警报持续到 -30 秒停止（只触发一次）
      if (!alertsStoppedRef.current && remain <= ALERT_CONTINUE_AFTER_ARRIVAL_SEC) {
        alertsStoppedRef.current = true;
        log('FLOAT', `警报持续 ${-ALERT_CONTINUE_AFTER_ARRIVAL_SEC} 秒后停止声音/震动/闪光灯`, {});
        SoundManager.stopAlertSound().catch(() => {});
        VibratorManager.stopVibrating().catch(() => {});
        FlashlightManager.stopBlinking().catch(() => {});
      }

      // 通过 ref 调用最新的 buildContent（countdown 已在 buildContent 中 clamp 到 0）
      const c = buildContentRef.current?.();
      if (c) {
        FloatingWindowManager.updateContent(c).catch(() => {});
        if (remain > 0) {
          log('FLOAT', 'tick', {remain});
        }
      }
    }, COUNTDOWN_INTERVAL_MS);
  }, [clearTick, computeCountdown, hideFloatingWindow]);

  /**
   * 触发声音警报（受 soundEnabled 控制）
   * 失败忽略，不影响悬浮窗显示
   */
  const triggerSound = useCallback(() => {
    if (!soundEnabled) {
      log('FLOAT', '声音警报已禁用，跳过', {});
      return;
    }
    SoundManager.playAlertSound().catch(() => {
      // 声音播放失败忽略
    });
    log('FLOAT', '触发声音警报', {});
  }, [soundEnabled]);

  /**
   * 触发闪光灯警报（受 flashlightEnabled 控制，仅橙红级触发）
   * 循环闪烁直到 hideFloatingWindow 或组件卸载时停止。
   * 失败忽略，不影响悬浮窗显示
   */
  const triggerFlashlight = useCallback(() => {
    if (!flashlightEnabled) {
      log('FLOAT', '闪光灯警报已禁用，跳过', {});
      return;
    }
    if (intensityRef.current < FLASHLIGHT_INTENSITY_THRESHOLD) {
      log('FLOAT', '烈度未达闪光灯触发阈值，跳过', {
        intensity: intensityRef.current,
        threshold: FLASHLIGHT_INTENSITY_THRESHOLD,
      });
      return;
    }
    // 循环闪烁，直到 hideFloatingWindow 调用 stopBlinking
    FlashlightManager.startBlinking(FLASHLIGHT_BLINK_INTERVAL_MS).catch(() => {
      // 闪光灯失败忽略
    });
    log('FLOAT', '触发闪光灯警报(循环)', {
      intensity: intensityRef.current,
      intervalMs: FLASHLIGHT_BLINK_INTERVAL_MS,
    });
  }, [flashlightEnabled]);

  /**
   * 触发震动警报（受 vibrationEnabled 控制）
   * 循环震动直到 hideFloatingWindow 或组件卸载时停止。
   * 与音频循环同步：振动 2000ms + 静默 1000ms（与音频播放 2s + 静音 1s 一致）
   * 失败忽略，不影响悬浮窗显示
   */
  const triggerVibration = useCallback(() => {
    if (!vibrationEnabled) {
      log('FLOAT', '震动警报已禁用，跳过', {});
      return;
    }
    // 循环震动，与音频同步（振2s+默1s）
    VibratorManager.startVibratingCycle(VIBRATE_MS, SILENT_MS).catch(() => {
      // 震动失败忽略
    });
    log('FLOAT', '触发震动警报(循环,与音频同步)', {
      vibrateMs: VIBRATE_MS,
      silentMs: SILENT_MS,
    });
  }, [vibrationEnabled]);

  /** 显示悬浮窗并启动倒计时 */
  const showFloatingWindow = useCallback(() => {
    // 无事件或无位置时不显示
    if (!event || !userLocation) {
      return;
    }

    // 用户已手动关闭此事件，不再自动弹出（直到新事件 id 到来才重置）
    if (userDismissedRef.current === event.id) {
      log('FLOAT', '用户已关闭此事件，跳过自动弹出', {eventId: event.id});
      return;
    }

    log('FLOAT', 'showFloatingWindow', {
      hasEvent: !!event,
      hasLocation: !!userLocation,
      isVisible: isVisibleRef.current,
      isCancel: event.isCancel === true,
    });

    // 计算距离与烈度（已可见与首次显示共用）
    const arrival = computeSWaveArrival(
      event,
      userLocation.lat,
      userLocation.lng,
    );
    const dist = haversineDistance(
      event.lat,
      event.lng,
      userLocation.lat,
      userLocation.lng,
    );
    const intensity = calcCsis(event.magnitude, event.depth, dist);
    arrivalRef.current = arrival;
    intensityRef.current = intensity;
    distanceRef.current = dist;

    // 已可见：仅更新内容，不递增 requestId、不重启 tick、不重复触发声音/闪光灯
    // tick 由 startCountdownTick 稳定运行，通过 buildContentRef 读取最新内容
    if (isVisibleRef.current) {
      const content = buildContent();
      if (content) {
        FloatingWindowManager.updateContent(content).catch(() => {});
        log('FLOAT', 'updateContent (已可见)', {
          mag: event.magnitude,
          countdown: content.countdown,
        });
      }
      return;
    }

    // 不可见：检查权限 → show → 启动 tick
    // 仅在此分支递增 requestId，用于 show() 异步竞态校验
    const currentRequestId = ++requestIdRef.current;

    // 取消报特殊处理：不检查倒计时，直接显示"地震预警取消"，3 秒后隐藏
    // 取消报不触发声音/闪光灯
    if (event.isCancel === true) {
      log('FLOAT', '取消报，显示"地震预警取消"', {});
      FloatingWindowManager.hasPermission()
        .then(granted => {
          if (currentRequestId !== requestIdRef.current || !mountedRef.current) {
            return;
          }
          setHasPermission(granted);
          if (!granted) {
            hideFloatingWindow();
            return;
          }
          const content = buildContent();
          if (!content) {
            return;
          }
          FloatingWindowManager.show(content)
            .then(() => {
              if (currentRequestId !== requestIdRef.current || !mountedRef.current) {
                return;
              }
              isVisibleRef.current = true;
              log('FLOAT', '取消报 show 成功', {requestId: currentRequestId});
              // 3 秒后自动隐藏
              cancelHideTimeoutRef.current = setTimeout(() => {
                log('FLOAT', '取消报显示超时，隐藏', {});
                hideFloatingWindow();
              }, CANCEL_HIDE_DELAY_MS);
            })
            .catch(() => {
              log('FLOAT', '取消报 show 失败', {});
              if (currentRequestId === requestIdRef.current) {
                isVisibleRef.current = false;
              }
            });
        })
        .catch(() => {});
      return;
    }

    // 普通报：S 波已到达的事件（倒计时=0）对用户已无预警意义，不显示悬浮窗
    // 这也避免了"show→tick归零→hide→下次推送再show"的弹出-关闭循环
    const remain = computeCountdown();
    if (remain <= 0) {
      log('FLOAT', '事件已过期(S波到达)，不显示', {remain});
      return;
    }

    FloatingWindowManager.hasPermission()
      .then(granted => {
        // 校验：是否为最新一次调用？组件是否仍挂载？
        if (currentRequestId !== requestIdRef.current || !mountedRef.current) {
          return;
        }
        setHasPermission(granted);
        log('FLOAT', 'hasPermission', {granted});
        if (!granted) {
          // 无权限，确保隐藏
          hideFloatingWindow();
          return;
        }

        const content = buildContent();
        if (!content) {
          return;
        }

        // 不可见，先 show 再启动倒计时
        // interval 启动移入 show().then() 内，确保窗口创建成功后才开始 tick
        FloatingWindowManager.show(content)
          .then(() => {
            // 再次校验：show 期间可能有新的调用或组件已卸载
            if (currentRequestId !== requestIdRef.current || !mountedRef.current) {
              return;
            }
            isVisibleRef.current = true;
            log('FLOAT', 'show 成功，启动 tick', {requestId: currentRequestId});
            startCountdownTick();
            // 首次显示成功后触发声音、震动和闪光灯警报
            triggerSound();
            triggerVibration();
            triggerFlashlight();
          })
          .catch(() => {
            // show 失败：回退状态，避免 isVisibleRef 不一致
            log('FLOAT', 'show 失败', {});
            if (currentRequestId === requestIdRef.current) {
              isVisibleRef.current = false;
            }
          });
      })
      .catch(() => {
        // hasPermission 检查失败，忽略
      });
  }, [event, userLocation, buildContent, hideFloatingWindow, startCountdownTick, triggerSound, triggerVibration, triggerFlashlight]);

  // 初次挂载时检查权限
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    FloatingWindowManager.hasPermission()
      .then(granted => {
        if (!cancelled && mountedRef.current) {
          setHasPermission(granted);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  // 事件 id 变化时重置用户关闭标记（新事件允许重新弹出）
  useEffect(() => {
    if (event && userDismissedRef.current !== null && userDismissedRef.current !== event.id) {
      log('FLOAT', '新事件到来，重置用户关闭标记', {
        oldId: userDismissedRef.current,
        newId: event.id,
      });
      userDismissedRef.current = null;
    }
  }, [event]);

  // 监听事件与级别变化，自动显示/隐藏
  useEffect(() => {
    // 取消报：event.isCancel === true 时直接显示（不依赖 alertLevel）
    // 普通报：alertLevel >= blue（烈度 ≥ 1）时显示
    const shouldShow =
      event !== null &&
      (event.isCancel === true ||
        ALERT_LEVEL_ORDER[alertLevel] >= ALERT_LEVEL_ORDER[MIN_SHOW_LEVEL]);

    if (shouldShow) {
      showFloatingWindow();
    } else {
      hideFloatingWindow();
    }
    // 不在此 cleanup 中 clearTick：tick 应稳定运行
    // 由 hideFloatingWindow（事件归零/降级）或组件卸载 effect 负责清除
  }, [event, alertLevel, showFloatingWindow, hideFloatingWindow]);

  // 监听原生层关闭事件（用户点击悬浮窗 ✕ 关闭按钮）
  // 原生层 emitClosed() 发送 'onClosed' 事件，此处监听并：
  // 1. 记录被手动关闭的事件 id（防止同一事件自动重新弹出）
  // 2. 调用 hideFloatingWindow 停止声音/震动/闪光灯并清理状态
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onClosed', () => {
      log('FLOAT', '收到原生层关闭事件', {});
      if (event) {
        userDismissedRef.current = event.id;
        log('FLOAT', '标记事件为用户已关闭', {eventId: event.id});
      }
      hideFloatingWindow();
    });
    return () => {
      subscription.remove();
    };
  }, [hideFloatingWindow, event]);

  // 组件卸载时隐藏悬浮窗并清理定时器（同时停止声音、震动和闪光灯）
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // 递增 requestId 使所有未完成的异步回调过期
      ++requestIdRef.current;
      if (isVisibleRef.current) {
        FloatingWindowManager.hide().catch(() => {});
        isVisibleRef.current = false;
      }
      // 停止声音、震动和闪光灯（防止卸载后仍在播放/震动/闪烁）
      SoundManager.stopAlertSound().catch(() => {});
      VibratorManager.stopVibrating().catch(() => {});
      FlashlightManager.stopBlinking().catch(() => {});
      clearTick();
      clearArrivedHideTimeout();
      clearCancelHideTimeout();
    };
  }, [clearTick, clearArrivedHideTimeout, clearCancelHideTimeout]);

  return {
    showFloatingWindow,
    hideFloatingWindow,
    hasPermission,
  };
}
