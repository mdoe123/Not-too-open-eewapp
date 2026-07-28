// 路径表达式提取工具（原生层，锁屏时使用）
//
// 从 JSON 数据中按"路径表达式"提取字段值，供 CustomSourceManager 解析自定义源数据。
// 与 JS 层 jsonPathExtract.ts 对等实现，保证用户配置同一份 fieldMapping 在前台/锁屏解析结果一致。
//
// 语法说明（与 JS 层完全一致）：
// - 根对象：$
// - 字段访问：$.id、$.data.mag
// - 数组索引：$.events[0].id
// - 可选标记：$.intensity?（缺失时返回 null，不报错）
// - 四则运算：$.time * 1000、$.depth / 1000
// - 函数调用：Date.parse($.time)（解析日期字符串为 Unix 毫秒）
// - glob 通配符：$.No*（按 key 前缀匹配，提取为对象数组）
//
// 表达式支持运算符：+ - * /
// 操作数可为路径（$.xxx）或数字字面量（1000、3.14）
//
// 合规设计：本工具仅按用户配置的路径/表达式提取 JSON 字段，不执行用户代码，不内置转发逻辑。

package com.mdoeeewapp.android.cn.sources

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * 路径表达式提取工具（与 JS 层 jsonPathExtract.ts 对等）
 *
 * 用法：
 * ```kotlin
 * val raw = JSONObject("""{"id":"abc","mag":5.6,"time":1700000000}""")
 * val id = JsonPathExtractor.extractString(raw, "$.id")         // "abc"
 * val mag = JsonPathExtractor.extractNumber(raw, "$.mag")       // 5.6
 * val timeMs = JsonPathExtractor.extractNumber(raw, "$.time * 1000")  // 1.7E12
 * val intensity = JsonPathExtractor.extractNumber(raw, "$.intensity?")  // null（可选缺失）
 * val originTime = JsonPathExtractor.extractLong(raw, "Date.parse(\$.OriginTime)")  // Unix 毫秒
 * ```
 */
object JsonPathExtractor {

    /** 运算符正则：匹配 + - * /（前后有至少一个空格） */
    private val OPERATOR_REGEX = Regex("""\s+([+\-*/])\s+(.+)""")

    /** 数字字面量正则（支持负数和小数） */
    private val NUMBER_LITERAL_REGEX = Regex("""^-?\d+(\.\d+)?$""")

    /** Date.parse(<path>) 函数调用语法正则 */
    private val DATE_PARSE_REGEX = Regex("""^Date\.parse\((.+)\)$""")

