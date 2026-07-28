# 数据源 API 文档

本文档记录 customSource 自定义数据源的配置规范、字段映射规则、鉴权方式与典型 API 接入示例。对应代码位于 `src/sources/custom/`。

> 合规改造（v13+）后，App 不再预置任何 wolfx 等第三方数据源端点，所有数据源由用户自行配置。本文档描述 customSource 适配器如何消费用户配置。

## 1. 概述

### customSource 自定义数据源

customSource 是 App 唯一支持的真实数据源类型。用户通过设置页填写：
- **endpoint**：API/WebSocket URL
- **protocol**：连接协议（`ws` 或 `http`）
- **fieldMapping**：字段映射规则（按路径表达式从 JSON 提取字段）
- **authToken**：鉴权 token（可选）
- **pollIntervalMs**：HTTP 轮询间隔（可选，默认 2000ms）

| 协议 | 适用场景 | 鉴权方式 | 延迟 |
|------|---------|---------|------|
| `ws`（WebSocket） | 实时推送 API | URL 追加 `?token=<authToken>` 查询参数 | 最低 |
| `http`（GET 轮询） | REST API | 请求头 `Authorization: Bearer <authToken>` | 取决于 `pollIntervalMs` |

### 数据源分类（SourceCategory）

| 类别 | 说明 | 用途 |
|------|------|------|
| `eew` | 预警数据源 | 震前几秒到几十秒预警，实时性要求高 |
| `eqlist` | 速报数据源 | 震后几分钟内的地震信息列表 |

`SourceConfig.category` 字段标识数据源分类，用于界面分组显示与事件列表分离（`events` 与 `eqlistEvents`）。

---

## 2. 适配器架构

### 类继承关系

```
SourceAdapter（抽象接口）
└── CustomSourceAdapter（自定义源适配器，WS + HTTP 双协议实现）
```

`CustomSourceAdapter` 同时支持 WebSocket 和 HTTP GET 轮询，根据 `config.protocol` 选择模式。所有字段提取通过 `jsonPathExtract.ts` 的路径表达式解析器完成。

### CustomSourceAdapter 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| 轮询间隔（HTTP） | 2000ms | 可通过 `config.pollIntervalMs` 覆盖 |
| 心跳超时（HTTP） | `max(pollIntervalMs * 3, 10000ms)` | 超时判定为不健康，触发备源切换 |
| 重连机制（WS） | 指数退避，初始 1s，倍数 2，上限 30s | 1→2→4→8→16→30→30... |
| 心跳检测（WS） | 检查 `ws.readyState === WebSocket.OPEN` | — |
| 主动关闭 | `disconnect()` 标记 `isManualClose=true`，不触发重连 | — |

### EewEvent 输出结构

```typescript
interface EewEvent {
  id: string;           // `customSource-${extractHost(endpoint)}-${eventId}`
  source: 'customSource';
  originTime: number;   // Unix 毫秒
  magnitude: number;
  depth: number;        // km
  lat: number;          // [-90, 90]
  lng: number;          // [-180, 180]
  location: string;
  intensity?: number;   // 可选，缺省时 App 自行计算
  isFinal?: boolean;    // 可选
  isCancel?: boolean;   // 可选
  receivedAt: number;   // Unix 毫秒
}
```

### 工厂函数

`createCustomSourceAdapter(config)`（`src/sources/custom/index.ts`）根据 `SourceConfig` 创建 `CustomSourceAdapter` 实例：

```typescript
import {createCustomSourceAdapter} from './sources/custom';

const adapter = createCustomSourceAdapter(sourceConfig);
if (adapter) {
  manager.registerAdapter(sourceConfig, adapter);
}
```

> 类型检查：仅 `config.type === 'customSource'` 时返回实例，否则返回 `null`。

---

## 3. FieldMapping 字段映射规则

`FieldMapping` 接口（定义于 `src/types/config.ts`）描述如何从 API 返回的 JSON 中提取 `EewEvent` 字段。

### 3.1 字段定义

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `listPath` | `string` | ❌ | 列表路径（批量 API 用），未配置时按单事件解析 |
| `eventId` | `string` | ✅ | 事件唯一 ID 路径 |
| `originTime` | `string` | ✅ | 发震时间路径（Unix 毫秒；秒级时间戳可用 `$.time * 1000`） |
| `magnitude` | `string` | ✅ | 震级路径 |
| `depth` | `string` | ✅ | 震源深度 km 路径 |
| `lat` | `string` | ✅ | 震中纬度路径 |
| `lng` | `string` | ✅ | 震中经度路径 |
| `location` | `string` | ✅ | 震中位置描述路径 |
| `intensity` | `string` | ❌ | 预估烈度路径（缺省时 App 自行计算） |
| `isFinal` | `string` | ❌ | 是否最终报路径（默认 false） |
| `isCancel` | `string` | ❌ | 是否取消报路径（默认 false） |

