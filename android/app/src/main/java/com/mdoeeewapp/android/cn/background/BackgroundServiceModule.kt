package com.mdoeeewapp.android.cn.background

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap

/**
 * 后台保活服务 RN 桥接模块
 *
 * 暴露 start() / stop() / updateConfig() / updateLocation() / notifyAppInForeground() 方法
 * 供 RN 侧调用，控制 EewBackgroundService 的启停与配置同步。
 *
 * App 启动时调用 start() 启动前台服务，通过常驻通知维持进程存活。
 * 配置变更时调用 updateConfig() / updateLocation() 将最新配置直接写入 SharedPreferences，
 * 供后台服务在锁屏时按配置触发悬浮窗预警。
 *
 * 设计要点：
 * - 配置直接写入 SharedPreferences（不依赖 Service 实例是否存活）
 * - 即使 Service 未启动，配置也已持久化，下次 Service 启动时自动读取
 * - AppState 'active' 时调用 notifyAppInForeground() 通知后台服务 App 已回到前台
 */
class BackgroundServiceModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "BackgroundServiceModule"
    private const val TAG = "BackgroundServiceModule"
    private const val PREFS_NAME = "eew_alert_config"
  }

  init {
    // 将 ReactApplicationContext 注入全局提供者，
    // 供 EewBackgroundService（非 RN 生命周期内）获取 ReactContext
    ReactContextProvider.setReactApplicationContext(reactContext)
    Log.i(TAG, "ReactContextProvider 已设置")
  }

  override fun getName(): String = NAME

  /**
   * 启动后台保活服务
   * 创建 EewBackgroundService 前台服务，显示常驻通知。
   */
  @ReactMethod
  fun start() {
    val intent = Intent(reactContext, EewBackgroundService::class.java)
    // minSdkVersion = 26，直接使用 startForegroundService
    reactContext.startForegroundService(intent)
  }

  /**
   * 停止后台保活服务
   * 停止 EewBackgroundService，移除常驻通知。
   */
  @ReactMethod
  fun stop() {
    val intent = Intent(reactContext, EewBackgroundService::class.java)
    reactContext.stopService(intent)
  }

  /**
   * 更新 alert 配置（由 RN 层调用）
   *
   * 直接写入 SharedPreferences，不依赖 Service 实例是否存活。
   * 后台服务在触发悬浮窗时从 SharedPreferences 读取最新配置。
   *
   * @param alertMap 包含字段：minMagnitude, lockScreenIntensity, lockScreenEnabled,
   *                 floatingWindowEnabled, soundEnabled, vibrationEnabled, flashlightEnabled,
   *                 backgroundEnabled, autoStartEnabled
   */
  @ReactMethod
  fun updateConfig(alertMap: ReadableMap) {
    try {
      val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
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
      prefs.apply()
      Log.i(TAG, "alert 配置已写入 SharedPreferences")
    } catch (e: Exception) {
      Log.e(TAG, "updateConfig 失败: ${e.message}")
    }
  }

  /**
   * 更新位置配置（由 RN 层调用）
   *
   * 直接写入 SharedPreferences，不依赖 Service 实例是否存活。
   * 后台服务在计算震中距/烈度时从 SharedPreferences 读取最新坐标。
   *
   * @param locationMap 包含字段：userLat, userLng
   */
  @ReactMethod
  fun updateLocation(locationMap: ReadableMap) {
    try {
      val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      var lat = 0.0
      var lng = 0.0
      if (locationMap.hasKey("userLat")) {
        lat = locationMap.getDouble("userLat")
        prefs.putFloat("userLat", lat.toFloat())
      }
      if (locationMap.hasKey("userLng")) {
        lng = locationMap.getDouble("userLng")
        prefs.putFloat("userLng", lng.toFloat())
      }
      prefs.apply()
      Log.i(TAG, "位置配置已写入 SharedPreferences: lat=$lat, lng=$lng")
    } catch (e: Exception) {
      Log.e(TAG, "updateLocation 失败: ${e.message}")
    }
  }

  /**
   * 通知 App 已回到前台（由 RN 层调用）
   *
   * RN 层在 AppState 'active' 时调用此方法，更新 appInForeground=true。
   * 后台服务收到事件时若 App 在前台，则跳过悬浮窗触发（由 JS 层处理）。
   */
  @ReactMethod
  fun notifyAppInForeground() {
    EewBackgroundService.instance?.notifyAppInForeground()
      ?: Log.d(TAG, "EewBackgroundService 未启动，notifyAppInForeground 已忽略")
  }

  /**
   * 通知后台服务 App 已进入后台（由 RN 层调用）
   *
   * RN 层在 AppState 'background'/'inactive' 时调用此方法，更新 appInForeground=false。
   * 这是按 Home 键切后台时最可靠的检测方式（MIUI 下 onTrimMemory 和 SCREEN_OFF 不可靠）。
   */
  @ReactMethod
  fun notifyAppInBackground() {
    EewBackgroundService.instance?.notifyAppInBackground()
      ?: Log.d(TAG, "EewBackgroundService 未启动，notifyAppInBackground 已忽略")
  }

  /**
   * 更新当前活跃 customSource 配置（由 RN 层调用）
   *
   * 将整个 SourceConfig 序列化为 JSON 字符串写入 SharedPreferences，
   * 供后台服务在锁屏时按用户配置的 endpoint/protocol/fieldMapping 接收预警数据。
   *
   * 调用此方法后会触发 [EewBackgroundService.reloadCustomSource]：
   * 1. 停止现有 WS/HTTP 连接
   * 2. 解析新的配置
   * 3. 按 protocol（'ws' 或 'http'）启动相应连接
   *
   * 数据源选择策略（由 JS 层负责）：
   * - JS 层从 config.sources 中筛选 enabled && type==='customSource' && category==='eew'
   *   的源，按 priority 升序取第一个作为活跃源传入
   * - 若无符合条件的源，传 null 清空原生层配置（后台服务不建立连接）
   *
   * @param sourceJson 完整 SourceConfig 的 JSON 字符串，传 null 清空配置
   */
  @ReactMethod
  fun updateCustomSourceJson(sourceJson: String?) {
    try {
      val prefs = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      if (sourceJson == null) {
        prefs.remove("activeCustomSource")
        Log.i(TAG, "已清空 activeCustomSource 配置")
      } else {
        prefs.putString("activeCustomSource", sourceJson)
        Log.i(TAG, "activeCustomSource 配置已写入 SharedPreferences（长度=${sourceJson.length}）")
      }
      prefs.apply()
      // 触发后台服务重新加载配置并重连
      EewBackgroundService.instance?.reloadCustomSource()
        ?: Log.d(TAG, "EewBackgroundService 未启动，配置已持久化，下次启动时生效")
    } catch (e: Exception) {
      Log.e(TAG, "updateCustomSourceJson 失败: ${e.message}")
    }
  }

  /**
   * 触发测试预警（绕过 WebSocket + 前后台检查，直接走悬浮窗触发路径）
   *
   * 供 RN 层模拟预警页面调用，用于测试锁屏预警路径。
   * 调用后即使 App 在前台，也会强制通过原生层显示悬浮窗
   * （与真实锁屏预警使用相同的 showFloatingWindow 路径）。
   *
   * 测试步骤：
   * 1. 启用后台服务（设置页 → 系统能力 → 后台保活开关）
   * 2. 进入模拟预警页面，点击"触发锁屏预警测试"按钮
   * 3. 观察悬浮窗是否显示（屏幕将被点亮，10 秒 WakeLock）
   * 4. 锁屏后再次点击按钮（需通过 ADB 广播触发，因为 JS 层会被挂起）
   *    adb shell am broadcast -a com.mdoeeewapp.android.cn.TEST_ALERT \
   *      --es magnitude 6.0 --es depth 15 --es lat 40.0 --es lng 116.0 --ez forceTrigger true
   *
   * @param magnitude 震级（默认 5.5）
   * @param depth 震源深度 km（默认 15）
   * @param lat 震中纬度（默认 40.0）
   * @param lng 震中经度（默认 116.0）
   * @param forceTrigger 是否强制触发（绕过 minMagnitude / lockScreenIntensity 检查）
   */
  @ReactMethod
  fun testAlert(magnitude: Double, depth: Double, lat: Double, lng: Double, forceTrigger: Boolean) {
    try {
      val ok = EewBackgroundService.instance?.triggerTestAlert(magnitude, depth, lat, lng, forceTrigger)
      if (ok != true) {
        Log.w(TAG, "testAlert 未触发（Service 未启动或阈值检查未通过）")
      }
    } catch (e: Exception) {
      Log.e(TAG, "testAlert 失败: ${e.message}")
    }
  }
}
