// 模拟预警事件总线
// 模块级单例发布订阅模式，用于模拟预警页面向 useEewStream 注入模拟事件
//
// 设计原因：
// - useEewStream 是 Hook，各页面（HomeScreen/SettingsScreen/SimulateAlertScreen）
//   调用时创建独立实例，state 不共享
// - 模拟预警页面（独立路由）需要将事件注入 HomeScreen 的 eewStream.events
// - 使用模块级单例避免重构为 Context Provider

import {EewEvent} from '../types';

type EventListener = (event: EewEvent) => void;

/** 订阅者集合 */
const listeners = new Set<EventListener>();

/**
 * 模拟预警事件总线
 *
 * - emit: 模拟预警页面触发，发射一条模拟 EewEvent
 * - subscribe: useEewStream 订阅，收到事件注入 events 列表
 */
export const simulatedEventBus = {
  /** 发射模拟事件，所有订阅者会收到 */
  emit(event: EewEvent): void {
    listeners.forEach(listener => {
      try {
        listener(event);
      } catch {
        // 订阅者异常不影响其他订阅者
      }
    });
  },

  /** 订阅模拟事件，返回取消订阅函数 */
  subscribe(listener: EventListener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
