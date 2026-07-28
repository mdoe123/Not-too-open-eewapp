// 系统权限检测原生模块封装
// 将 NativeModules.PermissionModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值
//
// 当前提供：
// - 电池优化白名单检测（PowerManager.isIgnoringBatteryOptimizations）
// - 电池优化白名单申请（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS）

import {NativeModules, Platform} from 'react-native';

const {PermissionModule} = NativeModules;

/**
 * 系统权限管理器
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const PermissionManager = {
  /**
   * 检测应用是否已加入电池优化白名单（未被电池优化限制）
   * @returns true 表示已加入白名单（不受限制），false 表示受电池优化限制
   */
  isBatteryOptimized(): Promise<boolean> {
    if (Platform.OS !== 'android') return Promise.resolve(true);
    return PermissionModule?.isBatteryOptimized() ?? Promise.resolve(true);
  },

  /**
   * 申请加入电池优化白名单
   * 跳转到系统电池优化设置页，用户授权后应用将被加入白名单。
   * @returns true 表示已加入白名单（无需跳转），false 表示已跳转设置页（用户需手动操作）
   */
  requestBatteryOptimization(): Promise<boolean> {
    if (Platform.OS !== 'android') return Promise.resolve(true);
    return PermissionModule?.requestBatteryOptimization() ?? Promise.resolve(true);
  },
};
