package com.mdoeeewapp.android.cn.floatingwindow

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.WindowCompat
import com.mdoeeewapp.android.cn.background.EewAlertEngine
import com.mdoeeewapp.android.cn.background.ReactContextProvider

/**
 * 锁屏预警 Activity
 *
 * 当 App 在后台/锁屏时，由 EewBackgroundService 启动此 Activity 显示预警内容。
 * 相比 TYPE_APPLICATION_OVERLAY 悬浮窗，Activity 通过 setShowWhenLocked/setTurnScreenOn
 * 能更可靠地显示在锁屏界面之上（兼容 MIUI/Flye 等定制 ROM）。
 *
 * Manifest 配置：
 * - android:showWhenLocked="true"  锁屏之上显示
 * - android:turnScreenOn="true"    点亮屏幕
 * - android:excludeFromRecents="true"  不出现在最近任务
 * - android:taskAffinity=""        独立任务栈，避免影响主任务
 * - android:theme 透明主题（Activity 内部用不透明背景填满屏幕，避免与锁屏壁纸叠加变色）
 *
 * Intent extras：
 * - magnitude: Double
 * - depth: Double
 * - intensity: Double
 * - distance: Double
 * - location: String
 * - alertLevel: String (blue/yellow/orange/red)
 * - originTime: Long
 * - arrivalMs: Long (S 波到达时间戳)
 * - soundEnabled: Boolean（是否启用声音警报）
 * - vibrationEnabled: Boolean（是否启用震动警报）
 * - flashlightEnabled: Boolean（是否启用闪光灯警报）
 *
 * 警报联动（通过 ReactContextProvider 获取原生模块实例，无需经过 RN 桥）：
 * - 声音：onCreate 启动循环播放，onDestroy/倒计时归零 停止
 * - 震动：onCreate 启动循环震动（振 2s + 默 1s），onDestroy/倒计时归零 停止
 * - 闪光灯：仅烈度 ≥ 5（橙红级）触发，onCreate 启动循环闪烁，onDestroy/倒计时归零 停止
 *
 * 生命周期：
 * - onCreate: 配置 window flags + 构建 UI + 启动 tick + 启动声音/震动/闪光灯
 * - onDestroy: 停止 tick + 停止声音/震动/闪光灯 + 释放 WakeLock
 *
 * 关闭方式：
 * - 用户点击✕按钮 → finish()
 * - 倒计时归零后保持显示，直到用户手动关闭
 */
class LockScreenAlertActivity : Activity() {

  companion object {
    private const val TAG = "LockScreenAlertActivity"

    /** Intent extras keys */
    const val EXTRA_MAGNITUDE = "magnitude"
    const val EXTRA_DEPTH = "depth"
    const val EXTRA_INTENSITY = "intensity"
    const val EXTRA_DISTANCE = "distance"
    const val EXTRA_LOCATION = "location"
    const val EXTRA_ALERT_LEVEL = "alertLevel"
    const val EXTRA_ORIGIN_TIME = "originTime"
    const val EXTRA_ARRIVAL_MS = "arrivalMs"
    const val EXTRA_SOUND_ENABLED = "soundEnabled"
    const val EXTRA_VIBRATION_ENABLED = "vibrationEnabled"
    const val EXTRA_FLASHLIGHT_ENABLED = "flashlightEnabled"

    /** 闪光灯触发阈值（烈度 ≥ 5，即橙红级） */
    private const val FLASHLIGHT_INTENSITY_THRESHOLD = 5.0

    /**
     * 地震波到达后警报继续持续的秒数（到 -30 秒停止）
     *
     * 规则：倒计时归零（remainSec <= 0）时文字显示"地震波已到达"，
     * 但声音/震动/闪光灯继续响到 remainSec <= -30 才停止。
     * 响完不关闭 Activity，等用户手动关闭。
     */
    private const val ALERT_CONTINUE_AFTER_ARRIVAL_SEC = -30

    /** 震动振动时长（毫秒），与 DB/T 113.1-2026 警报主音同步 */
    private const val VIBRATE_MS = 2000

    /** 震动静默时长（毫秒） */
    private const val SILENT_MS = 1000

    /** 闪光灯闪烁间隔（毫秒），开/关各持续此时间 */
    private const val FLASHLIGHT_BLINK_INTERVAL_MS = 1000
  }

