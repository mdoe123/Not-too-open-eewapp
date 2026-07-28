// 应用配置读写 Hook
// 使用 AsyncStorage 持久化 AppConfig，启动时合并默认配置防止旧版本字段缺失
//
// 安全设计：
// - apiKey 等敏感凭据不持久化到 AsyncStorage（明文存储易被 root 设备提取）
// - 持久化前剥离 sources 中的 apiKey 字段，仅运行时内存中持有
// - 未来若需持久化 apiKey，应使用 Android Keystore / react-native-keychain 加密存储
//
// 写入策略（P1-18 修复）：
// - 不在 setConfig updater 内执行 AsyncStorage.setItem 副作用（反模式）
// - 用 useEffect 监听 config 变化，debounce 300ms 后写入，避免高频写入竞态
// - 多次快速更新只产生一次写入，写入的是最新值
import {useCallback, useEffect, useRef, useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AlertConfig,
  AppConfig,
  CURRENT_CONFIG_VERSION,
  DEFAULT_CONFIG,
  DebugConfig,
  LocationConfig,
  SourceConfig,
} from '../types';
import type {SourceCategory} from '../types';

/** AsyncStorage 存储键 */
const STORAGE_KEY = '@eew_app_config';

/** 持久化 debounce 延迟（毫秒），避免高频写入（如滑块拖动）造成 IO 竞态 */
const PERSIST_DEBOUNCE_MS = 300;

/**
 * 剥离配置中 sources 的 apiKey/authToken 字段，返回安全可持久化的副本
 * 敏感凭据不应明文写入 AsyncStorage（Android 上为未加密的 shared_prefs / SQLite）
 */
function stripApiKeys(config: AppConfig): AppConfig {
  return {
    ...config,
    sources: config.sources.map(s => {
      const {apiKey, authToken, ...rest} = s;
      // apiKey / authToken 故意丢弃，不写入持久化存储
      void apiKey;
      void authToken;
      return rest as SourceConfig;
    }),
  };
}

/**
 * 校验存储的配置对象是否具有合法结构
 * 防止 JSON.parse 后的结构被篡改/损坏导致后续访问崩溃
 * 不通过时调用方应回退到 DEFAULT_CONFIG
 */
function isValidConfig(raw: unknown): raw is Partial<AppConfig> {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  // sources 必须是数组（若存在）
  if (obj.sources !== undefined && !Array.isArray(obj.sources)) {
    return false;
  }
  // alert 必须是对象（若存在）
  if (obj.alert !== undefined && (typeof obj.alert !== 'object' || obj.alert === null)) {
    return false;
  }
  // 数值字段必须是 number（若存在）
  const numericFields = ['version', 'pollIntervalMs', 'heartbeatFailureThreshold'];
  for (const field of numericFields) {
    if (obj[field] !== undefined && typeof obj[field] !== 'number') {
      return false;
    }
  }
  return true;
}

/**
 * 推断数据源配置的 category 字段
 *
 * - 类型名包含 'Eqlist' 的归为 'eqlist'
 * - 其余归为 'eew'
 */
function inferCategory(type: string): SourceCategory {
  return type.includes('Eqlist') ? 'eqlist' : 'eew';
}

/**
 * 版本化迁移：将旧版本配置升级到当前版本
 *
 * 迁移历史：
 * - v0 → v1: 初始版本（无 version 字段）
 * - v1 → v2: 新增 SourceConfig.category 字段；新增 4 个 eqlist 数据源
 * - v2 → v3: 新增 2 个测试数据源（testEew/testEqlist，默认禁用）
 * - v3 → v4: 移除测试数据源；剔除旧用户持久化的 test 源
 * - v5 → v6: 默认启用 wolfxGetCencEqlist（修复地震信息列表为空的 bug）
 * - v6 → v7: 新增 DebugConfig（debug 字段），支持远程日志调试
 * - v11: 合规改造——DEFAULT_CONFIG.sources 清空为 []（新用户开箱无预填源）
 * - v12: FieldMapping 新增可选 listPath 字段
 * - v13: 彻底合规改造——删除所有 wolfx* 适配器代码和 SourceType 字面量。
 *        强制清空所有 type 非 'customSource' 的源（包括老用户已配置的 wolfx 源）。
 *        SourceType 联合仅保留 'customSource' | 'simulated'。
 */
