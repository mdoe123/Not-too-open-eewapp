package com.mdoeeewapp.android.cn.autostart

import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 厂商自启动设置跳转模块
 *
 * 标准 Android 不提供"查询自启动权限"的官方 API，但部分国产 ROM（小米/华为/OPPO/vivo 等）
 * 在系统层增加了自启动管理开关。本模块根据 [Build.MANUFACTURER] 判断厂商，
 * 尽力跳转到对应 ROM 的自启动管理页面；无法识别的厂商则回退到应用详情设置页。
 *
 * 注意：厂商 Intent 通常没有文档保证，可能随 ROM 版本变化而失效，
 * 因此所有跳转都用 try-catch 包裹，失败时回退到应用详情页。
 */
class AutoStartModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "AutoStartModule"
  }

  override fun getName(): String = NAME

  /**
   * 跳转到厂商自启动设置页
   *
   * 策略：
   * 1. 根据 [Build.MANUFACTURER] 小写形式匹配厂商
   * 2. 优先尝试厂商专属自启动管理 Intent
   * 3. 失败时回退到 [Settings.ACTION_APPLICATION_DETAILS_SETTINGS]
   *
   * @param promise 成功跳转 resolve(true)；任何异常 resolve(false)
   */
  @ReactMethod
  fun openAutoStartSettings(promise: Promise) {
    val manufacturer = Build.MANUFACTURER.lowercase()
    val intents = mutableListOf<Intent>()

    when {
      manufacturer.contains("xiaomi") || manufacturer.contains("redmi") -> {
        // 小米 / Redmi：尝试安全中心自启动管理页
        intents.add(Intent().apply {
          setComponent(ComponentName(
            "com.miui.securitycenter",
            "com.miui.permcenter.autostart.AutoStartManagementActivity",
          ))
        })
      }
      manufacturer.contains("huawei") || manufacturer.contains("honor") -> {
        // 华为 / 荣耀：尝试自启动管理页
        intents.add(Intent().apply {
          setComponent(ComponentName(
            "com.huawei.systemmanager",
            "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
          ))
        })
      }
      manufacturer.contains("oppo") -> {
        // OPPO：尝试自启动管理页
        intents.add(Intent().apply {
          setComponent(ComponentName(
            "com.coloros.safecenter",
            "com.coloros.safecenter.permission.startup.StartupAppListActivity",
          ))
        })
        // 兼容老版本 ColorOS / Realme
        intents.add(Intent().apply {
          setComponent(ComponentName(
            "com.oppo.safe",
            "com.oppo.safe.permission.startup.StartupAppListActivity",
          ))
        })
      }
      manufacturer.contains("vivo") -> {
        // vivo：尝试自启动管理页
        intents.add(Intent().apply {
          setComponent(ComponentName(
            "com.iqoo.secure",
            "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity",
          ))
        })
      }
      manufacturer.contains("meizu") -> {
        // 魅族：尝试自启动管理页
        intents.add(Intent().apply {
          setComponent(ComponentName(
            "com.meizu.safe",
            "com.meizu.safe.security.SHOW_APPSEC",
          ))
        })
      }
      manufacturer.contains("samsung") -> {
        // 三星：无独立自启动页，直接跳应用详情
      }
      else -> {
        // 其他厂商：无专属 Intent，直接走应用详情页
      }
    }

    // 兜底：所有厂商都加入应用详情页作为最后回退
    val appDetailsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
      data = Uri.fromParts("package", reactContext.packageName, null)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    intents.add(appDetailsIntent)

    // 依次尝试每个 Intent，第一个成功即返回
    for (intent in intents) {
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        reactContext.startActivity(intent)
        promise.resolve(true)
        return
      } catch (e: Exception) {
        // 当前 Intent 失败，尝试下一个
      }
    }

    // 全部失败
    promise.resolve(false)
  }
}
