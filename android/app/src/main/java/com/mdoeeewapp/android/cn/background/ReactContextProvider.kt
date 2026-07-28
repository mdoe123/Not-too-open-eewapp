package com.mdoeeewapp.android.cn.background

import com.facebook.react.bridge.ReactApplicationContext
import com.mdoeeewapp.android.cn.floatingwindow.FloatingWindowModule
import com.mdoeeewapp.android.cn.flashlight.FlashlightModule
import com.mdoeeewapp.android.cn.sound.SoundModule
import com.mdoeeewapp.android.cn.vibrator.VibratorModule

/**
 * 全局 ReactContext 与 NativeModule 提供者（单例对象）
 *
 * 供 EewBackgroundService（非 RN 生命周期内的原生 Service）和 LockScreenAlertActivity
 * （非 RN 生命周期内的 Activity）获取：
 * - ReactApplicationContext：用于通过 DeviceEventEmitter 转发事件给 JS 层
 * - FloatingWindowModule：用于直接调用 showFromBackground() 显示锁屏悬浮窗
 * - SoundModule / VibratorModule / FlashlightModule：供 LockScreenAlertActivity
 *   在锁屏时直接调用声音/震动/闪光灯警报（无需经过 RN 桥）
 *
 * 注册时机：
 * - ReactApplicationContext：由 BackgroundServiceModule 构造函数设置
 * - FloatingWindowModule：由 FloatingWindowModule 构造函数设置（invalidate 时清除）
 * - SoundModule / VibratorModule / FlashlightModule：由各自模块构造函数设置（invalidate 时清除）
 *
 * 注意：App 重启后，旧的引用会被新的覆盖。Service 应优先使用此提供者，
 * 而非 ReactContext.getNativeModule()（后者在 stale context 上可能返回 null）。
 */
object ReactContextProvider {
  @Volatile
  var reactApplicationContext: ReactApplicationContext? = null
    private set

  @Volatile
  var floatingWindowModule: FloatingWindowModule? = null
    private set

  @Volatile
  var soundModule: SoundModule? = null
    private set

  @Volatile
  var vibratorModule: VibratorModule? = null
    private set

  @Volatile
  var flashlightModule: FlashlightModule? = null
    private set

  fun setReactApplicationContext(ctx: ReactApplicationContext?) {
    reactApplicationContext = ctx
  }

  fun setFloatingWindowModule(module: FloatingWindowModule?) {
    floatingWindowModule = module
  }

  fun setSoundModule(module: SoundModule?) {
    soundModule = module
  }

  fun setVibratorModule(module: VibratorModule?) {
    vibratorModule = module
  }

  fun setFlashlightModule(module: FlashlightModule?) {
    flashlightModule = module
  }
}
