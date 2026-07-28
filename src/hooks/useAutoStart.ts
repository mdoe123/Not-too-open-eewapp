// 开机自启动管理 Hook
// 简单封装 AutoStartManager，便于在组件中使用
import {useCallback, useState} from 'react';
import {AutoStartManager} from '../native/AutoStartManager';

/**
 * useAutoStart Hook 返回值
 */
export interface UseAutoStartResult {
  /**
   * 是否已声明自启动权限（仅 Android 上为 true，其他平台为 false）
   * 注意：此值不能反映厂商 ROM 自启动开关的真实状态
   */
  isAutoStartEnabled: boolean;
  /**
   * 检查自启动权限（异步重新检查，结果同步到 isAutoStartEnabled）
   */
  checkAutoStartEnabled: () => Promise<void>;
  /**
   * 跳转到厂商自启动设置页
   * @returns true 表示跳转成功
   */
  openAutoStartSettings: () => Promise<boolean>;
}

/**
 * 开机自启动管理 Hook
 *
 * 提供：
 * - 查询自启动状态（基于权限声明，无法查询厂商 ROM 实际开关状态）
 * - 跳转到厂商自启动设置页（用于引导用户手动允许自启动）
 *
 * 使用示例：
 * ```tsx
 * const { isAutoStartEnabled, openAutoStartSettings } = useAutoStart();
 * if (!isAutoStartEnabled) {
 *   // 引导用户开启自启动
 *   <Button title="去设置" onPress={openAutoStartSettings} />
 * }
 * ```
 */
export function useAutoStart(): UseAutoStartResult {
  const [enabled, setEnabled] = useState(false);

  const checkAutoStartEnabled = useCallback(async () => {
    const value = await AutoStartManager.isAutoStartEnabled();
    setEnabled(value);
  }, []);

  const openAutoStartSettings = useCallback(async () => {
    return await AutoStartManager.openAutoStartSettings();
  }, []);

  return {
    isAutoStartEnabled: enabled,
    checkAutoStartEnabled,
    openAutoStartSettings,
  };
}
