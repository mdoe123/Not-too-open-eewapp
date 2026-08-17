# 用户定位与后台定位刷新设计

本文档说明地震预警 App 的用户定位来源、前后台定位差异以及后台主动定位刷新机制。
涉及前台 JS 定位（`useUserLocation`）、原生层定位封装（`LocationProvider`）与后台服务
（`EewBackgroundService`）三部分。代码分布见文末目录结构。

## 1. 定位来源总览

| 场景 | 位置来源 | 是否实时 | 说明 |
|------|---------|---------|------|
| 前台（App 打开） | JS `useUserLocation`（GPS/watchPosition） | 是 | 实时跟踪，`isMock` 标识降级状态 |
| 后台/锁屏 | SharedPreferences 缓存坐标 | 否 | 依赖前台或后台轮询写入的缓存 |
| 手动模式 | JS `useUserLocation` 手动坐标 | 固定 | 用户固定输入，不参与后台刷新 |

## 2. 前台定位（JS 层）

文件：`src/hooks/useUserLocation.ts`

- 支持 `mode='gps'` 与 `mode='manual'` 两种来源。
- GPS 模式：`getCurrentPosition` 快速取一次（8s 高精度，超时降级 7s 低精度重试）+ `watchPosition`
  持续更新（间隔 1min、位移 100m 阈值）。
- 失败/权限拒绝 → 降级到 mock 坐标（北京 `39.9, 116.4`），`isMock=true`。
- 手动模式：返回 `manualLat/manualLng`，`isMock=true`（非真实 GPS）。

### 同步到原生层（防污染）

文件：`src/screens/HomeScreen.tsx`、`src/native/BackgroundServiceManager.ts`

- GPS 模式下 `isMock=true`（尚未拿到真实定位）时**不同步**到原生层，避免用默认北京坐标污染后台计算。
- 同步通过 `BackgroundServiceManager.updateLocation(buildLocationUpdate(...))`，负载含
  `userLat / userLng / mode`（`"gps"`/`"manual"`）/ `backgroundRefreshEnabled`。

## 3. 原生层定位（LocationProvider.kt）

新增文件：`android/.../background/LocationProvider.kt`

- 纯 Android 原生 `LocationManager` 实现，**不依赖 Google Play Services**，适配国内无 GMS 设备。
- 提供 `getCurrentLocation(onResult)`：先复用 10 分钟内 `getLastKnownLocation` 缓存，否则
  `requestSingleUpdate` 主动获取（15s 超时兜底）。
- fail-open：权限缺失 / Provider 不可用 / 异常一律回调 null，不抛错、不阻塞预警主流程。
- 回调统一切回主线程。

## 4. 后台定位刷新（EewBackgroundService）

目标：对抗"自启动/后台时只吃缓存坐标导致位置陈旧"的问题。前台账 + 原生层无实时定位，
本机制在原生层主动维持坐标新鲜度。

**开关**：设置 → 位置设置 → 「后台定位刷新」（`LocationConfig.backgroundRefreshEnabled`，
默认开启，**仅 GPS 模式显示并生效**）。手动模式不显示该开关。

### 4.1 15 分钟主动轮询（仅 GPS 模式 + 开关开启）

- 常量 `LOCATION_REFRESH_INTERVAL_MS = 15 * 60 * 1000L`（15 分钟）。
- `onStartCommand` 启动 `startLocationPolling()`，`onDestroy` 调 `stopLocationPolling()`。
- 轮询前读 SharedPreferences `locationMode` 与 `backgroundRefreshEnabled`：
  仅 `"gps"` 且开关开启时调用 `LocationProvider` 刷新；手动模式/开关关闭不主动定位。
- 成功刷新后写回 `userLat / userLng / userLocTimestamp`。
- 失败静默等下一轮（fail-open）。

### 4.2 收到预警时"先缓存触发 + 后刷新更新"

- `tryTriggerFloatingWindow` 仍用缓存坐标**立即**判定/触发（保证低延迟，路径不变）。
- 触发成功后调用 `refreshLocationAndUpdateEvent(event, sourceName)`（仅 GPS 模式 + 开关开启）：
  异步一次定位 → 写回新坐标 → 调 `updateDisplayedEvent` 用新坐标重算震中距/烈度并刷新已显示 UI。
- 手动模式或开关关闭跳过此步骤。

### 4.3 SharedPreferences 新增字段

| Key | 类型 | 含义 |
|-----|------|------|
| `locationMode` | String | `"gps"` / `"manual"`，决定后台是否主动定位 |
| `backgroundRefreshEnabled` | Boolean | 后台定位刷新开关（默认 true，仅 GPS 生效） |
| `userLocTimestamp` | Long | 最近一次坐标写入时间戳（毫秒） |

`BackgroundServiceModule.updateLocation` 同步写入三者；`refreshLocation()` 同样检查
`locationMode == gps` 且开关开启才生效。

## 5. 陈旧阈值（Assumption）

用户采用"15 分钟主动刷新"策略维持坐标新鲜，**未引入"坐标陈旧则跳过触发"逻辑**；
30 分钟阈值仅作参考，不改变触发行为。首次安装/清数据/从未定位成功的场景，后台默认坐标
`39.9, 116.4`（北京）行为维持现状（该场景优先级低，暂不处理）。

## 6. 目录结构

```
src/
├── hooks/useUserLocation.ts          # 前台定位 Hook（gps/manual + isMock 降级）
├── native/BackgroundServiceManager.ts # RN 层接口（updateLocation 含 mode、refreshLocation）
└── screens/HomeScreen.tsx             # 同步位置到原生层（GPS mock 不同步）

android/app/src/main/java/com/mdoeeewapp/android/cn/background/
├── LocationProvider.kt          # 原生 LocationManager 定位封装（新增）
├── EewBackgroundService.kt      # 15 分钟轮询 + 触发后异步刷新更新
├── BackgroundServiceModule.kt   # updateLocation(lat/lng/mode/timestamp) + refreshLocation
└── ...                          # 其余既有后台模块
```

## 7. 注意事项

- Android 10+ 后台精准定位可能被系统压缩为低精度（网络定位）；本方案用前台常驻服务 +
  `requestSingleUpdate` 尽力获取，未申请 `ACCESS_BACKGROUND_LOCATION`。
- 后台轮询每 15 分钟一次、失败 fail-open，已控制在低功耗、不阻塞预警的范围。