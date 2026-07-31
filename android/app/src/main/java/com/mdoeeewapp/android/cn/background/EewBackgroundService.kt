package com.mdoeeewapp.android.cn.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.app.KeyguardManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableNativeMap
import com.mdoeeewapp.android.cn.floatingwindow.LockScreenAlertActivity
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * 地震预警后台保活服务（完整锁屏预警版）
 *
 * 在原有 ForegroundService 保活基础上新增：
 * 1. **customSource 数据接收**：按用户配置的 customSource 连接 WebSocket 或 HTTP 轮询
 * 2. **后台触发悬浮窗**：App 不在前台时（锁屏/后台），收到事件并满足触发条件时
 *    直接调用 LockScreenAlertActivity 显示锁屏预警
 * 3. **事件转发给 JS**：通过 DeviceEventEmitter 将事件转发给 RN 层（JS 还活着时）
 * 4. **配置存储**：通过 SharedPreferences 存储 alert/位置/customSource 配置
 * 5. **前后台检测**：通过 ComponentCallbacks2.onTrimMemory 检测 App 进入后台
 *
 * 触发条件（必须全部满足）：
 * - alert.lockScreenEnabled == true
 * - alert.floatingWindowEnabled == true
 * - 事件震级 >= alert.minMagnitude
 * - 计算预估烈度 >= alert.lockScreenIntensity
 * - App 不在前台（避免与 JS 层重复触发）
 *
 * 注意：当 App 在前台时，由 JS 层 useFloatingWindow 处理（保留现有逻辑）。
 */
class EewBackgroundService : Service() {

  companion object {
    private const val TAG = "EewBackgroundService"
    private const val CHANNEL_ID = "eew_service"
    private const val CHANNEL_NAME = "地震预警服务"
    private const val NOTIFICATION_ID = 1
    private const val NOTIFICATION_CONTENT = "持续接收预警数据"

    /** fullScreenIntent 通知渠道 ID（独立高优先级渠道，用于锁屏预警 Activity 启动） */
    private const val FULL_SCREEN_INTENT_CHANNEL_ID = "eew_full_screen_alert"

    /** fullScreenIntent 通知 ID（与保活通知区分，避免互相覆盖） */
  private const val FULL_SCREEN_INTENT_NOTIF_ID = 2

  /** 消息通知渠道 ID（系统通知栏，eew+eqlist 事件消息提示） */
  private const val MSG_CHANNEL_ID = "eew_message"
  private const val MSG_CHANNEL_NAME = "地震消息通知"
  /** 消息通知 ID（所有消息通知共用一个 ID，新通知覆盖旧通知） */
  private const val MSG_NOTIF_ID = 3

    /** SharedPreferences 文件名 */
    private const val PREFS_NAME = "eew_alert_config"

    /** SharedPreferences 键：所有活跃 customSource 配置列表（JSON 数组字符串） */
    private const val KEY_CUSTOM_SOURCES = "customSources"

    /** RN 事件名：转发 EEW 事件给 JS 层 */
    private const val EVENT_EEW_EVENT = "onEewEvent"

    /** RN 事件名：WebSocket/HTTP 连接状态变化 */
    private const val EVENT_WS_STATUS = "onWsStatus"

    /**
     * 测试预警广播 action（供 ADB 触发锁屏预警测试）
     * 用法：adb shell am broadcast -a com.mdoeeewapp.android.cn.TEST_ALERT \
     *        --es magnitude 6.0 --es depth 15 --es lat 40.0 --es lng 116.0 --ez forceTrigger true
     */
    const val ACTION_TEST_ALERT = "com.mdoeeewapp.android.cn.TEST_ALERT"

    /** 倒计时归零后警报继续的秒数（与 JS 层 ALERT_CONTINUE_AFTER_ARRIVAL_SEC 一致） */
    private const val ALERT_CONTINUE_AFTER_ARRIVAL_SEC = -30

    /** 新事件 S 波到达超过此秒数不处理（解决重启 App 误触发旧事件） */
    private const val MAX_PAST_ARRIVAL_FOR_NEW_EVENT_SEC = -60

    /** 前台心跳超时（毫秒），超过此时间未收到 JS 心跳则认为 JS 线程已死 */
    private const val FOREGROUND_HEARTBEAT_TIMEOUT_MS = 3_000L

    /** 并列事件与顶级事件的最大级别差（0 = 同级别才算并列，差 ≥ 1 档算大小关系） */
    private const val PEER_LEVEL_MAX_DIFF = 0

    /** 最大同时显示的悬浮窗数量 */
    private const val MAX_DISPLAY_EVENTS = 3

    /** 去重 key 集合容量上限（覆盖多源并行 + eqlist 列表场景） */
    private const val MAX_DEDUP_KEYS = 200

    /** 启动幂等标志，防止重复触发 startForeground */
    private val started = AtomicBoolean(false)

    /**
     * 当前 App 是否在前台
     * 通过 ComponentCallbacks2.onTrimMemory 检测：
     * - TRIM_MEMORY_UI_HIDDEN → App 进入后台
     * - 其他级别 → App 在前台或内存压力
     */
    @Volatile
    private var appInForeground: Boolean = true

    /**
     * 前台心跳时间戳（Unix 毫秒）
     *
     * JS 层每次调用 [notifyAppInForeground] 时更新。
     * 用于检测 JS 线程是否存活：若超过 [FOREGROUND_HEARTBEAT_TIMEOUT_MS] 未更新，
     * 认为 JS 已死，[appInForeground] 降级为 false，由原生层接管预警触发。
     */
    @Volatile
    private var lastForegroundHeartbeatMs: Long = 0L

    /**
     * 当前活跃的 EewBackgroundService 实例（供 BackgroundServiceModule 调用）
     */
    @Volatile
    var instance: EewBackgroundService? = null
  }

  /** 主线程 Handler */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** OkHttpClient（懒加载，第一次连接时初始化，所有源共享） */
  private var httpClient: OkHttpClient? = null

  /**
   * 所有活跃 customSource 配置列表（从 SharedPreferences 读取）
   *
   * 多源并行模式：与 JS 层 useEewStream 对齐，支持同时连接多个 eew 数据源。
   */
  private var sourceConfigs: List<CustomSourceConfig> = emptyList()

  /**
   * 所有源连接实例（按 endpoint 索引，与 JS 层 getSourceKey 对齐）
   *
   * key = endpoint（小写），value = SourceConnection（封装 WS/HTTP 连接和重连）
   */
  private val sourceConnections: MutableMap<String, SourceConnection> = mutableMapOf()

  /**
   * 最近处理过的去重 key 集合（eventId:reportId 或 eventId:cancel）。
   *
   * 多源并行模式下，单值 lastDedupKey 会被不同源互相覆盖导致循环发通知：
   * 源A处理→key=A，源B处理→key=B（B≠A 发通知），源A再次轮询→key=A（A≠B 又发通知）...
   *
   * 改为带容量上限的 LinkedHashSet，记住最近处理过的所有 key，避免多源间互相覆盖。
   * 容量上限 MAX_DEDUP_KEYS，超出时移除最旧条目（FIFO）。
   */
  private val recentDedupKeys: LinkedHashSet<String> = object : LinkedHashSet<String>() {
    override fun add(element: String): Boolean {
      val added = super.add(element)
      while (size > MAX_DEDUP_KEYS) {
        val it = iterator()
        if (it.hasNext()) { it.next(); it.remove() } else break
      }
      return added
    }
  }

  /**
   * 已触发过悬浮窗的事件 ID（仅 eventId，不包含 originTime）。
   *
   * 用于独立去重"触发悬浮窗"动作：同一个事件在前台时不触发，
   * 切到后台后仍可触发一次（只要未过期）。触发后标记，避免重复触发。
   *
   * 改为 Set 支持多事件去重。JS 层通过 markEventTriggered 通知已处理的事件 ID。
   */
  private val triggeredEventIds: MutableSet<String> = mutableSetOf()

  /**
   * 用户已手动关闭的后台悬浮窗事件 ID 集合。
   *
   * 用户点击✕关闭后台悬浮窗后，该事件 ID 被记录于此。
   * 后续同 ID 新报告到来时，不再重新弹出悬浮窗（用户已明确表示不需要此事件）。
   * 当事件自然过期（倒计时结束 + 30秒）或收到取消报时，从集合中移除。
   */
  private val userDismissedEventIds: MutableSet<String> = mutableSetOf()

  /** ComponentCallbacks2 用于检测 App 前后台切换 */
  private var componentCallbacks: ComponentCallbacks2? = null

  /** 测试预警广播接收器（供 ADB 触发锁屏预警测试） */
  private var testAlertReceiver: BroadcastReceiver? = null

  /** 锁屏状态广播接收器（监听 SCREEN_OFF / USER_PRESENT） */
  private var screenStateReceiver: BroadcastReceiver? = null

  override fun onCreate() {
    super.onCreate()
    Log.i(TAG, "EewBackgroundService onCreate")
    instance = this
    createNotificationChannel()
    registerComponentCallbacks()
    registerScreenStateReceiver()
    registerTestAlertReceiver()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.i(TAG, "EewBackgroundService onStartCommand")
    // 幂等启动前台服务
    if (started.compareAndSet(false, true)) {
      startForeground(NOTIFICATION_ID, buildNotification())
    } else {
      try {
        startForeground(NOTIFICATION_ID, buildNotification())
      } catch (_: Exception) {
        // 忽略重复 startForeground 异常
      }
    }
    // 初始化前台心跳时间戳（避免刚启动时因心跳为 0 被误判为超时）
    lastForegroundHeartbeatMs = System.currentTimeMillis()
    // 读取 customSource 配置列表并启动所有连接
    reloadCustomSources()
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? {
    return null
  }

  override fun onDestroy() {
    Log.i(TAG, "EewBackgroundService onDestroy")
    stopConnection()
    stopBackgroundFloatingWindowTick()
    stopAlertsFromBackground()
    backgroundEvents.clear()
    unregisterComponentCallbacks()
    unregisterScreenStateReceiver()
    unregisterTestAlertReceiver()
    started.set(false)
    instance = null
    super.onDestroy()
  }

  // ======================== customSource 配置加载 ========================

  /**
   * 重新加载 customSource 配置列表并重连所有源
   *
   * 由以下场景调用：
   * - onStartCommand：服务启动时
   * - BackgroundServiceModule.updateCustomSourcesJson：JS 层配置变化时
   *
   * 行为：
   * 1. 停止所有现有连接（WS/HTTP）
   * 2. 从 SharedPreferences 读取 customSources JSON 数组
   * 3. 解析为 [List<CustomSourceConfig>]
   * 4. 为每个源创建 [SourceConnection] 并启动 WS 或 HTTP 轮询
   */
  fun reloadCustomSources() {
    stopConnection()
    val configs = readCustomSourceConfigs()
    sourceConfigs = configs
    if (configs.isEmpty()) {
      Log.i(TAG, "无 customSources 配置，不建立连接")
      emitWsStatus("disconnected", "未配置数据源")
      return
    }
    Log.i(TAG, "活跃 customSources 数量: ${configs.size}")
    for (config in configs) {
      Log.i(TAG, "启动源: name=${config.name} protocol=${config.protocol} endpoint=${config.endpoint} priority=${config.priority}")
      val conn = SourceConnection(config)
      val key = getSourceKey(config)
      sourceConnections[key] = conn
      conn.start()
    }
  }

  /**
   * 更新 customSources 配置并重连（由 RN 层调用）
   *
   * 由 [BackgroundServiceModule.updateCustomSourcesJson] 调用：
   * 1. 将 JSON 数组字符串写入 SharedPreferences（KEY_CUSTOM_SOURCES）
   * 2. 调用 [reloadCustomSources] 停止旧连接并按新配置重连
   *
   * @param sourcesJson 多源配置 JSON 数组字符串，传 null 或空字符串清空所有连接
   */
  fun updateCustomSourcesJson(sourcesJson: String?) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (sourcesJson.isNullOrEmpty()) {
      prefs.remove(KEY_CUSTOM_SOURCES)
    } else {
      prefs.putString(KEY_CUSTOM_SOURCES, sourcesJson)
    }
    prefs.apply()
    Log.i(TAG, "customSources 配置已更新，开始重连")
    reloadCustomSources()
  }

