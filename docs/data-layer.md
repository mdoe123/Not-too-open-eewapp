# 数据层设计

本文档说明地震预警 App 的统一数据模型与数据源接口设计。对应代码位于 `src/types/` 与 `src/sources/`。

## 1. 设计目标

- **统一数据结构**：所有数据源解析后输出同一 `EewEvent` 结构，上层无需关心来源差异。
- **可插拔数据源**：通过 `SourceAdapter` 抽象接口，新增数据源只需实现接口并注册，无需改动上层。
- **故障切换**：`SourceManager` 按优先级维护主备源，心跳失败达到阈值后自动切换至备用源。
- **可测试性**：`parse` 作为公开方法暴露，便于对解析逻辑进行单元测试。
- **合规设计**：App 不预置任何数据源，所有源由用户通过导入或手动填写配置（v13+ 合规改造）。

## 2. 目录结构

```
src/
├── types/
│   ├── eew.ts             # 核心数据模型：EewEvent、SourceType、SourceCategory、SourceStatus、AlertLevel、UserLocation
│   ├── config.ts          # 配置类型：SourceConfig、FieldMapping、AlertConfig、AppConfig、DEFAULT_CONFIG（CURRENT_CONFIG_VERSION=13）
│   └── index.ts           # 统一导出
└── sources/
    ├── SourceAdapter.ts        # 数据源适配器抽象接口
    ├── SourceManager.ts        # 数据源管理器（主备切换 + 心跳探活）
    └── custom/                 # 自定义数据源适配器（WS + HTTP 双协议）+ 字段映射解析器 + 源分享/导入工具
        ├── CustomSourceAdapter.ts        # 自定义源适配器实现
        ├── jsonPathExtract.ts            # JSON 路径表达式解析器（$.field、$.a.b[0].c、$.time * 1000）
        ├── sourceShare.ts                # 源配置分享/导入工具（导出/解析/校验/合并）
        ├── index.ts                      # 统一导出 + createCustomSourceAdapter 工厂函数
        └── __tests__/
            ├── CustomSourceAdapter.list.test.ts   # listPath 列表 API 单元测试
            ├── jsonPathExtract.test.ts            # 路径表达式解析单元测试
            └── sourceShare.test.ts                # 源分享/导入单元测试

src/utils/
└── logger.ts              # 数据层调试日志（统一前缀 [EEW:模块]，输出到 logcat）

__tests__/
└── sources/               # 数据源相关测试
```

> `CustomSourceAdapter` 是 App 唯一支持的真实数据源适配器，同时支持 WebSocket 和 HTTP GET 轮询，根据 `config.protocol` 选择模式。所有字段提取通过 `jsonPathExtract.ts` 的路径表达式解析器完成。详见 [data-source-guide.md](data-source-guide.md) 第 3 节。

## 3. 核心类型

### 3.1 EewEvent（统一预警事件）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 事件唯一 ID（数据源 + 主机名 + 原始 ID 拼接，如 `customSource-api.example.com-EQ-001`） |
| `source` | `SourceType` | 数据来源 |
| `originTime` | `number` | 发震时间（Unix 毫秒） |
| `magnitude` | `number` | 震级 |
| `depth` | `number` | 震源深度（km） |
| `lat` / `lng` | `number` | 震中经纬度 |
| `location` | `string` | 震中位置描述 |
| `intensity?` | `number` | 预估烈度（可选） |
| `isFinal?` | `boolean` | 是否最终确定结果（vs 初报） |
| `isCancel?` | `boolean` | 是否取消报（JMA 数据源支持） |
| `receivedAt` | `number` | App 接收时间（Unix 毫秒） |
| `reportNum?` | `number` | 报数（第几报，如 CENC 的 ReportNum） |
| `reportType?` | `string` | 测定类型（如 `auto`=自动测定、`reviewed`=正式测定）。JS 层 EqInfoCard 据此显示标签；原生层悬浮窗内容和系统消息通知副标题也使用此字段 |
| `sourceName?` | `string` | 数据源显示名称 |

### 3.2 SourceType

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

> `SourceCategory` 用于界面分组显示：`eew`（预警数据源）与 `eqlist`（速报数据源）。
> 界面显示名称由 `SOURCE_NAMES` 映射决定（`src/utils/sourceLabels.ts`）：`customSource` → "自定义数据源"，`simulated` → "模拟预警"。

