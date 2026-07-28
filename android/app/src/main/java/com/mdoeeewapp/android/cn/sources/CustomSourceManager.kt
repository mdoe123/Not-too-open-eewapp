// 自定义数据源连接管理器（原生层，锁屏时使用）
//
// 管理单个自定义源的 OkHttp 连接（WebSocket 或 HTTP GET 轮询），解析消息并回调 EewEvent。
// 与 JS 层 CustomSourceAdapter 对等，保证用户配置的自定义源在前台/锁屏都能工作。
//
// 核心机制：
// 1. WS 模式：OkHttpClient.newWebSocket() + WebSocketListener，指数退避重连（1s→30s）
// 2. HTTP 模式：OkHttpClient.newCall() + Handler.postDelayed() 定时轮询
// 3. 解析：调用 JsonPathExtractor 按用户配置的 fieldMapping 提取字段
// 4. 鉴权：WS URL 追加 ?token=<authToken>；HTTP 添加 Authorization: Bearer <authToken>
//
// 合规设计：本管理器仅按用户配置的路径/表达式提取 JSON 字段，不执行用户代码，不内置转发逻辑。
// 所有 URL 和字段映射由用户自行配置，App 不预填任何源。

package com.mdoeeewapp.android.cn.sources

import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * 自定义源字段映射配置（与 JS 层 FieldMapping 对等）
 */
data class FieldMapping(
    /**
     * 列表路径（可选）。
     * 配置时，适配器先用此路径从响应根对象提取数组，
     * 再对每个数组元素应用下列字段映射（路径相对于元素）。
     * 未配置时，按单事件解析（对根对象直接提取）。
     *
     * 示例：$.features（USGS）、$.data.events、$（根数组）
     */
    val listPath: String? = null,
    val eventId: String,
    val originTime: String,
    val magnitude: String,
    val depth: String,
    val lat: String,
    val lng: String,
    val location: String,
    val intensity: String? = null,
    val isFinal: String? = null,
    val isCancel: String? = null,
)

/**
 * 自定义源配置（与 JS 层 SourceConfig 中 customSource 类型对等）
 */
data class CustomSourceConfig(
    /** 源唯一 ID（使用 priority 字符串，保证唯一） */
    val id: String,
    /** 显示名称 */
    val name: String,
    /** 数据源类别："eew" 或 "eqlist" */
    val category: String,
    /** 协议："ws" 或 "http" */
    val protocol: String,
    /** URL 端点 */
    val endpoint: String,
    /** 鉴权 token（可选） */
    val authToken: String? = null,
    /** HTTP 模式轮询间隔（毫秒） */
    val pollIntervalMs: Long = 2000L,
    /** 字段映射规则 */
    val fieldMapping: FieldMapping,
)

/**
 * 解析后的地震事件（与 JS 层 EewEvent 对等，供 EewBackgroundService 使用）
 */
data class ParsedCustomEvent(
    val eventId: String,
    val originTime: Long,
    val magnitude: Double,
    val depth: Double,
    val lat: Double,
    val lng: Double,
    val location: String,
    val intensity: Double? = null,
    val isFinal: Boolean = false,
    val isCancel: Boolean = false,
)

/**
 * 自定义源连接管理器
 *
 * 生命周期：
 * - start()：启动连接（WS 或 HTTP）
 * - stop()：主动断开，释放资源
 *
 * 回调：
 * - Listener.onEvent(event)：收到有效事件
 * - Listener.onStatus(status, message)：连接状态变化
 *
 * 用法：
 * ```kotlin
 * val manager = CustomSourceManager(config, client, listener)
 * manager.start()
 * // ... 使用中
 * manager.stop()
 * ```
 */
class CustomSourceManager(
    private val config: CustomSourceConfig,
    private val client: OkHttpClient,
    private val listener: Listener,
) {

    /** 回调接口 */
    interface Listener {
        /**
         * 收到一批有效事件（必填字段齐全的元素）
         *
         * 列表 API 场景下可能包含多个事件；单事件 API 场景下为单元素列表。
         * 空列表不会触发此回调（由调用方判断）。
         */
        fun onEvents(events: List<ParsedCustomEvent>)
        /** 连接状态变化：connecting / connected / disconnected / error */
        fun onStatus(status: String, message: String?)
    }

    companion object {
        private const val TAG = "CustomSourceManager"

        /** 初始重连延迟（毫秒） */
        private const val INITIAL_RECONNECT_DELAY_MS = 1000L

        /** 最大重连延迟（毫秒） */
        private const val MAX_RECONNECT_DELAY_MS = 30_000L

        /** HTTP 心跳超时倍数 */
        private const val HEARTBEAT_TIMEOUT_MULTIPLIER = 3L

        /** HTTP 心跳超时下限（毫秒） */
        private const val HEARTBEAT_TIMEOUT_MIN_MS = 10_000L
    }

    /** 主线程 Handler（用于回调到主线程） */
    private val mainHandler = Handler(Looper.getMainLooper())

    /** WebSocket 实例（仅 WS 模式使用） */
    private var webSocket: WebSocket? = null

    /** 是否为主动关闭 */
    private var isManualClose = false

    /** 重连延迟（指数退避） */
    private var reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS

    /** 重连 Runnable */
    private var reconnectRunnable: Runnable? = null

    /** HTTP 轮询 Runnable */
    private var pollRunnable: Runnable? = null

    /** 上次成功响应时间戳（HTTP 心跳检测） */
    private var lastSuccessAt = 0L

    /** 是否已启动 */
    private var started = false

    /**
     * 启动连接
     */
    fun start() {
        if (started) return
        started = true
        isManualClose = false
        reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS

        when (config.protocol) {
            "ws" -> startWebSocket()
            "http" -> startHttpPolling()
            else -> {
                Log.e(TAG, "[${config.name}] 不支持的协议: ${config.protocol}")
                listener.onStatus("error", "不支持的协议: ${config.protocol}")
            }
        }
    }

    /**
     * 主动停止连接
     */
    fun stop() {
        if (!started) return
        started = false
        isManualClose = true

        // 取消重连
        reconnectRunnable?.let { mainHandler.removeCallbacks(it) }
        reconnectRunnable = null

        // 取消轮询
        pollRunnable?.let { mainHandler.removeCallbacks(it) }
        pollRunnable = null

        // 关闭 WebSocket
        webSocket?.close(1000, "Manager stopped")
        webSocket = null

        listener.onStatus("disconnected", null)
        Log.i(TAG, "[${config.name}] 已停止")
    }

    // ======================== WebSocket 模式 ========================

    private fun startWebSocket() {
        listener.onStatus("connecting", null)
        Log.i(TAG, "[${config.name}] WebSocket 连接 ${config.endpoint}")

        // 解析 URL 并追加鉴权 token（如果配置）
        // 使用扩展函数 toHttpUrlOrNull() 替代已弃生的 HttpUrl.parse()
        val baseUrl = config.endpoint.toHttpUrlOrNull()
        if (baseUrl == null) {
            Log.e(TAG, "[${config.name}] 无效 URL: ${config.endpoint}")
            listener.onStatus("error", "无效 URL: ${config.endpoint}")
            return
        }
        val finalUrl = if (!config.authToken.isNullOrEmpty()) {
            baseUrl.newBuilder().addQueryParameter("token", config.authToken).build()
        } else {
            baseUrl
        }

        val request = Request.Builder().url(finalUrl).build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "[${config.name}] WebSocket 已连接")
                reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
                mainHandler.post {
                    if (started) {
                        listener.onStatus("connected", null)
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleRawMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "[${config.name}] WebSocket 错误: ${t.message}")
                this@CustomSourceManager.webSocket = null
                if (!isManualClose && started) {
                    mainHandler.post {
                        if (started) {
                            listener.onStatus("error", "WebSocket 错误: ${t.message}")
                            scheduleReconnect()
                        }
                    }
                }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "[${config.name}] WebSocket 关闭: $code $reason")
                this@CustomSourceManager.webSocket = null
                if (!isManualClose && started) {
                    mainHandler.post {
                        if (started) {
                            listener.onStatus("disconnected", "WebSocket 断开，准备重连")
                            scheduleReconnect()
                        }
                    }
                }
            }
        })
    }

    /**
     * 指数退避重连
     */
    private fun scheduleReconnect() {
        if (isManualClose || !started) return
        reconnectRunnable?.let { mainHandler.removeCallbacks(it) }

        val delay = reconnectDelayMs
        Log.i(TAG, "[${config.name}] ${delay}ms 后重连")
        listener.onStatus("connecting", "${delay}ms 后重连")

        val r = Runnable {
            if (!isManualClose && started) {
                reconnectDelayMs = minOf(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
                startWebSocket()
            }
        }
        reconnectRunnable = r
        mainHandler.postDelayed(r, delay)
    }

    // ======================== HTTP GET 轮询模式 ========================

    private fun startHttpPolling() {
        listener.onStatus("connecting", null)
        Log.i(TAG, "[${config.name}] HTTP 轮询 ${config.endpoint} interval=${config.pollIntervalMs}ms")

        // 立即拉取一次（异步 enqueue，不阻塞）
        if (started) {
            pollOnce()
        }

        // 启动定时轮询
        scheduleNextPoll()
    }

    /**
     * 调度下一次轮询
     * 采用递归调度模式，避免 Runnable 自引用的副作用
     */
    private fun scheduleNextPoll() {
        if (!started) return
        val r = Runnable {
            if (started) {
                pollOnce()
                scheduleNextPoll()
            }
        }
        pollRunnable = r
        mainHandler.postDelayed(r, config.pollIntervalMs)
    }

    private fun pollOnce() {
        val requestBuilder = Request.Builder().url(config.endpoint).get()
        if (!config.authToken.isNullOrEmpty()) {
            requestBuilder.addHeader("Authorization", "Bearer ${config.authToken}")
        }

        client.newCall(requestBuilder.build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "[${config.name}] HTTP 拉取失败: ${e.message}")
                mainHandler.post {
                    if (started) {
                        listener.onStatus("error", "HTTP 拉取失败: ${e.message}")
                    }
                }
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    if (!response.isSuccessful) {
                        Log.e(TAG, "[${config.name}] HTTP 错误: ${response.code}")
                        mainHandler.post {
                            if (started) {
                                listener.onStatus("error", "HTTP ${response.code}")
                            }
                        }
                        return
                    }
                    val body = response.body?.string() ?: return
                    lastSuccessAt = System.currentTimeMillis()
                    handleRawMessage(body)

                    // 首次成功后上报 connected
                    mainHandler.post {
                        if (started) {
                            listener.onStatus("connected", null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "[${config.name}] HTTP 响应处理异常: ${e.message}")
                } finally {
                    response.close()
                }
            }
        })
    }

    // ======================== 消息解析 ========================

    /**
     * 处理原始消息（WS 文本或 HTTP 响应体）
     *
     * 1. 解析 JSON
     * 2. 调用 parseEvents 提取事件列表（支持 listPath 列表 API 和单事件 API）
     * 3. 回调 Listener.onEvents（仅在列表非空时）
     */
    private fun handleRawMessage(text: String) {
        try {
            val json = JSONTokener(text).nextValue()
            val events = parseEvents(json)
            if (events.isEmpty()) {
                Log.d(TAG, "[${config.name}] 解析后无有效事件，跳过")
                return
            }
            mainHandler.post {
                if (started) {
                    listener.onEvents(events)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "[${config.name}] 消息解析失败: ${e.message}")
        }
    }

    /**
     * 解析事件列表（支持列表 API 和单事件 API）
     *
     * 行为：
     * - 若 fieldMapping.listPath 配置：先用 listPath 提取数组，
     *   再对每个数组元素调用 parseSingleEvent（字段映射相对于元素），返回所有有效事件
     * - 若 listPath 未配置：对根对象调用 parseSingleEvent，返回单元素列表或空列表
     *
     * @return ParsedCustomEvent 列表（可能为空）
     */
    private fun parseEvents(json: Any?): List<ParsedCustomEvent> {
        val mapping = config.fieldMapping
        val listPath = mapping.listPath

        if (!listPath.isNullOrEmpty()) {
            val arr = JsonPathExtractor.extractArray(json, listPath) ?: run {
                Log.d(TAG, "[${config.name}] listPath $listPath 提取为空")
                return emptyList()
            }
            val events = mutableListOf<ParsedCustomEvent>()
            for (item in arr) {
                val event = parseSingleEvent(item)
                if (event != null) {
                    events.add(event)
                }
            }
            if (events.isEmpty()) {
                Log.d(TAG, "[${config.name}] 列表解析后无有效事件")
            }
            return events
        }

        // 无 listPath：单事件解析
        val single = parseSingleEvent(json) ?: return emptyList()
        return listOf(single)
    }

    /**
     * 从单个数据对象提取字段构造 ParsedCustomEvent
     *
     * 必填字段（eventId/originTime/magnitude/depth/lat/lng/location）缺失时返回 null。
     * 可选字段（intensity/isFinal/isCancel）缺失时使用默认值。
     *
     * 注意：raw 是单个事件对象（而非整个 API 响应）。
     * 列表 API 场景下，由 parseEvents 先用 listPath 提取数组元素后传入。
     */
    private fun parseSingleEvent(raw: Any?): ParsedCustomEvent? {
        val mapping = config.fieldMapping

        // 必填字段
        val eventId = JsonPathExtractor.extractString(raw, mapping.eventId) ?: return null
        val originTime = JsonPathExtractor.extractLong(raw, mapping.originTime) ?: return null
        val magnitude = JsonPathExtractor.extractNumber(raw, mapping.magnitude) ?: return null
        val depth = JsonPathExtractor.extractNumber(raw, mapping.depth) ?: return null
        val lat = JsonPathExtractor.extractNumber(raw, mapping.lat) ?: return null
        val lng = JsonPathExtractor.extractNumber(raw, mapping.lng) ?: return null
        val location = JsonPathExtractor.extractString(raw, mapping.location) ?: return null

        // 可选字段
        val intensity = mapping.intensity?.let {
            JsonPathExtractor.extractNumber(raw, it)
        }
        val isFinal = mapping.isFinal?.let {
            JsonPathExtractor.extractBoolean(raw, it, false)
        } ?: false
        val isCancel = mapping.isCancel?.let {
            JsonPathExtractor.extractBoolean(raw, it, false)
        } ?: false

        return ParsedCustomEvent(
            eventId = eventId,
            originTime = originTime,
            magnitude = magnitude,
            depth = depth,
            lat = lat,
            lng = lng,
            location = location,
            intensity = intensity,
            isFinal = isFinal,
            isCancel = isCancel,
        )
    }
}
