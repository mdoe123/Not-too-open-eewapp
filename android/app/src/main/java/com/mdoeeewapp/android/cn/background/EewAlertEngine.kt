package com.mdoeeewapp.android.cn.background

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 地震预警计算引擎（原生层）
 *
 * 与 JS 层 `src/utils/eew.ts` 保持算法一致：
 * - `calcCsis`：CSIS 烈度预估（CEA + ICL 模型平均）
 * - `haversineDistance`：球面距离
 * - `computeSWaveArrivalMs`：S 波到达时间戳（Unix 毫秒）
 * - `computeAlertLevelByIntensity`：按烈度分档预警级别
 *
 * 同时提供 customSource 数据解析（[parseWithMapping]），按用户配置的 [FieldMapping]
 * 从任意 JSON 数据中提取地震事件字段。
 *
 * 设计要点：
 * - 所有方法静态，无状态，线程安全
 * - 输入异常返回安全默认值（0 或 null），不抛异常
 */
object EewAlertEngine {

  /** S 波平均传播速度（km/s） */
  private const val S_WAVE_VELOCITY = 3.5

  /** 地球半径（km） */
  private const val EARTH_RADIUS_KM = 6371.0

  /** 预警级别常量（与 JS AlertLevel 一致） */
  const val LEVEL_SILENT = "silent"
  const val LEVEL_BLUE = "blue"
  const val LEVEL_YELLOW = "yellow"
  const val LEVEL_ORANGE = "orange"
  const val LEVEL_RED = "red"

  /**
   * Haversine 公式计算两点间球面距离（km）
   *
   * @param lat1 起点纬度
   * @param lng1 起点经度
   * @param lat2 终点纬度
   * @param lng2 终点经度
   * @returns 距离（km），输入非法返回 0.0
   */
  fun haversineDistance(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
    val dLat = toRad(lat2 - lat1)
    val dLng = toRad(lng2 - lng1)
    val a = sin(dLat / 2).let { it * it } +
      cos(toRad(lat1)) * cos(toRad(lat2)) * sin(dLng / 2).let { it * it }
    return EARTH_RADIUS_KM * 2 * atan2(sqrt(a), sqrt(1 - a))
  }

  /**
   * CSIS 烈度预估算法
   * 与 JS 层 `calcCsis` 完全一致：综合 CEA 和 ICL 两种模型取平均
   *
   * @param m 震级
   * @param dep 震源深度（km）
   * @param dis 震中距离（km，地表距离）
   * @returns 预估 CSIS 烈度值，参数非法或距离过远返回 0.0
   */
  fun calcCsis(m: Double, depInput: Double, dis: Double): Double {
    if (m.isNaN() || depInput.isNaN() || dis.isNaN()) return 0.0
    if (dis > 10000) return 0.0

    val dep = if (depInput >= 10) depInput else (maxOf(depInput, 0.0) + 10) / 2

    val r = EARTH_RADIUS_KM
    val theta = dis / r
    val a = r - dep
    val lineDis = sqrt(a * a + r * r - 2 * a * r * cos(theta))

    val k = 1 - 0.7 / sqrt(dep / 10)
    val hypoDis = lineDis - k * dep

    val safeHypo = if (hypoDis > 0) hypoDis else 1.0
    val ceaCsis = 1.297 * m - 4.368 * log10(safeHypo + 8) + 5.363
    val iclCsis = 1.363 * m - 1.494 * ln(safeHypo) + 2.941

    return (ceaCsis + iclCsis) / 2
  }

  /**
   * 计算 S 波到达用户位置的时间戳（Unix 毫秒）
   *
   * @param originTimeMs 发震时间（Unix 毫秒）
   * @param eventLat 事件纬度
   * @param eventLng 事件经度
   * @param userLat 用户纬度
   * @param userLng 用户经度
   * @returns S 波到达时间戳（Unix 毫秒）
   */
  fun computeSWaveArrivalMs(
    originTimeMs: Long,
    eventLat: Double,
    eventLng: Double,
    userLat: Double,
    userLng: Double,
  ): Long {
    val distance = haversineDistance(eventLat, eventLng, userLat, userLng)
    val travelTimeSec = distance / S_WAVE_VELOCITY
    return originTimeMs + (travelTimeSec * 1000).toLong()
  }

