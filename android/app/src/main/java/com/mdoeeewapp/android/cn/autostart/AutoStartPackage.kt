package com.mdoeeewapp.android.cn.autostart

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * 厂商自启动模块的 ReactPackage
 *
 * 已在 MainApplication.kt 的 PackageList 中注册：add(AutoStartPackage())。
 * 注册后 RN 层即可通过 NativeModules.AutoStartModule 访问 [AutoStartModule]。
 */
class AutoStartPackage : ReactPackage {

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(AutoStartModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, ReactShadowNode<*>>> {
    return emptyList()
  }
}
