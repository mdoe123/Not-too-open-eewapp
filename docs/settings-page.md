# 设置页面（Task 6）

本文档说明地震预警 App 设置页面的实现：配置持久化、通用组件、四组配置项与 SVG 图标。对应代码位于 `src/screens/`、`src/components/settings/`、`src/components/icons/`、`src/hooks/`、`src/theme/`。

## 1. 设计目标

- **黑白简约风格**：仅用黑/白/灰，配合 `useColorScheme` 自动适配亮色与暗色模式。
- **SVG 线条图标**：所有图标均为 24×24 线条 SVG（`stroke=currentColor, fill=none, strokeWidth=1.5`），不使用图片或 emoji。
- **可折叠分组**：五组配置用 `CollapsibleSection` 包裹，眼睛图标切换展开/收起，减少页面杂乱。
- **避免误触**：优先级调整使用 40×40 的大点击区按钮；重置需二次确认。
- **配置持久化**：通过 `useConfig` Hook 将 `AppConfig` 写入 AsyncStorage，启动时合并默认值防止旧版本字段缺失。
- **能力解耦**：系统能力开关仅保存配置，不直接调用原生能力（原生能力由 Task 4/7/8/9 实现）。

## 2. 目录结构

```
src/
├── screens/
│   └── SettingsScreen.tsx          # 设置页面（组装四组配置）
├── components/
│   ├── settings/
│   │   ├── ThresholdSection.tsx    # 预警阈值（2 个滑块）
│   │   ├── AlertMethodSection.tsx  # 报警方式（铃声/振动/免打扰）
│   │   ├── SourceManageSection.tsx # 数据源管理（启用 + 优先级）
│   │   ├── SystemToggleSection.tsx # 系统能力开关（4 项，显示权限状态）
│   │   ├── LocationSection.tsx     # 位置设置（GPS/手动经纬度）
│   │   ├── DebugSection.tsx        # 调试设置（远程日志）
│   │   ├── SettingRow.tsx          # 通用设置行（标签 + 控件 + 分隔线）
│   │   ├── SliderRow.tsx           # 滑块设置行
│   │   ├── ToggleRow.tsx           # 开关设置行
│   │   └── CollapsibleSection.tsx  # 可折叠分组（眼睛图标）
│   └── icons/
│       └── SettingsIcons.tsx       # 设置页专用 SVG 图标（13 个）
├── hooks/
│   └── useConfig.ts                # 配置读写 Hook（AsyncStorage 持久化）
└── theme/
    └── colors.ts                   # 亮/暗色配色（含 AppColors / ThemeColors 别名）
```

## 3. 配置持久化（useConfig）

`src/hooks/useConfig.ts` 提供 `useConfig()` Hook：

| 返回字段 | 说明 |
|----------|------|
| `config` | 当前 `AppConfig` |
| `ready` | 是否完成初次加载（加载中页面显示 loading） |
| `updateAlert(partial)` | 局部更新 `AlertConfig` 字段 |
| `updateSources(sources)` | 替换数据源列表 |
| `resetConfig()` | 重置为 `DEFAULT_CONFIG` |

**持久化要点**：

- AsyncStorage key：`@eew_app_config`
- 首次启动（无存储）写入 `DEFAULT_CONFIG`
- 加载时通过 `mergeConfig` 合并 `DEFAULT_CONFIG`，保证旧版本配置缺少新字段时用默认值补齐
- `alert` 字段做一级浅合并；`sources` 数组直接覆盖（缺省时回退默认）
- 每次更新都异步写入 AsyncStorage，写入失败时忽略（下次启动重试）
- 读取异常时回退到 `DEFAULT_CONFIG`，保证 UI 始终可用

## 4. 主题配色（colors.ts）

`src/theme/colors.ts` 导出：

- `lightColors` / `darkColors`：两套配色（background / surface / text / textSecondary / border / silent / info / advisory / warning / critical）
- `AppColors`：配色对象类型
- `ThemeColors`：`AppColors` 的别名，保持与并行开发的组件命名兼容
- `getColors(isDark)`：根据是否暗色返回对应配色

> 该文件由 Task 6 创建。Task 5（主界面）并行开发的组件以 `ThemeColors` 命名引用同一类型，二者等价。

## 5. 通用组件

### 5.1 SettingRow

通用设置行：左侧标签（含可选描述与图标）+ 右侧自定义内容 + 底部细分隔线。其余行组件基于它构建。

### 5.2 SliderRow

滑块行：标签 + 当前值（含单位）+ 滑块 + 最小/最大值标注。

- 基于 `@react-native-community/slider`（RN 0.86 已移除内置 `Slider`）
- 黑白风格：`minimumTrackTintColor` 用 `text` 色，`maximumTrackTintColor` 用 `border` 色，`thumbTintColor` 用 `text` 色
- 支持 `formatValue` 自定义数值显示；默认根据 `step` 是否为整数自动选择 0 或 1 位小数

