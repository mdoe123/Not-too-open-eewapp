// 震动警报原生模块封装
// 将 NativeModules.VibratorModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值
//
// 触发策略：
// - 与声音/闪光灯同步触发（受 vibrationEnabled 控制）
// - 循环震动直到 stopVibrating 调用（悬浮窗隐藏时停止）
// - 与音频循环同步：振动 2000ms + 静默 1000ms（音频播放 2000ms + 静音 1000ms）

import {NativeModules, Platform} from 'react-native';

const {VibratorModule} = NativeModules;

/**
 * 震动管理器
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const VibratorManager = {
  /**
   * 循环震动直到 stopVibrating 调用
   * @param intervalMs 间隔（毫秒），震动/静默各持续此时间
   */
  startVibrating(intervalMs: number): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return VibratorModule?.startVibrating(intervalMs) ?? Promise.resolve();
  },

  /**
   * 循环震动（支持振动时长与静默时长不同），与音频循环同步
   * @param vibrateMs 振动持续时长（毫秒）
   * @param silentMs 静默持续时长（毫秒）
   *
   * 典型用法：与 DB/T 113.1-2026 警报主音同步
   * - 音频播放 2000ms + 静音 1000ms = 3000ms 循环
   * - 震动振动 2000ms + 静默 1000ms = 3000ms 循环
   */
  startVibratingCycle(vibrateMs: number, silentMs: number): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return VibratorModule?.startVibratingCycle(vibrateMs, silentMs) ?? Promise.resolve();
  },

  /** 停止循环震动 */
  stopVibrating(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return VibratorModule?.stopVibrating() ?? Promise.resolve();
  },
};
