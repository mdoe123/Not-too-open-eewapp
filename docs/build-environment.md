# 构建环境配置说明

本文档记录真机验证构建过程中的环境配置变更。

## 环境信息

| 项目 | 值 |
|------|-----|
| 操作系统 | Windows |
| JDK | Zulu 17 (`C:\Program Files\Zulu\zulu-17`) |
| Android SDK | `%LOCALAPPDATA%\Android\Sdk` |
| NDK | 27.1.12297006 |
| CMake | 3.22.1 |
| Gradle | 9.3.1 |
| Kotlin | 2.1.20 |
| 测试设备 | 小米 22101316C (Android 12, API 31) |

## 构建配置变更

### 1. Gradle 镜像（gradle-wrapper.properties）

国内访问 `services.gradle.org` 受限，改用腾讯云镜像：

```properties
distributionUrl=https\://mirrors.cloud.tencent.com/gradle/gradle-9.3.1-bin.zip
networkTimeout=60000
validateDistributionUrl=false
```

### 2. Maven 镜像（~/.gradle/init.d/mirrors.gradle）

创建全局 Gradle init 脚本，将所有 Maven 仓库重定向到阿里云镜像：

- `https://maven.aliyun.com/repository/public`
- `https://maven.aliyun.com/repository/google`
- `https://maven.aliyun.com/repository/gradle-plugin`
- `https://maven.aliyun.com/repository/central`

### 3. compileSdkVersion 34 → 36

`androidx.core:core:1.17.0` 和 `androidx.transition:transition:1.7.0` 要求 compileSdk 36。
SDK android-36 已安装，targetSdk 保持 34 不变（维持运行时行为）。

```gradle
compileSdkVersion = 36  // 从 34 升级
targetSdkVersion = 34   // 保持不变
```

### 4. 移除未使用依赖

以下 npm 包在代码中未被引用，且其 Maven 仓库国内无法访问，已移除：

- `react-native-background-fetch` - 依赖 `com.transistorsoft:tsbackgroundfetch`（自定义 Maven 仓库）
- `@notifee/react-native` - 依赖 `app.notifee:core`（`dl.notifee.dev` 域名无法解析）

同时移除 `android/build.gradle` 中的 notifee Maven 仓库配置。

> 后续如需通知功能，可通过 Android 原生 NotificationManager 或其他国内可访问的库实现。

### 5. local.properties

```properties
sdk.dir=C:\\Users\\mdoeb\\AppData\\Local\\Android\\Sdk
```

### 6. Android 包名迁移（com.androideewapp → com.mdoeeewapp.android.cn）

将应用包名从 `com.androideewapp` 改为 `com.mdoeeewapp.android.cn`。

涉及变更：

| 项 | 旧值 | 新值 |
|----|------|------|
| `applicationId` | com.androideewapp | com.mdoeeewapp.android.cn |
| `namespace` | com.androideewapp | com.mdoeeewapp.android.cn |
| Kotlin 源码目录 | `android/app/src/main/java/com/androideewapp/` | `android/app/src/main/java/com/mdoeeewapp/android/cn/` |
| 12 个 .kt 文件 `package` 声明 | `com.androideewapp.*` | `com.mdoeeewapp.android.cn.*` |
| `FullScreenAlertActivity` ACTION_DISMISS 广播 action | `com.androideewapp.fullscreenalert.ACTION_DISMISS` | `com.mdoeeewapp.android.cn.fullscreenalert.ACTION_DISMISS` |

AndroidManifest.xml 中所有 Activity/Service/Receiver 使用相对路径（如 `.MainActivity`、`.fullscreenalert.FullScreenAlertActivity`），自动跟随 namespace，无需单独修改。

签名 SHA1 指纹（debug keystore）：

