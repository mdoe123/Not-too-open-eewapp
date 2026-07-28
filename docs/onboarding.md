# 权限引导页设计（Task 10）

本文档说明地震预警 App 的权限引导页（Onboarding）功能设计。代码位于 `src/screens/onboarding/`、`src/hooks/`。

## 1. 设计目标

- **首次启动引导**：首次启动 App 时展示权限引导页，引导用户授予地震预警所需权限。
- **整合已有权限模块**：整合 Task 7（悬浮窗）、Task 8（锁屏报警，VIBRATE 已在 manifest 无需运行时请求）、Task 9（开机自启）的权限请求入口。
- **黑白简约风格**：遵循项目 UI/UX 偏好，SVG 线条图标，支持亮色与暗色模式。
- **避免误触**：按钮尺寸足够大（≥36px），状态切换有视觉反馈。
- **可跳过**：用户可选择"稍后设置"，标志写入 AsyncStorage，后续可在设置页重新触发引导（resetOnboarding）。

## 2. 目录结构

```
src/
├── screens/
│   └── onboarding/
│       ├── OnboardingScreen.tsx    # 引导页主组件
│       ├── PermissionRow.tsx       # 单行权限项组件
│       ├── OnboardingIcons.tsx     # SVG 图标集合（8 个）
│       └── permissionItems.ts      # 权限项定义（6 项）
├── hooks/
│   ├── usePermissions.ts           # 权限状态管理 Hook
│   └── useOnboarding.ts            # 首次启动检测 Hook
└── navigation/
    └── types.ts                    # 添加 Onboarding 路由（已修改）

App.tsx                              # 集成 Onboarding 路由与首次启动逻辑（已修改）
```

## 3. 模块说明

### 3.1 permissionItems.ts — 权限项定义

定义 `PermissionItem` 接口与 `PERMISSION_ITEMS` 数组（6 项）：

| id | 权限 | title | required | check / request 实现 |
|----|------|-------|----------|---------------------|
| location | ACCESS_FINE_LOCATION | 位置权限 | ✅ | `react-native-permissions` 的 `check` / `request` |
| overlay | SYSTEM_ALERT_WINDOW | 悬浮窗权限 | ✅ | `FloatingWindowManager.hasPermission` / `requestPermission` |
| notification | POST_NOTIFICATIONS（Android 13+） | 通知权限 | ✅ | `checkNotifications` / `requestNotifications`（自动适配 Android 12 及以下） |
| battery | REQUEST_IGNORE_BATTERY_OPTIMIZATIONS | 电池优化白名单 | ❌ | check 恒返回 false；request 用 `Linking.openSettings()` 跳转 |
| autostart | 厂商 ROM 自启动 | 自启动权限 | ❌ | `AutoStartManager.isAutoStartEnabled` / `openAutoStartSettings` |
| background | 无（信息说明项） | 保持后台运行 | ❌ | check 恒返回 true；request 无操作 |

**required 设计**：
- 位置 / 悬浮窗 / 通知为必须（阻塞"完成"按钮）。
- 电池优化 / 自启动为推荐项（不阻塞完成，但强烈建议开启）。
- 后台运行为纯信息说明项（无权限需请求）。

### 3.2 usePermissions.ts — 权限状态管理 Hook

```typescript
const {
  statusMap,           // Record<PermissionId, boolean> 各权限授予状态
  loadingMap,          // Record<PermissionId, boolean> 各权限请求中状态
  ready,               // boolean 初次加载是否完成
  allRequiredGranted,  // boolean 所有 required 权限是否已授予
  refreshStatus,       // () => Promise<void> 重新检查所有权限
  requestPermission,   // (id) => Promise<boolean> 请求单个权限
} = usePermissions();
```

- 挂载时并行检查所有权限状态（`Promise.all`）。
- `requestPermission` 调用对应项的 `request`，完成后自动 `check` 刷新该项状态。
- 防止重复请求（loading 中直接返回当前状态）。
- 组件卸载后通过 `mountedRef` 避免状态更新。

### 3.3 useOnboarding.ts — 首次启动检测 Hook

```typescript
const {
  isCompleted,        // boolean | null（null 表示加载中）
  completeOnboarding, // () => Promise<void> 写入完成标志
  resetOnboarding,    // () => Promise<void> 清除标志（供设置页重新引导）
} = useOnboarding();
```

- AsyncStorage 键：`@eew_onboarding_completed`，值为 `'true'` 字符串。
- 首次启动（无键）→ `isCompleted = false` → 初始路由 Onboarding。
- 已完成 → `isCompleted = true` → 初始路由 Home。
- 读取失败视为未完成，保证引导页可显示。

### 3.4 OnboardingIcons.tsx — SVG 图标

8 个图标，统一规格：24×24 viewBox，stroke=currentColor，fill=none，strokeWidth=1.5：

| 图标 | 用途 |
|------|------|
| `LocationPermissionIcon` | 位置权限（地图针） |
| `OverlayPermissionIcon` | 悬浮窗（叠加窗口） |
| `NotificationPermissionIcon` | 通知（铃铛） |
| `BatteryPermissionIcon` | 电池优化（电池+闪电） |
| `AutoStartPermissionIcon` | 自启动（电源符号） |
| `BackgroundPermissionIcon` | 后台运行（窗口+支架） |
| `CheckCircleIcon` | 已开启对勾（圆圈对勾） |
| `WaveLogoIcon` | App logo（地震波纹同心圆） |
| `ArrowForwardIcon` | 去开启箭头（向右箭头） |

### 3.5 PermissionRow.tsx — 单行权限项组件

布局：`[图标] [名称(带必填星号) + 说明] [状态/按钮]`

