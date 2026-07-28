// 首次启动引导检测 Hook
// 使用 AsyncStorage 存储 '@eew_onboarding_completed' 标志
// App.tsx 用此 Hook 决定初始路由（Onboarding 或 Home）
//
// 行为：
// - 首次启动（无标志）→ isCompleted = false，初始路由为 Onboarding
// - 已完成 → isCompleted = true，初始路由为 Home
// - completeOnboarding() 写入标志（"完成"与"稍后设置"都会调用）
// - resetOnboarding() 清除标志（供设置页重新触发引导使用）

import {useCallback, useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage 存储键 */
const ONBOARDING_KEY = '@eew_onboarding_completed';

/** useOnboarding Hook 返回值 */
export interface UseOnboardingResult {
  /** 引导是否已完成（null 表示尚未加载完成） */
  isCompleted: boolean | null;
  /** 标记引导完成（写入 AsyncStorage） */
  completeOnboarding: () => Promise<void>;
  /** 重置引导状态（清除 AsyncStorage，供设置页"重新引导"使用） */
  resetOnboarding: () => Promise<void>;
}

/**
 * 首次启动引导检测 Hook
 *
 * 使用示例：
 * ```tsx
 * const {isCompleted, completeOnboarding} = useOnboarding();
 * if (isCompleted === null) return <SplashScreen />;
 * const initialRoute = isCompleted ? 'Home' : 'Onboarding';
 * ```
 */
export function useOnboarding(): UseOnboardingResult {
  const [isCompleted, setIsCompleted] = useState<boolean | null>(null);

  // 初次加载：读取 AsyncStorage 标志
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const value = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (mounted) {
          // 宽松判断：接受 'true' 字符串或 '1'，容错性更高
          // 防止外部写入 'True'、'1' 等变体导致引导页重复显示
          setIsCompleted(value === 'true' || value === '1');
        }
      } catch {
        // 读取失败视为未完成，保证引导页可显示
        if (mounted) {
          setIsCompleted(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /** 标记引导完成 */
  const completeOnboarding = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
      setIsCompleted(true);
    } catch {
      // 写入失败忽略，下次启动会重新检测
    }
  }, []);

  /** 重置引导状态 */
  const resetOnboarding = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(ONBOARDING_KEY);
      setIsCompleted(false);
    } catch {
      // 删除失败忽略
    }
  }, []);

  return {isCompleted, completeOnboarding, resetOnboarding};
}
