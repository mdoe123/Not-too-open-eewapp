package com.mdoeeewapp.android.cn.background

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * 原生定位封装（仅供后台服务使用）
 *
 * 使用 Android 原生 [LocationManager]（不依赖 Google Play Services，适配国内无 GMS 设备）。
 * 提供一次性定位获取 [getCurrentLocation]，用于：
 * 1. 后台服务 15 分钟主动刷新用户位置（仅 GPS 模式）
 * 2. 收到预警后用最新坐标更新已显示预警
 *
 * 定位失败/权限不足/无可用 provider 时回调 null（fail-open），不抛异常、不影响预警主流程。
 * 取自项目现状：JS 层已通过 useUserLocation 维护前台位置，此处仅为后台保活场景补充原生态。
 */
class LocationProvider(private val context: Context) {

  companion object {
    private const val TAG = "LocationProvider"

    /** 一次性定位超时（毫秒），超时未定位则回调 null */
    private const val SINGLE_FIX_TIMEOUT_MS = 15000L

    /** 主线程 Handler，回调统一回到主线程 */
    private val mainHandler = Handler(Looper.getMainLooper())
  }

  /** 是否具备定位权限（粗/精任一即可，取精优先） */
  private fun hasPermission(): Boolean {
    val pm = context.packageManager
    return PackageManager.PERMISSION_GRANTED ==
      pm.checkPermission(Manifest.permission.ACCESS_FINE_LOCATION, context.packageName) ||
      PackageManager.PERMISSION_GRANTED ==
      pm.checkPermission(Manifest.permission.ACCESS_COARSE_LOCATION, context.packageName)
  }

  /**
   * 选出可用 Provider：优先 GPS_PROVIDER（高精度），不可用则用 NETWORK_PROVIDER（网络定位）。
   * Android 上两 provider 均不可用时返回 null。
   */
  private fun pickProvider(lm: LocationManager): String? {
    if (lm.getProvider(LocationManager.GPS_PROVIDER) != null) {
      return LocationManager.GPS_PROVIDER
    }
    return if (lm.getProvider(LocationManager.NETWORK_PROVIDER) != null) {
      LocationManager.NETWORK_PROVIDER
    } else {
      null
    }
  }

  /**
   * 先尝试 [LocationManager.getLastKnownLocation]（瞬时返回缓存位置），
   * 若无有效缓存再发起 [LocationManager.requestSingleUpdate] 主动定位。
   *
   * 回调在主线程执行；失败/超时/无权限均回调 null。
   *
   * @param onResult 定位结果 (lat, lng)，失败为 null
   */
  fun getCurrentLocation(onResult: (lat: Double, lng: Double) -> Unit) {
    if (!hasPermission()) {
      Log.w(TAG, "无定位权限，回调 null")
      return
    }

    val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    if (lm == null) {
      Log.w(TAG, "系统无 LocationManager，回调 null")
      return
    }

    val callback: (Location?) -> Unit = { loc ->
      mainHandler.post {
        if (loc != null) {
          Log.i(TAG, "定位成功: ${loc.latitude}, ${loc.longitude} (provider=${loc.provider})")
          onResult(loc.latitude, loc.longitude)
        } else {
          Log.w(TAG, "定位失败/超时，回调 null")
        }
      }
    }

    // 尝试缓存位置（优先精确provider）
    val provider = pickProvider(lm)
    if (provider != null) {
      val gpsProvider = if (lm.getProvider(LocationManager.GPS_PROVIDER) != null) {
        LocationManager.GPS_PROVIDER
      } else {
        null
      }
      val last = runCatching {
        val cached = gpsProvider?.let { lm.getLastKnownLocation(it) }
          ?: lm.getLastKnownLocation(provider)
        cached
      }.getOrNull()
      if (last != null && System.currentTimeMillis() - last.time < 600000L) {
        // 缓存不超过 10 分钟直接复用，避免频繁冷启动 GPS
        Log.i(TAG, "复用缓存位置: ${last.latitude}, ${last.longitude}")
        callback(last)
        return
      }
    }

    // 无有效缓存，发起一次性主动定位
    if (provider != null) {
      val callbacks = object : LocationListener {
        override fun onLocationChanged(location: Location) {
          lm.removeUpdates(this)
          callback(location)
        }
        @Deprecated("Deprecated in Java")
        override fun onStatusChanged(p0: String?, p1: Int, p2: Bundle?) {}
        override fun onProviderEnabled(p0: String) {}
        override fun onProviderDisabled(p0: String) {}
      }
      try {
        lm.requestSingleUpdate(provider, callbacks, Looper.getMainLooper())
        // 超时兜底：超时后取消监听并尝试取缓存位置
        mainHandler.postDelayed({
          runCatching { lm.removeUpdates(callbacks) }
          val lazy = runCatching { lm.getLastKnownLocation(provider) }.getOrNull()
          callback(lazy)
        }, SINGLE_FIX_TIMEOUT_MS)
      } catch (e: SecurityException) {
        Log.w(TAG, "定位 SecurityException: ${e.message}")
        callback(null)
      }
    } else {
      Log.w(TAG, "无可用定位 Provider，回调 null")
    }
  }
}