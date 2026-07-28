// jsonPathExtract 单元测试
//
// 覆盖场景：
// - 纯路径（$.id、$.data.mag）
// - 嵌套路径（$.a.b.c）
// - 数组索引（$.events[0].id、$.data[2][3]）
// - 四则运算（$.time * 1000、$.depth / 1000、$.a + $.b、$.mag - 1）
// - 可选标记（$.intensity? 缺失返回 undefined）
// - 类型转换（extractNumber/extractString/extractBoolean）
// - 容错（路径不存在、类型不匹配、除零保护）
// - 根对象（$ 返回整个数据）
//
// 这些测试用例同时作为原生层 JsonPathExtractor.kt 的语义参照（两份实现需一致）

import {
  extractByPath,
  extractString,
  extractNumber,
  extractBoolean,
  extractArray,
} from '../jsonPathExtract';

describe('jsonPathExtract', () => {
  // ======================== 纯路径 ========================
  describe('纯路径', () => {
    const data = {
      id: 'evt-001',
      mag: 6.5,
      data: {
        mag: 5.0,
        nested: {
          depth: 15,
        },
      },
    };

    test('$.id 提取顶层字段', () => {
      expect(extractByPath(data, '$.id')).toBe('evt-001');
    });

    test('$.mag 提取数值字段', () => {
      expect(extractByPath(data, '$.mag')).toBe(6.5);
    });

    test('$.data.mag 提取嵌套字段', () => {
      expect(extractByPath(data, '$.data.mag')).toBe(5.0);
    });

    test('$.data.nested.depth 提取多层嵌套', () => {
      expect(extractByPath(data, '$.data.nested.depth')).toBe(15);
    });

    test('路径不存在返回 undefined', () => {
      expect(extractByPath(data, '$.notExist')).toBeUndefined();
    });

    test('嵌套路径中间不存在返回 undefined', () => {
      expect(extractByPath(data, '$.notExist.deep')).toBeUndefined();
    });
  });

  // ======================== 数组索引 ========================
  describe('数组索引', () => {
    const data = {
      events: [
        {id: 'e0', mag: 1.0},
        {id: 'e1', mag: 2.0},
        {id: 'e2', mag: 3.0},
      ],
      matrix: [
        [1, 2, 3],
        [4, 5, 6],
      ],
    };

    test('$.events[0].id 提取数组首元素字段', () => {
      expect(extractByPath(data, '$.events[0].id')).toBe('e0');
    });

    test('$.events[2].mag 提取数组末元素字段', () => {
      expect(extractByPath(data, '$.events[2].mag')).toBe(3.0);
    });

    test('$.events[1] 提取数组元素（对象）', () => {
      expect(extractByPath(data, '$.events[1]')).toEqual({id: 'e1', mag: 2.0});
    });

    test('$.matrix[0][1] 提取二维数组', () => {
      expect(extractByPath(data, '$.matrix[0][1]')).toBe(2);
    });

    test('$.matrix[1][2] 提取二维数组末元素', () => {
      expect(extractByPath(data, '$.matrix[1][2]')).toBe(6);
    });

    test('数组索引越界返回 undefined', () => {
      expect(extractByPath(data, '$.events[10].id')).toBeUndefined();
    });

    test('对非数组使用索引返回 undefined', () => {
      expect(extractByPath({a: 'string'}, '$.a[0]')).toBeUndefined();
    });
  });

  // ======================== 根对象 ========================
  describe('根对象', () => {
    const data = {id: 'x', nested: {v: 1}};

    test('$ 返回整个数据', () => {
      expect(extractByPath(data, '$')).toEqual(data);
    });

    test('$. 返回整个数据（带点）', () => {
      expect(extractByPath(data, '$.')).toEqual(data);
    });
  });

  // ======================== 四则运算 ========================
  describe('四则运算', () => {
    const data = {
      time: 1719705600, // 秒级时间戳
      depth: 15000, // 米
      a: 10,
      b: 3,
      mag: 6.5,
    };

    test('$.time * 1000 秒转毫秒', () => {
      expect(extractByPath(data, '$.time * 1000')).toBe(1719705600000);
    });

    test('$.depth / 1000 米转千米', () => {
      expect(extractByPath(data, '$.depth / 1000')).toBe(15);
    });

    test('$.a + $.b 两路径相加', () => {
      expect(extractByPath(data, '$.a + $.b')).toBe(13);
    });

    test('$.a - $.b 两路径相减', () => {
      expect(extractByPath(data, '$.a - $.b')).toBe(7);
    });

    test('$.a * $.b 两路径相乘', () => {
      expect(extractByPath(data, '$.a * $.b')).toBe(30);
    });

    test('$.a / $.b 两路径相除', () => {
      expect(extractByPath(data, '$.a / $.b')).toBeCloseTo(3.333333, 5);
    });

    test('$.mag - 1 路径减数字', () => {
      expect(extractByPath(data, '$.mag - 1')).toBe(5.5);
    });

    test('$.mag + 0.5 路径加小数', () => {
      expect(extractByPath(data, '$.mag + 0.5')).toBe(7.0);
    });

    test('除零保护返回 undefined', () => {
      expect(extractByPath({a: 5, b: 0}, '$.a / $.b')).toBeUndefined();
    });

    test('除以数字 0 保护返回 undefined', () => {
      expect(extractByPath({a: 5}, '$.a / 0')).toBeUndefined();
    });

    test('左操作数缺失返回 undefined', () => {
      expect(extractByPath({b: 5}, '$.notExist + $.b')).toBeUndefined();
    });

    test('右操作数路径缺失返回 undefined', () => {
      expect(extractByPath({a: 5}, '$.a + $.notExist')).toBeUndefined();
    });
  });

  // ======================== 可选标记 ========================
  describe('可选标记 ?', () => {
    const data = {id: 'x', mag: 5.0};

    test('$.intensity? 字段缺失返回 undefined', () => {
      expect(extractByPath(data, '$.intensity?')).toBeUndefined();
    });

    test('$.mag? 字段存在返回值', () => {
      expect(extractByPath(data, '$.mag?')).toBe(5.0);
    });

    test('$.nested.deep? 嵌套缺失返回 undefined', () => {
      expect(extractByPath(data, '$.nested.deep?')).toBeUndefined();
    });
  });

  // ======================== 类型转换：extractString ========================
  describe('extractString', () => {
    test('字符串值原样返回', () => {
      expect(extractString({id: 'abc'}, '$.id')).toBe('abc');
    });

    test('数字转字符串', () => {
      expect(extractString({id: 123}, '$.id')).toBe('123');
    });

    test('布尔转字符串', () => {
      expect(extractString({flag: true}, '$.flag')).toBe('true');
    });

    test('缺失返回默认值 null', () => {
      expect(extractString({a: 1}, '$.notExist')).toBeNull();
    });

    test('缺失返回自定义默认值', () => {
      expect(extractString({a: 1}, '$.notExist', 'default')).toBe('default');
    });
  });

  // ======================== 类型转换：extractNumber ========================
  describe('extractNumber', () => {
    test('数值原样返回', () => {
      expect(extractNumber({mag: 6.5}, '$.mag')).toBe(6.5);
    });

    test('字符串数字转 number', () => {
      expect(extractNumber({mag: '5.0'}, '$.mag')).toBe(5.0);
    });

    test('布尔 true 转 1', () => {
      expect(extractNumber({flag: true}, '$.flag')).toBe(1);
    });

    test('布尔 false 转 0', () => {
      expect(extractNumber({flag: false}, '$.flag')).toBe(0);
    });

    test('非数字字符串返回默认值', () => {
      expect(extractNumber({s: 'abc'}, '$.s')).toBeNull();
    });

    test('缺失返回默认值 null', () => {
      expect(extractNumber({a: 1}, '$.notExist')).toBeNull();
    });

    test('缺失返回自定义默认值', () => {
      expect(extractNumber({a: 1}, '$.notExist', 0)).toBe(0);
    });

    test('NaN 字符串返回默认值', () => {
      expect(extractNumber({v: 'NaN'}, '$.v')).toBeNull();
    });

    test('Infinity 返回默认值', () => {
      // Infinity 字符串可被 Number 解析，但 Number.isFinite 过滤掉
      expect(extractNumber({v: 'Infinity'}, '$.v')).toBeNull();
    });
  });

  // ======================== 类型转换：extractBoolean ========================
  describe('extractBoolean', () => {
    test('布尔原样返回', () => {
      expect(extractBoolean({flag: true}, '$.flag')).toBe(true);
      expect(extractBoolean({flag: false}, '$.flag')).toBe(false);
    });

    test('数字 0 转 false', () => {
      expect(extractBoolean({v: 0}, '$.v')).toBe(false);
    });

    test('数字非 0 转 true', () => {
      expect(extractBoolean({v: 1}, '$.v')).toBe(true);
      expect(extractBoolean({v: -1}, '$.v')).toBe(true);
    });

    test('字符串 true 转 true', () => {
      expect(extractBoolean({v: 'true'}, '$.v')).toBe(true);
    });

    test('字符串 false 转 false', () => {
      expect(extractBoolean({v: 'false'}, '$.v')).toBe(false);
    });

    test('字符串 1 转 true', () => {
      expect(extractBoolean({v: '1'}, '$.v')).toBe(true);
    });

    test('字符串 0 转 false', () => {
      expect(extractBoolean({v: '0'}, '$.v')).toBe(false);
    });

    test('空字符串转 false', () => {
      expect(extractBoolean({v: ''}, '$.v')).toBe(false);
    });

    test('大小写不敏感', () => {
      expect(extractBoolean({v: 'TRUE'}, '$.v')).toBe(true);
      expect(extractBoolean({v: 'False'}, '$.v')).toBe(false);
    });

    test('缺失返回默认值 false', () => {
      expect(extractBoolean({a: 1}, '$.notExist')).toBe(false);
    });

    test('缺失返回自定义默认值 true', () => {
      expect(extractBoolean({a: 1}, '$.notExist', true)).toBe(true);
    });

    test('其他字符串返回默认值', () => {
      expect(extractBoolean({v: 'maybe'}, '$.v')).toBe(false);
      expect(extractBoolean({v: 'maybe'}, '$.v', true)).toBe(true);
    });
  });

  // ======================== 容错与边界 ========================
  describe('容错与边界', () => {
    test('空路径表达式返回 undefined', () => {
      expect(extractByPath({a: 1}, '')).toBeUndefined();
    });

    test('非字符串路径返回 undefined', () => {
      // @ts-expect-error 测试容错：故意传非字符串
      expect(extractByPath({a: 1}, 123)).toBeUndefined();
    });

    test('不以 $. 开头的路径返回 undefined', () => {
      expect(extractByPath({a: 1}, 'a')).toBeUndefined();
      expect(extractByPath({a: 1}, 'a.b')).toBeUndefined();
    });

    test('null 数据返回 undefined', () => {
      expect(extractByPath(null, '$.a')).toBeUndefined();
    });

    test('undefined 数据返回 undefined', () => {
      expect(extractByPath(undefined, '$.a')).toBeUndefined();
    });

    test('对 null 中间字段访问返回 undefined', () => {
      const data = {a: null};
      expect(extractByPath(data, '$.a.b')).toBeUndefined();
    });

    test('对原始类型访问字段返回 undefined', () => {
      expect(extractByPath({a: 'string'}, '$.a.b')).toBeUndefined();
    });

    test('表达式左操作数为非数字返回 undefined', () => {
      expect(extractByPath({a: 'abc'}, '$.a * 2')).toBeUndefined();
    });

    test('表达式右操作数为非数字路径返回 undefined', () => {
      expect(extractByPath({a: 5, b: 'abc'}, '$.a + $.b')).toBeUndefined();
    });
  });

  // ======================== 综合场景（模拟真实 API）========================
  describe('综合场景', () => {
    // 模拟 CENC 风格 API 响应
    const cencLike = {
      id: 'CN202607180001',
      time: 1719705600, // 秒级
      depth: 15.0,
      latitude: 35.68,
      longitude: 139.69,
      location: '日本本州东海岸',
      is_final: 1,
      is_cancel: 0,
    };

    test('完整事件提取（含时间戳转换）', () => {
      const id = extractString(cencLike, '$.id');
      const time = extractNumber(cencLike, '$.time * 1000');
      const depth = extractNumber(cencLike, '$.depth');
      const lat = extractNumber(cencLike, '$.latitude');
      const lng = extractNumber(cencLike, '$.longitude');
      const loc = extractString(cencLike, '$.location');
      const isFinal = extractBoolean(cencLike, '$.is_final');

      expect(id).toBe('CN202607180001');
      expect(time).toBe(1719705600000);
      expect(depth).toBe(15.0);
      expect(lat).toBe(35.68);
      expect(lng).toBe(139.69);
      expect(loc).toBe('日本本州东海岸');
      expect(isFinal).toBe(true);
    });

    // 模拟嵌套数组 API
    const nestedApi = {
      data: {
        events: [
          {eid: 'e1', magnitude: 5.5, info: {depth: 10, place: '区域A'}},
          {eid: 'e2', magnitude: 6.0, info: {depth: 20, place: '区域B'}},
        ],
      },
    };

    test('嵌套数组提取首事件', () => {
      expect(extractString(nestedApi, '$.data.events[0].eid')).toBe('e1');
      expect(extractNumber(nestedApi, '$.data.events[0].magnitude')).toBe(5.5);
      expect(extractNumber(nestedApi, '$.data.events[0].info.depth')).toBe(10);
      expect(extractString(nestedApi, '$.data.events[0].info.place')).toBe('区域A');
    });

    test('嵌套数组提取次事件', () => {
      expect(extractString(nestedApi, '$.data.events[1].eid')).toBe('e2');
      expect(extractNumber(nestedApi, '$.data.events[1].info.depth')).toBe(20);
    });

    // 可选字段缺失场景
    const withoutIntensity = {id: 'x', mag: 5.0};
    test('可选字段缺失不影响其他字段', () => {
      expect(extractString(withoutIntensity, '$.id')).toBe('x');
      expect(extractNumber(withoutIntensity, '$.mag')).toBe(5.0);
      expect(extractNumber(withoutIntensity, '$.intensity?', -1)).toBe(-1);
    });
  });

  // ======================== extractArray（列表 API 支持） ========================
  describe('extractArray', () => {
    test('USGS 风格 $.features 返回数组', () => {
      const usgs = {
        features: [
          {id: 'us7000abcd', properties: {mag: 5.6}},
          {id: 'us7000abce', properties: {mag: 4.2}},
        ],
      };
      const arr = extractArray(usgs, '$.features');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(2);
      expect((arr as unknown[])[0]).toEqual({id: 'us7000abcd', properties: {mag: 5.6}});
    });

    test('EMSC 风格 $.data.events 返回数组', () => {
      const emsc = {
        data: {
          events: [
            {eid: 'e1', mag: 5.0},
            {eid: 'e2', mag: 6.0},
            {eid: 'e3', mag: 4.5},
          ],
        },
      };
      const arr = extractArray(emsc, '$.data.events');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(3);
    });

    test('根数组 $ 返回整个数组', () => {
      const rootArr = [
        {id: 'a', mag: 1.0},
        {id: 'b', mag: 2.0},
      ];
      const arr = extractArray(rootArr, '$');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(2);
      expect((arr as unknown[])[0]).toEqual({id: 'a', mag: 1.0});
    });

    test('空数组返回空数组（非 null）', () => {
      const data = {features: []};
      const arr = extractArray(data, '$.features');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(0);
    });

    test('路径缺失返回 null', () => {
      const data = {other: []};
      const arr = extractArray(data, '$.features');
      expect(arr).toBeNull();
    });

    test('值为 null 返回 null', () => {
      const data = {features: null};
      const arr = extractArray(data, '$.features');
      expect(arr).toBeNull();
    });

    test('非数组值容错包装为单元素数组', () => {
      const data = {single: {id: 'only-one', mag: 5.0}};
      const arr = extractArray(data, '$.single');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(1);
      expect((arr as unknown[])[0]).toEqual({id: 'only-one', mag: 5.0});
    });

    test('字符串值容错包装为单元素数组', () => {
      const data = {name: 'hello'};
      const arr = extractArray(data, '$.name');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(1);
      expect((arr as unknown[])[0]).toBe('hello');
    });

    test('数字值容错包装为单元素数组', () => {
      const data = {count: 42};
      const arr = extractArray(data, '$.count');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(1);
      expect((arr as unknown[])[0]).toBe(42);
    });

    test('嵌套数组路径 $.a.b.c', () => {
      const data = {
        a: {
          b: {
            c: [{x: 1}, {x: 2}],
          },
        },
      };
      const arr = extractArray(data, '$.a.b.c');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(2);
    });

    // ======================== glob 通配符 $.No*（listPath 场景）========================
    test('$.No* glob 通配符从平铺对象提取数组（wolfx eqlist 风格）', () => {
      const wolfxEqlist = {
        No1: {time: '2024-04-07 05:15:09', magnitude: '4.1'},
        No2: {time: '2024-04-06 23:53:09', magnitude: '4.5'},
        No3: {time: '2024-04-06 18:47:11', magnitude: '4.8'},
        md5: '823147c3276049d4b0dc7e4fe149e868',
      };
      const arr = extractArray(wolfxEqlist, '$.No*');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(3);
      // 不应包含 md5
      const magnitudes = (arr as unknown[]).map(e => (e as {magnitude: string}).magnitude);
      expect(magnitudes).toEqual(['4.1', '4.5', '4.8']);
    });

    test('$.No* 无匹配 key 返回空数组（非 null）', () => {
      const data = {foo: 1, bar: 2, md5: 'abc'};
      const arr = extractArray(data, '$.No*');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(0);
    });

    test('$.data.No* 嵌套路径 glob 匹配', () => {
      const data = {
        data: {
          No1: {id: 'a'},
          No2: {id: 'b'},
          other: 'skip',
        },
      };
      const arr = extractArray(data, '$.data.No*');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(2);
    });

    test('$.No* 在数组上调用返回 null（非对象）', () => {
      const data = {items: [1, 2, 3]};
      // 路径 $.items.No* 中，items 是数组而非对象，glob 无效
      const result = extractByPath(data, '$.items.No*');
      expect(result).toBeUndefined();
    });
  });

  // ======================== Date.parse 函数调用语法 ========================
  describe('Date.parse 函数调用语法', () => {
    test('解析 wolfx 风格 "2026-07-18 13:47:20"（按 UTC+8）', () => {
      const data = {OriginTime: '2026-07-18 13:47:20'};
      const ts = extractByPath(data, 'Date.parse($.OriginTime)');
      expect(typeof ts).toBe('number');
      // 验证：2026-07-18 13:47:20 UTC+8 = 2026-07-18 05:47:20 UTC
      // 期望时间戳 = Date.parse('2026-07-18T13:47:20+08:00')
      const expected = Date.parse('2026-07-18T13:47:20+08:00');
      expect(ts).toBe(expected);
    });

    test('解析 ISO 8601 无时区 "2026-07-18T13:47:20"（按 UTC+8）', () => {
      const data = {time: '2026-07-18T13:47:20'};
      const ts = extractByPath(data, 'Date.parse($.time)');
      expect(typeof ts).toBe('number');
      const expected = Date.parse('2026-07-18T13:47:20+08:00');
      expect(ts).toBe(expected);
    });

    test('解析 ISO 8601 带时区 "2026-07-18T13:47:20+08:00"', () => {
      const data = {time: '2026-07-18T13:47:20+08:00'};
      const ts = extractByPath(data, 'Date.parse($.time)');
      expect(typeof ts).toBe('number');
      const expected = Date.parse('2026-07-18T13:47:20+08:00');
      expect(ts).toBe(expected);
    });

    test('数字直接返回（Unix 毫秒）', () => {
      const data = {time: 1719705600000};
      const ts = extractByPath(data, 'Date.parse($.time)');
      expect(ts).toBe(1719705600000);
    });

    test('纯数字字符串作为 Unix 时间戳返回', () => {
      const data = {time: '1719705600000'};
      const ts = extractByPath(data, 'Date.parse($.time)');
      expect(ts).toBe(1719705600000);
    });

    test('路径缺失返回 undefined', () => {
      const data = {other: 'foo'};
      const ts = extractByPath(data, 'Date.parse($.notExist)');
      expect(ts).toBeUndefined();
    });

    test('无效日期字符串返回 undefined', () => {
      const data = {time: 'not-a-date'};
      const ts = extractByPath(data, 'Date.parse($.time)');
      expect(ts).toBeUndefined();
    });

    test('空字符串返回 undefined', () => {
      const data = {time: ''};
      const ts = extractByPath(data, 'Date.parse($.time)');
      expect(ts).toBeUndefined();
    });

    test('非 Date.parse 表达式不受影响（纯路径）', () => {
      const data = {id: 'evt-001'};
      // 确保普通路径不会被误匹配为函数调用
      expect(extractByPath(data, '$.id')).toBe('evt-001');
    });

    test('四则运算表达式不受影响', () => {
      const data = {time: 1700000000};
      // 确保四则运算表达式不会被误匹配为函数调用
      expect(extractByPath(data, '$.time * 1000')).toBe(1700000000000);
    });

    test('extractNumber 与 Date.parse 协同工作', () => {
      const data = {OriginTime: '2026-07-18 13:47:20'};
      // 通过 extractNumber 调用 Date.parse 结果
      const ts = extractNumber(data, 'Date.parse($.OriginTime)');
      expect(typeof ts).toBe('number');
      expect(ts).toBe(Date.parse('2026-07-18T13:47:20+08:00'));
    });
  });

  // ======================== 综合场景：wolfx CENC EEW 真实数据 ========================
  describe('wolfx CENC EEW 真实数据综合解析', () => {
    const wolfxCencEew = {
      ID: 'b3i6pz76gqcyy',
      EventID: '202607181347.0001',
      ReportTime: '2026-07-18 13:47:20',
      ReportNum: 1,
      OriginTime: '2026-07-18 13:47:20',
      HypoCenter: '新疆克孜勒苏州阿克陶县',
      Latitude: 38.747,
      Longitude: 75.088,
      Magnitude: 4.8,
      Depth: 5,
      MaxIntensity: 6.2,
    };

    test('完整事件提取（cenc_eew.json 配置）', () => {
      const eventId = extractString(wolfxCencEew, '$.EventID');
      const originTime = extractNumber(wolfxCencEew, 'Date.parse($.OriginTime)');
      const magnitude = extractNumber(wolfxCencEew, '$.Magnitude');
      const depth = extractNumber(wolfxCencEew, '$.Depth');
      const lat = extractNumber(wolfxCencEew, '$.Latitude');
      const lng = extractNumber(wolfxCencEew, '$.Longitude');
      const location = extractString(wolfxCencEew, '$.HypoCenter');
      const intensity = extractNumber(wolfxCencEew, '$.MaxIntensity');

      expect(eventId).toBe('202607181347.0001');
      expect(originTime).toBe(Date.parse('2026-07-18T13:47:20+08:00'));
      expect(magnitude).toBe(4.8);
      expect(depth).toBe(5);
      expect(lat).toBe(38.747);
      expect(lng).toBe(75.088);
      expect(location).toBe('新疆克孜勒苏州阿克陶县');
      expect(intensity).toBe(6.2);
    });
  });

  // ======================== 综合场景：wolfx CENC Eqlist 真实数据 ========================
  describe('wolfx CENC Eqlist 真实数据综合解析', () => {
    const wolfxCencEqlist = {
      No1: {
        type: 'reviewed',
        time: '2024-04-07 05:15:09',
        location: '台湾花莲县海域',
        magnitude: '4.1',
        depth: '17',
        latitude: '23.98',
        longitude: '121.80',
        intensity: '6',
      },
      No2: {
        type: 'reviewed',
        time: '2024-04-06 23:53:09',
        location: '台湾花莲县海域',
        magnitude: '4.5',
        depth: '23',
        latitude: '24.15',
        longitude: '122.00',
        intensity: '6',
      },
      md5: '823147c3276049d4b0dc7e4fe149e868',
    };

    test('$.No* 提取事件列表并逐个解析字段', () => {
      const arr = extractArray(wolfxCencEqlist, '$.No*');
      expect(arr).not.toBeNull();
      expect(arr).toHaveLength(2);

      const first = (arr as unknown[])[0] as Record<string, string>;
      const eventId = extractString(first, '$.time');
      const originTime = extractNumber(first, 'Date.parse($.time)');
      const magnitude = extractNumber(first, '$.magnitude');
      const depth = extractNumber(first, '$.depth');
      const lat = extractNumber(first, '$.latitude');
      const lng = extractNumber(first, '$.longitude');
      const location = extractString(first, '$.location');
      const intensity = extractNumber(first, '$.intensity');

      expect(eventId).toBe('2024-04-07 05:15:09');
      expect(originTime).toBe(Date.parse('2024-04-07T05:15:09+08:00'));
      expect(magnitude).toBe(4.1);
      expect(depth).toBe(17);
      expect(lat).toBe(23.98);
      expect(lng).toBe(121.8);
      expect(location).toBe('台湾花莲县海域');
      expect(intensity).toBe(6);
    });

    test('md5 字段不被 $.No* 匹配', () => {
      const arr = extractArray(wolfxCencEqlist, '$.No*');
      expect(arr).not.toBeNull();
      // 只有 No1、No2 两个事件，md5 不应被包含
      expect(arr).toHaveLength(2);
    });
  });
});
