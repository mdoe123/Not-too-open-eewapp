// 数据源文件导入 RN 层接口
//
// 封装 FileSourceImportModule 原生模块，提供两种从外部导入数据源 JSON 的方式：
// 1. 文件夹扫描：扫描固定目录（getExternalFilesDir/eew_sources/）下所有 .json 文件
// 2. 文件选择器（SAF）：通过系统文件选择器从任意位置选择 .json 文件
//
// 文件格式要求：SourceSharePack JSON（与 QR 扫码导入一致）
//
// 使用场景：
// - 用户在设置页"导入数据源"Modal 中选择"文件夹"或"文件选择器"Tab
// - 调用对应方法获取 JSON 文本
// - 复用 sourceShare.ts 的 parsePack/validatePack/mergeImported 解析合并
//
// 安全设计：
// - 文件夹扫描仅读取应用外部私有目录（无需存储权限）
// - SAF 通过系统统一授权（无需申请 MANAGE_EXTERNAL_STORAGE）
// - 文件内容仍需通过 sourceShare.ts 校验后才会合并到 config.sources
import {NativeModules, Platform} from 'react-native';

/**
 * 原生 FileSourceImportModule 的类型定义
 * 由 FileSourceImportModule.kt 提供，需在 MainApplication.kt 中注册 BackgroundServicePackage 后才可用
 */
interface FileSourceImportModuleType {
  /** 扫描固定目录下所有 .json 文件，返回文件名列表（不含路径） */
  scanSourceFiles(): Promise<string[]>;
  /** 读取固定目录下所有 .json 文件的内容（一次性返回 JSON 文本数组） */
  readAllSourceFiles(): Promise<string[]>;
  /** 读取固定目录下指定文件名的内容 */
  readSourceFile(fileName: string): Promise<string>;
  /** 获取源目录的绝对路径（供 UI 显示给用户） */
  getSourceDirectoryPath(): Promise<string>;
  /**
   * 启动系统文件选择器（SAF），让用户选择一个 .json 文件
   * @returns 文件 JSON 文本；用户取消时 reject('USER_CANCELED')
   */
  pickFile(): Promise<string>;
}

const FileSourceImportModule: FileSourceImportModuleType | undefined =
  NativeModules.FileSourceImportModule as FileSourceImportModuleType | undefined;

/**
 * 数据源文件导入管理器
 *
 * 提供文件夹扫描和文件选择器两种导入方式，复用 sourceShare.ts 解析合并逻辑。
 *
 * 固定扫描目录（用户可放入文件的位置）：
 * `/sdcard/Android/data/com.mdoeeewapp.android.cn/files/eew_sources/`
 *
 * 使用示例：
 * ```ts
 * // 批量导入文件夹下所有 .json
 * const contents = await FileSourceImportManager.readAllSourceFiles();
 * for (const json of contents) {
 *   const parsed = parsePack(json);
 *   if (parsed.ok) { /* 合并 *\/ }
 * }
 *
 * // 文件选择器
 * const json = await FileSourceImportManager.pickFile();
 * const parsed = parsePack(json);
 * ```
 */
export const FileSourceImportManager = {
  /**
   * 扫描固定目录下所有 .json 文件
   *
   * @returns 文件名列表（按字母序），目录不存在时返回空数组
   */
  async scanSourceFiles(): Promise<string[]> {
    if (Platform.OS !== 'android' || !FileSourceImportModule) return [];
    try {
      return await FileSourceImportModule.scanSourceFiles();
    } catch {
      return [];
    }
  },

  /**
   * 读取固定目录下所有 .json 文件的内容
   *
   * 读取失败的文件会被跳过，不会中断整个流程。
   *
   * @returns JSON 文本数组（仅含读取成功的文件）
   */
  async readAllSourceFiles(): Promise<string[]> {
    if (Platform.OS !== 'android' || !FileSourceImportModule) return [];
    try {
      return await FileSourceImportModule.readAllSourceFiles();
    } catch {
      return [];
    }
  },

  /**
   * 读取固定目录下指定文件名的内容
   *
   * @param fileName 文件名（如 "usgs.json"，不能包含路径分隔符）
   * @returns JSON 文本
   */
  async readSourceFile(fileName: string): Promise<string> {
    if (Platform.OS !== 'android' || !FileSourceImportModule) {
      throw new Error('平台不支持或原生模块未注册');
    }
    return await FileSourceImportModule.readSourceFile(fileName);
  },

  /**
   * 获取源目录的绝对路径
   *
   * 供 UI 显示给用户，引导其通过文件管理器放入 .json 文件。
   *
   * @returns 绝对路径，如 `/storage/emulated/0/Android/data/com.mdoeeewapp.android.cn/files/eew_sources`
   */
  async getSourceDirectoryPath(): Promise<string | null> {
    if (Platform.OS !== 'android' || !FileSourceImportModule) return null;
    try {
      return await FileSourceImportModule.getSourceDirectoryPath();
    } catch {
      return null;
    }
  },

  /**
   * 启动系统文件选择器（SAF），让用户选择一个 .json 文件
   *
   * @returns 文件 JSON 文本
   * @throws 'USER_CANCELED' 用户取消选择
   * @throws 'PICK_ERROR' 启动选择器失败
   * @throws 'READ_URI_ERROR' 读取文件内容失败
   */
  async pickFile(): Promise<string> {
    if (Platform.OS !== 'android' || !FileSourceImportModule) {
      throw new Error('平台不支持或原生模块未注册');
    }
    return await FileSourceImportModule.pickFile();
  },
};
