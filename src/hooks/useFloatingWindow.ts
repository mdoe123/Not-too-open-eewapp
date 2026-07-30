// 悬浮窗预警联动 Hook（多事件并发版）
//
// 工作流程：
// 1. 接收事件列表，按预警级别排序，选出顶级 + 并列（最多 3 个）
// 2. 调用 FloatingWindowManager.setEvents 批量显示
// 3. 每秒 tick 更新所有显示中事件的倒计时
// 4. 倒计时归零的事件 UI 保持显示，警报继续响到 -30 秒
// 5. 用户点击✕关闭某个事件 → 只关闭该事件，其他继续显示
// 6. 所有事件都关闭后停止声音/震动/闪光灯
//
// 排序与分组规则（用户决策）：
// - 候选条件：未被用户关闭 + remain > -30（倒计时归零后 30 秒内仍算活跃，独占显示）
// - 按预警级别降序排序（red > orange > yellow > blue），同级别按烈度降序
// - 顶级事件：候选中级别最高的那一个，显示在最上
// - 并列事件：与顶级"同级别"（差 0 档）的其他事件，最多 2 个，显示在下方
// - 差 ≥ 1 档的事件不显示，等顶级事件 remain <= -30 后才让下一级显示
// - 即：大震倒计时归零后 30 秒内仍独占显示，30 秒后才让小震显示（如果小震还有倒计时）
// - 用户手动关闭顶级事件后，立即显示下一级事件
//
// 警报规则：
// - 合并为一次循环（声音/震动/闪光灯不叠加）
// - 由最高优先级事件决定是否触发
// - 所有显示中事件都归零 + 30 秒后停止

import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, AppStateStatus, DeviceEventEmitter} from 'react-native';
import {EewEvent, AlertLevel, UserLocation} from '../types';
import {computeSWaveArrival, calcCsis, haversineDistance} from '../utils/eew';
import {FloatingWindowManager, FloatingWindowContent} from '../native/FloatingWindowManager';
import {SoundManager} from '../native/SoundManager';
import {FlashlightManager} from '../native/FlashlightManager';
import {VibratorManager} from '../native/VibratorManager';
import {BackgroundServiceManager} from '../native/BackgroundServiceManager';
import {log} from '../utils/logger';

/** AlertLevel 严重程度排序（数字越大越严重） */
const ALERT_LEVEL_ORDER: Record<AlertLevel, number> = {
  silent: 0,
  blue: 1,
  yellow: 2,
  orange: 3,
  red: 4,
};

const MIN_SHOW_LEVEL: AlertLevel = 'blue';
const COUNTDOWN_INTERVAL_MS = 1000;
const ALERT_CONTINUE_AFTER_ARRIVAL_SEC = -30;
/** 新事件（未显示过的）S 波到达超过此秒数不显示（解决重启 App 误触发） */
const MAX_PAST_ARRIVAL_FOR_NEW_EVENT_SEC = -60;
const CANCEL_HIDE_DELAY_MS = 3000;
const FLASHLIGHT_INTENSITY_THRESHOLD = 5;
const FLASHLIGHT_BLINK_INTERVAL_MS = 1000;
const VIBRATE_MS = 2000;
const SILENT_MS = 1000;

/** 最大同时显示的悬浮窗数量 */
const MAX_DISPLAY_EVENTS = 3;

/** 并列事件与顶级事件的最大级别差（0 = 同级别才算并列，差 ≥ 1 档算大小关系） */
const PEER_LEVEL_MAX_DIFF = 0;

/** 单个活跃事件项 */
interface ActiveEvent {
  event: EewEvent;
  alertLevel: AlertLevel;
  intensity: number;
  distance: number;
  arrivalMs: number;
  /** 用户已手动关闭此事件 */
  userDismissed: boolean;
  /** 倒计时是否已归零 */
  arrived: boolean;
  /** 该事件的警报是否已停止（归零后 -30 秒） */
  alertsStopped: boolean;
}

