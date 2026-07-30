# 高德地图集成说明

> [!CAUTION]
> **已放弃使用**：高德地图 SDK（Lite3dMap）集成方案已废弃，不再维护。当前地图实现已改用其他方案，本文档仅作历史参考。

本文档记录高德地图 SDK（Lite3dMap）在 React Native 项目中的集成方案。

## 集成方案概述

采用 **原生 ViewManager + AAR 离线包** 方式集成高德地图，不依赖网络 Maven 仓库，适合国内开发环境。

| 项 | 值 |
|----|------|
| SDK 包 | Lite3dMap_1.2.0_AMapSearch_9.8.0_AMapLocation_11.2.000_20260603.aar |
| 包含模块 | Lite3dMap 1.2.0（轻量3D地图）+ AMapSearch 9.8.0（搜索）+ AMapLocation 11.2.000（定位） |
| 引入方式 | 本地 AAR 文件（`android/app/libs/`） |
| API Key | 在高德控制台创建应用后获取，配置于 AndroidManifest.xml |
| 应用包名 | com.mdoeeewapp.android.cn |
| SHA1 签名 | 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25 |

## 文件清单

### 原生层（Kotlin）

| 文件 | 作用 |
|------|------|
| `android/app/libs/Lite3dMap_...aar` | 高德 SDK 离线包 |
| `android/app/src/main/java/com/mdoeeewapp/android/cn/amap/AMapViewManager.kt` | 地图视图管理器，将 MapView 暴露给 RN |
| `android/app/src/main/java/com/mdoeeewapp/android/cn/amap/AMapViewPackage.kt` | 包注册，将 AMapViewManager 加入 RN |
| `android/app/src/main/java/com/mdoeeewapp/android/cn/amap/CoordTransform.kt` | WGS-84 → GCJ-02 坐标转换工具（中国境内偏移修正） |
| `android/app/src/main/res/values/ids.xml` | tag ID 资源（用于异步回调前缓存 props） |

### RN 层（TypeScript）

| 文件 | 作用 |
|------|------|
| `src/components/EpicenterMap.tsx` | 地图组件，通过 `requireNativeComponent('AMapView')` 使用原生地图 |

### 配置文件

| 文件 | 变更内容 |
|------|----------|
| `android/app/build.gradle` | 添加 `flatDir { dirs 'libs' }` 仓库 + AAR 依赖 |
| `android/app/src/main/AndroidManifest.xml` | 添加高德 API Key meta-data + 定位权限 |
| `android/app/src/main/java/com/mdoeeewapp/android/cn/MainApplication.kt` | 注册 AMapViewPackage |

## Lite3dMap API 说明

Lite3dMap 是高德轻量版 3D 地图 SDK，与完整版 3D Map SDK 有以下差异：

### MapView

| 方法 | 说明 |
|------|------|
| `MapView(context)` | 构造函数 |
| `onCreate(bundle)` | 生命周期，必须调用 |
| `onResume()` / `onPause()` | 生命周期 |
| `onDestroy()` | 生命周期，必须调用以释放资源 |
| `getMapAsyn(OnMapReadyListener)` | **异步**获取 AMap 实例（注意：无同步 `getMap()` 方法） |

### AMap

| 方法 | 说明 |
|------|------|
| `addMarker(MarkerOptions)` | 添加标记 |
| `addCircle(CircleOptions)` | 添加圆形覆盖物 |
| `clear()` | 清空所有覆盖物 |
| `moveCamera(CameraUpdate)` | 移动相机 |
| `setMyLocationEnabled(boolean)` | 启用/禁用定位蓝点 |
| `setMyLocationStyle(MyLocationStyle)` | 设置定位蓝点样式 |
| `getUiSettings()` | 获取 UI 设置 |

### UiSettings（精简版）

Lite3dMap 的 UiSettings 仅提供手势控制 API，**没有** zoomControls、compass、scaleControls 等 UI 控件：

| 方法 | 说明 |
|------|------|
| `setScrollGesturesEnabled(boolean)` | 滚动手势 |
| `setZoomGesturesEnabled(boolean)` | 缩放手势 |
| `setRotateGesturesEnabled(boolean)` | 旋转手势 |
| `setTiltGesturesEnabled(boolean)` | 倾斜手势 |
| `setAllGesturesEnabled(boolean)` | 全部手势 |