    /** 日期解析格式（wolfx 风格 "yyyy-MM-dd HH:mm:ss"） */
    private val DATE_FORMAT = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("Asia/Shanghai")
    }

    /**
     * 从原始数据中按路径表达式提取值
     *
     * @param raw 已解析的 JSON 数据（JSONObject/JSONArray/原始类型/null）
     * @param pathExpr 路径表达式，如 $.id、$.time * 1000、$.intensity?、Date.parse($.time)
     * @return 提取的值（可能为 String/Number/Boolean/JSONObject/JSONArray），可选字段缺失时返回 null
     */
    fun extract(raw: Any?, pathExpr: String?): Any? {
        if (pathExpr.isNullOrEmpty()) {
            return null
        }

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
     * 支持格式（与 JS 层对等）：
     * - "2026-07-18 13:47:20"（wolfx 风格，UTC+8 时区）
     * - "2026-07-18T13:47:20"（ISO 8601 无时区，按 UTC+8 解析）
     * - "2026-07-18T13:47:20+08:00"（ISO 8601 带时区，直接解析）
     * - 已是数字（Unix 秒/毫秒）：直接返回
     *
     * 时区策略：wolfx API 明确标注 UTC+8，固定按 Asia/Shanghai 时区解析。
     *
     * @param raw 原始数据
     * @param pathExpr 日期字段路径表达式
     * @return Unix 毫秒（Long），解析失败返回 null
     */
    private fun tryParseDate(raw: Any?, pathExpr: String): Long? {
        val value = resolvePath(raw, pathExpr) ?: return null

        // 数字直接返回
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
                    val num = trimmed.toLongOrNull()
                    return num
                }

                // 标准化解析（线程安全：每次新建 SimpleDateFormat）
                return try {
                    // 替换 T 为空格，去除时区后用 SimpleDateFormat 按 UTC+8 解析
                    var normalized = trimmed.replace('T', ' ')
                    // 去除末尾时区标识（Z、+08:00、+0800）
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
     * 提取并转为 String，失败返回默认值
     */
    fun extractString(raw: Any?, pathExpr: String?, default: String? = null): String? {
        val value = extract(raw, pathExpr) ?: return default
        return when (value) {
            is String -> value
            else -> value.toString()
        }
    }

    /**
     * 提取并转为 Double，失败返回默认值
     *
     * - Number 直接转 Double
     * - String 尝试解析为 Double
     * - Boolean: true → 1.0, false → 0.0
     * - 其他返回默认值
     */
    fun extractNumber(raw: Any?, pathExpr: String?, default: Double? = null): Double? {
        val value = extract(raw, pathExpr) ?: return default
        return toNumber(value) ?: default
    }

    /**
     * 提取并转为 Long，失败返回默认值
     *
     * 用于时间戳字段（originTime），避免 Double 精度损失。
     */
    fun extractLong(raw: Any?, pathExpr: String?, default: Long? = null): Long? {
        val value = extract(raw, pathExpr) ?: return default
        return when (value) {
            is Number -> value.toLong()
            is String -> value.toLongOrNull() ?: default
            is Boolean -> if (value) 1L else 0L
            else -> default
        }
    }

    /**
     * 提取并转为 Boolean，失败返回默认值
     *
     * 宽松解析（与 JS 层一致）：
     * - Boolean 直接返回
     * - Number: 0 → false，非 0 → true
     * - String: 'true'/'1' → true，'false'/'0'/'' → false（大小写不敏感）
     */
    fun extractBoolean(raw: Any?, pathExpr: String?, default: Boolean = false): Boolean {
        val value = extract(raw, pathExpr) ?: return default
        return when (value) {
            is Boolean -> value
            is Number -> value.toDouble() != 0.0
            is String -> {
                val lower = value.trim().lowercase()
                when (lower) {
                    "true", "1" -> true
                    "false", "0", "" -> false
                    else -> default
                }
            }
            else -> default
        }
    }

    /**
     * 提取并转为数组，失败返回 null
     *
     * 用于 listPath 场景：从响应根对象提取事件数组（如 USGS 的 $.features）。
     *
     * 解析规则：
     * - JSONArray 转为 List<Any?>
     * - List<*> 直接返回
     * - null 返回 null（表示字段缺失）
     * - 非数组值（对象/字符串/数字等）包装为单元素 List（容错）
     *
     * @param raw 已解析的 JSON 数据
     * @param pathExpr 路径表达式，如 $.features、$.data.events、$（根数组）
     * @return List（可能为空），或 null 表示路径缺失
     */
    fun extractArray(raw: Any?, pathExpr: String?): List<Any?>? {
        val value = extract(raw, pathExpr) ?: return null
        return when (value) {
            is JSONArray -> {
                // org.json.JSONArray 转 List
                (0 until value.length()).map { idx ->
                    try {
                        value.get(idx)
                    } catch (_: JSONException) {
                        null
                    }
                }
            }
            is List<*> -> value
            else -> listOf(value) // 非数组值容错包装为单元素 List
        }
    }

    // ======================== 内部实现 ========================

    /**
     * 尝试将路径表达式作为"路径 + 表达式"求值
     *
     * 匹配格式：`<路径> <运算符> <路径|数字>`
     * 例如：$.time * 1000、$.depth / 1000、$.a.b + $.c.d
     *
     * @return Pair(matched, value)：matched=true 表示匹配成功（value 可能为 null 表示缺失）；matched=false 表示不是表达式
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

        if (rightNum == null) {
            return Pair(false, null)
        }

        // 四则运算
        val result: Double = when (operator) {
            "+" -> leftNum + rightNum
            "-" -> leftNum - rightNum
            "*" -> leftNum * rightNum
            "/" -> {
                if (rightNum == 0.0) {
                    return Pair(true, null)  // 除零保护
                }
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
        return when (value) {
            is Number -> {
                val d = value.toDouble()
                if (d.isFinite()) d else null
            }
            is String -> {
                val parsed = value.toDoubleOrNull()
                if (parsed != null && parsed.isFinite()) parsed else null
            }
            is Boolean -> if (value) 1.0 else 0.0
            else -> null
        }
    }

    /**
     * 按纯路径解析值
     *
     * 支持语法：
     * - $ 根对象
     * - $.field 字段访问
     * - $.a.b.c 嵌套字段
     * - $.array[0] 数组索引
     * - $.a.b[0].c 混合
     * - $.field? 可选标记（缺失返回 null）
     */
    private fun resolvePath(raw: Any?, pathExpr: String): Any? {
        val expr = pathExpr.trim()
        if (expr.isEmpty()) {
            return null
        }

        // 处理可选标记
        var path = expr
        if (path.endsWith("?")) {
            path = path.substring(0, path.length - 1).trim()
        }

        // 根对象
        if (path == "$") {
            return raw
        }

        // 必须以 $. 开头
        if (!path.startsWith("$.")) {
            return null
        }

        // 去掉 $. 前缀
        val pathStr = path.substring(2)
        if (pathStr.isEmpty()) {
            return raw
        }

        // 分词：字段名与数组索引
        val tokens = tokenizePath(pathStr)
        if (tokens.isEmpty()) {
            return null
        }

        // 逐级访问
        var current: Any? = raw
        for (i in tokens.indices) {
            val token = tokens[i]
            if (current == null) {
                return null
            }
            current = when (token) {
                is Int -> {
                    // 数组索引
                    if (current is JSONArray) {
                        try {
                            current.get(token)
                        } catch (e: JSONException) {
                            null
                        }
                    } else {
                        null
                    }
                }
                is String -> {
                    if (token.endsWith("*") && token.length > 1) {
                        // glob 通配符：按 key 前缀匹配，收集为 JSONArray
                        // 仅支持末尾 *，如 No* 匹配 No1、No2...No50
                        // 必须是路径的最后一段
                        if (i != tokens.size - 1) {
                            null
                        } else if (current !is JSONObject) {
                            null
                        } else {
                            val prefix = token.substring(0, token.length - 1)
                            val collected = JSONArray()
                            val keys = current.keys()
                            while (keys.hasNext()) {
                                val key = keys.next()
                                if (key.startsWith(prefix) && key.length > prefix.length) {
                                    try {
                                        collected.put(current.get(key))
                                    } catch (_: JSONException) {
                                        // 跳过无法读取的 key
                                    }
                                }
                            }
                            collected
                        }
                    } else {
                        // 字段访问
                        if (current is JSONObject) {
                            try {
                                current.get(token)
                            } catch (e: JSONException) {
                                null
                            }
                        } else {
                            null
                        }
                    }
                }
                else -> null
            }
        }

        return current
    }

    /**
     * 将路径字符串分词为字段名与数组索引
     *
     * 例如：a.b[0].c → ["a", "b", 0, "c"]
     *      events[0].id → ["events", 0, "id"]
     *      data[2][3] → ["data", 2, 3]
     */
    private fun tokenizePath(pathStr: String): List<Any> {
        val tokens = mutableListOf<Any>()
        var i = 0
        val len = pathStr.length

        while (i < len) {
            val ch = pathStr[i]

            when {
                ch == '.' -> {
                    // 字段分隔符，跳过
                    i++
                }
                ch == '[' -> {
                    // 数组索引开始
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
                }
                else -> {
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
            }
        }

        return tokens
    }
}
