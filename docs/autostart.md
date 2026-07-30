# 开机自启动设计（Task 9）

本文档说明地震预警 App 的开机自启动功能设计。代码位于 `android/app/src/main/java/com/mdoeeewapp/android/cn/autostart/` 与 `src/native/`、`src/hooks/`。

## 1. 设计目标

- **开机后自动拉起后台服务**：设备开机完成后，自动启动后台服务，无需用户手动打开 App。
- **静默启动**：开机后不弹出主界面，仅启动后台服务。
- **厂商兼容**：针对国产 ROM（小米/华为/OPPO/vivo/魅族等）提供自启动设置页跳转引导。
- **保活服务**：开机后启动 `EewBackgroundService` 前台服务，通过常驻通知维持进程存活。
- **锁屏预警**：后台服务原生层接收 WebSocket 预警数据，锁屏时按配置触发悬浮窗（详见 [floating-window.md](./floating-window.md#锁屏预警实现eewbackgroundservice)）。

## 2. 目录结构

```
android/app/src/main/java/com/mdoeeewapp/android/cn/autostart/
├── BootReceiver.kt          # 开机广播接收器
├── BootStarterService.kt    # 占位前台服务（保留，已被 EewBackgroundService 替代）
├── AutoStartModule.kt       # 厂商自启动设置跳转原生模块
└── AutoStartPackage.kt      # ReactPackage 注册

android/app/src/main/java/com/mdoeeewapp/android/cn/background/
├── EewBackgroundService.kt   # 后台保活 + 锁屏预警前台服务（WebSocket + 事件触发）
├── EewAlertEngine.kt         # 原生层预警计算引擎（CSIS 烈度 + S 波到达 + 预警级别）
├── BackgroundServiceModule.kt # RN 桥接模块（start/stop/updateConfig/updateLocation/notifyAppInForeground）
├── BackgroundServicePackage.kt # ReactPackage 注册
└── ReactContextProvider.kt   # 全局 ReactContext 提供者（供 Service 获取 ReactContext）

src/
├── native/
│   ├── AutoStartManager.ts        # RN 层自启动管理接口
│   └── BackgroundServiceManager.ts # RN 层后台服务管理接口（含配置同步 + 前后台通知）
└── hooks/
    ├── useAutoStart.ts          # useAutoStart Hook 封装
    └── useBackgroundService.ts  # 后台保活 Hook
```

## 3. 模块说明

### 3.1 BootReceiver

监听两个开机广播：

| Action | 触发时机 | API |
|--------|---------|-----|
| `android.intent.action.BOOT_COMPLETED` | 用户解锁后 | API 1+ |
| `android.intent.action.LOCKED_BOOT_COMPLETED` | 设备加密启动完成（用户解锁前） | API 24+ |

收到广播后：
1. 验证 action 为上述任一广播。
2. 调用 `context.startForegroundService(Intent(this, EewBackgroundService::class.java))`。
3. 不启动 MainActivity（静默启动）。
4. 输出 `Log.i("BootReceiver", "Boot completed, starting service")`。

### 3.2 EewBackgroundService（后台保活 + 锁屏预警）

前台服务，通过常驻通知维持 App 进程存活，防止锁屏后 RN JS 线程被系统挂起。同时在原生层接收 WebSocket 预警数据，锁屏时按配置触发悬浮窗。

**保活能力**：
- **通知渠道**：`eew_service`，名称"地震预警服务"，重要性 `IMPORTANCE_LOW`（不发声、不弹窗）。
- **通知内容**：`"持续接收预警数据"`，常驻 `setOngoing(true)`，`setSilent(true)`。
- **onCreate**：创建渠道、注册 ComponentCallbacks2、设置 instance 引用。
- **onStartCommand**：`startForeground` + 调用 `reloadCustomSources()` 按 customSources 多源配置启动所有 WS/HTTP 连接，返回 `START_STICKY`（被杀后系统自动重启）。
- **onBind**：返回 `null`（不允许绑定）。
- **启动方式**：
  - App 启动时由 RN 侧 `BackgroundServiceModule.start()` 主动启动（当 `backgroundEnabled=true`）
  - 开机时由 `BootReceiver` 启动

**锁屏预警能力**（v13+ 合规改造，多源并行模式）：
- **OkHttp WebSocket / HTTP 客户端**：按 `customSource.protocol` 选择连接方式，从 SharedPreferences 读取 `customSources` JSON 数组配置，为每个源创建独立的 `SourceConnection` 实例，独立于 RN JS 层（锁屏时不被系统暂停）
- **指数退避重连**（WS）：初始 1s，倍数 2，上限 30s（每个源独立维护重连状态）
- **心跳超时**（HTTP）：`max(pollIntervalMs * 3, 10000ms)`
- **配置热更新**：`reloadCustomSources()` 停止所有旧连接 → 读新配置数组 → 为每个源启动新连接
- **事件处理**：`handleSourceData(text, config)` 调用 `EewAlertEngine.parseWithMapping(raw, fieldMapping)` 解析 → 转发 JS → 启动 LockScreenAlertActivity（App 不在前台时）
- **前后台检测**：`ComponentCallbacks2.onTrimMemory(TRIM_MEMORY_UI_HIDDEN)` 检测 App 进入后台
- **事件转发**：通过 `DeviceEventEmitter` 发送 `onEewEvent` 和 `onWsStatus` 事件给 JS 层
- **配置存储**：从 `SharedPreferences`（`eew_alert_config` 文件）读取 alert 配置、用户位置和 customSources（多源 JSON 数组）
- **触发条件检查**：`tryTriggerFloatingWindow(event, sourceName)` 检查 lockScreenEnabled、floatingWindowEnabled、minMagnitude、lockScreenIntensity、预警级别、S 波到达、App 前后台状态
- **锁屏显示**：启动 `LockScreenAlertActivity`（配置 `setShowWhenLocked(true)`），显示在锁屏界面之上，自带倒计时 tick

**配置同步方法**（供 BackgroundServiceModule 调用）：
- `updateAlertConfig(ReadableMap)`：更新 alert 配置到 SharedPreferences
- `updateLocationConfig(ReadableMap)`：更新用户位置到 SharedPreferences
- `updateCustomSourcesJson(String?)`：写入/删除 `customSources` 多源配置（JSON 数组），并触发 `reloadCustomSources()` 热更新所有连接
- `notifyAppInForeground()`：设置 `appInForeground=true`，避免后台重复触发悬浮窗

> 注：实际配置写入由 `BackgroundServiceModule` 直接操作 SharedPreferences，不依赖 Service 实例是否存活。Service 仅在触发悬浮窗时读取 SharedPreferences。customSource 配置变更会立即触发 `reloadCustomSources()` 热更新所有连接（若 Service 已启动）。

> 原 `BootStarterService.kt` 占位实现已保留但不再使用，BootReceiver 改为启动 `EewBackgroundService`。

使用 `NotificationCompat.Builder`（`androidx.core` 由 RN 间接依赖），统一通知构建 API。

### 3.3 AutoStartModule

`ReactContextBaseJavaModule`，模块名 `AutoStartModule`，提供 `@ReactMethod openAutoStartSettings(promise)`。

根据 `Build.MANUFACTURER.lowercase()` 判断厂商，尝试跳转对应 ROM 的自启动管理页：

| 厂商 | Intent 目标 |
|------|------------|
| Xiaomi / Redmi | `com.miui.securitycenter/.permcenter.autostart.AutoStartManagementActivity` |
| Huawei / Honor | `com.huawei.systemmanager/.startupmgr.ui.StartupNormalAppListActivity` |
| OPPO | `com.coloros.safecenter/...StartupAppListActivity`（兼容 `com.oppo.safe`） |
| vivo | `com.iqoo.secure/.ui.phoneoptimize.AddWhiteListActivity` |
| Meizu | `com.meizu.safe/.security.SHOW_APPSEC` |
| Samsung / 其他 | 回退到 `Settings.ACTION_APPLICATION_DETAILS_SETTINGS` |

- 所有 `startActivity` 用 `try-catch` 包裹，失败时尝试下一个 Intent。
- 全部失败时 `promise.resolve(false)`，成功时 `promise.resolve(true)`。
- 厂商 Intent 没有官方文档保证，可能随 ROM 版本变化而失效，因此保留应用详情页作为最终回退。

### 3.4 AutoStartPackage

标准 `ReactPackage`，将 `AutoStartModule` 注册到 RN。

> **TODO: 需在 MainApplication.kt 中注册 AutoStartPackage**

由 Task 7 子代理在 `MainApplication.kt` 的 `PackageList` 中手动 `add(AutoStartPackage())`，避免本任务直接修改 `MainApplication.kt` 引起冲突。

### 3.5 AutoStartManager（RN 层）

```typescript
export const AutoStartManager = {
  async isAutoStartEnabled(): Promise<boolean>;
  async openAutoStartSettings(): Promise<boolean>;
};
```

- `isAutoStartEnabled`：标准 Android API 无法查询自启动权限，仅返回权限是否已声明。Android 上恒返回 `true`，其他平台 `false`。
- `openAutoStartSettings`：调用 `NativeModules.AutoStartModule?.openAutoStartSettings()`，原生模块未注册时返回 `false`。

### 3.6 useAutoStart Hook

```typescript
const { isAutoStartEnabled, checkAutoStartEnabled, openAutoStartSettings } = useAutoStart();
```

简单封装 `AutoStartManager`，提供状态 `isAutoStartEnabled`（受 `checkAutoStartEnabled` 异步更新）与跳转方法。

## 4. 集成清单（由主代理统一完成）

本任务只创建新文件，以下集成步骤由主代理/Task 7 子代理统一处理，避免冲突：

### 4.1 AndroidManifest.xml 注册

```xml
<!-- 权限 -->
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.DISABLE_KEYGUARD" />

<!-- 在 <application> 内注册 -->
<receiver
    android:name=".autostart.BootReceiver"
    android:enabled="true"
    android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.BOOT_COMPLETED" />
        <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
    </intent-filter>
</receiver>

<service
    android:name=".autostart.BootStarterService"
    android:enabled="true"
    android:exported="false"
    android:foregroundServiceType="dataSync" />

<!-- 后台保活 + 锁屏预警服务 -->
<service
    android:name=".background.EewBackgroundService"
    android:enabled="true"
    android:exported="false"
    android:foregroundServiceType="dataSync" />

<!-- 锁屏预警 Activity（显示在锁屏界面之上） -->
<activity
    android:name=".floatingwindow.LockScreenAlertActivity"
    android:showWhenLocked="true"
    android:turnScreenOn="true"
    android:excludeFromRecents="true"
    android:taskAffinity=""
    android:launchMode="singleInstance"
    android:exported="false"
    android:theme="@android:style/Theme.Translucent.NoTitleBar" />
```

**权限说明**：
- `RECEIVE_BOOT_COMPLETED`：接收开机广播
- `FOREGROUND_SERVICE`：启动前台服务
- `FOREGROUND_SERVICE_DATA_SYNC`：Android 14+ 前台服务细粒度权限（dataSync 类型）
- `WAKE_LOCK`：锁屏预警时唤醒 CPU 并点亮屏幕（LockScreenAlertActivity 的 WakeLock）
- `DISABLE_KEYGUARD`：锁屏预警 Activity 请求解除键盘锁（仅无密码设备自动解除）

### 4.2 MainApplication.kt 注册 AutoStartPackage

```kotlin
override val reactHost: ReactHost by lazy {
  getDefaultReactHost(
    context = applicationContext,
    packageList = PackageList(this).packages.apply {
      add(com.androideewapp.autostart.AutoStartPackage())
    },
  )
}
```

## 5. 关键设计决策

| 决策 | 原因 |
|------|------|
| 使用 `Notification.Builder` 而非 `NotificationCompat.Builder` | minSdk 26 原生支持通知渠道，避免引入 `androidx.core` 显式依赖（虽然 RN 会传递引入） |
| 监听 `LOCKED_BOOT_COMPLETED` | 在用户解锁前也能拉起服务，提高首次预警时效性 |
| BootStarterService 返回 `START_STICKY` | 被系统杀死后自动重启，符合"服务被杀自恢复"需求 |
| 通知使用 `IMPORTANCE_LOW` + `setSilent(true)` | 不打扰用户，仅维持进程存活 |
| `isAutoStartEnabled` 恒返回 `true` | 标准 Android API 无法查询 ROM 自启动开关状态，避免误导调用方 |
| 厂商 Intent 全部 try-catch | 厂商 Intent 无官方文档保证，可能随 ROM 版本失效 |
| 不修改 AndroidManifest.xml / MainApplication.kt | 由主代理统一处理，避免与 Task 7 子代理冲突 |
| 不启动 MainActivity | 静默启动，符合"开机后台拉起服务"需求 |

## 6. 验收清单

- [x] BootReceiver.kt 监听 BOOT_COMPLETED + LOCKED_BOOT_COMPLETED
- [x] BootStarterService.kt 是 Foreground Service（占位实现）
- [x] AutoStartModule.kt 实现厂商自启动设置跳转
- [x] AutoStartPackage.kt 注册模块
- [x] src/native/AutoStartManager.ts RN 层接口
- [x] src/hooks/useAutoStart.ts 封装
- [x] `npx tsc --noEmit` 通过（见任务执行报告）

## 7. 后续依赖

- ~~Task 4 完成后：删除 `BootStarterService.kt` 或将其作为 fallback，BootReceiver 改为启动真正的 `EewBackgroundService`。~~ **已完成**：BootReceiver 已改为启动 `EewBackgroundService`，`BootStarterService.kt` 保留但不再使用。
- **Task 7 完成后**：在 `MainApplication.kt` 中注册 `AutoStartPackage` 和 `BackgroundServicePackage`，RN 层接口才会生效。
- **Task 10（权限引导页）**：在引导页中调用 `useAutoStart`，引导用户检查厂商 ROM 自启动开关。
- **锁屏预警能力**：`EewBackgroundService` 已升级为完整锁屏预警服务（OkHttp WS/HTTP + 事件触发 + 配置同步），详见 [floating-window.md](./floating-window.md#锁屏预警实现eewbackgroundservice)。
  - 原生层按 `customSource.protocol` 启动 WebSocket 或 HTTP 连接，独立于 RN JS 层
  - `BackgroundServiceModule` 提供 `updateConfig` / `updateLocation` / `updateCustomSourcesJson` / `notifyAppInForeground` 方法供 RN 层同步配置
  - `HomeScreen.tsx` 在配置变化和 AppState 'active' 时自动同步 alert 配置、用户位置和所有活跃 customSource（多源数组）到原生层
  - `FloatingWindowModule` 添加 `showFromBackground()` 方法和锁屏显示 flag（`FLAG_SHOW_WHEN_LOCKED` 等）+ WakeLock
