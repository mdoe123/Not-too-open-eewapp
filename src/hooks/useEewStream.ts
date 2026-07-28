// 预警事件流 Hook
// 封装多数据源并行获取、事件合并与状态管理，供 HomeScreen 消费。
//
// 设计要点：
// - 多源并行模式：每个启用的数据源创建独立 SourceManager（单源，无主备切换）
// - 所有源的事件合并到同一列表（eew / eqlist 各一个），按 originTime 降序
// - 跨源去重：同一地震可能被多个机构报告，以 originTime+坐标+震级组合键去重
// - 事件清理：eew 的 isFinal 事件立即移除；超过 5 分钟无更新的事件自动移除
// - SourceManager 实例用 Map<string, SourceManager> 管理（key=priority 字符串，避免多 customSource 冲突）
//
// 替代关系：本 Hook 取代 useMockEewStream，从真实 wolfx 数据源获取事件

import {useEffect, useRef, useState, useCallback} from 'react';
import {
  EewEvent,
  SourceStatus,
  SourceType,
  SourceCategory,
  SourceConfig,
  AppConfig,
  DEFAULT_CONFIG,
} from '../types';
import {SourceManager} from '../sources/SourceManager';
import {createCustomSourceAdapter} from '../sources/custom';
import {useConfig} from './useConfig';
import {log} from '../utils/logger';
import {getSourceName} from '../utils/sourceLabels';
import {simulatedEventBus} from '../utils/simulatedEventBus';

/**
 * 获取数据源的 category（带兜底）
 * 兼容旧版本配置（无 category 字段）：类型名含 'Eqlist' 归为 eqlist，否则 eew。
 */
function getCategory(s: SourceConfig): SourceCategory {
  return s.category ?? (s.type.includes('Eqlist') ? 'eqlist' : 'eew');
}

/** EEW 预警事件列表最大保留条数（预警事件活跃期短，20 条足够） */
const MAX_EEW_EVENTS = 20;

/** EQLIST 速报事件列表最大保留条数（与 wolfx API 返回一致，50 条） */
const MAX_EQLIST_EVENTS = 50;

/** 事件超时清理阈值（5 分钟无更新自动移除，避免列表无限增长） */
const EVENT_TIMEOUT_MS = 5 * 60 * 1000;

/** 事件超时清理轮询间隔 */
const CLEANUP_INTERVAL_MS = 30 * 1000;

/** 切换提示自动清除延迟（毫秒） */
const SWITCH_MSG_DURATION_MS = 3000;

/**
 * 生成跨源去重键
 * 不同数据源对同一地震的 eventId 不同，用 originTime+坐标+震级组合判断同一事件
 * 坐标四舍五入到 0.01 度（约 1km）容差，避免各源精度差异导致漏去重
 */
function dedupKey(event: EewEvent): string {
  const latFixed = event.lat.toFixed(2);
  const lngFixed = event.lng.toFixed(2);
  return `${event.originTime}_${latFixed}_${lngFixed}_${event.magnitude.toFixed(1)}`;
}

/** 单个数据源管理器实例及其状态 */
interface ManagedSource {
  manager: SourceManager;
  config: SourceConfig;
  status: SourceStatus;
}

/** 真实预警事件流返回值 */
export interface UseEewStreamResult {
  /** 预警事件列表（最新在前，来自 eew 数据源） */
  events: EewEvent[];
  /** 速报事件列表（最新在前，来自 eqlist 数据源） */
  eqlistEvents: EewEvent[];
  /** 当前主源连接状态（优先级最高的启用源状态） */
  sourceStatus: SourceStatus;
  /** 当前主数据源名称（显示名） */
  activeSource: string;
  /** 当前主源显示名称（与 activeSource 一致，SourceStatusBar 兼容字段） */
  sourceName: string;
  /** 备用源数量（启用的源总数 - 1） */
  backupCount: number;
  /** 数据源切换提示，3 秒后自动清除 */
  switchMessage: string | null;
  /** 手动断开连接 */
  disconnect: () => void;
  /** 手动重连 */
  reconnect: () => void;
  /** 切换到备用数据源（保留接口兼容，多源并行模式下为空操作） */
  switchToBackup: () => void;
}

/**
 * 预警事件流 Hook（多源并行模式）
 *
 * 生命周期：
 * 1. 从 useConfig 获取用户配置的 sources 列表
 * 2. 遍历 enabled 的 sources，每个源创建独立 SourceManager（单源模式）
 * 3. 所有 SourceManager 的事件回调推送到统一的合并/去重逻辑
 * 4. 组件卸载时停止所有 SourceManager
 */