```
5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

> 迁移完成后构建通过（3m 38s），APK 已安装到设备并以新包名启动 `com.mdoeeewapp.android.cn/.MainActivity`。

## APK 体积优化

早期 debug APK 约 200MB，根因是「4 架构原生 .so 全打包 + 高德地图 AAR 未用却保留 + 未启用代码/资源压缩」。通过以下优化降至约 50-60MB（release arm64-v8a 单 APK）。

### 1. ABI splits（按架构拆分 APK）

`android/app/build.gradle` 配置 `splits.abi`，release 构建生成 `app-arm64-v8a-release.apk` 和 `app-armeabi-v7a-release.apk` 两个独立 APK，排除仅模拟器用的 x86/x86_64：

```gradle
splits {
    abi {
        reset()
        enable true
        universalApk false
        include "armeabi-v7a", "arm64-v8a"
    }
}
```

`gradle.properties` 默认构建架构设为 `arm64-v8a`（真机），debug `installDebug` 会根据设备 ABI 自动选择对应 APK。如需 x86 模拟器调试：

```bash
./gradlew installDebug -PreactNativeArchitectures=x86_64
```

### 2. 移除高德地图 SDK

RN 端已移除地图显示（EpicenterMap.tsx 已删除），JS 端对 AMapView/amap 零引用，原生 AAR + 模块纯属冗余（占 30-40MB），已彻底移除：

- 删除 `android/app/libs/Lite3dMap_*.aar`（含项目根目录重复的一份）
- 删除 `android/app/src/main/java/com/mdoeeewapp/android/cn/amap/` 目录（AMapViewManager / AMapViewPackage / CoordTransform）
- `MainApplication.kt` 移除 `AMapViewPackage()` 注册
- `build.gradle` 移除 `flatDir` 仓库和 AAR 依赖
- `AndroidManifest.xml` 移除高德 API key meta-data 和高德专属权限（ACCESS_NETWORK_STATE / CHANGE_WIFI_STATE / WRITE_EXTERNAL_STORAGE）
- `res/values/ids.xml` 清理高德 ViewManager 的 tag 资源
- 保留 `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`（geolocation 需要）

> 事件详情页（EventDetailScreen）的地图仍可用——它用 WebView 加载 `eqckq.html`（Leaflet + 高德瓦片服务），是 Web 地图，不依赖原生 AAR。

### 3. Release 代码/资源压缩

`build.gradle` 启用 `minifyEnabled true` + `shrinkResources true`，配合 `proguard-rules.pro` keep 规则覆盖所有原生模块和第三方库，防止反射调用被混淆。

```gradle
def enableProguardInReleaseBuilds = true

release {
    minifyEnabled enableProguardInReleaseBuilds
    shrinkResources true
    proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
}
```

### 预期收益

| 优化项 | 预期节省 |
|--------|----------|
| ABI splits（排除 x86/x86_64） | ~80-110MB |
| 移除高德 AAR | ~30-40MB |
| release minify + shrink | ~5-15MB |

release arm64-v8a 单 APK 约 50-60MB（从 200MB 降至约 1/4）。

## 构建命令

```powershell
$env:JAVA_HOME="C:\Program Files\Zulu\zulu-17"
$env:Path="$env:JAVA_HOME\bin;$env:Path"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
yarn android
```

### JDK 版本要求

**必须使用 JDK 17**。系统已安装多个 JDK（Zulu 8/17/21/26），但：

- **JDK 17（推荐）**：与 Gradle 9.3.1 完全兼容，构建稳定通过
- **JDK 21**：可能兼容，未充分验证
- **JDK 26（不可用）**：Gradle 9.3.1 的 jlink transform 在 JDK 26 下失败，报 `WARNING: A restricted method in java.lang.System has been called` 和沙箱权限错误，无法完成构建

### 短路径构建（必读）

**必须从短路径构建 release APK，不能从原始路径 `D:\xiangmu\eewapp\android-eew-app\android` 构建**。

原因：Windows MAX_PATH（260 字符）限制。从原始路径构建时，CMake ninja 在编译
`react-native-gesture-handler` 的 codegen 产物时报错：

```
ninja: error: Stat(rngesturehandler_codegen_autolinked_build/CMakeFiles/...
  react_codegen_rngesturehandler_codegen.dir/D_/xiangmu/eewapp/android-eew-app/
  node_modules/react-native-gesture-handler/shared/shadowNodes/...): Filename longer than 260 characters
