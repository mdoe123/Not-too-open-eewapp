// 开机自启动管理 RN 层接口
// 注意：BootReceiver 是系统自动触发，RN 层不需要主动调用启动
// 此模块提供检查自启动状态的能力（部分厂商 ROM 需要用户手动允许自启动）
import {NativeModules, Platform} from 'react-native';

/**
 * 原生 AutoStartModule 的类型定义
 * 由 AutoStartModule.kt 提供，需在 MainApplication.kt 中注册 AutoStartPackage 后才可用
 */
interface AutoStartModuleType {
  /**
   * 跳转到厂商自启动设置页
   * @returns true 表示跳转成功，false 表示无可用设置页或跳转失败
   */
  openAutoStartSettings(): Promise<boolean>;
}

/**
 * 原生模块引用（可能为空，未注册时为 undefined）
 */
const AutoStartModule: AutoStartModuleType | undefined =
  NativeModules.AutoStartModule as AutoStartModuleType | undefined;

/**
 * 自启动管理器
 *
 * 标准 Android API 不提供查询或修改自启动权限的能力，
 * 但 BootReceiver 已声明 RECEIVE_BOOT_COMPLETED 权限即可接收开机广播。
 * 部分国产 ROM（小米/华为/OPPO/vivo 等）在系统层增加了自启动管理开关，
 * 需要用户在系统设置中手动允许 App 自启动，本模块提供跳转到对应设置页的能力。
 */
export const AutoStartManager = {
  /**
   * 检查应用是否在系统自启动白名单中
   *
   * 注意：标准 Android API 无法直接查询，此方法返回 true 表示已声明 RECEIVE_BOOT_COMPLETED 权限。
   * 部分厂商 ROM（小米/华为/OPPO/vivo）需要用户手动在设置中允许自启动，
   * 此方法无法感知厂商 ROM 的开关状态，调用方应在引导页提示用户检查。
   *
   * @returns 在 Android 上恒返回 true（权限已声明即视为启用），其他平台返回 false
   */
  async isAutoStartEnabled(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }
    // 标准 Android 无法查询，返回 true（权限已声明即视为启用）
    return true;
  },

  /**
   * 跳转到厂商自启动设置页
   *
   * 尽力而为，不同厂商路径不同，可能因 ROM 版本变化而失效。
   * 失败时返回 false，调用方应提供 fallback（如提示用户手动到设置中查找）。
   *
   * @returns true 表示跳转成功，false 表示跳转失败或非 Android 平台
   */
  async openAutoStartSettings(): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }
    // 由原生模块实现厂商判断与跳转
    return AutoStartModule?.openAutoStartSettings() ?? false;
  },
};
