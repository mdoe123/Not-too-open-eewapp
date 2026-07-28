// 数据层调试日志
//
// 统一前缀 `[EEW:模块]`，便于 adb logcat 过滤。
// React Native 的 console.log 输出到 logcat 的 `ReactNativeJS` tag。
//
// 查看日志（任选其一）：
//   adb logcat -s ReactNativeJS:* | grep "EEW:"     # 实时查看数据层日志
//   adb logcat -s ReactNativeJS:* -d | grep "EEW:"   # 拉取历史日志
//   adb logcat -s ReactNativeJS:* -d > logcat.txt     # 导出到文件
//   yarn log-server + 设置页启用远程日志              # WebSocket 远程日志
//
// 关闭日志：将 LOG_ENABLED 设为 false（生产环境）

/** 日志总开关（true=开启调试日志） */
const LOG_ENABLED = true;

/** 数据层模块标签 */
export type LogModule = 'GET' | 'WS' | 'MGR' | 'STREAM' | 'LOCATION' | 'FLOAT' | 'CUSTOM';

/**
 * 日志接收器接口
 *
 * 实现 此接口可将日志转发到任意目标（如 WebSocket 远程服务器）。
 * 通过 [setLogSink] 注册全局唯一的 sink，log() 会在 console.log 之外额外调用。
 */
export interface LogSink {
  /**
   * 发送一条日志
   * @param module 模块标签
   * @param message 日志消息
   * @param data 附加数据（对象或字符串）
   */
  send(module: LogModule, message: string, data?: unknown): void;
}

/** 全局日志 sink（可选，由 remoteLogSink 注册） */
let activeLogSink: LogSink | null = null;

/**
 * 注册全局日志 sink
 *
 * 注册后所有 log() 调用都会额外转发到 sink。
 * 传入 null 取消注册。
 *
 * @param sink 日志接收器，或 null 取消
 */
export function setLogSink(sink: LogSink | null): void {
  activeLogSink = sink;
}

/**
 * 输出数据层调试日志
 *
 * @param module 模块标签（GET/WS/MGR/STREAM）
 * @param message 日志消息
 * @param data 附加数据（对象会 JSON 序列化，字符串原样输出）
 *
 * @example
 * log('GET', '推送事件', { id: 'wolfxGetCenc-abc', mag: 5.2 });
 * // 输出: [EEW:GET] 12:34:56.789 推送事件 {"id":"wolfxGetCenc-abc","mag":5.2}
 */
export function log(module: LogModule, message: string, data?: unknown): void {
  if (!LOG_ENABLED) return;
  const ts = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  const dataStr = data !== undefined ? ' ' + tryStringify(data) : '';
  console.log(`[EEW:${module}] ${ts} ${message}${dataStr}`);

  // 转发到远程 sink（如有）
  if (activeLogSink) {
    try {
      activeLogSink.send(module, message, data);
    } catch {
      // sink 异常不影响主流程
    }
  }
}

/** 安全序列化（循环引用等异常时回退到 String） */
function tryStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
