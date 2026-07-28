package com.mdoeeewapp.android.cn.sound

import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.mdoeeewapp.android.cn.R
import com.mdoeeewapp.android.cn.background.ReactContextProvider

/**
 * 声音警报原生模块
 *
 * 按 DB/T 113.1-2026 标准播放地震预警主音：
 * - 音频文件由 Python 脚本生成（scripts/generate_alert_sound.py）
 * - 5 个正弦波同时叠加：100Hz / 1000Hz / 2000Hz / 3000Hz / 5500Hz
 * - 时长 2.0 秒，循环播放（播放 2.0s → 静音 1s → 播放 2.0s → 静音 1s ...）
 * - 使用 MediaPlayer 播放 res/raw/alert_sound.wav
 *
 * 设计要点：
 * - MediaPlayer 每次播放后 release，下次播放重新 create，避免状态混乱
 * - Handler.postDelayed(1000ms) 实现循环间隔
 * - stopInternal 通过 looping=false + removeCallbacks + release 停止播放
 * - 使用 USAGE_ALARM 流类型，确保走警报通道
 * - 所有原生调用 try-catch 包裹，避免主线程崩溃
 *
 * 全局注册：构造时注册到 ReactContextProvider，供 LockScreenAlertActivity
 * 在锁屏时直接调用 playAlertSound()/stopAlertSound()（无需经过 RN 桥）。
 */
class SoundModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "SoundModule"
    const val EVENT_ERROR = "onError"

    /** 循环间隔（毫秒）：播放结束后静音 1 秒再重复 */
    private const val LOOP_INTERVAL_MS = 1000L
  }

  /** 主线程 Handler */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** 当前 MediaPlayer 引用 */
  private var mediaPlayer: MediaPlayer? = null

  /** 是否继续循环播放 */
  @Volatile
  private var looping = false

  init {
    // 注册到全局提供者，供 LockScreenAlertActivity 直接调用
    ReactContextProvider.setSoundModule(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    stopInternal()
    // 清除全局引用，避免 LockScreenAlertActivity 持有已失效的模块实例
    ReactContextProvider.setSoundModule(null)
    super.invalidate()
  }

  /**
   * 播放警报主音（循环播放直到 stopAlertSound 调用）
   *
   * 循环节奏：播放 2.0s → 静音 1s → 播放 2.0s → 静音 1s ...
   * 用 MediaPlayer.onCompletion + Handler.postDelayed(1000ms) 实现。
   */
  @ReactMethod
  fun playAlertSound() {
    try {
      // 先停止上一次的播放
      stopInternal()
      // 启动循环
      looping = true
      playOnce()
    } catch (e: Exception) {
      emitError("playAlertSound", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 停止警报音播放
   */
  @ReactMethod
  fun stopAlertSound() {
    stopInternal()
  }

  /**
   * 播放一次警报主音
   * 播放完成后延迟 1 秒再播放下一次（通过 Handler.postDelayed）
   */
  private fun playOnce() {
    if (!looping) return
    try {
      val mp = MediaPlayer.create(reactContext, R.raw.alert_sound)
      if (mp == null) {
        emitError("playOnce", "MediaPlayer.create 返回 null（资源文件不存在）")
        return
      }

      mp.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )

      mp.setOnCompletionListener { player ->
        try {
          player.release()
        } catch (_: Exception) {
          // 忽略释放异常
        }
        synchronized(this) {
          if (mediaPlayer === player) {
            mediaPlayer = null
          }
        }
        // 播放结束，1 秒后再播放
        if (looping) {
          mainHandler.postDelayed({ playOnce() }, LOOP_INTERVAL_MS)
        }
      }

      synchronized(this) {
        mediaPlayer = mp
      }
      mp.start()
    } catch (e: Exception) {
      emitError("playOnce", e.message ?: e::class.java.simpleName)
    }
  }

  /** 内部停止：停止循环 + 移除 Handler callbacks + 释放 MediaPlayer */
  private fun stopInternal() {
    looping = false
    // 移除所有待执行的 postDelayed 回调
    mainHandler.removeCallbacksAndMessages(null)
    synchronized(this) {
      mediaPlayer?.let { mp ->
        try {
          if (mp.isPlaying) {
            mp.stop()
          }
          mp.release()
        } catch (_: Exception) {
          // 忽略停止/释放异常
        }
        mediaPlayer = null
      }
    }
  }

  /** 向 JS 端发送错误事件 */
  private fun emitError(from: String, message: String) {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_ERROR, "$from: $message")
    } catch (_: Exception) {
      // 忽略发送失败
    }
  }
}
