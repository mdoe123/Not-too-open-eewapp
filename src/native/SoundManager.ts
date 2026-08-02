// 声音警报原生模块封装
// 将 NativeModules.SoundModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值
//
// DB/T 113.1-2026 标准：
// - 警报主音：5 个正弦波叠加，频率 100Hz~5500Hz，时长 2.0 秒
// - 语音提示：级别信息 + 倒计时 + 取消/抵达提示
// - 播报方式：主音 + 语音叠加合成（真混音），循环播报

import {NativeModules, Platform} from 'react-native';
import {AlertLevel} from '../types';

const {SoundModule} = NativeModules;

/** 将 AlertLevel 转换为原生层识别的级别字符串 */
function levelToString(level: AlertLevel): string {
  return level; // 'silent' | 'blue' | 'yellow' | 'orange' | 'red'
}

/**
 * 声音警报管理器
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const SoundManager = {
  /**
   * 开始带语音的警报（主音 + 语音混音循环播放）
   *
   * DB/T 113.1-2026 6.1.4：
   * - 警报主音 + 语音提示叠加合成，循环播报
   * - remain > 0：播报 [级别] + [倒计时数字逐位] + ["秒后抵达"]
   * - remain <= 0（抵达）：仅播报 [级别] + ["横波已抵达"]，持续 60 秒后结束
   * - isCancel=true：循环播报 ["地震预警取消"]
   *
   * @param level 预警级别
   * @param remainSec 剩余秒数（向上取整）
   * @param isCancel 是否为取消报
   * @param arrived 横波是否已抵达（倒计时归零）
   */
  startAlertWithVoice(
    level: AlertLevel,
    remainSec: number,
    isCancel: boolean,
    arrived: boolean,
  ): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return (
      SoundModule?.startAlertWithVoice(
        levelToString(level),
        remainSec,
        isCancel,
        arrived,
      ) ?? Promise.resolve()
    );
  },

  /**
   * 更新预警状态（每秒 tick 调用）
   *
   * 不中断当前语音播放，等当前周期播完后取新状态。
   * 但取消报状态变化时立即切换。
   *
   * @param level 预警级别
   * @param remainSec 剩余秒数
   * @param isCancel 是否为取消报
   * @param arrived 横波是否已抵达
   */
  updateAlertState(
    level: AlertLevel,
    remainSec: number,
    isCancel: boolean,
    arrived: boolean,
  ): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return (
      SoundModule?.updateAlertState(
        levelToString(level),
        remainSec,
        isCancel,
        arrived,
      ) ?? Promise.resolve()
    );
  },

  /**
   * 播放警报主音（仅主音，无语音）
   *
   * 向后兼容接口，新代码应使用 startAlertWithVoice。
   */
  playAlertSound(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return SoundModule?.playAlertSound() ?? Promise.resolve();
  },

  /** 停止所有声音播放（主音 + 语音） */
  stopAlertSound(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return SoundModule?.stopAlertSound() ?? Promise.resolve();
  },

  /**
   * 保存当前媒体音量并设置为指定百分比
   * @param volumePercent 目标音量百分比（0-100）
   */
  saveAndSetMediaVolume(volumePercent: number): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return SoundModule?.saveAndSetMediaVolume(volumePercent) ?? Promise.resolve();
  },

  /** 恢复之前保存的媒体音量 */
  restoreMediaVolume(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return SoundModule?.restoreMediaVolume() ?? Promise.resolve();
  },
};
