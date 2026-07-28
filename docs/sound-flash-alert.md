# 声音、震动与闪光灯警报

## 概述

按 DB/T 113.1-2026 地震行业标准，地震预警应包含声音警报与灯光警报。本系统通过原生模块实现三种警报方式：

- **声音警报**：使用 `MediaPlayer` 播放 Python 脚本预生成的 WAV 音频文件（5 个正弦波叠加，非 TTS）
- **震动警报**：使用 Android `Vibrator` API 循环震动（与声音/闪光灯同步触发）
- **闪光灯警报**：使用 Camera2 API `setTorchMode` 控制设备后置闪光灯闪烁

三者均在悬浮窗显示成功后触发，受用户配置（`soundEnabled` / `vibrationEnabled` / `flashlightEnabled`）控制。

---

## 声音警报

### 实现方式

使用 Android `MediaPlayer` 播放预生成的 WAV 音频文件并**循环播放**。

- **音频文件由 Python 脚本生成**：`scripts/generate_alert_sound.py`（numpy + scipy）
- **资源路径**：`android/app/src/main/res/raw/alert_sound.wav`
- **不使用 TTS 语音**：标准要求的是警报主音而非语音播报
- **不使用 AudioTrack 实时合成**：避免运行时 CPU 开销，音频文件预生成更稳定
- **循环播放**：`MediaPlayer.OnCompletionListener` + `Handler.postDelayed(1000ms)` 实现播放 2s → 静音 1s → 播放 2s 循环

### 频率规格

按 **DB/T 113.1-2026 标准表 3** 生成 **5 个时变频率音频信号叠加**，持续 2.0 秒。

每个信号分三个阶段：
1. **快速上升**（0.0s → 0.3s）
2. **缓慢下降**（0.3s → 1.4s）
3. **快速下降**（1.4s → 2.0s）

各信号在各阶段关键采样点频率数值（Hz）：

| 信号 | 0.0s | 0.3s | 1.4s | 2.0s |
|------|------|------|------|------|
| 1 | 1064 | 5288 | 4828 | 1064 |
| 2 | 840  | 4175 | 3812 | 840  |
| 3 | 616  | 3061 | 2795 | 616  |
| 4 | 392  | 1948 | 1779 | 392  |
| 5 | 140  | 696  | 635  | 140  |

- **关键点之间线性插值频率**，实现频率随时间连续变化
- **相位累积法**生成时变正弦波（`phase = cumsum(2π·f/SAMPLE_RATE)`），保证相位连续无突变咔哒声
- **5 个信号叠加后按峰值归一化**到 `[-32767, +32767]` 范围

- **采样率**：44100Hz
- **声道**：单声道（MONO）
- **编码**：PCM 16bit（int16）
- **时长**：2.0 秒（单次播放），循环播放（2s 播放 + 1s 静音）
- **音频流类型**：USAGE_ALARM（走警报通道，不受媒体音量影响）
- **生成脚本**：`scripts/generate_alert_sound.py`（numpy 相位累积 + scipy.io.wavfile 写入 WAV）
- **播放方式**：MediaPlayer.create(res/raw/alert_sound.wav) + onCompletion + postDelayed(1000ms)

### 原生模块接口

```kotlin
@ReactMethod fun playAlertSound()   // 循环播放警报主音，直到 stopAlertSound 调用
@ReactMethod fun stopAlertSound()    // 停止播放（中断播放线程）
```

### JS 封装

```typescript
// src/native/SoundManager.ts
export const SoundManager = {
  playAlertSound(): Promise<void>,  // 循环播放
  stopAlertSound(): Promise<void>,  // 停止
};
```

非 Android 平台直接返回 `Promise.resolve()`。

### 文件清单

- `android/app/src/main/java/com/mdoeeewapp/android/cn/sound/SoundModule.kt` — 原生实现
- `android/app/src/main/java/com/mdoeeewapp/android/cn/sound/SoundPackage.kt` — ReactPackage 注册
- `src/native/SoundManager.ts` — JS 封装

### 设计要点

- `playAlertSound()` 内部先调用 `stopInternal()` 停止上一次的播放，支持重复调用
- `MediaPlayer.create()` 每次播放重新创建，`onCompletion` 中 `release()`，避免状态混乱
- `Handler.postDelayed(LOOP_INTERVAL_MS)` 实现循环间隔（1 秒静音）
- `stopInternal()` 通过 `looping=false` + `removeCallbacksAndMessages(null)` + `release()` 停止播放
- `invalidate()` 时调用 `stopInternal()` 释放资源
- 使用 `USAGE_ALARM` 音频流类型，确保走警报通道，不受媒体音量影响
- 所有异常通过 `emitError` 回传 JS 端，不崩溃主线程