/** useFloatingWindow 参数 */
export interface UseFloatingWindowParams {
  /** 当前活跃预警事件列表 */
  events: EewEvent[];
  /** 每个事件对应的预警级别 Map（key: event.id） */
  alertLevels: Record<string, AlertLevel>;
  /** 用户位置 */
  userLocation: UserLocation | null;
  /** 是否启用声音警报 */
  soundEnabled: boolean;
  /** 是否启用震动警报 */
  vibrationEnabled: boolean;
  /** 是否启用闪光灯警报 */
  flashlightEnabled: boolean;
  /** 是否启用自动调节媒体音量 */
  autoVolumeEnabled: boolean;
  /** 预警媒体音量百分比（0-100） */
  alertVolume: number;
}

/** useFloatingWindow 返回值 */
export interface UseFloatingWindowResult {
  /** 手动显示悬浮窗（会先检查权限） */
  showFloatingWindow: () => void;
  /** 手动隐藏所有悬浮窗 */
  hideFloatingWindow: () => void;
  /** 是否有悬浮窗权限 */
  hasPermission: boolean | null;
}

/**
 * 从 EewEvent 列表构建 ActiveEvent 列表（计算距离、烈度、S 波到达时间）
 */
function buildActiveEvents(
  events: EewEvent[],
  alertLevels: Record<string, AlertLevel>,
  userLocation: UserLocation | null,
  dismissedIds: Set<string>,
): ActiveEvent[] {
  if (!userLocation) return [];
  const result: ActiveEvent[] = [];
  for (const event of events) {
    const level = alertLevels[event.id];
    if (!level || level === 'silent') continue;
    if (event.isCancel === true) {
      // 取消报单独处理，不走排序逻辑
    }
    const dist = haversineDistance(event.lat, event.lng, userLocation.lat, userLocation.lng);
    const intensity = calcCsis(event.magnitude, event.depth || 0, dist);
    const arrival = computeSWaveArrival(event, userLocation.lat, userLocation.lng);
    result.push({
      event,
      alertLevel: level,
      intensity,
      distance: dist,
      arrivalMs: arrival,
      userDismissed: dismissedIds.has(event.id),
      arrived: false,
      alertsStopped: false,
    });
  }
  return result;
}

/**
 * 排序与分组：选出要显示的事件（最多 MAX_DISPLAY_EVENTS 个）
 *
 * 规则（用户决策）：
 * 1. 候选过滤：用户已关闭的不显示；非取消报需 remain > -30（倒计时归零后 30 秒内仍算活跃，让大震独占显示）
 * 2. 排序：预警级别降序，同级别按烈度降序
 * 3. 分组：顶级 1 个 + 并列（与顶级同级别）最多 2 个
 * 4. 差 ≥ 1 档的事件被顶级"压制"，等顶级 remain <= -30 后才会成为新顶级显示
 * 5. 用户手动关闭顶级 → 顶级被过滤，下一级立即显示
 */
function selectDisplayEvents(activeEvents: ActiveEvent[]): ActiveEvent[] {
  // 过滤：用户已关闭的、倒计时归零超过 30 秒的（取消报除外）
  const candidates = activeEvents.filter(ae => {
    if (ae.userDismissed) return false;
    if (ae.event.isCancel === true) return true; // 取消报不过滤
    const remain = Math.ceil((ae.arrivalMs - Date.now()) / 1000);
    // 已显示过的事件（arrived 已标记）：remain > -30 仍算活跃（大震独占显示）
    // 新事件（未显示过）：remain > -60 才显示（S 波到达超过 60 秒的旧事件不显示，解决重启误触发）
    const threshold = ae.arrived
      ? ALERT_CONTINUE_AFTER_ARRIVAL_SEC
      : MAX_PAST_ARRIVAL_FOR_NEW_EVENT_SEC;
    return remain > threshold;
  });

  if (candidates.length === 0) return [];

  // 排序：预警级别降序，同级别按烈度降序
  candidates.sort((a, b) => {
    const diff = ALERT_LEVEL_ORDER[b.alertLevel] - ALERT_LEVEL_ORDER[a.alertLevel];
    if (diff !== 0) return diff;
    return b.intensity - a.intensity;
  });

  // 分组：顶级 + 并列（与顶级同级别，差 0 档）
  const top = candidates[0];
  const topOrder = ALERT_LEVEL_ORDER[top.alertLevel];
  const peers = candidates.slice(1).filter(ae => {
    return topOrder - ALERT_LEVEL_ORDER[ae.alertLevel] <= PEER_LEVEL_MAX_DIFF;
  });

  return [top, ...peers.slice(0, MAX_DISPLAY_EVENTS - 1)];
}