### 3.3 SourceStatus

```typescript
type SourceStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
```

### 3.4 AlertLevel

```typescript
type AlertLevel = 'silent' | 'blue' | 'yellow' | 'orange' | 'red';
```

严重程度由低到高（按预估地震烈度分档，DB/T 113.1-2026 标准）。由 App 根据震级与用户距离计算，不由数据源直接给出。

### 3.5 UserLocation

用于计算距离与烈度衰减，包含 `lat`、`lng`、可选 `accuracy` 与 `timestamp`。

## 4. 配置类型

### 4.1 SourceConfig

单个数据源配置：

| 字段 | 必填 | 说明 |
|------|------|------|
| `type` | ✅ | 数据源类型，当前仅支持 `'customSource'` |
| `name` | ✅ | 显示名称 |
| `enabled` | ✅ | 是否启用 |
| `priority` | ✅ | 优先级（数字越小越优先） |
| `category` | ✅ | 数据源分类（`'eew'` 或 `'eqlist'`） |
| `endpoint` | ❌ | API/WebSocket URL |
| `protocol` | ❌ | 连接协议（`'ws'` 或 `'http'`，仅 customSource 使用） |
| `fieldMapping` | ❌ | 字段映射规则（仅 customSource 使用） |
| `authToken` | ❌ | 鉴权 token（仅 customSource 使用，不持久化） |
| `apiKey` | ❌ | 鉴权密钥（保留兼容，不持久化） |
| `pollIntervalMs` | ❌ | 轮询间隔（HTTP 源使用，毫秒） |
| `note` | ❌ | 用户备注（仅 customSource 使用） |

> `priority`：数字越小越优先，主源选择与备用队列排序均依据此字段。
> `category`：数据源分类（`'eew'` 或 `'eqlist'`），用于界面分组显示。

### 4.2 FieldMapping

自定义源字段映射规则，详见 [data-source-api.md](data-source-api.md) 第 3 节。

### 4.3 AlertConfig

报警阈值与方式：

- 阈值：`minMagnitude`（默认 3.0）、`lockScreenIntensity`（默认 4，范围 -3~6）
- 方式：`soundEnabled`、`vibrationEnabled`、`flashlightEnabled`、免打扰时段 `quietHoursStart` / `quietHoursEnd`（"HH:mm"）
- 系统能力：`backgroundEnabled`、`floatingWindowEnabled`、`lockScreenEnabled`、`autoStartEnabled`

### 4.4 AppConfig 与 DEFAULT_CONFIG

`AppConfig` 顶层聚合 `sources` / `alert` / `location` / `debug` / `pollIntervalMs` / `heartbeatFailureThreshold`。

`DEFAULT_CONFIG` 提供开箱即用的默认值：

- **sources**：空数组 `[]`（合规改造后不预置任何数据源）
- 全局轮询兜底 30000ms
- 心跳失败切换阈值 3 次
- 配置版本号 `CURRENT_CONFIG_VERSION = 13`

### 4.5 配置版本历史

| 版本 | 说明 |
|------|------|
| v1 | 初始版本 |
| v2 | 新增 SourceConfig.category 字段；新增 4 个 eqlist 数据源 |
| v3 | 新增 2 个测试数据源 |
| v4 | 移除测试数据源（改用模拟预警页面替代） |
| v5 | 新增 LocationConfig（GPS/手动模式切换） |
| v6 | 默认启用 wolfxGetCencEqlist 数据源 |
| v7 | 新增 DebugConfig（远程日志调试） |
| v8 | 新增 AlertConfig.flashlightEnabled 字段 |
| v9 | 移除 AlertConfig.lockScreenMagnitude 字段；lockScreenIntensity 范围调整为 -3~6 |
| v10 | 新增 SourceType 'customSource'；SourceConfig 新增 protocol/fieldMapping/authToken/note 可选字段 |
| v11 | 合规改造——DEFAULT_CONFIG.sources 清空为 []；保留 wolfx 适配器代码做向后兼容 |
| v12 | FieldMapping 新增可选 listPath 字段，支持列表 API 直消费 |
| v13 | **彻底合规改造**——删除所有 wolfx* 适配器代码和 SourceType 字面量。SourceType 联合仅保留 `'customSource' | 'simulated'`。强制清空所有 type 非 'customSource' 的源。新增文件夹扫描和文件选择器导入入口。原生层 EewBackgroundService 改为读 customSource 配置。 |

