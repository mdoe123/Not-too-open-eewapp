// 系统权限状态检测 Hook（设置页用）
// 检测悬浮窗、通知、电池优化白名单的实际状态，用于设置页"系统能力"分组显示
// 挂载时检测 + AppState active 时刷新（从系统设置返回后自动更新状态）

import {useCallback, useEffect, useState} from 'react';
import {AppState, Platform} from 'react-native';
import {checkNotifications} from 'react-native-permissions';
import {FloatingWindowManager} from '../native/FloatingWindowManager';
import {PermissionManager} from '../native/PermissionManager';

/** 权限状态：null 表示检测中/未知，true/false 表示已授予/未授予 */
export type PermissionStatus = boolean | null;

export interface SystemPermissionStatus {
  /** 悬浮窗权限（SYSTEM_ALERT_WINDOW）状态 */
  overlay: PermissionStatus;
  /** 通知权限状态（作为后台运行能力的代理检测） */
  notification: PermissionStatus;
  /** 电池优化白名单状态 */
  battery: PermissionStatus;
  /** 手动刷新权限状态 */
  refresh: () => Promise<void>;
}

/**
 * 系统权限状态检测 Hook
 *
 * 用法：
 * ```tsx
 * const {overlay, notification, battery} = useSystemPermissionStatus();
 * // overlay === null → 检测中
 * // overlay === true → 权限已开启
 * // overlay === false → 权限未开启
 * ```
 */
export function useSystemPermissionStatus(): SystemPermissionStatus {
  const [overlay, setOverlay] = useState<PermissionStatus>(null);
  const [notification, setNotification] = useState<PermissionStatus>(null);
  const [battery, setBattery] = useState<PermissionStatus>(null);

  const refresh = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setOverlay(true);
      setNotification(true);
      setBattery(true);
      return;
    }
    // 并行检测三项权限，任一失败不阻塞其他
    const checks = [
      FloatingWindowManager.hasPermission()
        .then(setOverlay)
        .catch(() => setOverlay(false)),
      checkNotifications()
        .then(response => {
          const granted =
            response.status === 'granted' || response.status === 'limited';
          setNotification(granted);
        })
        .catch(() => setNotification(false)),
      PermissionManager.isBatteryOptimized()
        .then(setBattery)
        .catch(() => setBattery(false)),
    ];
    await Promise.all(checks);
  }, []);

  useEffect(() => {
    refresh();
    // 监听 AppState：从系统设置返回 App 时刷新权限状态
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  return {overlay, notification, battery, refresh};
}
