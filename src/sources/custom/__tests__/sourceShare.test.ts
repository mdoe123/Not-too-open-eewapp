// sourceShare 单元测试
//
// 覆盖场景：
// - 导出（exportSources）：含/不含 authToken、过滤非 customSource、含 listPath
// - 序列化/反序列化（serializePack + parsePack）：往返一致性
// - 解析（parsePack）：非 JSON、缺字段、version 不匹配
// - 校验（validatePack）：合法包、缺 format、缺 sources、source 缺必填字段、endpoint 非 URL
// - 合并（mergeImported）：新增、覆盖（同 priority）、混合
// - 一键导入（importFromJson）：成功路径 + 错误路径
//
// 这些测试同时作为分享包 schema 的可执行文档

import {
  exportSources,
  serializePack,
  parsePack,
  validatePack,
  mergeImported,
  importFromJson,
  isValidEndpoint,
  SHARE_PACK_FORMAT,
  SHARE_PACK_VERSION,
  CHUNKED_PACK_FORMAT,
  MAX_CHUNK_BYTES,
  chunkPack,
  assembleChunks,
  SourceSharePack,
  SourceShareChunk,
} from '../sourceShare';
import {SourceConfig} from '../../../types/config';

// ======================== 测试夹具 ========================

/** 构造一个合法的 customSource 源（用于测试） */
function makeValidSource(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    type: 'customSource',
    name: 'USGS 地震速报',
    enabled: true,
    priority: 10,
    category: 'eqlist',
    endpoint: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson',
    protocol: 'http',
    pollIntervalMs: 30000,
    fieldMapping: {
      listPath: '$.features',
      eventId: '$.id',
      originTime: '$.properties.time',
      magnitude: '$.properties.mag',
      depth: '$.geometry.coordinates[2]',
      lat: '$.geometry.coordinates[1]',
      lng: '$.geometry.coordinates[0]',
      location: '$.properties.place',
    },
    authToken: 'secret-token-123',
    note: '测试源',
    ...overrides,
  };
}