## 5. SourceAdapter 接口

所有数据源必须实现：

```typescript
interface SourceAdapter {
  readonly sourceType: string;
  connect(onEvent, onStatus): Promise<void>;
  disconnect(): Promise<void>;
  parse(raw: unknown): EewEvent | EewEvent[] | null;
  heartbeat(): boolean;
  getStatus(): SourceStatus;
}
```

设计要点：

1. `connect` / `disconnect` 负责连接生命周期；连接类型（WebSocket / HTTP 轮询）由实现决定。
2. `parse` 公开，可在不建立连接的情况下对解析逻辑做单元测试。
3. `heartbeat` 由 `SourceManager` 周期性调用，返回 `false` 即视为失败一次。

## 6. SourceManager 故障切换策略

### 6.1 启动流程

1. 从 `sources` 中过滤 `enabled` 的源
2. 按 `priority` 升序排序
3. 取第一个作为主源调用 `activate`，其余放入 `backupQueue`
4. 若无可用源，上报 `error` 状态

### 6.2 失败累计与切换

- 主源状态变为 `error` 或 `disconnected` 时，`failureCount++`
- 心跳检查 `heartbeat()` 返回 `false` 时，`failureCount++`
- 当 `failureCount >= threshold` 且 `backupQueue` 非空时：
  - 从 `backupQueue` 取出下一个备用源
  - 上报 `connecting` 状态（含切换说明）
  - 调用 `activate` 切换主源（重置 `failureCount`）

### 6.3 心跳成功

`checkHeartbeat()` 中若主源心跳成功，重置 `failureCount = 0`，避免偶发抖动累积导致误切换。

### 6.4 接口预留

- `registerAdapter(config, adapter)`：供具体数据源适配器实例化后注册
- `stop()`：停止管理器并断开当前主源

### 6.5 useEewStream 多源并行架构

`useEewStream` Hook 采用**多源并行模式**（替代原双 SourceManager 主备切换架构）：

- 每个启用的数据源创建独立 SourceManager（单源模式，无备用队列）
- customSource 源用 `createCustomSourceAdapter` 工厂创建
- 所有源的事件合并到同一列表（eew / eqlist 各一个），按 `originTime` 降序排序
- 模拟预警事件通过 `simulatedEventBus` 单例总线注入（useEewStream 订阅，收到事件注入 `events` 列表）
- 跨源去重：同一地震可能被多个机构报告，以 `originTime+坐标+震级` 组合键去重（坐标四舍五入到 0.01 度约 1km 容差）

| 列表 | 来源 | 上限 | 清理策略 |
|------|------|------|---------|
| `events` | eew 预警源 | 20 条 | `isFinal=true` 立即移除；5 分钟超时清理 |
| `eqlistEvents` | eqlist 速报源 | 50 条 | `isFinal=true` 不移除（正式测定）；5 分钟超时清理 |

设计要点：
- **单源模式**：每个 SourceManager 只管理一个源，`start([singleSource])` 传入单元素数组，无备用队列
- **全局状态聚合**：任一源 connected 则全局 connected，全部 error/disconnected 则全局 error
- **事件合并去重**：`mergeEvent` 函数处理同源同事件更新（按 id）和跨源同事件去重（按 dedupKey）
- **isFinal 语义差异**：eew 的 `isFinal=true` 表示"预警终止/取消报"，立即移除；eqlist 的 `isFinal=true` 表示"正式测定结果"，**不移除**
- **机构标签**：`src/utils/sourceLabels.ts` 提供 `getSourceAgency(source)` 返回机构简称（如"自定义"），用于卡片标注机构

### 6.6 模拟预警事件总线（simulatedEventBus）

用于跨页面注入模拟预警事件。位于 `src/utils/simulatedEventBus.ts`。

**设计原因**：

- `useEewStream` 是 Hook，各页面（HomeScreen/SettingsScreen/SimulateAlertScreen）调用时创建独立实例，state 不共享
- 模拟预警页面（独立路由）需要将事件注入 HomeScreen 的 `eewStream.events`
- 使用模块级单例发布订阅模式，避免重构为 Context Provider

**接口**：

| 方法 | 说明 |
|------|------|
| `emit(event: EewEvent)` | 模拟预警页面触发，发射一条模拟 EewEvent |
| `subscribe(listener): () => void` | useEewStream 订阅，收到事件注入 events 列表，返回取消订阅函数 |