### 5.3 ToggleRow

开关行：基于 `SettingRow` + RN 内置 `Switch`。开启时轨道用 `text` 色，关闭时用 `border` 色。

### 5.4 CollapsibleSection

可折叠分组：标题 + 眼睛图标（`EyeOpenIcon`=展开，`EyeClosedIcon`=收起），点击标题区切换。

- 默认展开策略：**预警阈值**、**报警方式** 默认展开；**数据源管理**、**系统能力** 默认折叠
  - 折叠渲染量大的分组（数据源管理含 15 个数据源行 + 多个滑块）避免进入设置页时首屏一次性挂载过多原生 Slider 导致卡顿
- 圆角卡片样式，带边框
- 含 `accessibilityRole="button"` 与 `accessibilityState={expanded}` 无障碍属性

## 6. 四组配置

### 6.1 预警阈值（ThresholdSection）

| 配置项 | 字段 | 范围 | 步长 | 单位 |
|--------|------|------|------|------|
| 触发预警震级 | `minMagnitude` | 1.0~8.0 | 0.1 | 级 |
| 报警烈度 | `lockScreenIntensity` | -3~6 | 1 | 度 |

- 浮点滑块用 `round1` 修正浮点累加误差
- 烈度滑块用 `Math.round` 取整
- 烈度范围 -3~6：负值表示"极敏感"（几乎所有事件都报警），6 表示只有高烈度才报警

### 6.2 报警方式（AlertMethodSection）

- **铃声**（`soundEnabled`）
- **振动**（`vibrationEnabled`）
- **免打扰时段**：开关 + 两个 `TextInput` 输入起止时间
  - 格式校验：正则 `/^([01]\d|2[0-3]):([0-5]\d)$/`
  - 失焦时校验，无效则回退到上次有效值并提示
  - 启用时默认写入 22:00–07:00；关闭时清空 `quietHoursStart` / `quietHoursEnd`

### 6.3 数据源管理（SourceManageSection）

合规改造（v13+）后，App 不预置任何数据源，用户通过本节管理导入/手动添加的 customSource 源。

- 列出 `config.sources`，按 `category` 分为两组展示：
  - **预警数据源**（`category: 'eew'`）：实时地震预警 API（WS 或 HTTP）
  - **速报数据源**（`category: 'eqlist'`）：地震信息列表 API（HTTP 轮询）
- 每组内按 `priority` 升序排列，组标题右侧显示该组数据源数量
- 每行：`ServerIcon` + 显示名称 + 优先级数字 + 上下箭头 + 启用开关
- 优先级调整：与组内上/下一个源交换 `priority`（40×40 大按钮，边界禁用，避免误触）
- **优先级调整仅在同组内生效**，不跨组调整（预警源与速报源独立排序）
- **HTTP 源轮询间隔**：`protocol === 'http'` 的数据源行下方渲染一个轮询间隔滑块（复用 `SliderRow`，封装为 `PollIntervalRow` 子组件），范围 2-60 秒，步进 1 秒，默认 2 秒（与 `DEFAULT_POLL_INTERVAL_MS=2000` 一致）。WS 源（`protocol === 'ws'`）为推送模式，不显示此滑块。
  - 毫秒 ↔ 秒转换在 `PollIntervalRow` 内完成，`SliderRow` 只处理秒
  - `onSlidingComplete`（松手时）才提交配置，拖动过程不写存储（`SliderRow` 内部用 `localValue` 隔离）
  - 调整间隔后，`pollIntervalMs` 变化产生新的 `sources` 数组引用，触发 `useEewStream` 重启 SourceManager，新间隔自动生效
  - `CustomSourceAdapter` 的心跳超时（`max(pollIntervalMs * 3, 10000ms)`）也会随之自适应
- **新增源**：通过"导入数据源"按钮（ImportSourceModal）或 CustomSourceEditor 手动添加
  - 4 种导入方式：粘贴 JSON / 扫码导入 / 文件夹扫描 / 文件选择器（详见 [file-import.md](file-import.md)）

> **显示名称**：来自用户配置的 `name` 字段（导入时由分享 JSON 决定，手动添加时由用户输入）。
> 所有源类型均为 `customSource`，老 wolfx 源在 v13 升级时被强制清空，需重新导入。

### 6.4 系统能力开关（SystemToggleSection）

| 配置项 | 字段 | 说明 | 权限状态显示 |
|--------|------|------|-------------|
| 后台运行 | `backgroundEnabled` | 后台持续接收预警数据 | 通知权限 + 电池优化白名单状态 |
| 悬浮窗 | `floatingWindowEnabled` | 地震时显示悬浮预警窗口 | 悬浮窗权限状态（SYSTEM_ALERT_WINDOW） |
| 锁屏报警 | `lockScreenEnabled` | 锁屏状态高震级地震触发报警 | 无需额外权限（WAKE_LOCK 自动授予） |
| 开机自启动 | `autoStartEnabled` | 开机后自动启动预警服务 | 请到系统设置确认（厂商 ROM 不可自动检测） |

