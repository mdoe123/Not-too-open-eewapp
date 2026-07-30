# 数据源扩展指南

本文档说明如何在地震预警 App 中新增一个数据源适配器（SourceAdapter）。新增数据源只需实现统一接口并注册到 `SourceManager`，无需改动上层 UI 与报警逻辑。

> 相关代码：`src/sources/SourceAdapter.ts`、`src/sources/SourceManager.ts`、`src/types/eew.ts`、`src/types/config.ts`
> 数据层整体设计见 [data-layer.md](data-layer.md)。

## 1. SourceAdapter 接口说明

所有数据源必须实现 `SourceAdapter` 接口（定义于 `src/sources/SourceAdapter.ts`）：

```typescript
interface SourceAdapter {
  readonly sourceType: string;
  connect(onEvent: EewEventCallback, onStatus: StatusCallback): Promise<void>;
  disconnect(): Promise<void>;
  parse(raw: unknown): EewEvent | EewEvent[] | null;
  heartbeat(): boolean;
  getStatus(): SourceStatus;
}
```

| 方法 | 职责 | 说明 |
|------|------|------|
| `sourceType` | 数据源类型标识 | 对应 `SourceType` 联合类型中的字面量，如 `'customSource'` |
| `connect(onEvent, onStatus)` | 建立连接 | 连接类型由实现决定（WebSocket / HTTP 轮询）。连接成功后通过 `onEvent` 推送事件、通过 `onStatus` 上报状态。返回 Promise，reject 表示连接失败 |
| `disconnect()` | 主动断开 | 释放底层资源（关闭 socket、清除定时器等），返回 Promise |
| `parse(raw)` | 解析原始数据 | 将数据源原始格式（JSON/Protobuf/文本）解析为统一 `EewEvent`。**公开方法**，便于在不建立连接的情况下做单元测试。返回单个事件、事件数组或 `null`（数据无效时） |
| `heartbeat()` | 心跳检测 | 由 `SourceManager` 周期性调用。返回 `true` 表示连接健康；返回 `false` 表示异常，计入失败次数 |
| `getStatus()` | 当前状态 | 返回 `SourceStatus`：`connecting` / `connected` / `disconnected` / `error` |

### 回调类型

```typescript
type EewEventCallback = (event: EewEvent) => void;
type StatusCallback = (status: SourceStatus, message?: string) => void;
```

## 2. EewEvent 统一结构

所有数据源解析后都必须输出 `EewEvent`（定义于 `src/types/eew.ts`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | `string` | ✅ | 事件唯一 ID（建议由数据源类型 + 原始 ID 拼接，避免跨源冲突，如 `customSource-api.example.com-EQ-001`） |
| `source` | `SourceType` | ✅ | 数据来源，取 `SourceType` 联合成员 |
| `originTime` | `number` | ✅ | 发震时间（Unix 毫秒） |
| `magnitude` | `number` | ✅ | 震级 |
| `depth` | `number` | ✅ | 震源深度（km） |
| `lat` | `number` | ✅ | 震中纬度 |
| `lng` | `number` | ✅ | 震中经度 |
| `location` | `string` | ✅ | 震中位置描述（人类可读） |
| `intensity` | `number` | ❌ | 预估烈度（若数据源提供） |
| `isFinal` | `boolean` | ❌ | 是否为最终确定结果（vs 初报） |
| `receivedAt` | `number` | ✅ | App 接收到的时间（Unix 毫秒） |

### SourceType 联合类型

合规改造（v13+）后，`SourceType` 仅保留 2 个字面量：

```typescript
export type SourceType =
  // 自定义数据源（用户填写 URL + 字段映射，App 原生层连接解析）
  | 'customSource'
  // 模拟事件标识（非数据源，仅用于模拟预警功能）
  | 'simulated';
```

**类型说明：**

- `customSource`：用户配置的自定义数据源（HTTP/WebSocket + 字段映射）。这是当前 App 唯一支持的真实数据源类型，由 `CustomSourceAdapter`（JS 层前台）和 `EewBackgroundService`（原生层锁屏）共同实现。
- `simulated`：模拟预警页面手动触发的测试事件，**非数据源**（不在 `DEFAULT_CONFIG.sources` 中），仅用于跨页面事件总线注入测试事件。

