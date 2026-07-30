// 用户协议/免责声明确认检测 Hook
// 使用 AsyncStorage 存储 LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY 标志
// App.tsx 用此 Hook 决定是否展示用户协议弹窗（首次启动拦截层）
//
// 行为：
// - 首次启动（无标志）→ isAcknowledged = false，App 渲染 DisclaimerModal
// - 已同意 → isAcknowledged = true，App 走正常启动流程
// - acknowledge() 写入 'true' 标志，关闭弹窗
//
// 与 useOnboarding 的关系：
// - 免责声明是最外层拦截（优先级高于 onboarding）
// - 用户必须先同意免责声明，才能进入 onboarding 或主界面
// - 老用户升级时也会看到一次（_LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY 未设置）

import {useCallback, useEffect, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY} from '../types/config';

/** useLegalDisclaimer Hook 返回值 */
export interface UseLegalDisclaimerResult {
  /** 是否已同意免责声明（null 表示尚未加载完成） */
  isAcknowledged: boolean | null;
  /** 标记已同意（写入 AsyncStorage） */
  acknowledge: () => Promise<void>;
}

/**
 * 免责声明/用户协议确认检测 Hook
 *
 * 使用示例：
 * ```tsx
 * const {isAcknowledged, acknowledge} = useLegalDisclaimer();
 * if (isAcknowledged === null) return <SplashScreen />;
 * if (!isAcknowledged) return <DisclaimerModal onAgree={acknowledge} />;
 * ```
 */
export function useLegalDisclaimer(): UseLegalDisclaimerResult {
  const [isAcknowledged, setIsAcknowledged] = useState<boolean | null>(null);

  // 初次加载：读取 AsyncStorage 标志
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const value = await AsyncStorage.getItem(LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY);
        if (mounted) {
          // 宽松判断：接受 'true' 字符串或 '1'，与 useOnboarding 保持一致
          setIsAcknowledged(value === 'true' || value === '1');
        }
      } catch {
        // 读取失败视为未同意，保证弹窗可显示
        if (mounted) {
          setIsAcknowledged(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /** 标记已同意免责声明 */
  const acknowledge = useCallback(async () => {
    try {
      await AsyncStorage.setItem(LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY, 'true');
      setIsAcknowledged(true);
    } catch {
      // 写入失败忽略，下次启动会重新检测
    }
  }, []);

  return {isAcknowledged, acknowledge};
}
