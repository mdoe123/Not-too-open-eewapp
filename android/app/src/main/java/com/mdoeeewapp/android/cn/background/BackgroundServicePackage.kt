package com.mdoeeewapp.android.cn.background

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * 后台保活服务 ReactPackage
 *
 * 注册以下原生模块到 RN 桥：
 * - [BackgroundServiceModule]：后台保活服务（ForegroundService + 常驻通知 + 锁屏预警）
 * - [FileSourceImportModule]：数据源文件导入（文件夹扫描 + SAF 文件选择器）
 */
class BackgroundServicePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(
      BackgroundServiceModule(reactContext),
      FileSourceImportModule(reactContext),
    )
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