/**
 * 构建 FloatingWindowContent
 */
function buildContent(ae: ActiveEvent): FloatingWindowContent {
  const remain = Math.ceil((ae.arrivalMs - Date.now()) / 1000);
  return {
    eventId: ae.event.id,
    magnitude: ae.event.magnitude,
    countdown: Math.max(0, remain),
    location: ae.event.location,
    level: ae.alertLevel,
    intensity: ae.intensity,
    epicenterDistance: ae.distance,
    originTime: ae.event.originTime,
    isCancel: ae.event.isCancel === true,
    reportNum: ae.event.reportNum,
    sourceName: ae.event.sourceName,
  };
}

export function useFloatingWindow(
  params: UseFloatingWindowParams,
): UseFloatingWindowResult {
  const {events, alertLevels, userLocation, soundEnabled, vibrationEnabled, flashlightEnabled, autoVolumeEnabled, alertVolume} = params;

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  /** 活跃事件列表引用（每秒 tick 读取最新值） */
  const activeEventsRef = useRef<ActiveEvent[]>([]);
  /** 用户已关闭的事件 ID 集合 */
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  /** 倒计时定时器 */
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 悬浮窗是否可见（至少一个） */
  const isVisibleRef = useRef(false);
  /** 警报是否已启动（合并一个） */
  const alertsStartedRef = useRef(false);
  /** 组件是否已挂载 */
  const mountedRef = useRef(true);
  /** 取消报延迟隐藏定时器 Map */
  const cancelTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** 当前 AppState（后台时不显示悬浮窗，交给原生锁屏/后台悬浮窗处理） */
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  /** 清除倒计时定时器 */
  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  /** 停止所有警报 */
  const stopAllAlerts = useCallback(() => {
    SoundManager.stopAlertSound().catch(() => {});
    VibratorManager.stopVibrating().catch(() => {});
    FlashlightManager.stopBlinking().catch(() => {});
    SoundManager.restoreMediaVolume().catch(() => {});
    alertsStartedRef.current = false;
  }, []);

  /**
   * 隐藏所有悬浮窗并清理状态
   */
  const hideFloatingWindow = useCallback(() => {
    const wasVisible = isVisibleRef.current;
    clearTick();
    if (wasVisible) {
      FloatingWindowManager.hide().catch(() => {});
      isVisibleRef.current = false;
    }
    stopAllAlerts();
    // 清理取消报定时器
    cancelTimeoutsRef.current.forEach(t => clearTimeout(t));
    cancelTimeoutsRef.current.clear();
    // 清理活跃事件状态
    activeEventsRef.current = [];
    log('FLOAT', 'hide all', {wasVisible});
  }, [clearTick, stopAllAlerts]);

  /**
   * 启动警报（合并一个，只启动一次）
   *
   * 闪光灯触发判断使用当前显示列表中级别最高的事件（与后台服务一致），
   * 而非 activeEventsRef[0]（输入顺序的第一个，不一定是最高级别）。
   */
  const startAlertsIfNeeded = useCallback(() => {
    if (alertsStartedRef.current) return;
    alertsStartedRef.current = true;
    // 通知后台服务所有活跃事件已由 JS 层触发警报
    // 防止 App 切到后台后后台服务重复触发同一事件的悬浮窗和警报
    for (const ae of activeEventsRef.current) {
      BackgroundServiceManager.markEventTriggered(ae.event.id);
    }
    // 自动调节媒体音量：在播放声音前保存并设置目标音量
    if (soundEnabled && autoVolumeEnabled) {
      SoundManager.saveAndSetMediaVolume(alertVolume).catch(() => {});
    }
    if (soundEnabled) {
      SoundManager.playAlertSound().catch(() => {});
    }
    if (vibrationEnabled) {
      VibratorManager.startVibratingCycle(VIBRATE_MS, SILENT_MS).catch(() => {});
    }
    // 闪光灯仅最高优先级事件烈度 ≥ 5 时触发
    // 注意：必须从 selectDisplayEvents 结果取 top，不能用 activeEventsRef[0]（输入顺序不一定按级别排序）
    const displayList = selectDisplayEvents(activeEventsRef.current);
    const top = displayList[0];
    if (flashlightEnabled && top && top.intensity >= FLASHLIGHT_INTENSITY_THRESHOLD) {
      FlashlightManager.startBlinking(FLASHLIGHT_BLINK_INTERVAL_MS).catch(() => {});
    }
    log('FLOAT', '启动合并警报', {topIntensity: top?.intensity});
  }, [soundEnabled, vibrationEnabled, flashlightEnabled, autoVolumeEnabled, alertVolume]);

  /**
   * 启动每秒 tick
   * 注意：此函数需在 refreshDisplay 之前定义，因为 refreshDisplay 引用它
   */
  const startCountdownTick = useCallback(() => {
    clearTick();
    log('FLOAT', 'tick 启动', {});
    intervalRef.current = setInterval(() => {
      if (!mountedRef.current || !isVisibleRef.current) {
        clearTick();
        return;
      }

      const active = activeEventsRef.current;
      if (active.length === 0) {
        clearTick();
        return;
      }

      let allAlertsShouldStop = true;

      for (const ae of active) {
        if (ae.userDismissed) continue;
        const remain = Math.ceil((ae.arrivalMs - Date.now()) / 1000);

        // 标记归零
        if (!ae.arrived && remain <= 0) {
          ae.arrived = true;
          log('FLOAT', `事件 ${ae.event.id} 地震波已到达`, {});
        }

        // 检查警报是否应停止（所有事件都到 -30 秒）
        if (!ae.alertsStopped && remain <= ALERT_CONTINUE_AFTER_ARRIVAL_SEC) {
          ae.alertsStopped = true;
          log('FLOAT', `事件 ${ae.event.id} 警报停止`, {});
        }
        if (!ae.alertsStopped) {
          allAlertsShouldStop = false;
        }
      }

      // 所有事件警报都应停止
      if (allAlertsShouldStop && alertsStartedRef.current) {
        stopAllAlerts();
      }

      // 更新显示中事件的内容
      const displayList = selectDisplayEvents(active);
      if (displayList.length > 0) {
        const contents = displayList.map(buildContent);
        FloatingWindowManager.setEvents(contents).catch(() => {});
      } else {
        // 无可显示事件
        FloatingWindowManager.hide().catch(() => {});
        isVisibleRef.current = false;
        stopAllAlerts();
        clearTick();
      }
    }, COUNTDOWN_INTERVAL_MS);
  }, [clearTick, stopAllAlerts]);

  /**
   * 刷新悬浮窗显示
   * 根据当前 activeEventsRef 重新选事件、调用 setEvents
   */
  const refreshDisplay = useCallback(() => {
    if (!userLocation || !mountedRef.current) return;
    // 后台时不显示悬浮窗（交给原生锁屏 Activity / 后台悬浮窗处理）
    if (appStateRef.current !== 'active') {
      log('FLOAT', 'refreshDisplay 跳过：App 在后台', {});
      return;
    }

    const active = activeEventsRef.current;
    const displayList = selectDisplayEvents(active);

    log('FLOAT', 'refreshDisplay', {
      activeCount: active.length,
      displayCount: displayList.length,
      activeIds: active.map(a => a.event.id).join(','),
      displayIds: displayList.map(a => a.event.id).join(','),
    });

    if (displayList.length === 0) {
      // 无可显示事件
      if (isVisibleRef.current) {
        FloatingWindowManager.hide().catch(() => {});
        isVisibleRef.current = false;
        stopAllAlerts();
        clearTick();
      }
      return;
    }

    // 检查权限
    FloatingWindowManager.hasPermission().then(granted => {
      if (!mountedRef.current) return;
      setHasPermission(granted);
      if (!granted) {
        if (isVisibleRef.current) {
          FloatingWindowManager.hide().catch(() => {});
          isVisibleRef.current = false;
          stopAllAlerts();
          clearTick();
        }
        return;
      }

      const contents = displayList.map(buildContent);
      FloatingWindowManager.setEvents(contents).then(() => {
        if (!mountedRef.current) return;
        const wasVisible = isVisibleRef.current;
        isVisibleRef.current = true;
        if (!wasVisible) {
          // 首次显示，启动 tick 和警报
          startCountdownTick();
          startAlertsIfNeeded();
        }
      }).catch(() => {
        log('FLOAT', 'setEvents 失败', {});
      });

      // 处理取消报：3 秒后自动隐藏
      displayList.forEach(ae => {
        if (ae.event.isCancel === true && !cancelTimeoutsRef.current.has(ae.event.id)) {
          const t = setTimeout(() => {
            cancelTimeoutsRef.current.delete(ae.event.id);
            dismissedIdsRef.current.add(ae.event.id);
            // 标记该事件为已关闭
            const idx = activeEventsRef.current.findIndex(a => a.event.id === ae.event.id);
            if (idx >= 0) {
              activeEventsRef.current[idx].userDismissed = true;
            }
            refreshDisplay();
          }, CANCEL_HIDE_DELAY_MS);
          cancelTimeoutsRef.current.set(ae.event.id, t);
        }
      });
    }).catch(() => {
      // 权限检查失败忽略
    });
  }, [userLocation, startAlertsIfNeeded, startCountdownTick, stopAllAlerts, clearTick]);

  /** 显示悬浮窗（对外暴露，触发 refreshDisplay） */
  const showFloatingWindow = useCallback(() => {
    refreshDisplay();
  }, [refreshDisplay]);

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

  // 监听 AppState 变化：后台时隐藏悬浮窗并停止警报，前台时重新评估显示
  // 避免后台时 RN 前端调用 setEvents 显示悬浮窗，与原生锁屏 Activity 重复显示
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      log('FLOAT', 'AppState 变化', {prev, next: nextState});

      if (nextState !== 'active') {
        // 进入后台/非活跃：隐藏悬浮窗，停止 tick 和警报
        FloatingWindowManager.hide().catch(() => {});
        isVisibleRef.current = false;
        stopAllAlerts();
        clearTick();
      } else if (prev !== 'active') {
        // 回到前台：重新评估显示
        refreshDisplay();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refreshDisplay, stopAllAlerts, clearTick]);

  // 事件列表变化时重建 activeEvents 并刷新显示
  useEffect(() => {
    if (!userLocation) {
      hideFloatingWindow();
      return;
    }

    // 新事件到来时重置 dismissedIds 中不存在的 id
    const currentIds = new Set(events.map(e => e.id));
    const newDismissed = new Set<string>();
    dismissedIdsRef.current.forEach(id => {
      if (currentIds.has(id)) {
        newDismissed.add(id);
      }
    });
    dismissedIdsRef.current = newDismissed;

    // 重建 activeEvents
    const newActive = buildActiveEvents(events, alertLevels, userLocation, dismissedIdsRef.current);

    // 保留旧事件的状态（arrived/alertsStopped）
    const oldMap = new Map(activeEventsRef.current.map(ae => [ae.event.id, ae]));
    for (const ae of newActive) {
      const old = oldMap.get(ae.event.id);
      if (old) {
        ae.arrived = old.arrived;
        ae.alertsStopped = old.alertsStopped;
      }
    }
    activeEventsRef.current = newActive;

    refreshDisplay();
  }, [events, alertLevels, userLocation, refreshDisplay, hideFloatingWindow]);

  // 监听原生层关闭事件（携带 eventId）
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('onClosed', (eventId: string) => {
      log('FLOAT', '收到原生层关闭事件', {eventId});
      dismissedIdsRef.current.add(eventId);
      // 标记该事件为已关闭
      const idx = activeEventsRef.current.findIndex(ae => ae.event.id === eventId);
      if (idx >= 0) {
        activeEventsRef.current[idx].userDismissed = true;
      }
      // 立即移除该事件的悬浮窗
      FloatingWindowManager.hideOne(eventId).catch(() => {});
      // 刷新显示（可能补充新事件到列表）
      refreshDisplay();
    });
    return () => {
      subscription.remove();
    };
  }, [refreshDisplay]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (isVisibleRef.current) {
        FloatingWindowManager.hide().catch(() => {});
        isVisibleRef.current = false;
      }
      stopAllAlerts();
      clearTick();
      cancelTimeoutsRef.current.forEach(t => clearTimeout(t));
      cancelTimeoutsRef.current.clear();
    };
  }, [clearTick, stopAllAlerts]);

  return {
    showFloatingWindow,
    hideFloatingWindow,
    hasPermission,
  };
}
