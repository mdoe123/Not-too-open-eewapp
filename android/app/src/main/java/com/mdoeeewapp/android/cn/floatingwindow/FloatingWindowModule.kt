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
 * 悬浮窗原生模块
 *
 * 提供地震预警悬浮窗的显示、隐藏、内容更新与权限管理能力。
 *
 * 设计要点：
 * - 使用 WindowManager.addView 将悬浮窗叠加到所有应用之上
 * - 悬浮窗 View 用代码构建，不依赖 XML 布局
 * - 宽度填满屏幕（MATCH_PARENT），顶部显示，右上角带关闭按钮
 * - 所有 View 操作通过主线程 Handler 在主线程执行
 * - 黑白简约风格：半透明黑色圆角背景 + 白色文字
 */
class FloatingWindowModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    /** 模块名，对应 RN 侧 NativeModules.FloatingWindowModule */
    const val NAME = "FloatingWindowModule"

    /** RN 事件名：发生错误时向 JS 端发送 */
    const val EVENT_ERROR = "onError"

    /** RN 事件名：悬浮窗被关闭（用户点击关闭按钮或 hide 调用） */
    const val EVENT_CLOSED = "onClosed"

    /** 悬浮窗默认背景色（80% 不透明黑，intensity 缺失/<=0 时回退） */
    private const val BG_COLOR = "#CC000000"

    /** 标签文字色（60% 不透明白） */
    private const val LABEL_COLOR = "#99FFFFFF"

    /** 正文文字色（90% 不透明白） */
    private const val TEXT_COLOR = "#E6FFFFFF"
  }

  /** 主线程 Handler，保证 View 操作在主线程 */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** WindowManager 用于添加/移除悬浮窗 */
  private var windowManager: WindowManager? = null

  /** WakeLock 用于锁屏时唤醒 CPU 并保持屏幕常亮（短暂时间），确保悬浮窗可见 */
  private var wakeLock: PowerManager.WakeLock? = null

  /** 悬浮窗根 View */
  private var floatingView: View? = null

  /** 悬浮窗布局参数 */
  private var layoutParams: WindowManager.LayoutParams? = null

  /** 震级文本视图 */
  private var magnitudeText: TextView? = null

  /** 倒计时文本视图 */
  private var countdownText: TextView? = null

  /** 位置文本视图 */
  private var locationText: TextView? = null

  /** 级别文本视图 */
  private var levelText: TextView? = null

  /** 信息行文本视图（震中距·发震时刻） */
  private var infoText: TextView? = null

  /** 分隔线 View（倒计时与底行之间） */
  private var dividerView: View? = null

  /** 底行分隔竖线 1（震级|位置） */
  private var sep1View: View? = null

  /** 底行分隔竖线 2（位置|级别） */
  private var sep2View: View? = null

  /** 悬浮窗是否已显示 */
  private var isShowing = false

  /**
   * 悬浮窗关闭回调（用户点击关闭按钮时触发）
   *
   * 由 EewBackgroundService 设置，用于停止倒计时 tick。
   * 若未设置则忽略（前台 JS 层通过 onClosed 事件处理）。
   */
  @Volatile
  var onClosedCallback: (() -> Unit)? = null

  init {
    // 将本模块注册到全局提供者，供 EewBackgroundService（非 RN 生命周期）直接调用 showFromBackground()
    // 避免 ReactContext.getNativeModule() 在 stale context 上返回 null 的问题
    ReactContextProvider.setFloatingWindowModule(this)
  }

  override fun getName(): String = NAME

  /**
   * RN 上下文销毁时清理悬浮窗
   * 覆写 invalidate 确保 JS bundle reload / App 销毁时 WindowManager 不残留 View，
   * 避免 Context 泄漏与窗口泄漏。
   */
  override fun invalidate() {
    mainHandler.post {
      removeFloatingView()
    }
    releaseWakeLock()
    // 清除全局引用，避免 EewBackgroundService 持有已失效的模块实例
    ReactContextProvider.setFloatingWindowModule(null)
    super.invalidate()
  }

  /**
   * 显示悬浮窗
   * @param content 包含 magnitude / countdown / location / level 字段
   *
   * 若悬浮窗已存在则仅更新内容，不重建窗口。
   * 任何异常通过 [EVENT_ERROR] 事件回传 RN 端，便于上层降级处理（如改用通知）。
   */
  @ReactMethod
  fun show(content: ReadableMap) {
    mainHandler.post {
      try {
        if (isShowing) {
          updateViews(content)
          return@post
        }
        createFloatingView(content)
      } catch (e: Exception) {
        // 任何异常（类型不匹配、WindowManager 拒绝等）都不应崩溃主线程
        // 清理可能的部分状态，保持 isShowing 一致
        isShowing = false
        emitError("show", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /**
   * 隐藏悬浮窗并释放资源
   */
  @ReactMethod
  fun hide() {
    mainHandler.post {
      removeFloatingView()
    }
  }

  /**
   * 从后台服务直接显示悬浮窗（非 @ReactMethod，供 EewBackgroundService 调用）
   *
   * 与 [show] 功能相同，但不要求通过 RN 桥调用。
   * 后台服务在 App 不在前台时收到地震事件，直接调用此方法显示悬浮窗。
   *
   * @param content 包含 magnitude / countdown / location / level / intensity / epicenterDistance / originTime 字段
   */
  fun showFromBackground(content: com.facebook.react.bridge.ReadableMap) {
    mainHandler.post {
      try {
        if (isShowing) {
          updateViews(content)
          return@post
        }
        createFloatingView(content)
      } catch (e: Exception) {
        isShowing = false
        emitError("showFromBackground", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /**
   * 更新悬浮窗内容（不重建窗口）
   * @param content 新的内容字段
   *
   * 若悬浮窗未显示则忽略。
   */
  @ReactMethod
  fun updateContent(content: ReadableMap) {
    mainHandler.post {
      if (!isShowing) return@post
      updateViews(content)
    }
  }

  /**
   * 检查是否拥有悬浮窗权限（SYSTEM_ALERT_WINDOW）
   * @param promise resolve(true) 表示已授权
   *
   * 注：minSdkVersion = 26（API 26+），Settings.canDrawOverlays 在 API 23+ 即可用，
   * 因此无需版本判断分支。
   */
  @ReactMethod
  fun hasPermission(promise: Promise) {
    try {
      promise.resolve(Settings.canDrawOverlays(reactContext))
    } catch (e: Exception) {
      promise.reject("PERMISSION_ERROR", "检查悬浮窗权限失败: ${e.message}")
    }
  }

  /**
   * 跳转到悬浮窗权限设置页（ACTION_MANAGE_OVERLAY_PERMISSION）
   * @param promise 跳转后 resolve(false)，用户需手动返回 App 后重新检查
   *
   * 若已授权则直接 resolve(true) 不跳转。
   * RN 侧应在 AppState 回到 active 时调用 hasPermission 重新检查。
   */
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
      ).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      // 跳转后用户需手动返回，此时无法立即获知授权结果
      // 由 RN 侧在 AppState active 时重新调用 hasPermission 检查
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("PERMISSION_ERROR", "跳转悬浮窗权限设置失败: ${e.message}")
    }
  }

  // ======================== 悬浮窗 View 构建 ========================

  /**
   * 构建悬浮窗 View 并添加到 WindowManager
   *
   * 新布局结构（垂直 LinearLayout，DB/T 113.1-2026 标准）：
   *   顶行（S波到达标签 左 + ✕关闭按钮 右）
   *   → 倒计时大字居中（48sp BOLD，归零显示"地震波已到达"，取消报显示"地震预警取消"）
   *   → 分隔线
   *   → 底行三段分布（震级 | 位置 | 级别提示）
   *   → 信息行（震中距 N km · 发震时刻 YYYY-MM-DD HH:mm:ss）
   *
   * 宽度填满屏幕（MATCH_PARENT），固定在顶部，不可拖动，通过关闭按钮隐藏。
   * 高度再加 50%（padV 42 / 倒计时 12 / 底行 30）。
   */
  private fun createFloatingView(content: ReadableMap) {
    val ctx: Context = reactContext
    windowManager = ctx.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
      ?: return

    // 颜色按烈度动态计算（黄色背景配黑字，其他配白字）
    val textColor = intensityToTextColor(content)
    val labelColor = intensityToLabelColor(content)
    val dividerColor = intensityToDividerColor(content)

    // 圆角半透明背景（按预估烈度分档着色）
    val bgDrawable = GradientDrawable().apply {
      setColor(intensityToBgColor(content))
      cornerRadius = dp(ctx, 16).toFloat()
    }

    // 容器：垂直布局（高度再加 50%：padV 28→42）
    val container = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      background = bgDrawable
      val padH = dp(ctx, 20)
      val padV = dp(ctx, 42)
      setPadding(padH, padV, padH, padV)
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
      layoutParams = LinearLayout.LayoutParams(
        0,
        LinearLayout.LayoutParams.WRAP_CONTENT,
        1f
      )
    }
    val closeBtn = TextView(ctx).apply {
      text = "✕"
      setTextColor(textColor)
      textSize = 18f
      val pad = dp(ctx, 8)
      setPadding(pad, 0, pad, 0)
      // 点击关闭悬浮窗：先通知 JS 层停止声音/闪光灯，再移除 View
      setOnClickListener {
        emitClosed()
        // 通知原生层关闭回调（EewBackgroundService 停止倒计时 tick）
        onClosedCallback?.invoke()
        removeFloatingView()
      }
    }
    topRow.addView(cdLabel)
    topRow.addView(closeBtn)

    // ---- 倒计时大字（居中，高度再加 50%：padTop/padBot 8→12） ----
    countdownText = TextView(ctx).apply {
      text = formatCountdown(content)
      setTextColor(textColor)
      textSize = 48f
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER_HORIZONTAL
      val padTop = dp(ctx, 12)
      val padBot = dp(ctx, 12)
      setPadding(0, padTop, 0, padBot)
    }

    // ---- 分隔线 ----
    dividerView = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        dp(ctx, 1)
      )
    }

    // ---- 底行：三段分布（震级 | 位置 | 级别提示，高度再加 50%：padTop 20→30） ----
    val bottomRow = LinearLayout(ctx).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      val padTop = dp(ctx, 30)
      setPadding(0, padTop, 0, 0)
    }

    magnitudeText = TextView(ctx).apply {
      text = formatMagnitude(content)
      setTextColor(textColor)
      textSize = 16f
      setTypeface(typeface, Typeface.BOLD)
      layoutParams = LinearLayout.LayoutParams(
        0,
        LinearLayout.LayoutParams.WRAP_CONTENT,
        1f
      )
      gravity = Gravity.CENTER
    }
    sep1View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(
        dp(ctx, 1),
        dp(ctx, 12)
      )
    }
    locationText = TextView(ctx).apply {
      text = formatLocation(content)
      setTextColor(textColor)
      textSize = 13f
      layoutParams = LinearLayout.LayoutParams(
        0,
        LinearLayout.LayoutParams.WRAP_CONTENT,
        1.4f
      )
      gravity = Gravity.CENTER
      // 长文本省略
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    sep2View = View(ctx).apply {
      setBackgroundColor(dividerColor)
      layoutParams = LinearLayout.LayoutParams(
        dp(ctx, 1),
        dp(ctx, 12)
      )
    }
    levelText = TextView(ctx).apply {
      text = formatLevel(content)
      setTextColor(textColor)
      textSize = 12f
      layoutParams = LinearLayout.LayoutParams(
        0,
        LinearLayout.LayoutParams.WRAP_CONTENT,
        1.2f
      )
      gravity = Gravity.CENTER
      maxLines = 1
      ellipsize = android.text.TextUtils.TruncateAt.END
    }
    bottomRow.addView(magnitudeText)
    bottomRow.addView(sep1View)
    bottomRow.addView(locationText)
    bottomRow.addView(sep2View)
    bottomRow.addView(levelText)

    // ---- 信息行：震中距 · 发震时刻 ----
    infoText = TextView(ctx).apply {
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

    // ---- 布局参数 ----
    // minSdkVersion = 26（API 26 = O），统一使用 TYPE_APPLICATION_OVERLAY。
    // 宽度 MATCH_PARENT 填满屏幕，gravity TOP 固定顶部。
    // 锁屏显示：FLAG_SHOW_WHEN_LOCKED（API 27+ 改用 setShowWhenLocked）
    //          FLAG_TURN_SCREEN_ON（点亮屏幕，API 27+ 改用 setTurnScreenOn）
    //          FLAG_KEEP_SCREEN_ON（保持屏幕常亮一段时间供用户阅读）
    //          FLAG_LAYOUT_IN_SCREEN（包含状态栏区域）
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
      y = dp(ctx, 120)
    }

    floatingView = container
    layoutParams = params

    try {
      // 获取 WakeLock 唤醒 CPU 并保持屏幕常亮，确保锁屏时悬浮窗可见
      acquireWakeLock()
      windowManager?.addView(container, params)
      isShowing = true
    } catch (e: Exception) {
      // 可能未授权或 WindowManager 不可用，清理引用
      floatingView = null
      layoutParams = null
      isShowing = false
      releaseWakeLock()
      emitError("createFloatingView", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 获取 WakeLock 唤醒 CPU 并保持屏幕常亮
   *
   * 使用 SCREEN_BRIGHT_WAKE_LOCK（屏幕+CPU 唤醒），10 秒后自动释放。
   * 避免长时间持锁导致电量消耗，用户点击关闭按钮或 hide 时立即释放。
   */
  private fun acquireWakeLock() {
    try {
      val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (powerManager == null) return
      // 先释放已有的 WakeLock
      releaseWakeLock()
      val lock = powerManager.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
        "EewApp:FloatingWindow"
      )
      // 10 秒后自动释放，防止异常情况下长时间持锁
      lock.acquire(10_000L)
      wakeLock = lock
    } catch (_: Exception) {
      // WakeLock 获取失败不影响悬浮窗显示
    }
  }

  /** 释放 WakeLock（如已持有） */
  private fun releaseWakeLock() {
    try {
      wakeLock?.let { lock ->
        if (lock.isHeld) {
          lock.release()
        }
      }
    } catch (_: Exception) {
      // 忽略释放异常
    }
    wakeLock = null
  }

  /**
   * 更新悬浮窗内 TextView 内容、背景色与文字颜色
   */
  private fun updateViews(content: ReadableMap) {
    val textColor = intensityToTextColor(content)
    val labelColor = intensityToLabelColor(content)
    val dividerColor = intensityToDividerColor(content)

    magnitudeText?.let { it.text = formatMagnitude(content); it.setTextColor(textColor) }
    countdownText?.let { it.text = formatCountdown(content); it.setTextColor(textColor) }
    locationText?.let { it.text = formatLocation(content); it.setTextColor(textColor) }
    levelText?.let { it.text = formatLevel(content); it.setTextColor(textColor) }
    infoText?.let { it.text = formatInfoLine(content); it.setTextColor(labelColor) }
    // 分隔线颜色
    dividerView?.setBackgroundColor(dividerColor)
    sep1View?.setBackgroundColor(dividerColor)
    sep2View?.setBackgroundColor(dividerColor)
    // 按预估烈度更新背景色
    (floatingView?.background as? GradientDrawable)?.setColor(intensityToBgColor(content))
  }

  /**
   * 移除悬浮窗并清理所有引用
   */
  private fun removeFloatingView() {
    floatingView?.let { v ->
      try {
        windowManager?.removeView(v)
      } catch (_: Exception) {
        // 忽略重复移除异常
      }
    }
    floatingView = null
    layoutParams = null
    magnitudeText = null
    countdownText = null
    locationText = null
    levelText = null
    infoText = null
    dividerView = null
    sep1View = null
    sep2View = null
    isShowing = false
    // 释放 WakeLock，让屏幕恢复正常熄灭
    releaseWakeLock()
  }

  // ======================== 字段格式化 ========================

  /**
   * 根据预估烈度返回悬浮窗背景色（带 80% 不透明度，保证白字可读）
   *
   * DB/T 113.1-2026 标准分档：
   * - ≥7 度（红）:  RGB(220, 40, 40)
   * - ≥5 度（橙）:  RGB(240, 150, 20)
   * - ≥3 度（黄）:  RGB(250, 230, 0)
   * - ≥1 度（蓝）:  RGB(55, 100, 255)
   * - <1 度:      默认黑色背景
   */
  private fun intensityToBgColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    if (intensity < 1) return Color.parseColor(BG_COLOR)
    val color = when {
      intensity >= 7 -> "#CCDC2828"  // 红 RGB(220,40,40)
      intensity >= 5 -> "#CCF09614"  // 橙 RGB(240,150,20)
      intensity >= 3 -> "#CCFAE600"  // 黄 RGB(250,230,0)
      else -> "#CC3764FF"            // 蓝 RGB(55,100,255)
    }
    return Color.parseColor(color)
  }

  /**
   * 根据预估烈度返回主文字颜色
   *
   * 黄色背景（烈度 3~5）亮度高，配白字对比度不足，改用黑字。
   * 其他背景（蓝/橙/红/默认黑）配白字。
   */
  private fun intensityToTextColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    return if (intensity >= 3 && intensity < 5) {
      Color.parseColor("#E6000000")  // 90% 不透明黑
    } else {
      Color.parseColor(TEXT_COLOR)    // 90% 不透明白
    }
  }

  /**
   * 根据预估烈度返回标签文字色（次要文字，如"S 波到达"、信息行）
   */
  private fun intensityToLabelColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    return if (intensity >= 3 && intensity < 5) {
      Color.parseColor("#99000000")  // 60% 不透明黑
    } else {
      Color.parseColor(LABEL_COLOR)  // 60% 不透明白
    }
  }

  /**
   * 根据预估烈度返回分隔线颜色
   */
  private fun intensityToDividerColor(content: ReadableMap): Int {
    val intensity = safeGetDouble(content, "intensity", 0.0)
    return if (intensity >= 3 && intensity < 5) {
      Color.parseColor("#33000000")  // 20% 不透明黑
    } else {
      Color.parseColor("#33FFFFFF")  // 20% 不透明白
    }
  }

  /**
   * 格式化震级为 "M 5.8"
   * 安全读取：hasKey + isNull + 类型校验，避免 RN 侧误传类型导致主线程崩溃
   */
  private fun formatMagnitude(content: ReadableMap): String {
    val m = safeGetDouble(content, "magnitude", 0.0)
    return "M ${"%.1f".format(m)}"
  }

  /**
   * 格式化倒计时显示
   *
   * 显示规则：
   * 1. 取消报（isCancel=true）显示"地震预警取消"
   * 2. 倒计时归零（S 波已到达）显示"地震波已到达"
   * 3. 正常倒计时显示"N 秒"
   */
  private fun formatCountdown(content: ReadableMap): String {
    // 取消报优先
    if (content.hasKey("isCancel") && !content.isNull("isCancel") && content.getBoolean("isCancel")) {
      return "地震预警取消"
    }
    val sec = safeGetDouble(content, "countdown", 0.0).toInt()
    if (sec <= 0) return "地震波已到达"
    return "${sec} 秒"
  }

  /**
   * 格式化信息行：震中距 · 发震时刻
   * 示例："震中距 128.5 km · 2026-07-17 15:30:00"
   */
  private fun formatInfoLine(content: ReadableMap): String {
    val dist = safeGetDouble(content, "epicenterDistance", 0.0)
    val distStr = "震中距 ${"%.1f".format(dist)} km"
    val originTimeMs = safeGetDouble(content, "originTime", 0.0).toLong()
    val timeStr = if (originTimeMs > 0) formatTimestamp(originTimeMs) else "--"
    return "$distStr · $timeStr"
  }

  /**
   * 格式化 Unix 毫秒时间戳为 "YYYY-MM-DD HH:mm:ss"
   * 对非法时间戳返回 "--"
   */
  private fun formatTimestamp(timestampMs: Long): String {
    return try {
      val sdf = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.CHINA)
      sdf.format(java.util.Date(timestampMs))
    } catch (_: Exception) {
      "--"
    }
  }

  /**
   * 安全读取 ReadableMap 的 Double 字段
   * 任意异常（类型不符、null 等）返回默认值，不抛出
   */
  private fun safeGetDouble(map: ReadableMap, key: String, default: Double): Double {
    return try {
      if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else default
    } catch (_: Exception) {
      default
    }
  }

  /**
   * 读取位置文本，缺失时返回默认值
   */
  private fun formatLocation(content: ReadableMap): String {
    val loc = if (content.hasKey("location")) content.getString("location") else null
    return loc ?: "未知位置"
  }

  /**
   * 将 AlertLevel 英文标识映射为 DB/T 113.1-2026 标准提示文字
   * 并在文字后附上预估烈度数值，如"严重破坏(预估烈度9.0)"
   *
   * 标准：
   * - red:    严重破坏（烈度 ≥ 7）
   * - orange: 破坏    （烈度 ≥ 5）
   * - yellow: 强烈有感（烈度 ≥ 3）
   * - blue:   有感    （烈度 ≥ 1）
   */
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
    // 附加预估烈度数值，如"严重破坏(预估烈度9.0)"
    val intensity = safeGetDouble(content, "intensity", 0.0)
    if (intensity <= 0) return baseText
    // 烈度保留一位小数
    val intensityStr = if (intensity == intensity.toInt().toDouble()) {
      intensity.toInt().toString()
    } else {
      String.format("%.1f", intensity)
    }
    return "$baseText(预估烈度$intensityStr)"
  }

  /**
   * 向 RN 端发送错误事件
   *
   * 用于在 show / createFloatingView 等无 Promise 入参的方法中将异常回传 JS 端，
   * 便于上层降级（如改用通知或 toast）。
   *
   * @param stage 错误发生阶段（如 "show" / "createFloatingView"）
   * @param message 异常消息
   */
  private fun emitError(stage: String, message: String) {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_ERROR, "$stage: $message")
    } catch (_: Exception) {
      // RN 上下文不可用时忽略，避免在清理过程中二次抛出
    }
  }

  /** 向 RN 端发送悬浮窗关闭事件（用户点击关闭按钮） */
  private fun emitClosed() {
    try {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_CLOSED, "closed")
    } catch (_: Exception) {
      // RN 上下文不可用时忽略
    }
  }

  /** dp 转 px */
  private fun dp(ctx: Context, value: Int): Int {
    return TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP,
      value.toFloat(),
      ctx.resources.displayMetrics
    ).toInt()
  }
}