## AMapViewManager 暴露的 Props

| Prop | 类型 | 说明 |
|------|------|------|
| `markers` | `Array<{lat, lng, title?}>` | 震中标记数组（WGS-84），每次更新清空重建；空数组不清空已有标记 |
| `userLocation` | `{lat, lng}` | 用户位置（WGS-84），显示蓝色定位点 |
| `zoomLevel` | `number` | 缩放级别（3-20，默认 7） |

## 坐标系转换（WGS-84 → GCJ-02）

### 背景

高德地图底图使用 **GCJ-02 火星坐标系**，而地震预警数据（震中坐标、用户定位）通常为 **WGS-84 坐标系**。若直接将 WGS-84 坐标传给高德 MapView，中国境内震中标记会偏移 300-500 米，且缩放级别越高错位越明显。境外坐标（如日本 JMA 数据）不受 GCJ-02 加密影响，无需转换。

### 实现方案

在原生层 [`CoordTransform.kt`](../android/app/src/main/java/com/mdoeeewapp/android/cn/amap/CoordTransform.kt) 中实现标准 GCJ-02 加密公式，`AMapViewManager` 在构造 `LatLng` 之前调用 `CoordTransform.wgs84ToGcj02(lat, lng)` 完成转换。

| 项 | 值 |
|----|------|
| 算法 | 标准 GCJ-02 加密公式（Krasovsky 1940 椭球 + 偏导数迭代） |
| 椭球长半轴 a | 6378245.0 米 |
| 第一偏心率平方 ee | 0.00669342162296594323 |
| 中国境内判定边界 | 经度 70~140，纬度 15~55 |
| 境外坐标处理 | 直接返回原值（不转换） |
| 转换入口 | `CoordTransform.wgs84ToGcj02(lat, lng): DoubleArray`，返回 `[gcj02Lat, gcj02Lng]` |

### 转换应用点

`AMapViewManager` 在以下位置对传入的 WGS-84 坐标执行转换：

- `applyMarkers`：震中圆形覆盖物中心、marker 位置、单标记时相机移动目标
- `applyUserLocation`：用户定位蓝点位置、相机移动目标

> RN 层（`EpicenterMap.tsx`）无需感知坐标系差异，仍以 WGS-84 传递坐标，转换在原生层透明完成。

## 震源显示修复

### 异步回调 props 缓存

`MapView.getMapAsyn()` 是异步获取 AMap 实例的，props 可能在地图就绪前到达。`AMapViewManager` 的处理策略：

1. 每个 `@ReactProp` setter 在调用时立即将 `ReadableArray` / `ReadableMap` **解析为纯 Kotlin 数据结构**（`MarkerData` / `UserLocationData`）后缓存到 `View.setTag()`。
2. setter 同时注册 `getMapAsyn` 回调，地图就绪后应用缓存的纯数据。
3. `createViewInstance` 中的 `getMapAsyn` 回调从 tag 读取并应用所有缓存 props。

> **重要**：`ReadableArray` / `ReadableMap` 在 setter 返回后可能被 RN 桥回收，若直接缓存原生引用并在异步回调中读取，会导致震源标记不显示。改为在 setter 中即时解析为纯 Kotlin 数据结构后即可避免该问题。

### 空 markers 处理

当 RN 端传入空 markers 数组（如初始状态）时，`applyMarkers` 直接返回**不调用 `aMap.clear()`**，避免地图闪烁。仅当 markers 非空时才清空旧标记并重建。

## 构建验证

- 初版构建成功（3m 24s），APK 安装到小米 22101316C (Android 12)，应用以 `com.mdoeeewapp.android.cn/.MainActivity` 启动
- 坐标转换 + 震源显示修复后：`compileDebugKotlin` 编译通过（JDK 17）

## 后续可扩展功能

- **定位**：使用 AMapLocationClient 实现实时定位（已在 AAR 中包含）
- **搜索**：使用 AMapSearch SDK 实现地点搜索（已在 AAR 中包含）
- **自定义地图样式**：通过 `AMap.setCustomMapStyle()` 设置离线样式文件
- **标记点击事件**：通过 `AMap.setOnMarkerClickListener` 回调到 RN
