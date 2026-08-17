package com.mdoeeewapp.android.cn.restart

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * 应用自重启模块注册包
 *
 * 将 [AppRestartModule] 注册到 React Native 桥，
 * 使 RN 侧可通过 NativeModules.AppRestartModule 调用自重启能力。
 *
 * 本模块不提供 ViewManager，返回空列表。
 */
class AppRestartPackage : ReactPackage {

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(AppRestartModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}