---

## 震动警报

### 实现方式

使用 Android `Vibrator` API + `VibrationEffect.createOneShot` 循环震动。

- **API 级别**：VibrationEffect 需要 API 26+，本项目 minSdk 26 满足
- **循环模式（与音频同步）**：振动 2s → 静默 1s → 振动 2s → 静默 1s ...
  - 与警报主音循环完全一致：音频播放 2s + 静音 1s = 3s 循环
  - 震动振动 2s + 静默 1s = 3s 循环
- **后台线程执行**：避免 Thread.sleep 阻塞主线程

### 触发策略

| 条件 | 行为 |
|------|------|
| vibrationEnabled=true | 循环震动（振动 2000ms + 静默 1000ms），与音频同步 |
| vibrationEnabled=false | 不触发 |
| 取消报（isCancel=true） | 不触发 |
| 倒计时归零（已到达） | 停止震动 |

循环震动实现：`while(looping) { vibrate(2000ms) → sleep(2000ms) → sleep(1000ms) }`，由 `looping` 标志位控制退出。`stopVibrating()` 设置 `looping = false` 并调用 `vibrator.cancel()` 取消当前震动。

### 原生模块接口

```kotlin
@ReactMethod fun startVibrating(intervalMs: Int)                      // 循环震动（振动/静默各 intervalMs）
@ReactMethod fun startVibratingCycle(vibrateMs: Int, silentMs: Int)   // 循环震动（振动 vibrateMs + 静默 silentMs，与音频同步）
@ReactMethod fun stopVibrating()                                       // 停止循环震动
```

### JS 封装

```typescript
// src/native/VibratorManager.ts
export const VibratorManager = {
  startVibrating(intervalMs: number): Promise<void>,                       // 循环震动（等间隔）
  startVibratingCycle(vibrateMs: number, silentMs: number): Promise<void>, // 循环震动（与音频同步）
  stopVibrating(): Promise<void>,                                          // 停止循环震动
};
```

非 Android 平台直接返回 `Promise.resolve()`。

**典型用法**（与音频同步）：
```typescript
// 警报主音 2.0s + 静音 1.0s = 3.0s 循环
VibratorManager.startVibratingCycle(2000, 1000);
```

### 权限

```xml
<uses-permission android:name="android.permission.VIBRATE" />
```

### 文件清单

- `android/app/src/main/java/com/mdoeeewapp/android/cn/vibrator/VibratorModule.kt` — 原生实现
- `android/app/src/main/java/com/mdoeeewapp/android/cn/vibrator/VibratorPackage.kt` — ReactPackage 注册
- `src/native/VibratorManager.ts` — JS 封装

### 设计要点

- `HandlerThread` 后台线程执行震动循环，优先级 `Thread.MIN_PRIORITY`
- `@Volatile looping` 标志位控制循环退出（`stopVibrating` 设为 false）
- `VibrationEffect.createOneShot(ms, DEFAULT_AMPLITUDE)` 生成单次震动效果
- `stopVibratingInternal()` 设 `looping=false` + `vibrator.cancel()` 取消当前震动
- `invalidate()` 时调用 `stopVibratingInternal()` + 清理后台线程
- `ensureVibrator()` 检查 `hasVibrator()`，设备无震动器时跳过
- 所有 Vibrator 调用 try-catch 包裹，避免主线程崩溃

---

## 闪光灯警报

### 实现方式

使用 Camera2 API `CameraManager.setTorchMode` 控制设备后置摄像头的闪光灯（torch mode）。

- **API 级别**：setTorchMode 需要 API 23+，本项目 minSdk 26 满足
- **自动选择后置主摄像头**：遍历 cameraIdList，选择 LENS_FACING_BACK 且 FLASH_INFO_AVAILABLE=true
- **blink 循环在后台线程执行**：避免 Thread.sleep 阻塞主线程

### 触发策略

| 条件 | 行为 |
|------|------|
| 烈度 ≥ 5（橙红级）且 flashlightEnabled=true | 循环闪烁，开/关各 1000ms，直到 stopBlinking 调用 |
| 烈度 < 5 | 不触发 |
| flashlightEnabled=false | 不触发 |
| 取消报（isCancel=true） | 不触发 |

循环闪烁实现：`while(looping) { 开 → sleep(1000ms) → 关 → sleep(1000ms) }`，由 `looping` 标志位控制退出。`stopBlinking()` 设置 `looping = false` 并关闭当前亮着的状态。

### 原生模块接口