  /**
   * 生成数据源在 sourceConnections 中的唯一 key
   *
   * 与 JS 层 getSourceKey 对齐：endpoint 小写（endpoint 大小写不敏感）
   */
  private fun getSourceKey(config: CustomSourceConfig): String {
    return config.endpoint.lowercase()
  }

  /**
   * 从 SharedPreferences 读取 customSources 并解析为 [List<CustomSourceConfig>]
   *
   * 兼容旧版单源配置（activeCustomSource 键）：若新键不存在但旧键存在，按单源解析。
   *
   * @returns 配置列表，无配置或解析失败返回空列表
   */
  private fun readCustomSourceConfigs(): List<CustomSourceConfig> {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(KEY_CUSTOM_SOURCES, null)
    if (json.isNullOrEmpty()) {
      // 兼容旧版单源键 activeCustomSource（已弃用，仅用于平滑升级）
      val legacyJson = prefs.getString("activeCustomSource", null) ?: return emptyList()
      val single = parseSingleSourceConfig(legacyJson) ?: return emptyList()
      return listOf(single)
    }
    return try {
      val arr = org.json.JSONArray(json)
      val result = mutableListOf<CustomSourceConfig>()
      for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        val config = parseSourceConfigFromJson(obj) ?: continue
        result.add(config)
      }
      result
    } catch (e: Exception) {
      Log.e(TAG, "解析 customSources 失败: ${e.message}")
      emptyList()
    }
  }

  /** 从 JSON 对象解析单个 [CustomSourceConfig] */
  private fun parseSingleSourceConfig(json: String): CustomSourceConfig? {
    return try {
      val obj = JSONObject(json)
      parseSourceConfigFromJson(obj)
    } catch (e: Exception) {
      Log.e(TAG, "解析单源配置失败: ${e.message}")
      null
    }
  }

  /** 从 JSONObject 解析 [CustomSourceConfig]（共用逻辑） */
  private fun parseSourceConfigFromJson(obj: JSONObject): CustomSourceConfig? {
    val fmObj = obj.optJSONObject("fieldMapping") ?: return null
    val mapping = FieldMapping(
      listPath = fmObj.optString("listPath", "").ifEmpty { null },
      eventId = fmObj.optString("eventId", ""),
      originTime = fmObj.optString("originTime", ""),
      magnitude = fmObj.optString("magnitude", ""),
      depth = fmObj.optString("depth", ""),
      lat = fmObj.optString("lat", ""),
      lng = fmObj.optString("lng", ""),
      location = fmObj.optString("location", ""),
      intensity = fmObj.optString("intensity", "").ifEmpty { null },
      isFinal = fmObj.optString("isFinal", "").ifEmpty { null },
      isCancel = fmObj.optString("isCancel", "").ifEmpty { null },
      reportNum = fmObj.optString("reportNum", "").ifEmpty { null },
      reportType = fmObj.optString("reportType", "").ifEmpty { null },
    )
    // 必填字段校验
    if (mapping.eventId.isEmpty() || mapping.originTime.isEmpty() ||
        mapping.magnitude.isEmpty() || mapping.depth.isEmpty() ||
        mapping.lat.isEmpty() || mapping.lng.isEmpty() ||
        mapping.location.isEmpty()) {
      Log.e(TAG, "fieldMapping 必填字段缺失")
      return null
    }
    return CustomSourceConfig(
      name = obj.optString("name", "customSource"),
      endpoint = obj.optString("endpoint", ""),
      protocol = obj.optString("protocol", "ws"),
      authToken = obj.optString("authToken", "").ifEmpty { null },
      wsAuthMessage = obj.optString("wsAuthMessage", "").ifEmpty { null },
      heartbeatKeyword = obj.optString("heartbeatKeyword", "").ifEmpty { null },
      pollIntervalMs = obj.optLong("pollIntervalMs", 30_000L),
      fieldMapping = mapping,
      priority = obj.optInt("priority", 0),
      category = obj.optString("category", "eew"),
    )
  }

  // ======================== 停止连接 ========================

  /**
   * 停止所有源连接（WS + HTTP 轮询）
   *
   * 用于 [reloadCustomSources] 重连前清理、[onDestroy] 服务销毁时释放资源。
   * 遍历 [sourceConnections] 调用每个 [SourceConnection.stop]，然后清空 Map。
   */
  private fun stopConnection() {
    for ((key, conn) in sourceConnections) {
      Log.i(TAG, "停止源连接: $key")
      conn.stop()
    }
    sourceConnections.clear()
  }

  // ======================== 事件处理 ========================

  /**
   * 处理 WS/HTTP 收到的数据
   *
   * 1. 按 fieldMapping 解析为 [ParsedCencEvent]
   * 2. 去重（同 eventId + reportId 不重复处理）
   * 3. 转发给 JS 层（通过 DeviceEventEmitter）
   * 4. 如果 App 不在前台，判断触发条件并启动 LockScreenAlertActivity
   *
   * @param text 原始数据文本（JSON）
   * @param config 数据源配置（由 [SourceConnection] 传入，用于字段映射和事件 id 前缀）
   */
  private fun handleSourceData(text: String, config: CustomSourceConfig) {
    val event = EewAlertEngine.parseWithMapping(text, config.fieldMapping) ?: return
    Log.i(TAG, "收到事件 eventId=${event.eventId} mag=${event.magnitude} cancel=${event.isCancel} appInForeground=$appInForeground originTime=${event.originTime} source=${config.name}")

    // 转发去重（取消报独立去重）：同一报告不重复转发给 JS 层
    // 使用 LinkedHashSet 记住最近处理过的所有 key，避免多源并行时单值被互相覆盖导致循环发通知
    val dedupKey = if (event.isCancel) "${event.eventId}:cancel" else "${event.eventId}:${event.originTime}"
    val isNewReport = !recentDedupKeys.contains(dedupKey)
    Log.i(TAG, "去重检查: dedupKey=$dedupKey isNewReport=$isNewReport recentSize=${recentDedupKeys.size} category=${config.category}")
    if (isNewReport) {
      recentDedupKeys.add(dedupKey)
      // 转发给 JS 层（仅新报告转发）
      emitEewEvent(event, config)
      // 发送系统消息通知（不受阈值影响，eew+eqlist 均发送）
      if (!event.isCancel) {
        sendEventNotification(event, config.name, config.category)
      }
    }

    // 取消报：不触发悬浮窗（JS 层处理显示"地震预警取消"）
    if (event.isCancel) {
      // 清理已关闭记录（事件已取消，后续无需再屏蔽）
      userDismissedEventIds.remove(event.eventId)
      triggeredEventIds.remove(event.eventId)
      if (isNewReport) Log.i(TAG, "取消报，不触发悬浮窗")
      return
    }

    // eqlist 速报事件：只发通知，不触发悬浮窗/锁屏预警
    if (config.category == "eqlist") {
      if (isNewReport) Log.i(TAG, "eqlist 速报事件，仅通知不弹窗")
      return
    }

    // S 波到达超过 60 秒的新事件不处理（解决重启 App 误触发旧事件）
    // 仅对 backgroundEvents 中不存在的新事件检查，已在队列中的事件不受影响
    val isNewEvent = !backgroundEvents.containsKey(event.eventId)
    if (isNewEvent) {
      val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val userLat = prefs.getFloat("userLat", 39.9f).toDouble()
      val userLng = prefs.getFloat("userLng", 116.4f).toDouble()
      val arrivalMs = EewAlertEngine.computeSWaveArrivalMs(
        event.originTime, event.lat, event.lng, userLat, userLng
      )
      val remainSec = ((arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()
      if (remainSec < MAX_PAST_ARRIVAL_FOR_NEW_EVENT_SEC) {
        Log.i(TAG, "新事件 S 波已到达超过 60 秒（remain=${remainSec}s），丢弃不处理")
        return
      }
    }

    // 如果 App 在前台，由 JS 层 useFloatingWindow 处理（避免重复触发）
    // 但需检查心跳超时：若 JS 长时间未发心跳，可能已死，由原生层接管
    if (appInForeground) {
      val heartbeatStale = if (lastForegroundHeartbeatMs == 0L) false
        else System.currentTimeMillis() - lastForegroundHeartbeatMs > FOREGROUND_HEARTBEAT_TIMEOUT_MS
      if (!heartbeatStale) {
        // JS 活着，委托给 JS
        triggeredEventIds.add(event.eventId)
        if (isNewReport) Log.i(TAG, "App 在前台，由 JS 层处理悬浮窗")
        return
      }
      // 心跳超时，JS 可能已死，原生层接管
      Log.w(TAG, "前台心跳超时（${(System.currentTimeMillis() - lastForegroundHeartbeatMs) / 1000}s），JS 可能已死，原生层接管")
      appInForeground = false
    }

    // 触发去重：同一 eventId 只触发一次警报（避免重复启动声音/震动/闪光灯）
    // 但仍需更新数据到已显示的悬浮窗/锁屏（同 ID 报告升级场景）
    if (triggeredEventIds.contains(event.eventId)) {
      Log.i(TAG, "事件 ${event.eventId} 已触发过警报，尝试更新已显示的 UI")
      updateDisplayedEvent(event, config.name)
      return
    }

    // App 不在前台，检查触发条件并触发悬浮窗
    Log.i(TAG, "App 在后台，开始检查触发条件: appInForeground=$appInForeground eventId=${event.eventId}")
    if (tryTriggerFloatingWindow(event, config.name)) {
      triggeredEventIds.add(event.eventId)
    }
  }

  /**
   * 更新已显示的悬浮窗/锁屏 UI（同 ID 报告升级时调用）
   *
   * 不重新触发声音/震动/闪光灯警报（已由首次触发启动），
   * 仅更新事件数据（震级、烈度、级别等）到已显示的 UI。
   *
   * - 锁屏 Activity 在运行 → 调用 addEvent 更新（addEvent 已支持同 ID 更新）
   * - 后台悬浮窗在显示 → 更新 backgroundEvents 并刷新显示
   * - 两者都未显示 → 忽略（不应发生，但防御性处理）
   *
   * @param event 解析后的事件
   * @param sourceName 数据源名称（用于锁屏/悬浮窗显示）
   */
  private fun updateDisplayedEvent(event: ParsedCencEvent, sourceName: String?) {
    // 用户已手动关闭此事件的后台悬浮窗 → 不再重新弹出
    if (userDismissedEventIds.contains(event.eventId)) {
      Log.i(TAG, "事件 ${event.eventId} 已被用户关闭，跳过更新")
      return
    }

    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val userLat = prefs.getFloat("userLat", 39.9f).toDouble()
    val userLng = prefs.getFloat("userLng", 116.4f).toDouble()
    val distance = EewAlertEngine.haversineDistance(event.lat, event.lng, userLat, userLng)
    val intensity = EewAlertEngine.calcCsis(event.magnitude, event.depth, distance)
    val alertLevel = EewAlertEngine.computeAlertLevelByIntensity(intensity)
    val arrivalMs = EewAlertEngine.computeSWaveArrivalMs(
      event.originTime, event.lat, event.lng, userLat, userLng
    )

    // 锁屏 Activity 在运行 → 更新锁屏
    if (LockScreenAlertActivity.isRunning()) {
      val eventData = LockScreenAlertActivity.LockScreenEvent(
        eventId = event.eventId,
        magnitude = event.magnitude,
        depth = event.depth,
        intensity = intensity,
        distance = distance,
        location = event.location,
        alertLevel = alertLevel,
        originTime = event.originTime,
        arrivalMs = arrivalMs,
        reportNum = event.reportNum,
        sourceName = sourceName,
      )
      LockScreenAlertActivity.instance?.addEvent(eventData)
      Log.i(TAG, "更新锁屏事件: eventId=${event.eventId} mag=${event.magnitude} intensity=$intensity level=$alertLevel")
      return
    }

    // 屏幕已锁屏但 Activity 未运行 → 启动锁屏 Activity
    // 场景：之前在后台显示悬浮窗，屏幕随后锁屏，同 ID 新报告到来时应切换到锁屏 Activity
    if (isScreenLocked()) {
      Log.i(TAG, "屏幕已锁屏但 Activity 未运行，启动锁屏 Activity: eventId=${event.eventId}")
      startLockScreenActivity(event, intensity, distance, alertLevel, arrivalMs, sourceName)
      return
    }

    // 后台悬浮窗在显示 → 更新 backgroundEvents 并刷新
    if (backgroundEvents.containsKey(event.eventId)) {
      val bgEvent = BackgroundEvent(event, intensity, distance, alertLevel, arrivalMs, sourceName)
      // 保留旧的 arrived/alertsStopped 状态
      val old = backgroundEvents[event.eventId]
      if (old != null) {
        bgEvent.arrived = old.arrived
        bgEvent.alertsStopped = old.alertsStopped
      }
      backgroundEvents[event.eventId] = bgEvent
      refreshBackgroundFloatingWindows()
      Log.i(TAG, "更新后台悬浮窗事件: eventId=${event.eventId} mag=${event.magnitude} intensity=$intensity level=$alertLevel")
      return
    }

    // 既不在锁屏也不在后台悬浮窗（如 App 从前台切到后台后首次收到同 ID 新报告）
    // → 添加到后台悬浮窗队列并显示
    Log.i(TAG, "事件 ${event.eventId} 未在任何显示中，添加到后台悬浮窗: intensity=$intensity level=$alertLevel")
    showFloatingWindowFromBackground(event, intensity, distance, alertLevel, arrivalMs, sourceName)
  }

  /**
   * 标记事件为用户已关闭（供 LockScreenAlertActivity 调用）
   *
   * 用户在锁屏界面关闭某事件后，后续同 ID 新报告不再重新弹出后台悬浮窗。
   */
  fun markUserDismissed(eventId: String) {
    userDismissedEventIds.add(eventId)
    // 同步从后台悬浮窗队列移除，避免锁屏关闭后后台 tick 仍显示该事件悬浮窗
    backgroundEvents.remove(eventId)
    Log.i(TAG, "标记事件 $eventId 为用户已关闭（来自锁屏界面），已从后台队列移除")
  }

  /**
   * 检查触发条件并触发悬浮窗（App 不在前台时调用）
   *
   * 触发条件：
   * - alert.lockScreenEnabled == true
   * - alert.floatingWindowEnabled == true
   * - 事件震级 >= alert.minMagnitude
   * - 计算预估烈度 >= alert.lockScreenIntensity
   *
   * @param event 解析后的事件
   * @param sourceName 数据源名称（用于锁屏/悬浮窗显示）
   */
  private fun tryTriggerFloatingWindow(event: ParsedCencEvent, sourceName: String?): Boolean {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    val lockScreenEnabled = prefs.getBoolean("lockScreenEnabled", true)
    val floatingWindowEnabled = prefs.getBoolean("floatingWindowEnabled", true)
    // 按屏幕状态分别检查：锁屏时需要 lockScreenEnabled，未锁屏时需要 floatingWindowEnabled
    // 两者都关闭才跳过（避免用户关闭锁屏但保留悬浮窗时后台也不弹窗的 bug）
    val screenLocked = isScreenLocked()
    if (screenLocked && !lockScreenEnabled) {
      Log.i(TAG, "跳过触发: 锁屏状态下 lockScreenEnabled=false")
      return false
    }
    if (!screenLocked && !floatingWindowEnabled) {
      Log.i(TAG, "跳过触发: 未锁屏状态下 floatingWindowEnabled=false")
      return false
    }
    if (!lockScreenEnabled && !floatingWindowEnabled) {
      Log.i(TAG, "跳过触发: lockScreenEnabled 和 floatingWindowEnabled 均为 false")
      return false
    }

    val minMagnitude = prefs.getFloat("minMagnitude", 3.0f).toDouble()
    if (event.magnitude < minMagnitude) {
      Log.i(TAG, "跳过触发: 震级 ${event.magnitude} < $minMagnitude")
      return false
    }

    val lockScreenIntensity = prefs.getFloat("lockScreenIntensity", 4.0f).toDouble()
    val userLat = prefs.getFloat("userLat", 39.9f).toDouble()
    val userLng = prefs.getFloat("userLng", 116.4f).toDouble()

    val distance = EewAlertEngine.haversineDistance(event.lat, event.lng, userLat, userLng)
    val intensity = EewAlertEngine.calcCsis(event.magnitude, event.depth, distance)

    if (intensity < lockScreenIntensity) {
      Log.i(TAG, "跳过触发: 烈度 $intensity < $lockScreenIntensity (mag=${event.magnitude} depth=${event.depth} distance=${distance}km userLat=$userLat userLng=$userLng evtLat=${event.lat} evtLng=${event.lng})")
      return false
    }

    val alertLevel = EewAlertEngine.computeAlertLevelByIntensity(intensity)
    if (alertLevel == EewAlertEngine.LEVEL_SILENT) {
      Log.i(TAG, "跳过触发: 预警级别 silent (intensity=$intensity)")
      return false
    }

    // 计算 S 波到达时间（使用真实 arrivalMs，不保底）
    val arrivalMs = EewAlertEngine.computeSWaveArrivalMs(
      event.originTime, event.lat, event.lng, userLat, userLng
    )
    val remainSec = ((arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()

    Log.i(TAG, "触发预警: mag=${event.magnitude} intensity=$intensity level=$alertLevel remain=${remainSec}s distance=${distance}km")

    // 根据屏幕状态选择 UI：
    // - 锁屏 → LockScreenAlertActivity（setShowWhenLocked，可点亮屏幕）
    // - 不锁屏（后台）→ 悬浮窗 FloatingWindowModule（TYPE_APPLICATION_OVERLAY）
    if (screenLocked) {
      Log.i(TAG, "屏幕已锁屏，启动 LockScreenAlertActivity")
      startLockScreenActivity(event, intensity, distance, alertLevel, arrivalMs, sourceName)
    } else {
      Log.i(TAG, "屏幕未锁屏（后台），显示悬浮窗 FloatingWindowModule")
      showFloatingWindowFromBackground(event, intensity, distance, alertLevel, arrivalMs, sourceName)
    }
    return true
  }

  /**
   * 启动 LockScreenAlertActivity 显示锁屏预警
   *
   * 相比 TYPE_APPLICATION_OVERLAY 悬浮窗，Activity 通过 setShowWhenLocked/setTurnScreenOn
   * 能更可靠地显示在锁屏界面之上（兼容 MIUI/Flye 等定制 ROM）。
   *
   * Activity 自带倒计时 tick（每秒更新倒计时显示），无需 EewBackgroundService 维护 tick。
   * Activity 自带声音/震动/闪光灯联动（通过 ReactContextProvider 获取原生模块）。
   * Activity 关闭（用户点击✕或系统销毁）后自动结束预警。
   *
   * 警报配置（soundEnabled/vibrationEnabled/flashlightEnabled）从 SharedPreferences 读取，
   * 通过 Intent extras 传入 Activity，避免 Activity 直接依赖 SharedPreferences（解耦）。
   *
   * @param event 地震事件
   * @param intensity 预估烈度
   * @param distance 震中距 km
   * @param alertLevel 预警级别（blue/yellow/orange/red）
   * @param arrivalMs S 波到达时间戳
   * @param sourceName 数据源名称（用于锁屏界面显示）
   */
  private fun startLockScreenActivity(
    event: ParsedCencEvent,
    intensity: Double,
    distance: Double,
    alertLevel: String,
    arrivalMs: Long,
    sourceName: String?,
  ) {
    try {
      // 读取警报配置（声音/震动/闪光灯/自动音量），通过 Intent extras 传给 Activity
      val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val soundEnabled = prefs.getBoolean("soundEnabled", true)
      val vibrationEnabled = prefs.getBoolean("vibrationEnabled", true)
      val flashlightEnabled = prefs.getBoolean("flashlightEnabled", true)
      val autoVolumeEnabled = prefs.getBoolean("autoVolumeEnabled", false)
      val alertVolume = prefs.getInt("alertVolume", 80)

      // 构造事件数据（用于 addEvent 调用）
      val eventData = LockScreenAlertActivity.LockScreenEvent(
        eventId = event.eventId,
        magnitude = event.magnitude,
        depth = event.depth,
        intensity = intensity,
        distance = distance,
        location = event.location,
        alertLevel = alertLevel,
        originTime = event.originTime,
        arrivalMs = arrivalMs,
        reportNum = event.reportNum,
        sourceName = sourceName,
      )

      // === 多事件模式 ===
      // 若 Activity 已运行，直接调用 addEvent 添加事件（或更新已有事件），无需 startActivity
      if (LockScreenAlertActivity.isRunning()) {
        LockScreenAlertActivity.instance?.addEvent(eventData)
        Log.i(TAG, "Activity 已运行，addEvent: eventId=${event.eventId}")
        return
      }

      // Activity 未运行，启动 Activity（首个事件）
      // 锁屏接管显示，停止后台悬浮窗 tick 并清理队列，避免锁屏与悬浮窗同时显示
      stopBackgroundFloatingWindowTick()
      backgroundEvents.clear()
      try {
        ReactContextProvider.floatingWindowModule?.hide()
      } catch (_: Exception) {
        // 忽略
      }
      stopAlertsFromBackground()
      val intent = Intent(this, LockScreenAlertActivity::class.java).apply {
        // FLAG_ACTIVITY_NEW_TASK：Service 启动 Activity 必须设置
        // FLAG_ACTIVITY_CLEAR_TOP：如果 Activity 已存在，清除其上方的 Activity
        // FLAG_ACTIVITY_SINGLE_TOP：如果 Activity 已存在，不重新创建，走 onNewIntent
        addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_SINGLE_TOP
        )
        putExtra(LockScreenAlertActivity.EXTRA_EVENT_ID, event.eventId)
        putExtra(LockScreenAlertActivity.EXTRA_MAGNITUDE, event.magnitude)
        putExtra(LockScreenAlertActivity.EXTRA_DEPTH, event.depth)
        putExtra(LockScreenAlertActivity.EXTRA_INTENSITY, intensity)
        putExtra(LockScreenAlertActivity.EXTRA_DISTANCE, distance)
        putExtra(LockScreenAlertActivity.EXTRA_LOCATION, event.location)
        putExtra(LockScreenAlertActivity.EXTRA_ALERT_LEVEL, alertLevel)
        putExtra(LockScreenAlertActivity.EXTRA_ORIGIN_TIME, event.originTime)
        putExtra(LockScreenAlertActivity.EXTRA_ARRIVAL_MS, arrivalMs)
        if (event.reportNum != null && event.reportNum > 0) {
          putExtra(LockScreenAlertActivity.EXTRA_REPORT_NUM, event.reportNum)
        }
        if (!sourceName.isNullOrEmpty()) {
          putExtra(LockScreenAlertActivity.EXTRA_SOURCE_NAME, sourceName)
        }
        putExtra(LockScreenAlertActivity.EXTRA_SOUND_ENABLED, soundEnabled)
        putExtra(LockScreenAlertActivity.EXTRA_VIBRATION_ENABLED, vibrationEnabled)
        putExtra(LockScreenAlertActivity.EXTRA_FLASHLIGHT_ENABLED, flashlightEnabled)
        putExtra(LockScreenAlertActivity.EXTRA_AUTO_VOLUME_ENABLED, autoVolumeEnabled)
        putExtra(LockScreenAlertActivity.EXTRA_ALERT_VOLUME, alertVolume)
      }
      Log.i(TAG, "启动 LockScreenAlertActivity: eventId=${event.eventId} sound=$soundEnabled vibrate=$vibrationEnabled flashlight=$flashlightEnabled autoVolume=$autoVolumeEnabled volume=$alertVolume")

      // === 双管齐下策略（适配 MIUI 等定制 ROM）===
      // 1. 直接 startActivity：前台服务（ForegroundService）有权启动 Activity，
      //    配合 setShowWhenLocked/setTurnScreenOn 可在锁屏上显示。
      //    MIUI 重装后 fullScreenIntent 可能被拦截，直接 startActivity 是更可靠的首选路径。
      // 2. 同时发送 fullScreenIntent 通知作为后备：若 startActivity 被拦截，
      //    系统可能仍会通过 fullScreenIntent 启动 Activity。
      var startActivitySuccess = false
      try {
        startActivity(intent)
        startActivitySuccess = true
        Log.i(TAG, "直接 startActivity 启动 LockScreenAlertActivity 成功")
      } catch (e: Exception) {
        Log.w(TAG, "直接 startActivity 失败（可能被 MIUI 拦截）: ${e.message}，尝试 fullScreenIntent 后备")
      }

      // Android 10+ 同时发送 fullScreenIntent 通知（作为后备或增强）
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        try {
          ensureFullScreenIntentChannel()
          val pendingIntent = PendingIntent.getActivity(
            this,
            FULL_SCREEN_INTENT_NOTIF_ID,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
          )
          val notification = NotificationCompat.Builder(this, FULL_SCREEN_INTENT_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("地震预警")
            .setContentText("震级 ${event.magnitude} | ${event.location}")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setFullScreenIntent(pendingIntent, true)
            .build()
          val notifManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
          notifManager.notify(FULL_SCREEN_INTENT_NOTIF_ID, notification)
          Log.i(TAG, "fullScreenIntent 通知已发送${if (startActivitySuccess) "（增强）" else "（后备）"}")
        } catch (e: Exception) {
          Log.w(TAG, "fullScreenIntent 通知发送失败: ${e.message}")
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "启动 LockScreenAlertActivity 失败: ${e.message}")
    }
  }

  /**
   * 判断屏幕是否处于锁屏状态
   *
   * 通过 KeyguardManager.isKeyguardLocked() 判断（API 1+，兼容所有版本）。
   * 返回 true 表示键盘锁激活（屏幕已锁屏），false 表示未锁屏（可能屏幕点亮或熄灭但未锁屏）。
   */
  private fun isScreenLocked(): Boolean {
    val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    return keyguardManager?.isKeyguardLocked ?: false
  }

  /**
   * 在不锁屏（后台）时显示悬浮窗预警
   *
   * 通过 ReactContextProvider 获取 FloatingWindowModule 实例，
   * 调用 showFromBackground() 显示悬浮窗。
   *
   * 悬浮窗使用 TYPE_APPLICATION_OVERLAY，叠加在所有应用之上（但不覆盖锁屏）。
   * 适用于 App 在后台、屏幕未锁屏的场景（如用户在使用其他 App）。
   *
   * 注意：悬浮窗的倒计时更新由 JS 层 useFloatingWindow 的 tick 机制维护，
   * 但后台时 JS 层可能被挂起，因此原生层需自行维护 tick 更新悬浮窗内容。
   * 此处启动后台 tick 定时器，每秒更新悬浮窗倒计时，直到倒计时归零。
   *
   * @param event 地震事件
   * @param intensity 预估烈度
   * @param distance 震中距 km
   * @param alertLevel 预警级别（blue/yellow/orange/red）
   * @param arrivalMs S 波到达时间戳
   * @param sourceName 数据源名称（用于悬浮窗显示）
   */
  private fun showFloatingWindowFromBackground(
    event: ParsedCencEvent,
    intensity: Double,
    distance: Double,
    alertLevel: String,
    arrivalMs: Long,
    sourceName: String?,
  ) {
    val module = ReactContextProvider.floatingWindowModule
    if (module == null) {
      Log.w(TAG, "FloatingWindowModule 未初始化，回退到 LockScreenAlertActivity")
      startLockScreenActivity(event, intensity, distance, alertLevel, arrivalMs, sourceName)
      return
    }

    // 检查悬浮窗权限
    if (!Settings.canDrawOverlays(this)) {
      Log.w(TAG, "无悬浮窗权限（SYSTEM_ALERT_WINDOW），回退到 LockScreenAlertActivity")
      startLockScreenActivity(event, intensity, distance, alertLevel, arrivalMs, sourceName)
      return
    }

    // 加入后台事件队列
    val bgEvent = BackgroundEvent(event, intensity, distance, alertLevel, arrivalMs, sourceName)
    backgroundEvents[event.eventId] = bgEvent

    try {
      // 设置关闭回调：用户点击✕关闭某事件悬浮窗时，从队列移除并刷新显示
      module.onClosedCallback = { eventId ->
        Log.i(TAG, "用户关闭后台悬浮窗 eventId=$eventId，从队列移除并标记已关闭")
        backgroundEvents.remove(eventId)
        // 记录用户已关闭，后续同 ID 新报告不再重新弹出
        userDismissedEventIds.add(eventId)
        // 如果队列空，停止 tick 和警报
        if (backgroundEvents.isEmpty()) {
          stopBackgroundFloatingWindowTick()
          stopAlertsFromBackground()
        } else {
          // 队列非空，刷新显示（重新 setEvents）
          refreshBackgroundFloatingWindows()
        }
      }

      // 刷新所有显示中的悬浮窗（按优先级排序、分组）
      refreshBackgroundFloatingWindows()

      Log.i(TAG, "悬浮窗已显示（后台多事件）: eventId=${event.eventId} mag=${event.magnitude} intensity=$intensity level=$alertLevel 队列大小=${backgroundEvents.size}")

      // 启动后台 tick 定时器（如尚未启动）
      if (bgFloatingTickRunnable == null) {
        startBackgroundFloatingWindowTick()
      }

      // 触发声音/震动/闪光灯警报（合并一个，仅最高优先级事件决定闪光灯）
      val topEvent = selectBackgroundDisplayEvents().firstOrNull()
      if (topEvent != null && !bgFloatingAlertsStopped) {
        triggerAlertsFromBackground(topEvent.intensity)
      }
    } catch (e: Exception) {
      Log.e(TAG, "显示悬浮窗失败: ${e.message}，回退到 LockScreenAlertActivity")
      startLockScreenActivity(event, intensity, distance, alertLevel, arrivalMs, sourceName)
    }
  }

  /**
   * 从后台事件队列中选出要显示的事件（按预警级别降序，同级别的并列，最多 3 个）
   *
   * 规则（与 JS 层 selectDisplayEvents 一致，用户决策）：
   * 1. 候选过滤：用户已关闭的不显示；非取消报需 remainSec > -30（倒计时归零后 30 秒内仍算活跃，让大震独占显示）
   * 2. 排序：预警级别降序，同级别按烈度降序
   * 3. 分组：顶级 1 个 + 并列（与顶级同级别）最多 2 个
   * 4. 差 ≥ 1 档的事件被顶级"压制"，等顶级 remainSec <= -30 后才会成为新顶级显示
   * 5. 用户手动关闭顶级 → 顶级被过滤，下一级立即显示
   */
  private fun selectBackgroundDisplayEvents(): List<BackgroundEvent> {
    val candidates = backgroundEvents.values.filter { bgEvent ->
      val remainSec = ((bgEvent.arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()
      // remainSec > -30：倒计时归零后 30 秒内仍算活跃，让大震独占显示
      // 这样小震在此时不会成为候选，直到大震 remainSec <= -30 被过滤掉
      remainSec > ALERT_CONTINUE_AFTER_ARRIVAL_SEC || bgEvent.event.isCancel
    }.toMutableList()

    if (candidates.isEmpty()) return emptyList()

    // 排序：预警级别降序，同级别按烈度降序
    candidates.sortWith(compareByDescending<BackgroundEvent> {
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
   * 刷新后台悬浮窗显示（调用 setEvents 批量更新）
   */
  private fun refreshBackgroundFloatingWindows() {
    val module = ReactContextProvider.floatingWindowModule ?: return
    val displayList = selectBackgroundDisplayEvents()
    if (displayList.isEmpty()) {
      module.hide()
      return
    }
    // 构建 WritableNativeArray
    val arr = com.facebook.react.bridge.WritableNativeArray()
    for (bgEvent in displayList) {
      arr.pushMap(buildFloatingWindowContent(
        bgEvent.event, bgEvent.intensity, bgEvent.distance, bgEvent.alertLevel, bgEvent.arrivalMs, bgEvent.sourceName
      ))
    }
    try {
      module.setEventsFromBackground(arr)
    } catch (e: Exception) {
      Log.w(TAG, "refreshBackgroundFloatingWindows setEventsFromBackground 失败: ${e.message}")
    }
  }

  /** 后台悬浮窗 tick 定时器 */
  private var bgFloatingTickHandler: Handler? = null
  private var bgFloatingTickRunnable: Runnable? = null
  /** 后台悬浮窗倒计时是否已归零 */
  private var bgFloatingArrived = false
  /** 后台悬浮窗警报是否已停止（到达后继续响 -30 秒后停止） */
  private var bgFloatingAlertsStopped = false

  /**
   * 后台事件队列（多事件并发）
   *
   * Key: eventId，Value: 该事件的计算结果（烈度/距离/级别/到达时间）
   * 收到新事件时加入队列，用户关闭或事件过期时移除。
   * 每次 tick 重新排序、调用 setEvents 更新所有显示中的悬浮窗。
   */
  private data class BackgroundEvent(
    val event: ParsedCencEvent,
    val intensity: Double,
    val distance: Double,
    val alertLevel: String,
    val arrivalMs: Long,
    val sourceName: String? = null,
    var arrived: Boolean = false,
    var alertsStopped: Boolean = false,
  )
  private val backgroundEvents: MutableMap<String, BackgroundEvent> = LinkedHashMap()

  /**
   * 启动后台悬浮窗 tick 定时器（多事件版）
   *
   * 每秒遍历 backgroundEvents 队列：
   * - 更新每个事件的 arrived/alertsStopped 状态
   * - 调用 refreshBackgroundFloatingWindows 批量更新所有悬浮窗内容
   * - 所有事件警报都应停止时停止警报
   * - 队列空时停止 tick
   */
  private fun startBackgroundFloatingWindowTick() {
    // 停止旧的 tick
    stopBackgroundFloatingWindowTick()

    bgFloatingAlertsStopped = false
    if (bgFloatingTickHandler == null) {
      bgFloatingTickHandler = Handler(Looper.getMainLooper())
    }

    val r = object : Runnable {
      override fun run() {
        val module = ReactContextProvider.floatingWindowModule
        if (module == null) {
          Log.w(TAG, "后台 tick: FloatingWindowModule 已销毁，停止 tick")
          return
        }

        // 队列空，停止 tick
        if (backgroundEvents.isEmpty()) {
          Log.i(TAG, "后台 tick: 事件队列空，停止 tick")
          stopBackgroundFloatingWindowTick()
          stopAlertsFromBackground()
          return
        }

        val now = System.currentTimeMillis()

        // 遍历所有事件，更新状态
        var allAlertsShouldStop = true
        for (bgEvent in backgroundEvents.values) {
          val remainSec = ((bgEvent.arrivalMs - now) / 1000.0).toInt()

          // 标记归零
          if (!bgEvent.arrived && remainSec <= 0) {
            bgEvent.arrived = true
            Log.i(TAG, "后台事件 ${bgEvent.event.eventId} 地震波已到达")
          }

          // 检查警报是否应停止
          if (!bgEvent.alertsStopped && remainSec <= ALERT_CONTINUE_AFTER_ARRIVAL_SEC) {
            bgEvent.alertsStopped = true
            Log.i(TAG, "后台事件 ${bgEvent.event.eventId} 警报停止")
          }
          if (!bgEvent.alertsStopped) {
            allAlertsShouldStop = false
          }
        }

        // 所有事件警报都应停止
        if (allAlertsShouldStop && !bgFloatingAlertsStopped) {
          bgFloatingAlertsStopped = true
          stopAlertsFromBackground()
        }

        // 刷新所有悬浮窗内容
        refreshBackgroundFloatingWindows()

        // 继续下一秒 tick
        bgFloatingTickHandler?.postDelayed(this, 1000L)
      }
    }
    bgFloatingTickRunnable = r
    bgFloatingTickHandler?.post(r)
    Log.i(TAG, "后台悬浮窗 tick 已启动（多事件）")
  }

  /** 停止后台悬浮窗 tick 定时器 */
  private fun stopBackgroundFloatingWindowTick() {
    bgFloatingTickRunnable?.let { bgFloatingTickHandler?.removeCallbacks(it) }
    bgFloatingTickRunnable = null
  }

  /**
   * 构建悬浮窗内容 Map（WritableNativeMap）
   *
   * 字段与 useFloatingWindow.buildContent 一致：
   * - magnitude: 震级
   * - countdown: 剩余秒数
   * - location: 震中位置
   * - level: 预警级别
   * - intensity: 预估烈度
   * - epicenterDistance: 震中距 km
   * - originTime: 发震时刻
   * - isCancel: 是否取消报
   */
  private fun buildFloatingWindowContent(
    event: ParsedCencEvent,
    intensity: Double,
    distance: Double,
    alertLevel: String,
    arrivalMs: Long,
    sourceName: String?,
  ): com.facebook.react.bridge.WritableNativeMap {
    val now = System.currentTimeMillis()
    val remainSec = maxOf(((arrivalMs - now) / 1000.0).toInt(), 0)
    val content = com.facebook.react.bridge.WritableNativeMap()
    content.putString("eventId", event.eventId)
    content.putDouble("magnitude", event.magnitude)
    content.putInt("countdown", remainSec)
    content.putString("location", event.location)
    content.putString("level", alertLevel)
    content.putDouble("intensity", intensity)
    content.putDouble("epicenterDistance", distance)
    content.putDouble("originTime", event.originTime.toDouble())
    content.putBoolean("isCancel", event.isCancel)
    if (event.reportNum != null && event.reportNum > 0) {
      content.putInt("reportNum", event.reportNum)
    }
    event.reportType?.let { content.putString("reportType", it) }
    if (!sourceName.isNullOrEmpty()) {
      content.putString("sourceName", sourceName)
    }
    return content
  }

  /**
   * 触发声音/震动/闪光灯警报（后台悬浮窗模式）
   *
   * 通过 ReactContextProvider 获取原生模块实例，直接调用（不经过 RN 桥）。
   * 警报配置从 SharedPreferences 读取。
   *
   * @param intensity 预估烈度（用于判断闪光灯触发阈值）
   */
  private fun triggerAlertsFromBackground(intensity: Double) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val soundEnabled = prefs.getBoolean("soundEnabled", true)
    val vibrationEnabled = prefs.getBoolean("vibrationEnabled", true)
    val flashlightEnabled = prefs.getBoolean("flashlightEnabled", true)
    val autoVolumeEnabled = prefs.getBoolean("autoVolumeEnabled", false)
    val alertVolume = prefs.getInt("alertVolume", 80)

    if (soundEnabled) {
      try {
        // 自动调节媒体音量：在播放声音前保存并设置目标音量
        if (autoVolumeEnabled) {
          ReactContextProvider.soundModule?.saveAndSetMediaVolume(alertVolume)
        }
        ReactContextProvider.soundModule?.playAlertSound()
        Log.i(TAG, "后台声音警报已启动")
      } catch (e: Exception) {
        Log.w(TAG, "后台声音警报启动失败: ${e.message}")
      }
    }
    if (vibrationEnabled) {
      try {
        ReactContextProvider.vibratorModule?.startVibratingCycle(2000, 1000)
        Log.i(TAG, "后台震动警报已启动")
      } catch (e: Exception) {
        Log.w(TAG, "后台震动警报启动失败: ${e.message}")
      }
    }
    // 闪光灯仅在烈度 >= 5 时触发（与 LockScreenAlertActivity 一致）
    if (flashlightEnabled && intensity >= 5.0) {
      try {
        ReactContextProvider.flashlightModule?.startBlinking(1000)
        Log.i(TAG, "后台闪光灯警报已启动 (intensity=$intensity)")
      } catch (e: Exception) {
        Log.w(TAG, "后台闪光灯警报启动失败: ${e.message}")
      }
    }
  }

  /** 停止声音/震动/闪光灯警报（后台悬浮窗模式） */
  private fun stopAlertsFromBackground() {
    try {
      ReactContextProvider.soundModule?.stopAlertSound()
    } catch (_: Exception) {}
    try {
      ReactContextProvider.vibratorModule?.stopVibrating()
    } catch (_: Exception) {}
    try {
      ReactContextProvider.flashlightModule?.stopBlinking()
    } catch (_: Exception) {}
    try {
      // 恢复原媒体音量
      ReactContextProvider.soundModule?.restoreMediaVolume()
    } catch (_: Exception) {}
  }

  /**
   * 创建 fullScreenIntent 专用通知渠道（高优先级，绕过勿扰）
   *
   * 必须在发送 fullScreenIntent 通知前调用。渠道只需创建一次，重复创建无副作用。
   */
  private fun ensureFullScreenIntentChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val notifManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (notifManager.getNotificationChannel(FULL_SCREEN_INTENT_CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      FULL_SCREEN_INTENT_CHANNEL_ID,
      "地震预警全屏警报",
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = "锁屏时全屏显示地震预警（绕过后台启动限制）"
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setBypassDnd(true)
      enableVibration(false) // 震动由 LockScreenAlertActivity 自管
      setSound(null, null)   // 声音由 LockScreenAlertActivity 自管
    }
    notifManager.createNotificationChannel(channel)
    Log.i(TAG, "fullScreenIntent 通知渠道已创建: $FULL_SCREEN_INTENT_CHANNEL_ID")
  }

  // ======================== ReactContext 获取 ========================

  /**
   * 获取当前 ReactApplicationContext
   *
   * 通过 RN 的 ReactHost 获取（RN 0.74+ API）。
   * 若获取失败返回 null。
   */
  private val currentReactContext: ReactApplicationContext?
    get() {
      return try {
        // 通过反射获取当前 ReactHost 的 reactContext
        // 由于 RN API 较复杂，此处使用简单的方式：通过 Application 注册的全局引用
        ReactContextProvider.reactApplicationContext
      } catch (_: Exception) {
        null
      }
    }

  // ======================== 测试预警（供 RN/ADB 调用） ========================

  /**
   * 触发测试预警（绕过 WebSocket + 前后台检查，直接走锁屏预警触发路径）
   *
   * 供 BackgroundServiceModule.testAlert()（RN 按钮）和 ADB 广播调用。
   * 测试路径与真实锁屏预警路径完全一致：
   *   构造事件 → emitEewEvent（转发JS） → 计算烈度/距离/S波 → 启动 LockScreenAlertActivity
   *
   * 注意：此方法跳过 lockScreenEnabled、floatingWindowEnabled、appInForeground 检查，
   * 但仍保留 minMagnitude 和 lockScreenIntensity 检查（避免无意义触发）。
   * 若希望完全绕过所有检查，可使用 forceTrigger=true。
   *
   * @param magnitude 震级
   * @param depth 震源深度（km）
   * @param lat 震中纬度
   * @param lng 震中经度
   * @param forceTrigger 是否强制触发（绕过所有阈值检查）
   * @return 是否触发成功
   */
  fun triggerTestAlert(
    magnitude: Double,
    depth: Double,
    lat: Double,
    lng: Double,
    forceTrigger: Boolean = false,
  ): Boolean {
    try {
      Log.i(TAG, "triggerTestAlert: mag=$magnitude depth=$depth lat=$lat lng=$lng force=$forceTrigger")

      val event = ParsedCencEvent(
        eventId = "test-${System.currentTimeMillis()}",
        originTime = System.currentTimeMillis(),
        magnitude = magnitude,
        depth = depth,
        lat = lat,
        lng = lng,
        location = "测试预警震中(${String.format("%.2f", lat)}, ${String.format("%.2f", lng)})",
        maxIntensity = null,
        isCancel = false,
        isFinal = false,
        reportNum = 1,
      )

      // 转发给 JS 层（若 JS 仍存活），使用 test 标识
      // 多源模式下测试预警不依赖任何具体源，使用默认 test 配置
      val testSourceName = "test"
      emitEewEvent(event, CustomSourceConfig(
        name = testSourceName,
        endpoint = "",
        protocol = "test",
        authToken = null,
        wsAuthMessage = null,
        heartbeatKeyword = null,
        pollIntervalMs = 0L,
        fieldMapping = FieldMapping(
          eventId = "$.eventId",
          originTime = "$.originTime",
          magnitude = "$.magnitude",
          depth = "$.depth",
          lat = "$.lat",
          lng = "$.lng",
          location = "$.location",
        ),
      ))

      val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val userLat = prefs.getFloat("userLat", 39.9f).toDouble()
      val userLng = prefs.getFloat("userLng", 116.4f).toDouble()

      val distance = EewAlertEngine.haversineDistance(lat, lng, userLat, userLng)
      val intensity = EewAlertEngine.calcCsis(magnitude, depth, distance)
      val alertLevel = EewAlertEngine.computeAlertLevelByIntensity(intensity)

      Log.i(TAG, "triggerTestAlert 计算: distance=${distance.toInt()}km intensity=$intensity level=$alertLevel")

      if (!forceTrigger) {
        // 非强制：仍检查阈值（避免无意义触发，但跳过 lockScreenEnabled/floatingWindowEnabled/appInForeground）
        val minMagnitude = prefs.getFloat("minMagnitude", 3.0f).toDouble()
        val lockScreenIntensity = prefs.getFloat("lockScreenIntensity", 4.0f).toDouble()
        if (magnitude < minMagnitude) {
          Log.w(TAG, "测试预警震级 $magnitude < minMagnitude $minMagnitude，跳过（使用 forceTrigger=true 可绕过）")
          return false
        }
        if (intensity < lockScreenIntensity) {
          Log.w(TAG, "测试预警烈度 $intensity < lockScreenIntensity $lockScreenIntensity，跳过（使用 forceTrigger=true 可绕过）")
          return false
        }
        if (alertLevel == EewAlertEngine.LEVEL_SILENT) {
          Log.w(TAG, "测试预警级别 silent，跳过")
          return false
        }
      }

      // 计算 S 波到达时间（使用真实 arrivalMs，不保底）
      val arrivalMs = EewAlertEngine.computeSWaveArrivalMs(
        event.originTime, lat, lng, userLat, userLng
      )
      val remainSec = ((arrivalMs - System.currentTimeMillis()) / 1000.0).toInt()

      Log.i(TAG, "triggerTestAlert 触发预警: mag=$magnitude intensity=$intensity level=$alertLevel remain=${remainSec}s")

      // 根据屏幕状态选择 UI（与 tryTriggerFloatingWindow 一致）
      if (isScreenLocked()) {
        Log.i(TAG, "triggerTestAlert: 屏幕已锁屏，启动 LockScreenAlertActivity")
        startLockScreenActivity(event, intensity, distance, alertLevel, arrivalMs, testSourceName)
      } else {
        Log.i(TAG, "triggerTestAlert: 屏幕未锁屏，显示悬浮窗 FloatingWindowModule")
        showFloatingWindowFromBackground(event, intensity, distance, alertLevel, arrivalMs, testSourceName)
      }
      return true
    } catch (e: Exception) {
      Log.e(TAG, "triggerTestAlert 失败: ${e.message}")
      return false
    }
  }

  /**
   * 注册测试预警广播接收器
   *
   * 接收 ADB 广播（使用字符串 extras，兼容所有 Android 版本，因为 --ed 在部分设备不支持）：
   * adb shell am broadcast -a com.mdoeeewapp.android.cn.TEST_ALERT \
   *   --es magnitude 6.0 --es depth 15 --es lat 40.0 --es lng 116.0 --ez forceTrigger true
   *
   * 注意：动态注册的接收器默认为 EXPORTED（Android 14+ 需显式声明 RECEIVER_EXPORTED），
   * 因为需要接收 ADB shell 广播（系统级外部调用）。
   */
  private fun registerTestAlertReceiver() {
    if (testAlertReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action != ACTION_TEST_ALERT) return
        try {
          // 使用字符串 extras（--es），兼容所有 Android 版本（--ed 在部分设备不支持）
          val mag = intent.getStringExtra("magnitude")?.toDoubleOrNull() ?: 5.5
          val depth = intent.getStringExtra("depth")?.toDoubleOrNull() ?: 15.0
          val lat = intent.getStringExtra("lat")?.toDoubleOrNull() ?: 40.0
          val lng = intent.getStringExtra("lng")?.toDoubleOrNull() ?: 116.0
          val force = intent.getBooleanExtra("forceTrigger", false)
          Log.i(TAG, "收到测试预警广播: mag=$mag depth=$depth lat=$lat lng=$lng force=$force")
          triggerTestAlert(mag, depth, lat, lng, force)
        } catch (e: Exception) {
          Log.e(TAG, "处理测试预警广播失败: ${e.message}")
        }
      }
    }
    val filter = IntentFilter(ACTION_TEST_ALERT)
    // Android 13+ (API 33+) 需显式声明 RECEIVER_EXPORTED 才能接收外部广播
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(receiver, filter)
    }
    testAlertReceiver = receiver
    Log.i(TAG, "测试预警广播接收器已注册（action=$ACTION_TEST_ALERT）")
  }

  /**
   * 注销测试预警广播接收器
   */
  private fun unregisterTestAlertReceiver() {
    testAlertReceiver?.let {
      try {
        unregisterReceiver(it)
      } catch (_: Exception) {
        // 忽略未注册异常
      }
      testAlertReceiver = null
    }
  }

  // ======================== RN 事件转发 ========================

  /**
   * 将 EEW 事件转发给 JS 层（通过 DeviceEventEmitter）
   *
   * JS 层可通过 `DeviceEventEmitter.addListener('onEewEvent', ...)` 接收。
   * 事件负载结构（WritableMap）：
   *   - id: String（"customSource-<host>-<eventId>"，与 JS 层 CustomSourceAdapter 一致）
   *   - source: String（"customSource"）
   *   - originTime: Long（Unix 毫秒）
   *   - magnitude: Double
   *   - depth: Double
   *   - lat: Double
   *   - lng: Double
   *   - location: String
   *   - intensity: Double?（可能为 null）
   *   - isCancel: Boolean
   *   - isFinal: Boolean
   *   - receivedAt: Long（Unix 毫秒）
   *
   * @param event 解析后的事件
   * @param config 当前活跃 customSource 配置（用于生成 id 前缀）
   */
  private fun emitEewEvent(event: ParsedCencEvent, config: CustomSourceConfig?) {
    try {
      val ctx = currentReactContext ?: return
      val map = WritableNativeMap()
      val idPrefix = "customSource-${extractHost(config?.endpoint ?: "")}"
      map.putString("id", "$idPrefix-${event.eventId}")
      map.putString("source", "customSource")
      map.putDouble("originTime", event.originTime.toDouble())
      map.putDouble("magnitude", event.magnitude)
      map.putDouble("depth", event.depth)
      map.putDouble("lat", event.lat)
      map.putDouble("lng", event.lng)
      map.putString("location", event.location)
      event.maxIntensity?.let { map.putDouble("intensity", it) }
      map.putBoolean("isCancel", event.isCancel)
      map.putBoolean("isFinal", event.isFinal)
      event.reportNum?.let { map.putInt("reportNum", it) }
      event.reportType?.let { map.putString("reportType", it) }
      val sName = config?.name
      if (!sName.isNullOrEmpty()) {
        map.putString("sourceName", sName)
      }
      map.putDouble("receivedAt", System.currentTimeMillis().toDouble())

      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_EEW_EVENT, map)
    } catch (e: Exception) {
      Log.w(TAG, "emitEewEvent 失败: ${e.message}")
    }
  }

  /**
   * 转发 WebSocket/HTTP 连接状态给 JS 层
   */
  private fun emitWsStatus(status: String, message: String) {
    try {
      val ctx = currentReactContext ?: return
      val map = WritableNativeMap()
      map.putString("status", status)
      map.putString("message", message)
      ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_WS_STATUS, map)
    } catch (_: Exception) {
      // 忽略
    }
  }

  // ======================== 配置更新（供 BackgroundServiceModule 调用） ========================

  /**
   * 更新 alert 配置（由 RN 层调用）
   *
   * @param alertMap 包含字段：minMagnitude, lockScreenIntensity, lockScreenEnabled,
   *                 floatingWindowEnabled, soundEnabled, vibrationEnabled, flashlightEnabled,
   *                 backgroundEnabled, autoStartEnabled, autoVolumeEnabled, alertVolume
   */
  fun updateAlertConfig(alertMap: com.facebook.react.bridge.ReadableMap) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (alertMap.hasKey("minMagnitude")) {
      prefs.putFloat("minMagnitude", alertMap.getDouble("minMagnitude").toFloat())
    }
    if (alertMap.hasKey("lockScreenIntensity")) {
      prefs.putFloat("lockScreenIntensity", alertMap.getDouble("lockScreenIntensity").toFloat())
    }
    if (alertMap.hasKey("lockScreenEnabled")) {
      prefs.putBoolean("lockScreenEnabled", alertMap.getBoolean("lockScreenEnabled"))
    }
    if (alertMap.hasKey("floatingWindowEnabled")) {
      prefs.putBoolean("floatingWindowEnabled", alertMap.getBoolean("floatingWindowEnabled"))
    }
    if (alertMap.hasKey("soundEnabled")) {
      prefs.putBoolean("soundEnabled", alertMap.getBoolean("soundEnabled"))
    }
    if (alertMap.hasKey("vibrationEnabled")) {
      prefs.putBoolean("vibrationEnabled", alertMap.getBoolean("vibrationEnabled"))
    }
    if (alertMap.hasKey("flashlightEnabled")) {
      prefs.putBoolean("flashlightEnabled", alertMap.getBoolean("flashlightEnabled"))
    }
    if (alertMap.hasKey("backgroundEnabled")) {
      prefs.putBoolean("backgroundEnabled", alertMap.getBoolean("backgroundEnabled"))
    }
    if (alertMap.hasKey("autoStartEnabled")) {
      prefs.putBoolean("autoStartEnabled", alertMap.getBoolean("autoStartEnabled"))
    }
    if (alertMap.hasKey("autoVolumeEnabled")) {
      prefs.putBoolean("autoVolumeEnabled", alertMap.getBoolean("autoVolumeEnabled"))
    }
    if (alertMap.hasKey("alertVolume")) {
      prefs.putInt("alertVolume", alertMap.getInt("alertVolume"))
    }
    if (alertMap.hasKey("notificationEnabled")) {
      prefs.putBoolean("notificationEnabled", alertMap.getBoolean("notificationEnabled"))
    }
    prefs.apply()
    Log.i(TAG, "alert 配置已更新")
  }

  /**
   * 更新位置配置（由 RN 层调用）
   *
   * @param locationMap 包含字段：userLat, userLng（用户当前位置坐标）
   */
  fun updateLocationConfig(locationMap: com.facebook.react.bridge.ReadableMap) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
    if (locationMap.hasKey("userLat")) {
      prefs.putFloat("userLat", locationMap.getDouble("userLat").toFloat())
    }
    if (locationMap.hasKey("userLng")) {
      prefs.putFloat("userLng", locationMap.getDouble("userLng").toFloat())
    }
    prefs.apply()
    Log.i(TAG, "位置配置已更新: lat=${locationMap.getDouble("userLat")}, lng=${locationMap.getDouble("userLng")}")
  }

  // ======================== 前后台检测 ========================

  /**
   * 注册锁屏状态广播接收器
   *
   * MIUI 等 ROM 上 ComponentCallbacks2.onTrimMemory(TRIM_MEMORY_UI_HIDDEN) 在锁屏时不触发，
   * 需要监听系统锁屏广播来可靠检测：
   * - ACTION_SCREEN_OFF：屏幕熄灭（锁屏或超时），标记 App 进入"非前台"
   * - ACTION_USER_PRESENT：用户解锁并进入桌面，标记 App 回到"前台"
   *
   * 注意：SCREEN_OFF 广播只能通过动态注册接收（manifest 注册无效）。
   */
  private fun registerScreenStateReceiver() {
    if (screenStateReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        when (intent?.action) {
          Intent.ACTION_SCREEN_OFF -> {
            appInForeground = false
            Log.i(TAG, "屏幕熄灭（ACTION_SCREEN_OFF），标记 App 进入后台")
          }
          Intent.ACTION_USER_PRESENT -> {
            appInForeground = true
            Log.i(TAG, "用户解锁（ACTION_USER_PRESENT），标记 App 回到前台")
          }
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(receiver, filter)
    }
    screenStateReceiver = receiver
    Log.i(TAG, "锁屏状态广播接收器已注册")
  }

  private fun unregisterScreenStateReceiver() {
    screenStateReceiver?.let {
      try {
        unregisterReceiver(it)
      } catch (_: Exception) {
        // 忽略
      }
    }
    screenStateReceiver = null
  }

  /**
   * 注册 ComponentCallbacks2 检测 App 前后台切换
   *
   * onTrimMemory(TRIM_MEMORY_UI_HIDDEN) 表示 UI 已不可见（App 进入后台）。
   * 此回调在 Activity onStop 之前触发，是检测 App 进入后台的可靠方式。
   *
   * 注意：进入前台无法通过此回调检测，但只要 App 还在前台，appInForeground 就保持 true。
   * 当 App 从后台回到前台时，由 JS 层（AppState 'active'）触发 updateConfig 来同步状态。
   * 此处简化处理：假设 AppState active 时 JS 会调用 updateConfig，我们可以
   * 在 updateAlertConfig 时将 appInForeground 设为 true。
   */
  private fun registerComponentCallbacks() {
    val cb = object : ComponentCallbacks2 {
      override fun onConfigurationChanged(newConfig: Configuration) {}
      override fun onLowMemory() {}

      override fun onTrimMemory(level: Int) {
        if (level == TRIM_MEMORY_UI_HIDDEN) {
          appInForeground = false
          Log.i(TAG, "App 进入后台（TRIM_MEMORY_UI_HIDDEN）")
        }
      }
    }
    componentCallbacks = cb
    application.registerComponentCallbacks(cb)
  }

  private fun unregisterComponentCallbacks() {
    componentCallbacks?.let {
      try {
        application.unregisterComponentCallbacks(it)
      } catch (_: Exception) {
        // 忽略
      }
    }
    componentCallbacks = null
  }

  /**
   * 由 RN 层调用：通知 App 已回到前台
   *
   * RN 层在 AppState 'active' 时调用此方法，更新 appInForeground=true。
   * 这样下次收到事件时不会触发悬浮窗（由 JS 层处理）。
   *
   * 仅停止后台悬浮窗 tick（由 JS 层接管倒计时刷新）。
   * 不停止声音/震动/闪光灯警报，避免误停止 JS 层已启动的警报
   * （场景：App 在前台已有警报，切到后台再切回前台，警报应继续）。
   * 如果后台服务在 App 后台时启动了警报，JS 层 refreshDisplay 会通过
   * playAlertSound（内部先 stop 再 play）自然接管。
   */
  fun notifyAppInForeground() {
    appInForeground = true
    lastForegroundHeartbeatMs = System.currentTimeMillis()
    Log.i(TAG, "App 回到前台，停止后台悬浮窗 tick")
    // 停止后台悬浮窗 tick（由 JS 层接管倒计时刷新）
    stopBackgroundFloatingWindowTick()
  }

  /**
   * 由 RN 层调用：JS 层收到预警事件后发送心跳确认
   *
   * JS 层在 SourceManager.onEvent 回调中调用此方法，更新 [lastForegroundHeartbeatMs]。
   * 原生层 [handleSourceData] 据此判断 JS 线程是否存活：若超过
   * [FOREGROUND_HEARTBEAT_TIMEOUT_MS] 未收到心跳，认为 JS 已死，由原生层接管预警触发。
   */
  fun acknowledgeEewEvent() {
    lastForegroundHeartbeatMs = System.currentTimeMillis()
  }

  /**
   * 由 RN 层调用：通知 App 已进入后台
   *
   * RN 层在 AppState 'background'/'inactive' 时调用此方法，更新 appInForeground=false。
   * 这是按 Home 键切后台时最可靠的检测方式（MIUI 下 onTrimMemory 和 SCREEN_OFF 不可靠）。
   * 这样后台收到事件时会触发锁屏预警（由原生层处理）。
   */
  fun notifyAppInBackground() {
    appInForeground = false
    Log.i(TAG, "App 进入后台（RN AppState 通知）")
  }

  /**
   * 由 RN 层调用：标记事件已由 JS 层触发警报
   *
   * JS 层 useFloatingWindow 启动警报时调用此方法，将事件 ID 加入 triggeredEventIds。
   * 这样 App 切到后台后，后台服务轮询到同一事件不会重复触发悬浮窗和警报。
   *
   * 解决场景：App 在前台时 JS 层通过 WebSocket/HTTP 先收到事件并启动警报，
   * 但后台服务的 HTTP 轮询尚未执行，triggeredEventIds 中没有该事件 ID，
   * App 切到后台后后台服务轮询到同一事件会重复触发。
   */
  fun markEventTriggered(eventId: String) {
    triggeredEventIds.add(eventId)
    Log.i(TAG, "JS 层标记事件已触发: eventId=$eventId (总数=${triggeredEventIds.size})")
  }

  // ======================== 通知 ========================

  /**
   * 创建低优先级通知渠道
   * - IMPORTANCE_LOW：不发声、不弹窗，仅在通知栏显示
   */
  private fun createNotificationChannel() {
    val channel = NotificationChannel(
      CHANNEL_ID,
      CHANNEL_NAME,
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "地震预警后台服务常驻通知"
      setShowBadge(false)
      enableLights(false)
      enableVibration(false)
    }
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(channel)

    // 消息通知渠道（系统通知栏，有声音和弹出）
    val msgChannel = NotificationChannel(
      MSG_CHANNEL_ID,
      MSG_CHANNEL_NAME,
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "地震事件消息通知（eew预警+eqlist速报）"
      setShowBadge(true)
      enableLights(true)
      enableVibration(false) // 不额外振动，避免与预警振动重复
    }
    manager.createNotificationChannel(msgChannel)
  }

  /**
   * 构建常驻通知
   */
  private fun buildNotification(): Notification {
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(CHANNEL_NAME)
      .setContentText(NOTIFICATION_CONTENT)
      .setSmallIcon(com.mdoeeewapp.android.cn.R.mipmap.ic_launcher)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .build()
  }

  /**
   * 发送地震事件消息通知（系统通知栏）
   *
   * 不受阈值影响，eew 和 eqlist 事件均发送。
   * 通知点击后打开 App 主页面。
   *
   * @param event 解析后的事件
   * @param sourceName 数据源名称
   * @param category 事件分类：'eew' 或 'eqlist'
   */
  private fun sendEventNotification(event: ParsedCencEvent, sourceName: String?, category: String) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (!prefs.getBoolean("notificationEnabled", true)) {
      return
    }

    val title = if (category == "eqlist") "地震速报" else "地震预警"
    // 测定类型标签：与 JS 层 EqInfoCard.reportTypeLabel 保持一致，
    // 修改时需同步更新两处（JS/Kotlin 跨层无法共享常量）。
    val reportTypeLabel = event.reportType?.let { rt ->
      when (rt.lowercase()) {
        "auto" -> "自动测定"
        "reviewed" -> "正式测定"
        else -> rt
      }
    } ?: ""
    val reportNumLabel = if (event.reportNum != null && event.reportNum > 0) "第${event.reportNum}报" else ""

    // 构建副标题片段
    val subtitleParts = mutableListOf<String>()
    if (reportNumLabel.isNotEmpty()) subtitleParts.add(reportNumLabel)
    if (reportTypeLabel.isNotEmpty()) subtitleParts.add(reportTypeLabel)
    if (!sourceName.isNullOrEmpty()) subtitleParts.add(sourceName)
    val subtitle = subtitleParts.joinToString(" · ")

    val contentText = "M${event.magnitude} ${event.location}"
    val style = NotificationCompat.InboxStyle()
      .addLine(contentText)
    if (subtitle.isNotEmpty()) {
      style.addLine(subtitle)
    }
    // 计算震中距用于显示
    val userLat = prefs.getFloat("userLat", 39.9f).toDouble()
    val userLng = prefs.getFloat("userLng", 116.4f).toDouble()
    val distance = EewAlertEngine.haversineDistance(event.lat, event.lng, userLat, userLng)
    style.addLine("距您 ${Math.round(distance)}km · 深度 ${event.depth}km")

    // 点击打开 App
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pendingIntent = if (launchIntent != null) {
      PendingIntent.getActivity(
        this, 0, launchIntent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
      )
    } else null

    val notification = NotificationCompat.Builder(this, MSG_CHANNEL_ID)
      .setSmallIcon(com.mdoeeewapp.android.cn.R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(contentText)
      .setStyle(style)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setAutoCancel(true)
      .apply {
        if (pendingIntent != null) setContentIntent(pendingIntent)
      }
      .build()

    val notifManager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    notifManager.notify(MSG_NOTIF_ID, notification)
    Log.i(TAG, "发送消息通知: $title M${event.magnitude} ${event.location} category=$category")
  }

  // ======================== 单源连接封装 ========================

  /**
   * 单源连接封装类（内部使用）
   *
   * 管理单个 customSource 的 WS/HTTP 连接、重连和数据处理，
   * 与 JS 层 CustomSourceAdapter 行为对齐。
   *
   * 每个实例独立维护：
   * - WebSocket 连接和重连状态
   * - HTTP 轮询定时器
   * - 手动关闭标志（避免 stop 后仍触发重连）
   *
   * 收到数据时回调外层 [handleSourceData] 处理事件。
   */
  private inner class SourceConnection(private val config: CustomSourceConfig) {

    /** WebSocket 实例（protocol='ws' 时使用） */
    private var webSocket: WebSocket? = null

    /** 是否为手动关闭（避免 stop 后仍触发重连） */
    private var isManualClose = false

    /** WS 重连 Handler */
    private val reconnectHandler: Handler = Handler(Looper.getMainLooper())

    /** WS 重连 Runnable */
    private var reconnectRunnable: Runnable? = null

    /** WS 重连延迟（指数退避，初始 1s，上限 30s） */
    private var reconnectDelayMs = 1000L

    /** HTTP 轮询 Handler（protocol='http' 时使用） */
    private val httpPollHandler: Handler = Handler(Looper.getMainLooper())

    /** HTTP 轮询 Runnable */
    private var httpPollRunnable: Runnable? = null

    // ===== WS 心跳检测相关（与 JS 层 CustomSourceAdapter 行为一致） =====

    /** 心跳包关键词（null 表示禁用检测；用户未配置时默认 'heartbeat'） */
    private val heartbeatKeyword: String? = config.heartbeatKeyword ?: "heartbeat"

    /** 上次收到心跳的时间戳（Unix 毫秒） */
    private var lastHeartbeatAt = 0L

    /** 上次观察到的心跳间隔（毫秒，收到 ≥2 次心跳后填充） */
    private var lastHeartbeatIntervalMs = 0L

    /** 心跳超时检测 Runnable */
    private var heartbeatRunnable: Runnable? = null

    /** WS 心跳超时：首次未观察到间隔时的默认超时（毫秒） */
    private val wsHeartbeatDefaultTimeoutMs = 60_000L

    /** WS 心跳超时：基于观察到的间隔计算时的下限（毫秒） */
    private val wsHeartbeatTimeoutMinMs = 30_000L

    /** WS 心跳超时：基于观察到的间隔计算时的上限（毫秒） */
    private val wsHeartbeatTimeoutMaxMs = 300_000L

    /** WS 心跳超时：观察到的间隔的倍数 */
    private val wsHeartbeatTimeoutMultiplier = 2L

    /**
     * 启动连接
     *
     * 根据 [CustomSourceConfig.protocol] 选择 WS 或 HTTP 轮询。
     * 连接前检查 allowHttp 开关：false 时拒绝非 localhost 的 HTTP endpoint。
     */
    fun start() {
      // HTTP 明文连接检查：allowHttp=false 时拒绝非 localhost 的 HTTP/WS endpoint
      val endpoint = config.endpoint
      val isHttp = endpoint.startsWith("http://") || endpoint.startsWith("ws://")
      val isLocalhost = isLocalhostEndpoint(endpoint)
      val allowHttp = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getBoolean("allowHttp", false)
      if (isHttp && !isLocalhost && !allowHttp) {
        Log.w(TAG, "源 ${config.name} 跳过 HTTP 连接（allowHttp=false）: $endpoint")
        emitWsStatus("error", "${config.name}: HTTP 被禁用（设置中开启允许 HTTP）")
        return
      }

      when (config.protocol) {
        "ws" -> startWebSocket()
        "http" -> startHttpPolling()
        else -> Log.w(TAG, "源 ${config.name} 未知协议: ${config.protocol}")
      }
    }

    /**
     * 判断 endpoint 是否为 localhost（允许 HTTP 明文）
     * 匹配：localhost / 127.0.0.1 / 10.0.2.2（模拟器）
     */
    private fun isLocalhostEndpoint(endpoint: String): Boolean {
      val host = try {
        java.net.URI(endpoint).host ?: return false
      } catch (_: Exception) {
        return false
      }
      return host == "localhost" || host == "127.0.0.1" || host == "10.0.2.2"
    }

    /**
     * 停止连接（WS + HTTP 轮询）
     *
     * 标记手动关闭，取消重连，关闭 WS，取消 HTTP 轮询。
     */
    fun stop() {
      isManualClose = true
      // 取消 WS 重连
      reconnectRunnable?.let { reconnectHandler.removeCallbacks(it) }
      reconnectRunnable = null
      // 取消心跳超时检测
      heartbeatRunnable?.let { reconnectHandler.removeCallbacks(it) }
      heartbeatRunnable = null
      // 关闭 WS
      try {
        webSocket?.close(1000, "Source stopped")
      } catch (_: Exception) {
        // 忽略关闭异常
      }
      webSocket = null
      // 取消 HTTP 轮询
      httpPollRunnable?.let { httpPollHandler.removeCallbacks(it) }
      httpPollRunnable = null
      // 重置心跳状态
      lastHeartbeatAt = 0L
      lastHeartbeatIntervalMs = 0L
      Log.i(TAG, "源 ${config.name} 已停止")
    }

    // ======================== WebSocket 连接 ========================

    /**
     * 启动 WebSocket 连接
     *
     * 鉴权：
     * 1. URL 追加 ?token=<authToken> 查询参数
     * 2. onOpen 时 webSocket.send(wsAuthMessage)（如配置），用于订阅/鉴权场景
     *
     * 心跳检测：
     * - onMessage 检测包含 heartbeatKeyword 的文本视为心跳，不传给解析器
     * - 启动心跳超时定时器，超时主动关闭 WS 并重连
     *
     * 若已连接则不重复连接。
     */
    private fun startWebSocket() {
      if (webSocket != null) {
        Log.i(TAG, "源 ${config.name} WebSocket 已存在，跳过")
        return
      }
      if (config.endpoint.isEmpty()) {
        Log.w(TAG, "源 ${config.name} endpoint 为空，跳过 WebSocket 连接")
        emitWsStatus("error", "${config.name}: endpoint 为空")
        return
      }

      isManualClose = false
      reconnectDelayMs = 1000L

      // 初始化共享 OkHttpClient（所有源共享一个实例）
      if (httpClient == null) {
        httpClient = OkHttpClient.Builder()
          .pingInterval(30, TimeUnit.SECONDS)
          .readTimeout(0, TimeUnit.MILLISECONDS) // WebSocket 不超时
          .build()
      }

      val url = buildWsUrl(config.endpoint, config.authToken)
      Log.i(TAG, "源 ${config.name} WebSocket 连接 $url")
      emitWsStatus("connecting", "连接中: ${config.name}")

      val request = Request.Builder().url(url).build()
      webSocket = httpClient?.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          Log.i(TAG, "源 ${config.name} WebSocket 已连接")
          reconnectDelayMs = 1000L
          emitWsStatus("connected", "${config.name} 已连接")

          // onOpen 后发送鉴权/订阅消息（如配置）
          val authMsg = config.wsAuthMessage
          if (!authMsg.isNullOrEmpty()) {
            try {
              webSocket.send(authMsg)
              Log.i(TAG, "源 ${config.name} WS 已发送鉴权消息 (${authMsg.length} 字符)")
            } catch (e: Exception) {
              Log.e(TAG, "源 ${config.name} WS 发送鉴权消息失败: ${e.message}")
            }
          }

          // 启动心跳超时检测（关键词非空时）
          startHeartbeatWatchdog()
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          // 心跳包检测：包含关键词视为心跳，不传给解析器
          val kw = heartbeatKeyword
          if (!kw.isNullOrEmpty() && text.contains(kw)) {
            onHeartbeatReceived()
            return
          }
          handleSourceData(text, config)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          Log.e(TAG, "源 ${config.name} WebSocket 错误: ${t.message}")
          this@SourceConnection.webSocket = null
          stopHeartbeatWatchdog()
          if (!isManualClose) {
            emitWsStatus("error", "${config.name} WebSocket 错误: ${t.message}")
            scheduleReconnect()
          }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          Log.i(TAG, "源 ${config.name} WebSocket 已关闭: $code $reason")
          this@SourceConnection.webSocket = null
          stopHeartbeatWatchdog()
          if (!isManualClose) {
            emitWsStatus("disconnected", "${config.name} WebSocket 意外断开，准备重连")
            scheduleReconnect()
          }
        }
      })
    }

    /**
     * 启动心跳超时检测定时器
     *
     * 超时阈值计算：
     * - 首次（lastHeartbeatIntervalMs === 0）：使用默认 60 秒
     * - 已观察到间隔：max(30s, interval × 2)，上限 300 秒
     *
     * 超时后主动关闭 WS（触发 onClosed → scheduleReconnect）
     */
    private fun startHeartbeatWatchdog() {
      val kw = heartbeatKeyword
      if (kw.isNullOrEmpty()) return
      stopHeartbeatWatchdog()

      val timeoutMs = computeHeartbeatTimeoutMs()
      lastHeartbeatAt = System.currentTimeMillis()
      Log.i(TAG, "源 ${config.name} 心跳检测启动，超时 ${timeoutMs}ms")

      val r = Runnable {
        if (isManualClose) return@Runnable
        val ws = webSocket
        if (ws == null) return@Runnable
        val elapsed = System.currentTimeMillis() - lastHeartbeatAt
        Log.w(TAG, "源 ${config.name} 心跳超时 ${elapsed}ms（阈值 ${timeoutMs}ms），主动关闭重连")
        try {
          ws.close(1000, "heartbeat timeout")
        } catch (_: Exception) {
          // 忽略关闭异常
        }
        // onClosed 会接管：清理 + scheduleReconnect
      }
      heartbeatRunnable = r
      reconnectHandler.postDelayed(r, timeoutMs)
    }

    /** 计算当前心跳超时阈值（毫秒） */
    private fun computeHeartbeatTimeoutMs(): Long {
      if (lastHeartbeatIntervalMs == 0L) {
        return wsHeartbeatDefaultTimeoutMs
      }
      val computed = lastHeartbeatIntervalMs * wsHeartbeatTimeoutMultiplier
      return minOf(maxOf(computed, wsHeartbeatTimeoutMinMs), wsHeartbeatTimeoutMaxMs)
    }

    /** 收到心跳时调用：更新时间戳、计算间隔、重启定时器 */
    private fun onHeartbeatReceived() {
      val now = System.currentTimeMillis()
      if (lastHeartbeatAt > 0) {
        val interval = now - lastHeartbeatAt
        // 仅在合理范围内更新（避免异常值污染，如 >10 分钟的间隔通常是重连后第一拍）
        if (interval in 1000..600_000) {
          lastHeartbeatIntervalMs = interval
          Log.i(TAG, "源 ${config.name} 心跳间隔 ${interval}ms")
        }
      }
      lastHeartbeatAt = now
      // 每次收到心跳都重启定时器（按最新阈值）
      startHeartbeatWatchdog()
    }

    /** 停止心跳超时检测定时器 */
    private fun stopHeartbeatWatchdog() {
      heartbeatRunnable?.let { reconnectHandler.removeCallbacks(it) }
      heartbeatRunnable = null
    }

    /**
     * 指数退避重连
     * 初始 1s，倍数 2，上限 30s
     */
    private fun scheduleReconnect() {
      if (isManualClose) return
      reconnectRunnable?.let { reconnectHandler.removeCallbacks(it) }
      val delay = reconnectDelayMs
      Log.i(TAG, "源 ${config.name} WebSocket ${delay}ms 后重连")
      emitWsStatus("connecting", "${config.name} ${delay}ms 后重连")
      val r = Runnable {
        if (!isManualClose) {
          reconnectDelayMs = minOf(reconnectDelayMs * 2, 30_000L)
          startWebSocket()
        }
      }
      reconnectRunnable = r
      reconnectHandler.postDelayed(r, delay)
    }

    /**
     * 构建 WS URL（追加 token 查询参数，与 JS 层 CustomSourceAdapter.buildWsUrl 行为一致）
     */
    private fun buildWsUrl(endpoint: String, authToken: String?): String {
      if (authToken.isNullOrEmpty()) return endpoint
      val sep = if (endpoint.contains("?")) "&" else "?"
      return "${endpoint}${sep}token=${java.net.URLEncoder.encode(authToken, "UTF-8")}"
    }

    // ======================== HTTP 轮询 ========================

    /**
     * 启动 HTTP 轮询
     *
     * - 立即拉取一次，随后按 [CustomSourceConfig.pollIntervalMs] 定时轮询
     * - 首次拉取成功后上报 connected
     */
    private fun startHttpPolling() {
      if (config.endpoint.isEmpty()) {
        Log.w(TAG, "源 ${config.name} endpoint 为空，跳过 HTTP 轮询")
        emitWsStatus("error", "${config.name}: endpoint 为空")
        return
      }

      // 初始化共享 OkHttpClient（WS 和 HTTP 共用）
      if (httpClient == null) {
        httpClient = OkHttpClient.Builder()
          .connectTimeout(15, TimeUnit.SECONDS)
          .readTimeout(15, TimeUnit.SECONDS)
          .pingInterval(30, TimeUnit.SECONDS)
          .build()
      }

      val intervalMs = config.pollIntervalMs.coerceAtLeast(1000L)
      Log.i(TAG, "源 ${config.name} HTTP 轮询启动: interval=${intervalMs}ms")
      emitWsStatus("connecting", "连接中: ${config.name}")

      val r = object : Runnable {
        override fun run() {
          pollHttpOnce()
          // 调度下次轮询
          httpPollHandler.postDelayed(this, intervalMs)
        }
      }
      httpPollRunnable = r
      httpPollHandler.post(r) // 立即执行第一次
    }

    /**
     * 执行一次 HTTP 拉取（在后台线程）
     *
     * 鉴权：添加 Authorization: Bearer <authToken> 请求头（与 JS 层一致）
     */
    private fun pollHttpOnce() {
      Thread {
        try {
          val requestBuilder = Request.Builder().url(config.endpoint)
            .addHeader("Accept", "application/json")
          if (!config.authToken.isNullOrEmpty()) {
            requestBuilder.addHeader("Authorization", "Bearer ${config.authToken}")
          }
          val response = httpClient?.newCall(requestBuilder.build())?.execute()
          val body = response?.body?.string()
          response?.close()
          if (body != null) {
            handleSourceData(body, config)
          }
        } catch (e: Exception) {
          Log.e(TAG, "源 ${config.name} HTTP 轮询失败: ${e.message}")
          emitWsStatus("error", "${config.name} 拉取失败: ${e.message}")
        }
      }.start()
    }
  }
}

