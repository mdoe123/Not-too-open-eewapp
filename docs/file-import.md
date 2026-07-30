# 文件导入数据源指南

本文档说明如何通过文件夹扫描和文件选择器（SAF）两种方式从本地 `.json` 文件导入数据源配置。

> 相关代码：
> - 原生层：`android/app/src/main/java/com/mdoeeewapp/android/cn/background/FileSourceImportModule.kt`
> - JS 层：`src/native/FileSourceImportManager.ts`
> - UI 层：`src/components/settings/ImportSourceModal.tsx`（Tab 3 文件夹 + Tab 4 选择器）
> - 数据源配置格式：见 [source-share.md](source-share.md) 和 [data-source-api.md](data-source-api.md)

## 1. 概述

合规改造（v13+）后，App 不预置任何数据源，用户通过以下 4 种方式导入源配置：

| 方式 | 适用场景 | 是否需要存储权限 | 文件位置 |
|------|---------|----------------|---------|
| 粘贴 JSON | 复制他人分享的 JSON 文本 | 否 | 剪贴板 |
| 扫码导入 | P2P 二维码离线分享 | 否（需摄像头） | — |
| **文件夹扫描** | 批量导入多个源配置 | **否**（应用外部私有目录） | `eew_sources/` 目录 |
| **文件选择器** | 从任意位置导入单个文件 | **否**（系统 SAF） | 任意位置 |

本文档重点介绍后两种基于文件的导入方式。

## 2. 文件格式

所有导入的 `.json` 文件必须符合 `eew-app-source-pack` 分享包格式：

```json
{
  "format": "eew-app-source-pack",
  "version": 1,
  "exportedAt": 1700000000000,
  "exportedBy": "可选备注",
  "sources": [
    {
      "type": "customSource",
      "name": "示例 EEW 源",
      "enabled": false,
      "priority": 1,
      "category": "eew",
      "protocol": "ws",
      "endpoint": "wss://api.example.com/eew",
      "authToken": "your-token",
      "fieldMapping": {
        "eventId": "$.eventId",
        "originTime": "$.time * 1000",
        "magnitude": "$.mag",
        "depth": "$.depth",
        "lat": "$.lat",
        "lng": "$.lng",
        "location": "$.place"
      }
    }
  ]
}
```

> 完整字段说明见 [source-share.md](source-share.md) 和 [data-source-api.md](data-source-api.md)。
> 导入后 `enabled` 字段强制设为 `false`（由 `mergeImported` 保证），用户需手动启用。

## 3. 文件夹扫描导入

### 3.1 工作原理

文件夹扫描模式扫描应用外部私有目录下的所有 `.json` 文件，逐个解析并批量导入：

- **扫描目录**：`getExternalFilesDir(null)/eew_sources/`
- **目录特性**：
  - 位于应用外部私有存储（无需 `READ_EXTERNAL_STORAGE` 权限）
  - 文件管理器可访问（用户可从电脑 USB 传输或下载文件到此目录）
  - 卸载 App 时自动清理（不会残留）
- **扫描规则**：递归扫描目录下所有 `.json` 后缀文件（不区分大小写）

### 3.2 用户操作流程

1. **准备文件**：
   - 通过 USB 数据线连接电脑，将 `.json` 文件复制到手机
   - 文件管理器路径：`Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
   - 或在手机上用文件管理器直接创建/下载 `.json` 文件到此目录
2. **打开导入界面**：
   - 设置 → 数据源管理 → 导入数据源
   - 切换到"文件夹"Tab
3. **查看文件列表**：
   - 进入 Tab 时自动扫描并显示目录路径与文件列表
   - 点击"刷新"按钮重新扫描
4. **一键导入全部**：
   - 点击"导入全部"按钮
   - 逐个解析文件，累积有效源配置
   - 跳过无效文件（JSON 格式错误或校验失败）
   - 合并到现有源列表（按 `endpoint` 去重，同 `endpoint` 更新，不同 `endpoint` 追加为新源；`priority` 冲突时自动重新分配）
5. **手动启用**：
   - 导入后所有源默认禁用
   - 在数据源管理列表中手动启用需要的源

### 3.3 目录访问说明

**目录路径**（不同手机可能略有差异，以 `getSourceDirectoryPath()` 返回值为准）：

```
/storage/emulated/0/Android/data/com.mdoeeewapp.android.cn/files/eew_sources/
```

**通过文件管理器访问**：
- 大多数 Android 文件管理器支持直接浏览 `Android/data/` 目录
- Android 11+ 系统限制部分文件管理器访问 `Android/data/`，建议使用系统自带文件管理器或通过 USB 连接电脑

**通过 USB 连接电脑访问**：
1. 手机连接电脑，选择"文件传输"模式
2. 在电脑上打开手机存储
3. 导航到 `Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
4. 若目录不存在，先在 App 中切到"文件夹"Tab 自动创建，或手动创建
5. 将 `.json` 文件复制到此目录