  // 预警数据（从 Intent extras 读取）
  private var magnitude: Double = 0.0
  private var depth: Double = 0.0
  private var intensity: Double = 0.0
  private var distance: Double = 0.0
  private var location: String = ""
  private var alertLevel: String = EewAlertEngine.LEVEL_BLUE
  private var originTime: Long = 0L
  private var arrivalMs: Long = 0L

  // 警报配置（从 Intent extras 读取）
  private var soundEnabled: Boolean = true
  private var vibrationEnabled: Boolean = true
  private var flashlightEnabled: Boolean = true

  // UI 元素引用（tick 时更新）
  private var countdownText: TextView? = null
  private var magnitudeText: TextView? = null
  private var locationText: TextView? = null
  private var levelText: TextView? = null
  private var infoText: TextView? = null
  private var dividerView: View? = null
  private var sep1View: View? = null
  private var sep2View: View? = null
  private var containerLayout: LinearLayout? = null

  // 倒计时 tick
  private val handler = Handler(Looper.getMainLooper())
  private val tickRunnable = object : Runnable {
    override fun run() {
      updateCountdown()
      handler.postDelayed(this, 1000L)
    }
  }

  /** 倒计时是否已归零（已到达），避免重复停止警报 */
  @Volatile
  private var arrived = false

  /** 警报是否已停止（到达后继续响 -30 秒后停止），避免重复停止 */
  @Volatile
  private var alertsStopped = false