- 每个开关的 description 动态拼接对应系统权限的实际状态（通过 `useSystemPermissionStatus` hook 检测）
- 悬浮窗权限：调 `FloatingWindowManager.hasPermission()`（`Settings.canDrawOverlays`）
- 通知权限：调 `checkNotifications()`（react-native-permissions，作为后台运行能力的代理）
- 电池优化白名单：调 `PermissionManager.isBatteryOptimized()`（`PowerManager.isIgnoringBatteryOptimizations`）
- AppState active 时自动刷新（从系统设置返回后更新状态）

## 7. SVG 图标（SettingsIcons.tsx）

`src/components/icons/SettingsIcons.tsx` 导出 13 个线条图标，统一规格 24×24、`stroke=currentColor`、`fill=none`、`strokeWidth=1.5`、圆角线帽：

| 图标 | 用途 |
|------|------|
| `EyeOpenIcon` | 分组展开 |
| `EyeClosedIcon` | 分组收起 |
| `ChevronUpIcon` | 优先级上调 |
| `ChevronDownIcon` | 优先级下调 |
| `BellIcon` | 铃声 |
| `VibrateIcon` | 振动 |
| `MoonIcon` | 免打扰 |
| `ServerIcon` | 数据源 |
| `BackgroundIcon` | 后台运行 |
| `WindowIcon` | 悬浮窗 |
| `LockIcon` | 锁屏 |
| `PowerIcon` | 自启动 |
| `ResetIcon` | 重置 |

依赖 `react-native-svg`。图标通过外层 `color` 属性控制颜色，自动适配亮/暗模式。

## 8. 设置页面组装（SettingsScreen）

- **顶部标题栏**：「设置」标题 + 重置按钮（`ResetIcon`），点击弹出 `Alert` 二次确认后调用 `resetConfig()`
- **加载态**：`ready=false` 时显示 `ActivityIndicator`
- **滚动**：`ScrollView` 包裹四组 `CollapsibleSection`；预警阈值、报警方式默认展开，数据源管理、系统能力默认折叠（性能优化，见第 9 节）
- **配色**：通过 `useColorScheme()` + `getColors()` 自动切换亮/暗
- **底部提示**：「配置已自动保存到本地」

## 9. 性能优化

进入设置页卡顿问题的优化措施：

### 9.1 默认折叠重分组

`数据源管理`（含 15 个数据源行 + 多个 `SliderRow`）与 `系统能力` 默认折叠，首屏只渲染 4 个标题行 + 预警阈值/报警方式两组轻量内容，避免一次性挂载 10+ 个原生 `@react-native-community/slider` 实例。

### 9.2 React.memo

- `SliderRow`：`memo` 包裹，父组件重渲染时仅当本行 props 变化才重渲染
- `SourceManageSection`：`memo` 包裹，拖动阈值滑块等操作触发 SettingsScreen 重渲染时，`sources`/`updateSources`/`colors` 不变，15 个数据源行不会重渲染

> 注：`ThresholdSection` 内 `onSlidingComplete` 为内联箭头函数，拖动阈值滑块时同组 2 个 `SliderRow` 仍会重渲染，但数量少、开销可忽略，不值得为此把回调改成 `useCallback` 牺牲可读性。

## 10. 新增依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@react-native-community/slider` | ^5.2.0 | 滑块组件（RN 0.86 已移除内置 Slider） |
| `react-native-svg` | ^15.15.5 | SVG 图标渲染 |

两个均为原生模块，需重新构建应用（`yarn android`）后生效。

## 11. 类型检查

在 `android-eew-app/` 目录下执行：

```sh
npx tsc --noEmit
```

应无任何错误输出（exit code 0）。

> Task 6 期间顺手修复了 Task 5 并行开发文件 `src/components/EpicenterMap.tsx` 中一处已废弃 API：`StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill`（RN 0.86 已移除前者类型），以保证全局 `tsc` 通过。

## 12. 与后续任务的衔接

| 任务 | 衔接点 |
|------|--------|
| Task 5（主界面） | 主界面通过 `@react-navigation` 接入 `SettingsScreen`；共用 `theme/colors.ts` |
| Task 3（数据源） | 提供真实数据源后扩展 `SourceManageSection` 新增/编辑能力 |
| Task 4/7/8/9（原生能力） | 读取 `AlertConfig` 中 `backgroundEnabled` 等开关决定是否启用对应原生能力 |
| Task 10（报警触发） | 读取阈值与报警方式配置，结合 `AlertLevel` 触发铃声/振动/锁屏报警 |
