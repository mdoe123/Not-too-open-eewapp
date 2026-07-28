// CustomSourceAdapter 列表 API 解析单元测试
//
// 验证 buildEvents（通过 parse 公开方法）对列表 API 的支持：
// - USGS 风格 {features:[...]} + listPath=$.features → 多事件
// - EMSC 风格 {data:{events:[...]}} + listPath=$.data.events → 多事件
// - 根数组 [...] + listPath=$ → 多事件
// - listPath 缺失时回退单事件解析（向后兼容）
// - listPath 配置但部分元素字段缺失时跳过该元素
// - listPath 配置但路径不存在时返回空数组
//
// 这些测试用例同时作为原生层 CustomSourceManager 列表解析的语义参照

import {CustomSourceAdapter} from '../CustomSourceAdapter';
import {SourceConfig} from '../../../types';

/** 构造测试用 SourceConfig */
function makeConfig(listPath?: string): SourceConfig {
  return {
    type: 'customSource',
    name: 'test-list-source',
    enabled: true,
    priority: 100,
    category: 'eqlist',
    protocol: 'http',
    endpoint: 'https://example.com/api',
    fieldMapping: {
      listPath,
      eventId: '$.id',
      originTime: '$.properties.time',
      magnitude: '$.properties.mag',
      depth: '$.geometry.coordinates[2]',
      lat: '$.geometry.coordinates[1]',
      lng: '$.geometry.coordinates[0]',
      location: '$.properties.place',
    },
  };
}

