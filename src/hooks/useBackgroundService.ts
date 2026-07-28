// 后台保活服务 Hook
//
// 根据 alert.backgroundEnabled 配置自动启停 EewBackgroundService。
// App 启动时若 backgroundEnabled=true 则启动前台服务，
// 用户在设置页关闭后台开关时自动停止服务。
import {useEffect} from 'react';
import {BackgroundServiceManager} from '../native/BackgroundServiceManager';

/**
 * 后台保活服务 Hook
 *
 * @param backgroundEnabled 是否启用后台服务（对应 alert.backgroundEnabled）
 *
 * 行为：
 * - backgroundEnabled=true 时启动 EewBackgroundService（常驻通知）
 * - backgroundEnabled=false 时停止服务
 * - 组件卸载时不停止服务（服务应持续运行，不随组件生命周期结束）
 */
export function useBackgroundService(backgroundEnabled: boolean): void {
  useEffect(() => {
    if (backgroundEnabled) {
      BackgroundServiceManager.start();
    } else {
      BackgroundServiceManager.stop();
    }
    // 不在 cleanup 中 stop，因为服务应持续运行
    // 仅当 backgroundEnabled 变化时才切换
  }, [backgroundEnabled]);
}
