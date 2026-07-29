package com.mdoeeewapp.android.cn.floatingwindow

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.mdoeeewapp.android.cn.background.ReactContextProvider

/**
 * 悬浮窗原生模块（多事件并发版）
 *
 * 支持最多 3 个悬浮窗上下垂直排列：
 * - 顶级事件（最高预警级别）显示在最上
 * - 并列事件（与顶级同级别）显示在下方
 * - 差 ≥ 1 档的事件被顶级压制，等顶级倒计时归零 30 秒后才显示
 *
 * 设计要点：
 * - 使用 Map<eventId, FloatingWindowEntry> 管理多个悬浮窗 View
 * - 每个事件独立一个 View，上下排列（y 偏移按索引计算）
 * - 所有 View 操作通过主线程 Handler 在主线程执行
 * - 黑白简约风格：半透明黑色圆角背景 + 白色文字
 */
class FloatingWindowModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "FloatingWindowModule"
    const val EVENT_ERROR = "onError"
    const val EVENT_CLOSED = "onClosed"

    /** 悬浮窗默认背景色 */
    private const val BG_COLOR = "#CC000000"
    private const val LABEL_COLOR = "#99FFFFFF"
    private const val TEXT_COLOR = "#E6FFFFFF"

    /** 最大同时显示的悬浮窗数量 */
    private const val MAX_WINDOWS = 3

    /** 悬浮窗之间的垂直间距（dp） */
    private const val WINDOW_GAP_DP = 8

    /** 悬浮窗顶部初始 y 偏移（dp） */
    private const val WINDOW_TOP_OFFSET_DP = 120
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var windowManager: WindowManager? = null
  private var wakeLock: PowerManager.WakeLock? = null

  /**
   * 多事件悬浮窗条目表
   * Key: eventId，Value: 该事件的 View 与子 View 引用
   *
   * 顺序：按加入顺序，上层调用时应按优先级排序后依次 addOrUpdate
   */
  private val windowEntries: MutableMap<String, FloatingWindowEntry> = LinkedHashMap()

  /** 悬浮窗是否已显示（至少一个） */
  private val isShowing: Boolean get() = windowEntries.isNotEmpty()

  /**
   * 悬浮窗关闭回调（用户点击关闭按钮时触发）
   * 参数：eventId（被关闭的事件 ID）
   */
  @Volatile
  var onClosedCallback: ((String) -> Unit)? = null

  init {
    ReactContextProvider.setFloatingWindowModule(this)
  }

  /** 单个悬浮窗条目：持有该事件的所有 View 引用 */
  private data class FloatingWindowEntry(
    val eventId: String,
    val rootView: View,
    val layoutParams: WindowManager.LayoutParams,
    val magnitudeText: TextView,
    val countdownText: TextView,
    val locationText: TextView,
    val levelText: TextView,
    val infoText: TextView,
    val dividerView: View,
    val sep1View: View,
    val sep2View: View,
  )

  override fun getName(): String = NAME

  override fun invalidate() {
    mainHandler.post { removeAllViews() }
    releaseWakeLock()
    ReactContextProvider.setFloatingWindowModule(null)
    super.invalidate()
  }

  // ======================== RN 桥方法 ========================

  /**
   * 显示或更新单个事件的悬浮窗
   * @param content 包含 magnitude / countdown / location / level / eventId 字段
   *
   * 若该 eventId 已存在则更新内容，否则新建 View 并按顺序排列。
   */
  @ReactMethod
  fun show(content: ReadableMap) {
    mainHandler.post {
      try {
        val eventId = safeGetString(content, "eventId", "")
        if (eventId.isEmpty()) {
          emitError("show", "missing eventId")
          return@post
        }
        if (windowEntries.containsKey(eventId)) {
          updateViews(eventId, content)
        } else {
          if (windowEntries.size >= MAX_WINDOWS) {
            emitError("show", "max windows reached: $MAX_WINDOWS")
            return@post
          }
          createFloatingView(eventId, content)
        }
      } catch (e: Exception) {
        emitError("show", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /** 隐藏所有悬浮窗 */
  @ReactMethod
  fun hide() {
    mainHandler.post { removeAllViews() }
  }

  /**
   * 隐藏指定事件的悬浮窗（不影响其他事件）
   * @param eventId 要隐藏的事件 ID
   */
  @ReactMethod
  fun hideOne(eventId: String) {
    mainHandler.post { removeView(eventId) }
  }

  /** 从后台服务直接显示悬浮窗（非 @ReactMethod） */
  fun showFromBackground(content: com.facebook.react.bridge.ReadableMap) {
    show(content)
  }

  /** 从后台服务批量设置事件列表（非 @ReactMethod） */
  fun setEventsFromBackground(arr: com.facebook.react.bridge.ReadableArray) {
    mainHandler.post {
      try {
        val newIds = mutableSetOf<String>()
        val toCreate = mutableListOf<Pair<String, ReadableMap>>()
        val toUpdate = mutableListOf<Pair<String, ReadableMap>>()

        for (i in 0 until arr.size()) {
          val item = arr.getMap(i) ?: continue
          val eventId = safeGetString(item, "eventId", "")
          if (eventId.isEmpty()) continue
          newIds.add(eventId)
          if (windowEntries.containsKey(eventId)) {
            toUpdate.add(eventId to item)
          } else {
            if (windowEntries.size + toCreate.size < MAX_WINDOWS) {
              toCreate.add(eventId to item)
            }
          }
        }

        val toRemove = windowEntries.keys.filter { it !in newIds }
        toRemove.forEach { removeView(it) }
        toUpdate.forEach { (id, content) -> updateViews(id, content) }
        toCreate.forEach { (id, content) -> createFloatingView(id, content) }
        relayoutWindows()
      } catch (e: Exception) {
        emitError("setEventsFromBackground", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /** 更新指定事件的内容（不重建窗口） */
  @ReactMethod
  fun updateContent(content: ReadableMap) {
    mainHandler.post {
      val eventId = safeGetString(content, "eventId", "")
      if (eventId.isEmpty() || !windowEntries.containsKey(eventId)) return@post
      updateViews(eventId, content)
    }
  }

  /**
   * 批量设置显示中的事件列表（替代多次 show/hideOne 调用）
   * @param contentsArr 由 RN 侧排序后的内容数组（最多 3 个）
   *
   * 行为：
   * - 新增 eventId → 创建 View
   * - 已存在 eventId → 更新内容
   * - 不在列表中的已显示 eventId → 移除
   * - 重新排列所有 View 的 y 偏移
   */
  @ReactMethod
  fun setEvents(contentsArr: com.facebook.react.bridge.ReadableArray) {
    mainHandler.post {
      try {
        val newIds = mutableSetOf<String>()
        val toCreate = mutableListOf<Pair<String, ReadableMap>>()
        val toUpdate = mutableListOf<Pair<String, ReadableMap>>()

        // 遍历新列表
        for (i in 0 until contentsArr.size()) {
          val item = contentsArr.getMap(i) ?: continue
          val eventId = safeGetString(item, "eventId", "")
          if (eventId.isEmpty()) continue
          newIds.add(eventId)
          if (windowEntries.containsKey(eventId)) {
            toUpdate.add(eventId to item)
          } else {
            if (windowEntries.size + toCreate.size < MAX_WINDOWS) {
              toCreate.add(eventId to item)
            }
          }
        }

        android.util.Log.i("FloatingWindowModule", "setEvents: total=${contentsArr.size()} newIds=${newIds.size} toCreate=${toCreate.size} toUpdate=${toUpdate.size} existing=${windowEntries.size}")

        // 移除不在新列表中的
        val toRemove = windowEntries.keys.filter { it !in newIds }
        toRemove.forEach { removeView(it) }

        // 更新已存在的
        toUpdate.forEach { (id, content) -> updateViews(id, content) }

        // 创建新的
        toCreate.forEach { (id, content) -> createFloatingView(id, content) }

        // 重新排列所有 View 的 y 偏移
        relayoutWindows()
        android.util.Log.i("FloatingWindowModule", "setEvents done: windowEntries=${windowEntries.size}")
      } catch (e: Exception) {
        emitError("setEvents", e.message ?: e::class.java.simpleName)
      }
    }
  }

  @ReactMethod
  fun hasPermission(promise: Promise) {
    try {
      promise.resolve(Settings.canDrawOverlays(reactContext))
    } catch (e: Exception) {
      promise.reject("PERMISSION_ERROR", "检查悬浮窗权限失败: ${e.message}")
    }
  }

  @ReactMethod
  fun requestPermission(promise: Promise) {
    try {
      if (Settings.canDrawOverlays(reactContext)) {
        promise.resolve(true)
        return
      }
      val activity = getCurrentActivity()
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "当前无 Activity，无法跳转权限设置")
        return
      }
      val intent = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${reactContext.packageName}")
      ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
      activity.startActivity(intent)
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("PERMISSION_ERROR", "跳转悬浮窗权限设置失败: ${e.message}")
    }
  }

  // ======================== View 构建 ========================

  private fun createFloatingView(eventId: String, content: ReadableMap) {
    val ctx: Context = reactContext
    if (windowManager == null) {
      windowManager = ctx.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
    }

    val textColor = intensityToTextColor(content)
    val labelColor = intensityToLabelColor(content)
    val dividerColor = intensityToDividerColor(content)

    val bgDrawable = GradientDrawable().apply {
      setColor(intensityToBgColor(content))
      cornerRadius = dp(ctx, 16).toFloat()
    }

    val container = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      background = bgDrawable
      val padH = dp(ctx, 20)
      val padV = dp(ctx, 42)
      setPadding(padH, padV, padH, padV)
    }

    // 顶行：S 波到达标签 + 关闭按钮
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
      val pad = dp(ctx, 8)
      setPadding(pad, 0, pad, 0)
      setOnClickListener {
        emitClosed(eventId)
        onClosedCallback?.invoke(eventId)
        removeView(eventId)
      }
    }
    topRow.addView(cdLabel)
    topRow.addView(closeBtn)

    val countdownText = TextView(ctx).apply {
      text = formatCountdown(content)
      setTextColor(textColor)
      textSize = 48f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(ctx, 12)
      val padBot = dp(ctx, 12)
      setPadding(0, padTop, 0, padBot)
    }

    val dividerView = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(ctx, 1))
    }

    val bottomRow = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      val padTop = dp(ctx, 30)
      setPadding(0, padTop, 0, 0)
    }

    val magnitudeText = TextView(ctx).apply {
      text = formatMagnitude(content)
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
      gravity = Gravity.CENTER
    }
    val sep1View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(dp(ctx, 1), dp(ctx, 12))
    }
    val locationText = TextView(ctx).apply {
      text = formatLocation(content)
      setTextColor(textColor)
      textSize = 13f
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.4f)
      gravity = Gravity.CENTER
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    val sep2View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(dp(ctx, 1), dp(ctx, 12))
    }
    val levelText = TextView(ctx).apply {
      text = formatLevel(content)
      setTextColor(textColor)
      textSize = 12f
      layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f)
      gravity = Gravity.CENTER
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    bottomRow.addView(magnitudeText)
    bottomRow.addView(sep1View)
    bottomRow.addView(locationText)
    bottomRow.addView(sep2View)
    bottomRow.addView(levelText)

    val infoText = TextView(ctx).apply {
      text = formatInfoLine(content)
      setTextColor(labelColor)
      textSize = 11f
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(ctx, 12)
      setPadding(0, padTop, 0, 0)
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }

    container.addView(topRow)
    container.addView(countdownText)
    container.addView(dividerView)
    container.addView(bottomRow)
    container.addView(infoText)

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP
      y = dp(ctx, WINDOW_TOP_OFFSET_DP)  // 初始 y，relayoutWindows 会按索引重新计算
    }

    try {
      if (windowEntries.isEmpty()) {
        acquireWakeLock()
      }
      windowManager?.addView(container, params)
      val entry = FloatingWindowEntry(
        eventId = eventId,
        rootView = container,
        layoutParams = params,
        magnitudeText = magnitudeText,
        countdownText = countdownText,
        locationText = locationText,
        levelText = levelText,
        infoText = infoText,
        dividerView = dividerView,
        sep1View = sep1View,
        sep2View = sep2View,
      )
      windowEntries[eventId] = entry
      relayoutWindows()
    } catch (e: Exception) {
      if (windowEntries.isEmpty()) {
        releaseWakeLock()
      }
      emitError("createFloatingView", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 重新排列所有悬浮窗的 y 偏移
   * 按当前 windowEntries 顺序，从顶部 WINDOW_TOP_OFFSET_DP 开始，每个悬浮窗紧接上一个底部 + WINDOW_GAP_DP
   */
  private fun relayoutWindows() {
    var currentY = dp(reactContext, WINDOW_TOP_OFFSET_DP)
    for ((id, entry) in windowEntries) {
      try {
        // 测量 View 高度
        entry.rootView.measure(
          View.MeasureSpec.makeMeasureSpec(reactContext.resources.displayMetrics.widthPixels, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        )
        val height = entry.rootView.measuredHeight
        entry.layoutParams.y = currentY
        windowManager?.updateViewLayout(entry.rootView, entry.layoutParams)
        android.util.Log.i("FloatingWindowModule", "relayout: id=$id y=$currentY height=$height")
        currentY += height + dp(reactContext, WINDOW_GAP_DP)
      } catch (e: Exception) {
        android.util.Log.w("FloatingWindowModule", "relayout failed: id=$id ${e.message}")
      }
    }
  }

  private fun updateViews(eventId: String, content: ReadableMap) {
    val entry = windowEntries[eventId] ?: return
    val textColor = intensityToTextColor(content)
    val labelColor = intensityToLabelColor(content)
    val dividerColor = intensityToDividerColor(content)

    entry.magnitudeText.text = formatMagnitude(content)
    entry.magnitudeText.setTextColor(textColor)
    entry.countdownText.text = formatCountdown(content)
    entry.countdownText.setTextColor(textColor)
    entry.locationText.text = formatLocation(content)
    entry.locationText.setTextColor(textColor)
    entry.levelText.text = formatLevel(content)
    entry.levelText.setTextColor(textColor)
    entry.infoText.text = formatInfoLine(content)
    entry.infoText.setTextColor(labelColor)
    entry.dividerView.setBackgroundColor(dividerColor)
    entry.sep1View.setBackgroundColor(dividerColor)
    entry.sep2View.setBackgroundColor(dividerColor)
    (entry.rootView.background as? GradientDrawable)?.setColor(intensityToBgColor(content))
  }

  /** 移除指定事件的悬浮窗 */
  private fun removeView(eventId: String) {
    val entry = windowEntries.remove(eventId) ?: return
    try {
      windowManager?.removeView(entry.rootView)
    } catch (_: Exception) {
      // 忽略重复移除异常
    }
    if (windowEntries.isEmpty()) {
      releaseWakeLock()
    } else {
      relayoutWindows()
    }
  }

  /** 移除所有悬浮窗 */
  private fun removeAllViews() {
    val ids = windowEntries.keys.toList()
    ids.forEach { id ->
      val entry = windowEntries.remove(id)
      try {
        windowManager?.removeView(entry?.rootView)
      } catch (_: Exception) {
        // 忽略
      }
    }
    releaseWakeLock()
  }

  // ======================== WakeLock ========================

  private fun acquireWakeLock() {
    try {
      val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (powerManager == null) return
      releaseWakeLock()
      val lock = powerManager.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
        "EewApp:FloatingWindow"
      )
      lock.acquire(10_000L)
      wakeLock = lock
    } catch (_: Exception) {
      // WakeLock 获取失败不影响悬浮窗显示
    }
  }

  private fun releaseWakeLock() {
    try {
      wakeLock?.let { lock ->
        if (lock.isHeld) {
          lock.release()
        }
      }
    } catch (_: Exception) {
      // 忽略
    }
    wakeLock = null
  }

  // ======================== 颜色与格式化（与原版相同）========================

  private fun intensityToBgColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    if (intensity < 1) return Color.parseColor(BG_COLOR)
    val color = when {
      intensity >= 7 -> "#CCDC2828"
      intensity >= 5 -> "#CCF09614"
      intensity >= 3 -> "#CCFAE600"
      else -> "#CC3764FF"
    }
    return Color.parseColor(color)
  }

  private fun intensityToTextColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    return if (intensity >= 3 && intensity < 5) {
      Color.parseColor("#E6000000")
    } else {
      Color.parseColor(TEXT_COLOR)
    }
  }

  private fun intensityToLabelColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    return if (intensity >= 3 && intensity < 5) {
      Color.parseColor("#99000000")
    } else {
      Color.parseColor(LABEL_COLOR)
    }
  }

  private fun intensityToDividerColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    return if (intensity >= 3 && intensity < 5) {
      Color.parseColor("#33000000")
    } else {
      Color.parseColor("#33FFFFFF")
    }
  }

  private fun formatMagnitude(content: ReadableMap): String {
    val m = safeGetDouble(content, "magnitude", 0.0)
    return "M ${"%.1f".format(m)}"
  }

  private fun formatCountdown(content: ReadableMap): String {
    if (content.hasKey("isCancel") && !content.isNull("isCancel") && content.getBoolean("isCancel")) {
      return "地震预警取消"
    }
    val sec = safeGetDouble(content, "countdown", 0.0).toInt()
    if (sec <= 0) return "地震波已到达"
    return "${sec} 秒"
  }

  private fun formatInfoLine(content: ReadableMap): String {
    val dist = safeGetDouble(content, "epicenterDistance", 0.0)
    val distStr = "震中距 ${"%.1f".format(dist)} km"
    val originTimeMs = safeGetDouble(content, "originTime", 0.0).toLong()
    val timeStr = if (originTimeMs > 0) formatTimestamp(originTimeMs) else "--"
    return "$distStr · $timeStr"
  }

  private fun formatTimestamp(timestampMs: Long): String {
    return try {
      val sdf = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.CHINA)
      sdf.format(java.util.Date(timestampMs))
    } catch (_: Exception) {
      "--"
    }
  }

  private fun safeGetDouble(map: ReadableMap, key: String, default: Double): Double {
    return try {
      if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else default
    } catch (_: Exception) {
      default
    }
  }

  private fun safeGetString(map: ReadableMap, key: String, default: String): String {
    return try {
      if (map.hasKey(key) && !map.isNull(key)) map.getString(key) ?: default else default
    } catch (_: Exception) {
      default
    }
  }

  private fun formatLocation(content: ReadableMap): String {
    val loc = if (content.hasKey("location")) content.getString("location") else null
    return loc ?: "未知位置"
  }

  private fun formatLevel(content: ReadableMap): String {
    val lv = if (content.hasKey("level")) content.getString("level") else null
    val baseText = when (lv) {
      "red" -> "严重破坏"
      "orange" -> "破坏"
      "yellow" -> "强烈有感"
      "blue" -> "有感"
      "silent" -> ""
      else -> ""
    }
    if (baseText.isEmpty()) return ""
    val intensity = safeGetDouble(content, "intensity", 0.0)
    if (intensity <= 0) return baseText
    val intensityStr = if (intensity == intensity.toInt().toDouble()) {
      intensity.toInt().toString()
    } else {
      String.format("%.1f", intensity)
    }
    return "$baseText(预估烈度$intensityStr)"
  }

  // ======================== 事件发送 ========================

  private fun emitError(stage: String, message: String) {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_ERROR, "$stage: $message")
    } catch (_: Exception) {
      // 忽略
    }
  }

  /** 向 RN 端发送悬浮窗关闭事件，携带 eventId */
  private fun emitClosed(eventId: String) {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_CLOSED, eventId)
    } catch (_: Exception) {
      // 忽略
    }
  }

  private fun dp(ctx: Context, value: Int): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      ctx.resources.displayMetrics
    ).toInt()
  }
}