```kotlin
@ReactMethod fun turnOn()                              // 打开闪光灯
@ReactMethod fun turnOff()                             // 关闭闪光灯
@ReactMethod fun blink(times: Int, intervalMs: Int)    // 闪烁 N 次（有限次数，供其他场景使用）
@ReactMethod fun startBlinking(intervalMs: Int)        // 循环闪烁直到 stopBlinking 调用
@ReactMethod fun stopBlinking()                        // 停止循环闪烁
```

### JS 封装

```typescript
// src/native/FlashlightManager.ts
export const FlashlightManager = {
  turnOn(): Promise<void>,
  turnOff(): Promise<void>,
  blink(times: number, intervalMs: number): Promise<void>,
  startBlinking(intervalMs: number): Promise<void>,  // 循环闪烁
  stopBlinking(): Promise<void>,                      // 停止循环闪烁
};
```

非 Android 平台直接返回 `Promise.resolve()`。

### 权限

```xml
<uses-permission android:name="android.permission.CAMERA" />
```

注：`setTorchMode` 实际不需要运行时申请 CAMERA 权限（系统级 torch 控制），但声明权限可避免部分设备的兼容性问题。代码中 `ensureCameraManager` 标注 `@SuppressLint("MissingPermission")`。

### 文件清单

- `android/app/src/main/java/com/mdoeeewapp/android/cn/flashlight/FlashlightModule.kt` — 原生实现
- `android/app/src/main/java/com/mdoeeewapp/android/cn/flashlight/FlashlightPackage.kt` — ReactPackage 注册
- `src/native/FlashlightManager.ts` — JS 封装

### 设计要点

- `HandlerThread` 后台线程执行 blink/startBlinking 循环，优先级 `Thread.MIN_PRIORITY`
- `@Volatile blinkCancelled` 标志位支持取消正在进行的 `blink(times)`（有限次数闪烁）
- `@Volatile looping` 标志位控制 `startBlinking` 循环退出（`stopBlinking` 设为 false）
- `registerTorchCallback` 监听 torch 状态变化（仅记录，不阻断主流程）
- `invalidate()` 时调用 `stopBlinkingInternal()` + `turnOffInternal()` + 清理后台线程 + 注销回调
- 所有 CameraManager 调用 try-catch 包裹，避免主线程崩溃

---

## 触发流程

### 调用链

```
useFloatingWindow
  ├─ showFloatingWindow()
  │    ├─ FloatingWindowManager.show(content)  ← 显示悬浮窗
  │    └─ show().then() 成功后：
  │         ├─ startCountdownTick()             ← 启动倒计时
  │         ├─ triggerSound()                   ← 触发声音警报（循环播放）
  │         ├─ triggerVibration()               ← 触发震动警报（循环震动）
  │         └─ triggerFlashlight()              ← 触发闪光灯警报（循环闪烁）
  │
  ├─ triggerSound()
  │    └─ soundEnabled? SoundManager.playAlertSound() : 跳过
  │
  ├─ triggerVibration()
  │    └─ vibrationEnabled? VibratorManager.startVibratingCycle(2000, 1000) : 跳过
  │         （振动 2000ms + 静默 1000ms，与音频播放 2s + 静音 1s 同步循环）
  │
  ├─ triggerFlashlight()
  │    ├─ flashlightEnabled? 否 → 跳过
  │    └─ intensityRef ≥ 5? FlashlightManager.startBlinking(1000) : 跳过
  │
  ├─ 倒计时归零（已到达）
  │    ├─ 显示"地震波已到达"（不自动关闭）
  │    ├─ SoundManager.stopAlertSound()         ← 停止声音
  │    ├─ VibratorManager.stopVibrating()       ← 停止震动
  │    └─ FlashlightManager.stopBlinking()      ← 停止闪光灯
  │
  ├─ DeviceEventEmitter.addListener('onClosed')  ← 用户点击悬浮窗 ✕ 关闭按钮
  │    ├─ userDismissedRef = event.id           ← 标记事件已关闭（不再自动弹出）
  │    └─ hideFloatingWindow()
  │
  └─ hideFloatingWindow() / 组件卸载
       ├─ SoundManager.stopAlertSound()         ← 停止声音循环
       ├─ VibratorManager.stopVibrating()       ← 停止震动循环
       └─ FlashlightManager.stopBlinking()      ← 停止闪光灯循环
```

### 不触发场景

1. **取消报**（`isCancel=true`）：走单独分支显示"地震预警取消"，不调用 `triggerSound` / `triggerFlashlight`
2. **已可见时更新内容**：`isVisibleRef=true` 分支只调用 `updateContent`，不重复触发声音/闪光灯
3. **声音/闪光灯开关关闭**：`triggerSound` / `triggerFlashlight` 内部检查配置后跳过
4. **烈度未达阈值**：`triggerFlashlight` 检查 `intensityRef.current < 5` 时跳过

