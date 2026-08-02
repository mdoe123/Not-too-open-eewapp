package com.mdoeeewapp.android.cn.sound

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.SoundPool
import android.os.Handler
import android.util.Log
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

  // ======================== 语音播放（SoundPool 低延迟） ========================

  /** SoundPool 用于低延迟语音播放 */
  private var soundPool: SoundPool? = null

  /** 音频文件名 -> SoundPool soundId 映射 */
  private val soundIds: MutableMap<String, Int> = mutableMapOf()

  /** 音频文件名 -> 时长（毫秒），用于 postDelayed 调度下一段 */
  private val soundDurations: MutableMap<String, Long> = mutableMapOf()

  /** 语音是否循环播放 */
  @Volatile
  private var voiceLooping = false

  /**
   * 当前语音阶段：
   * - PHASE_LEVEL：播报级别（+ 归零/取消的额外语音）
   * - PHASE_NUMBER：播报数字（实时获取 currentRemainSec）
   */
  private var voicePhase = 0
  private val PHASE_LEVEL = 0
  private val PHASE_NUMBER = 1

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
    initSoundPool()
  }

  /**
   * 初始化 SoundPool 并预加载所有语音音频文件
   *
   * SoundPool 相比 MediaPlayer 的优势：
   * - 预加载后 play() 延迟 <10ms（MediaPlayer 每次创建+prepare 需 100-200ms）
   * - 适合短音频（<5秒），数字/级别音频均 <1 秒
   *
   * 同时用 MediaPlayer 获取每个音频的精确时长，用于 postDelayed 调度下一段播放。
   */
  private fun initSoundPool() {
    try {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
      soundPool = SoundPool.Builder()
        .setMaxStreams(2)
        .setAudioAttributes(attrs)
        .build()

      // 所有需要预加载的音频文件
      val files = listOf(
        "0.mp3", "1.mp3", "2.mp3", "3.mp3", "4.mp3", "5.mp3",
        "6.mp3", "7.mp3", "8.mp3", "9.mp3", "10.mp3",
        "地震红色预警.mp3", "地震橙色预警.mp3", "地震黄色预警.mp3", "地震蓝色预警.mp3",
        "地震预警取消.mp3", "横波已抵达.mp3", "秒后抵达.mp3"
      )

      for (file in files) {
        try {
          val afd = reactContext.assets.openFd("audio/$file")
          val soundId = soundPool!!.load(afd, 1)
          soundIds[file] = soundId

          // 用 MediaPlayer 获取精确时长（用于 postDelayed 调度）
          val mp = MediaPlayer()
          mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
          mp.prepare()
          soundDurations[file] = mp.duration.toLong()
          mp.release()

          afd.close()
        } catch (e: Exception) {
          emitError("initSoundPool", "加载 $file 失败: ${e.message}")
        }
      }
      Log.i("SoundModule", "SoundPool 预加载完成: ${soundIds.size} 个音频")
    } catch (e: Exception) {
      emitError("initSoundPool", e.message ?: e::class.java.simpleName)
    }
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    stopInternal()
    restoreMediaVolumeInternal()
    soundPool?.release()
    soundPool = null
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
      voicePhase = PHASE_LEVEL

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
        mainHandler.removeCallbacks(playNextVoiceRunnable)
        mainHandler.post(playNextVoiceRunnable)
      }
    } catch (e: Exception) {
      emitError("startAlertWithVoice", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 更新预警状态（每秒 tick 调用）
   *
   * 更新 currentRemainSec 等状态字段，下一阶段构建队列时取最新值。
   * 取消报状态变化时立即切换。
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
      voicePhase = PHASE_LEVEL
      stopVoiceInternal()
      voiceLooping = true
      mainHandler.removeCallbacks(playNextVoiceRunnable)
      mainHandler.post(playNextVoiceRunnable)
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

  // ======================== 语音播放实现（SoundPool 低延迟） ========================

  /** playNextVoice 的 Runnable 封装，便于 removeCallbacks */
  private val playNextVoiceRunnable = Runnable { playNextVoice() }

  /**
   * 根据当前阶段和状态构建语音播放队列
   *
   * 分阶段构建（关键优化）：
   * - PHASE_LEVEL：构建级别队列（级别 + 归零/取消语音）
   * - PHASE_NUMBER：构建数字队列（实时获取 currentRemainSec）
   *
   * 这样数字在级别播完后才生成，用的是最新倒计时值，减少滞后。
   *
   * 数字读法：
   * - 整十数（10/20/30...90）：中文整十读法 + "秒后抵达"
   *   · 10 → "10.mp3"（十）；20 → "2.mp3"+"10.mp3"（二十）；60 → "6.mp3"+"10.mp3"（六十）
   * - 非整十数（如 64/23/15）：数字逐位播报，不加"秒后抵达"
   */
  private fun buildVoiceQueueForPhase(): List<String> {
    // 取消报：只播"地震预警取消"
    if (currentIsCancel) {
      voicePhase = PHASE_LEVEL  // 取消报固定在 LEVEL 阶段循环
      return listOf("地震预警取消.mp3")
    }

    if (voicePhase == PHASE_LEVEL) {
      // 级别阶段：播级别（+ 归零后追加"横波已抵达"）
      voicePhase = PHASE_NUMBER  // 切换到数字阶段
      val queue = mutableListOf<String>()
      val levelFile = when (currentLevel) {
        "red" -> "地震红色预警.mp3"
        "orange" -> "地震橙色预警.mp3"
        "yellow" -> "地震黄色预警.mp3"
        "blue" -> "地震蓝色预警.mp3"
        else -> null
      }
      if (levelFile != null) queue.add(levelFile)
      if (currentArrived) {
        queue.add("横波已抵达.mp3")
      }
      return queue
    } else {
      // 数字阶段：实时获取 currentRemainSec 生成数字队列
      voicePhase = PHASE_LEVEL  // 切换回级别阶段
      if (currentArrived || currentRemainSec <= 0) {
        // 归零或无倒计时：空队列，直接回到级别阶段
        return emptyList()
      }

      val remain = currentRemainSec
      val queue = mutableListOf<String>()
      val isWholeTen = remain % 10 == 0

      if (isWholeTen && remain < 100) {
        // 整十数（10-90）：中文整十读法 + "秒后抵达"
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
      return queue
    }
  }

  /** 临时队列：级别阶段或数字阶段构建的文件列表 */
  private val voiceQueue: MutableList<String> = mutableListOf()

  /**
   * 播放下一段语音（SoundPool 低延迟播放）
   *
   * 流程：
   * 1. 队列空时根据当前阶段构建（级别或数字）
   * 2. 取出队首文件名，用 SoundPool.play() 播放（延迟 <10ms）
   * 3. postDelayed(音频时长) 后播放下一个
   *
   * 相比 MediaPlayer 的优势：
   * - 无需每次创建/prepare MediaPlayer（省 100-200ms）
   * - 数字间隔从 ~200ms 降到 ~10ms
   */
  private fun playNextVoice() {
    if (!voiceLooping) return

    // 队列空时根据当前阶段构建
    synchronized(voiceQueue) {
      if (voiceQueue.isEmpty()) {
        voiceQueue.addAll(buildVoiceQueueForPhase())
      }
    }

    if (voiceQueue.isEmpty()) {
      // 队列仍为空（如数字阶段无数字可播），立即回到级别阶段
      if (voiceLooping) {
        mainHandler.post(playNextVoiceRunnable)
      }
      return
    }

    val fileName: String
    synchronized(voiceQueue) {
      if (voiceQueue.isEmpty()) return
      fileName = voiceQueue.removeAt(0)
    }

    val soundId = soundIds[fileName]
    val duration = soundDurations[fileName] ?: 500L

    if (soundId == null) {
      emitError("playNextVoice", "音频未预加载: $fileName")
      if (voiceLooping) {
        mainHandler.postDelayed(playNextVoiceRunnable, VOICE_RETRY_DELAY_MS)
      }
      return
    }

    try {
      // SoundPool.play() 几乎无延迟
      soundPool?.play(soundId, 1f, 1f, 1, 0, 1f)
      // 按音频时长调度下一段
      if (voiceLooping) {
        mainHandler.postDelayed(playNextVoiceRunnable, duration)
      }
    } catch (e: Exception) {
      emitError("playNextVoice", "${e.message ?: e::class.java.simpleName} (file=$fileName)")
      if (voiceLooping) {
        mainHandler.postDelayed(playNextVoiceRunnable, VOICE_RETRY_DELAY_MS)
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
    voiceLooping = false
    mainHandler.removeCallbacks(playNextVoiceRunnable)
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