/**
 * 当前活跃 customSource 配置（从 SharedPreferences 反序列化）
 *
 * 与 JS 层 `SourceConfig` 接口对应，仅保留原生层需要的字段。
 */
private data class CustomSourceConfig(
  /** 数据源名称（用于日志和状态显示） */
  val name: String,
  /** 连接端点 URL（WS 或 HTTP） */
  val endpoint: String,
  /** 协议：'ws'（WebSocket）或 'http'（HTTP 轮询） */
  val protocol: String,
  /** 鉴权 token（可选），WS 追加 ?token= 查询参数，HTTP 添加 Bearer 头 */
  val authToken: String?,
  /** WS 连接建立后发送的鉴权/订阅文本（可选，仅 protocol='ws' 使用） */
  val wsAuthMessage: String?,
  /** 心跳包关键词（可选，仅 protocol='ws' 使用，默认 'heartbeat'；空字符串禁用检测） */
  val heartbeatKeyword: String?,
  /** HTTP 轮询间隔（毫秒，仅 protocol='http' 使用） */
  val pollIntervalMs: Long,
  /** 字段映射配置 */
  val fieldMapping: FieldMapping,
  /** 源优先级（用于事件 id 前缀，与 JS 层 customSource-${host}-${priority} 对齐） */
  val priority: Int = 0,
  /** 数据源分类：'eew'（预警）或 'eqlist'（速报），影响通知和悬浮窗触发逻辑 */
  val category: String = "eew",
)

/**
 * 从 URL 中提取主机名（用于事件 id 前缀）
 *
 * 与 JS 层 `CustomSourceAdapter.extractHost` 行为一致：
 * wss://api.example.com/path → api.example.com
 * https://example.com:8080/api → example.com
 * invalid-url → invalid-url
 */
private fun extractHost(url: String): String {
  return try {
    val noProto = url.replace(Regex("^[a-z]+://", RegexOption.IGNORE_CASE), "")
    val host = noProto.split("/")[0].split(":")[0]
    host.ifEmpty { "unknown" }
  } catch (_: Exception) {
    "unknown"
  }
}
