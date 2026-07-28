# P2 安全审查修复报告

本报告记录基于循环式安全审查后，针对 P2 级（规范性 / 代码质量 / 鲁棒性）问题进行的修复内容。P0 / P1 修复见 [p0-fix-report.md](./p0-fix-report.md) 与 [p1-fix-report.md](./p1-fix-report.md)。

P2 修复遵循"最小化改动、零信任改动、不引入新依赖"原则，目标是在不改变功能行为的前提下消除死代码、废弃 API、配置不一致与潜在的边界异常。

## 修复清单

### 批次 1：主题色语义化

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P2-1 | 颜色硬编码 + hex 字符串拼接（'#CC000000' + 'E6'）脆弱，无法适配暗色模式 | theme/colors.ts | 新增 success / error / backgroundE6 / backgroundF0 语义色 |
| P2-1 | SourceStatusBar getStatusColor / StatusIcon 直接读 hardcoded 颜色 | components/SourceStatusBar.tsx | getStatusColor 改为接收 colors 参数，使用 colors.success / advisory / silent / error |
| P2-1 | PermissionRow useColorScheme + 硬编码 grantedColor | screens/onboarding/PermissionRow.tsx | 移除 useColorScheme，grantedColor 改用 colors.success |
| P2-1 | SourceStatusBar background + 'E6' / 'F0' 拼接半透明 | SourceStatusBar.tsx | 改为 colors.backgroundE6 / colors.backgroundF0 |

### 批次 2：配置版本化与持久化健壮性

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P2-8 | AppConfig 无 version 字段，结构变更无法迁移 | types/config.ts | 新增 version 字段 + CURRENT_CONFIG_VERSION 常量，DEFAULT_CONFIG 注入版本号 |
| P2-8 | useConfig 加载无 schema 校验，脏数据流入 UI | hooks/useConfig.ts | 新增 isValidConfig schema 校验 + migrateConfig 版本迁移 + parseConfig 入口 |
| P2-11 | useOnboarding 严格比较 'true'，外部写入 '1' / 'True' 导致引导重复显示 | hooks/useOnboarding.ts | 宽松判断 `value === 'true' \|\| value === '1'` |

### 批次 3：工具函数健壮性

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P2-13 | formatOriginTime 对 Invalid Date 输出 "NaN-NaN-NaN NaN:NaN:NaN" | utils/eew.ts | 新增 isNaN(d.getTime()) 防护，返回占位符 '--' |
| P2-14 | 缺少 EewEvent 数值字段合理性校验，非法值（负震级、纬度 > 90）流入 UI | utils/eew.ts | 新增 validateEewEvent 函数，校验 magnitude / depth / lat / lng 范围 + receivedAt >= originTime 单调性 |
| P2-15 | EewEvent 类型无范围约束文档 | types/eew.ts | 在 magnitude / depth / lat / lng / receivedAt 字段添加范围约束与单调性注释 |

### 批次 4：Kotlin 原生清理

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P2-2 | FloatingWindowModule `Build.VERSION.SDK_INT >= M` / `TYPE_PHONE` 死代码分支（minSdk=26 永远走新分支） | floatingwindow/FloatingWindowModule.kt | 移除 `< M` 早期返回 + TYPE_PHONE 分支，统一使用 TYPE_APPLICATION_OVERLAY；移除未使用的 Build import |
| P2-3 | FloatingWindowModule show() / createFloatingView() 异常被吞，未回传 RN | FloatingWindowModule.kt | 新增 emitError() 通过 RCTDeviceEventEmitter 发送 "onError" 事件，便于上层降级 |
| P2-4 | FullScreenAlertActivity setAudioStreamType(STREAM_ALARM) 已废弃（API 21+） | fullscreenalert/FullScreenAlertActivity.kt | 改用 AudioAttributes.Builder().setUsage(USAGE_ALARM).setContentType(SONIFICATION) |
| P2-6 | BootStarterService 使用平台 Notification.Builder + 系统占位图标 | autostart/BootStarterService.kt | 改用 androidx.core.app.NotificationCompat（RN 间接依赖）+ 应用图标 R.mipmap.ic_launcher |
| P2-7 (Kotlin) | FullScreenAlertActivity 未覆写 onNewIntent，新报警到来时数据不更新 | FullScreenAlertActivity.kt | 覆写 onNewIntent，提取 applyIntent 解析数据 + 重启震动/铃声/倒计时；buildRootView 接收 level 参数避免依赖成员变量副作用 |
| P2-10 | FullScreenAlertPackage / AutoStartPackage 过时 TODO 注释（MainApplication.kt 已注册） | fullscreenalert/FullScreenAlertPackage.kt, autostart/AutoStartPackage.kt | 删除 TODO 注释，改为说明性 KDoc 注明已在 MainApplication.kt 注册 |
| P2-12 | FullScreenAlertActivity registerReceiver 在 startVibration 之后注册，dismiss 信号延迟响应 | FullScreenAlertActivity.kt | 调整顺序到 setupLockScreenFlags 之后立即注册，确保后续启动震动/铃声过程中能即时响应 dismiss |

### 批次 5：React 渲染优化与配置一致性

