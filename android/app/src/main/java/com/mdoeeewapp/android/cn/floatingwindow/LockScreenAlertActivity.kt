package com.mdoeeewapp.android.cn.floatingwindow

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.WindowCompat
import com.mdoeeewapp.android.cn.background.EewAlertEngine
import com.mdoeeewapp.android.cn.background.ReactContextProvider
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 锁屏预警 Activity（多事件并发版）
 *
 * 当 App 在后台/锁屏时，由 EewBackgroundService 启动此 Activity 显示预警内容。
 * 相比 TYPE_APPLICATION_OVERLAY 悬浮窗，Activity 通过 setShowWhenLocked/setTurnScreenOn
 * 能更可靠地显示在锁屏界面之上（兼容 MIUI/Flye 等定制 ROM）。
 *
 * 支持多事件上下垂直排列（最多 3 个）：
 * - 顶级事件（最高预警级别）显示在最上
 * - 并列事件（与顶级同级别）显示在下方
 * - 差 ≥ 1 档的事件被顶级压制，等顶级倒计时归零 30 秒后才显示
 * - 用户点击✕关闭某事件 → 仅移除该事件卡片，其他继续显示
 * - 所有事件都关闭后 finish()
 *
 * Manifest 配置：
 * - android:showWhenLocked="true"  锁屏之上显示
 * - android:turnScreenOn="true"    点亮屏幕
 * - android:excludeFromRecents="true"  不出现在最近任务
 * - android:taskAffinity=""        独立任务栈，避免影响主任务
 * - android:launchMode="singleInstance"  单例，新 Intent 通过 onNewIntent 传入
 * - android:theme 透明主题（Activity 内部用不透明背景填满屏幕，避免与锁屏壁纸叠加变色）
 *
 * 调用方式：
 * - 首次事件：EewBackgroundService.startLockScreenActivity() 启动 Activity
 * - 后续事件：Activity 已运行时通过 instance.addEvent() 动态添加
 *
 * 警报联动（通过 ReactContextProvider 获取原生模块实例，无需经过 RN 桥）：
 * - 声音：首个事件 onCreate 启动循环播放，所有事件关闭后停止
 * - 震动：首个事件 onCreate 启动循环震动（振 2s + 默 1s），所有事件关闭后停止
 * - 闪光灯：仅烈度 ≥ 5（橙红级）触发，所有事件关闭后停止
 *
 * 生命周期：
 * - onCreate: 配置 window flags + 首个事件 UI + 启动 tick + 启动警报
 * - onNewIntent: 收到新事件，添加到列表并刷新 UI
 * - onDestroy: 停止 tick + 停止声音/震动/闪光灯 + 释放 WakeLock
 *
 * 关闭方式：
 * - 用户点击某事件的✕按钮 → 移除该事件卡片，其他继续显示
 * - 所有事件都关闭 → finish()
 */
class LockScreenAlertActivity : Activity() {

  companion object {
    private const val TAG = "LockScreenAlertActivity"

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

    /** 最大同时显示的事件数量 */
    private const val MAX_DISPLAY_EVENTS = 3

    /** 并列事件与顶级事件的最大级别差（0 = 同级别才算并列） */
    private const val PEER_LEVEL_MAX_DIFF = 0

    /** 警报配置 Intent extras keys（从 EewBackgroundService 传入） */
    const val EXTRA_SOUND_ENABLED = "soundEnabled"
    const val EXTRA_VIBRATION_ENABLED = "vibrationEnabled"
    const val EXTRA_FLASHLIGHT_ENABLED = "flashlightEnabled"

    /** 事件数据 Intent extras keys（从 EewBackgroundService 传入） */
    const val EXTRA_EVENT_ID = "eventId"
    const val EXTRA_MAGNITUDE = "magnitude"
    const val EXTRA_DEPTH = "depth"
    const val EXTRA_INTENSITY = "intensity"
    const val EXTRA_DISTANCE = "distance"
    const val EXTRA_LOCATION = "location"
    const val EXTRA_ALERT_LEVEL = "alertLevel"
    const val EXTRA_ORIGIN_TIME = "originTime"
    const val EXTRA_ARRIVAL_MS = "arrivalMs"

    /**
     * 当前活跃的 Activity 实例（供 EewBackgroundService 调用 addEvent）
     * Activity onCreate 时设置，onDestroy 时清除。
     */
    @Volatile
    var instance: LockScreenAlertActivity? = null
      private set

    /** Activity 是否已启动（防止重复 startActivity） */
    private val started = AtomicBoolean(false)

    /**
     * Activity 是否已运行（供 EewBackgroundService 判断是否需要 startActivity）
     */
    fun isRunning(): Boolean = instance != null && started.get()

    /** 重置启动状态（供测试调用） */
    fun resetStartedFlag() {
      started.set(false)
      instance = null
    }
  }

