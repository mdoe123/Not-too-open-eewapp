// 悬浮窗原生模块封装
// 将 NativeModules.FloatingWindowModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值

import {NativeModules, Platform} from 'react-native';

const {FloatingWindowModule} = NativeModules;

/** 悬浮窗内容字段 */
export interface FloatingWindowContent {
  /** 事件 ID（多事件并发时用于区分不同事件，必填） */
  eventId: string;
  /** 震级 */
  magnitude: number;
  /** S 波到达剩余秒数 */
  countdown: number;
  /** 震中位置描述 */
  location: string;
  /** 预警级别（AlertLevel：silent/blue/yellow/orange/red） */
  level: string;
  /** 预估烈度（CSIS），用于背景色分档（DB/T 113.1-2026 标准：≥7红/≥5橙/≥3黄/≥1蓝） */
  intensity: number;
  /** 震中距（km） */
  epicenterDistance: number;
  /** 发震时刻（Unix 毫秒） */
  originTime: number;
  /** 是否为取消报（true 时悬浮窗显示"地震预警取消"） */
  isCancel?: boolean;
  /** 报数（第几报，若数据源提供） */
  reportNum?: number;
  /** 数据源显示名称 */
  sourceName?: string;
}

/**
 * 悬浮窗管理器（多事件并发版）
 *
 * 支持最多 3 个悬浮窗上下垂直排列。
 * 推荐使用 setEvents 批量设置显示中的事件列表，自动处理新增/更新/移除。
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const FloatingWindowManager = {
  /**
   * 显示或更新单个事件的悬浮窗
   * @param content 包含 eventId 字段，若该事件已存在则更新，否则新建
   */
  show(content: FloatingWindowContent): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.show(content) ?? Promise.resolve();
  },
  /** 隐藏所有悬浮窗 */
  hide(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.hide() ?? Promise.resolve();
  },
  /**
   * 隐藏指定事件的悬浮窗（不影响其他事件）
   * @param eventId 要隐藏的事件 ID
   */
  hideOne(eventId: string): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.hideOne(eventId) ?? Promise.resolve();
  },
  /**
   * 更新指定事件的内容（不重建窗口）
   * @param content 包含 eventId 字段
   */
  updateContent(content: FloatingWindowContent): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.updateContent(content) ?? Promise.resolve();
  },
  /**
   * 批量设置显示中的事件列表（替代多次 show/hideOne 调用）
   * @param contents 由上层排序后的内容数组（最多 3 个）
   *
   * 行为：
   * - 新增 eventId → 创建 View
   * - 已存在 eventId → 更新内容
   * - 不在列表中的已显示 eventId → 移除
   * - 重新排列所有 View 的 y 偏移
   */
  setEvents(contents: FloatingWindowContent[]): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.setEvents(contents) ?? Promise.resolve();
  },
  /** 检查是否有悬浮窗权限 */
  hasPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return Promise.resolve(false);
    return FloatingWindowModule?.hasPermission() ?? Promise.resolve(false);
  },
  /** 跳转到悬浮窗权限设置页 */
  requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return Promise.resolve(false);
    return FloatingWindowModule?.requestPermission() ?? Promise.resolve(false);
  },
};