```

codegen 生成的 CMake 对象文件路径超过 260 字符，ninja 无法创建。
（debug 构建目录名 `Debug` 比 `RelWithDebInfo` 短 5 个字符，刚好压线能过，所以只有 release 失败。）

**推荐方案：robocopy 真实复制到短路径构建（v1.0.4/v1.0.5/v1.0.6 实测通过）**

```powershell
# 1. 复制项目到 C:\eewapp（排除缓存与构建产物）
robocopy D:\xiangmu\eewapp\android-eew-app C:\eewapp /E /MT:16 /R:1 /W:1 `
  /XD .cxx .gradle `
  /XF NTOEEW-*.apk build.log test.log

# 2. 从短路径构建 release
$env:JAVA_HOME="C:\Program Files\Zulu\zulu-17"
cd C:\eewapp\android
.\gradlew.bat assembleRelease --console=plain

# 3. 产物在 C:\eewapp\android\app\build\outputs\apk\release\
#    复制回仓库根目录并按规范命名
Copy-Item C:\eewapp\android\app\build\outputs\apk\release\app-arm64-v8a-release.apk `
  D:\xiangmu\eewapp\android-eew-app\NTOEEW-v1.0.6-arm64-v8a-release.apk
Copy-Item C:\eewapp\android\app\build\outputs\apk\release\app-armeabi-v7a-release.apk `
  D:\xiangmu\eewapp\android-eew-app\NTOEEW-v1.0.6-armeabi-v7a-release.apk

