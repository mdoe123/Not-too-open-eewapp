// 应用自重启 RN 层接口
// 封装 AppRestartModule 原生模块，提供 restart()。
// 用于「数据源启用态」等连接级配置改动后，提示用户并自动重启以让配置生效。
// 调用前必须先 flush 配置到 AsyncStorage，确保重启后能读到最新配置。

// RESTART 时机说明：useConfig 各页面配置状态彼此独立（无全局共享），
// 设置页改动的数据源不会实时同步到首页/流/后台服务；
// 重启后 HomeScreen 从 AsyncStorage 重新读取配置并触发数据源重连，使改动生效。
import {NativeModules, Platform} from 'react-native';

const {AppRestartModule} = NativeModules;

export const AppRestartManager = {
  /**
   * 重启应用（以单任务模式重新拉起 MainActivity 并结束当前进程）
   *
   * 仅 Android 生效；iOS 下为空操作（本项目目标平台为 Android）。
   */
  restart(): void {
    if (Platform.OS !== 'android') {
      return;
    }
    try {
      AppRestartModule?.restart();
    } catch {
      // 忽略重启调用异常
    }
  },
};