package com.mdoeeewapp.android.cn.background

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * 数据源文件导入原生模块
 *
 * 提供两种从外部导入数据源 JSON 的方式：
 *
 * 1. **文件夹扫描**：扫描应用外部私有目录下的固定子目录（`eew_sources/`），
 *    读取其中所有 `.json` 文件。无需任何存储权限。
 *
 *    目录路径（用户可用文件管理器放入文件）：
 *    `/sdcard/Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
 *
 *    或等价的：`getExternalFilesDir(null)/eew_sources/`
 *
 *    优势：无需存储权限、目录固定、文件管理器可直接访问、卸载时自动清理
 *
 * 2. **文件选择器（SAF）**：通过 Android Storage Access Framework
 *    （Intent.ACTION_OPEN_DOCUMENT）让用户从任意位置选择 `.json` 文件。
 *
 *    优势：可访问任何位置（Downloads、内部存储、U 盘等），
 *    无需申请存储权限（SAF 由系统统一授权）。
 *
 * 文件格式要求：SourceSharePack JSON（与 QR 扫码导入一致）
 *
 * 设计要点：
 * - 所有方法通过 Promise 返回结果，避免阻塞 JS 线程
 * - SAF 文件选择通过 ActivityEventListener 接收结果
 * - 文件读取失败时不中断其他文件的导入（容错设计）
 */
class FileSourceImportModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  companion object {
    const val NAME = "FileSourceImportModule"
    private const val TAG = "FileSourceImportModule"

    /** 固定扫描子目录名（位于 getExternalFilesDir 下） */
    private const val SOURCE_DIR_NAME = "eew_sources"

    /** SAF 文件选择请求码 */
    private const val PICK_FILE_REQUEST_CODE = 10002
  }

  /** 当前等待 SAF 结果的 Promise（同一时刻只允许一个选择请求） */
  private var pickPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = NAME

  // ======================== 文件夹扫描 ========================

  /**
   * 扫描固定目录下所有 `.json` 文件，返回文件名列表（不含路径）
   *
   * 若目录不存在会自动创建空目录。
   *
   * @param promise resolve(Array<string>) 文件名列表（按字母序）
   */
  @ReactMethod
  fun scanSourceFiles(promise: Promise) {
    try {
      val dir = getSourceDir()
      if (!dir.exists()) {
        dir.mkdirs()
        Log.i(TAG, "源目录已创建: ${dir.absolutePath}")
        promise.resolve(emptyArray<String>())
        return
      }
      val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".json", ignoreCase = true) }
        ?: emptyArray()
      val names = files.map { it.name }.sorted()
      Log.i(TAG, "扫描到 ${names.size} 个 .json 文件")
      promise.resolve(names.toTypedArray())
    } catch (e: Exception) {
      Log.e(TAG, "scanSourceFiles 失败: ${e.message}")
      promise.reject("SCAN_ERROR", e.message)
    }
  }

  /**
   * 读取固定目录下所有 `.json` 文件的内容（一次性返回）
   *
   * 用于"批量导入"场景：用户在 UI 点击"导入全部"后调用此方法。
   * 读取失败的文件会被跳过（不会中断整个流程）。
   *
   * @param promise resolve(Array<string>) JSON 文本列表（仅含读取成功的文件）
   */
  @ReactMethod
  fun readAllSourceFiles(promise: Promise) {
    try {
      val dir = getSourceDir()
      if (!dir.exists()) {
        dir.mkdirs()
        promise.resolve(emptyArray<String>())
        return
      }
      val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".json", ignoreCase = true) }
        ?: emptyArray()
      val contents = files.sortedBy { it.name }.mapNotNull { file ->
        try {
          file.readText(Charsets.UTF_8)
        } catch (e: Exception) {
          Log.w(TAG, "跳过读取失败的文件 ${file.name}: ${e.message}")
          null
        }
      }.filter { it.isNotEmpty() }
      Log.i(TAG, "读取了 ${contents.size} 个文件内容")
      promise.resolve(contents.toTypedArray())
    } catch (e: Exception) {
      Log.e(TAG, "readAllSourceFiles 失败: ${e.message}")
      promise.reject("READ_ALL_ERROR", e.message)
    }
  }

  /**
   * 读取固定目录下指定文件名的内容
   *
   * @param fileName 文件名（如 "usgs.json"）
   * @param promise resolve(string) JSON 文本
   */
  @ReactMethod
  fun readSourceFile(fileName: String, promise: Promise) {
    try {
      // 安全检查：防止路径穿越（fileName 不应包含路径分隔符）
      val safeName = File(fileName).name
      if (safeName != fileName) {
        promise.reject("INVALID_NAME", "文件名不能包含路径分隔符")
        return
      }
      val file = File(getSourceDir(), safeName)
      if (!file.exists() || !file.isFile) {
        promise.reject("FILE_NOT_FOUND", "文件不存在: $safeName")
        return
      }
      val content = file.readText(Charsets.UTF_8)
      promise.resolve(content)
    } catch (e: Exception) {
      Log.e(TAG, "readSourceFile 失败: ${e.message}")
      promise.reject("READ_ERROR", e.message)
    }
  }

  /**
   * 获取源目录的绝对路径（供 UI 显示给用户，引导其放入文件）
   *
   * @param promise resolve(string) 绝对路径
   */
  @ReactMethod
  fun getSourceDirectoryPath(promise: Promise) {
    try {
      val dir = getSourceDir()
      if (!dir.exists()) {
        dir.mkdirs()
      }
      promise.resolve(dir.absolutePath)
    } catch (e: Exception) {
      Log.e(TAG, "getSourceDirectoryPath 失败: ${e.message}")
      promise.reject("PATH_ERROR", e.message)
    }
  }

  // ======================== 文件选择器（SAF） ========================

  /**
   * 启动系统文件选择器，让用户选择一个 `.json` 文件
   *
   * 选择成功后 resolve 文件内容字符串；用户取消或读取失败时 reject。
   * 同一时刻只允许一个选择请求，重复调用会被拒绝。
   *
   * 通过 [ActivityEventListener.onActivityResult] 接收结果，
   * 兼容 RN 的 Activity 生命周期。
   *
   * @param promise resolve(string) JSON 文本
   */
  @ReactMethod
  fun pickFile(promise: Promise) {
    if (pickPromise != null) {
      promise.reject("ALREADY_PICKING", "已有文件选择请求进行中")
      return
    }
    pickPromise = promise
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "application/json"
        // 同时接受 json / 纯文本 / 通用二进制（部分文件管理器 json MIME 不准）
        putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
      }
      val activity = reactContext.currentActivity
        ?: throw Exception("无当前 Activity")
      activity.startActivityForResult(intent, PICK_FILE_REQUEST_CODE)
      Log.i(TAG, "已启动 SAF 文件选择器")
    } catch (e: Exception) {
      Log.e(TAG, "pickFile 启动失败: ${e.message}")
      pickPromise = null
      promise.reject("PICK_ERROR", e.message)
    }
  }

  // ======================== ActivityEventListener 实现 ========================

  /**
   * 接收 SAF 文件选择器的结果
   *
   * 注意 RN 0.86+ 起 ActivityEventListener 接口签名中 activity 与 intent 为非空类型。
   */
  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PICK_FILE_REQUEST_CODE) return
    val promise = pickPromise
    pickPromise = null
    if (promise == null) return

    if (resultCode != Activity.RESULT_OK || data?.data == null) {
      Log.i(TAG, "用户取消文件选择")
      promise.reject("USER_CANCELED", "用户取消选择")
      return
    }

    try {
      val uri = data.data!!
      val content = readUriContent(uri)
      Log.i(TAG, "SAF 文件读取成功，长度=${content.length}")
      promise.resolve(content)
    } catch (e: Exception) {
      Log.e(TAG, "SAF 文件读取失败: ${e.message}")
      promise.reject("READ_URI_ERROR", e.message)
    }
  }

  override fun onNewIntent(intent: Intent) {
    // No-op（SAF 不需要 onNewIntent）
  }

  // ======================== 内部工具 ========================

  /**
   * 获取固定源文件目录（应用外部私有目录下的 `eew_sources/` 子目录）
   *
   * 路径示例：`/sdcard/Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
   *
   * 优势：
   * - 无需任何存储权限（应用外部私有目录）
   * - 文件管理器可直接访问（用户可放入文件）
   * - 卸载 App 时自动清理
   */
  private fun getSourceDir(): File {
    val base = reactContext.getExternalFilesDir(null)
      ?: throw Exception("getExternalFilesDir 返回 null")
    return File(base, SOURCE_DIR_NAME)
  }

  /**
   * 通过 ContentResolver 读取 SAF 返回的 URI 内容
   */
  private fun readUriContent(uri: Uri): String {
    return reactContext.contentResolver.openInputStream(uri)?.use { input ->
      input.bufferedReader(Charsets.UTF_8).readText()
    } ?: throw Exception("无法打开文件: $uri")
  }
}