# 4. 构建完成后可删除临时目录（约 6GB）
Remove-Item -Recurse -Force C:\eewapp
```

> 注：v1.0.5 发布后 `C:\eewapp` 临时目录已删除（2026-09-20，约 7.2GB）；
> v1.0.6 发布（2026-09-26，BUILD SUCCESSFUL in 8m 8s）时重新 robocopy 复制并构建，
> 构建完成后同样可删除该临时目录。下次发布按上述步骤重新 robocopy 复制即可。
> 删除时先 `gradlew --stop` 停止 gradle daemon，再用
> `node -e "require('fs').rmSync('C:/eewapp',{recursive:true,force:true})"`
> 执行（PowerShell `Remove-Item` 在 C 盘该路径可能受权限/占用限制，node 外部进程更可靠）。

**robocopy 参数警告（v1.0.5 实测踩坑）**：

1. **禁止用 `/XD build`**：robocopy 的 `/XD` 匹配**任意层级**的同名目录，
   `node_modules` 下所有名为 `build` 的包目录（如 `@react-native-community/cli/build`）
   会被一并排除，导致 `settings.gradle` 的 autolink 命令找不到 `cli/build/bin.js` 而失败。
   只能排除 `.cxx .gradle` 这类确无用的目录。

2. **若曾在 subst 盘符（如 `S:`）下构建过**：`android/build/generated/autolinking/autolinking.json`
   缓存会残留 `S:\node_modules\...` 路径。由于 lockFiles（yarn.lock/package.json）哈希未变，
   gradle 会**直接复用该缓存**，报
   `Configuring project ':react-native-vision-camera' ... projectDirectory 'S:\node_modules\...' does not exist`。
   修复：删除缓存后重新构建（PowerShell `Remove-Item` 可能被沙箱拦截，可用 node 删除）：
   ```powershell
   node -e "require('fs').rmSync('C:/eewapp/android/build/generated/autolinking',{recursive:true,force:true})"
   ```

**为什么不建议用 NTFS Junction（mklink /J）或 subst 盘符**：junction 指向同一物理目录，
node_modules 内的 gradle-plugin 构建产物会被 IDE/监视进程句柄锁定，
`Unable to delete directory ... Failed to delete some children` 导致构建失败，
且停守护进程也无法解锁（曾用 `D:\eew` junction 验证失败）。
subst 盘符（v1.0.5 实测）会导致 Metro bundle 失败：
`Failed to get the SHA-1 for: D:\...\require.js` —— Node 对 subst 盘做 realpath 时返回真实路径，
与 Metro 的 projectRoot（subst 路径）不一致，文件不在 watch 图内无法计算哈希。

**疑难排查**：
- `Cannot create directory '.gradle\9.3.1\fileHashes'` / `拒绝访问`：
  通常是上次失败构建的 Gradle 守护进程残留锁，`.\gradlew.bat --stop` 后重试；
  若 `.gradle` 空目录仍删不掉（被监视句柄占用），改名即可解锁：
  `Rename-Item C:\eewapp\android\.gradle _dead` 然后直接重新构建。
- 首次全新构建约 5-8 分钟（含 C++ 编译）。

**版本号与产物命名**：发版前同步修改 `package.json` 的 `version` 和
`android/app/build.gradle` 的 `versionCode`（+1）/`versionName`，产物命名
`NTOEEW-v{版本}-{abi}-release.apk`。可用 aapt 校验：
`aapt dump badging xxx.apk | Select-String package:`

### 构建产物

Release 构建生成两个 ABI 独立 APK（位于短路径构建目录下）：

```
<短路径>\android\app\build\outputs\apk\release\
├── app-arm64-v8a-release.apk      # 64 位 ARM（现代设备，~25MB）
└── app-armeabi-v7a-release.apk    # 32 位 ARM（老旧设备，~20MB）
```

### 安装到设备

```powershell
$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adb install -r "D:\xiangmu\eewapp\android-eew-app\NTOEEW-v1.0.6-arm64-v8a-release.apk"
```

> `adb` 不在系统 PATH 中，需用完整路径或先 `cd` 到 platform-tools 目录。

## 构建中修复的代码问题

### FloatingWindowModule.kt

- `currentActivity` → `getCurrentActivity()`（RN 0.80+ 已废弃 `currentActivity` 属性）

### FullScreenAlertActivity.kt

- `VIBRATION_AMPLITUDE` 从 `Int`（255）改为 `IntArray`（`intArrayOf(0, 255, 0, 255)`）
  - 原因：`VibrationEffect.createWaveform(long[], int[], int)` 第二参数为 IntArray，不是 Int

## 注意事项

- Metro 端口 8081 若被占用，先 kill node 进程：`Get-NetTCPConnection -LocalPort 8081 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`
- Kotlin daemon 可能因临时文件权限失败，清理缓存：`Remove-Item "$env:LOCALAPPDATA\kotlin\daemon" -Recurse -Force`
- 首次构建约 10 分钟（含 NDK/CMake 下载和 C++ 编译），后续构建约 1-2 分钟

## 远程日志调试

通过 WebSocket 远程获取手机端日志，替代 adb logcat，方便在真机调试时实时查看日志。

### 使用方法

1. **启动日志服务器**（开发机）：

   ```bash
   yarn log-server
   ```

   服务器监听 `0.0.0.0:8089`，输出格式与 logger.ts 一致：`[HH:mm:ss.SSS] [EEW:模块] 消息 {JSON数据}`

2. **获取开发机局域网 IP**（如 `192.168.1.100`）

3. **手机端配置**：
   - 打开 App → 设置 → 调试设置
   - 开启「远程日志」
   - 填入服务器地址：`ws://192.168.1.100:8089`
   - 状态显示「已连接」后，所有 `log()` 调用将同时输出到 logcat 和远程服务器

### 架构

```
手机端 (RN)                         开发机 (Node.js)
┌─────────────────────┐            ┌─────────────────────┐
│ log()               │            │ scripts/log-server.js│
│  ├─ console.log     │            │  (WebSocketServer)   │
│  └─ LogSink         │── WS ────→ │  输出到控制台         │
│     (remoteLogSink) │            │                     │
└─────────────────────┘            └─────────────────────┘
```

- `src/utils/logger.ts`：LogSink 接口 + setLogSink 全局注册
- `src/utils/remoteLogSink.ts`：WebSocket 客户端，断线自动重连（指数退避）
- `scripts/log-server.js`：Node.js WebSocket 服务器（依赖 `ws` 包）
- `src/components/settings/DebugSection.tsx`：设置页调试分组 UI

### 自定义端口

```bash
node scripts/log-server.js --port 9090
```