describe('CustomSourceAdapter 列表 API 解析', () => {
  // ======================== USGS 风格 ========================
  describe('USGS 风格 {features:[...]}', () => {
    const usgsResponse = {
      type: 'FeatureCollection',
      features: [
        {
          id: 'us7000abcd',
          properties: {mag: 5.6, time: 1719705600000, place: '日本本州东海岸'},
          geometry: {coordinates: [139.69, 35.68, 15.0]},
        },
        {
          id: 'us7000abce',
          properties: {mag: 4.2, time: 1719705601000, place: '台湾花莲县外海'},
          geometry: {coordinates: [121.5, 23.8, 20.0]},
        },
        {
          id: 'us7000abcf',
          properties: {mag: 6.0, time: 1719705602000, place: '印尼苏门答腊'},
          geometry: {coordinates: [100.0, -2.0, 30.0]},
        },
      ],
    };

    test('listPath=$.features 解析出 3 个事件', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse(usgsResponse);
      expect(events).not.toBeNull();
      expect(events).toHaveLength(3);
    });

    test('事件字段正确映射（相对于数组元素）', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse(usgsResponse) ?? [];

      // 第一个事件
      expect(events[0].id).toContain('us7000abcd');
      expect(events[0].magnitude).toBe(5.6);
      expect(events[0].originTime).toBe(1719705600000);
      expect(events[0].depth).toBe(15.0);
      expect(events[0].lat).toBe(35.68);
      expect(events[0].lng).toBe(139.69);
      expect(events[0].location).toBe('日本本州东海岸');
    });

    test('多事件顺序保持', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse(usgsResponse) ?? [];
      expect(events[0].id).toContain('us7000abcd');
      expect(events[1].id).toContain('us7000abce');
      expect(events[2].id).toContain('us7000abcf');
    });
  });

  // ======================== EMSC 风格 ========================
  describe('EMSC 风格 {data:{events:[...]}}', () => {
    const emscResponse = {
      data: {
        events: [
          {
            id: 'emsc-001',
            properties: {mag: 5.0, time: 1719705600000, place: ' Greece'},
            geometry: {coordinates: [22.0, 38.0, 10.0]},
          },
          {
            id: 'emsc-002',
            properties: {mag: 4.5, time: 1719705601000, place: ' Turkey'},
            geometry: {coordinates: [35.0, 39.0, 25.0]},
          },
        ],
      },
    };

    test('listPath=$.data.events 解析出 2 个事件', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.data.events'));
      const events = adapter.parse(emscResponse);
      expect(events).not.toBeNull();
      expect(events).toHaveLength(2);
    });

    test('事件字段正确', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.data.events'));
      const events = adapter.parse(emscResponse) ?? [];
      expect(events[0].id).toContain('emsc-001');
      expect(events[0].magnitude).toBe(5.0);
      expect(events[1].id).toContain('emsc-002');
      expect(events[1].depth).toBe(25.0);
    });
  });

  // ======================== 根数组 ========================
  describe('根数组 [...] + listPath=$', () => {
    const rootArrResponse = [
      {
        id: 'evt-001',
        properties: {mag: 5.5, time: 1719705600000, place: 'Region A'},
        geometry: {coordinates: [100.0, 20.0, 10.0]},
      },
      {
        id: 'evt-002',
        properties: {mag: 6.0, time: 1719705601000, place: 'Region B'},
        geometry: {coordinates: [110.0, 25.0, 15.0]},
      },
    ];

    test('listPath=$ 解析根数组', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$'));
      const events = adapter.parse(rootArrResponse);
      expect(events).not.toBeNull();
      expect(events).toHaveLength(2);
      expect(events![0].id).toContain('evt-001');
      expect(events![1].id).toContain('evt-002');
    });
  });

  // ======================== 向后兼容 ========================
  describe('listPath 缺失时回退单事件解析', () => {
    const singleEventResponse = {
      id: 'single-001',
      properties: {mag: 5.0, time: 1719705600000, place: 'Single Event'},
      geometry: {coordinates: [120.0, 30.0, 12.0]},
    };

    test('无 listPath 时按单事件解析', () => {
      const adapter = new CustomSourceAdapter(makeConfig(undefined));
      const events = adapter.parse(singleEventResponse);
      expect(events).not.toBeNull();
      expect(events).toHaveLength(1);
      expect(events![0].id).toContain('single-001');
      expect(events![0].magnitude).toBe(5.0);
    });

    test('无 listPath 时对根数组响应仍按单事件解析（向后兼容行为）', () => {
      // 旧配置（无 listPath）收到列表响应时，字段映射 $.id 等会尝试从根对象取值
      // 根对象是数组，取 $.id 会失败，返回空数组
      const adapter = new CustomSourceAdapter(makeConfig(undefined));
      const events = adapter.parse([
        {id: 'a', properties: {mag: 1, time: 1, place: 'x'}, geometry: {coordinates: [0, 0, 0]}},
      ]);
      expect(events).toHaveLength(0);
    });
  });

  // ======================== 容错 ========================
  describe('容错场景', () => {
    test('listPath 路径不存在返回空数组', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.notExist'));
      const events = adapter.parse({features: []});
      expect(events).toHaveLength(0);
    });

    test('listPath 提取为 null 返回空数组', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse({features: null});
      expect(events).toHaveLength(0);
    });

    test('listPath 提取为空数组返回空数组', () => {
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse({features: []});
      expect(events).toHaveLength(0);
    });

    test('部分元素必填字段缺失时跳过该元素', () => {
      const response = {
        features: [
          // 有效事件
          {
            id: 'valid-001',
            properties: {mag: 5.0, time: 1719705600000, place: 'Valid'},
            geometry: {coordinates: [100, 20, 10]},
          },
          // 无效事件（缺 mag）
          {
            id: 'invalid-002',
            properties: {time: 1719705601000, place: 'Invalid'},
            geometry: {coordinates: [110, 25, 15]},
          },
          // 有效事件
          {
            id: 'valid-003',
            properties: {mag: 6.0, time: 1719705602000, place: 'Valid 3'},
            geometry: {coordinates: [120, 30, 20]},
          },
        ],
      };
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse(response) ?? [];
      expect(events).toHaveLength(2);
      expect(events[0].id).toContain('valid-001');
      expect(events[1].id).toContain('valid-003');
    });

    test('所有元素必填字段缺失返回空数组', () => {
      const response = {
        features: [
          {id: 'a', properties: {time: 1, place: 'x'}, geometry: {coordinates: [0, 0, 0]}},
          {id: 'b', properties: {time: 2, place: 'y'}, geometry: {coordinates: [0, 0, 0]}},
        ],
      };
      const adapter = new CustomSourceAdapter(makeConfig('$.features'));
      const events = adapter.parse(response) ?? [];
      expect(events).toHaveLength(0);
    });
  });

  // ======================== 可选字段 ========================
  describe('可选字段在列表模式下的行为', () => {
    const mapping = (listPath?: string): SourceConfig => ({
      type: 'customSource',
      name: 'test-optional',
      enabled: true,
      priority: 101,
      category: 'eew',
      protocol: 'http',
      endpoint: 'https://example.com/api',
      fieldMapping: {
        listPath,
        eventId: '$.id',
        originTime: '$.time',
        magnitude: '$.mag',
        depth: '$.depth',
        lat: '$.lat',
        lng: '$.lng',
        location: '$.place',
        intensity: '$.intensity?',
        isFinal: '$.is_final?',
        isCancel: '$.is_cancel?',
      },
    });

    test('intensity 可选字段存在时提取', () => {
      const response = {
        features: [
          {id: 'e1', time: 1000, mag: 5.0, depth: 10, lat: 30, lng: 120, place: 'A', intensity: 4.5},
        ],
      };
      const adapter = new CustomSourceAdapter(mapping('$.features'));
      const events = adapter.parse(response) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].intensity).toBe(4.5);
    });

    test('intensity 可选字段缺失时为 undefined', () => {
      const response = {
        features: [
          {id: 'e1', time: 1000, mag: 5.0, depth: 10, lat: 30, lng: 120, place: 'A'},
        ],
      };
      const adapter = new CustomSourceAdapter(mapping('$.features'));
      const events = adapter.parse(response) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].intensity).toBeUndefined();
    });

    test('isFinal 布尔字段提取', () => {
      const response = {
        features: [
          {id: 'e1', time: 1000, mag: 5.0, depth: 10, lat: 30, lng: 120, place: 'A', is_final: 1},
        ],
      };
      const adapter = new CustomSourceAdapter(mapping('$.features'));
      const events = adapter.parse(response) ?? [];
      expect(events[0].isFinal).toBe(true);
    });
  });

  // ======================== 时间戳运算（列表模式） ========================
  describe('列表模式支持时间戳运算', () => {
    test('$.time * 1000 在列表元素上正确运算', () => {
      const config: SourceConfig = {
        type: 'customSource',
        name: 'test-expr',
        enabled: true,
        priority: 102,
        category: 'eqlist',
        protocol: 'http',
        endpoint: 'https://example.com/api',
        fieldMapping: {
          listPath: '$.features',
          eventId: '$.id',
          originTime: '$.time * 1000', // 秒 → 毫秒
          magnitude: '$.mag',
          depth: '$.depth',
          lat: '$.lat',
          lng: '$.lng',
          location: '$.place',
        },
      };
      const response = {
        features: [
          {id: 'e1', time: 1719705600, mag: 5.0, depth: 10, lat: 30, lng: 120, place: 'A'},
        ],
      };
      const adapter = new CustomSourceAdapter(config);
      const events = adapter.parse(response) ?? [];
      expect(events).toHaveLength(1);
      expect(events[0].originTime).toBe(1719705600000);
    });
  });
});
