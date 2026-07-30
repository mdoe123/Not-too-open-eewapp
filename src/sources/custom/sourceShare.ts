// 自定义源分享/导入工具
//
// 提供源配置的导出、序列化、解析、校验、合并能力，用于社区分享场景。
// 纯函数模块，无副作用，便于单测。
//
// 合规设计：
// - 仅支持 customSource 类型源分享（wolfx 等内置源不分享）
// - 导出时默认剥离 authToken（敏感字段），用户需显式选择是否包含
// - 不执行用户代码，仅做 JSON schema 校验
//
// 分享包格式（SourceSharePack）：
// ```json
// {
//   "format": "eew-app-source-pack",
//   "version": 1,
//   "exportedAt": 1700000000000,
//   "exportedBy": "可选备注",
//   "sources": [ { ...SourceConfig } ]
// }
// ```
//
// 唯一标识：SourceConfig 使用 `endpoint` 作为去重键（同一 API 地址视为同一源的不同配置版本）。
// 合并导入时按 endpoint 判断冲突：同 endpoint 更新，不同 endpoint 追加；
// 追加时若 priority 与现有源冲突则重新分配一个未使用的值，避免覆盖其他无关源。
// 注意：priority 仅用于源排序（数字越小越优先），不作为唯一标识。

import {FieldMapping, SourceConfig} from '../../types/config';

/** 分享包标识 */
export const SHARE_PACK_FORMAT = 'eew-app-source-pack' as const;

/** 分享包版本 */
export const SHARE_PACK_VERSION = 1 as const;

/**
 * 分享包结构
 */
export interface SourceSharePack {
  format: typeof SHARE_PACK_FORMAT;
  version: typeof SHARE_PACK_VERSION;
  /** 导出时间 Unix 毫秒 */
  exportedAt: number;
  /** 导出者备注（可选） */
  exportedBy?: string;
  /** 源配置列表 */
  sources: SourceConfig[];
}

/**
 * 导出选项
 */
export interface ExportOptions {
  /** 是否包含 authToken（默认 false，敏感字段不导出） */
  includeAuth?: boolean;
  /** 导出者备注（可选） */
  exportedBy?: string;
  /** 导出时间戳（可选，默认 Date.now()） */
  exportedAt?: number;
}

/**
 * 校验结果（成功）
 */
export interface ValidateOk {
  ok: true;
  sources: SourceConfig[];
}

/**
 * 校验结果（失败）
 */
export interface ValidateErr {
  ok: false;
  errors: string[];
}

export type ValidateResult = ValidateOk | ValidateErr;

/**
 * 解析结果（成功）
 */
export interface ParseOk {
  ok: true;
  pack: SourceSharePack;
}

/**
 * 解析结果（失败）
 */
export interface ParseErr {
  ok: false;
  error: string;
}

export type ParseResult = ParseOk | ParseErr;

/**
 * 合并结果
 */
export interface MergeResult {
  /** 合并后的源列表 */
  merged: SourceConfig[];
  /** 新增数量（不同 endpoint，追加为新源） */
  added: number;
  /** 更新数量（同 endpoint，覆盖现有源配置） */
  updated: number;
  /** 重新分配 priority 的数量（新源 priority 与现有源冲突，已自动重新分配） */
  reassigned: number;
}

// ======================== 导出 ========================

/**
 * 导出源列表为分享包对象
 *
 * 默认剥离 authToken（敏感字段）。如需保留（如个人备份），设置 includeAuth=true。
 * 仅导出 type === 'customSource' 的源（simulated 等非 customSource 类型不分享）。
 *
 * @param sources 待导出的源列表
 * @param options 导出选项
 * @returns 分享包对象
 */
export function exportSources(
  sources: SourceConfig[],
  options: ExportOptions = {},
): SourceSharePack {
  const {includeAuth = false, exportedBy, exportedAt = Date.now()} = options;

  const shareable: SourceConfig[] = sources
    .filter(s => s.type === 'customSource')
    .map(s => {
      const cloned: SourceConfig = {...s};
      if (!includeAuth) {
        delete cloned.authToken;
      }
      // apiKey 也不导出（敏感）
      delete cloned.apiKey;
      return cloned;
    });

  return {
    format: SHARE_PACK_FORMAT,
    version: SHARE_PACK_VERSION,
    exportedAt,
    exportedBy,
    sources: shareable,
  };
}

