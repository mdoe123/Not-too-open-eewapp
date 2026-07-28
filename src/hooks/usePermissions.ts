// 权限状态管理 Hook
// 加载时检查所有权限状态，提供请求单个权限与刷新状态的能力
// 供 OnboardingScreen 使用，驱动"完成"按钮的可用状态
//
// 设计：
// - statusMap: Record<PermissionId, boolean>，记录每个权限的授予状态
// - loading: Record<PermissionId, boolean>，记录单个权限请求中状态
// - allRequiredGranted: 所有 required 权限已授予时为 true
// - requestPermission(id): 请求单个权限并刷新对应状态

import {useCallback, useEffect, useRef, useState} from 'react';
import {
  PERMISSION_ITEMS,
  REQUIRED_PERMISSION_IDS,
  type PermissionId,
} from '../screens/onboarding/permissionItems';

/** usePermissions Hook 返回值 */
export interface UsePermissionsResult {
  /** 各权限的授予状态（true=已授予） */
  statusMap: Record<PermissionId, boolean>;
  /** 各权限是否正在请求中（防止重复点击） */
  loadingMap: Record<PermissionId, boolean>;
  /** 是否已完成初次加载 */
  ready: boolean;
  /** 所有 required 权限是否已授予 */
  allRequiredGranted: boolean;
  /** 重新检查所有权限状态 */
  refreshStatus: () => Promise<void>;
  /** 请求单个权限（请求后自动刷新该项状态） */
  requestPermission: (id: PermissionId) => Promise<boolean>;
}

/** 初始化全 false 的状态 map */
function createInitialStatusMap(): Record<PermissionId, boolean> {
  const map = {} as Record<PermissionId, boolean>;
  for (const item of PERMISSION_ITEMS) {
    map[item.id] = false;
  }
  return map;
}

/** 初始化全 false 的 loading map */
function createInitialLoadingMap(): Record<PermissionId, boolean> {
  const map = {} as Record<PermissionId, boolean>;
  for (const item of PERMISSION_ITEMS) {
    map[item.id] = false;
  }
  return map;
}

/**
 * 权限状态管理 Hook
 *
 * 使用示例：
 * ```tsx
 * const {statusMap, loadingMap, allRequiredGranted, requestPermission} = usePermissions();
 * ```
 */
export function usePermissions(): UsePermissionsResult {
  const [statusMap, setStatusMap] = useState<Record<PermissionId, boolean>>(
    createInitialStatusMap,
  );
  const [loadingMap, setLoadingMap] = useState<Record<PermissionId, boolean>>(
    createInitialLoadingMap,
  );
  const [ready, setReady] = useState(false);
  const mountedRef = useRef(true);

  /** 检查单个权限并更新状态 */
  const checkSingle = useCallback(async (id: PermissionId): Promise<boolean> => {
    const item = PERMISSION_ITEMS.find(it => it.id === id);
    if (!item) {
      return false;
    }
    try {
      const granted = await item.check();
      if (mountedRef.current) {
        setStatusMap(prev => (prev[id] === granted ? prev : {...prev, [id]: granted}));
      }
      return granted;
    } catch {
      if (mountedRef.current) {
        setStatusMap(prev => ({...prev, [id]: false}));
      }
      return false;
    }
  }, []);

  /** 刷新所有权限状态 */
  const refreshStatus = useCallback(async () => {
    await Promise.all(PERMISSION_ITEMS.map(item => checkSingle(item.id)));
    if (mountedRef.current) {
      setReady(true);
    }
  }, [checkSingle]);

  // 初次挂载：检查所有权限
  useEffect(() => {
    mountedRef.current = true;
    refreshStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshStatus]);

  /** 请求单个权限 */
  const requestPermission = useCallback(
    async (id: PermissionId): Promise<boolean> => {
      const item = PERMISSION_ITEMS.find(it => it.id === id);
      if (!item) {
        return false;
      }
      // 防止重复请求
      if (loadingMap[id]) {
        return statusMap[id];
      }
      setLoadingMap(prev => ({...prev, [id]: true}));
      try {
        await item.request();
        // 请求后重新检查该项权限状态
        const granted = await checkSingle(id);
        return granted;
      } catch {
        // 请求异常时重新检查一次状态
        await checkSingle(id);
        return false;
      } finally {
        if (mountedRef.current) {
          setLoadingMap(prev => ({...prev, [id]: false}));
        }
      }
    },
    [loadingMap, statusMap, checkSingle],
  );

  // 计算所有 required 权限是否已授予
  const allRequiredGranted = REQUIRED_PERMISSION_IDS.every(id => statusMap[id] === true);

  return {
    statusMap,
    loadingMap,
    ready,
    allRequiredGranted,
    refreshStatus,
    requestPermission,
  };
}
