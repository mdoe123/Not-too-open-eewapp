package com.mdoeeewapp.android.cn.sound

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
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
 * - 使用 USAGE_MEDIA 流类型（媒体音量通道），配合 STREAM_MUSIC 自动调节音量
 * - 所有原生调用 try-catch 包裹，避免主线程崩溃
 * - 自动调节音量：saveAndSetMediaVolume 保存当前媒体音量并设为指定值，
 *   restoreMediaVolume 恢复原音量（预警结束后调用）
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

  /** 自动调节音量：保存的原媒体音量（-1 表示未保存） */
  @Volatile
  private var savedMediaVolume: Int = -1

  init {
    // 注册到全局提供者，供 LockScreenAlertActivity 直接调用
    ReactContextProvider.setSoundModule(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    stopInternal()
    // 恢复音量（若已保存）
    restoreMediaVolumeInternal()
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
      // 幂等：如果已在循环播放且 MediaPlayer 正在播放，不重复触发
      // 防止前后台切换时 JS 层和后台服务交叉调用导致"中断重启"
      if (looping && mediaPlayer?.isPlaying == true) {
        return
      }
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
          .setUsage(AudioAttributes.USAGE_MEDIA)
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

  // ======================== 自动调节媒体音量 ========================

  /**
   * 保存当前媒体音量并设置为指定百分比
   *
   * 在预警开始前调用（仅当 autoVolumeEnabled=true）。
   * 重复调用不会覆盖已保存的值（防止多次预警嵌套保存）。
   *
   * @param volumePercent 目标音量百分比（0-100）
   */
  @ReactMethod
  fun saveAndSetMediaVolume(volumePercent: Int) {
    try {
      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: run {
          emitError("saveAndSetMediaVolume", "AudioManager 不可用")
          return
        }
      // 仅在未保存时才保存（防止嵌套覆盖）
      if (savedMediaVolume < 0) {
        savedMediaVolume = audioManager.getStreamVolume(AudioManager.STREAM_MUSIC)
      }
      val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      val targetVolume = (maxVolume * volumePercent / 100).coerceIn(0, maxVolume)
      audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, targetVolume, 0)
    } catch (e: Exception) {
      emitError("saveAndSetMediaVolume", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 恢复之前保存的媒体音量
   *
   * 在预警结束后调用。若未保存过则无操作。
   */
  @ReactMethod
  fun restoreMediaVolume() {
    restoreMediaVolumeInternal()
  }

  /** 恢复音量内部实现（供 invalidate 调用，不经过 RN 桥） */
  private fun restoreMediaVolumeInternal() {
    if (savedMediaVolume < 0) return
    try {
      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      if (audioManager != null) {
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, savedMediaVolume, 0)
      }
    } catch (e: Exception) {
      emitError("restoreMediaVolume", e.message ?: e::class.java.simpleName)
    } finally {
      savedMediaVolume = -1
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
