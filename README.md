# NTOEEW (Not Too Open EEW App)

> 本项目由 **GLM-5.2** 制作

[![License: LGPL v3](https://img.shields.io/badge/License-LGPL_v3-blue.svg)](https://www.gnu.org/licenses/lgpl-3.0)
[![React Native](https://img.shields.io/badge/React%20Native-0.86.0-61DAFB.svg)](https://reactnative.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Android-3DDC84.svg)](https://developer.android.com/)

地震预警（Earthquake Early Warning, EEW）Android 应用，基于 React Native + TypeScript 构建。支持自定义数据源接入、实时预警联动（悬浮窗/锁屏全屏报警/声音/震动/闪光灯）、后台保活服务、开机自启动等能力。

## 功能特性

| 模块 | 说明 |
|------|------|
| 主界面 | 地图震中展示 + 实时预警卡列表 + 数据源状态栏，黑白简约风格，支持亮暗模式 |
| 设置页面 | 阈值（最低震级/锁屏烈度）、报警方式（铃声/震动/闪光灯/免打扰）、数据源管理、系统能力开关 |
| 自定义数据源 | customSource 字段映射配置，支持 WebSocket / HTTP 轮询，JSON Path 表达式解析，二维码分享 |
| 悬浮窗预警 | 原生 WindowManager 悬浮窗，填满屏幕宽度，倒计时显示，按烈度分档背景色 |
| 锁屏全屏预警 | 独立 Activity（setShowWhenLocked），点亮屏幕，全屏烈度色背景，声音/震动/闪光灯联动 |
| 后台保活服务 | ForegroundService 持续接收预警数据，独立于 JS 层的原生预警引擎 |
| 声音警报 | 5 频率叠加警报主音循环播放，DB/T 113.1-2026 标准 |
| 震动警报 | 循环震动（振 2s + 默 1s），与警报主音同步 |
| 闪光灯警报 | 相机闪光灯循环闪烁，仅烈度 ≥ 5 触发 |
| 开机自启动 | BootReceiver 接收开机广播 + 跳转厂商自启动设置页 |
| 权限引导页 | 首次启动检测，引导 6 项权限授权 |
| 模拟预警 | 内置测试页面，支持参数调节和 ADB 广播触发 |

## 技术栈

- **React Native** 0.86.0（Hermes 引擎、新架构）
- **React** 19.2.3
- **TypeScript** 6.x
- **Kotlin**（Android 原生模块）
- **Java** 17
- **Android** minSdk 26 / compileSdk 34 / targetSdk 34
- **OkHttp** WebSocket 客户端
- **react-native-maps** / **react-native-webview**：地图与 HTML 嵌入
- **@react-navigation/native**：导航
- **@react-native-async-storage/async-storage**：本地配置存储
- **@notifee/react-native**：本地通知
- **react-native-permissions**：运行时权限
- **react-native-vision-camera**：闪光灯控制
- **react-native-qrcode-svg**：数据源二维码分享

## 目录结构

```
android-eew-app/
├── android/app/src/main/java/com/mdoeeewapp/android/cn/
│   ├── MainActivity.kt                    # 主 Activity
│   ├── MainApplication.kt                 # Application
│   ├── autostart/                         # 开机自启动
│   │   ├── AutoStartModule.kt
│   │   ├── BootReceiver.kt
│   │   └── BootStarterService.kt
│   ├── background/                        # 后台保活服务
│   │   ├── EewBackgroundService.kt        # ForegroundService 主体
│   │   ├── EewAlertEngine.kt              # 预警计算引擎（烈度/S波/级别）
│   │   ├── BackgroundServiceModule.kt     # RN 桥接模块
│   │   ├── FieldMappingParser.kt          # 字段映射解析器
│   │   ├── CustomSourceManager.kt         # customSource 配置管理
│   │   ├── FileSourceImportModule.kt      # 文件导入数据源
│   │   └── ReactContextProvider.kt        # 原生模块全局提供者
│   ├── floatingwindow/                    # 悬浮窗与锁屏预警
│   │   ├── FloatingWindowModule.kt        # 悬浮窗管理
│   │   └── LockScreenAlertActivity.kt     # 锁屏预警 Activity
│   ├── sound/                             # 声音警报
│   ├── vibrator/                          # 震动警报
│   ├── flashlight/                        # 闪光灯警报
│   ├── permission/                        # 权限管理
│   └── sources/                           # 数据源
│       ├── CustomSourceManager.kt
│       └── JsonPathExtractor.kt
├── src/
│   ├── components/                        # 通用组件
│   │   ├── icons/                         # SVG 图标
│   │   ├── settings/                      # 设置页子组件
│   │   ├── EewCard.tsx                    # 预警事件卡片
│   │   ├── EqInfoCard.tsx                 # 地震信息卡片
│   │   └── SourceStatusBar.tsx            # 数据源状态栏
│   ├── hooks/                             # 自定义 Hook
│   │   ├── useConfig.ts                   # 配置读写
│   │   ├── useEewStream.ts                # 预警数据流
│   │   ├── useFloatingWindow.ts           # 悬浮窗控制
│   │   ├── useBackgroundService.ts        # 后台服务管理
│   │   ├── useUserLocation.ts             # 用户位置
│   │   ├── usePermissions.ts              # 权限请求
│   │   ├── useOnboarding.ts               # 首次启动检测
│   │   └── useAutoStart.ts                # 开机自启动
│   ├── native/                            # 原生模块封装（RN 侧）
│   ├── screens/                           # 页面
│   │   ├── HomeScreen.tsx                 # 主界面
│   │   ├── SettingsScreen.tsx             # 设置页
│   │   ├── EventDetailScreen.tsx          # 事件详情
│   │   ├── SimulateAlertScreen.tsx        # 模拟预警测试
│   │   └── onboarding/                    # 权限引导页
│   ├── sources/                           # 数据源适配器
│   │   ├── custom/                        # 自定义数据源
│   │   │   ├── CustomSourceAdapter.ts     # customSource 适配器
│   │   │   ├── jsonPathExtract.ts         # JSON Path 提取
│   │   │   └── sourceShare.ts             # 二维码分享
│   │   ├── SourceAdapter.ts               # 数据源抽象接口
│   │   └── SourceManager.ts               # 故障切换管理器
│   ├── types/                             # TypeScript 类型
│   │   ├── eew.ts                         # 核心数据模型
│   │   └── config.ts                      # 配置类型与默认值
│   └── utils/                             # 工具函数
│       ├── eew.ts                         # 预警计算
│       └── logger.ts                      # 日志
├── docs/                                  # 项目文档
│   ├── floating-window.md                 # 悬浮窗与锁屏预警
│   ├── sound-flash-alert.md               # 声音与闪光灯警报
│   ├── data-source-guide.md               # 数据源扩展指南
│   ├── file-import.md                     # 文件导入数据源
│   └── ...                                # 其他文档
├── App.tsx                                # 应用入口
├── package.json                           # 依赖与脚本
└── LICENSE                                # LGPL-3.0 协议
```

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 22.11.0 | 见 `package.json` engines |
| Yarn | 最新稳定版 | 包管理 |
| JDK | 17 | Android 编译 |
| Android SDK | compileSdk 34 / buildTools 36.0.0 / minSdk 26 | 最低支持 Android 8.0 |
| Android 设备 | API 26+ | 运行调试 |

## 构建与运行

```sh
# 1. 安装依赖
yarn install

# 2. 设置 JAVA_HOME（JDK 17，Windows 示例）
# PowerShell: $env:JAVA_HOME="C:\Program Files\Zulu\zulu-17"

# 3. 启动 Metro 开发服务器（保持运行）
yarn start

# 4. 构建并运行 Android 应用（需连接设备或启动模拟器）
yarn android

# 5. 运行测试
yarn test

# 6. 代码检查
yarn lint

# 7. TypeScript 类型检查
npx tsc --noEmit
```

## 打包 APK

```sh
cd android
gradlew.bat assembleDebug      # Debug 版本
gradlew.bat assembleRelease    # Release 版本
```

APK 输出路径：`android/app/build/outputs/apk/<build-type>/`

## 配置说明

应用配置由 `AppConfig` 描述，默认值定义在 `src/types/config.ts` 的 `DEFAULT_CONFIG`。配置通过 `useConfig` Hook 读写，使用 AsyncStorage 持久化（key: `@eew_app_config`）。

### 数据源配置

应用不预置任何数据源，用户需在设置页面配置 customSource：

- **协议**：WebSocket（`ws://`）或 HTTP 轮询（`http://`）
- **字段映射**：通过 JSON Path 表达式映射 eventId/originTime/magnitude/depth/lat/lng/location 等字段
- **鉴权**：可选 Authorization Header（authToken）
- **分享**：支持二维码分享数据源配置

详细配置指南见 [docs/data-source-guide.md](docs/data-source-guide.md)。

### 预警级别（DB/T 113.1-2026）

按预估地震烈度分档：

| 烈度范围 | 预警级别 | 颜色 |
|---------|---------|------|
| < 1 | silent | 无显示 |
| 1 ~ 3.9 | blue（蓝） | #3764FF |
| 4 ~ 5.9 | yellow（黄） | #FAE600 |
| 6 ~ 7.9 | orange（橙） | #F09614 |
| >= 8 | red（红） | #DC2828 |

## 法律文档

- [用户协议](USER_AGREEMENT.md)
- [隐私政策](PRIVACY_POLICY.md)
- [安全报告指南](SECURITY.md)

## 协议

本项目采用 [GNU Lesser General Public License v3.0 only](LICENSE)（LGPL-3.0-only）协议开源。

## 免责声明

本应用是地震预警辅助工具，**非官方预警渠道**。本应用不保证预警数据的准确性和及时性，不对因使用本应用造成的任何损失承担责任。数据源由用户自行配置，数据源准确性由数据源提供方负责。

预警级别计算遵循 DB/T 113.1-2026 标准，但实际预警效果取决于数据源的质量和延迟。
