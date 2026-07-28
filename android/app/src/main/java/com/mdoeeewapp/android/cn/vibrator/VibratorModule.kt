package com.mdoeeewapp.android.cn.vibrator

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.mdoeeewapp.android.cn.background.ReactContextProvider

/**
 * 震动警报原生模块
 *
 * 使用 Android Vibrator API 控制设备震动，用于地震预警的触觉警报。
 *
 * 触发策略：
 * - 与声音/闪光灯同步触发
 * - 循环震动，振动/静默各持续指定时间，直到 stopVibrating 调用
 *
 * 设计要点：
 * - 使用 VibrationEffect.createOneShot（API 26+，本项目 minSdk 26）
 * - 在后台线程执行循环避免阻塞主线程
 * - 通过 looping 标志位控制退出
 * - 所有 Vibrator 调用 try-catch 包裹，避免主线程崩溃
 * - 支持振动时长与静默时长不同（与音频循环同步：振2s+默1s）
 *
 * 全局注册：构造时注册到 ReactContextProvider，供 LockScreenAlertActivity
 * 在锁屏时直接调用 startVibratingCycle()/stopVibrating()（无需经过 RN 桥）。
 */
class VibratorModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "VibratorModule"
    const val EVENT_ERROR = "onError"
  }

  /** 主线程 Handler */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** 后台线程 Handler（用于震动循环） */
  private var backgroundThread: HandlerThread? = null
  private var backgroundHandler: Handler? = null

  /** Vibrator 引用 */
  private var vibrator: Vibrator? = null

  /** startVibrating 循环是否继续（stopVibrating 设为 false 退出循环） */
  @Volatile
  private var looping = false

  init {
    // 注册到全局提供者，供 LockScreenAlertActivity 直接调用
    ReactContextProvider.setVibratorModule(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    stopVibratingInternal()
    cleanupBackgroundThread()
    // 清除全局引用，避免 LockScreenAlertActivity 持有已失效的模块实例
    ReactContextProvider.setVibratorModule(null)
    super.invalidate()
  }

  /**
   * 初始化 Vibrator
   * 延迟初始化，首次使用时调用。
   */
  private fun ensureVibrator(): Boolean {
    if (vibrator == null) {
      vibrator = reactContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
      if (vibrator == null) {
        emitError("ensureVibrator", "无法获取 Vibrator 服务")
        return false
      }
    }
    // 检查设备是否有震动器
    if (vibrator?.hasVibrator() != true) {
      emitError("ensureVibrator", "设备无震动器")
      return false
    }
    return true
  }

  /**
   * 循环震动，直到 stopVibrating 调用
   * @param intervalMs 间隔（毫秒），震动/静默各持续此时间
   *
   * 实现：在后台线程循环 振动→sleep→静默→sleep，通过 looping 标志位控制退出。
   * 用于地震预警持续震动直到悬浮窗隐藏。
   */
  @ReactMethod
  fun startVibrating(intervalMs: Int) {
    val safeInterval = if (intervalMs > 0) intervalMs.toLong() else 1000L
    startVibratingCycleInternal(safeInterval, safeInterval)
  }

  /**
   * 循环震动（支持振动时长与静默时长不同），与音频循环同步
   * @param vibrateMs 振动持续时长（毫秒）
   * @param silentMs 静默持续时长（毫秒）
   *
   * 典型用法：与 DB/T 113.1-2026 警报主音同步
   * - 音频播放 2000ms + 静音 1000ms = 3000ms 循环
   * - 震动振动 2000ms + 静默 1000ms = 3000ms 循环
   */
  @ReactMethod
  fun startVibratingCycle(vibrateMs: Int, silentMs: Int) {
    val safeVibrate = if (vibrateMs > 0) vibrateMs.toLong() else 1000L
    val safeSilent = if (silentMs > 0) silentMs.toLong() else 1000L
    startVibratingCycleInternal(safeVibrate, safeSilent)
  }

  /**
   * 循环震动内部实现
   * @param vibrateMs 振动时长（毫秒）
   * @param silentMs 静默时长（毫秒）
   */
  private fun startVibratingCycleInternal(vibrateMs: Long, silentMs: Long) {
    // 启动循环
    looping = true
    ensureBackgroundThread()

    backgroundHandler?.post {
      try {
        if (!ensureVibrator()) return@post

        while (looping && !Thread.currentThread().isInterrupted) {
          // 振动（API 26+: VibrationEffect.createOneShot）
          try {
            val effect = VibrationEffect.createOneShot(
              vibrateMs,
              VibrationEffect.DEFAULT_AMPLITUDE
            )
            vibrator?.vibrate(effect)
          } catch (e: Exception) {
            emitError("startVibrating-on", e.message ?: e::class.java.simpleName)
            break
          }
          Thread.sleep(vibrateMs)
          if (!looping) break
          // 静默（等待下一个周期）
          Thread.sleep(silentMs)
        }
        // 确保最终停止
        try {
          vibrator?.cancel()
        } catch (_: Exception) {
          // 忽略
        }
      } catch (e: InterruptedException) {
        // 正常退出
      } catch (e: Exception) {
        emitError("startVibrating", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /**
   * 停止循环震动
   */
  @ReactMethod
  fun stopVibrating() {
    stopVibratingInternal()
  }

  /** 内部停止循环震动 */
  private fun stopVibratingInternal() {
    looping = false
    // 取消当前震动
    try {
      vibrator?.cancel()
    } catch (_: Exception) {
      // 忽略
    }
  }

  /** 初始化后台线程 */
  private fun ensureBackgroundThread() {
    if (backgroundThread == null) {
      val thread = HandlerThread("VibratorModule-Background").apply {
        priority = Thread.MIN_PRIORITY
        start()
      }
      backgroundThread = thread
      backgroundHandler = Handler(thread.looper)
    }
  }

  /** 清理后台线程 */
  private fun cleanupBackgroundThread() {
    try {
      backgroundThread?.let { thread ->
        thread.quitSafely()
        thread.join(100)
      }
    } catch (_: Exception) {
      // 忽略
    }
    backgroundThread = null
    backgroundHandler = null
  }

  /** 向 JS 端发送错误事件 */
  private fun emitError(from: String, message: String) {
    mainHandler.post {
      try {
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_ERROR, mapOf("from" to from, "message" to message))
      } catch (_: Exception) {
        // 忽略发送失败
      }
    }
  }
}
