// 悬浮窗原生模块封装
// 将 NativeModules.FloatingWindowModule 封装为带类型的 Promise API
// 仅 Android 平台有效，iOS / 其他平台直接返回安全默认值

import {NativeModules, Platform} from 'react-native';

const {FloatingWindowModule} = NativeModules;

/** 悬浮窗内容字段 */
export interface FloatingWindowContent {
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
}

/**
 * 悬浮窗管理器
 *
 * 所有方法在非 Android 平台返回安全默认值，调用方无需关心平台差异。
 */
export const FloatingWindowManager = {
  /** 显示悬浮窗 */
  show(content: FloatingWindowContent): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.show(content) ?? Promise.resolve();
  },
  /** 隐藏悬浮窗 */
  hide(): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.hide() ?? Promise.resolve();
  },
  /** 更新悬浮窗内容（不重建窗口） */
  updateContent(content: FloatingWindowContent): Promise<void> {
    if (Platform.OS !== 'android') return Promise.resolve();
    return FloatingWindowModule?.updateContent(content) ?? Promise.resolve();
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
