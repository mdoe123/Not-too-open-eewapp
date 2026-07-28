package com.mdoeeewapp.android.cn.floatingwindow

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * 悬浮窗模块注册包
 *
 * 将 FloatingWindowModule 注册到 React Native 桥，
 * 使 RN 侧可通过 NativeModules.FloatingWindowModule 调用原生能力。
 *
 * 本模块不提供 ViewManager（悬浮窗由原生 WindowManager 直接管理，非 RN 组件）。
 */
class FloatingWindowPackage : ReactPackage {

  /** 注册原生模块 */
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(FloatingWindowModule(reactContext))
  }

  /** 无 ViewManager，返回空列表 */
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