/**
 * 序列化分享包为 JSON 字符串
 *
 * 紧凑格式（无缩进），便于生成二维码。
 *
 * @param pack 分享包对象
 * @returns JSON 字符串
 */
export function serializePack(pack: SourceSharePack): string {
  return JSON.stringify(pack);
}

// ======================== 解析 ========================

/**
 * 解析 JSON 字符串为分享包
 *
 * 容错策略：
 * - 非 JSON 字符串返回 ParseErr
 * - JSON 格式正确但 schema 不匹配（format/version 错误）返回 ParseErr
 * - 仅做最小校验（format/version/sources 字段存在），深度校验由 validatePack 完成
 *
 * @param json JSON 字符串
 * @returns 解析结果
 */
export function parsePack(json: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    return {ok: false, error: `JSON 解析失败: ${(e as Error).message}`};
  }

  if (typeof raw !== 'object' || raw === null) {
    return {ok: false, error: '顶层不是对象'};
  }

  const obj = raw as Record<string, unknown>;
  if (obj.format !== SHARE_PACK_FORMAT) {
    return {ok: false, error: `format 不匹配，期望 "${SHARE_PACK_FORMAT}"`};
  }
  if (obj.version !== SHARE_PACK_VERSION) {
    return {ok: false, error: `version 不匹配，期望 ${SHARE_PACK_VERSION}`};
  }
  if (!Array.isArray(obj.sources)) {
    return {ok: false, error: 'sources 不是数组'};
  }

  return {ok: true, pack: obj as unknown as SourceSharePack};
}

// ======================== 校验 ========================

/**
 * 校验分享包合法性
 *
 * 校验规则：
 * - format === 'eew-app-source-pack'
 * - version === 1
 * - sources 必须是数组，每个元素：
 *   - type === 'customSource'（仅支持自定义源分享）
 *   - name 非空字符串
 *   - category ∈ {'eew', 'eqlist'}
 *   - priority 是数字
 *   - enabled 是布尔
 *   - protocol ∈ {'ws', 'http'}
 *   - endpoint 是合法 URL（http/https/ws/wss）
 *   - fieldMapping 必填且必填字段齐全（eventId/originTime/magnitude/depth/lat/lng/location）
 *   - fieldMapping.listPath 可选
 *
 * @param pack 待校验的对象
 * @returns 校验结果
 */
export function validatePack(pack: unknown): ValidateResult {
  const errors: string[] = [];

  if (typeof pack !== 'object' || pack === null) {
    return {ok: false, errors: ['分享包不是对象']};
  }

  const obj = pack as Record<string, unknown>;
  if (obj.format !== SHARE_PACK_FORMAT) {
    errors.push(`format 必须为 "${SHARE_PACK_FORMAT}"`);
  }
  if (obj.version !== SHARE_PACK_VERSION) {
    errors.push(`version 必须为 ${SHARE_PACK_VERSION}`);
  }
  if (!Array.isArray(obj.sources)) {
    errors.push('sources 必须为数组');
    return {ok: false, errors};
  }

  const sources: SourceConfig[] = [];
  const seenPriorities = new Set<number>();

  obj.sources.forEach((raw, idx) => {
    const prefix = `sources[${idx}]`;
    const srcErrs = validateSource(raw, prefix);
    if (srcErrs.length > 0) {
      errors.push(...srcErrs);
      return;
    }
    const src = raw as SourceConfig;
    if (seenPriorities.has(src.priority)) {
      errors.push(`${prefix}: priority ${src.priority} 重复`);
      return;
    }
    seenPriorities.add(src.priority);
    sources.push(src);
  });

  if (errors.length > 0) {
    return {ok: false, errors};
  }
  return {ok: true, sources};
}

/**
 * 校验单个源配置
 */
