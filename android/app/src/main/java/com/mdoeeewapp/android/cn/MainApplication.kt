package com.mdoeeewapp.android.cn

import android.app.Application
import com.mdoeeewapp.android.cn.floatingwindow.FloatingWindowPackage
import com.mdoeeewapp.android.cn.autostart.AutoStartPackage
import com.mdoeeewapp.android.cn.background.BackgroundServicePackage
import com.mdoeeewapp.android.cn.flashlight.FlashlightPackage
import com.mdoeeewapp.android.cn.sound.SoundPackage
import com.mdoeeewapp.android.cn.vibrator.VibratorPackage
import com.mdoeeewapp.android.cn.permission.PermissionPackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(FloatingWindowPackage())
          add(AutoStartPackage())
          add(BackgroundServicePackage())
          add(FlashlightPackage())
          add(SoundPackage())
          add(VibratorPackage())
          add(PermissionPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