### 3.2 路径表达式语法

| 语法 | 示例 | 说明 |
|------|------|------|
| 根对象 | `$` | 整个响应根对象 |
| 字段访问 | `$.id`、`$.data.mag` | 嵌套字段 |
| 数组索引 | `$.events[0].id` | 数组下标 |
| 可选标记 | `$.intensity?` | 缺失时返回 undefined（不报错） |
| 四则运算 | `$.time * 1000`、`$.depth / 1000` | 路径与数字字面量的 + - * / |
| 函数调用 | `Date.parse($.time)` | 解析日期字符串为 Unix 毫秒 |
| glob 通配符 | `$.No*` | 按 key 前缀匹配，提取为对象数组（仅 listPath 使用） |

**运算规则**：
- 操作数可为路径（`$.xxx`）或数字字面量（`1000`、`3.14`）
- 表达式中只能有一个运算符（不支持复合表达式如 `$.a + $.b * 2`）
- 运算结果用于填充目标字段

**可选标记 `?`**：
- 路径以 `?` 结尾表示该字段可选（如 `$.intensity?`）
- 缺失时返回 `undefined`，适配器使用默认值（intensity/isFinal/isCancel 默认 undefined/false）
- 必填字段缺失时返回 `null`，整个事件解析失败

**函数调用 `Date.parse(<path>)`**：
- 将日期字符串解析为 Unix 毫秒，用于 `originTime` 等需要时间戳的字段
- 支持格式（统一按 **UTC+8** 时区解析，不依赖设备时区）：
  - `"2026-07-18 13:47:20"`（wolfx 风格，空格分隔）
  - `"2026-07-18T13:47:20"`（ISO 8601 无时区，按 UTC+8）
  - `"2026-07-18T13:47:20+08:00"`（ISO 8601 带时区，直接解析）
  - 纯数字字符串或数字：作为 Unix 时间戳直接返回
- 解析失败返回 `undefined`，必填字段缺失时整个事件解析失败
- 适用场景：wolfx CENC EEW/Eqlist 等返回 `"2026-07-18 13:47:20"` 字符串的 API

**glob 通配符 `$.No*`**：
- 仅用于 `listPath`，按 key 前缀匹配 JSONObject 的字段，提取为对象数组
- 仅支持末尾 `*`（不支持 `No*Suffix` 或 `*Prefix`）
- 前缀长度必须 ≥1（`$.*` 不合法）
- 匹配规则：key 以 `No` 开头且长度大于前缀长度（如 `No1`、`No2`...`No50`）
- 不匹配的 key（如 `md5`）被跳过
- 未匹配任何 key 返回空数组
- 适用场景：wolfx CENC Eqlist 返回 `{No1:{...}, No2:{...}, ..., No50:{...}, md5:"..."}` 这种平铺结构

### 3.3 listPath 列表 API 支持

若 API 返回事件数组（如 USGS 的 `{features:[...]}`），配置 `listPath` 后：
1. 适配器先用 `listPath` 从响应根对象提取数组
2. 再对每个数组元素应用字段映射（此时路径相对于元素）
3. 返回 `EewEvent[]`，由上层逐条推送

`listPath` 支持两种语法：
- **直接数组路径**：`$.features`、`$.data.events`（提取数组字段）
- **glob 通配符**：`$.No*`（按 key 前缀匹配，将平铺对象收集为数组，详见 3.2）

未配置 `listPath` 时，按单事件解析（对根对象直接提取字段）。

---

## 4. 典型 API 接入示例

### 4.1 单事件 WebSocket API

假设有 WebSocket API `wss://api.example.com/eew`，推送 JSON 消息：

```json
{
  "eventId": "EQ-2026-001",
  "time": 1783000000,
  "mag": 5.4,
  "depth": 12,
  "lat": 30.5,
  "lng": 103.7,
  "place": "四川都江堰",
  "intensity": 4.5,
  "isFinal": false
}
```

**SourceConfig 配置**：