### 配置控制

| 配置字段 | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `alert.soundEnabled` | boolean | true | 控制声音警报开关 |
| `alert.vibrationEnabled` | boolean | true | 控制震动警报开关 |
| `alert.flashlightEnabled` | boolean | true | 控制闪光灯警报开关 |

设置页路径：设置 → 报警方式 → 铃声 / 闪光灯

### 关闭按钮联动停止

用户点击悬浮窗 ✕ 关闭按钮时，原生层 `FloatingWindowModule` 通过 `DeviceEventEmitter.emit('onClosed')` 通知 JS 层。`useFloatingWindow` 监听该事件并：

1. 记录被关闭的事件 id（`userDismissedRef = event.id`），同一事件不再自动弹出
2. 调用 `hideFloatingWindow()` 停止声音/震动/闪光灯并清理状态

- 停止声音循环（`SoundManager.stopAlertSound()`）
- 停止震动循环（`VibratorManager.stopVibrating()`）
- 停止闪光灯循环（`FlashlightManager.stopBlinking()`）
- 清理倒计时 tick 与延迟隐藏定时器
- 重置 `isVisibleRef` 状态

调用链：
```
用户点击 ✕
  → FloatingWindowModule.closeBtn.setOnClickListener
     → emitClosed()  // 发送 'onClosed' 事件
     → removeFloatingView()  // 移除窗口 View
  → JS: DeviceEventEmitter.addListener('onClosed')
     → userDismissedRef.current = event.id  // 标记事件已关闭
     → hideFloatingWindow()
        → SoundManager.stopAlertSound()
        → VibratorManager.stopVibrating()
        → FlashlightManager.stopBlinking()
        → FloatingWindowManager.hide()  // 此时已无 View，空操作
```

### 用户关闭后不再自动弹出

用户点击✕关闭悬浮窗后，同一事件（相同 `event.id`）不再自动弹出，即使数据源继续推送该事件的更新。只有新事件到来（`event.id` 变化）时才会重置 `userDismissedRef` 并允许重新弹出。

```typescript
// showFloatingWindow 入口检查
if (userDismissedRef.current === event.id) {
  log('FLOAT', '用户已关闭此事件，跳过自动弹出', {eventId: event.id});
  return;
}

// 新事件到来时重置
useEffect(() => {
  if (event && userDismissedRef.current !== null && userDismissedRef.current !== event.id) {
    userDismissedRef.current = null;
  }
}, [event]);
```

### 倒计时归零（已到达）行为

倒计时归零时显示"地震波已到达"，**不自动关闭**，保持显示直到用户手动点✕关闭。此时停止声音/震动/闪光灯（警报结束），但悬浮窗保持可见以便用户查看震级、位置等信息。

```typescript
if (remain <= 0) {
  if (!arrivedRef.current) {
    arrivedRef.current = true;
    // 更新内容显示"地震波已到达"
    // 停止声音/震动/闪光灯
    SoundManager.stopAlertSound();
    VibratorManager.stopVibrating();
    FlashlightManager.stopBlinking();
  }
  return;  // 不自动隐藏
}
```

注：`hide()` 方法不主动发 `onClosed` 事件，避免 JS 主动调用 `hideFloatingWindow()` 时产生循环。`onClosed` 事件仅由 close 按钮点击触发。

---

## 相关文件

- [src/hooks/useFloatingWindow.ts](../src/hooks/useFloatingWindow.ts) — 触发逻辑（triggerSound / triggerVibration / triggerFlashlight）
- [src/native/SoundManager.ts](../src/native/SoundManager.ts) — 声音 JS 接口
- [src/native/VibratorManager.ts](../src/native/VibratorManager.ts) — 震动 JS 接口
- [src/native/FlashlightManager.ts](../src/native/FlashlightManager.ts) — 闪光灯 JS 接口
- [android/app/src/main/java/com/mdoeeewapp/android/cn/sound/](../android/app/src/main/java/com/mdoeeewapp/android/cn/sound/) — 声音原生实现
- [android/app/src/main/java/com/mdoeeewapp/android/cn/vibrator/](../android/app/src/main/java/com/mdoeeewapp/android/cn/vibrator/) — 震动原生实现
- [android/app/src/main/java/com/mdoeeewapp/android/cn/flashlight/](../android/app/src/main/java/com/mdoeeewapp/android/cn/flashlight/) — 闪光灯原生实现
- [src/components/settings/AlertMethodSection.tsx](../src/components/settings/AlertMethodSection.tsx) — 报警方式设置 UI
- [docs/floating-window.md](./floating-window.md) — 悬浮窗联动文档