**事件流**：

1. SimulateAlertScreen 配置参数（震级/深度/震中距/延时）后触发
2. 构造 EewEvent（`source: 'simulated'`, `isFinal: false`）
3. 调用 `simulatedEventBus.emit(event)`
4. useEewStream 订阅回调调用 `mergeEvent(setEvents, event, MAX_EEW_EVENTS, true)` 注入列表
5. 模拟事件走正常 eew 超时清理（5 分钟后自动移除）

> `simulated` 仅用于事件标识，不是数据源配置项（不在 `DEFAULT_CONFIG.sources` 中），不创建 SourceManager。

## 7. 数据源导入方式

合规改造后，App 不预置任何数据源，用户通过以下 4 种方式导入源配置：

| 方式 | 说明 | 文档 |
|------|------|------|
| 粘贴 JSON | 粘贴其他用户分享的源配置 JSON | [source-share.md](source-share.md) |
| 扫码导入 | P2P 二维码离线分享 | [source-share.md](source-share.md) |
| 文件夹扫描 | 扫描应用外部私有目录 `eew_sources/` 下 `.json` 文件 | [file-import.md](file-import.md) |
| 文件选择器 | 系统 SAF 选择单个 `.json` 文件 | [file-import.md](file-import.md) |

## 8. 类型检查

在 `android-eew-app/` 目录下执行：

```sh
npx tsc --noEmit
```

应无任何错误输出（exit code 0）。

## 9. 单元测试

> 注意：项目当前 `jest.config.js` 引用的 `@react-native/jest-preset` 是 `react-native` 0.86 的可选 peer 依赖。若运行时报找不到 preset，需补装：
>
> ```sh
> yarn add -D @react-native/jest-preset@0.86.0
> ```

测试位于 `src/sources/custom/__tests__/`，覆盖：
- `CustomSourceAdapter.list.test.ts`：listPath 列表 API 解析
- `jsonPathExtract.test.ts`：路径表达式解析（含四则运算、可选标记、数组索引）
- `sourceShare.test.ts`：源配置分享/导入（导出/解析/校验/合并）

## 10. 调试日志

数据层全链路接入调试日志（`src/utils/logger.ts`），统一前缀 `[EEW:模块]`，便于 adb logcat 过滤。

### 10.1 模块标签

| 标签 | 模块 | 覆盖节点 |
|------|------|---------|
| `[EEW:CUSTOM]` | `CustomSourceAdapter` | connect/disconnect/轮询/HTTP状态/WS消息/解析结果/推送/错误 |
| `[EEW:MGR]` | `SourceManager` | start/activate/handleFailure/切换备用源/心跳失败/退避重试/stop |
| `[EEW:STREAM]` | `useEewStream` | startManager/事件接收(eew+eqlist)/状态变化/超时清理/disconnect/reconnect |

### 10.2 查看日志

React Native 的 `console.log` 输出到 logcat 的 `ReactNativeJS` tag。查看数据层日志：

```sh
# 实时查看（只看 EEW 数据层日志）
adb logcat -s ReactNativeJS:* | grep "EEW:"

# 拉取历史日志
adb logcat -s ReactNativeJS:* -d | grep "EEW:"

# 导出到文件供分析
adb logcat -s ReactNativeJS:* -d > logcat.txt
```

### 10.3 日志开关

`src/utils/logger.ts` 中的 `LOG_ENABLED` 常量控制日志总开关：
- `true`（默认）：开发阶段开启，输出全链路日志
- `false`：生产环境关闭，无 logcat 噪音

### 10.4 日志示例

App 启动后数据源初始化的典型日志（用户配置了一个 WS customSource）：

```
[EEW:STREAM] 14:13:05.109 startManager {"eew":1,"eqlist":0}
[EEW:MGR] 14:13:05.111 start {"primary":"customSource","backupCount":0,"enabledCount":1}
[EEW:MGR] 14:13:05.111 activate customSource
[EEW:STREAM] 14:13:05.111 eew状态 connecting
[EEW:CUSTOM] 14:13:05.112 connect WS 示例 EEW 源 {"url":"wss://api.example.com/eew"}
[EEW:STREAM] 14:13:06.658 eew状态 connected
[EEW:CUSTOM] 14:13:06.659 WS 已连接
```
