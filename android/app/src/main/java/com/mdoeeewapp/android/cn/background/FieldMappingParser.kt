package com.mdoeeewapp.android.cn.background

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * 字段映射解析器（原生层，锁屏预警使用）
 *
 * 移植自 JS 层 `src/sources/custom/jsonPathExtract.ts`，按用户的 fieldMapping 配置
 * 从任意 JSON 数据中提取地震事件字段。
 *
 * 路径表达式语法：
 * - $ 根对象
 * - $.field 字段访问
 * - $.a.b.c 嵌套字段
 * - $.array[0] 数组索引
 * - $.field? 可选标记（缺失返回 null，不报错）
 * - $.time * 1000 四则运算（+ - * /）
 * - Date.parse($.time) 函数调用（解析日期字符串为 Unix 毫秒）
 * - $.No* glob 通配符（按 key 前缀匹配，提取为对象数组）
 *
 * 设计要点：
 * - 所有方法静态，无状态，线程安全
 * - 输入异常返回 null，不抛异常（锁屏预警不能因解析失败而崩溃）
 * - 与 JS 层 jsonPathExtract.ts 保持行为一致
 */
object FieldMappingParser {

  /** 运算符正则：匹配 + - * /（前后有空格） */
  private val OPERATOR_REGEX = Regex("""\s+([+\-*/])\s+(.+)""")

  /** 数字字面量正则 */
  private val NUMBER_LITERAL_REGEX = Regex("""^-?\d+(\.\d+)?$""")

  /** Date.parse(<path>) 函数调用语法正则 */
  private val DATE_PARSE_REGEX = Regex("""^Date\.parse\((.+)\)$""")