### SourceCategory 数据源分类

```typescript
export type SourceCategory = 'eew' | 'eqlist';
```

- `eew`：预警数据源（eew API，提供地震预警）
- `eqlist`：速报数据源（eqlist API，提供地震信息列表）

`SourceConfig.category` 字段标识数据源分类，用于界面分组显示。默认值为 `'eew'`。

## 3. CustomSource 适配器架构

CustomSource 是 App 当前唯一的真实数据源类型。用户通过设置页填写：
- 数据源 URL（`endpoint`）
- 连接协议（`protocol: 'ws' | 'http'`）
- 字段映射规则（`fieldMapping`）
- 鉴权 token（`authToken`，可选）

App 按用户配置的路径表达式从 API 返回的 JSON 中提取字段，**不执行任何用户代码**，仅做 JSON 解析。

> 相关代码：`src/sources/custom/CustomSourceAdapter.ts`、`src/sources/custom/jsonPathExtract.ts`、`src/sources/custom/index.ts`

### 3.1 目录结构

```
src/sources/custom/
├── CustomSourceAdapter.ts        # 自定义源适配器（WS + HTTP 双协议实现）
├── jsonPathExtract.ts            # JSON 路径表达式解析器（$.field、$.a.b[0].c、$.time * 1000）
├── sourceShare.ts                # 源配置分享/导入工具（导出/解析/校验/合并）
├── index.ts                      # 统一导出 + createCustomSourceAdapter 工厂函数
└── __tests__/
    ├── CustomSourceAdapter.list.test.ts   # listPath 列表 API 单元测试
    ├── jsonPathExtract.test.ts            # 路径表达式解析单元测试
    └── sourceShare.test.ts                # 源分享/导入单元测试
```

### 3.2 FieldMapping 字段映射规则

`FieldMapping` 接口（定义于 `src/types/config.ts`）描述如何从 API 返回的 JSON 中提取 `EewEvent` 字段：

```typescript
interface FieldMapping {
  /** 列表路径（可选）。配置时先提取数组，再对每个元素应用字段映射 */
  listPath?: string;
  /** 事件唯一 ID（必填） */
  eventId: string;
  /** 发震时间 Unix 毫秒（必填，秒级时间戳可用 $.time * 1000 转换） */
  originTime: string;
  /** 震级（必填） */
  magnitude: string;
  /** 震源深度 km（必填） */
  depth: string;
  /** 震中纬度（必填，范围 [-90, 90]） */
  lat: string;
  /** 震中经度（必填，范围 [-180, 180]） */
  lng: string;
  /** 震中位置描述（必填） */
  location: string;
  /** 预估烈度（可选，缺省时 App 自行计算） */
  intensity?: string;
  /** 是否最终报（可选，默认 false） */
  isFinal?: string;
  /** 是否取消报（可选，默认 false） */
  isCancel?: string;
  /** 报告编号/第几报（可选）。CENC 格式通常为 $.ReportNum。配置后在悬浮窗和锁屏预警界面显示"第N报"，未配置时不显示 */
  reportNum?: string;
}
```