function validateSource(raw: unknown, prefix: string): string[] {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    return [`${prefix}: 不是对象`];
  }

  const s = raw as Record<string, unknown>;

  // type
  if (s.type !== 'customSource') {
    errors.push(`${prefix}.type 必须为 "customSource"（仅支持自定义源分享）`);
  }

  // name
  if (typeof s.name !== 'string' || s.name.trim() === '') {
    errors.push(`${prefix}.name 必须为非空字符串`);
  }

  // category
  if (s.category !== 'eew' && s.category !== 'eqlist') {
    errors.push(`${prefix}.category 必须为 "eew" 或 "eqlist"`);
  }

  // priority
  if (typeof s.priority !== 'number' || !Number.isFinite(s.priority)) {
    errors.push(`${prefix}.priority 必须为数字`);
  }

  // enabled
  if (typeof s.enabled !== 'boolean') {
    errors.push(`${prefix}.enabled 必须为布尔`);
  }

  // protocol
  if (s.protocol !== 'ws' && s.protocol !== 'http') {
    errors.push(`${prefix}.protocol 必须为 "ws" 或 "http"`);
  }

  // endpoint
  if (typeof s.endpoint !== 'string' || !isValidEndpoint(s.endpoint)) {
    errors.push(`${prefix}.endpoint 必须为合法 URL（http/https/ws/wss 开头）`);
  }

  // fieldMapping
  if (typeof s.fieldMapping !== 'object' || s.fieldMapping === null) {
    errors.push(`${prefix}.fieldMapping 必须为对象`);
  } else {
    errors.push(...validateFieldMapping(s.fieldMapping, `${prefix}.fieldMapping`));
  }

  return errors;
}

/**
 * 校验字段映射
 */
function validateFieldMapping(raw: unknown, prefix: string): string[] {
  const errors: string[] = [];
  const m = raw as Record<string, unknown>;

  const requiredFields: Array<keyof FieldMapping> = [
    'eventId',
    'originTime',
    'magnitude',
    'depth',
    'lat',
    'lng',
    'location',
  ];

  for (const field of requiredFields) {
    if (typeof m[field] !== 'string' || (m[field] as string).trim() === '') {
      errors.push(`${prefix}.${field} 必须为非空字符串`);
    }
  }

  // listPath 可选，但若提供必须是非空字符串
  if (m.listPath !== undefined) {
    if (typeof m.listPath !== 'string' || m.listPath.trim() === '') {
      errors.push(`${prefix}.listPath 必须为非空字符串（或省略）`);
    }
  }

  // 可选字段（intensity/isFinal/isCancel）若提供必须是非空字符串
  const optionalFields: Array<keyof FieldMapping> = ['intensity', 'isFinal', 'isCancel'];
  for (const field of optionalFields) {
    if (m[field] !== undefined) {
      if (typeof m[field] !== 'string' || (m[field] as string).trim() === '') {
        errors.push(`${prefix}.${field} 必须为非空字符串（或省略）`);
      }
    }
  }

  return errors;
}

/**
 * 校验 endpoint URL 合法性
 *
 * 允许的协议：http、https、ws、wss
 */
export function isValidEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

// ======================== 合并 ========================

/**
 * 自定义源起始 priority（避开 wolfx 源的 1-15 区间）
 *
 * 与 SourceManageSection.CUSTOM_SOURCE_START_PRIORITY 保持一致。
 */
const MERGE_START_PRIORITY = 100;

/**
 * 找一个未使用的 priority 值
 *
 * 策略：从 MERGE_START_PRIORITY 开始递增，找到第一个未使用的值。
 * 用于导入新源时 priority 与现有源冲突的重新分配。
 */
function nextAvailablePriority(used: Set<number>): number {
  let p = MERGE_START_PRIORITY;
  while (used.has(p)) {
    p++;
  }
  return p;
}

/**
 * 合并导入的源到现有源列表
 *
 * 策略：按 endpoint 去重（大小写不敏感），同 endpoint 视为同一源进行更新，
 * 不同 endpoint 视为新源追加。若新源的 priority 与现有源冲突，重新分配
 * 一个未使用的 priority，避免覆盖其他无关源。
 *
 * 设计理由：
 * - 之前按 priority 去重会导致"导入测试源覆盖真实源"——只要 priority 相同就覆盖，
 *   不管 endpoint 是否不同。改为 endpoint 去重后，同 API 地址才视为同一源。
 * - priority 冲突时重新分配，保留用户导入源的字段映射等配置，仅调整排序值。
 *
 * 安全设计：
 * - 导入的源强制 enabled=false（即使用户分享包中 enabled=true），需手动启用
 * - 同 endpoint 更新时同样强制 enabled=false（覆盖后需重新启用，确保用户主动确认）
 *
 * @param existing 现有源列表
 * @param imported 待导入的源列表（已通过 validatePack 校验）
 * @returns 合并结果
 */
