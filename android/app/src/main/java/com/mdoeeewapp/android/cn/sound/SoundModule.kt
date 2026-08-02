package com.mdoeeewapp.android.cn.sound

import android.content.Context
import android.content.res.AssetFileDescriptor
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
 * 声音警报原生模块（DB/T 113.1-2026 合规）
 *
 * 播报方式（6.1.4）：
 * - 警报主音 + 语音提示叠加合成（两个 MediaPlayer 同时播放实现真混音）
 * - 循环播报
 * - 预警时间 > 0：播报 [级别信息] + [倒计时数字逐位] + ["秒后抵达"]
 * - 预警时间 = 0（横波抵达）：仅播报 [级别信息] + ["横波已抵达"]，持续 60 秒后结束
 * - 收到取消报：循环播报 ["地震预警取消"]
 *
 * 语音提示信息（6.1.3）：
 * - 一级（red）：地震红色预警
 * - 二级（orange）：地震橙色预警
 * - 三级（yellow）：地震黄色预警
 * - 四级（blue）：地震蓝色预警
 * - 取消：地震预警取消
 *
 * 音频文件位于 assets/audio/（支持中文+数字文件名）
 * 主音位于 res/raw/alert_sound.wav（5 正弦波叠加，2.0 秒）
 *
 * 全局注册：构造时注册到 ReactContextProvider，供 LockScreenAlertActivity
 * 和 EewBackgroundService 直接调用（无需经过 RN 桥）。
 */
class SoundModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "SoundModule"
    const val EVENT_ERROR = "onError"

    /** 主音循环间隔（毫秒）：播放结束后静音 1 秒再重复 */
    private const val MAIN_LOOP_INTERVAL_MS = 1000L

    /** 语音播放出错时的重试延迟（毫秒） */
    private const val VOICE_RETRY_DELAY_MS = 500L
  }

  /** 主线程 Handler */
  private val mainHandler = Handler(Looper.getMainLooper())

  // ======================== 主音播放 ========================

  /** 主音 MediaPlayer */
  private var mainPlayer: MediaPlayer? = null

  /** 主音是否循环播放 */
  @Volatile
  private var mainLooping = false

  // ======================== 语音播放 ========================

  /** 语音 MediaPlayer */
  private var voicePlayer: MediaPlayer? = null

  /** 语音是否循环播放 */
  @Volatile
  private var voiceLooping = false

  /** 当前语音播放队列（文件名列表，如 ["地震红色预警.mp3", "6.mp3", "4.mp3", "秒后抵达.mp3"]） */
  private val voiceQueue: MutableList<String> = mutableListOf()

  /** 当前预警级别（red / orange / yellow / blue） */
  @Volatile
  private var currentLevel: String = "blue"

  /** 当前剩余秒数（动态更新，向上取整） */
  @Volatile
  private var currentRemainSec: Int = 0

  /** 当前是否为取消报 */
  @Volatile
  private var currentIsCancel: Boolean = false

  /** 当前横波是否已抵达（倒计时归零） */
  @Volatile
  private var currentArrived: Boolean = false

  // ======================== 自动调节音量 ========================

  /** 保存的原媒体音量（-1 表示未保存） */
  @Volatile
  private var savedMediaVolume: Int = -1

  init {
    ReactContextProvider.setSoundModule(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    stopInternal()
    restoreMediaVolumeInternal()
    ReactContextProvider.setSoundModule(null)
    super.invalidate()
  }

  // ======================== 公开 API ========================

  /**
   * 开始带语音的警报（主音 + 语音混音循环播放）
   *
   * @param level 预警级别（red / orange / yellow / blue）
   * @param remainSec 剩余秒数（向上取整，>0 时播报倒计时）
   * @param isCancel 是否为取消报
   * @param arrived 横波是否已抵达（倒计时归零）
   */
  @ReactMethod
  fun startAlertWithVoice(level: String, remainSec: Int, isCancel: Boolean, arrived: Boolean) {
    try {
      // 更新状态
      currentLevel = level
      currentRemainSec = remainSec
      currentIsCancel = isCancel
      currentArrived = arrived
      // 清空语音队列，立即用新状态填充
      synchronized(voiceQueue) { voiceQueue.clear() }

      // 启动主音（如未启动）
      if (!mainLooping) {
        stopMainInternal()
        mainLooping = true
        playMainOnce()
      }
      // 启动语音（如未启动）
      if (!voiceLooping) {
        stopVoiceInternal()
        voiceLooping = true
        playNextVoice()
      }
    } catch (e: Exception) {
      emitError("startAlertWithVoice", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 更新预警状态（每秒 tick 调用）
   *
   * 不中断当前语音播放，等当前周期播完后取新状态。
   * 但取消报状态变化时立即切换。
   *
   * @param level 预警级别
   * @param remainSec 剩余秒数
   * @param isCancel 是否为取消报
   * @param arrived 横波是否已抵达
   */
  @ReactMethod
  fun updateAlertState(level: String, remainSec: Int, isCancel: Boolean, arrived: Boolean) {
    val cancelChanged = isCancel && !currentIsCancel
    currentLevel = level
    currentRemainSec = remainSec
    currentIsCancel = isCancel
    currentArrived = arrived

    // 取消报状态变化时立即切换语音
    if (cancelChanged && voiceLooping) {
      synchronized(voiceQueue) { voiceQueue.clear() }
      stopVoiceInternal()
      voiceLooping = true
      mainHandler.post { playNextVoice() }
    }
  }

  /**
   * 播放警报主音（循环播放直到 stopAlertSound 调用）
   *
   * 向后兼容接口：仅播放主音，不播语音。
   */
  @ReactMethod
  fun playAlertSound() {
    try {
      if (mainLooping && mainPlayer?.isPlaying == true) return
      stopMainInternal()
      mainLooping = true
      playMainOnce()
    } catch (e: Exception) {
      emitError("playAlertSound", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 停止所有声音播放（主音 + 语音）
   */
  @ReactMethod
  fun stopAlertSound() {
    stopInternal()
  }

  // ======================== 主音播放实现 ========================

  /** 播放一次警报主音，播放完成后延迟 1 秒再播放下一次 */
  private fun playMainOnce() {
    if (!mainLooping) return
    try {
      val mp = MediaPlayer.create(reactContext, R.raw.alert_sound)
      if (mp == null) {
        emitError("playMainOnce", "MediaPlayer.create 返回 null（alert_sound.wav 不存在）")
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
        }
        synchronized(this) {
          if (mainPlayer === player) {
            mainPlayer = null
          }
        }
        if (mainLooping) {
          mainHandler.postDelayed({ playMainOnce() }, MAIN_LOOP_INTERVAL_MS)
        }
      }

      synchronized(this) {
        mainPlayer = mp
      }
      mp.start()
    } catch (e: Exception) {
      emitError("playMainOnce", e.message ?: e::class.java.simpleName)
    }
  }

  // ======================== 语音播放实现 ========================

  /**
   * 根据当前状态构建语音播放队列
   *
   * - 取消报：["地震预警取消.mp3"]
   * - 归零后：["级别.mp3", "横波已抵达.mp3"]
   * - 正常倒计时：
   *   - 整十数（10/20/30...）：["级别.mp3", 中文整十读法..., "秒后抵达.mp3"]
   *     · 10 → "10.mp3"（十）
   *     · 20 → "2.mp3" + "10.mp3"（二十）
   *     · 60 → "6.mp3" + "10.mp3"（六十）
   *   - 非整十数（如 64/23/15）：["级别.mp3", 数字逐位...]，不加"秒后抵达"
   *     · 64 → "6.mp3" + "4.mp3"（六四）
   * - remain=0 且未 arrived：["级别.mp3"]（边界情况）
   */
  private fun buildVoiceQueue(): List<String> {
    if (currentIsCancel) {
      return listOf("地震预警取消.mp3")
    }

    val queue = mutableListOf<String>()

    // 级别语音
    val levelFile = when (currentLevel) {
      "red" -> "地震红色预警.mp3"
      "orange" -> "地震橙色预警.mp3"
      "yellow" -> "地震黄色预警.mp3"
      "blue" -> "地震蓝色预警.mp3"
      else -> null
    }
    if (levelFile != null) queue.add(levelFile)

    if (currentArrived) {
      // 归零后：横波已抵达
      queue.add("横波已抵达.mp3")
    } else if (currentRemainSec > 0) {
      val remain = currentRemainSec
      val isWholeTen = remain % 10 == 0

      if (isWholeTen && remain < 100) {
        // 整十数（10-90）：中文整十读法 + "秒后抵达"
        // 10 → "10.mp3"（十）；20 → "2.mp3"+"10.mp3"（二十）；60 → "6.mp3"+"10.mp3"（六十）
        if (remain == 10) {
          queue.add("10.mp3")
        } else {
          queue.add("${remain / 10}.mp3")
          queue.add("10.mp3")
        }
        queue.add("秒后抵达.mp3")
      } else {
        // 非整十数（如 64/23/15）或 100+：数字逐位播报，不加"秒后抵达"
        remain.toString().forEach { ch ->
          queue.add("$ch.mp3")
        }
      }
    }
    // remain == 0 且未 arrived：仅播级别（边界情况）

    return queue
  }

  /** 播放下一段语音，播完后继续播放队列中的下一个 */
  private fun playNextVoice() {
    if (!voiceLooping) return

    // 队列空时重新填充（取最新状态）
    synchronized(voiceQueue) {
      if (voiceQueue.isEmpty()) {
        voiceQueue.addAll(buildVoiceQueue())
      }
    }

    if (voiceQueue.isEmpty()) {
      // 无可播放的语音，延迟后重试
      if (voiceLooping) {
        mainHandler.postDelayed({ playNextVoice() }, VOICE_RETRY_DELAY_MS)
      }
      return
    }

    val fileName: String
    synchronized(voiceQueue) {
      if (voiceQueue.isEmpty()) return
      fileName = voiceQueue.removeAt(0)
    }

    try {
      val afd: AssetFileDescriptor = reactContext.assets.openFd("audio/$fileName")
      val mp = MediaPlayer()
      mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
      afd.close()

      mp.setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )

      mp.setOnCompletionListener { player ->
        try {
          player.release()
        } catch (_: Exception) {
        }
        synchronized(this) {
          if (voicePlayer === player) {
            voicePlayer = null
          }
        }
        if (voiceLooping) {
          mainHandler.post { playNextVoice() }
        }
      }

      mp.setOnErrorListener { player, what, extra ->
        try {
          player.release()
        } catch (_: Exception) {
        }
        synchronized(this) {
          if (voicePlayer === player) {
            voicePlayer = null
          }
        }
        emitError("playNextVoice", "MediaPlayer error: what=$what extra=$extra file=$fileName")
        if (voiceLooping) {
          mainHandler.postDelayed({ playNextVoice() }, VOICE_RETRY_DELAY_MS)
        }
        true
      }

      mp.prepare()
      synchronized(this) {
        voicePlayer = mp
      }
      mp.start()
    } catch (e: Exception) {
      emitError("playNextVoice", "${e.message ?: e::class.java.simpleName} (file=$fileName)")
      // 出错时跳过此文件，延迟后继续
      if (voiceLooping) {
        mainHandler.postDelayed({ playNextVoice() }, VOICE_RETRY_DELAY_MS)
      }
    }
  }

  // ======================== 停止实现 ========================

  /** 停止所有播放（主音 + 语音） */
  private fun stopInternal() {
    mainLooping = false
    voiceLooping = false
    mainHandler.removeCallbacksAndMessages(null)
    stopMainInternal()
    stopVoiceInternal()
  }

  /** 停止主音播放 */
  private fun stopMainInternal() {
    synchronized(this) {
      mainPlayer?.let { mp ->
        try {
          if (mp.isPlaying) mp.stop()
          mp.release()
        } catch (_: Exception) {
        }
        mainPlayer = null
      }
    }
  }

  /** 停止语音播放 */
  private fun stopVoiceInternal() {
    synchronized(this) {
      voicePlayer?.let { mp ->
        try {
          if (mp.isPlaying) mp.stop()
          mp.release()
        } catch (_: Exception) {
        }
        voicePlayer = null
      }
    }
    synchronized(voiceQueue) {
      voiceQueue.clear()
    }
  }

  // ======================== 自动调节媒体音量 ========================

  @ReactMethod
  fun saveAndSetMediaVolume(volumePercent: Int) {
    try {
      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: run {
          emitError("saveAndSetMediaVolume", "AudioManager 不可用")
          return
        }
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

  @ReactMethod
  fun restoreMediaVolume() {
    restoreMediaVolumeInternal()
  }

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
    }
  }
}
