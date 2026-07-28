# 源配置 P2P 分享指南（二维码扫码导入）

本指南说明如何通过二维码在两台设备之间离线分享自定义数据源配置。该功能用于规避在线分发源配置的法律风险——App 仅提供扫码工具，源配置的获取与分发由用户自行负责。

> **法律免责声明**
>
> 本 App 仅作为地震预警显示工具，不内置任何数据源转发逻辑，也不预置任何数据源。用户通过扫码导入的源配置由用户负责确保合法合规。
>
> **在中国境内，个人转发地震预警信息可能违反《地震监测管理条例》等法律法规。** 用户不得将本功能用于转发官方地震预警信息，否则由此产生的一切法律责任由用户自行承担，与 App 开发者无关。
>
> 建议用户仅用于分享自行搭建的、已取得合法授权的数据源配置。

---

## 1. P2P 分享流程

### 1.1 A 设备（导出方）

1. 打开 **设置 → 数据源管理**
2. 选中一个或多个自定义源
3. 点击 **分享** 按钮，打开分享 Modal
4. 切换到 **二维码** Tab
5. 根据包大小，界面自动选择两种模式：
   - **单二维码模式**（小包，≤2000 字符）：显示一张二维码
   - **分块二维码模式**（大包，>2000 字符）：显示"第 X/N 帧"，点击"下一帧"按钮依次展示每帧二维码
6. （可选）勾选 **包含鉴权信息** 以保留 apiKey/authToken（默认剥离）

### 1.2 B 设备（导入方）

1. 打开 **设置 → 数据源管理**
2. 点击 **导入** 按钮，打开导入 Modal
3. 切换到 **扫码导入** Tab
4. 授权相机权限（首次使用会弹窗请求）
5. 将摄像头对准 A 设备显示的二维码：
   - **单二维码**：扫一次即完成
   - **分块二维码**：按 A 设备展示顺序依次扫描全部 N 帧，底部进度条显示"已扫描 X/N"
6. 扫码完成后自动解析，显示预览（源列表）
7. 点击 **确认导入**
8. 导入的源默认 **禁用** 状态，需在数据源管理列表中手动启用

---

## 2. 二维码容量说明

| 场景 | 字符数 | 模式 | 说明 |
|------|--------|------|------|
| 单源导出 | 500-1000 | 单二维码 | 无需分块，扫一次完成 |
| 多源导出（≤2000 字符） | ≤2000 | 单二维码 | 仍为单二维码 |
| 多源导出（>2000 字符） | >2000 | 分块二维码 | 自动切分为多帧 |
| 理论上限 | ~15000 | 分块（最多约 10 帧） | 支持约 10 个源 |

**分块参数**（定义于 `src/sources/custom/sourceShare.ts`）：

- `MAX_CHUNK_BYTES = 1500`：每块最大字符数
- 超过 2000 字符触发分块（保留 500 字符余量给协议字段）

---

## 3. 分块协议格式

当源包超过 2000 字符时，自动使用自定义分块协议 `eew-app-source-pack-chunked`。

### 3.1 SourceShareChunk 结构

每个分块二维码承载一个 JSON 对象：

```typescript
interface SourceShareChunk {
  format: string;       // 固定为 'eew-app-source-pack-chunked'
  version: number;      // 协议版本，当前为 1
  totalChunks: number;  // 总帧数
  chunkIndex: number;   // 当前帧索引（0-based）
  totalBytes: number;   // 原始 JSON 总字符数
  chunkHash: string;    // 当前块 payload 长度的字符串形式（String(payload.length)）
  payload: string;      // 当前块的原始 JSON 片段
}
```

### 3.2 chunkHash 设计

`chunkHash` 使用 `String(payload.length)` 而非加密哈希，原因：

- 避免引入 `crypto` 模块（RN 环境兼容性差）
- 主要目的是检测 payload 被篡改或截断（长度变化即可检出）
- 完整性由 `totalBytes` 总长度校验兜底

### 3.3 assembleChunks 校验链

导入方收集完全部 N 帧后，按以下顺序校验：

1. `format` 必须为 `eew-app-source-pack-chunked`
2. `version` 必须为 `1`
3. 所有帧的 `totalChunks` 必须一致
4. 所有帧的 `totalBytes` 必须一致
5. `chunkIndex` 必须覆盖 `0` 到 `totalChunks - 1` 的完整区间（无缺失、无重复、无越界）
6. 每帧的 `chunkHash` 必须等于 `String(payload.length)`
7. 拼接后的总长度必须等于 `totalBytes`

任一校验失败，返回错误信息（如"第 X 帧校验失败"、"chunkIndex 不完整"），不进行导入。

---

## 4. 安全设计

### 4.1 导出方安全