  /**
   * 按预估地震烈度计算预警级别（DB/T 113.1-2026 标准）
   *
   * - 烈度 ≥ 7:  red
   * - 烈度 ≥ 5:  orange
   * - 烈度 ≥ 3:  yellow
   * - 烈度 ≥ 1:  blue
   * - 烈度 < 1:  silent
   */
  fun computeAlertLevelByIntensity(intensity: Double): String {
    if (intensity >= 7) return LEVEL_RED
    if (intensity >= 5) return LEVEL_ORANGE
    if (intensity >= 3) return LEVEL_YELLOW
    if (intensity >= 1) return LEVEL_BLUE
    return LEVEL_SILENT
  }

  /**
   * 按 [FieldMapping] 配置解析 customSource 数据为事件
   *
   * 与 JS 层 `CustomSourceAdapter.buildEvents` 行为一致：
   * - 若 [FieldMapping.listPath] 配置：先提取数组，取第一个有效元素应用字段映射
   *   （锁屏预警每次只处理一个事件，取数组首个即最新事件）
   * - 若 [FieldMapping.listPath] 未配置：直接对根对象应用字段映射
   *
   * 必填字段（eventId/originTime/magnitude/depth/lat/lng/location）缺失返回 null。
   * 可选字段（intensity/isFinal/isCancel）缺失时使用默认值。
   *
   * @param raw 原始 JSON 文本
   * @param mapping 字段映射配置
   * @returns 解析后的事件，解析失败返回 null
   */
  fun parseWithMapping(raw: String, mapping: FieldMapping): ParsedCencEvent? {
    return try {
      val root: Any = try {
        JSONObject(raw)
      } catch (_: JSONException) {
        try {
          JSONArray(raw)
        } catch (_: JSONException) {
          return null
        }
      }

      // 若配置 listPath：提取数组，取第一个元素作为事件对象
      val eventObj: Any? = if (!mapping.listPath.isNullOrEmpty()) {
        val arr = FieldMappingParser.extractArray(root, mapping.listPath)
        arr?.firstOrNull()
      } else {
        root
      }
      if (eventObj == null) return null

      // 必填字段提取（缺失返回 null）
      val eventId = FieldMappingParser.extractString(eventObj, mapping.eventId) ?: return null
      val originTime = FieldMappingParser.extractNumber(eventObj, mapping.originTime) ?: return null
      val magnitude = FieldMappingParser.extractNumber(eventObj, mapping.magnitude) ?: return null
      val depth = FieldMappingParser.extractNumber(eventObj, mapping.depth) ?: return null
      val lat = FieldMappingParser.extractNumber(eventObj, mapping.lat) ?: return null
      val lng = FieldMappingParser.extractNumber(eventObj, mapping.lng) ?: return null
      val location = FieldMappingParser.extractString(eventObj, mapping.location) ?: return null

      // 可选字段提取
      val intensity = mapping.intensity?.let {
        FieldMappingParser.extractNumber(eventObj, it)
      }
      val isFinal = mapping.isFinal?.let {
        FieldMappingParser.extractBoolean(eventObj, it)
      } ?: false
      val isCancel = mapping.isCancel?.let {
        FieldMappingParser.extractBoolean(eventObj, it)
      } ?: false
      val reportNum = mapping.reportNum?.let {
        FieldMappingParser.extractNumber(eventObj, it)
      }

      ParsedCencEvent(
        eventId = eventId,
        originTime = originTime.toLong(),
        magnitude = magnitude,
        depth = depth,
        lat = lat,
        lng = lng,
        location = location,
        maxIntensity = intensity,
        isCancel = isCancel,
        isFinal = isFinal,
        reportNum = reportNum?.toInt(),
      )
    } catch (_: Exception) {
      null
    }
  }

  /** 角度转弧度 */
  private fun toRad(deg: Double): Double = deg * PI / 180.0
}

/**
 * 通用解析后的地震事件结构
 *
 * 由 [EewAlertEngine.parseWithMapping] 按 [FieldMapping] 配置解析任意 JSON 数据生成。
 * 供 EewBackgroundService 用于锁屏预警触发判定。
 */
data class ParsedCencEvent(
  /** 事件唯一 ID */
  val eventId: String,
  /** 发震时间（Unix 毫秒） */
  val originTime: Long,
  /** 震级 */
  val magnitude: Double,
  /** 震源深度（km） */
  val depth: Double,
  /** 震中纬度 */
  val lat: Double,
  /** 震中经度 */
  val lng: Double,
  /** 震中位置描述 */
  val location: String,
  /** 最大烈度（可能为 null） */
  val maxIntensity: Double?,
  /** 是否为取消报 */
  val isCancel: Boolean,
  /** 是否为最终报 */
  val isFinal: Boolean,
  /** 报数（第几报，若数据源提供） */
  val reportNum: Int? = null,
)
