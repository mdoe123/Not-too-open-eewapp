// 后台保活服务 RN 层接口
// 封装 BackgroundServiceModule 原生模块，提供 start/stop + 配置同步方法。
// App 启动时调用 start() 启动常驻通知，防止锁屏后 RN JS 线程被系统挂起。
// 配置变化时调用 updateConfig/updateLocation/updateCustomSources 同步到原生层，
// 供后台服务锁屏预警使用。
// AppState 'active' 时调用 notifyAppInForeground 通知后台服务 App 已回到前台。
import {NativeModules, Platform} from 'react-native';
import type {AlertConfig, LocationConfig, SourceConfig} from '../types';

/**
 * 原生 BackgroundServiceModule 的类型定义
 * 由 BackgroundServiceModule.kt 提供，需在 MainApplication.kt 中注册 BackgroundServicePackage 后才可用
 */
interface BackgroundServiceModuleType {
  /** 启动前台服务（常驻通知） */
  start(): void;
  /** 停止前台服务（移除常驻通知） */
  stop(): void;
  /** 更新 alert 配置到原生层（SharedPreferences） */
  updateConfig(alertConfig: AlertConfig): void;
  /** 更新用户位置到原生层（SharedPreferences） */
  updateLocation(location: {userLat: number; userLng: number}): void;
  /** 通知后台服务 App 已回到前台（AppState active 时调用） */
  notifyAppInForeground(): void;
  /** 通知后台服务 App 已进入后台（AppState background/inactive 时调用） */
  notifyAppInBackground(): void;
  /**
   * 标记事件已由 JS 层触发警报
   * 防止 App 切到后台后后台服务重复触发同一事件的悬浮窗和警报。
   */
  markEventTriggered(eventId: string): void;
  /**
   * JS 层收到预警事件后发送心跳确认
   * 原生层据此判断 JS 是否存活，超时未收到心跳则接管预警触发
   */
  acknowledgeEewEvent(): void;
  /**
   * 更新所有活跃 customSource 配置（JSON 数组字符串或 null）
   *
   * 传 null 或空字符串清空配置（后台服务不建立连接）。
   * 传入 SourceConfig 数组的 JSON 字符串后，后台服务会为每个源按 protocol 启动 WS/HTTP 连接。
   */
  updateCustomSourcesJson(sourcesJson: string | null): void;
  /**
   * 更新 allowHttp 开关到原生层（SharedPreferences）
   *
   * 控制后台服务是否允许 HTTP 明文连接。
   * 开关变化后会触发后台服务重连所有数据源。
   */
  updateAllowHttp(allowHttp: boolean): void;
  /**
   * 触发测试预警（绕过 WebSocket + 前后台检查，直接走悬浮窗触发路径）
   * @param magnitude 震级
   * @param depth 震源深度 km
   * @param lat 震中纬度
   * @param lng 震中经度
   * @param forceTrigger 是否强制触发（绕过阈值检查）
   */
  testAlert(
    magnitude: number,
    depth: number,
    lat: number,
    lng: number,
    forceTrigger: boolean,
  ): void;
}

/**
 * 原生模块引用（可能为空，未注册时为 undefined）
 */
const BackgroundServiceModule: BackgroundServiceModuleType | undefined =
  NativeModules.BackgroundServiceModule as BackgroundServiceModuleType | undefined;

/**
 * 后台保活服务管理器
 *
 * 通过 ForegroundService + 常驻通知维持 App 进程存活。
 * 启动后通知栏显示"地震预警后台服务运行中"常驻通知，
 * 降低系统在锁屏状态下杀死 App 进程的概率。
 *
 * 锁屏预警完整链路：
 * 1. App 启动时调用 start() 启动后台服务，原生层 OkHttp WebSocket 接收预警数据
 * 2. 配置变化时调用 updateConfig() / updateLocation() 同步到原生层
 * 3. AppState 'active' 时调用 notifyAppInForeground() 通知后台服务
 * 4. 锁屏时（App 不在前台），后台服务按配置触发悬浮窗（FloatingWindowModule）
 */
