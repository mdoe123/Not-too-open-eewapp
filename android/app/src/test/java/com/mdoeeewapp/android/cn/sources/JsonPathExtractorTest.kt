// JsonPathExtractor 单元测试
//
// 与 JS 层 __tests__/jsonPathExtract.test.ts 对等，验证原生层路径解析与 JS 层行为一致。
// 覆盖场景：纯路径、嵌套、数组索引、四则运算、可选标记、类型转换、容错。

package com.mdoeeewapp.android.cn.sources

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class JsonPathExtractorTest {

    // ======================== 纯路径提取 ========================

    @Test
    fun `extracts simple field`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertEquals("abc", JsonPathExtractor.extractString(raw, "$.id"))
    }

    @Test
    fun `extracts nested field`() {
        val raw = JSONObject("""{"data":{"mag":5.6}}""")
        assertEquals(5.6, JsonPathExtractor.extractNumber(raw, "$.data.mag"), 0.001)
    }

    @Test
    fun `extracts deeply nested field`() {
        val raw = JSONObject("""{"a":{"b":{"c":{"d":42}}}}""")
        assertEquals(42.0, JsonPathExtractor.extractNumber(raw, "$.a.b.c.d"), 0.001)
    }

    @Test
    fun `extracts string value`() {
        val raw = JSONObject("""{"name":"地震"}""")
        assertEquals("地震", JsonPathExtractor.extractString(raw, "$.name"))
    }

    @Test
    fun `extracts number value as double`() {
        val raw = JSONObject("""{"depth":15.5}""")
        assertEquals(15.5, JsonPathExtractor.extractNumber(raw, "$.depth"), 0.001)
    }

    @Test
    fun `extracts integer value as double`() {
        val raw = JSONObject("""{"count":100}""")
        assertEquals(100.0, JsonPathExtractor.extractNumber(raw, "$.count"), 0.001)
    }

    @Test
    fun `extracts boolean value`() {
        val raw = JSONObject("""{"isFinal":true}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.isFinal"))
    }

    @Test
    fun `extracts false boolean value`() {
        val raw = JSONObject("""{"isCancel":false}""")
        assertFalse(JsonPathExtractor.extractBoolean(raw, "$.isCancel"))
    }

    // ======================== 数组索引 ========================

    @Test
    fun `extracts array index`() {
        val raw = JSONObject("""{"events":[{"id":"e1"},{"id":"e2"}]}""")
        assertEquals("e1", JsonPathExtractor.extractString(raw, "$.events[0].id"))
    }

    @Test
    fun `extracts second array element`() {
        val raw = JSONObject("""{"events":[{"id":"e1"},{"id":"e2"}]}""")
        assertEquals("e2", JsonPathExtractor.extractString(raw, "$.events[1].id"))
    }

    @Test
    fun `extracts from array of primitives`() {
        val raw = JSONObject("""{"values":[10,20,30]}""")
        assertEquals(20.0, JsonPathExtractor.extractNumber(raw, "$.values[1]"), 0.001)
    }

    @Test
    fun `extracts nested array field`() {
        val raw = JSONObject("""{"data":[{"mag":3.2},{"mag":4.5}]}""")
        assertEquals(4.5, JsonPathExtractor.extractNumber(raw, "$.data[1].mag"), 0.001)
    }

    @Test
    fun `extracts two-dimensional array`() {
        val raw = JSONObject("""{"matrix":[[1,2],[3,4]]}""")
        assertEquals(4.0, JsonPathExtractor.extractNumber(raw, "$.matrix[1][1]"), 0.001)
    }

    @Test
    fun `extracts first element of two-dimensional array`() {
        val raw = JSONObject("""{"matrix":[[1,2],[3,4]]}""")
        assertEquals(1.0, JsonPathExtractor.extractNumber(raw, "$.matrix[0][0]"), 0.001)
    }

    @Test
    fun `extracts from array at root`() {
        val raw = JSONArray("""[{"id":"a"},{"id":"b"}]""")
        // 路径必须以 $. 开头，根数组需要通过字段访问
        // 这种场景由调用方处理，不直接支持 $[0]
        assertNull(JsonPathExtractor.extract(raw, "$[0]"))
    }

    // ======================== 四则运算 ========================

    @Test
    fun `multiplies by literal`() {
        val raw = JSONObject("""{"time":1700000000}""")
        assertEquals(1.7E12, JsonPathExtractor.extractNumber(raw, "$.time * 1000"), 1.0)
    }

    @Test
    fun `divides by literal`() {
        val raw = JSONObject("""{"depthMeters":15000}""")
        assertEquals(15.0, JsonPathExtractor.extractNumber(raw, "$.depthMeters / 1000"), 0.001)
    }

    @Test
    fun `adds literal`() {
        val raw = JSONObject("""{"base":100}""")
        assertEquals(150.0, JsonPathExtractor.extractNumber(raw, "$.base + 50"), 0.001)
    }

    @Test
    fun `subtracts literal`() {
        val raw = JSONObject("""{"total":200}""")
        assertEquals(150.0, JsonPathExtractor.extractNumber(raw, "$.total - 50"), 0.001)
    }

    @Test
    fun `division by zero returns null`() {
        val raw = JSONObject("""{"value":100}""")
        assertNull(JsonPathExtractor.extractNumber(raw, "$.value / 0"))
    }

    @Test
    fun `expression with float literal`() {
        val raw = JSONObject("""{"value":10}""")
        assertEquals(31.4, JsonPathExtractor.extractNumber(raw, "$.value * 3.14"), 0.01)
    }

    @Test
    fun `expression with two paths`() {
        val raw = JSONObject("""{"a":10,"b":20}""")
        assertEquals(30.0, JsonPathExtractor.extractNumber(raw, "$.a + $.b"), 0.001)
    }

    // ======================== 可选标记 ========================

    @Test
    fun `optional field missing returns null`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertNull(JsonPathExtractor.extractNumber(raw, "$.intensity?"))
    }

    @Test
    fun `optional field present returns value`() {
        val raw = JSONObject("""{"id":"abc","intensity":4.5}""")
        assertEquals(4.5, JsonPathExtractor.extractNumber(raw, "$.intensity?"), 0.001)
    }

    @Test
    fun `optional field missing returns default`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertEquals(0.0, JsonPathExtractor.extractNumber(raw, "$.intensity?", 0.0), 0.001)
    }

    // ======================== 类型转换 ========================

    @Test
    fun `extractNumber from string`() {
        val raw = JSONObject("""{"mag":"5.6"}""")
        assertEquals(5.6, JsonPathExtractor.extractNumber(raw, "$.mag"), 0.001)
    }

    @Test
    fun `extractNumber from boolean true`() {
        val raw = JSONObject("""{"flag":true}""")
        assertEquals(1.0, JsonPathExtractor.extractNumber(raw, "$.flag"), 0.001)
    }

    @Test
    fun `extractNumber from boolean false`() {
        val raw = JSONObject("""{"flag":false}""")
        assertEquals(0.0, JsonPathExtractor.extractNumber(raw, "$.flag"), 0.001)
    }

    @Test
    fun `extractNumber from invalid string returns default`() {
        val raw = JSONObject("""{"mag":"abc"}""")
        assertEquals(-1.0, JsonPathExtractor.extractNumber(raw, "$.mag", -1.0), 0.001)
    }

    @Test
    fun `extractBoolean from string true`() {
        val raw = JSONObject("""{"flag":"true"}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractBoolean from string TRUE uppercase`() {
        val raw = JSONObject("""{"flag":"TRUE"}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractBoolean from string 1`() {
        val raw = JSONObject("""{"flag":"1"}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractBoolean from string false`() {
        val raw = JSONObject("""{"flag":"false"}""")
        assertFalse(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractBoolean from string 0`() {
        val raw = JSONObject("""{"flag":"0"}""")
        assertFalse(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractBoolean from number nonzero`() {
        val raw = JSONObject("""{"flag":5}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractBoolean from number zero`() {
        val raw = JSONObject("""{"flag":0}""")
        assertFalse(JsonPathExtractor.extractBoolean(raw, "$.flag"))
    }

    @Test
    fun `extractString from number`() {
        val raw = JSONObject("""{"id":123}""")
        assertEquals("123", JsonPathExtractor.extractString(raw, "$.id"))
    }

    @Test
    fun `extractString from boolean`() {
        val raw = JSONObject("""{"flag":true}""")
        assertEquals("true", JsonPathExtractor.extractString(raw, "$.flag"))
    }

    @Test
    fun `extractLong from integer`() {
        val raw = JSONObject("""{"time":1700000000}""")
        assertEquals(1700000000L, JsonPathExtractor.extractLong(raw, "$.time"))
    }

    @Test
    fun `extractLong from string`() {
        val raw = JSONObject("""{"time":"1700000000"}""")
        assertEquals(1700000000L, JsonPathExtractor.extractLong(raw, "$.time"))
    }

    @Test
    fun `extractLong from invalid returns default`() {
        val raw = JSONObject("""{"time":"abc"}""")
        assertEquals(-1L, JsonPathExtractor.extractLong(raw, "$.time", -1L))
    }

    // ======================== 容错 ========================

    @Test
    fun `missing field returns null`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertNull(JsonPathExtractor.extract(raw, "$.missing"))
    }

    @Test
    fun `missing nested field returns null`() {
        val raw = JSONObject("""{"a":{"b":1}}""")
        assertNull(JsonPathExtractor.extract(raw, "$.a.c"))
    }

    @Test
    fun `array index out of bounds returns null`() {
        val raw = JSONObject("""{"items":[1,2,3]}""")
        assertNull(JsonPathExtractor.extract(raw, "$.items[10]"))
    }

    @Test
    fun `field access on array returns null`() {
        val raw = JSONObject("""{"items":[1,2,3]}""")
        assertNull(JsonPathExtractor.extract(raw, "$.items.name"))
    }

    @Test
    fun `array index on object returns null`() {
        val raw = JSONObject("""{"data":{"name":"x"}}""")
        assertNull(JsonPathExtractor.extract(raw, "$.data[0]"))
    }

    @Test
    fun `empty path returns null`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertNull(JsonPathExtractor.extract(raw, ""))
    }

    @Test
    fun `null path returns null`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertNull(JsonPathExtractor.extract(raw, null))
    }

    @Test
    fun `path not starting with dollar returns null`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertNull(JsonPathExtractor.extract(raw, "id"))
    }

    @Test
    fun `null raw returns null`() {
        assertNull(JsonPathExtractor.extract(null, "$.id"))
    }

    // ======================== 根对象 ========================

    @Test
    fun `root path returns raw`() {
        val raw = JSONObject("""{"id":"abc"}""")
        val result = JsonPathExtractor.extract(raw, "$")
        assertEquals(raw, result)
    }

    // ======================== 综合场景 ========================

    @Test
    fun `cenc-style API parsing`() {
        // 模拟 CENC 风格 API 响应
        val raw = JSONObject("""
            {
                "eventId": "202301010101",
                "originTime": 1672531200,
                "magnitude": 5.6,
                "depth": 15,
                "latitude": 30.5,
                "longitude": 103.7,
                "location": "四川宜宾",
                "maxIntensity": 6.0,
                "isFinal": false
            }
        """.trimIndent())

        assertEquals("202301010101", JsonPathExtractor.extractString(raw, "$.eventId"))
        assertEquals(1672531200.0, JsonPathExtractor.extractNumber(raw, "$.originTime"), 0.001)
        assertEquals(5.6, JsonPathExtractor.extractNumber(raw, "$.magnitude"), 0.001)
        assertEquals(15.0, JsonPathExtractor.extractNumber(raw, "$.depth"), 0.001)
        assertEquals(30.5, JsonPathExtractor.extractNumber(raw, "$.latitude"), 0.001)
        assertEquals(103.7, JsonPathExtractor.extractNumber(raw, "$.longitude"), 0.001)
        assertEquals("四川宜宾", JsonPathExtractor.extractString(raw, "$.location"))
        assertEquals(6.0, JsonPathExtractor.extractNumber(raw, "$.maxIntensity"), 0.001)
        assertFalse(JsonPathExtractor.extractBoolean(raw, "$.isFinal"))
    }

    @Test
    fun `usgs-style API parsing with time multiplication`() {
        // 模拟 USGS GeoJSON 风格响应（time 为毫秒级）
        val raw = JSONObject("""
            {
                "id": "us7000abcd",
                "properties": {
                    "time": 1672531200000,
                    "mag": 4.5,
                    "place": "Central California"
                },
                "geometry": {
                    "coordinates": [-120.5, 36.2, 8.3]
                }
            }
        """.trimIndent())

        assertEquals("us7000abcd", JsonPathExtractor.extractString(raw, "$.id"))
        assertEquals(1672531200000.0, JsonPathExtractor.extractNumber(raw, "$.properties.time"), 1.0)
        assertEquals(4.5, JsonPathExtractor.extractNumber(raw, "$.properties.mag"), 0.001)
        assertEquals("Central California", JsonPathExtractor.extractString(raw, "$.properties.place"))
        // 坐标数组：[lng, lat, depth]
        assertEquals(-120.5, JsonPathExtractor.extractNumber(raw, "$.geometry.coordinates[0]"), 0.001)
        assertEquals(36.2, JsonPathExtractor.extractNumber(raw, "$.geometry.coordinates[1]"), 0.001)
        assertEquals(8.3, JsonPathExtractor.extractNumber(raw, "$.geometry.coordinates[2]"), 0.001)
    }

    @Test
    fun `time in seconds converted to milliseconds`() {
        val raw = JSONObject("""{"time":1672531200}""")
        // $.time * 1000：秒级时间戳转毫秒级
        assertEquals(1672531200000.0, JsonPathExtractor.extractNumber(raw, "$.time * 1000"), 1.0)
    }

    @Test
    fun `depth in meters converted to kilometers`() {
        val raw = JSONObject("""{"depthMeters":15000}""")
        assertEquals(15.0, JsonPathExtractor.extractNumber(raw, "$.depthMeters / 1000"), 0.001)
    }

    @Test
    fun `eqlist-style array response`() {
        // 模拟 eqlist 风格响应（数组）
        val raw = JSONObject("""
            {
                "events": [
                    {"id":"e1","mag":3.2},
                    {"id":"e2","mag":4.5},
                    {"id":"e3","mag":5.0}
                ]
            }
        """.trimIndent())

        assertEquals("e1", JsonPathExtractor.extractString(raw, "$.events[0].id"))
        assertEquals(3.2, JsonPathExtractor.extractNumber(raw, "$.events[0].mag")!!, 0.001)
        assertEquals("e2", JsonPathExtractor.extractString(raw, "$.events[1].id"))
        assertEquals(4.5, JsonPathExtractor.extractNumber(raw, "$.events[1].mag")!!, 0.001)
        assertEquals("e3", JsonPathExtractor.extractString(raw, "$.events[2].id"))
        assertEquals(5.0, JsonPathExtractor.extractNumber(raw, "$.events[2].mag")!!, 0.001)
    }

    @Test
    fun `optional isCancel missing returns false`() {
        val raw = JSONObject("""{"id":"abc"}""")
        // isCancel 为可选字段，缺失时默认 false
        assertFalse(JsonPathExtractor.extractBoolean(raw, "$.isCancel?", false))
    }

    @Test
    fun `optional isFinal present returns value`() {
        val raw = JSONObject("""{"id":"abc","isFinal":true}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.isFinal?", false))
    }

    @Test
    fun `expression with missing left operand returns null`() {
        val raw = JSONObject("""{"a":10}""")
        // 左操作数缺失，表达式无法求值
        assertNull(JsonPathExtractor.extractNumber(raw, "$.missing * 1000"))
    }

    @Test
    fun `expression with missing right path operand returns null`() {
        val raw = JSONObject("""{"a":10}""")
        // 右操作数缺失（路径），表达式返回 null
        assertNull(JsonPathExtractor.extractNumber(raw, "$.a * $.missing"))
    }

    @Test
    fun `expression with non-numeric left returns null`() {
        val raw = JSONObject("""{"a":"text"}""")
        // 左操作数为非数字字符串，无法求值
        assertNull(JsonPathExtractor.extractNumber(raw, "$.a * 1000"))
    }

    @Test
    fun `nested optional field missing returns null`() {
        val raw = JSONObject("""{"a":{"b":1}}""")
        assertNull(JsonPathExtractor.extractNumber(raw, "$.a.c.d?"))
    }

    @Test
    fun `nested optional field present returns value`() {
        val raw = JSONObject("""{"a":{"c":{"d":42}}}""")
        assertEquals(42.0, JsonPathExtractor.extractNumber(raw, "$.a.c.d?")!!, 0.001)
    }

    @Test
    fun `extractString returns default when missing`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertEquals("unknown", JsonPathExtractor.extractString(raw, "$.missing", "unknown"))
    }

    @Test
    fun `extractString returns null when missing and no default`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertNull(JsonPathExtractor.extractString(raw, "$.missing"))
    }

    @Test
    fun `extractBoolean returns default when missing`() {
        val raw = JSONObject("""{"id":"abc"}""")
        assertTrue(JsonPathExtractor.extractBoolean(raw, "$.missing", true))
    }

    // ======================== extractArray（列表 API 支持） ========================

    @Test
    fun `extractArray returns array from features`() {
        val raw = JSONObject("""{"features":[{"id":"a"},{"id":"b"}]}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.features")
        assertNotNull(arr)
        assertEquals(2, arr!!.size)
    }

    @Test
    fun `extractArray returns array from nested path`() {
        val raw = JSONObject("""{"data":{"events":[{"x":1},{"x":2},{"x":3}]}}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.data.events")
        assertNotNull(arr)
        assertEquals(3, arr!!.size)
    }

    @Test
    fun `extractArray returns root array with dollar`() {
        val raw = JSONArray("""[{"id":"a"},{"id":"b"}]""")
        val arr = JsonPathExtractor.extractArray(raw, "$")
        assertNotNull(arr)
        assertEquals(2, arr!!.size)
    }

    @Test
    fun `extractArray returns empty array as empty list`() {
        val raw = JSONObject("""{"features":[]}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.features")
        assertNotNull(arr)
        assertEquals(0, arr!!.size)
    }

    @Test
    fun `extractArray returns null when path missing`() {
        val raw = JSONObject("""{"other":[]}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.features")
        assertNull(arr)
    }

    @Test
    fun `extractArray returns null when value is null`() {
        val raw = JSONObject("""{"features":null}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.features")
        assertNull(arr)
    }

    @Test
    fun `extractArray wraps non-array object as single element list`() {
        val raw = JSONObject("""{"single":{"id":"only"}}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.single")
        assertNotNull(arr)
        assertEquals(1, arr!!.size)
        // 元素应为 JSONObject
        assertTrue(arr[0] is JSONObject)
    }

    @Test
    fun `extractArray wraps string as single element list`() {
        val raw = JSONObject("""{"name":"hello"}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.name")
        assertNotNull(arr)
        assertEquals(1, arr!!.size)
        assertEquals("hello", arr[0])
    }

    @Test
    fun `extractArray wraps number as single element list`() {
        val raw = JSONObject("""{"count":42}""")
        val arr = JsonPathExtractor.extractArray(raw, "$.count")
        assertNotNull(arr)
        assertEquals(1, arr!!.size)
    }

    @Test
    fun `extractArray returns null for empty path`() {
        val raw = JSONObject("""{"a":1}""")
        assertNull(JsonPathExtractor.extractArray(raw, ""))
    }

    @Test
    fun `extractArray returns null for null path`() {
        val raw = JSONObject("""{"a":1}""")
        assertNull(JsonPathExtractor.extractArray(raw, null))
    }

    @Test
    fun `extractArray USGS style full scenario`() {
        // 模拟 USGS FDSN API 响应
        val raw = JSONObject("""
            {
              "features": [
                {
                  "id": "us7000abcd",
                  "properties": {"mag": 5.6, "time": 1719705600000, "place": "Japan"},
                  "geometry": {"coordinates": [139.69, 35.68, 15.0]}
                },
                {
                  "id": "us7000abce",
                  "properties": {"mag": 4.2, "time": 1719705601000, "place": "Taiwan"},
                  "geometry": {"coordinates": [121.5, 23.8, 20.0]}
                }
              ]
            }
        """.trimIndent())

        val arr = JsonPathExtractor.extractArray(raw, "$.features")
        assertNotNull(arr)
        assertEquals(2, arr!!.size)

        // 验证第一个元素的字段可正确提取
        val first = arr[0] as JSONObject
        assertEquals("us7000abcd", JsonPathExtractor.extractString(first, "$.id"))
        assertEquals(5.6, JsonPathExtractor.extractNumber(first, "$.properties.mag")!!, 0.001)
        assertEquals(15.0, JsonPathExtractor.extractNumber(first, "$.geometry.coordinates[2]")!!, 0.001)
    }
}