## 4. 文件选择器导入（SAF）

### 4.1 工作原理

文件选择器模式使用 Android 系统的 Storage Access Framework（SAF）：

- **触发方式**：调用 `Intent.ACTION_OPEN_DOCUMENT`
- **支持的 MIME 类型**：`application/json`、`text/plain`、`application/octet-stream`
- **权限**：无需任何存储权限，SAF 由系统托管，用户主动选择文件后授予临时读取权限
- **选择范围**：用户可从任意位置选择文件（内置存储、外置 SD 卡、云盘、USB OTG 等）

### 4.2 用户操作流程

1. **打开导入界面**：
   - 设置 → 数据源管理 → 导入数据源
   - 切换到"选择器"Tab
2. **选择文件**：
   - 点击"选择文件"按钮
   - 系统弹出文件选择器
   - 浏览并选中 `.json` 文件
   - 取消选择则静默返回，无错误提示
3. **预览解析结果**：
   - 文件读取后自动解析并显示预览
   - 预览内容包括：待导入源数量、新增/更新/重排统计、源名称列表
4. **确认导入**：
   - 点击"导入"按钮确认
   - 合并到现有源列表（按 `endpoint` 去重，同 `endpoint` 更新，不同 `endpoint` 追加为新源；`priority` 冲突时自动重新分配）
5. **手动启用**：
   - 导入后源默认禁用，需手动启用

### 4.3 SAF 优势

- **无需存储权限**：不申请 `READ_EXTERNAL_STORAGE`，避免权限弹窗与合规风险
- **跨应用访问**：可从文件管理器、云盘、邮件附件等任意应用选择文件
- **用户可控**：用户主动选择文件，App 不主动扫描用户文件
- **临时授权**：仅本次导入使用，不持久化文件访问权限

## 5. 错误处理

### 5.1 文件夹扫描错误

| 错误场景 | 处理方式 | 用户提示 |
|---------|---------|---------|
| 目录不存在 | 自动创建空目录 | 显示空文件列表 |
| 目录无 `.json` 文件 | 显示空列表 | "文件夹中无 .json 文件" |
| 单个文件 JSON 解析失败 | 跳过该文件，继续处理其他 | 错误列表显示"文件 N: <错误信息>" |
| 单个文件校验失败（schema 不符） | 跳过该文件 | 错误列表显示"文件 N: 校验失败" |
| 所有文件都无效 | 不导入任何源 | 显示"无有效的数据源" |

### 5.2 文件选择器错误

| 错误场景 | 处理方式 | 用户提示 |
|---------|---------|---------|
| 用户取消选择 | 静默返回 | 无提示 |
| 文件读取失败 | 显示错误 | "文件读取失败：<错误信息>" |
| JSON 解析失败 | 显示解析错误 | "解析失败：<错误信息>" |
| 校验失败 | 显示校验错误列表 | "校验失败" + 错误详情 |

## 6. 合并去重策略

两种导入方式都使用 `mergeImported` 函数合并源到现有列表：

- **去重键**：`endpoint` 字段（大小写不敏感），同一 API 地址视为同一源的不同配置版本
- **同 endpoint 源**：更新现有源配置（保留旧 `priority`，避免破坏用户排序）
- **不同 endpoint 源**：追加为新源
  - 若新源 `priority` 与现有源冲突：自动重新分配一个未使用的 `priority`（从 100 开始递增），避免覆盖其他无关源
  - 若 `priority` 不冲突：直接追加
