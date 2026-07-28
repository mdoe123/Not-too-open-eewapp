# 隐私政策（Privacy Policy）

最后更新日期：2026-07-28

NTOEEW（Not Too Open EEW App，以下简称"本应用"）高度重视用户隐私保护。本隐私政策说明本应用在用户数据处理方面的实践。请在使用本应用前仔细阅读本政策。

## 1. 数据收集说明

**本应用不收集任何用户个人身份信息（PII）。**

本应用不集成任何统计分析 SDK、推送 SDK、广告 SDK 或其他第三方数据收集服务。本应用不向任何服务器上传用户数据。

## 2. 权限说明

本应用为提供地震预警功能，需要申请以下 Android 系统权限。所有权限仅用于实现对应功能，不用于收集用户信息：

| 权限 | 用途 | 是否必须 |
|------|------|---------|
| `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` | 获取用户位置，计算震中距和预估烈度 | 是（核心功能依赖） |
| `POST_NOTIFICATIONS` | 预警事件通知推送 | 是（Android 13+） |
| `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_DATA_SYNC` | 后台保活服务持续接收预警数据 | 是 |
| `SYSTEM_ALERT_WINDOW` | 预警悬浮窗显示（叠加在其他应用之上） | 是 |
| `VIBRATE` | 预警震动警报 | 是 |
| `CAMERA` | 闪光灯警报（仅烈度 ≥ 5 触发，不拍照/录像） | 否（仅闪光灯功能需要） |
| `RECEIVE_BOOT_COMPLETED` | 开机后自动启动保活服务 | 否 |
| `WAKE_LOCK` | 锁屏预警时保持屏幕常亮 | 是（锁屏预警期间） |
| `SCHEDULE_EXACT_ALARM` | 精确定时器（倒计时） | 是 |

> **相机权限说明**：本应用仅使用相机闪光灯进行警报闪烁，**不进行任何拍照、录像或图像采集**。Camera2 API 的 `setTorchMode` 仅控制闪光灯开关。

## 3. 数据存储

### 3.1 本地存储

所有应用配置和数据存储在用户设备本地：

- **AsyncStorage**（React Native）：应用配置、数据源配置、免责声明确认状态等
  - Key: `@eew_app_config`
- **SharedPreferences**（Android 原生）：保活服务使用的预警配置、用户位置、活跃数据源配置
  - 文件: `eew_alert_config`

### 3.2 不上传服务器

本应用**不上传任何用户数据到任何服务器**。所有数据均在用户设备本地处理和存储。

## 4. 数据源连接

### 4.1 直连数据源

本应用直接连接用户配置的 customSource 端点（WebSocket 或 HTTP），**不经过任何中间服务器**。

### 4.2 数据流向

```
用户配置的数据源端点  ←→  本应用（用户设备）  ←→  本地存储
```

### 4.3 鉴权信息

如用户在数据源配置中填写了 `authToken`，该 token 仅用于向数据源端点发送 Authorization Header，不会发送到任何其他地方，也不会记录在日志中。

## 5. 第三方服务

### 5.1 不集成数据收集服务

本应用不集成任何以下类型的服务：
- 统计分析服务（如 Google Analytics、Firebase Analytics）
- 崩溃报告服务（如 Crashlytics、Bugly）
- 推送服务（如 Firebase Cloud Messaging、个推、极光）
- 广告服务
- 用户行为分析服务

### 5.2 第三方开源库

本应用使用的第三方开源库列表见 `package.json` 的 dependencies。这些库在用户设备本地运行，不主动向第三方服务器传输用户数据（除非用户主动配置了指向第三方服务器的数据源）。

## 6. 开源协议

本应用基于 [LGPL-3.0-only](LICENSE) 协议开源，源代码公开在 [GitHub](https://github.com/mdoe123/Not-too-open-eewapp)。任何人可审查源代码以验证本隐私政策的真实性。

## 7. 儿童隐私

本应用不面向 13 岁以下儿童，也不 knowingly 收集儿童的个人信息。如发现有任何儿童向我们提供了个人信息，请联系我们删除。

## 8. 隐私政策变更

本应用开发者保留随时修改本隐私政策的权利。政策变更后，将在本应用或其 GitHub 仓库公布。

## 9. 联系方式

如对本隐私政策有任何疑问、建议或投诉，请通过 [GitHub Issues](https://github.com/mdoe123/Not-too-open-eewapp/issues) 反馈。

---

本隐私政策中文版本为正式版本，如有与其他语言版本的冲突，以中文版本为准。