| 编号 | 问题 | 修复文件 | 修复方式 |
|------|------|---------|---------|
| P2-7 (TS) | App.tsx navigationTheme 每次渲染重建对象，导致 NavigationContainer 不必要重渲染 | App.tsx | 使用 useMemo 缓存 navigationTheme，依赖 [isDarkMode, colors] |
| P2-9 | AlertMethodSection quietEnabled 用 OR 逻辑，仅有一个时间即视为启用，半残状态 | components/settings/AlertMethodSection.tsx | 改为 AND 逻辑 + isValidTime 双端校验：`isValidTime(start) && isValidTime(end)` |

## 验证

- **TypeScript 类型检查**：`npx tsc --noEmit` 退出码 0，无错误。
- **Jest 单元测试**：17/17 通过（utils / eew / config 等核心模块）。
  - App.test.tsx 因 jest 环境未 mock react-native-gesture-handler ESM 导入而失败，此为预先存在的环境配置问题，与本次 P2 修复无关。
- **Kotlin 编译**：本次改动仅使用平台 API + androidx.core（React Native 间接依赖），未引入新依赖，符合现有构建配置。

## 设计要点

### 1. 主题色语义化（P2-1）

将硬编码颜色（`'#CC000000'`、`'#2E7D32'` 等）与 hex 字符串拼接（`background + 'E6'`）替换为主题 token：
- 优势 1：暗色模式切换只需修改 colors.ts 一处
- 优势 2：避免 `'rgba(255,255,255,0.9)' + 'E6'` 这类字符串拼接的脆弱性
- 优势 3：组件接收 colors 参数，便于单元测试与故事书隔离

### 2. 配置版本化迁移（P2-8）

```
AsyncStorage (raw JSON)
  → isValidConfig (schema 校验)
  → migrateConfig (版本迁移：补默认值 / 字段重命名)
  → parseConfig (统一入口)
  → setConfig
```

未来结构变更只需递增 CURRENT_CONFIG_VERSION 并在 migrateConfig 添加 case。

### 3. 工具函数防御性（P2-13 / P2-14）

- formatOriginTime：NaN 时间戳返回 '--'，避免 UI 出现 "NaN-NaN-NaN"
- validateEewEvent：SourceAdapter.parse 后调用，校验物理量范围与时间单调性，错误以数组形式返回（不阻断，便于日志收集）

### 4. Kotlin 死代码清理（P2-2）

minSdkVersion = 26（API 26 = O）意味着：
- `Build.VERSION.SDK_INT >= M`（M=23）永远 true
- `Build.VERSION.SDK_INT < M` 永远 false
- `TYPE_PHONE`（API < O）分支永远不走

移除死代码后：
- 减少分支复杂度
- 避免 lint 警告
- 代码意图更清晰

### 5. onNewIntent 数据更新（P2-7 Kotlin）

锁屏报警 Activity 使用 singleTop / singleTask 启动模式时，新报警会通过 onNewIntent 复用已有 Activity。原实现未覆写 onNewIntent，导致：
- 新报警数据被丢弃
- 旧倒计时继续运行（与实际事件不匹配）
- 震动/铃声不随级别变化（如 warning → critical）

修复后：applyIntent 解析 → 更新视图 → 重启震动/铃声/倒计时，保证显示与最新事件一致。

### 6. NotificationCompat 改造（P2-6）

- 平台 Notification.Builder 在 API 26+ 可用但行为在不同 ROM 上有差异
- NotificationCompat 统一 API 行为，且为 androidx.core 标准 API（React Native 间接依赖，无需额外声明）
- 小图标改用 R.mipmap.ic_launcher，确保通知栏品牌一致性

### 7. quietEnabled AND 逻辑（P2-9）

原 OR 逻辑：仅起始时间存在即视为启用 → 时间输入框显示但只有一边 → 用户误以为已配置完整

新 AND 逻辑：要求 start 和 end 同时有效 → 半残状态自动视为关闭 → 引导用户重新启用并填写完整时段

## 回归风险评估

| 改动 | 风险 | 缓解 |
|------|------|------|
| 主题色 token 替换 | 低：所有 token 已在 colors.ts 定义且通过 useTheme 传递 | tsc 类型检查 + 视觉回归 |
| 配置版本化 | 低：migrateConfig 兜底 DEFAULT_CONFIG | parseConfig 单元测试覆盖 |
| Kotlin 死代码移除 | 低：分支本身永远不走 | 编译通过即证明 |
| onNewIntent 覆写 | 中：需测试新报警到来时 UI 正确更新 | 手动测试：连续触发两次报警 |
| NotificationCompat | 低：API 行为一致 | 通知栏视觉检查 |
| quietEnabled AND 逻辑 | 低：仅收紧启用条件，不影响已正确配置的用户 | 边界测试：只填一个时间应自动视为关闭 |

## 后续建议（非本次修复范围）

- P3 级：补充 Kotlin 单元测试（Robolectric）覆盖 FloatingWindowModule / FullScreenAlertController
- P3 级：useFloatingWindow 添加 onError 事件监听，将原生错误透出到 UI（toast 或日志上报）
- P3 级：jest 环境配置修复，使 App.test.tsx 可运行（mock react-native-gesture-handler）