export const BackgroundServiceManager = {
  /**
   * 启动后台保活服务
   * 非 Android 平台无操作。
   */
  start(): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.start();
    } catch {
      // 忽略启动异常，避免影响 App 正常运行
    }
  },

  /**
   * 停止后台保活服务
   * 非 Android 平台无操作。
   */
  stop(): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.stop();
    } catch {
      // 忽略停止异常
    }
  },

  /**
   * 同步 alert 配置到原生层
   *
   * 当 alert 配置变更时调用，将最新配置写入 SharedPreferences，
   * 供后台服务在锁屏时按配置触发悬浮窗预警。
   *
   * @param alertConfig 完整的 alert 配置对象
   */
  updateConfig(alertConfig: AlertConfig): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.updateConfig(alertConfig);
    } catch {
      // 忽略同步异常
    }
  },

  /**
   * 同步用户位置到原生层
   *
   * 当用户位置变化时（GPS 更新或手动切换）调用，
   * 供后台服务计算震中距与预估烈度。
   *
   * @param location 用户当前位置坐标（userLat, userLng）
   */
  updateLocation(location: {userLat: number; userLng: number}): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.updateLocation(location);
    } catch {
      // 忽略同步异常
    }
  },

  /**
   * 通知后台服务 App 已回到前台
   *
   * RN 层在 AppState 'active' 时调用此方法，更新 appInForeground=true。
   * 后台服务收到事件时若 App 在前台，则跳过悬浮窗触发（由 JS 层处理）。
   */
  notifyAppInForeground(): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.notifyAppInForeground();
    } catch {
      // 忽略异常
    }
  },

  /**
   * 通知后台服务 App 已进入后台
   *
   * RN 层在 AppState 'background'/'inactive' 时调用此方法，更新 appInForeground=false。
   * 这是按 Home 键切后台时最可靠的检测方式（MIUI 下 onTrimMemory 和 SCREEN_OFF 不可靠）。
   * 后台服务收到事件时会触发锁屏预警（由原生层处理）。
   */
  notifyAppInBackground(): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.notifyAppInBackground();
    } catch {
      // 忽略异常
    }
  },

  /**
   * 标记事件已由 JS 层触发警报
   *
   * JS 层 useFloatingWindow 启动警报时调用，防止 App 切到后台后
   * 后台服务重复触发同一事件的悬浮窗和警报。
   */
  markEventTriggered(eventId: string): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.markEventTriggered(eventId);
    } catch {
      // 忽略异常
    }
  },

  /**
   * JS 层收到预警事件后发送心跳确认
   *
   * 在 useEewStream 的 SourceManager.onEvent 回调中调用，
   * 告诉原生层 JS 线程仍存活。原生层在 handleSourceData 中检查心跳：
   * 超过 FOREGROUND_HEARTBEAT_TIMEOUT_MS（3秒）未收到心跳则接管预警触发。
   */
  acknowledgeEewEvent(): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.acknowledgeEewEvent();
    } catch {
      // 忽略异常
    }
  },

  /**
   * 同步所有活跃 customSource 配置到原生层（多源并行模式）
   *
   * 当 config.sources 变化时调用，将所有活跃 customSource 序列化为 JSON 数组
   * 写入 SharedPreferences，供后台服务锁屏时按用户配置并行接收多源预警数据。
   *
   * 数据源选择策略：
   * - 调用方从 config.sources 中筛选 enabled && type==='customSource' 的所有源
   *   （含 eew 预警源和 eqlist 速报源，由原生层按 category 分别处理通知/弹窗逻辑），
   *   按 priority 升序传入
   * - 若无符合条件的源，传空数组清空原生层配置（后台服务不建立连接）
   *
   * 调用后原生层会自动重连：停止所有旧 WS/HTTP → 读取新配置数组 → 为每个源按 protocol 启动连接
   *
   * @param sources 活跃 customSource 配置数组（空数组表示无活跃源）
   */
  updateCustomSources(sources: SourceConfig[]): void {
    if (Platform.OS !== 'android') return;
    try {
      // 使用 JSON.stringify 传输 SourceConfig 数组，避免在原生层逐字段读取 ReadableMap
      // 原生层 BackgroundServiceModule.updateCustomSourcesJson 接收字符串并写入 SharedPreferences
      const json = sources.length > 0 ? JSON.stringify(sources) : null;
      BackgroundServiceModule?.updateCustomSourcesJson(json);
    } catch {
      // 忽略同步异常
    }
  },

  /**
   * 同步 allowHttp 开关到原生层
   *
   * 当 config.allowHttp 变化时调用，控制后台服务是否允许 HTTP 明文连接。
   * 开关变化后原生层会自动重连所有数据源（重新检查每个源的 endpoint 协议）。
   *
   * @param allowHttp 是否允许 HTTP 明文连接
   */
  updateAllowHttp(allowHttp: boolean): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.updateAllowHttp(allowHttp);
    } catch {
      // 忽略同步异常
    }
  },

  /**
   * 触发锁屏预警测试
   *
   * 绕过 WebSocket + 前后台检查，直接走原生层悬浮窗触发路径。
   * 用于在模拟预警页面测试锁屏预警功能（不依赖真实地震事件）。
   *
   * 测试路径与真实锁屏预警完全一致：
   *   构造事件 → emitEewEvent（转发JS）→ 计算烈度/距离/S波 → showFloatingWindow
   *
   * 注意：
   * - 调用前需确保后台服务已启动（设置页 → 系统能力 → 后台保活开关打开）
   * - 锁屏状态下 JS 层被挂起，无法点击按钮触发，需使用 ADB 广播：
   *   adb shell am broadcast -a com.mdoeeewapp.android.cn.TEST_ALERT \
   *     --es magnitude 6.0 --es depth 15 --es lat 40.0 --es lng 116.0 --ez forceTrigger true
   *
   * @param params 测试预警参数
   * @param params.magnitude 震级（默认 5.5）
   * @param params.depth 震源深度 km（默认 15）
   * @param params.lat 震中纬度（默认 40.0）
   * @param params.lng 震中经度（默认 116.0）
   * @param params.forceTrigger 是否强制触发，绕过 minMagnitude/lockScreenIntensity 检查（默认 false）
   */
  testAlert(params: {
    magnitude?: number;
    depth?: number;
    lat?: number;
    lng?: number;
    forceTrigger?: boolean;
  } = {}): void {
    if (Platform.OS !== 'android') return;
    try {
      BackgroundServiceModule?.testAlert(
        params.magnitude ?? 5.5,
        params.depth ?? 15,
        params.lat ?? 40.0,
        params.lng ?? 116.0,
        params.forceTrigger ?? false,
      );
    } catch {
      // 忽略异常
    }
  },
};

/**
 * 从 LocationConfig + 用户位置生成 updateLocation 入参
 *
 * GPS 模式使用实际定位坐标，手动模式使用手动输入坐标。
 * 供 HomeScreen 在位置变化时调用。
 */
export function buildLocationUpdate(
  locationConfig: LocationConfig,
  userLocation: {lat: number; lng: number},
): {userLat: number; userLng: number} {
  if (locationConfig.mode === 'manual') {
    return {userLat: locationConfig.manualLat, userLng: locationConfig.manualLng};
  }
  return {userLat: userLocation.lat, userLng: userLocation.lng};
}