- **已授予**：绿色对勾 + "已开启"标签（亮色 `#2E7D32`，暗色 `#81C784`）。
- **未授予**："去开启"按钮（带箭头图标，minHeight 36 避免误触）。
- **请求中**：`ActivityIndicator` 加载指示器。
- 必填项名称后显示红色星号 `*`。

### 3.6 OnboardingScreen.tsx — 引导页主组件

布局：
- **顶部**：圆形 logo（地震波纹）+ 标题"地震预警"+ 副标题。
- **中部**：ScrollView 包裹 6 个 PermissionRow。
- **底部**："完成"按钮（仅 `allRequiredGranted` 时可点击，反色填充）+ "稍后设置"文字按钮。

完成逻辑：
- "完成"：`completeOnboarding()` 写入标志 → `navigation.replace('Home')`（replace 避免返回键回到引导页）。
- "稍后设置"：同样写入标志 → `navigation.replace('Home')`。

### 3.7 App.tsx 集成

- 调用 `useOnboarding()` 读取完成标志。
- `isCompleted === null`（加载中）→ 渲染空白启动屏，避免路由闪烁。
- `isCompleted === false` → `initialRouteName = 'Onboarding'`。
- `isCompleted === true` → `initialRouteName = 'Home'`。
- Stack 中注册 `Onboarding` Screen（`headerShown: false`）。

## 4. 集成清单（需主代理在 Android 侧完成）

### 4.1 AndroidManifest.xml 需添加的权限

以下权限需添加到 `android/app/src/main/AndroidManifest.xml` 的 `<manifest>` 标签内：

```xml
<!-- 位置权限（Task 10 引导页请求） -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

<!-- 通知权限（Android 13+ 运行时请求，Task 10 引导页请求） -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

> **说明**：
> - `ACCESS_FINE_LOCATION` 用于计算用户与震中距离、预估烈度。
> - `POST_NOTIFICATIONS` 为 Android 13（API 33）新增的运行时通知权限，当前 `targetSdk=34` 生效。`react-native-permissions` 的 `checkNotifications` / `requestNotifications` 内部会处理 Android 12 及以下（无需运行时请求）与 13+ 的差异。
> - `SYSTEM_ALERT_WINDOW`、`VIBRATE`、`RECEIVE_BOOT_COMPLETED`、`FOREGROUND_SERVICE`、`WAKE_LOCK` 已在 manifest 中声明，无需重复添加。
> - **电池优化白名单**（`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`）：当前简化方案未使用原生模块查询，仅用 `Linking.openSettings()` 跳转设置页，因此 manifest 无需添加该权限。若后续需要直接申请加入白名单，再添加 `<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />`。

### 4.2 react-native-permissions 配置

`react-native-permissions` v5 在 Android 上无需额外 setup（iOS 才需要手动注册 Permission Handler）。Android 端通过 Autolinking 自动集成，权限检查通过 `check` / `request` / `checkNotifications` / `requestNotifications` 调用。

> **注意**：v5 不再暴露 `PERMISSIONS.ANDROID.POST_NOTIFICATIONS` 常量，通知权限统一通过 `checkNotifications()` / `requestNotifications()` 处理。

## 5. 关键设计决策

| 决策 | 原因 |
|------|------|
| 通知权限用 `checkNotifications` 而非 `check(PERMISSIONS.ANDROID.POST_NOTIFICATIONS)` | `react-native-permissions` v5 不暴露该常量，且 `checkNotifications` 自动适配 Android 12 vs 13+ 差异 |
| 电池优化 check 恒返回 false | 标准 Android API 与 react-native-permissions 均不支持查询电池优化白名单状态；强制用户操作后由 UI 刷新（不阻塞完成） |
| 电池优化 / 自启动为 `required: false` | 这两项无法可靠查询状态且依赖厂商 ROM，设为必须会导致用户无法完成引导 |
| 后台运行项 check 恒返回 true | 纯信息说明项，无实际权限，显示对勾表示"无需操作" |
| 用 `navigation.replace('Home')` 而非 `navigate` | replace 替换路由栈，避免用户按返回键回到引导页 |
| `isCompleted === null` 时渲染空白启动屏 | 避免路由闪烁（先显示 Home 再跳 Onboarding） |
| AsyncStorage 键 `@eew_onboarding_completed` | 与 `useConfig` 的 `@eew_app_config` 命名空间一致 |
| "稍后设置"也写入完成标志 | 用户可后续在设置页通过 `resetOnboarding` 重新触发引导 |
| 图标颜色由父级显式传入 | 适配亮/暗模式，避免 `currentColor` 在 RN 中无 CSS 继承的问题 |
| 完成/去开启按钮 minHeight ≥ 36 | 避免误触，符合移动端可点击区域规范 |

## 6. 验收清单

- [x] permissionItems.ts 定义 6 个权限项
- [x] usePermissions.ts 提供检查与请求逻辑
- [x] OnboardingScreen.tsx 引导页 UI
- [x] PermissionRow.tsx 单行权限组件
- [x] OnboardingIcons.tsx 8 个 SVG 图标（实际 9 个，含 BackgroundPermissionIcon）
- [x] useOnboarding.ts 首次启动检测
- [x] App.tsx 集成 Onboarding 路由
- [x] `npx tsc --noEmit` 通过（exit code 0）
- [x] 报告需要添加到 manifest 的权限列表

## 7. 后续依赖

- **主代理需在 AndroidManifest.xml 添加**：`ACCESS_FINE_LOCATION`、`POST_NOTIFICATIONS` 权限声明。
- **设置页（Task 6 扩展）**：可调用 `useOnboarding().resetOnboarding()` 提供重新引导入口。
- **Task 4 后台服务**：完成后可考虑在引导页增加后台服务保活提示的准确性。
