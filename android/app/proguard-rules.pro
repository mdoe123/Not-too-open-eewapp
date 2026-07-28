# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# React Native 核心（默认规则已覆盖大部分，保险起见）
-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }

# 应用原生模块（FloatingWindow / FullScreenAlert / AutoStart / BackgroundService）
-keep class com.mdoeeewapp.android.cn.** { *; }

# AsyncStorage（sqlite）
-keep class com.reactnativecommunity.asyncstorage.** { *; }

# WebView
-keep class com.reactnativecommunity.webview.** { *; }

# Slider / Geolocation / Permissions / Gesture Handler / Screens / SVG / SafeArea
-keep class com.reactnativecommunity.slider.** { *; }
-keep class com.reactnativecommunity.geolocation.** { *; }
-keep class com.zoontek.rnpermissions.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.horcrux.svg.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }
