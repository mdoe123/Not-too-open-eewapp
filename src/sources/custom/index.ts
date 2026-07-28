// 自定义数据源工厂
//
// 提供 createCustomSourceAdapter 工厂函数，由 useEewStream 统一调度。
// 当 SourceConfig.type === 'customSource' 时创建 CustomSourceAdapter，否则返回 null。
//
// 合规设计：本工厂仅创建适配器实例，不内置任何 URL 或字段映射。
// 所有配置由用户通过 CustomSourceEditor 自行填写，App 不预填任何源。

import {SourceConfig} from '../../types';
import {SourceAdapter} from '../SourceAdapter';
import {CustomSourceAdapter} from './CustomSourceAdapter';

/**
 * 创建自定义数据源适配器
 *
 * @param config 数据源配置（type 必须为 'customSource'）
 * @returns 适配器实例；配置不完整或类型不匹配时返回 null
 *
 * 校验：
 * - type 必须为 'customSource'
 * - endpoint（URL）必填
 * - protocol（'ws' | 'http'）必填
 * - fieldMapping（字段映射规则）必填
 */
export function createCustomSourceAdapter(config: SourceConfig): SourceAdapter | null {
  if (config.type !== 'customSource') {
    return null;
  }
  // 必填字段校验，缺失任一返回 null（useEewStream 会 log 并跳过）
  if (!config.endpoint) {
    return null;
  }
  if (config.protocol !== 'ws' && config.protocol !== 'http') {
    return null;
  }
  if (!config.fieldMapping) {
    return null;
  }
  return new CustomSourceAdapter(config);
}
