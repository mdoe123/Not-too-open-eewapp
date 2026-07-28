package com.mdoeeewapp.android.cn.permission

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 系统权限检测原生模块
 *
 * 提供电池优化白名单等系统级权限的真实状态检测与申请能力。
 *
 * 设计要点：
 * - 使用 PowerManager.isIgnoringBatteryOptimizations 检测电池优化白名单（API 23+，本项目 minSdk 26）
 * - 使用 ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 申请白名单（需声明 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限）
 * - 所有调用 try-catch 包裹，避免主线程崩溃
 */
class PermissionModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "PermissionModule"
  }

  override fun getName(): String = NAME

  /**
   * 检测应用是否已加入电池优化白名单（未被电池优化限制）
   *
   * @param promise resolve(true) 表示已加入白名单（不受限制），resolve(false) 表示受电池优化限制
   *
   * 注：PowerManager.isIgnoringBatteryOptimizations 在 API 23+ 可用，无需特殊权限即可查询自身状态。
   */
  @ReactMethod
  fun isBatteryOptimized(promise: Promise) {
    try {
      val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (powerManager == null) {
        promise.reject("POWER_SERVICE_ERROR", "无法获取 PowerManager 服务")
        return
      }
      val isOptimized = powerManager.isIgnoringBatteryOptimizations(reactContext.packageName)
      promise.resolve(isOptimized)
    } catch (e: Exception) {
      promise.reject("BATTERY_CHECK_ERROR", "检测电池优化状态失败: ${e.message}")
    }
  }

  /**
   * 申请加入电池优化白名单
   *
   * 跳转到系统电池优化设置页（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS），
   * 用户授权后应用将被加入白名单，避免后台被系统杀掉。
   *
   * @param promise resolve(true) 表示已加入白名单（无需跳转），resolve(false) 表示已跳转设置页（用户需手动操作）
   *
   * 注：需在 AndroidManifest.xml 声明 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限。
   */
  @ReactMethod
  fun requestBatteryOptimization(promise: Promise) {
    try {
      val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (powerManager != null && powerManager.isIgnoringBatteryOptimizations(reactContext.packageName)) {
        // 已加入白名单，无需跳转
        promise.resolve(true)
        return
      }
      val activity = getCurrentActivity()
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "当前无 Activity，无法跳转电池优化设置")
        return
      }
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      // 跳转后用户需手动操作，由 RN 侧在 AppState active 时重新调 isBatteryOptimized 检查
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("BATTERY_REQUEST_ERROR", "跳转电池优化设置失败: ${e.message}")
    }
  }
}