### 字段说明补充

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reportNum` | `string`（路径表达式） | 否 | 报告编号（第几报）的路径表达式。CENC 格式通常配置为 `$.ReportNum`。配置后，悬浮窗信息行（"第N报 · 数据源名称 · 震中距 X km · 时间"）和锁屏预警信息行（"第N报  数据源名称  发震 HH:mm:ss  深度 Xkm  距离 Xkm"）会显示对应的报告编号；未配置时不显示"第N报"字段 |

> **数据源名称（sourceName）说明**：数据源名称由 `SourceConfig.name` 字段自动填充（即用户在设置页配置数据源时填写的名称），**无需在 FieldMapping 中配置**。App 解析事件时会自动将当前数据源的 `name` 附加到事件上，用于悬浮窗和锁屏预警界面显示。

### 3.3 路径表达式语法

`jsonPathExtract.ts` 提供路径表达式解析，支持以下语法：

| 语法 | 示例 | 说明 |
|------|------|------|
| 根对象 | `$` | 整个响应根对象 |
| 字段访问 | `$.id`、`$.data.mag` | 嵌套字段 |
| 数组索引 | `$.events[0].id` | 数组下标 |
| 可选标记 | `$.intensity?` | 缺失时返回 undefined（不报错） |
| 四则运算 | `$.time * 1000`、`$.depth / 1000` | 路径与数字字面量的 + - * / |

**运算规则**：操作数可为路径（`$.xxx`）或数字字面量（`1000`、`3.14`），运算结果用于填充目标字段。

**listPath 用法**：若 API 返回事件数组（如 `{features:[...]}`），配置 `listPath: '$.features'` 后，适配器先提取数组，再对每个元素应用字段映射（此时路径相对于元素，如 `$.id` 指元素的 id 字段）。

### 3.4 鉴权设计

| 协议 | 鉴权方式 |
|------|---------|
| HTTP | 请求头 `Authorization: Bearer <authToken>` |
| WebSocket | URL 追加 `?token=<authToken>` 查询参数 |

安全设计：
- `authToken` 与 `apiKey` 一样，**不持久化到 AsyncStorage**（仅运行时内存持有）
- 导出源配置时默认剥离 `authToken`，用户需显式勾选才保留

### 3.5 WS 指数退避重连

WebSocket 模式内置指数退避重连（参考原 `BaseWolfxWsAdapter` 设计）：

- 触发条件：`onclose` 非主动关闭、`onerror`
- 初始延迟 1s，倍数 2，上限 30s（1s → 2s → 4s → 8s → 16s → 30s → 30s → ...）
- `onopen` 成功后重置延迟为 1s
- 主动 `disconnect()` 后不再重连

### 3.6 HTTP 心跳超时

HTTP 轮询模式的心跳超时阈值：`max(pollIntervalMs * 3, 10000ms)`。超过此阈值未收到成功响应则视为不健康，触发 `SourceManager` 切换备用源。

## 4. 新增数据源步骤

### 步骤 1：扩展 SourceType（若需要）

如果新数据源不属于现有 2 种类型（`customSource` + `simulated`），先在 `src/types/eew.ts` 中扩展联合类型：

```typescript
// 修改前
export type SourceType = 'customSource' | 'simulated';

// 修改后
export type SourceType = 'customSource' | 'simulated' | 'example';
```

> 扩展 `SourceType` 后，需同步更新所有 `Record<SourceType, string>` 类型映射，否则 `tsc --noEmit` 会报缺字段错误。涉及文件：
> - `src/utils/sourceLabels.ts` 的 `SOURCE_NAMES` 和 `SOURCE_AGENCY`
> - `src/components/settings/SourceManageSection.tsx` 的 `SOURCE_TYPE_LABEL`

### 步骤 2：创建适配器文件

在 `src/sources/` 下创建 `XxxAdapter.ts`（如 `ExampleAdapter.ts`），实现 `SourceAdapter` 接口。详见第 5 节的最小实现模板。

### 步骤 3：在 SourceManager 中注册

`SourceManager` 提供 `registerAdapter(config, adapter)` 方法。在实例化各适配器后调用：

```typescript
import {SourceManager} from './SourceManager';
import {ExampleAdapter} from './ExampleAdapter';
import {DEFAULT_CONFIG} from '../types';

const manager = new SourceManager(
  DEFAULT_CONFIG,
  onEvent,
  onStatus,
);

const exampleConfig = DEFAULT_CONFIG.sources.find(s => s.type === 'example')!;
manager.registerAdapter(exampleConfig, new ExampleAdapter(exampleConfig));
```

> `SourceManager` 在多源并行模式下（`useEewStream`），每个启用的源创建独立 manager 实例，无主备切换。

### 步骤 4：更新 DEFAULT_CONFIG（若新增数据源）

在 `src/types/config.ts` 的 `DEFAULT_CONFIG.sources` 中添加新数据源配置（需包含 `category` 字段）：

```typescript
sources: [
  // 合规改造后 DEFAULT_CONFIG.sources 默认为空数组
  // 新增内置源时按需添加：
  {type: 'example', name: '示例数据源', enabled: false, priority: 5, category: 'eew', endpoint: 'wss://example.com/ws'},
],
```

> **合规提示**：v13+ 后 App 不预置任何数据源，所有源由用户通过导入或手动填写配置。新增内置源需谨慎评估合规风险。

### 步骤 5：编写单元测试

在 `src/sources/custom/__tests__/` 下创建 `XxxAdapter.test.ts`，重点测试 `parse` 方法。详见第 7 节测试指南。

## 5. 示例代码：最小 SourceAdapter 实现模板

以下是一个完整的 HTTP 轮询模式适配器模板，带详细注释，可直接作为新数据源的起点：

```typescript
// src/sources/ExampleAdapter.ts
//
// 示例数据源适配器（HTTP 轮询模式）
// 演示如何实现 SourceAdapter 接口，实际数据源应替换 parse 中的字段映射逻辑。