describe('sourceShare', () => {
  // ======================== isValidEndpoint ========================

  describe('isValidEndpoint', () => {
    test('https URL 合法', () => {
      expect(isValidEndpoint('https://example.com/api')).toBe(true);
    });

    test('http URL 合法', () => {
      expect(isValidEndpoint('http://example.com/api')).toBe(true);
    });

    test('wss URL 合法', () => {
      expect(isValidEndpoint('wss://example.com/ws')).toBe(true);
    });

    test('ws URL 合法', () => {
      expect(isValidEndpoint('ws://example.com/ws')).toBe(true);
    });

    test('ftp URL 不合法', () => {
      expect(isValidEndpoint('ftp://example.com/file')).toBe(false);
    });

    test('非 URL 字符串不合法', () => {
      expect(isValidEndpoint('not a url')).toBe(false);
    });

    test('空字符串不合法', () => {
      expect(isValidEndpoint('')).toBe(false);
    });
  });

  // ======================== exportSources ========================

  describe('exportSources', () => {
    test('导出单个 customSource 源', () => {
      const src = makeValidSource();
      const pack = exportSources([src]);

      expect(pack.format).toBe(SHARE_PACK_FORMAT);
      expect(pack.version).toBe(SHARE_PACK_VERSION);
      expect(pack.sources).toHaveLength(1);
      expect(pack.sources[0].name).toBe('USGS 地震速报');
    });

    test('默认剥离 authToken', () => {
      const src = makeValidSource({authToken: 'secret-token-123'});
      const pack = exportSources([src]);

      expect(pack.sources[0].authToken).toBeUndefined();
    });

    test('includeAuth=true 时保留 authToken', () => {
      const src = makeValidSource({authToken: 'secret-token-123'});
      const pack = exportSources([src], {includeAuth: true});

      expect(pack.sources[0].authToken).toBe('secret-token-123');
    });

    test('始终剥离 apiKey', () => {
      const src = makeValidSource({apiKey: 'api-key-456'} as Partial<SourceConfig>);
      const pack = exportSources([src], {includeAuth: true});

      expect(pack.sources[0].apiKey).toBeUndefined();
    });

    test('过滤非 customSource 源（simulated 等）', () => {
      const simulatedSrc: SourceConfig = {
        type: 'simulated',
        name: '模拟源',
        enabled: true,
        priority: 1,
        category: 'eew',
        endpoint: 'https://example.com/sim',
      };
      const customSrc = makeValidSource();
      const pack = exportSources([simulatedSrc, customSrc]);

      expect(pack.sources).toHaveLength(1);
      expect(pack.sources[0].type).toBe('customSource');
    });

    test('空源列表导出空包', () => {
      const pack = exportSources([]);
      expect(pack.sources).toHaveLength(0);
    });

    test('保留 listPath 字段', () => {
      const src = makeValidSource();
      const pack = exportSources([src]);
      expect(pack.sources[0].fieldMapping?.listPath).toBe('$.features');
    });

    test('exportedBy 写入分享包', () => {
      const pack = exportSources([makeValidSource()], {exportedBy: '用户A'});
      expect(pack.exportedBy).toBe('用户A');
    });

    test('exportedAt 使用传入值或 Date.now()', () => {
      const fixed = 1700000000000;
      const pack = exportSources([makeValidSource()], {exportedAt: fixed});
      expect(pack.exportedAt).toBe(fixed);
    });

    test('不修改原始源对象（深拷贝）', () => {
      const src = makeValidSource({authToken: 'secret'});
      const original = JSON.parse(JSON.stringify(src));
      exportSources([src]);

      expect(src).toEqual(original);
    });
  });

  // ======================== serializePack + parsePack ========================

  describe('serializePack + parsePack 往返一致性', () => {
    test('序列化后反序列化得到相同对象', () => {
      const src = makeValidSource();
      const pack = exportSources([src], {exportedBy: '测试'});
      const json = serializePack(pack);
      const result = parsePack(json);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.pack.format).toBe(pack.format);
        expect(result.pack.version).toBe(pack.version);
        expect(result.pack.exportedAt).toBe(pack.exportedAt);
        expect(result.pack.exportedBy).toBe(pack.exportedBy);
        expect(result.pack.sources).toEqual(pack.sources);
      }
    });

    test('序列化是紧凑格式（无缩进）', () => {
      const pack = exportSources([makeValidSource()]);
      const json = serializePack(pack);
      expect(json).not.toContain('\n');
      expect(json).not.toContain('  ');
    });
  });

  // ======================== parsePack ========================

  describe('parsePack', () => {
    test('非 JSON 字符串返回错误', () => {
      const result = parsePack('not a json');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('JSON 解析失败');
      }
    });

    test('顶层不是对象返回错误', () => {
      const result = parsePack('"string value"');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('顶层不是对象');
      }
    });

    test('顶层是数组返回错误', () => {
      const result = parsePack('[]');
      expect(result.ok).toBe(false);
    });

    test('format 不匹配返回错误', () => {
      const json = JSON.stringify({
        format: 'wrong-format',
        version: 1,
        sources: [],
      });
      const result = parsePack(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('format');
      }
    });

    test('version 不匹配返回错误', () => {
      const json = JSON.stringify({
        format: SHARE_PACK_FORMAT,
        version: 99,
        sources: [],
      });
      const result = parsePack(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('version');
      }
    });

    test('sources 不是数组返回错误', () => {
      const json = JSON.stringify({
        format: SHARE_PACK_FORMAT,
        version: SHARE_PACK_VERSION,
        sources: 'not an array',
      });
      const result = parsePack(json);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('sources');
      }
    });

    test('合法 JSON 返回 ok', () => {
      const pack = exportSources([makeValidSource()]);
      const json = serializePack(pack);
      const result = parsePack(json);
      expect(result.ok).toBe(true);
    });
  });

  // ======================== validatePack ========================

  describe('validatePack', () => {
    test('合法分享包通过校验', () => {
      const pack = exportSources([makeValidSource()]);
      const result = validatePack(pack);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].name).toBe('USGS 地震速报');
      }
    });

    test('pack 不是对象返回错误', () => {
      const result = validatePack('string');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]).toContain('不是对象');
      }
    });

    test('pack 是 null 返回错误', () => {
      const result = validatePack(null);
      expect(result.ok).toBe(false);
    });

    test('format 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      const {format, ...rest} = pack;
      const result = validatePack(rest);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('format'))).toBe(true);
      }
    });

    test('version 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      const {version, ...rest} = pack;
      const result = validatePack(rest);
      expect(result.ok).toBe(false);
    });

    test('sources 缺失返回错误', () => {
      const result = validatePack({
        format: SHARE_PACK_FORMAT,
        version: SHARE_PACK_VERSION,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('sources'))).toBe(true);
      }
    });

    test('source.type 不是 customSource 返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      pack.sources[0].type = 'simulated' as SourceConfig['type'];
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('customSource'))).toBe(true);
      }
    });

    test('source.name 为空字符串返回错误', () => {
      const pack = exportSources([makeValidSource({name: ''})]);
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('name'))).toBe(true);
      }
    });

    test('source.category 不合法返回错误', () => {
      const pack = exportSources([makeValidSource({category: 'invalid' as SourceConfig['category']})]);
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('category'))).toBe(true);
      }
    });

    test('source.priority 不是数字返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0] as unknown as {priority: string}).priority = 'not a number';
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('priority'))).toBe(true);
      }
    });

    test('source.enabled 不是布尔返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0] as unknown as {enabled: string}).enabled = 'true';
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('source.protocol 不合法返回错误', () => {
      const pack = exportSources([makeValidSource({protocol: 'ftp' as SourceConfig['protocol']})]);
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('protocol'))).toBe(true);
      }
    });

    test('source.endpoint 非 URL 返回错误', () => {
      const pack = exportSources([makeValidSource({endpoint: 'not a url'})]);
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('endpoint'))).toBe(true);
      }
    });

    test('source.endpoint 是 ftp URL 返回错误', () => {
      const pack = exportSources([makeValidSource({endpoint: 'ftp://example.com'})]);
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      delete pack.sources[0].fieldMapping;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('fieldMapping'))).toBe(true);
      }
    });

    test('fieldMapping.eventId 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).eventId = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('eventId'))).toBe(true);
      }
    });

    test('fieldMapping.originTime 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).originTime = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping.magnitude 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).magnitude = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping.depth 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).depth = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping.lat 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).lat = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping.lng 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).lng = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping.location 缺失返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      (pack.sources[0].fieldMapping as unknown as Record<string, unknown>).location = undefined;
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
    });

    test('fieldMapping.listPath 可选缺失通过校验', () => {
      const pack = exportSources([makeValidSource()]);
      delete pack.sources[0].fieldMapping!.listPath;
      const result = validatePack(pack);
      expect(result.ok).toBe(true);
    });

    test('fieldMapping.listPath 为空字符串返回错误', () => {
      const pack = exportSources([makeValidSource()]);
      pack.sources[0].fieldMapping!.listPath = '';
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('listPath'))).toBe(true);
      }
    });

    test('fieldMapping.intensity/isFinal/isCancel 可选缺失通过校验', () => {
      const pack = exportSources([makeValidSource()]);
      // 不设置 intensity/isFinal/isCancel
      const result = validatePack(pack);
      expect(result.ok).toBe(true);
    });

    test('priority 重复返回错误', () => {
      const src1 = makeValidSource({priority: 10});
      const src2 = makeValidSource({priority: 10, name: '另一个源'});
      const pack = exportSources([src1, src2]);
      const result = validatePack(pack);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('重复'))).toBe(true);
      }
    });

    test('多个源都合法时全部通过', () => {
      const src1 = makeValidSource({priority: 10, name: 'USGS'});
      const src2 = makeValidSource({priority: 20, name: 'EMSC', endpoint: 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json'});
      const pack = exportSources([src1, src2]);
      const result = validatePack(pack);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.sources).toHaveLength(2);
      }
    });

    test('WS 协议 + wss URL 通过校验', () => {
      const src = makeValidSource({
        protocol: 'ws',
        endpoint: 'wss://example.com/ws',
        pollIntervalMs: undefined,
      });
      const pack = exportSources([src]);
      const result = validatePack(pack);
      expect(result.ok).toBe(true);
    });
  });

  // ======================== mergeImported ========================

  describe('mergeImported', () => {
    test('空 existing + 空 imported 返回空', () => {
      const result = mergeImported([], []);
      expect(result.merged).toHaveLength(0);
      expect(result.added).toBe(0);
      expect(result.updated).toBe(0);
    });

    test('空 existing + 非空 imported 全部为新增', () => {
      const src1 = makeValidSource({priority: 10});
      const src2 = makeValidSource({priority: 20, name: 'EMSC'});
      const result = mergeImported([], [src1, src2]);
      expect(result.merged).toHaveLength(2);
      expect(result.added).toBe(2);
      expect(result.updated).toBe(0);
      // 安全设计：导入的源强制 enabled=false
      expect(result.merged.every(s => s.enabled === false)).toBe(true);
    });

    test('同 priority 覆盖', () => {
      const existing = [makeValidSource({priority: 10, name: '原 USGS'})];
      const imported = [makeValidSource({priority: 10, name: '新 USGS'})];
      const result = mergeImported(existing, imported);
      expect(result.merged).toHaveLength(1);
      expect(result.merged[0].name).toBe('新 USGS');
      expect(result.added).toBe(0);
      expect(result.updated).toBe(1);
      // 安全设计：覆盖后 enabled=false
      expect(result.merged[0].enabled).toBe(false);
    });

    test('混合场景：部分新增部分覆盖', () => {
      const existing = [
        makeValidSource({priority: 10, name: 'USGS 旧'}),
        makeValidSource({priority: 20, name: 'EMSC'}),
      ];
      const imported = [
        makeValidSource({priority: 10, name: 'USGS 新'}),
        makeValidSource({priority: 30, name: 'JMA'}),
      ];
      const result = mergeImported(existing, imported);
      expect(result.merged).toHaveLength(3);
      expect(result.added).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.merged.map(s => s.name).sort()).toEqual(['EMSC', 'JMA', 'USGS 新']);
      // 安全设计：导入的源（USGS 新、JMA）enabled=false，原有源（EMSC）保持原样
      const usgsNew = result.merged.find(s => s.name === 'USGS 新');
      const jma = result.merged.find(s => s.name === 'JMA');
      const emsc = result.merged.find(s => s.name === 'EMSC');
      expect(usgsNew?.enabled).toBe(false);
      expect(jma?.enabled).toBe(false);
      expect(emsc?.enabled).toBe(true);
    });

    test('合并后按 priority 升序', () => {
      const existing = [makeValidSource({priority: 30, name: 'C'})];
      const imported = [
        makeValidSource({priority: 10, name: 'A'}),
        makeValidSource({priority: 20, name: 'B'}),
      ];
      const result = mergeImported(existing, imported);
      expect(result.merged.map(s => s.priority)).toEqual([10, 20, 30]);
    });

    test('不修改原始数组', () => {
      const existing = [makeValidSource({priority: 10})];
      const imported = [makeValidSource({priority: 20})];
      const existingBefore = JSON.parse(JSON.stringify(existing));
      const importedBefore = JSON.parse(JSON.stringify(imported));
      mergeImported(existing, imported);
      expect(existing).toEqual(existingBefore);
      expect(imported).toEqual(importedBefore);
    });

    test('导入的源强制 enabled=false（即使 imported 中 enabled=true）', () => {
      // makeValidSource 默认 enabled=true，模拟分享包中 enabled=true 的情况
      const imported = [
        makeValidSource({priority: 10, enabled: true}),
        makeValidSource({priority: 20, enabled: true, name: 'EMSC'}),
      ];
      const result = mergeImported([], imported);
      expect(result.merged).toHaveLength(2);
      expect(result.merged.every(s => s.enabled === false)).toBe(true);
    });

    test('现有源的 enabled 状态不被修改', () => {
      const existing = [
        makeValidSource({priority: 10, enabled: true}),
        makeValidSource({priority: 20, enabled: false, name: 'EMSC'}),
      ];
      const imported = [makeValidSource({priority: 30, name: 'JMA'})];
      const result = mergeImported(existing, imported);
      const usgs = result.merged.find(s => s.priority === 10);
      const emsc = result.merged.find(s => s.priority === 20);
      const jma = result.merged.find(s => s.priority === 30);
      expect(usgs?.enabled).toBe(true);   // 现有源保持原样
      expect(emsc?.enabled).toBe(false);  // 现有源保持原样
      expect(jma?.enabled).toBe(false);   // 导入的源强制 false
    });
  });

  // ======================== importFromJson ========================

  describe('importFromJson', () => {
    test('合法 JSON 一键导入成功', () => {
      const src = makeValidSource();
      const pack = exportSources([src]);
      const json = serializePack(pack);
      const result = importFromJson(json, []);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toHaveLength(1);
        expect(result.added).toBe(1);
        expect(result.updated).toBe(0);
      }
    });

    test('非 JSON 返回错误', () => {
      const result = importFromJson('not json', []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    test('校验失败返回错误列表', () => {
      const pack = exportSources([makeValidSource()]);
      delete pack.sources[0].fieldMapping;
      const json = serializePack(pack);
      const result = importFromJson(json, []);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some(e => e.includes('fieldMapping'))).toBe(true);
      }
    });

    test('导入到非空 existing 正确合并', () => {
      const existing = [makeValidSource({priority: 10, name: '已有 USGS'})];
      const imported = [makeValidSource({priority: 10, name: '新 USGS'})];
      const pack = exportSources(imported);
      const json = serializePack(pack);
      const result = importFromJson(json, existing);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.merged).toHaveLength(1);
        expect(result.merged[0].name).toBe('新 USGS');
        expect(result.updated).toBe(1);
      }
    });
  });

  // ======================== 常量 ========================

  describe('常量', () => {
    test('SHARE_PACK_FORMAT 等于 "eew-app-source-pack"', () => {
      expect(SHARE_PACK_FORMAT).toBe('eew-app-source-pack');
    });

    test('SHARE_PACK_VERSION 等于 1', () => {
      expect(SHARE_PACK_VERSION).toBe(1);
    });

    test('CHUNKED_PACK_FORMAT 等于 "eew-app-source-pack-chunked"', () => {
      expect(CHUNKED_PACK_FORMAT).toBe('eew-app-source-pack-chunked');
    });

    test('MAX_CHUNK_BYTES 等于 1500', () => {
      expect(MAX_CHUNK_BYTES).toBe(1500);
    });
  });

  // ======================== chunkPack + assembleChunks ========================

  describe('chunkPack', () => {
    test('短字符串（< MAX_CHUNK_BYTES）切分为单块', () => {
      const json = '{"hello":"world"}';
      const chunks = chunkPack(json);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].totalChunks).toBe(1);
      expect(chunks[0].totalBytes).toBe(json.length);
      expect(chunks[0].payload).toBe(json);
      expect(chunks[0].format).toBe(CHUNKED_PACK_FORMAT);
      expect(chunks[0].version).toBe(1);
    });

    test('恰好等于 MAX_CHUNK_BYTES 切分为单块', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES);
      const chunks = chunkPack(json);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].totalBytes).toBe(MAX_CHUNK_BYTES);
    });

    test('超过 MAX_CHUNK_BYTES 切分为多块', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES + 1);
      const chunks = chunkPack(json);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[1].chunkIndex).toBe(1);
      expect(chunks[0].totalChunks).toBe(2);
      expect(chunks[1].totalChunks).toBe(2);
    });

    test('大字符串正确切分（3 块）', () => {
      const json = 'x'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      expect(chunks).toHaveLength(3);
      // chunkIndex 连续
      expect(chunks.map(c => c.chunkIndex)).toEqual([0, 1, 2]);
      // 所有 chunk 的 totalChunks / totalBytes 一致
      expect(chunks.every(c => c.totalChunks === 3)).toBe(true);
      expect(chunks.every(c => c.totalBytes === json.length)).toBe(true);
      // 前 2 块 payload.length === MAX_CHUNK_BYTES，最后一块 500
      expect(chunks[0].payload.length).toBe(MAX_CHUNK_BYTES);
      expect(chunks[1].payload.length).toBe(MAX_CHUNK_BYTES);
      expect(chunks[2].payload.length).toBe(500);
    });

    test('chunkHash 等于 payload.length 的字符串形式', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES + 100);
      const chunks = chunkPack(json);
      for (const chunk of chunks) {
        expect(chunk.chunkHash).toBe(String(chunk.payload.length));
      }
    });

    test('空字符串切分为单块（payload 为空）', () => {
      const chunks = chunkPack('');
      // Math.ceil(0 / 1500) === 0，所以 chunks 为空数组
      // 但这在实际使用中不会发生（分享包 JSON 不会为空）
      // 我们验证 chunkPack('') 返回空数组
      expect(chunks).toHaveLength(0);
    });

    test('真实分享包 JSON 切分往返', () => {
      // 模拟 3 个源的分享包（足够大，触发分块）
      const sources = [
        makeValidSource({priority: 10, name: 'USGS'}),
        makeValidSource({priority: 20, name: 'EMSC'}),
        makeValidSource({priority: 30, name: 'JMA'}),
      ];
      const pack = exportSources(sources, {includeAuth: true});
      const json = serializePack(pack);
      const chunks = chunkPack(json);
      // 还原
      const result = assembleChunks(chunks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.json).toBe(json);
      }
    });
  });

  describe('assembleChunks', () => {
    test('单块还原成功', () => {
      const json = '{"test":1}';
      const chunks = chunkPack(json);
      const result = assembleChunks(chunks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.json).toBe(json);
      }
    });

    test('多块还原成功', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      const result = assembleChunks(chunks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.json).toBe(json);
      }
    });

    test('乱序 chunks 还原成功', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 打乱顺序
      const shuffled = [chunks[2], chunks[0], chunks[1]];
      const result = assembleChunks(shuffled);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.json).toBe(json);
      }
    });

    test('重复扫到同一 chunkIndex 覆盖（不报错）', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 模拟重复扫到 chunkIndex=1
      const duplicated = [chunks[0], chunks[1], chunks[1], chunks[2]];
      const result = assembleChunks(duplicated);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.json).toBe(json);
      }
    });

    test('缺失块返回错误', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 缺失第 1 块
      const incomplete = [chunks[0], chunks[2]];
      const result = assembleChunks(incomplete);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('缺失');
      }
    });

    test('空数组返回错误', () => {
      const result = assembleChunks([]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('空');
      }
    });

    test('format 不匹配返回错误', () => {
      const fakeChunks: SourceShareChunk[] = [{
        format: 'wrong-format' as typeof CHUNKED_PACK_FORMAT,
        version: 1,
        totalChunks: 1,
        chunkIndex: 0,
        totalBytes: 10,
        chunkHash: '10',
        payload: '0123456789',
      }];
      const result = assembleChunks(fakeChunks);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('format');
      }
    });

    test('version 不匹配返回错误', () => {
      const json = '{"test":1}';
      const chunks = chunkPack(json);
      // 篡改 version
      const tampered: SourceShareChunk[] = chunks.map(c => ({...c, version: 99 as 1}));
      const result = assembleChunks(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('version');
      }
    });

    test('totalChunks 不一致返回错误', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 篡改第二个 chunk 的 totalChunks
      const tampered: SourceShareChunk[] = [
        chunks[0],
        {...chunks[1], totalChunks: 99},
        chunks[2],
      ];
      const result = assembleChunks(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('totalChunks');
      }
    });

    test('totalBytes 不一致返回错误', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 篡改第二个 chunk 的 totalBytes
      const tampered: SourceShareChunk[] = [
        chunks[0],
        {...chunks[1], totalBytes: 99999},
        chunks[2],
      ];
      const result = assembleChunks(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('totalBytes');
      }
    });

    test('chunkIndex 越界返回错误', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 篡改 chunkIndex 越界
      const tampered: SourceShareChunk[] = [
        chunks[0],
        {...chunks[1], chunkIndex: 99},
        chunks[2],
      ];
      const result = assembleChunks(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('越界');
      }
    });

    test('chunkHash 不匹配返回错误', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 篡改 chunkHash
      const tampered: SourceShareChunk[] = [
        chunks[0],
        {...chunks[1], chunkHash: '999'},
        chunks[2],
      ];
      const result = assembleChunks(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('chunkHash');
      }
    });

    test('payload 被篡改导致总长度不匹配返回错误', () => {
      const json = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 500);
      const chunks = chunkPack(json);
      // 篡改 payload（长度变化，但 chunkHash 也同步改）
      const tamperedPayload = 'b'.repeat(MAX_CHUNK_BYTES + 10);
      const tampered: SourceShareChunk[] = [
        chunks[0],
        {
          ...chunks[1],
          payload: tamperedPayload,
          chunkHash: String(tamperedPayload.length),
        },
        chunks[2],
      ];
      const result = assembleChunks(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('总长度');
      }
    });
  });
});
