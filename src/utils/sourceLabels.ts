// 数据源标签工具
// 提供数据源的机构简称和完整显示名映射，供卡片、详情页、SourceStatusBar 复用
//
// 合规改造（v13+）：仅保留 customSource 和 simulated 两种类型。
// 所有 wolfx* 和旧占位类型（cenc/jma/usgs/thirdParty）已删除。

import {SourceType} from '../types';

/**
 * 数据源完整显示名映射
 */
export const SOURCE_NAMES: Record<SourceType, string> = {
  // 自定义数据源（用户填写 URL + 字段映射）
  customSource: '自定义数据源',
  // 模拟事件标识
  simulated: '模拟预警',
};

/**
 * 机构简称映射（不含传输方式后缀，用于卡片机构标签）
 */
const SOURCE_AGENCY: Record<SourceType, string> = {
  // 自定义数据源
  customSource: '自定义',
  // 模拟事件标识
  simulated: '模拟',
};

/** 获取数据源完整显示名（含传输方式，用于 SourceStatusBar） */
export function getSourceName(source: SourceType): string {
  return SOURCE_NAMES[source] ?? source;
}

/** 获取机构简称（不含传输方式，用于卡片机构标签） */
export function getSourceAgency(source: SourceType): string {
  return SOURCE_AGENCY[source] ?? source;
}