- **默认剥离鉴权信息**：导出时 `apiKey` 和 `authToken` 字段默认不包含在分享包中
- **显式勾选**：用户需主动勾选"包含鉴权信息"才会保留这些字段
- **明文传输提醒**：勾选时界面提示"二维码为明文，请确保传输环境安全"

### 4.2 导入方安全

- **强制禁用**：导入的源在 `mergeImported` 中被强制设置 `enabled = false`，即使分享包中 `enabled = true` 也会被覆盖
- **手动启用**：用户需在数据源管理列表中手动开启源开关
- **防自动连接**：避免分享包中恶意 `enabled = true` 导致导入后立即连接未经验证的源

### 4.3 鉴权信息处理

- 导入后若源需要鉴权（`authToken` 必填），用户需自行填写
- App 不提供任何默认 authToken，不存储任何官方鉴权凭据

---

## 5. 权限说明

### 5.1 相机权限

- **首次请求**：进入扫码 Tab 时，`useCameraPermission` hook 检测权限状态
- **未决定状态**：自动调用 `requestPermission()` 弹出系统权限对话框
- **已授予**：显示摄像头预览，开始扫码
- **已拒绝**：显示提示界面与"前往系统设置"按钮，点击调用 `Linking.openSettings()` 跳转到 App 设置页

### 5.2 硬件要求

- 需要后置摄像头（`useCameraDevice('back')`）
- 无后置摄像头时显示错误提示"未找到后置摄像头"
- 需要 Android 8.0（API 26）或更高版本

---

## 6. 合规说明

### 6.1 传输方式

- **P2P 离线传输**：二维码扫码不经任何服务器
- **无中央分发**：App 不提供源配置商店、不下发任何源
- **无云端备份**：源配置仅存储在用户本地设备

### 6.2 主体责任

- App 仅作为扫码工具与显示工具
- 源配置的来源、内容、分发行为由用户负责
- App 开发者不对用户分享的源配置内容负责

### 6.3 法律边界

- App 不预置任何数据源，所有源由用户主动配置或导入
- 用户不得使用本功能转发官方地震预警信息（在中国境内可能违法）
- 建议仅用于分享自行搭建的、已取得合法授权的数据源

---

## 7. 错误场景与处理

| 场景 | 表现 | 处理 |
|------|------|------|
| 扫到非源分享包的二维码（如 URL） | 显示"format 不匹配"错误 | 重新对准正确的源分享二维码 |
| 分块模式下扫到错误的帧 | 显示"第 X 帧校验失败" | 重新扫描该帧 |
| 分块模式下帧序不完整 | 进度条显示"已扫描 X/N"，无法完成 | 补扫缺失的帧 |
| 相机权限被拒 | 显示提示界面 | 点击"前往系统设置"开启权限 |
| 无后置摄像头 | 显示错误提示 | 使用有后置摄像头的设备 |
| JSON 解析失败 | 显示"解析失败"错误 | 检查二维码是否完整清晰 |

---

## 8. 相关代码

| 文件 | 职责 |
|------|------|
| [sourceShare.ts](../src/sources/custom/sourceShare.ts) | 分块协议核心：`chunkPack` / `assembleChunks` / `mergeImported`（强制 enabled=false） |
| [QrScannerView.tsx](../src/components/settings/QrScannerView.tsx) | 扫码组件：摄像头预览 + QR 识别 + 分块累积 + 权限三态处理 |
| [ImportSourceModal.tsx](../src/components/settings/ImportSourceModal.tsx) | 导入 Modal：Tab 切换 + 扫码集成 + 免责横幅 + 预览确认 |
| [ExportSourceModal.tsx](../src/components/settings/ExportSourceModal.tsx) | 导出 Modal：分块二维码 + 切帧 UI + 进度指示器 |
| [SettingsIcons.tsx](../src/components/icons/SettingsIcons.tsx) | `QrScanIcon` 图标（四角 L 形取景框 + 扫描线） |

### 8.1 单元测试

`src/sources/custom/__tests__/sourceShare.test.ts` 覆盖：

- `mergeImported` 强制 `enabled = false`（5 处断言）
- `chunkPack` 分块逻辑（7 个用例：单块/阈值/多块/3 块/chunkHash/空字符串/真实包往返）
- `assembleChunks` 校验链（13 个用例：单块/多块/乱序/重复/缺失/空数组/format/version/totalChunks/totalBytes/chunkIndex 越界/chunkHash 不匹配/payload 篡改）
- 常量定义（2 个用例：`CHUNKED_PACK_FORMAT` / `MAX_CHUNK_BYTES`）

运行测试：

```bash
npx jest src/sources/custom/__tests__/sourceShare.test.ts
```

---

## 9. 相关文档

- [data-source-guide.md](data-source-guide.md)：数据源扩展指南（适配器开发）
- [data-layer.md](data-layer.md)：数据层整体设计
- [custom-source-guide.md](custom-source-guide.md)：自定义源配置指南（待创建）
