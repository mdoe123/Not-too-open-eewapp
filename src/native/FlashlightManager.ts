// 闪光灯警报原生模块封装
// 将 NativeModules.FlashlightModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值
//
// 触发策略：
// - 仅橙红级（烈度 ≥ 5）触发
// - 循环闪烁直到 stopBlinking 调用（悬浮窗隐藏时停止）

import {NativeModules, Platform} from 'react-native';

const {FlashlightModule} = NativeModules;

/**
 * 闪光灯管理器
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const FlashlightManager = {
  /** 打开闪光灯 */
  turnOn(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FlashlightModule?.turnOn() ?? Promise.resolve();
  },

  /** 关闭闪光灯 */
  turnOff(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FlashlightModule?.turnOff() ?? Promise.resolve();
  },

  /**
   * 闪烁 N 次
   * @param times 闪烁次数
   * @param intervalMs 间隔（毫秒）
   */
  blink(times: number, intervalMs: number): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FlashlightModule?.blink(times, intervalMs) ?? Promise.resolve();
  },

  /**
   * 循环闪烁直到 stopBlinking 调用
   * @param intervalMs 间隔（毫秒），开/关各持续此时间
   */
  startBlinking(intervalMs: number): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FlashlightModule?.startBlinking(intervalMs) ?? Promise.resolve();
  },

  /** 停止循环闪烁 */
  stopBlinking(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FlashlightModule?.stopBlinking() ?? Promise.resolve();
  },
};