export function mergeImported(
  existing: SourceConfig[],
  imported: SourceConfig[],
): MergeResult {
  // 用 endpoint（小写）作为去重键，同 endpoint 视为同一源
  const endpointMap = new Map<string, SourceConfig>();
  // 用 priority 集合检测冲突，便于为新源重新分配
  const usedPriorities = new Set<number>();
  // 最终合并后的列表（mutable，便于同 endpoint 时原地替换）
  const merged: SourceConfig[] = [];

  // 先放入现有源
  for (const s of existing) {
    const key = (s.endpoint ?? '').toLowerCase();
    // 若 existing 本身有同 endpoint 重复（异常数据），保留最后一个
    endpointMap.set(key, s);
    usedPriorities.add(s.priority);
    merged.push(s);
  }

  let added = 0;
  let updated = 0;
  let reassigned = 0;

  // 合并导入源（安全设计：导入的源默认禁用，用户手动启用）
  for (const s of imported) {
    const key = (s.endpoint ?? '').toLowerCase();
    const safeSource: SourceConfig = {...s, enabled: false};

    if (endpointMap.has(key)) {
      // 同 endpoint：更新该源（保留旧 priority 避免破坏用户排序）
      const old = endpointMap.get(key)!;
      const reassignedSource = {...safeSource, priority: old.priority};
      // 替换 merged 中的旧源（用引用比较定位）
      const idx = merged.findIndex(m => m === old);
      if (idx >= 0) {
        merged[idx] = reassignedSource;
      } else {
        // 兜底：按 endpoint 再找一次（防御性编程）
        const idxByEndpoint = merged.findIndex(
          m => (m.endpoint ?? '').toLowerCase() === key,
        );
        if (idxByEndpoint >= 0) {
          merged[idxByEndpoint] = reassignedSource;
        } else {
          merged.push(reassignedSource);
        }
      }
      endpointMap.set(key, reassignedSource);
      updated++;
    } else {
      // 新源：若 priority 冲突则重新分配
      if (usedPriorities.has(s.priority)) {
        const newPriority = nextAvailablePriority(usedPriorities);
        safeSource.priority = newPriority;
        usedPriorities.add(newPriority);
        reassigned++;
      } else {
        usedPriorities.add(s.priority);
      }
      endpointMap.set(key, safeSource);
      merged.push(safeSource);
      added++;
    }
  }

  // 按 priority 升序
  merged.sort((a, b) => a.priority - b.priority);

  return {merged, added, updated, reassigned};
}

// ======================== 便捷工具 ========================

/**
 * 从 JSON 字符串一键导入（解析 + 校验 + 合并）
 *
 * 失败时返回 errors 数组，成功时返回合并结果。
 *
 * @param json JSON 字符串
 * @param existing 现有源列表
 * @returns 成功：{ok:true, ...MergeResult}；失败：{ok:false, errors}
 */
export function importFromJson(
  json: string,
  existing: SourceConfig[],
): {ok: true; merged: SourceConfig[]; added: number; updated: number; reassigned: number}
  | {ok: false; errors: string[]} {
  const parsed = parsePack(json);
  if (!parsed.ok) {
    return {ok: false, errors: [parsed.error]};
  }

  const validated = validatePack(parsed.pack);
  if (!validated.ok) {
    return {ok: false, errors: validated.errors};
  }

  const result = mergeImported(existing, validated.sources);
  return {
    ok: true,
    merged: result.merged,
    added: result.added,
    updated: result.updated,
    reassigned: result.reassigned,
  };
}

// ======================== 分块传输（QR Chunking 协议） ========================

/**
 * 分块包格式标识
 *
 * 用于 QR 码分块传输场景：当分享包 JSON >2000 字符时，切分为多个 chunk，
 * 每个 chunk 生成一个二维码，接收方依次扫描后拼接还原。
 *
 * 与 SHARE_PACK_FORMAT（'eew-app-source-pack'）的区别：
 * - SHARE_PACK_FORMAT 是业务层格式（完整的源配置包）
 * - CHUNKED_PACK_FORMAT 是传输层格式（分块包装）
 */
export const CHUNKED_PACK_FORMAT = 'eew-app-source-pack-chunked' as const;

/**
 * 单块最大字节数
 *
 * 选择 1500 的理由：
 * - 单 QR 码容量约 2953 字节，但扫码成功率随密度增加而下降
 * - ExportSourceModal 警告阈值 2000 字符
 * - 留余量给 chunk wrapper JSON + base64 膨胀 33%
 * - 实际单块 payload 约 1100 字符
 */
export const MAX_CHUNK_BYTES = 1500;

