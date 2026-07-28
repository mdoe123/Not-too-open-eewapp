// 声音警报原生模块封装
// 将 NativeModules.SoundModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值
//
// 警报主音按 DB/T 113.1-2026 标准生成：
// - 5 个正弦波叠加，频率 100Hz~5500Hz
// - 时长 2.0 秒
// - 三阶段频率变化：低频 → 中频 → 高频

import {NativeModules, Platform} from 'react-native';

const {SoundModule} = NativeModules;

/**
 * 声音警报管理器
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const SoundManager = {
  /**
   * 播放警报主音（2.0 秒）
   * 重复调用会先停止上一次的播放再开始新的播放。
   */
  playAlertSound(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return SoundModule?.playAlertSound() ?? Promise.resolve();
  },

  /** 停止警报音播放 */
  stopAlertSound(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return SoundModule?.stopAlertSound() ?? Promise.resolve();
  },
};
