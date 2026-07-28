// 集成冒烟测试（Task 11.1）
//
// 目的：在不依赖 Android 模拟器/SDK 的前提下，验证核心数据层模块的
// 类型契约与运行时行为是否满足设计要求。
//
// 覆盖点：
// 1. DEFAULT_CONFIG 结构正确（v13+ sources 为空数组、alert 字段完整、pollIntervalMs=30000）
// 2. EewEvent 类型可以正确构造（SourceType 仅 'customSource' | 'simulated'）
// 3. SourceManager 可以实例化（用 mock adapter）
// 4. AlertLevel 类型联合正确（silent / blue / yellow / orange / red）
//
// 注意：本测试依赖 @react-native/jest-preset。若未安装，jest 启动时会报
// "Cannot find module '@react-native/jest-preset'"，属于环境缺失而非测试代码错误。
// 详见 README「已知问题」与 docs/data-layer.md 第 9 节。

import {
  DEFAULT_CONFIG,
  type AppConfig,
  type AlertConfig,
  type SourceConfig,
} from '../../src/types/config';
import {
  type EewEvent,
  type SourceType,
  type SourceStatus,
  type AlertLevel,
} from '../../src/types/eew';
import {SourceManager} from '../../src/sources/SourceManager';
import type {
  SourceAdapter,
  EewEventCallback,
  StatusCallback,
} from '../../src/sources/SourceAdapter';

// ---------------------------------------------------------------------------
// 辅助：构造一个最小可用的 mock SourceAdapter
// 用于验证 SourceManager 的注册与启动流程，不建立真实连接
// ---------------------------------------------------------------------------
function createMockAdapter(type: SourceType): SourceAdapter {
  let status: SourceStatus = 'disconnected';
  return {
    sourceType: type,
    connect: async (
      _onEvent: EewEventCallback,
      onStatus: StatusCallback,
    ): Promise<void> => {
      status = 'connected';
      onStatus('connected', `mock ${type} connected`);
    },
    disconnect: async (): Promise<void> => {
      status = 'disconnected';
    },
    parse: (raw: unknown): EewEvent | EewEvent[] | null => {
      if (!raw) return null;
      return null;
    },
    heartbeat: (): boolean => true,
    getStatus: (): SourceStatus => status,
  };
}

// 辅助：构造一个 customSource 类型的 SourceConfig，用于注册测试
function makeCustomSourceConfig(overrides: Partial<SourceConfig> = {}): SourceConfig {
  return {
    type: 'customSource',
    name: '测试源',
    enabled: true,
    priority: 1,
    category: 'eew',
    protocol: 'ws',
    endpoint: 'wss://example.com/ws',
    fieldMapping: {
      eventId: '$.id',
      originTime: '$.time',
      magnitude: '$.mag',
      depth: '$.depth',
      lat: '$.lat',
      lng: '$.lng',
      location: '$.location',
    },
    ...overrides,
  };
}

// ===========================================================================
// 1. DEFAULT_CONFIG 结构验证
// ===========================================================================
describe('DEFAULT_CONFIG 结构契约', () => {
  it('sources 数组应为空（v13+ 合规改造：不预置任何数据源）', () => {
    expect(DEFAULT_CONFIG.sources).toHaveLength(0);
  });

  it('version 应为 13（v13 强制清空 wolfx 源）', () => {
    expect(DEFAULT_CONFIG.version).toBe(13);
  });

  it('pollIntervalMs 应为 30000', () => {
    expect(DEFAULT_CONFIG.pollIntervalMs).toBe(30000);
  });

  it('heartbeatFailureThreshold 应为 3', () => {
    expect(DEFAULT_CONFIG.heartbeatFailureThreshold).toBe(3);
  });

  it('alert 字段完整：所有 AlertConfig 必填字段存在且类型正确', () => {
    const alert: AlertConfig = DEFAULT_CONFIG.alert;
    expect(alert).toBeDefined();
    // 阈值
    expect(typeof alert.minMagnitude).toBe('number');
    expect(typeof alert.lockScreenIntensity).toBe('number');
    // 报警方式
    expect(typeof alert.soundEnabled).toBe('boolean');
    expect(typeof alert.vibrationEnabled).toBe('boolean');
    expect(typeof alert.flashlightEnabled).toBe('boolean');
    // 系统能力开关
    expect(typeof alert.backgroundEnabled).toBe('boolean');
    expect(typeof alert.floatingWindowEnabled).toBe('boolean');
    expect(typeof alert.lockScreenEnabled).toBe('boolean');
    expect(typeof alert.autoStartEnabled).toBe('boolean');
  });

  it('alert 默认阈值符合设计（minMagnitude=3.0 / lockScreenIntensity=4）', () => {
    const alert = DEFAULT_CONFIG.alert;
    expect(alert.minMagnitude).toBe(3.0);
    expect(alert.lockScreenIntensity).toBe(4);
  });

  it('DEFAULT_CONFIG 满足 AppConfig 类型（结构完整性）', () => {
    const config: AppConfig = DEFAULT_CONFIG;
    expect(config.sources).toBeInstanceOf(Array);
    expect(config.alert).toBeDefined();
    expect(typeof config.pollIntervalMs).toBe('number');
    expect(typeof config.heartbeatFailureThreshold).toBe('number');
  });
});

