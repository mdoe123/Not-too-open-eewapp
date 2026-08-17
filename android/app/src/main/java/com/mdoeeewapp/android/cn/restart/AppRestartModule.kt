package com.mdoeeewapp.android.cn.restart

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * 应用自重启模块
 *
 * 供 RN 层在「数据源等配置需重启才能生效」时调用 [restart]，
 * 以单任务模式重新拉起 MainActivity 并结束当前进程，完整重载 RN 运行时。
 *
 * 场景：useConfig 各屏幕配置状态彼此独立（无全局共享），改动「数据源启用态」等
 * 连接级配置后，HomeScreen / useEewStream / 后台服务不会实时感知；
 * 重启后 HomeScreen 从 AsyncStorage 重新读取配置并触发数据源重连，使改动生效。
 *
 * 说明：RN 0.86 已移除 BackHandler.exitApp；退出型关闭在常驻前台服务（START_STICKY）
 * 下不可靠，故采用「重新拉起 + 退出进程」的自重启方案。
 */
class AppRestartModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "AppRestartModule"
    private const val TAG = "AppRestartModule"

    /**
     * 新任务开始渲染的等待时长（毫秒）
     *
     * 拉起 MainActivity 后稍等片刻再退出进程，避免进程立即死亡导致新任务来不及呈现；
     * 进程退出后 OS 重启该任务的根 Activity，实现干净的自重启。
     */
    private const val RESTART_DELAY_MS = 250L
  }

  override fun getName(): String = NAME

  /**
   * 重启应用
   *
   * 行为：
   * 1. 用 launch intent（MainActivity）以 NEW_TASK | CLEAR_TASK 拉起，清空旧任务栈
   * 2. 延迟 [RESTART_DELAY_MS] 后结束当前进程，触发完整重载（含原生模块重初始化）
   *
   * 由 JS 层在配置 flush 落盘后再调用，确保重启后能读到最新配置。
   */
  @ReactMethod
  fun restart() {
    try {
      val context = reactApplicationContext
      val intent = context.packageManager
        .getLaunchIntentForPackage(context.packageName)
      if (intent == null) {
        Log.e(TAG, "未找到启动 Intent，重启失败")
        return
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
      context.startActivity(intent)
      Handler(Looper.getMainLooper()).postDelayed({
        Runtime.getRuntime().exit(0)
      }, RESTART_DELAY_MS)
      Log.i(TAG, "已触发应用自重启")
    } catch (e: Exception) {
      Log.e(TAG, "restart 失败: ${e.message}")
    }
  }
}