import {
  EewEvent,
  SourceStatus,
  SourceType,
} from '../types';
import {
  SourceAdapter,
  EewEventCallback,
  StatusCallback,
} from './SourceAdapter';
import {SourceConfig} from '../types';

export class ExampleAdapter implements SourceAdapter {
  readonly sourceType: string;
  /** 当前连接状态 */
  private status: SourceStatus = 'disconnected';
  /** 轮询定时器句柄 */
  private timer: ReturnType<typeof setInterval> | null = null;
  /** 事件回调（由 connect 注入） */
  private onEvent?: EewEventCallback;
  /** 状态回调（由 connect 注入） */
  private onStatus?: StatusCallback;
  /** 数据源配置 */
  private config: SourceConfig;

  constructor(config: SourceConfig) {
    this.config = config;
    this.sourceType = config.type;
  }

  async connect(
    onEvent: EewEventCallback,
    onStatus: StatusCallback,
  ): Promise<void> {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.setStatus('connecting');

    const interval = this.config.pollIntervalMs ?? 30000;

    // 立即拉取一次
    await this.poll();

    // 启动定时轮询
    this.timer = setInterval(() => {
      void this.poll();
    }, interval);

    this.setStatus('connected', `${this.sourceType} 已连接`);
  }

  async disconnect(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setStatus('disconnected');
  }

  parse(raw: unknown): EewEvent | EewEvent[] | null {
    if (!raw || typeof raw !== 'object') return null;

    const data = raw as Record<string, unknown>;
    const id = data.id;
    const time = data.time;
    const mag = data.mag;
    const depth = data.depth;
    const lat = data.lat;
    const lng = data.lng;
    const place = data.place;

    if (
      typeof id !== 'string' ||
      typeof time !== 'number' ||
      typeof mag !== 'number' ||
      typeof depth !== 'number' ||
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      typeof place !== 'string'
    ) {
      return null;
    }

    const event: EewEvent = {
      id: `${this.sourceType}-${id}`,
      source: this.sourceType as SourceType,
      originTime: time,
      magnitude: mag,
      depth,
      lat,
      lng,
      location: place,
      receivedAt: Date.now(),
    };

    return event;
  }

  heartbeat(): boolean {
    return this.timer !== null && this.status === 'connected';
  }

  getStatus(): SourceStatus {
    return this.status;
  }

  // ---- 私有辅助 ----

  private async poll(): Promise<void> {
    try {
      const endpoint = this.config.endpoint;
      if (!endpoint) {
        this.setStatus('error', '缺少 endpoint 配置');
        return;
      }
      const resp = await fetch(endpoint);
      const json = await resp.json();
      const parsed = this.parse(json);
      if (parsed && this.onEvent) {
        if (Array.isArray(parsed)) {
          parsed.forEach(e => this.onEvent!(e));
        } else {
          this.onEvent(parsed);
        }
      }
    } catch (err) {
      this.setStatus('error', `拉取失败: ${(err as Error).message}`);
    }
  }

