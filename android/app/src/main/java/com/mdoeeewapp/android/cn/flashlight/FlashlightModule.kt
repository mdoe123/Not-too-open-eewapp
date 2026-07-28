package com.mdoeeewapp.android.cn.flashlight

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.mdoeeewapp.android.cn.background.ReactContextProvider

/**
 * 闪光灯警报原生模块
 *
 * 使用 Camera2 API 控制设备闪光灯（torch mode），用于地震预警的灯光警报。
 *
 * 触发策略：
 * - 仅橙红级（烈度 ≥ 5）触发
 * - 闪烁 3 次，间隔 500ms
 *
 * 设计要点：
 * - 使用 CameraManager.setTorchMode（API 23+，本项目 minSdk 26）
 * - 在子线程执行 blink 循环避免阻塞主线程
 * - 所有 CameraManager 调用 try-catch 包裹，避免主线程崩溃
 * - 自动选择后置主摄像头（LENS_FACING_BACK）
 *
 * 全局注册：构造时注册到 ReactContextProvider，供 LockScreenAlertActivity
 * 在锁屏时直接调用 startBlinking()/stopBlinking()（无需经过 RN 桥）。
 */
class FlashlightModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

  companion object {
    const val NAME = "FlashlightModule"
    const val EVENT_ERROR = "onError"
  }

  /** 主线程 Handler */
  private val mainHandler = Handler(Looper.getMainLooper())

  /** 后台线程 Handler（用于 blink 循环） */
  private var backgroundThread: HandlerThread? = null
  private var backgroundHandler: Handler? = null

  /** CameraManager 引用 */
  private var cameraManager: CameraManager? = null

  /** 当前使用的摄像头 ID */
  private var cameraId: String? = null

  /** Torch 状态回调 */
  private var torchCallback: CameraManager.TorchCallback? = null

  /** blink 循环是否被取消 */
  @Volatile
  private var blinkCancelled = false

  /** startBlinking 循环是否继续（stopBlinking 设为 false 退出循环） */
  @Volatile
  private var looping = false

  init {
    // 注册到全局提供者，供 LockScreenAlertActivity 直接调用
    ReactContextProvider.setFlashlightModule(this)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    stopBlinkingInternal()
    turnOffInternal()
    cleanupBackgroundThread()
    unregisterTorchCallback()
    // 清除全局引用，避免 LockScreenAlertActivity 持有已失效的模块实例
    ReactContextProvider.setFlashlightModule(null)
    super.invalidate()
  }

  /**
   * 初始化 CameraManager 和后置摄像头 ID
   * 延迟初始化，首次使用时调用。
   */
  @SuppressLint("MissingPermission")
  private fun ensureCameraManager(): Boolean {
    if (cameraManager == null) {
      cameraManager = reactContext.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
      if (cameraManager == null) {
        emitError("ensureCameraManager", "无法获取 CameraManager")
        return false
      }
    }

    if (cameraId == null) {
      try {
        val ids = cameraManager!!.cameraIdList
        for (id in ids) {
          val characteristics = cameraManager!!.getCameraCharacteristics(id)
          val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
          if (facing == CameraCharacteristics.LENS_FACING_BACK) {
            val hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE)
            if (hasFlash == true) {
              cameraId = id
              break
            }
          }
        }
        if (cameraId == null) {
          emitError("ensureCameraManager", "未找到带闪光灯的后置摄像头")
          return false
        }
      } catch (e: Exception) {
        emitError("ensureCameraManager", e.message ?: e::class.java.simpleName)
        return false
      }
    }

    return true
  }

  /**
   * 注册 TorchCallback（API 23+，本项目 minSdk 26）
   * 用于监听 torch 模式状态变化，确保设置成功。
   */
  private fun registerTorchCallback() {
    if (torchCallback != null) return
    try {
      val callback = object : CameraManager.TorchCallback() {
        override fun onTorchModeChanged(id: String, enabled: Boolean) {
          // 状态变化回调，此处仅记录日志不做处理
        }
      }
      cameraManager?.registerTorchCallback(callback, mainHandler)
      torchCallback = callback
    } catch (_: Exception) {
      // 注册失败忽略，不影响主流程
    }
  }

  private fun unregisterTorchCallback() {
    try {
      torchCallback?.let { callback ->
        cameraManager?.unregisterTorchCallback(callback)
      }
      torchCallback = null
    } catch (_: Exception) {
      // 忽略
    }
  }

  /**
   * 打开闪光灯
   */
  @ReactMethod
  fun turnOn() {
    try {
      if (!ensureCameraManager()) return
      val id = cameraId ?: return
      cameraManager?.setTorchMode(id, true)
    } catch (e: Exception) {
      emitError("turnOn", e.message ?: e::class.java.simpleName)
    }
  }

  /**
   * 关闭闪光灯
   */
  @ReactMethod
  fun turnOff() {
    turnOffInternal()
  }

  /** 内部关闭 */
  private fun turnOffInternal() {
    try {
      val id = cameraId ?: return
      cameraManager?.setTorchMode(id, false)
    } catch (_: Exception) {
      // 忽略关闭异常
    }
  }

  /**
   * 闪烁 N 次
   * @param times 闪烁次数
   * @param intervalMs 间隔（毫秒）
   *
   * 实现：开 → sleep(intervalMs) → 关 → sleep(intervalMs)，循环 times 次
   * 在后台线程执行避免阻塞主线程
   */
  @ReactMethod
  fun blink(times: Int, intervalMs: Int) {
    if (times <= 0) return
    val safeInterval = if (intervalMs > 0) intervalMs.toLong() else 500L

    blinkCancelled = true // 取消上一次的 blink
    ensureBackgroundThread()

    backgroundHandler?.post {
      try {
        if (!ensureCameraManager()) return@post
        registerTorchCallback()
        blinkCancelled = false
        val id = cameraId ?: return@post

        for (i in 0 until times) {
          if (blinkCancelled) break
          // 开
          try {
            cameraManager?.setTorchMode(id, true)
          } catch (e: Exception) {
            emitError("blink-on-$i", e.message ?: e::class.java.simpleName)
            break
          }
          Thread.sleep(safeInterval)
          if (blinkCancelled) break
          // 关
          try {
            cameraManager?.setTorchMode(id, false)
          } catch (e: Exception) {
            emitError("blink-off-$i", e.message ?: e::class.java.simpleName)
            break
          }
          Thread.sleep(safeInterval)
        }
        // 确保最终关闭
        try {
          cameraManager?.setTorchMode(id, false)
        } catch (_: Exception) {
          // 忽略
        }
      } catch (e: InterruptedException) {
        // 被中断，正常退出
      } catch (e: Exception) {
        emitError("blink", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /**
   * 循环闪烁闪光灯，直到 stopBlinking 调用
   * @param intervalMs 间隔（毫秒），开/关各持续此时间
   *
   * 实现：在后台线程循环 开→sleep→关→sleep，通过 looping 标志位控制退出。
   * 用于地震预警持续闪烁直到悬浮窗隐藏。
   */
  @ReactMethod
  fun startBlinking(intervalMs: Int) {
    val safeInterval = if (intervalMs > 0) intervalMs.toLong() else 500L
    // 取消可能的 blink(times) 调用
    blinkCancelled = true
    // 启动循环
    looping = true
    ensureBackgroundThread()

    backgroundHandler?.post {
      try {
        if (!ensureCameraManager()) return@post
        registerTorchCallback()
        val id = cameraId ?: return@post

        while (looping && !Thread.currentThread().isInterrupted) {
          // 开
          try {
            cameraManager?.setTorchMode(id, true)
          } catch (e: Exception) {
            emitError("startBlinking-on", e.message ?: e::class.java.simpleName)
            break
          }
          Thread.sleep(safeInterval)
          if (!looping) break
          // 关
          try {
            cameraManager?.setTorchMode(id, false)
          } catch (e: Exception) {
            emitError("startBlinking-off", e.message ?: e::class.java.simpleName)
            break
          }
          Thread.sleep(safeInterval)
        }
        // 确保最终关闭
        try {
          cameraManager?.setTorchMode(id, false)
        } catch (_: Exception) {
          // 忽略
        }
      } catch (e: InterruptedException) {
        // 正常退出
      } catch (e: Exception) {
        emitError("startBlinking", e.message ?: e::class.java.simpleName)
      }
    }
  }

  /**
   * 停止循环闪烁
   */
  @ReactMethod
  fun stopBlinking() {
    stopBlinkingInternal()
  }

  /** 内部停止循环闪烁 */
  private fun stopBlinkingInternal() {
    looping = false
    // 关闭当前亮着的状态
    turnOffInternal()
  }

  /** 初始化后台线程 */
  private fun ensureBackgroundThread() {
    if (backgroundThread == null) {
      val thread = HandlerThread("FlashlightModule-Background").apply {
        priority = Thread.MIN_PRIORITY
        start()
      }
      backgroundThread = thread
      backgroundHandler = Handler(thread.looper)
    }
  }

  /** 清理后台线程 */
  private fun cleanupBackgroundThread() {
    try {
      backgroundThread?.let { thread ->
        thread.quitSafely()
        thread.join(100)
      }
    } catch (_: Exception) {
      // 忽略
    }
    backgroundThread = null
    backgroundHandler = null
  }

  /** 向 JS 端发送错误事件 */
  private fun emitError(from: String, message: String) {
    mainHandler.post {
      try {
        reactContext
          .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_ERROR, mapOf("from" to from, "message" to message))
      } catch (_: Exception) {
        // 忽略发送失败
      }
    }
  }
}