export function useEewStream(): UseEewStreamResult {
  const {config, ready} = useConfig();

  const [events, setEvents] = useState<EewEvent[]>([]);
  const [eqlistEvents, setEqlistEvents] = useState<EewEvent[]>([]);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>('connecting');
  const [activeSource, setActiveSource] = useState<SourceType>('customSource');
  const [backupCount, setBackupCount] = useState(0);
  const [switchMessage, setSwitchMessage] = useState<string | null>(null);

  // 所有数据源管理器实例（按 priority 字符串索引，因多个 customSource 的 type 相同会冲突）
  const managedSourcesRef = useRef<Map<string, ManagedSource>>(new Map());
  // 当前生效的 sources 列表
  const effectiveSourcesRef = useRef<SourceConfig[]>([]);
  // 切换提示自动清除定时器
  const switchMsgTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 事件超时清理定时器
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 标记组件是否已卸载，避免卸载后更新 state
  const isMountedRef = useRef(true);

  /** 显示切换提示（自动清除） */
  const showSwitchMessage = useCallback((msg: string) => {
    if (!isMountedRef.current) return;
    setSwitchMessage(msg);
    if (switchMsgTimerRef.current) {
      clearTimeout(switchMsgTimerRef.current);
    }
    switchMsgTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setSwitchMessage(null);
      }
    }, SWITCH_MSG_DURATION_MS);
  }, []);

  /**
   * 合并事件到列表（带跨源去重和条数限制）
   * @param listUpdater setState 函数
   * @param event 新事件
   * @param maxItems 最大条数
   * @param isEew 是否 eew 事件（eew 的 isFinal=true 表示事件终止需移除）
   */
  const mergeEvent = useCallback(
    (
      setList: React.Dispatch<React.SetStateAction<EewEvent[]>>,
      event: EewEvent,
      maxItems: number,
      isEew: boolean,
    ) => {
      if (!isMountedRef.current) return;

      setList(prev => {
        // eew 的 isFinal=true 表示预警结束，从列表移除
        if (isEew && event.isFinal) {
          return prev.filter(e => e.id !== event.id);
        }

        const key = dedupKey(event);

        // 检查是否已存在同源同事件（按 id 更新）
        const idxById = prev.findIndex(e => e.id === event.id);
        if (idxById >= 0) {
          const updated = [...prev];
          updated[idxById] = event;
          return updated;
        }

        // 检查跨源同事件（按 dedupKey 去重，保留先到达的）
        const idxByKey = prev.findIndex(e => dedupKey(e) === key);
        if (idxByKey >= 0) {
          // 已存在同一事件，保留先到达的（不覆盖）
          return prev;
        }

        // 新事件，插入并按 originTime 降序排序后截断
        const merged = [event, ...prev].sort((a, b) => b.originTime - a.originTime);
        return merged.slice(0, maxItems);
      });
    },
    [],
  );

  /**
   * 初始化并启动所有数据源（多源并行模式）
   * - 停止旧实例（若存在）
   * - 为每个 enabled 源创建独立 SourceManager
   * - 所有事件回调推送到统一合并逻辑
   */
  const startSources = useCallback(
    async (appConfig: AppConfig, sources: SourceConfig[]) => {
      // 停止并清理旧实例
      for (const [, managed] of managedSourcesRef.current) {
        await managed.manager.stop().catch(() => {});
      }
      managedSourcesRef.current.clear();

      // 按 category 分组
      const eewSources = sources.filter(s => getCategory(s) === 'eew' && s.enabled);
      const eqlistSources = sources.filter(s => getCategory(s) === 'eqlist' && s.enabled);

      log('STREAM', 'startSources', {
        eew: eewSources.length,
        eqlist: eqlistSources.length,
      });

      // 备用源数量 = 启用源总数 - 1（保留接口兼容）
      setBackupCount(Math.max(0, eewSources.length + eqlistSources.length - 1));

      // 设置初始主源（优先级最高的启用 eew 源，用于状态显示）
      if (eewSources.length > 0) {
        const primary = eewSources.sort((a, b) => a.priority - b.priority)[0];
        setActiveSource(primary.type);
      } else if (eqlistSources.length > 0) {
        const primary = eqlistSources.sort((a, b) => a.priority - b.priority)[0];
        setActiveSource(primary.type);
      }

      // 为每个启用的源创建独立 SourceManager
      const allEnabled = [...eewSources, ...eqlistSources];
      for (const src of allEnabled) {
        // 合规改造（v13+）：仅支持 customSource 类型
        if (src.type !== 'customSource') {
          log('STREAM', `跳过不支持的源类型: ${src.type}`);
          continue;
        }
        const adapter = createCustomSourceAdapter(src);
        if (!adapter) {
          log('STREAM', `adapter 创建失败: ${src.type}`);
          continue;
        }

        const isEew = getCategory(src) === 'eew';
        const maxItems = isEew ? MAX_EEW_EVENTS : MAX_EQLIST_EVENTS;
        const setList = isEew ? setEvents : setEqlistEvents;

        const manager = new SourceManager(
          appConfig,
          // onEvent：合并事件到对应列表
          (event: EewEvent) => {
            log('STREAM', `${isEew ? 'eew' : 'eqlist'}事件 id=${event.id} mag=${event.magnitude}`);
            mergeEvent(setList, event, maxItems, isEew);
          },
          // onStatus：更新主源状态（仅优先级最高的源影响全局状态显示）
          (status: SourceStatus, message?: string) => {
            if (!isMountedRef.current) return;
            log('STREAM', `${src.type} 状态 ${status}${message ? ' ' + message : ''}`);

            // 更新该源的状态
            const managed = managedSourcesRef.current.get(String(src.priority));
            if (managed) {
              managed.status = status;
            }

            // 计算全局状态：任一源 connected 则全局 connected
            const allManaged = Array.from(managedSourcesRef.current.values());
            const anyConnected = allManaged.some(m => m.status === 'connected');
            const allError = allManaged.length > 0 && allManaged.every(m => m.status === 'error' || m.status === 'disconnected');
            if (anyConnected) {
              setSourceStatus('connected');
            } else if (allError) {
              setSourceStatus('error');
            } else {
              setSourceStatus('connecting');
            }

            if (message && (message.includes('切换') || message.includes('退避'))) {
              showSwitchMessage(message);
            }
          },
        );

        manager.registerAdapter(src, adapter);
        managedSourcesRef.current.set(String(src.priority), {manager, config: src, status: 'connecting'});
      }

      // 启动所有 manager
      for (const [, managed] of managedSourcesRef.current) {
        // 单源模式：只传入该源自身，SourceManager 无备用队列
        await managed.manager.start([managed.config]).catch(e => {
          log('STREAM', `启动失败 ${managed.config.type}: ${e instanceof Error ? e.message : String(e)}`);
        });
      }

      log('STREAM', 'startSources 完成');
    },
    [mergeEvent, showSwitchMessage],
  );

  // 配置就绪后启动所有数据源
  useEffect(() => {
    isMountedRef.current = true;

    if (!ready || !config) {
      return;
    }

    const sources = config.sources;
    effectiveSourcesRef.current = sources;
    setSourceStatus('connecting');
    void startSources(config, sources);

    return () => {
      isMountedRef.current = false;
      for (const [, managed] of managedSourcesRef.current) {
        void managed.manager.stop().catch(() => {});
      }
      managedSourcesRef.current.clear();
      if (switchMsgTimerRef.current) {
        clearTimeout(switchMsgTimerRef.current);
        switchMsgTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, config?.sources, config?.heartbeatFailureThreshold]);

  // 事件超时清理：定期移除超过 5 分钟无更新的事件（eew + eqlist）
  useEffect(() => {
    cleanupTimerRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      const now = Date.now();
      setEvents(prev => {
        const filtered = prev.filter(
          e => now - e.receivedAt < EVENT_TIMEOUT_MS,
        );
        if (filtered.length !== prev.length) {
          log('STREAM', `清理eew超时事件 ${prev.length}→${filtered.length}`);
        }
        return filtered.length === prev.length ? prev : filtered;
      });
      setEqlistEvents(prev => {
        const filtered = prev.filter(
          e => now - e.receivedAt < EVENT_TIMEOUT_MS,
        );
        if (filtered.length !== prev.length) {
          log('STREAM', `清理eqlist超时事件 ${prev.length}→${filtered.length}`);
        }
        return filtered.length === prev.length ? prev : filtered;
      });
    }, CLEANUP_INTERVAL_MS);

    return () => {
      if (cleanupTimerRef.current) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, []);

  // 订阅模拟预警事件总线：模拟预警页面发射的事件注入 eew 列表
  useEffect(() => {
    const unsubscribe = simulatedEventBus.subscribe(event => {
      mergeEvent(setEvents, event, MAX_EEW_EVENTS, true);
    });
    return unsubscribe;
  }, [mergeEvent]);

  /** 手动断开连接（断开所有源） */
  const disconnect = useCallback(() => {
    log('STREAM', 'disconnect');
    setSourceStatus('disconnected');
    for (const [, managed] of managedSourcesRef.current) {
      void managed.manager.stop().catch(() => {});
    }
    managedSourcesRef.current.clear();
  }, []);

  /** 手动重连：重新启动所有数据源 */
  const reconnect = useCallback(() => {
    log('STREAM', 'reconnect');
    const appConfig = config ?? DEFAULT_CONFIG;
    const sources = effectiveSourcesRef.current.length > 0
      ? effectiveSourcesRef.current
      : appConfig.sources;
    effectiveSourcesRef.current = sources;
    setSourceStatus('connecting');
    void startSources(appConfig, sources);
  }, [config, startSources]);

  /**
   * 切换到备用数据源（多源并行模式下为空操作）
   * 保留接口兼容性，避免 SourceStatusBar 调用时报错
   */
  const switchToBackup = useCallback(() => {
    showSwitchMessage('多源并行模式，无需手动切换');
  }, [showSwitchMessage]);

  const sourceName = getSourceName(activeSource);

  return {
    events,
    eqlistEvents,
    sourceStatus,
    activeSource: sourceName,
    sourceName,
    backupCount,
    switchMessage,
    disconnect,
    reconnect,
    switchToBackup,
  };
}