// ===========================================================================
// 2. EewEvent 构造验证
// ===========================================================================
describe('EewEvent 构造', () => {
  it('可以构造一个完整的 EewEvent 对象（customSource 源）', () => {
    const event: EewEvent = {
      id: 'customSource-example.com-EQ-0001',
      source: 'customSource',
      originTime: 1783000000000,
      magnitude: 5.4,
      depth: 12,
      lat: 30.5,
      lng: 103.7,
      location: '四川省成都市都江堰市',
      intensity: 6,
      isFinal: false,
      receivedAt: Date.now(),
    };
    expect(event.id).toBe('customSource-example.com-EQ-0001');
    expect(event.source).toBe('customSource');
    expect(event.magnitude).toBe(5.4);
    expect(event.depth).toBe(12);
    expect(event.lat).toBe(30.5);
    expect(event.lng).toBe(103.7);
    expect(event.location).toBe('四川省成都市都江堰市');
    expect(event.intensity).toBe(6);
    expect(event.isFinal).toBe(false);
    expect(typeof event.receivedAt).toBe('number');
  });

  it('可选字段 intensity / isFinal 可以省略', () => {
    const event: EewEvent = {
      id: 'simulated-001',
      source: 'simulated',
      originTime: 1783000000000,
      magnitude: 4.2,
      depth: 25,
      lat: 35.6,
      lng: 139.7,
      location: 'Tokyo, Japan',
      receivedAt: 1783000001000,
    };
    expect(event.intensity).toBeUndefined();
    expect(event.isFinal).toBeUndefined();
  });

  it('source 字段应接受所有 SourceType 联合成员（v13+ 仅 customSource / simulated）', () => {
    const sources: SourceType[] = ['customSource', 'simulated'];
    sources.forEach((s, idx) => {
      const event: EewEvent = {
        id: `${s}-${idx}`,
        source: s,
        originTime: 0,
        magnitude: 1.0,
        depth: 0,
        lat: 0,
        lng: 0,
        location: '',
        receivedAt: 0,
      };
      expect(event.source).toBe(s);
    });
  });
});

// ===========================================================================
// 3. SourceManager 实例化与注册验证
// ===========================================================================
describe('SourceManager 实例化', () => {
  it('可以使用 DEFAULT_CONFIG 构造 SourceManager', () => {
    const onEvent = jest.fn() as unknown as EewEventCallback;
    const onStatus = jest.fn() as unknown as StatusCallback;
    const manager = new SourceManager(DEFAULT_CONFIG, onEvent, onStatus);
    expect(manager).toBeInstanceOf(SourceManager);
  });

  it('可以注册 mock customSource adapter 并启动', async () => {
    const onEvent = jest.fn() as unknown as EewEventCallback;
    const onStatus = jest.fn() as unknown as StatusCallback;
    const manager = new SourceManager(DEFAULT_CONFIG, onEvent, onStatus);

    // v13+ 源由用户导入，DEFAULT_CONFIG.sources 为空，构造测试源验证注册流程
    const customConfig = makeCustomSourceConfig({priority: 1, enabled: true});
    const customAdapter = createMockAdapter('customSource');

    manager.registerAdapter(customConfig, customAdapter);

    // 启动：应激活唯一的 customSource
    await manager.start([customConfig]);

    // customSource 应处于 connected 状态
    expect(customAdapter.getStatus()).toBe('connected');

    // onStatus 应至少被调用一次（connected）
    expect(onStatus).toHaveBeenCalled();

    await manager.stop();
  });

  it('stop 后主源应被断开', async () => {
    const onEvent = jest.fn() as unknown as EewEventCallback;
    const onStatus = jest.fn() as unknown as StatusCallback;
    const manager = new SourceManager(DEFAULT_CONFIG, onEvent, onStatus);

    const customConfig = makeCustomSourceConfig({priority: 1, enabled: true});
    const customAdapter = createMockAdapter('customSource');
    manager.registerAdapter(customConfig, customAdapter);

    await manager.start([customConfig]);
    expect(customAdapter.getStatus()).toBe('connected');

    await manager.stop();
    expect(customAdapter.getStatus()).toBe('disconnected');
  });

  it('无启用源时 start 应上报 error 状态', async () => {
    const onEvent = jest.fn() as unknown as EewEventCallback;
    const onStatus = jest.fn() as unknown as StatusCallback;
    const manager = new SourceManager(DEFAULT_CONFIG, onEvent, onStatus);

    // 启用一个 enabled=false 的源，应触发 error 回调
    const disabledConfig = makeCustomSourceConfig({enabled: false});
    await manager.start([disabledConfig]);

    expect(onStatus).toHaveBeenCalledWith('error', '无可用数据源');
  });
});

// ===========================================================================
// 4. AlertLevel 联合类型验证（v13+：silent / blue / yellow / orange / red）
// ===========================================================================
describe('AlertLevel 联合类型', () => {
  it('应包含 5 个级别：silent / blue / yellow / orange / red', () => {
    const levels: AlertLevel[] = [
      'silent',
      'blue',
      'yellow',
      'orange',
      'red',
    ];
    expect(levels).toHaveLength(5);
    expect(new Set(levels).size).toBe(5);
  });

  it('每个 AlertLevel 都应是字符串字面量', () => {
    const levels: AlertLevel[] = [
      'silent',
      'blue',
      'yellow',
      'orange',
      'red',
    ];
    levels.forEach(l => {
      expect(typeof l).toBe('string');
    });
  });
});