/**
 * 分块包装结构
 *
 * 每个 chunk 对应一个二维码，接收方按 chunkIndex 累积 payload，
 * 收齐全部 chunks 后按 chunkIndex 顺序拼接，校验 totalBytes 后还原原始 JSON。
 */
export interface SourceShareChunk {
  format: typeof CHUNKED_PACK_FORMAT;
  version: 1;
  /** 总块数 */
  totalChunks: number;
  /** 当前块索引（0-based） */
  chunkIndex: number;
  /** 原始 JSON 总字节数（用于校验拼接完整性） */
  totalBytes: number;
  /** payload 长度（简单校验，避免引入 crypto 模块） */
  chunkHash: string;
  /** 当前块的 payload（原始 JSON 的子串，未编码） */
  payload: string;
}

/**
 * 将分享包 JSON 切分为多个 chunk
 *
 * @param json 原始分享包 JSON 字符串
 * @returns chunk 数组（按 chunkIndex 升序）
 */
export function chunkPack(json: string): SourceShareChunk[] {
  const totalBytes = json.length;
  const totalChunks = Math.ceil(totalBytes / MAX_CHUNK_BYTES);
  const chunks: SourceShareChunk[] = [];
  for (let i = 0; i < totalChunks; i++) {
    const payload = json.slice(i * MAX_CHUNK_BYTES, (i + 1) * MAX_CHUNK_BYTES);
    chunks.push({
      format: CHUNKED_PACK_FORMAT,
      version: 1,
      totalChunks,
      chunkIndex: i,
      totalBytes,
      chunkHash: String(payload.length),
      payload,
    });
  }
  return chunks;
}

/**
 * 从多个 chunk 还原原始 JSON
 *
 * 校验规则：
 * 1. chunks 非空
 * 2. 所有 chunk 的 totalChunks 一致
 * 3. chunkIndex 0..totalChunks-1 全部存在
 * 4. 每个 chunk 的 chunkHash（payload.length）匹配
 * 5. 拼接后的总长度 === totalBytes
 *
 * @param chunks chunk 数组（顺序可乱）
 * @returns 成功：{ok: true, json}；失败：{ok: false, error}
 */
export function assembleChunks(chunks: SourceShareChunk[]):
  | {ok: true; json: string}
  | {ok: false; error: string} {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {ok: false, error: 'chunks 为空'};
  }

  // 校验 format
  for (const chunk of chunks) {
    if (chunk.format !== CHUNKED_PACK_FORMAT) {
      return {ok: false, error: `format 不匹配，期望 "${CHUNKED_PACK_FORMAT}"`};
    }
    if (chunk.version !== 1) {
      return {ok: false, error: `version 不匹配，期望 1`};
    }
  }

  const totalChunks = chunks[0].totalChunks;
  const totalBytes = chunks[0].totalBytes;

  // 校验所有 chunk 的 totalChunks / totalBytes 一致
  for (const chunk of chunks) {
    if (chunk.totalChunks !== totalChunks) {
      return {ok: false, error: 'totalChunks 不一致'};
    }
    if (chunk.totalBytes !== totalBytes) {
      return {ok: false, error: 'totalBytes 不一致'};
    }
  }

  // 校验 chunkIndex 0..totalChunks-1 全部存在
  const chunkMap = new Map<number, SourceShareChunk>();
  for (const chunk of chunks) {
    if (chunk.chunkIndex < 0 || chunk.chunkIndex >= totalChunks) {
      return {ok: false, error: `chunkIndex ${chunk.chunkIndex} 越界（总 ${totalChunks} 块）`};
    }
    // 重复扫码时覆盖旧值（避免重复扫码干扰）
    chunkMap.set(chunk.chunkIndex, chunk);
  }
  if (chunkMap.size !== totalChunks) {
    return {ok: false, error: `缺失块：期望 ${totalChunks} 块，实际 ${chunkMap.size} 块`};
  }

  // 按 chunkIndex 顺序拼接 payload
  let assembled = '';
  for (let i = 0; i < totalChunks; i++) {
    const chunk = chunkMap.get(i)!;
    // 校验 chunkHash（payload.length）
    if (chunk.chunkHash !== String(chunk.payload.length)) {
      return {ok: false, error: `第 ${i} 块 chunkHash 校验失败`};
    }
    assembled += chunk.payload;
  }

  // 校验总长度
  if (assembled.length !== totalBytes) {
    return {ok: false, error: `总长度不匹配：期望 ${totalBytes}，实际 ${assembled.length}`};
  }

  return {ok: true, json: assembled};
}