- **强制禁用**：导入的源 `enabled` 强制设为 `false`（含同 endpoint 更新场景），需用户手动启用
- **结果统计**：返回 `added`（新增数量）、`updated`（更新数量）、`reassigned`（重新分配 priority 的数量）

> **设计理由**：早期版本按 `priority` 去重，导致"导入测试源覆盖真实源"问题——只要 priority 相同就覆盖，不管 endpoint 是否不同。改为 `endpoint` 去重后，只有同一 API 地址才视为同一源，不同 API 地址的源即使 priority 相同也会作为新源追加（priority 自动重排），从根本上避免误覆盖。

## 7. 原生模块 API

### 7.1 FileSourceImportModule（Kotlin）

位于 `android/app/src/main/java/com/mdoeeewapp/android/cn/background/FileSourceImportModule.kt`，实现 `ActivityEventListener` 接口接收 SAF 结果。

> 注：RN 0.86+ 起 `ActivityEventListener` 接口签名变更，`onActivityResult(activity: Activity, ...)` 与 `onNewIntent(intent: Intent)` 的首个参数为非空类型，实现时需注意保持签名一致。

| ReactMethod | 说明 |
|-------------|------|
| `scanSourceFiles()` | 扫描 `eew_sources/` 目录下所有 `.json` 文件，返回文件名数组 |
| `readAllSourceFiles()` | 读取目录下所有 `.json` 文件内容，返回字符串数组 |
| `readSourceFile(fileName)` | 按文件名读取单个文件内容 |
| `getSourceDirectoryPath()` | 返回扫描目录的绝对路径 |
| `pickFile()` | 启动系统 SAF 文件选择器，选择后通过 Promise 返回文件内容 |

### 7.2 FileSourceImportManager（TypeScript）

位于 `src/native/FileSourceImportManager.ts`，封装原生模块调用，所有方法带平台检查（非 Android 返回空/null/throw）。

```typescript
export const FileSourceImportManager = {
  /** 扫描 eew_sources/ 目录下所有 .json 文件名 */
  scanSourceFiles(): Promise<string[]>,
  /** 读取目录下所有 .json 文件内容 */
  readAllSourceFiles(): Promise<string[]>,
  /** 按文件名读取单个文件内容 */
  readSourceFile(fileName: string): Promise<string>,
  /** 获取扫描目录的绝对路径 */
  getSourceDirectoryPath(): Promise<string | null>,
  /** 启动 SAF 文件选择器，返回选中文件的 JSON 内容 */
  pickFile(): Promise<string>,
};
```

## 8. 安全设计

- **无存储权限**：文件夹扫描使用应用外部私有目录，SAF 由系统托管，均无需 `READ_EXTERNAL_STORAGE` 权限
- **不执行用户代码**：App 仅解析 JSON，不执行任何脚本或动态代码
- **强制禁用**：导入的源默认 `enabled=false`，需用户手动启用
- **预览确认**：粘贴/扫码/SAF 导入后展示预览，用户确认后才合并
- **authToken 处理**：分享包中的 `authToken` 字段会被保留（用户主动选择分享时已知情），App 不强制剥离导入的 token
- **法律免责**：导入 Modal 顶部显示黄色法律免责横幅，提醒用户源配置的合法合规性由用户自行负责

## 9. 合规说明

在中国境内，个人转发地震预警信息可能违反《地震监测管理条例》等法律法规：

- App 仅提供文件导入工具，不预置任何源
- 源配置的合法合规性由用户自行负责
- 用户应自行确认导入的数据源是否为官方授权或合法公开
- App 不对导入源的数据准确性承担任何责任

## 10. 测试建议

### 10.1 文件夹扫描测试