  /** 日期解析格式（wolfx 风格 "yyyy-MM-dd HH:mm:ss"，UTC+8） */
  private val DATE_FORMAT = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("Asia/Shanghai")
  }

  /**
   * 从原始数据中按路径表达式提取值
   *
   * @param raw 已解析的 JSON 数据（JSONObject / JSONArray / 原始值）
   * @param pathExpr 路径表达式，如 $.id、$.time * 1000、$.intensity?、Date.parse($.time)
   * @returns 提取的值，可选字段缺失或解析失败返回 null
   */
  fun extractByPath(raw: Any?, pathExpr: String): Any? {
    if (pathExpr.isEmpty()) return null

    // 检测是否为 Date.parse(<path>) 函数调用
    val dateParseMatch = DATE_PARSE_REGEX.find(pathExpr)
    if (dateParseMatch != null) {
      return tryParseDate(raw, dateParseMatch.groupValues[1].trim())
    }

    // 检测是否为"路径 + 表达式"（含运算符）
    val exprResult = tryEvaluateExpression(raw, pathExpr)
    if (exprResult.first) {
      return exprResult.second
    }

    // 纯路径解析
    return resolvePath(raw, pathExpr)
  }

  /**
   * 尝试解析日期字符串为 Unix 毫秒
   *
   * 支持格式（与 JS 层及 JsonPathExtractor.kt 对等）：
   * - "2026-07-18 13:47:20"（wolfx 风格，UTC+8 时区）
   * - "2026-07-18T13:47:20"（ISO 8601 无时区，按 UTC+8 解析）
   * - "2026-07-18T13:47:20+08:00"（ISO 8601 带时区，直接解析）
   * - 已是数字（Unix 秒/毫秒）：直接返回
   *
   * @param raw 原始数据
   * @param pathExpr 日期字段路径表达式
   * @return Unix 毫秒（Long），解析失败返回 null
   */
  private fun tryParseDate(raw: Any?, pathExpr: String): Long? {
    val value = resolvePath(raw, pathExpr) ?: return null

    when (value) {
      is Number -> {
        val d = value.toDouble()
        return if (d.isFinite()) d.toLong() else null
      }
      is String -> {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null

        // 纯数字字符串
        if (trimmed.matches(Regex("""^-?\d+$"""))) {
          return trimmed.toLongOrNull()
        }

        // 标准化解析
        return try {
          var normalized = trimmed.replace('T', ' ')
          normalized = normalized.replace(Regex("""[zZ]$"""), "")
          normalized = normalized.replace(Regex("""[+-]\d{2}:?\d{2}$"""), "")
          normalized = normalized.trim()

          synchronized(DATE_FORMAT) {
            DATE_FORMAT.parse(normalized)?.time
          }
        } catch (_: Exception) {
          null
        }
      }
    }
    return null
  }

  /**
   * 提取并转为 String，失败返回 defaultValue
   */
  fun extractString(raw: Any?, pathExpr: String, defaultValue: String? = null): String? {
    val value = extractByPath(raw, pathExpr)
    if (value == null) return defaultValue
    return value.toString()
  }

  /**
   * 提取并转为 Double，失败返回 defaultValue
   */
  fun extractNumber(raw: Any?, pathExpr: String, defaultValue: Double? = null): Double? {
    val value = extractByPath(raw, pathExpr)
    if (value == null) return defaultValue
    return toNumber(value) ?: defaultValue
  }

  /**
   * 提取并转为 Boolean，失败返回 defaultValue
   *
   * 宽松解析：
   * - Boolean 直接返回
   * - Number: 0 → false，非 0 → true
   * - String: "true"/"1" → true，"false"/"0"/"" → false（大小写不敏感）
   */
  fun extractBoolean(raw: Any?, pathExpr: String, defaultValue: Boolean = false): Boolean {
    val value = extractByPath(raw, pathExpr)
    if (value == null) return defaultValue
    when (value) {
      is Boolean -> return value
      is Number -> return value.toDouble() != 0.0
      is String -> {
        val lower = value.lowercase().trim()
        if (lower == "true" || lower == "1") return true
        if (lower == "false" || lower == "0" || lower.isEmpty()) return false
      }
    }
    return defaultValue
  }

  /**
   * 提取并转为 List，失败返回 null
   *
   * 用于 listPath 场景：从响应根对象提取事件数组。
   */
  fun extractArray(raw: Any?, pathExpr: String): List<Any?>? {
    val value = extractByPath(raw, pathExpr)
    if (value == null) return null
    if (value is JSONArray) {
      return (0 until value.length()).map { value[it] }
    }
    if (value is List<*>) {
      return value
    }
    // 非数组值容错包装为单元素列表
    return listOf(value)
  }

  // ======================== 内部实现 ========================

  /**
   * 尝试将路径表达式作为"路径 + 表达式"求值
   *
   * 匹配格式：<路径> <运算符> <路径|数字>
   * 例如：$.time * 1000、$.depth / 1000
   *
   * @returns Pair(matched, value)：matched=true 表示匹配成功
   */
  private fun tryEvaluateExpression(raw: Any?, pathExpr: String): Pair<Boolean, Any?> {
    val match = OPERATOR_REGEX.find(pathExpr) ?: return Pair(false, null)

    val leftExpr = pathExpr.substring(0, match.range.first).trim()
    val operator = match.groupValues[1]
    val rightExpr = match.groupValues[2].trim()

    if (leftExpr.isEmpty() || rightExpr.isEmpty()) {
      return Pair(false, null)
    }

    // 解析左操作数
    val leftValue = resolvePath(raw, leftExpr) ?: return Pair(true, null)
    val leftNum = toNumber(leftValue) ?: return Pair(false, null)

    // 解析右操作数（可为路径或数字字面量）
    val rightNum: Double? = if (NUMBER_LITERAL_REGEX.matches(rightExpr)) {
      rightExpr.toDoubleOrNull()
    } else {
      val rightValue = resolvePath(raw, rightExpr) ?: return Pair(true, null)
      toNumber(rightValue)
    }
    if (rightNum == null) return Pair(false, null)

    // 四则运算
    val result: Double = when (operator) {
      "+" -> leftNum + rightNum
      "-" -> leftNum - rightNum
      "*" -> leftNum * rightNum
      "/" -> {
        if (rightNum == 0.0) return Pair(true, null)
        leftNum / rightNum
      }
      else -> return Pair(false, null)
    }

    return Pair(true, result)
  }

  /**
   * 将值转为 Double，失败返回 null
   */
  private fun toNumber(value: Any?): Double? {
    when (value) {
      is Number -> {
        val d = value.toDouble()
        return if (d.isNaN() || d.isInfinite()) null else d
      }
      is String -> {
        val parsed = value.toDoubleOrNull()
        if (parsed != null && !parsed.isNaN() && !parsed.isInfinite()) return parsed
      }
      is Boolean -> return if (value) 1.0 else 0.0
    }
    return null
  }

  /**
   * 按纯路径解析值
   *
   * 支持语法：$、$.field、$.a.b.c、$.array[0]、$.field?
   */
  private fun resolvePath(raw: Any?, pathExpr: String): Any? {
    var expr = pathExpr.trim()
    if (expr.isEmpty()) return null

    // 处理可选标记
    var optional = false
    if (expr.endsWith("?")) {
      optional = true
      expr = expr.dropLast(1).trim()
    }

    // 根对象
    if (expr == "$") {
      return raw
    }

    // 必须以 $. 开头
    if (!expr.startsWith("$.")) {
      return null
    }

    // 去掉 $. 前缀
    val pathStr = expr.substring(2)
    if (pathStr.isEmpty()) {
      return raw
    }

    // 分词
    val tokens = tokenizePath(pathStr)
    if (tokens.isEmpty()) return null

    // 逐级访问
    var current: Any? = raw
    for (i in tokens.indices) {
      val token = tokens[i]
      if (current == null) return null
      when (token) {
        is Int -> {
          // 数组索引
          if (current is JSONArray) {
            if (token < 0 || token >= current.length()) return if (optional) null else null
            current = current[token]
          } else {
            return if (optional) null else null
          }
        }
        is String -> {
          if (token.endsWith("*") && token.length > 1) {
            // glob 通配符：按 key 前缀匹配，收集为 JSONArray
            // 仅支持末尾 *，如 No* 匹配 No1、No2...No50
            // 必须是路径的最后一段
            if (i != tokens.size - 1) return if (optional) null else null
            if (current !is JSONObject) return if (optional) null else null
            val prefix = token.substring(0, token.length - 1)
            val collected = JSONArray()
            val keysIter = current.keys()
            while (keysIter.hasNext()) {
              val key = keysIter.next()
              if (key.startsWith(prefix) && key.length > prefix.length) {
                try {
                  collected.put(current.get(key))
                } catch (_: Exception) {
                  // 跳过无法读取的 key
                }
              }
            }
            current = collected
          } else {
            // 字段访问
            if (current is JSONObject) {
              if (!current.has(token)) return if (optional) null else null
              current = current[token]
            } else {
              return if (optional) null else null
            }
          }
        }
      }
    }

    return current
  }

  /**
   * 将路径字符串分词为字段名与数组索引
   *
   * 例如：a.b[0].c → ["a", "b", 0, "c"]
   *      events[0].id → ["events", 0, "id"]
   */
  private fun tokenizePath(pathStr: String): List<Any> {
    val tokens = mutableListOf<Any>()
    var i = 0
    val len = pathStr.length

    while (i < len) {
      val ch = pathStr[i]

      if (ch == '.') {
        i++
        continue
      }

      if (ch == '[') {
        // 数组索引
        i++ // 跳过 [
        val numStr = StringBuilder()
        while (i < len && pathStr[i] != ']') {
          numStr.append(pathStr[i])
          i++
        }
        if (i < len && pathStr[i] == ']') {
          i++ // 跳过 ]
        }
        numStr.toString().trim().toIntOrNull()?.let { tokens.add(it) }
        continue
      }

      // 字段名（直到遇到 . 或 [）
      val fieldName = StringBuilder()
      while (i < len && pathStr[i] != '.' && pathStr[i] != '[') {
        fieldName.append(pathStr[i])
        i++
      }
      if (fieldName.isNotEmpty()) {
        tokens.add(fieldName.toString())
      }
    }

    return tokens
  }
}