```json
{
  "type": "customSource",
  "name": "示例 EEW 源",
  "enabled": true,
  "priority": 1,
  "category": "eew",
  "protocol": "ws",
  "endpoint": "wss://api.example.com/eew",
  "authToken": "your-token-here",
  "fieldMapping": {
    "eventId": "$.eventId",
    "originTime": "$.time * 1000",
    "magnitude": "$.mag",
    "depth": "$.depth",
    "lat": "$.lat",
    "lng": "$.lng",
    "location": "$.place",
    "intensity": "$.intensity?",
    "isFinal": "$.isFinal?"
  }
}
```

> 注意 `$.time * 1000`：API 返回秒级时间戳，需乘以 1000 转换为毫秒。

### 4.2 列表 HTTP 轮询 API

假设有 REST API `https://api.example.com/eqlist`，返回：

```json
{
  "features": [
    {
      "id": "us7000abcd",
      "properties": {
        "time": 1783000000000,
        "mag": 4.2,
        "depth": 15.0,
        "place": "某地"
      },
      "geometry": {
        "coordinates": [103.7, 30.5]
      }
    }
  ]
}
```

**SourceConfig 配置**：

```json
{
  "type": "customSource",
  "name": "示例速报源",
  "enabled": true,
  "priority": 10,
  "category": "eqlist",
  "protocol": "http",
  "endpoint": "https://api.example.com/eqlist",
  "pollIntervalMs": 10000,
  "authToken": "your-token-here",
  "fieldMapping": {
    "listPath": "$.features",
    "eventId": "$.id",
    "originTime": "$.properties.time",
    "magnitude": "$.properties.mag",
    "depth": "$.properties.depth",
    "lat": "$.geometry.coordinates[1]",
    "lng": "$.geometry.coordinates[0]",
    "location": "$.properties.place"
  }
}
```

> 注意：`listPath: '$.features'` 配置后，下列字段路径相对于数组元素（而非根对象）。
> `$.geometry.coordinates[1]` 是纬度（GeoJSON 格式坐标顺序为 [lng, lat]）。

### 4.3 无鉴权的简单 HTTP API

```json
{
  "type": "customSource",
  "name": "公开速报源",
  "enabled": true,
  "priority": 20,
  "category": "eqlist",
  "protocol": "http",
  "endpoint": "https://api.example.com/public/eqlist",
  "pollIntervalMs": 30000,
  "fieldMapping": {
    "listPath": "$.data",
    "eventId": "$.eid",
    "originTime": "$.ts",
    "magnitude": "$.m",
    "depth": "$.d",
    "lat": "$.la",
    "lng": "$.lo",
    "location": "$.loc"
  }
}
```

### 4.4 wolfx CENC 预警源（HTTP + Date.parse）