function migrateConfig(stored: Partial<AppConfig>): AppConfig {
  // 基础合并：用默认值补齐缺失字段
  const baseSources = Array.isArray(stored.sources) && stored.sources.length > 0
    ? stored.sources
    : DEFAULT_CONFIG.sources;

  const storedVersion = stored.version ?? 0;

  // v13 迁移：彻底合规改造——强制清空所有 type 非 'customSource' 的源
  // 删除 wolfx* 适配器代码后，老用户配置中的 wolfx 源已无法连接，必须清除
  // 仅保留 customSource 类型的源（用户自行配置的自定义数据源）
  const migratedSources = storedVersion < 13
    ? baseSources.filter(s => s.type === 'customSource')
    : baseSources;

  const merged: AppConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    version: CURRENT_CONFIG_VERSION,
    alert: {
      ...DEFAULT_CONFIG.alert,
      ...(stored.alert ?? {}),
    },
    // v5 新增 location 字段：旧配置无此字段时用默认值（GPS 模式）
    location: {
      ...DEFAULT_CONFIG.location,
      ...(stored.location ?? {}),
    },
    // v7 新增 debug 字段：旧配置无此字段时用默认值（远程日志关闭）
    debug: {
      ...DEFAULT_CONFIG.debug,
      ...(stored.debug ?? {}),
    },
    sources: migratedSources,
  };

  // v9 迁移：移除已删除的 lockScreenMagnitude 字段（旧用户配置中可能残留）
  if (storedVersion < 9 && (merged.alert as unknown as Record<string, unknown>).lockScreenMagnitude !== undefined) {
    delete (merged.alert as unknown as Record<string, unknown>).lockScreenMagnitude;
  }

  return merged;
}

/**
 * 解析并校验存储的 JSON 字符串为 AppConfig
 * 任何异常（JSON 解析失败、schema 校验失败）都回退到 DEFAULT_CONFIG
 */
function parseConfig(raw: string | null): AppConfig {
  if (raw === null) {
    return {...DEFAULT_CONFIG};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!isValidConfig(parsed)) {
      // schema 校验失败，回退到默认配置
      return {...DEFAULT_CONFIG};
    }
    return migrateConfig(parsed);
  } catch {
    return {...DEFAULT_CONFIG};
  }
}

export interface UseConfigResult {
  /** 当前配置 */
  config: AppConfig;
  /** 是否已完成初次加载 */
  ready: boolean;
  /** 局部更新 alert 字段（内存立即生效，持久化 debounce 300ms） */
  updateAlert: (partial: Partial<AlertConfig>) => void;
  /** 替换数据源列表（内存立即生效，持久化 debounce 300ms） */
  updateSources: (sources: SourceConfig[]) => void;
  /** 局部更新 location 字段（位置模式/手动坐标） */
  updateLocation: (partial: Partial<LocationConfig>) => void;
  /** 局部更新 debug 字段（远程日志等） */
  updateDebug: (partial: Partial<DebugConfig>) => void;
  /** 重置为默认配置 */
  resetConfig: () => void;
}

/**
 * 配置持久化 Hook
 * - 首次启动（无存储）时写入 DEFAULT_CONFIG（已剥离 apiKey）
 * - 加载时合并 DEFAULT_CONFIG 确保字段完整
 * - 更新操作仅修改内存 state，持久化通过 useEffect debounce 写入
 * - 多次快速更新（如滑块拖动）只产生一次 IO 写入，避免竞态
 * - apiKey 仅在运行时内存中持有，不持久化
 */
export function useConfig(): UseConfigResult {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  // 标记是否已加载完成，避免加载期间的 config 变化触发写入
  const loadedRef = useRef(false);

  // 初次加载：读取并合并配置
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!mounted) {
          return;
        }
        if (raw === null) {
          // 首次启动：写入默认配置（剥离 apiKey）
          const safe = stripApiKeys(DEFAULT_CONFIG);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
          setConfig({...DEFAULT_CONFIG});
        } else {
          // 解析 + schema 校验 + 版本迁移
          setConfig(parseConfig(raw));
        }
      } catch (err) {
        // 读取失败时回退到默认配置，保证 UI 可用
        if (mounted) {
          setConfig({...DEFAULT_CONFIG});
        }
      } finally {
        if (mounted) {
          loadedRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 持久化 effect：监听 config 变化，debounce 后写入
  // 解决 P1-18：避免在 setConfig updater 内执行副作用，避免高频写入竞态
  useEffect(() => {
    if (!loadedRef.current) {
      // 加载期间不写入
      return;
    }
    const safe = stripApiKeys(config);
    const timer = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(safe)).catch(() => {
        // 写入失败忽略，下次启动会重新尝试
      });
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [config]);

  const updateAlert = useCallback((partial: Partial<AlertConfig>) => {
    setConfig(prev => ({
      ...prev,
      alert: {...prev.alert, ...partial},
    }));
  }, []);

  const updateSources = useCallback((sources: SourceConfig[]) => {
    setConfig(prev => ({...prev, sources}));
  }, []);

  const updateLocation = useCallback((partial: Partial<LocationConfig>) => {
    setConfig(prev => ({
      ...prev,
      location: {...prev.location, ...partial},
    }));
  }, []);

  const updateDebug = useCallback((partial: Partial<DebugConfig>) => {
    setConfig(prev => ({
      ...prev,
      debug: {...prev.debug, ...partial},
    }));
  }, []);

  const resetConfig = useCallback(() => {
    setConfig({...DEFAULT_CONFIG});
  }, []);

  return {config, ready, updateAlert, updateSources, updateLocation, updateDebug, resetConfig};
}