  private setStatus(status: SourceStatus, message?: string): void {
    this.status = status;
    this.onStatus?.(status, message);
  }
}
```

## 6. 连接模式说明

### 6.1 WebSocket 模式（适合实时推送）

适用于提供 WebSocket / SSE 等长连接的数据源，延迟最低。

实现要点：

- `connect` 中创建 `WebSocket` 实例，监听 `onmessage` 事件
- 收到消息后调用 `parse` 解析，通过 `onEvent` 推送
- `onopen` 时上报 `connected`，`onclose` / `onerror` 时上报 `disconnected` / `error`
- `disconnect` 中调用 `ws.close()` 并移除监听
- `heartbeat` 可返回 `ws.readyState === WebSocket.OPEN`
- 推荐实现指数退避重连（参考 `CustomSourceAdapter`）

### 6.2 HTTP 轮询模式（适合 REST API）

适用于仅提供 REST 接口的数据源，实现简单但有轮询间隔的延迟。

实现要点：

- `connect` 中启动 `setInterval`，按 `config.pollIntervalMs`（默认 2000ms）间隔拉取
- 每次拉取后调用 `parse` 解析推送
- `disconnect` 中 `clearInterval`
- `heartbeat` 可通过发起轻量 HEAD 请求或检查定时器是否存活判断
- 心跳超时阈值建议 `max(pollIntervalMs * 3, 10000ms)`

## 7. 测试指南

`parse` 是公开方法，可在不建立连接的情况下直接测试，这是数据源测试的重点。

### 7.1 测试文件位置

在 `src/sources/custom/__tests__/` 下创建 `XxxAdapter.test.ts`：

```
src/sources/custom/__tests__/
├── CustomSourceAdapter.list.test.ts
├── jsonPathExtract.test.ts
├── sourceShare.test.ts
└── ExampleAdapter.test.ts
```

### 7.2 parse 方法单元测试模板

```typescript
// src/sources/custom/__tests__/ExampleAdapter.test.ts
import {ExampleAdapter} from '../../ExampleAdapter';
import {DEFAULT_CONFIG} from '../../../types';

const exampleConfig = {
  type: 'example' as const,
  name: '示例数据源',
  enabled: false,
  priority: 5,
  endpoint: 'https://example.com/api',
};
const adapter = new ExampleAdapter(exampleConfig);

describe('ExampleAdapter.parse', () => {
  it('应正确解析合法 JSON 数据', () => {
    const raw = {
      id: 'EQ-001',
      time: 1783000000000,
      mag: 5.4,
      depth: 12,
      lat: 30.5,
      lng: 103.7,
      place: '四川都江堰',
    };
    const result = adapter.parse(raw);
    expect(result).not.toBeNull();
    expect(result).not.toBeInstanceOf(Array);
    const event = result as import('../../../types').EewEvent;
    expect(event.id).toBe('example-EQ-001');
    expect(event.source).toBe('example');
    expect(event.magnitude).toBe(5.4);
    expect(event.depth).toBe(12);
    expect(event.lat).toBe(30.5);
    expect(event.lng).toBe(103.7);
    expect(event.location).toBe('四川都江堰');
    expect(typeof event.receivedAt).toBe('number');
  });

  it('字段缺失时应返回 null', () => {
    const raw = {id: 'EQ-002', time: 1783000000000};
    expect(adapter.parse(raw)).toBeNull();
  });

  it('null / undefined / 非对象应返回 null', () => {
    expect(adapter.parse(null)).toBeNull();
    expect(adapter.parse(undefined)).toBeNull();
    expect(adapter.parse('string')).toBeNull();
    expect(adapter.parse(123)).toBeNull();
  });
});
```

### 7.3 运行测试

```sh
# 运行所有测试
yarn test