[wolfx.jp](https://wolfx.jp/apidoc_en) 转发的中国地震台网中心地震预警 API：
- 端点：`https://api.wolfx.jp/cenc_eew.json`
- 单事件返回（无 `type` 字段，时间字段为 `"2026-07-18 13:47:20"` UTC+8 字符串）

```json
{
  "type": "customSource",
  "name": "中国地震台网 EEW 预警",
  "enabled": true,
  "priority": 100,
  "category": "eew",
  "protocol": "http",
  "endpoint": "https://api.wolfx.jp/cenc_eew.json",
  "pollIntervalMs": 2000,
  "fieldMapping": {
    "eventId": "$.EventID",
    "originTime": "Date.parse($.OriginTime)",
    "magnitude": "$.Magnitude",
    "depth": "$.Depth",
    "lat": "$.Latitude",
    "lng": "$.Longitude",
    "location": "$.HypoCenter",
    "intensity": "$.MaxIntensity"
  }
}
```

> 关键点：`originTime: "Date.parse($.OriginTime)"` 用于将 `"2026-07-18 13:47:20"` 字符串解析为 Unix 毫秒（按 UTC+8 时区）。
> 完整示例文件：[docs/examples/cenc_eew.json](examples/cenc_eew.json)

### 4.5 wolfx CENC 速报源（HTTP + glob 通配符）

wolfx 转发的中国地震台网中心地震速报 API：
- 端点：`https://api.wolfx.jp/cenc_eqlist.json`
- 返回 `No1...No50` 平铺键值对结构 + `md5` 校验字段，字段值均为字符串

```json
{
  "type": "customSource",
  "name": "中国地震台网速报列表",
  "enabled": true,
  "priority": 101,
  "category": "eqlist",
  "protocol": "http",
  "endpoint": "https://api.wolfx.jp/cenc_eqlist.json",
  "pollIntervalMs": 30000,
  "fieldMapping": {
    "listPath": "$.No*",
    "eventId": "$.time",
    "originTime": "Date.parse($.time)",
    "magnitude": "$.magnitude",
    "depth": "$.depth",
    "lat": "$.latitude",
    "lng": "$.longitude",
    "location": "$.location",
    "intensity": "$.intensity"
  }
}
```

> 关键点：
> - `listPath: "$.No*"`：用 glob 通配符匹配 `No1`、`No2`...`No50` 共 50 个 key，自动跳过 `md5`
> - `originTime: "Date.parse($.time)"`：将 `"2024-04-07 05:15:09"` 字符串解析为 Unix 毫秒
> - `eventId: "$.time"`：eqlist 无显式 ID 字段，用 time 字符串作为唯一标识
> - 字段值均为字符串，`extractNumber` 自动转换为数字
>
> 完整示例文件：[docs/examples/cenc_eqlist.json](examples/cenc_eqlist.json)

---

## 5. 鉴权设计

### 5.1 HTTP Bearer Token

HTTP 轮询模式下，`authToken` 非空时，适配器在请求头添加：

```
Authorization: Bearer <authToken>
```

### 5.2 WebSocket Query 参数

WebSocket 模式下，`authToken` 非空时，适配器在 URL 追加查询参数：

```
wss://api.example.com/eew?token=<authToken>
```

### 5.3 安全设计

- `authToken` 与 `apiKey` 一样，**不持久化到 AsyncStorage**（仅运行时内存持有）
- 导出源配置时默认剥离 `authToken`，用户需显式勾选"包含鉴权 token"才保留
- `authToken` 仅用于上述两种鉴权方式，不参与字段映射或 URL 路径拼接

---

## 6. 关键实现细节

### 6.1 事件 ID 生成

为避免多个 customSource 之间 ID 冲突，`EewEvent.id` 格式为：

```
customSource-<host>-<eventId>
```

`<host>` 从 `endpoint` 提取主机名（如 `api.example.com`），`<eventId>` 是字段映射提取的原始事件 ID。

### 6.2 跨源去重

`useEewStream` Hook 在合并事件时按以下组合键去重：

```
dedupKey = `${originTime}_${lat.toFixed(2)}_${lng.toFixed(2)}_${magnitude.toFixed(1)}`
```

坐标四舍五入到 0.01 度（约 1km）容差，避免各源精度差异导致漏去重。先到达的事件保留，后到达的同事件丢弃。

### 6.3 解析失败处理

- **必填字段缺失**：返回 `null`，整个事件解析失败，不推送
- **可选字段缺失**：使用默认值（`intensity` 默认 undefined，`isFinal`/`isCancel` 默认 false）
- **listPath 提取失败**：返回 `null`，整个响应解析失败
- **JSON 解析失败**：返回 `null`，不抛异常

### 6.4 字段类型转换

`jsonPathExtract.ts` 提供的 `extractNumber` 兼容数值或字符串类型：
- 数值：原样返回
- 字符串：尝试 `parseFloat`，NaN 时返回 `undefined`
- 其他类型：返回 `undefined`

`extractBoolean` 兼容：
- 布尔：原样返回
- 字符串 `"true"`/`"1"`：返回 `true`，其他返回 `false`
- 数字 `1`/`0`：返回 `true`/`false`

---

## 7. 默认配置

文件 `src/types/config.ts` 中的 `DEFAULT_CONFIG`：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| sources | `[]`（空数组） | 合规改造后不预置任何数据源 |
| 心跳失败阈值 | 3 | 连续 3 次心跳失败后切换备源 |
| 全局轮询兜底间隔 | 30000ms | 所有 HTTP 源的默认轮询间隔上限 |

### SourceType 完整定义

`src/types/eew.ts` 定义了 2 个 sourceType 标识：

| 类别 | sourceType 标识 | 说明 |
|------|-----------------|------|
| 真实数据源 | `customSource` | 用户配置的自定义数据源（HTTP/WebSocket + 字段映射） |
| 测试标识 | `simulated` | 模拟预警页面手动触发的测试事件（非数据源） |

### 配置版本号

`CURRENT_CONFIG_VERSION = 13`，对应 v13 强制清空迁移逻辑（见 `useConfig.ts`）：

- 老用户升级到 v13 时，所有 `type` 非 `'customSource'` 的源被强制清空
- 老用户需通过扫码导入/文件夹扫描/文件选择器/手动填写重新配置源
- 详见 [data-layer.md](data-layer.md) 第 4 节"配置类型"