/**
 * 字段映射配置（与 JS 层 FieldMapping 接口对应）
 *
 * 由 EewBackgroundService 从 SharedPreferences 中读取用户配置的 customSource，
 * 传入 FieldMappingParser 按 pathExpr 提取字段。
 */
data class FieldMapping(
  /** 列表路径（可选，配置时先提取数组再对每个元素应用字段映射） */
  val listPath: String? = null,
  /** 事件唯一 ID（必填） */
  val eventId: String,
  /** 发震时间 Unix 毫秒（必填） */
  val originTime: String,
  /** 震级（必填） */
  val magnitude: String,
  /** 震源深度 km（必填） */
  val depth: String,
  /** 震中纬度（必填） */
  val lat: String,
  /** 震中经度（必填） */
  val lng: String,
  /** 震中位置描述（必填） */
  val location: String,
  /** 预估烈度（可选） */
  val intensity: String? = null,
  /** 是否最终报（可选） */
  val isFinal: String? = null,
  /** 是否取消报（可选） */
  val isCancel: String? = null,
  /** 报数/第几报（可选，如 CENC 的 ReportNum 字段） */
  val reportNum: String? = null,
  /** 测定类型（可选，如 CENC 的 type 字段，值为 'auto'/'reviewed'） */
  val reportType: String? = null,
)