# 仅运行某适配器测试
npx jest ExampleAdapter
```

### 7.4 TypeScript 类型检查

```sh
npx tsc --noEmit
```

应无任何错误输出（exit code 0）。

## 8. 故障切换机制说明

`SourceManager` 实现主备故障切换（单源模式下无备用队列），策略如下（见 `src/sources/SourceManager.ts`）：

### 8.1 启动流程

1. 从 `AppConfig.sources` 中过滤 `enabled === true` 的源
2. 按 `priority` 升序排序
3. 取第一个作为主源调用 `activate`，其余放入 `backupQueue`
4. 若无可用源，上报 `error` 状态

> 注：`useEewStream` 采用**多源并行模式**，每个启用的源创建独立 SourceManager（单源模式，无备用队列），所有源的事件合并到统一列表。

### 8.2 失败累计与切换

- 主源状态变为 `error` 或 `disconnected` 时，`failureCount++`
- `checkHeartbeat()` 调用主源 `heartbeat()` 返回 `false` 时，`failureCount++`
- 当 `failureCount >= heartbeatFailureThreshold`（默认 3 次）且 `backupQueue` 非空时：
  - 从 `backupQueue` 取出下一个备用源
  - 上报 `connecting` 状态（含切换说明）
  - 调用 `activate` 切换主源（重置 `failureCount`）

### 8.3 关键参数

| 参数 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `heartbeatFailureThreshold` | `AppConfig` | 3 | 主源连续失败达到该值后切换备用源 |
| `pollIntervalMs` | `AppConfig` | 30000 | 全局轮询兜底间隔（HTTP 源可在 `SourceConfig.pollIntervalMs` 单独覆盖） |

## 9. 检查清单

新增数据源后，请对照以下清单确认：

- [ ] 在 `src/sources/` 下创建 `XxxAdapter.ts` 并实现 `SourceAdapter` 接口
- [ ] （若需要）在 `src/types/eew.ts` 的 `SourceType` 联合中追加新字面量
- [ ] （若需要）在 `src/types/config.ts` 的 `DEFAULT_CONFIG.sources` 中添加新数据源配置（含 `category` 字段）
- [ ] 同步更新 `src/utils/sourceLabels.ts` 的 `SOURCE_NAMES` 和 `SOURCE_AGENCY` 映射
- [ ] 在初始化处调用 `SourceManager.registerAdapter` 注册适配器
- [ ] `parse` 方法对非法/缺失字段返回 `null`，不抛异常
- [ ] `id` 字段拼接数据源前缀，避免跨源冲突
- [ ] `connect` 中通过 `onStatus` 上报 `connecting` → `connected`，错误时上报 `error`
- [ ] `disconnect` 释放所有底层资源（socket / 定时器）
- [ ] `heartbeat` 返回真实的连接健康状态
- [ ] 在 `__tests__/` 下编写 `parse` 单元测试
- [ ] `npx tsc --noEmit` 通过
- [ ] `npx jest` 通过

## 10. 源导入方式

合规改造（v13+）后，App 不预置任何数据源，用户通过以下 4 种方式导入源配置：

| 方式 | 说明 | 文档 |
|------|------|------|
| 粘贴 JSON | 粘贴其他用户分享的源配置 JSON，解析预览后导入 | [source-share.md](source-share.md) |
| 扫码导入 | 摄像头扫描二维码（单码/分块累积），P2P 离线传输 | [source-share.md](source-share.md) |
| 文件夹扫描 | 扫描应用外部私有目录 `eew_sources/` 下所有 `.json` 文件批量导入 | [file-import.md](file-import.md) |
| 文件选择器 | 通过系统 SAF（Storage Access Framework）选择单个 `.json` 文件导入 | [file-import.md](file-import.md) |

### 10.1 安全设计

- 导入的源强制 `enabled=false`（由 `mergeImported` 保证），用户需手动启用
- 扫码/粘贴导入后展示预览，用户确认后才合并到现有源列表
- 文件夹扫描批量导入时，逐个解析累积有效源，跳过无效文件
- `authToken` 默认不导出（需用户显式勾选）

### 10.2 合并去重策略

`mergeImported` 按 `endpoint`（大小写不敏感）判断源冲突，而非 `priority`：

- 同 endpoint（同 API 地址）：更新现有源配置，保留旧 `priority`
- 不同 endpoint：追加为新源；若 `priority` 与现有源冲突则自动重新分配（从 100 递增）

> 这样可避免"导入测试源覆盖真实源"问题——只要 API 地址不同，即使 `priority` 相同也会作为新源追加，不会覆盖其他无关源。详见 [file-import.md](file-import.md) 第 6 节。

### 10.3 合规免责

在中国境内，个人转发地震预警信息可能违反《地震监测管理条例》等法律法规。App 仅提供导入工具，不预置任何源，源配置的合法合规性由用户自行负责。导入 Modal 顶部显示黄色法律免责横幅提醒用户。

### 10.4 P2P 扫码导入详细说明

完整的协议格式、安全设计、权限说明、合规说明、错误场景处理见 [source-share.md](source-share.md)。

## 11. 原生层锁屏预警数据源

锁屏预警由原生层 `EewBackgroundService` 实现，独立于 JS 层 `CustomSourceAdapter`，确保锁屏时 RN JS 被系统暂停后仍能接收预警数据。

### 11.1 数据源同步机制（多源并行模式）

- **JS 层 → 原生层**：`HomeScreen` 通过 `BackgroundServiceManager.updateCustomSources(sources)` 将所有活跃 customSource 配置同步到原生层 `SharedPreferences`
- **同步时机**：`config.sources` 变化时自动同步（取所有 `enabled && type === 'customSource' && category === 'eew'` 的源，按 priority 升序）
- **同步内容**：多源配置的 JSON 数组字符串（含每个源的 endpoint/protocol/authToken/pollIntervalMs/fieldMapping/priority）

### 11.2 原生层连接逻辑（多源并行）

`EewBackgroundService` 从 SharedPreferences 读取 `customSources` JSON 数组后：
- 为每个源创建独立的 `SourceConnection` 实例（封装 WS/HTTP 连接、重连、数据处理）
- `protocol='ws'`：使用 OkHttp WebSocket 客户端连接 endpoint（URL 查询参数 ?token= 鉴权）
- `protocol='http'`：使用 OkHttp HTTP GET 按配置间隔轮询（Authorization Bearer token 鉴权）
- 每个源独立维护重连状态（指数退避：1s→2s→4s→...→30s 上限）
- 收到数据后调用 `handleSourceData(text, config)` → `EewAlertEngine.parseWithMapping(raw, fieldMapping)` 解析
- **HTTP 明文连接检查**：`SourceConnection.start()` 连接前检查 `allowHttp` 开关（详见 11.4 节）

### 11.3 HTTP 明文连接控制（allowHttp）

#### 背景

Android `network_security_config.xml` 不支持 CIDR 通配符（无法配置 `192.168.*.*`），因此系统层全局允许 cleartext traffic，由应用层通过 `allowHttp` 开关控制是否放行 HTTP endpoint。

#### 配置项

| 配置 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `AppConfig.allowHttp` | `src/types/config.ts` | `false` | 全局 HTTP 明文连接开关 |

#### 行为

| allowHttp | HTTP endpoint (localhost) | HTTP endpoint (局域网/公网) | HTTPS endpoint |
|-----------|--------------------------|----------------------------|----------------|
| `false`（默认） | ✅ 允许 | ❌ 拒绝 | ✅ 允许 |
| `true` | ✅ 允许 | ✅ 允许 | ✅ 允许 |

#### 检查点（双层检查）

1. **JS 层**（前台）：`useEewStream.startSources()` 创建 adapter 前检查 endpoint 协议
   - `allowHttp=false` 时跳过非 localhost 的 HTTP 源（日志：`跳过 HTTP 源（allowHttp=false）`）
   - `allowHttp` 变化时自动重连所有源（useEffect 依赖 `config?.allowHttp`）

2. **原生层**（后台/锁屏）：`EewBackgroundService.SourceConnection.start()` 连接前检查 endpoint 协议
   - `allowHttp=false` 时拒绝非 localhost 的 HTTP 源（日志：`源 xxx 跳过 HTTP 连接（allowHttp=false）`）
   - `allowHttp` 变化时通过 `BackgroundServiceModule.updateAllowHttp()` 触发 `reloadCustomSources()` 重连

#### 配置同步

- JS 层 `HomeScreen.tsx` 通过 `BackgroundServiceManager.updateAllowHttp(allowHttp)` 同步到原生层
- 原生层 `BackgroundServiceModule.updateAllowHttp(allowHttp)` 写入 SharedPreferences 并触发重连

#### 系统层配置

`res/xml/network_security_config.xml` 全局 `cleartextTrafficPermitted="true"`，系统不阻止任何 HTTP 连接，完全由应用层 `allowHttp` 开关控制。

### 11.4 原生层 FieldMapping 解析器

`FieldMappingParser.kt`（位于 `android/app/src/main/java/com/mdoeeewapp/android/cn/background/`）是 JS 层 `jsonPathExtract.ts` 的 Kotlin 移植版，提供以下 API：

| 方法 | 说明 |
|------|------|
| `extractByPath(root, path)` | 通用路径提取（支持 `$.field`、`$.a.b[0].c`、`$.field?`、`$.time * 1000`） |
| `extractString(obj, path)` | 提取字符串字段 |
| `extractNumber(obj, path)` | 提取数值字段 |
| `extractBoolean(obj, path)` | 提取布尔字段 |
| `extractArray(root, listPath)` | 提取数组（用于 listPath 配置） |

详见 [floating-window.md](floating-window.md) 第 8 节"原生层预警引擎改造"。
