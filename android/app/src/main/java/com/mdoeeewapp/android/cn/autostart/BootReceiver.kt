package com.mdoeeewapp.android.cn.autostart

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.mdoeeewapp.android.cn.background.EewBackgroundService

/**
 * 开机自启动接收器
 *
 * 监听系统启动完成的广播，拉起后台服务（占位实现）。
 * - [Intent.ACTION_BOOT_COMPLETED]：设备启动完成（用户解锁后）
 * - [Intent.ACTION_LOCKED_BOOT_COMPLETED]：API 24+，设备加密启动完成（用户解锁前即可收到）
 *
 * 注意：本接收器必须在 AndroidManifest.xml 中注册才能生效，
 * 并声明 RECEIVE_BOOT_COMPLETED 权限。由主代理统一在 manifest 中注册。
 */
class BootReceiver : BroadcastReceiver() {

  companion object {
    private const val TAG = "BootReceiver"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val isBootAction = when (action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_LOCKED_BOOT_COMPLETED -> true
      else -> false
    }
    if (!isBootAction) {
      return
    }

    Log.i(TAG, "Boot completed, starting service")

    // 启动后台保活服务（EewBackgroundService）
    // 注意：minSdkVersion = 26（Android O），可直接使用 startForegroundService
    val serviceIntent = Intent(context, EewBackgroundService::class.java)
    context.startForegroundService(serviceIntent)
    // 不启动主界面 Activity（静默启动）
  }
}