  // WakeLock（保持屏幕常亮，直到用户关闭或 Activity 销毁）
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    // 读取 Intent extras
    magnitude = intent.getDoubleExtra(EXTRA_MAGNITUDE, 0.0)
    depth = intent.getDoubleExtra(EXTRA_DEPTH, 0.0)
    intensity = intent.getDoubleExtra(EXTRA_INTENSITY, 0.0)
    distance = intent.getDoubleExtra(EXTRA_DISTANCE, 0.0)
    location = intent.getStringExtra(EXTRA_LOCATION) ?: ""
    alertLevel = intent.getStringExtra(EXTRA_ALERT_LEVEL) ?: EewAlertEngine.LEVEL_BLUE
    originTime = intent.getLongExtra(EXTRA_ORIGIN_TIME, 0L)
    arrivalMs = intent.getLongExtra(EXTRA_ARRIVAL_MS, 0L)
    soundEnabled = intent.getBooleanExtra(EXTRA_SOUND_ENABLED, true)
    vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION_ENABLED, true)
    flashlightEnabled = intent.getBooleanExtra(EXTRA_FLASHLIGHT_ENABLED, true)

    Log.i(TAG, "onCreate: mag=$magnitude intensity=$intensity level=$alertLevel arrival=$arrivalMs" +
      " sound=$soundEnabled vibrate=$vibrationEnabled flashlight=$flashlightEnabled")

    // 配置 Window：锁屏之上显示 + 点亮屏幕 + 保持常亮
    configureWindow()

    // 请求解除键盘锁（仅无密码/已解锁设备自动解除，有密码需用户手动解锁）
    requestDismissKeyguard()

    // 构建 UI
    val rootView = buildUI()
    setContentView(rootView)

    // 获取 WakeLock 保持屏幕常亮
    acquireWakeLock()

    // 启动倒计时 tick
    handler.post(tickRunnable)

    // 启动声音/震动/闪光灯警报
    startAlerts()
  }

  /**
   * 配置 Window 属性：锁屏显示 + 点亮屏幕 + 保持常亮
   *
   * - API 27+：使用 setShowWhenLocked / setTurnScreenOn（推荐 API）
   * - API 26：使用 window flags（FLAG_SHOW_WHEN_LOCKED 等，已弃用但仍有效）
   */
  private fun configureWindow() {
    // API 27+：使用新 API
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      // API 26：使用 window flags
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }

    // 保持屏幕常亮（直到 Activity 销毁）
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    // 状态栏透明，沉浸式
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
  }

  /**
   * 请求解除键盘锁
   *
   * 仅在无密码或已解锁设备上自动解除。
   * 有密码设备会显示锁屏界面，用户需要手动解锁后才能看到完整预警。
   * （这是 Android 安全策略，无法绕过）
   */
  private fun requestDismissKeyguard() {
    try {
      val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      if (keyguardManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        keyguardManager.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
          override fun onDismissSucceeded() {
            Log.i(TAG, "键盘锁已解除")
          }
          override fun onDismissError() {
            Log.w(TAG, "键盘锁解除失败（可能需要密码）")
          }
          override fun onDismissCancelled() {
            Log.w(TAG, "键盘锁解除被取消")
          }
        })
      }
    } catch (e: Exception) {
      Log.w(TAG, "requestDismissKeyguard 异常: ${e.message}")
    }
  }

  /**
   * 构建预警 UI（代码构建，全屏烈度色背景）
   *
   * 布局结构：
   * - outer（MATCH_PARENT，不透明烈度色背景，填满屏幕避免与锁屏壁纸叠加变色）
   *   - container（垂直 LinearLayout，透明背景，顶部留白）
   *     - 顶行：S 波到达标签（左） + ✕ 关闭按钮（右）
   *     - 倒计时大字（居中）
   *     - 分隔线
   *     - 底行：震级 | 位置 | 级别提示（三段分布）
   *     - 信息行：发震时刻 + 震级 + 深度 + 距离
   *
   * 注意：outer 使用不透明烈度色背景，完全遮挡锁屏壁纸，避免颜色叠加变色。
   * container 透明背景，内容直接显示在 outer 的烈度色背景上。
   */
  private fun buildUI(): View {
    val ctx: Context = this
    val textColor = intensityToTextColor()
    val labelColor = intensityToLabelColor()
    val dividerColor = intensityToDividerColor()
    val bgColor = intensityToBgColor()

    // 容器：垂直布局（透明背景，继承 outer 的烈度色）
    val container = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      // 透明背景（outer 提供烈度色背景）
      setBackgroundColor(Color.TRANSPARENT)
      val padH = dp(20)
      val padV = dp(42)
      setPadding(padH, padV, padH, padV)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        // 顶部留白（与悬浮窗一致，y=120dp）
        topMargin = dp(120)
        // 左右留白（与屏幕边缘有间距）
        val padSide = dp(8)
        leftMargin = padSide
        rightMargin = padSide
      }
    }
    containerLayout = container

    // ---- 顶行：S 波到达标签（左） + 关闭按钮（右） ----
    val topRow = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val cdLabel = TextView(ctx).apply {
      text = "S 波到达"
      setTextColor(labelColor)
      textSize = 11f
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    }
    val closeBtn = TextView(ctx).apply {
      text = "✕"
      setTextColor(textColor)
      textSize = 18f
      val pad = dp(8)
      setPadding(pad, 0, pad, 0)
      setOnClickListener { finish() }
    }
    topRow.addView(cdLabel)
    topRow.addView(closeBtn)

    // ---- 倒计时大字 ----
    countdownText = TextView(ctx).apply {
      text = formatCountdown()
      setTextColor(textColor)
      textSize = 48f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(12)
      val padBot = dp(12)
      setPadding(0, padTop, 0, padBot)
    }

    // ---- 分隔线 ----
    dividerView = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(1)
      )
    }

    // ---- 底行：震级 | 位置 | 级别（三段分布） ----
    val bottomRow = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      val padTop = dp(30)
      setPadding(0, padTop, 0, 0)
    }
    magnitudeText = TextView(ctx).apply {
      text = formatMagnitude()
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
    }
    sep1View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(dp(1), dp(20))
    }
    locationText = TextView(ctx).apply {
      text = formatLocation()
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
    }
    sep2View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(dp(1), dp(20))
    }
    levelText = TextView(ctx).apply {
      text = formatLevel()
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
    }
    bottomRow.addView(magnitudeText)
    bottomRow.addView(sep1View)
    bottomRow.addView(locationText)
    bottomRow.addView(sep2View)
    bottomRow.addView(levelText)

    // ---- 信息行：发震时刻 + 震级 + 深度 + 距离 ----
    infoText = TextView(ctx).apply {
      text = formatInfoLine()
      setTextColor(labelColor)
      textSize = 12f
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(12)
      setPadding(0, padTop, 0, 0)
    }

    // 组装 container
    container.addView(topRow)
    container.addView(countdownText)
    container.addView(dividerView)
    container.addView(bottomRow)
    container.addView(infoText)

    // 外层布局：MATCH_PARENT 填满屏幕，不透明烈度色背景
    // 这是修复透明度问题的关键：用不透明烈度色背景完全遮挡锁屏壁纸，
    // 避免 Activity 透明背景导致锁屏壁纸色与烈度色叠加变色。
    val outer = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(bgColor)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.MATCH_PARENT
      )
    }
    outer.addView(container)
    return outer
  }

  /**
   * 更新倒计时显示（每秒 tick 调用）
   *
   * 规则：
   * - remainSec > 0：正常倒计时显示
   * - remainSec <= 0：文字显示"地震波已到达"，警报继续响
   * - remainSec <= -30：停止声音/震动/闪光灯，但保持 UI 显示，等用户手动关闭
   */
  private fun updateCountdown() {
    val now = System.currentTimeMillis()
    val remainSec = ((arrivalMs - now) / 1000.0).toInt()
    countdownText?.text = formatCountdown(remainSec)

    // 地震波已到达（remainSec <= 0）：文字已显示"地震波已到达"
    // 警报继续响到 -30 秒才停止（只触发一次）
    if (!arrived && remainSec <= 0) {
      arrived = true
      Log.i(TAG, "地震波已到达，警报继续响到 -30 秒")
    }
    // 警报持续到 -30 秒停止
    if (!alertsStopped && remainSec <= ALERT_CONTINUE_AFTER_ARRIVAL_SEC) {
      alertsStopped = true
      Log.i(TAG, "警报持续 ${-ALERT_CONTINUE_AFTER_ARRIVAL_SEC} 秒后停止声音/震动/闪光灯")
      stopAlerts()
    }
  }

  // ======================== 警报联动（声音/震动/闪光灯） ========================

  /**
   * 启动声音/震动/闪光灯警报
   *
   * 通过 ReactContextProvider 获取原生模块实例（无需经过 RN 桥，避免锁屏时 JS 暂停导致无法调用）。
   * - 声音：循环播放警报主音（受 soundEnabled 控制）
   * - 震动：循环震动，振 2s + 默 1s（受 vibrationEnabled 控制）
   * - 闪光灯：循环闪烁，仅烈度 ≥ 5（橙红级）触发（受 flashlightEnabled 控制）
   *
   * 若模块实例为 null（RN 未初始化或已销毁），则跳过对应警报，不影响 UI 显示。
   */
  private fun startAlerts() {
    try {
      // 声音警报
      if (soundEnabled) {
        val soundModule = ReactContextProvider.soundModule
        if (soundModule != null) {
          soundModule.playAlertSound()
          Log.i(TAG, "声音警报已启动")
        } else {
          Log.w(TAG, "SoundModule 未注册，跳过声音警报")
        }
      }

      // 震动警报
      if (vibrationEnabled) {
        val vibratorModule = ReactContextProvider.vibratorModule
        if (vibratorModule != null) {
          vibratorModule.startVibratingCycle(VIBRATE_MS, SILENT_MS)
          Log.i(TAG, "震动警报已启动")
        } else {
          Log.w(TAG, "VibratorModule 未注册，跳过震动警报")
        }
      }

      // 闪光灯警报（仅烈度 ≥ 5，橙红级）
      if (flashlightEnabled && intensity >= FLASHLIGHT_INTENSITY_THRESHOLD) {
        val flashlightModule = ReactContextProvider.flashlightModule
        if (flashlightModule != null) {
          flashlightModule.startBlinking(FLASHLIGHT_BLINK_INTERVAL_MS)
          Log.i(TAG, "闪光灯警报已启动（intensity=$intensity）")
        } else {
          Log.w(TAG, "FlashlightModule 未注册，跳过闪光灯警报")
        }
      } else {
        Log.d(TAG, "闪光灯未触发（flashlightEnabled=$flashlightEnabled intensity=$intensity < $FLASHLIGHT_INTENSITY_THRESHOLD）")
      }
    } catch (e: Exception) {
      Log.e(TAG, "启动警报失败: ${e.message}")
    }
  }

  /**
   * 停止声音/震动/闪光灯警报
   *
   * 在以下场景调用：
   * - 倒计时归零（地震波已到达）
   * - Activity 销毁（用户点击✕关闭或系统销毁）
   */
  private fun stopAlerts() {
    try {
      ReactContextProvider.soundModule?.stopAlertSound()
      ReactContextProvider.vibratorModule?.stopVibrating()
      ReactContextProvider.flashlightModule?.stopBlinking()
      Log.i(TAG, "声音/震动/闪光灯警报已停止")
    } catch (e: Exception) {
      Log.e(TAG, "停止警报失败: ${e.message}")
    }
  }

  // ======================== 颜色与格式化（与 FloatingWindowModule 一致） ========================

  private fun intensityToBgColor(): Int {
    // 按预估烈度分档：<4 蓝色/深蓝，4-5.9 黄色/暗黄，6-7.9 橙色/暗橙，>=8 橙红色/深红
    return when {
      intensity < 4 -> Color.parseColor("#1E3A8A")  // 深蓝
      intensity < 6 -> Color.parseColor("#713F12")  // 暗黄
      intensity < 8 -> Color.parseColor("#7C2D12")  // 暗橙
      else -> Color.parseColor("#7F1D1D")            // 深红
    }
  }

  private fun intensityToTextColor(): Int {
    // 锁屏页面背景均为暗色（深蓝/暗黄/暗橙/深红），统一使用白字保证可读性
    return Color.parseColor("#FFFFFF")
  }

  private fun intensityToLabelColor(): Int {
    // 标签文字（如"S 波到达"、信息行）同样统一白色
    return Color.parseColor("#FFFFFF")
  }

  private fun intensityToDividerColor(): Int {
    return when {
      intensity < 6 -> Color.parseColor("#404040")
      else -> Color.parseColor("#A3A3A3")
    }
  }

  private fun formatCountdown(remainSec: Int? = null): String {
    val sec = remainSec ?: ((arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()
    return if (sec <= 0) "地震波已到达" else "${sec} 秒"
  }

  private fun formatMagnitude(): String = "M ${String.format("%.1f", magnitude)}"

  private fun formatLocation(): String {
    return if (location.length > 8) location.take(7) + "…" else location
  }

  private fun formatLevel(): String {
    return when (alertLevel) {
      EewAlertEngine.LEVEL_BLUE -> "蓝色预警"
      EewAlertEngine.LEVEL_YELLOW -> "黄色预警"
      EewAlertEngine.LEVEL_ORANGE -> "橙色预警"
      EewAlertEngine.LEVEL_RED -> "红色预警"
      else -> "预警"
    }
  }

  private fun formatInfoLine(): String {
    val timeStr = if (originTime > 0) {
      val sdf = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.CHINA)
      sdf.format(java.util.Date(originTime))
    } else ""
    return "发震 $timeStr  深度 ${depth.toInt()}km  距离 ${distance.toInt()}km"
  }

  // ======================== 工具方法 ========================

  private fun dp(value: Int): Int {
    val density = resources.displayMetrics.density
    return (value * density).toInt()
  }

  /**
   * 获取 WakeLock 保持屏幕常亮
   *
   * 使用 SCREEN_BRIGHT_WAKE_LOCK 保持屏幕常亮，直到 Activity 销毁。
   * 与 FloatingWindowModule 的 WakeLock 不同，这里不设置超时（Activity 销毁时自动释放）。
   */
  private fun acquireWakeLock() {
    try {
      val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      releaseWakeLock()
      val lock = powerManager.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
        "EewApp:LockScreenAlert"
      )
      // 不设置超时，Activity 销毁时释放
      lock.acquire()
      wakeLock = lock
    } catch (_: Exception) {
      // WakeLock 获取失败不影响显示
    }
  }

  private fun releaseWakeLock() {
    try {
      wakeLock?.let { lock ->
        if (lock.isHeld) lock.release()
      }
    } catch (_: Exception) {
      // 忽略
    }
    wakeLock = null
  }

  // ======================== 生命周期 ========================

  override fun onDestroy() {
    Log.i(TAG, "onDestroy")
    handler.removeCallbacks(tickRunnable)
    stopAlerts()
    releaseWakeLock()
    super.onDestroy()
  }

  /**
   * 按返回键不关闭 Activity（避免误触）
   * 用户必须点击✕按钮才能关闭
   */
  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    // 不调用 super.onBackPressed()，阻止返回键关闭
  }
}