  /**
   * 锁屏预警事件数据（供 EewBackgroundService 构造后传入 Activity）
   */
  data class LockScreenEvent(
    val eventId: String,
    val magnitude: Double,
    val depth: Double,
    val intensity: Double,
    val distance: Double,
    val location: String,
    val alertLevel: String,
    val originTime: Long,
    val arrivalMs: Long,
    var arrived: Boolean = false,
    var alertsStopped: Boolean = false,
  )

  /** 警报配置（从首个 Intent extras 读取，后续事件沿用） */
  private var soundEnabled: Boolean = true
  private var vibrationEnabled: Boolean = true
  private var flashlightEnabled: Boolean = true

  /** 事件列表（按级别排序，最多 MAX_DISPLAY_EVENTS 个） */
  private val events: MutableMap<String, LockScreenEvent> = LinkedHashMap()

  /** 事件卡片 View 引用（key: eventId） */
  private val cardViews: MutableMap<String, EventCardViews> = mutableMapOf()

  /** 事件列表容器（垂直排列所有事件卡片） */
  private var eventsContainer: LinearLayout? = null

  /** 单个事件卡片的 View 引用（tick 时更新） */
  private data class EventCardViews(
    val countdownText: TextView,
    val magnitudeText: TextView,
    val locationText: TextView,
    val levelText: TextView,
    val infoText: TextView,
  )

  /** 倒计时 tick */
  private val handler = Handler(Looper.getMainLooper())
  private val tickRunnable = object : Runnable {
    override fun run() {
      updateAllCountdowns()
      handler.postDelayed(this, 1000L)
    }
  }

  /** 警报是否已启动（合并一个，所有事件共享） */
  @Volatile
  private var alertsStarted = false

  /** 警报是否已停止（所有事件到达后 -30 秒后停止） */
  @Volatile
  private var alertsStopped = false

  // WakeLock（保持屏幕常亮，直到用户关闭或 Activity 销毁）
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    instance = this
    started.set(true)