1. 准备 2-3 个有效的 `.json` 源配置文件
2. 通过文件管理器复制到 `Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
3. 打开 App → 设置 → 数据源管理 → 导入 → 切到"文件夹"Tab
4. 验证：目录路径正确显示、文件列表完整、导入全部按钮可用
5. 点击"导入全部"，验证源列表更新（新增数 + 更新数正确，若有 priority 冲突会显示重排数）
6. 验证导入的源 `enabled=false`，需手动启用

### 10.2 文件选择器测试

1. 准备 1 个有效的 `.json` 源配置文件，放在任意位置（如 Downloads/）
2. 打开 App → 设置 → 数据源管理 → 导入 → 切到"选择器"Tab
3. 点击"选择文件"，系统弹出 SAF 选择器
4. 选中文件，验证：预览正确显示、导入按钮可用
5. 点击"导入"，验证源列表更新
6. 测试取消选择：点击"选择文件"后按返回键，应静默返回无错误

### 10.3 错误场景测试

1. **空目录**：删除 `eew_sources/` 下所有文件，验证文件夹 Tab 显示"无 .json 文件"
2. **无效 JSON**：放入一个非 JSON 文件（如 `.txt` 改名为 `.json`），验证文件夹扫描跳过该文件并显示错误
3. **schema 不符**：放入一个 JSON 格式正确但不符合 `eew-app-source-pack` schema 的文件，验证校验失败提示
4. **混合文件**：放入 2 个有效 + 1 个无效文件，验证导入 2 个有效源并跳过无效文件

## 11. 相关文档

- [source-share.md](source-share.md) — 源配置分享/导入完整协议（粘贴 + 扫码）
- [data-source-api.md](data-source-api.md) — customSource 数据源 API 文档
- [data-source-guide.md](data-source-guide.md) — 数据源扩展指南（含 CustomSource 适配器架构）
- [data-layer.md](data-layer.md) — 数据层整体设计

## 12. 示例源配置

为方便用户快速接入常见地震预警 API，仓库内置了 2 个示例源配置文件，位于 `docs/examples/` 目录：

| 示例文件 | 源类型 | endpoint | 协议 | 说明 |
|---------|--------|----------|------|------|
| [cenc_eew.json](examples/cenc_eew.json) | eew | `https://api.wolfx.jp/cenc_eew.json` | HTTP 2s 轮询 | 中国地震台网中心地震预警（wolfx 转发） |
| [cenc_eqlist.json](examples/cenc_eqlist.json) | eqlist | `https://api.wolfx.jp/cenc_eqlist.json` | HTTP 30s 轮询 | 中国地震台网中心速报列表（wolfx 转发） |

### 12.1 使用方式

**方式一：通过 USB 复制到 `eew_sources/` 目录导入**

1. 通过 USB 数据线连接电脑与手机
2. 在电脑上定位到示例文件 `docs/examples/cenc_eew.json` 与 `docs/examples/cenc_eqlist.json`
3. 复制到手机存储路径：`Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
4. 在 App 中：设置 → 数据源管理 → 导入数据源 → 切到"文件夹"Tab → 点击"导入全部"
5. 在数据源管理列表中手动启用导入的源

**方式二：通过 SAF 文件选择器导入**

1. 将示例文件复制到手机任意可访问位置（如 Downloads/）
2. 在 App 中：设置 → 数据源管理 → 导入数据源 → 切到"选择器"Tab
3. 点击"选择文件"，在系统 SAF 选择器中选中 `cenc_eew.json` 或 `cenc_eqlist.json`
4. 预览解析结果，确认导入
5. 在数据源管理列表中手动启用导入的源

### 12.2 示例文件技术要点

两个示例文件展示了 customSource 的高级路径表达式语法：

**cenc_eew.json**：
- 使用 `Date.parse($.OriginTime)` 函数调用语法，将 wolfx 返回的 `"2026-07-18 13:47:20"` 字符串解析为 Unix 毫秒（按 UTC+8 时区）
- 单事件解析（无 listPath）

**cenc_eqlist.json**：
- 使用 `$.No*` glob 通配符作为 `listPath`，将 wolfx 返回的 `{No1:{...}, No2:{...}, ..., No50:{...}, md5:"..."}` 平铺结构提取为 50 个事件的数组（自动跳过 `md5` 字段）
- 使用 `Date.parse($.time)` 解析事件时间
- 字段值均为字符串，`extractNumber` 自动转换为数字

> 详细的路径表达式语法说明见 [data-source-api.md](data-source-api.md) 第 3.2 节。

### 12.3 合规提醒

- 示例源指向 wolfx.jp 第三方 API，仅作为 customSource 配置演示
- 在中国境内，地震预警信息的发布与转发受《地震监测管理条例》等法律法规约束
- 用户应自行确认使用 wolfx.jp API 的合法合规性
- App 不对 wolfx.jp API 的数据准确性、可用性承担任何责任
