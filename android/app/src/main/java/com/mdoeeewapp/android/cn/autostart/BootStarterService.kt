package com.mdoeeewapp.android.cn.autostart

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.atomic.AtomicBoolean

// TODO: Task 4 完成后替换为真正的 EewBackgroundService

/**
 * 开机启动占位前台服务
 *
 * 这是一个临时占位实现，仅用于开机后通过常驻通知维持进程存活。
 * Task 4（后台服务）完成后，将被真正的 EewBackgroundService 替代，
 * 届时此文件可删除或保留为 fallback 实现。
 *
 * 设计要点：
 * - 前台服务（Foreground Service）+ 常驻通知，降低被系统杀死概率
 * - 通知使用低优先级，不发声、不弹窗，仅常驻通知栏
 * - onStartCommand 返回 START_STICKY，被杀后系统会自动重启
 *
 * 注：使用 androidx.core.app.NotificationCompat（React Native 间接依赖 androidx.core，
 * 无需额外声明），统一通知构建 API 并在所有 Android 版本上行为一致。
 * 小图标使用应用启动器图标 R.mipmap.ic_launcher，确保通知栏可见且与 App 品牌一致。
 */
class BootStarterService : Service() {

  companion object {
    private const val TAG = "BootStarterService"
    private const val CHANNEL_ID = "eew_service"
    private const val CHANNEL_NAME = "地震预警服务"
    private const val NOTIFICATION_ID = 1001
    private const val NOTIFICATION_CONTENT = "地震预警后台服务运行中"

    /** 启动幂等标志，防止 LOCKED_BOOT_COMPLETED + BOOT_COMPLETED 重复触发 startForeground */
    private val started = AtomicBoolean(false)
  }

  override fun onCreate() {
    super.onCreate()
    Log.i(TAG, "BootStarterService onCreate")
    // 创建通知渠道（API 26+ 必须创建渠道后才能发送通知）
    createNotificationChannel()
    // 启动前台服务（幂等：重复调用 startForeground 不会重建通知）
    if (started.compareAndSet(false, true)) {
      startForeground(NOTIFICATION_ID, buildNotification())
    } else {
      // 已启动过，确保通知存在（系统可能在重启后丢失通知）
      try {
        startForeground(NOTIFICATION_ID, buildNotification())
      } catch (_: Exception) {
        // 忽略重复 startForeground 异常
      }
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    Log.i(TAG, "BootStarterService onStartCommand")
    // 幂等：onCreate 已 startForeground，此处不重复调用避免部分 ROM 异常
    // 被系统杀死后自动重启
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? {
    // 不允许绑定
    return null
  }

  /**
   * 创建低优先级通知渠道
   * - 重要性 IMPORTANCE_LOW：不发声、不弹窗，仅在通知栏显示
   */
  private fun createNotificationChannel() {
    // minSdkVersion = 26，所以无需版本判断
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
  }

  /**
   * 构建常驻通知
   * 使用 NotificationCompat + 应用图标 R.mipmap.ic_launcher
   */
  private fun buildNotification(): android.app.Notification {
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(CHANNEL_NAME)
      .setContentText(NOTIFICATION_CONTENT)
      .setSmallIcon(com.mdoeeewapp.android.cn.R.mipmap.ic_launcher)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setSilent(true)
      .build()
  }
}