    // 读取警报配置（首个 Intent 传入）
    soundEnabled = intent.getBooleanExtra(EXTRA_SOUND_ENABLED, true)
    vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION_ENABLED, true)
    flashlightEnabled = intent.getBooleanExtra(EXTRA_FLASHLIGHT_ENABLED, true)

    Log.i(TAG, "onCreate: sound=$soundEnabled vibrate=$vibrationEnabled flashlight=$flashlightEnabled")

    // 解析首个事件
    val firstEvent = parseEventFromIntent(intent)
    if (firstEvent != null) {
      events[firstEvent.eventId] = firstEvent
      Log.i(TAG, "首个事件: eventId=${firstEvent.eventId} mag=${firstEvent.magnitude} intensity=${firstEvent.intensity} level=${firstEvent.alertLevel}")
    }

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

    // 启动声音/震动/闪光灯警报（合并一个）
    startAlerts()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    // singleInstance 模式下，新 Intent 通过 onNewIntent 传入
    val newEvent = parseEventFromIntent(intent)
    if (newEvent != null) {
      Log.i(TAG, "onNewIntent: 新事件 eventId=${newEvent.eventId} mag=${newEvent.magnitude}")
      addEventInternal(newEvent)
    }
  }

  /**
   * 从 Intent 解析单个事件
   */
  private fun parseEventFromIntent(intent: Intent): LockScreenEvent? {
    val eventId = intent.getStringExtra(EXTRA_EVENT_ID) ?: return null
    return LockScreenEvent(
      eventId = eventId,
      magnitude = intent.getDoubleExtra(EXTRA_MAGNITUDE, 0.0),
      depth = intent.getDoubleExtra(EXTRA_DEPTH, 0.0),
      intensity = intent.getDoubleExtra(EXTRA_INTENSITY, 0.0),
      distance = intent.getDoubleExtra(EXTRA_DISTANCE, 0.0),
      location = intent.getStringExtra(EXTRA_LOCATION) ?: "",
      alertLevel = intent.getStringExtra(EXTRA_ALERT_LEVEL) ?: EewAlertEngine.LEVEL_BLUE,
      originTime = intent.getLongExtra(EXTRA_ORIGIN_TIME, 0L),
      arrivalMs = intent.getLongExtra(EXTRA_ARRIVAL_MS, 0L),
    )
  }

  /**
   * 添加事件（供 EewBackgroundService 调用）
   *
   * 若 Activity 已运行，直接调用此方法添加新事件；
   * 若 Activity 未运行，Service 应调用 startLockScreenActivity() 启动 Activity。
   */
  fun addEvent(event: LockScreenEvent) {
    mainHandler.post { addEventInternal(event) }
  }

  private val mainHandler = Handler(Looper.getMainLooper())

  /**
   * 添加事件（内部实现，主线程调用）
   *
   * 1. 加入 events 列表
   * 2. 重新排序、选择要显示的事件（顶级 + 并列）
   * 3. 重建 UI 卡片
   */
  private fun addEventInternal(event: LockScreenEvent) {
    if (events.containsKey(event.eventId)) {
      Log.i(TAG, "事件 ${event.eventId} 已存在，跳过")
      return
    }
    events[event.eventId] = event
    Log.i(TAG, "添加事件: eventId=${event.eventId} mag=${event.magnitude} level=${event.alertLevel} 总数=${events.size}")
    refreshDisplay()
  }

  /**
   * 选择要显示的事件（按预警级别排序，顶级 + 并列同级别，最多 MAX_DISPLAY_EVENTS 个）
   *
   * 规则与 EewBackgroundService.selectBackgroundDisplayEvents 一致：
   * - 候选过滤：remainSec > -30（倒计时归零后 30 秒内仍算活跃）
   * - 排序：预警级别降序，同级别按烈度降序
   * - 分组：顶级 1 个 + 并列（与顶级同级别）最多 2 个
   * - 差 ≥ 1 档的事件被顶级压制
   */
  private fun selectDisplayEvents(): List<LockScreenEvent> {
    val candidates = events.values.filter { evt ->
      val remainSec = ((evt.arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()
      remainSec > ALERT_CONTINUE_AFTER_ARRIVAL_SEC
    }.toMutableList()

    if (candidates.isEmpty()) return emptyList()

    candidates.sortWith(compareByDescending<LockScreenEvent> {
      levelOrder(it.alertLevel)
    }.thenByDescending { it.intensity })

    val top = candidates.first()
    val topOrder = levelOrder(top.alertLevel)
    val peers = candidates.drop(1).filter {
      topOrder - levelOrder(it.alertLevel) <= PEER_LEVEL_MAX_DIFF
    }
    return listOf(top) + peers.take(MAX_DISPLAY_EVENTS - 1)
  }

  /** 预警级别转数字（用于排序） */
  private fun levelOrder(level: String): Int = when (level) {
    "red" -> 4
    "orange" -> 3
    "yellow" -> 2
    "blue" -> 1
    else -> 0
  }

  /**
   * 重建事件卡片 UI
   *
   * 规则：
   * - events 为空 → finish() 关闭 Activity
   * - events 非空但 displayList 为空（所有事件都过期）→ 仍显示"地震波已到达"卡片，不关闭
   * - displayList 非空 → 重建卡片
   */
  private fun refreshDisplay() {
    val container = eventsContainer ?: return
    val displayList = selectDisplayEvents()
    Log.i(TAG, "refreshDisplay: 总事件=${events.size} 显示=${displayList.size}")

    // events 真空 → 关闭 Activity
    if (events.isEmpty()) {
      Log.i(TAG, "无事件，关闭 Activity")
      container.removeAllViews()
      cardViews.clear()
      finish()
      return
    }

    // 清除旧卡片（保留容器）
    container.removeAllViews()
    cardViews.clear()

    // 若 displayList 为空（所有事件都过期），用 events 里的全部事件显示"地震波已到达"
    val listToShow = if (displayList.isEmpty()) events.values.toList() else displayList

    // 为每个事件创建卡片
    for ((index, evt) in listToShow.withIndex()) {
      val card = buildEventCard(evt, index)
      container.addView(card)
    }
  }

  // ======================== UI 构建 ========================

  /**
   * 配置 Window 属性：锁屏显示 + 点亮屏幕 + 保持常亮
   */
  private fun configureWindow() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    WindowCompat.setDecorFitsSystemWindows(window, false)
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
  }

  /**
   * 请求解除键盘锁
   */
  private fun requestDismissKeyguard() {
    try {
      val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      if (keyguardManager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        keyguardManager.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
          override fun onDismissSucceeded() { Log.i(TAG, "键盘锁已解除") }
          override fun onDismissError() { Log.w(TAG, "键盘锁解除失败（可能需要密码）") }
          override fun onDismissCancelled() { Log.w(TAG, "键盘锁解除被取消") }
        })
      }
    } catch (e: Exception) {
      Log.w(TAG, "requestDismissKeyguard 异常: ${e.message}")
    }
  }

  /**
   * 构建整体 UI（全屏背景 + 滚动事件列表）
   *
   * 布局：
   * - outer（MATCH_PARENT，不透明烈度色背景）
   *   - scrollView（可滚动，内容垂直居中，自适应位置）
   *     - eventsContainer（垂直 LinearLayout，宽度占满屏幕，包含所有事件卡片）
   */
  private fun buildUI(): View {
    val ctx: Context = this
    val topIntensity = selectDisplayEvents().firstOrNull()?.intensity ?: 0.0
    val bgColor = intensityToBgColor(topIntensity)

    // 事件卡片容器（垂直排列，宽度占满屏幕）
    val container = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.TRANSPARENT)
      // 水平 padding 保留（让内容不贴边），垂直 padding 给上下留白
      val padH = dp(12)
      val padV = dp(60)
      setPadding(padH, padV, padH, padV)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      )
    }
    eventsContainer = container

    // ScrollView 包裹容器，内容垂直居中（自适应位置）
    val scrollView = ScrollView(ctx).apply {
      isVerticalScrollBarEnabled = false
      // 填满屏幕宽度
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.MATCH_PARENT
      )
      addView(container)
    }

    // 外层：MATCH_PARENT 填满屏幕，不透明烈度色背景
    val outer = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(bgColor)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.MATCH_PARENT
      )
    }
    outer.addView(scrollView)

    // 创建首个事件卡片
    refreshDisplay()

    return outer
  }

  /**
   * 构建单个事件卡片
   *
   * 卡片布局（与悬浮窗一致）：
   * - 顶行：S 波到达标签（左） + ✕ 关闭按钮（右）
   * - 倒计时大字（居中）
   * - 分隔线
   * - 底行：震级 | 位置 | 级别提示（三段分布）
   * - 信息行：发震时刻 + 深度 + 距离
   *
   * 卡片之间留 8dp 间距
   */
  private fun buildEventCard(evt: LockScreenEvent, index: Int): View {
    val ctx: Context = this
    val textColor = intensityToTextColor(evt.intensity)
    val labelColor = intensityToLabelColor(evt.intensity)
    val dividerColor = intensityToDividerColor(evt.intensity)
    val cardBgColor = intensityToCardBgColor(evt.intensity)

    // 卡片背景（半透明圆角，让外层背景色透出）
    val cardDrawable = GradientDrawable().apply {
      setColor(cardBgColor)
      cornerRadius = dp(16).toFloat()
    }

    val card = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      background = cardDrawable
      val padH = dp(20)
      val padV = dp(42)
      setPadding(padH, padV, padH, padV)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT
      ).apply {
        // 卡片间距
        if (index > 0) topMargin = dp(8)
      }
    }

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
      setOnClickListener {
        Log.i(TAG, "用户关闭事件 ${evt.eventId}")
        events.remove(evt.eventId)
        refreshDisplay()
      }
    }
    topRow.addView(cdLabel)
    topRow.addView(closeBtn)

    // ---- 倒计时大字 ----
    val countdownText = TextView(ctx).apply {
      text = formatCountdown(evt)
      setTextColor(textColor)
      textSize = 48f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(12)
      val padBot = dp(12)
      setPadding(0, padTop, 0, padBot)
    }

    // ---- 分隔线 ----
    val dividerView = View(ctx).apply {
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
    val magnitudeText = TextView(ctx).apply {
      text = formatMagnitude(evt)
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
    }
    val sep1View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(dp(1), dp(20))
    }
    val locationText = TextView(ctx).apply {
      text = formatLocation(evt)
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    val sep2View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(dp(1), dp(20))
    }
    val levelText = TextView(ctx).apply {
      text = formatLevel(evt)
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    bottomRow.addView(magnitudeText)
    bottomRow.addView(sep1View)
    bottomRow.addView(locationText)
    bottomRow.addView(sep2View)
    bottomRow.addView(levelText)

    // ---- 信息行 ----
    val infoText = TextView(ctx).apply {
      text = formatInfoLine(evt)
      setTextColor(labelColor)
      textSize = 12f
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(12)
      setPadding(0, padTop, 0, 0)
    }

    // 组装卡片
    card.addView(topRow)
    card.addView(countdownText)
    card.addView(dividerView)
    card.addView(bottomRow)
    card.addView(infoText)

    // 保存 View 引用（tick 时更新）
    cardViews[evt.eventId] = EventCardViews(
      countdownText = countdownText,
      magnitudeText = magnitudeText,
      locationText = locationText,
      levelText = levelText,
      infoText = infoText,
    )

    return card
  }

  // ======================== 倒计时 tick ========================

  /**
   * 更新所有事件卡片的倒计时显示（每秒 tick 调用）
   */
  private fun updateAllCountdowns() {
    val now = System.currentTimeMillis()
    var anyArrived = false
    var allStopped = true

    for (evt in events.values) {
      val remainSec = ((evt.arrivalMs - now) / 1000.0).toInt()
      val views = cardViews[evt.eventId]
      views?.countdownText?.text = formatCountdown(evt, remainSec)

      // 标记到达
      if (!evt.arrived && remainSec <= 0) {
        evt.arrived = true
        Log.i(TAG, "事件 ${evt.eventId} 地震波已到达")
      }
      if (evt.arrived && remainSec > ALERT_CONTINUE_AFTER_ARRIVAL_SEC) {
        allStopped = false
      }
      if (remainSec > 0) {
        allStopped = false
      }
    }

    // 所有事件都到达且超过 -30 秒 → 停止警报
    if (!alertsStopped && allStopped && events.isNotEmpty()) {
      alertsStopped = true
      Log.i(TAG, "所有事件警报持续到期，停止声音/震动/闪光灯")
      stopAlerts()
    }
  }

  // ======================== 警报联动 ========================

  /**
   * 启动声音/震动/闪光灯警报（合并一个，仅首次启动）
   */
  private fun startAlerts() {
    if (alertsStarted) return
    alertsStarted = true
    try {
      if (soundEnabled) {
        val soundModule = ReactContextProvider.soundModule
        if (soundModule != null) {
          soundModule.playAlertSound()
          Log.i(TAG, "声音警报已启动")
        } else {
          Log.w(TAG, "SoundModule 未注册，跳过声音警报")
        }
      }

      if (vibrationEnabled) {
        val vibratorModule = ReactContextProvider.vibratorModule
        if (vibratorModule != null) {
          vibratorModule.startVibratingCycle(VIBRATE_MS, SILENT_MS)
          Log.i(TAG, "震动警报已启动")
        } else {
          Log.w(TAG, "VibratorModule 未注册，跳过震动警报")
        }
      }

      // 闪光灯：取最高级别事件的烈度判断
      val topEvent = selectDisplayEvents().firstOrNull()
      if (flashlightEnabled && topEvent != null && topEvent.intensity >= FLASHLIGHT_INTENSITY_THRESHOLD) {
        val flashlightModule = ReactContextProvider.flashlightModule
        if (flashlightModule != null) {
          flashlightModule.startBlinking(FLASHLIGHT_BLINK_INTERVAL_MS)
          Log.i(TAG, "闪光灯警报已启动（intensity=${topEvent.intensity}）")
        } else {
          Log.w(TAG, "FlashlightModule 未注册，跳过闪光灯警报")
        }
      } else {
        Log.d(TAG, "闪光灯未触发（topIntensity=${topEvent?.intensity}）")
      }
    } catch (e: Exception) {
      Log.e(TAG, "启动警报失败: ${e.message}")
    }
  }

  /**
   * 停止声音/震动/闪光灯警报
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

  // ======================== 颜色与格式化 ========================

  /**
   * 外层背景色（按最高级别事件烈度分档，暗色系）
   */
  private fun intensityToBgColor(intensity: Double): Int {
    return when {
      intensity < 4 -> Color.parseColor("#1E3A8A")  // 深蓝
      intensity < 6 -> Color.parseColor("#713F12")  // 暗黄
      intensity < 8 -> Color.parseColor("#7C2D12")  // 暗橙
      else -> Color.parseColor("#7F1D1D")            // 深红
    }
  }

  /**
   * 卡片背景色（半透明，让外层背景色透出）
   */
  private fun intensityToCardBgColor(intensity: Double): Int {
    return when {
      intensity < 4 -> Color.parseColor("#334F8AFF")  // 半透明蓝
      intensity < 6 -> Color.parseColor("#33FAE600")  // 半透明黄
      intensity < 8 -> Color.parseColor("#33F09614")  // 半透明橙
      else -> Color.parseColor("#33DC2828")            // 半透明红
    }
  }

  /** 主文字颜色（锁屏统一白色） */
  private fun intensityToTextColor(@Suppress("UNUSED_PARAMETER") intensity: Double): Int {
    return Color.parseColor("#FFFFFF")
  }

  /** 标签文字颜色（锁屏统一白色） */
  private fun intensityToLabelColor(@Suppress("UNUSED_PARAMETER") intensity: Double): Int {
    return Color.parseColor("#FFFFFF")
  }

  /** 分隔线颜色 */
  private fun intensityToDividerColor(intensity: Double): Int {
    return when {
      intensity < 6 -> Color.parseColor("#404040")
      else -> Color.parseColor("#A3A3A3")
    }
  }

  private fun formatCountdown(evt: LockScreenEvent, remainSec: Int? = null): String {
    val sec = remainSec ?: ((evt.arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()
    return if (sec <= 0) "地震波已到达" else "${sec} 秒"
  }

  private fun formatMagnitude(evt: LockScreenEvent): String = "M ${String.format("%.1f", evt.magnitude)}"

  private fun formatLocation(evt: LockScreenEvent): String {
    return if (evt.location.length > 8) evt.location.take(7) + "…" else evt.location
  }

  private fun formatLevel(evt: LockScreenEvent): String {
    return when (evt.alertLevel) {
      EewAlertEngine.LEVEL_BLUE -> "蓝色预警"
      EewAlertEngine.LEVEL_YELLOW -> "黄色预警"
      EewAlertEngine.LEVEL_ORANGE -> "橙色预警"
      EewAlertEngine.LEVEL_RED -> "红色预警"
      else -> "预警"
    }
  }

  private fun formatInfoLine(evt: LockScreenEvent): String {
    val timeStr = if (evt.originTime > 0) {
      val sdf = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.CHINA)
      sdf.format(java.util.Date(evt.originTime))
    } else ""
    return "发震 $timeStr  深度 ${evt.depth.toInt()}km  距离 ${evt.distance.toInt()}km"
  }

  // ======================== 工具方法 ========================

  private fun dp(value: Int): Int {
    val density = resources.displayMetrics.density
    return (value * density).toInt()
  }

  private fun acquireWakeLock() {
    try {
      val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
      releaseWakeLock()
      val lock = powerManager.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
        "EewApp:LockScreenAlert"
      )
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
    Log.i(TAG, "onDestroy: 剩余事件=${events.size}")
    handler.removeCallbacks(tickRunnable)
    stopAlerts()
    releaseWakeLock()
    instance = null
    started.set(false)
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
