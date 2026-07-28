// 数据源适配器抽象接口
// 所有具体数据源（CENC/JMA/USGS/第三方）都需实现本接口，
// 由 SourceManager 统一调度，实现故障切换与无差别事件推送。
import {EewEvent, SourceStatus} from '../types';

/**
 * 数据源向 App 推送事件的回调
 * 当解析出新的 EewEvent 时调用
 */
export type EewEventCallback = (event: EewEvent) => void;

/**
 * 数据源状态变更回调
 * message 为可选的人类可读说明（如错误原因）
 */
export type StatusCallback = (status: SourceStatus, message?: string) => void;

/**
 * 所有数据源必须实现的接口
 *
 * 设计要点：
 * 1. connect / disconnect 负责连接生命周期
 * 2. parse 公开，便于单元测试在不建立连接的情况下验证解析逻辑
 * 3. heartbeat 用于 SourceManager 周期性探活，决定是否切换备源
 */
export interface SourceAdapter {
  /** 数据源类型标识（对应 SourceType） */
  readonly sourceType: string;

  /**
   * 建立连接（WebSocket 或 HTTP 轮询）
   * 连接成功后通过 onEvent 推送事件，通过 onStatus 上报状态
   * @param onEvent 事件回调
   * @param onStatus 状态回调
   */
  connect(onEvent: EewEventCallback, onStatus: StatusCallback): Promise<void>;

  /** 主动断开连接，释放底层资源 */
  disconnect(): Promise<void>;

  /**
   * 解析原始数据为统一 EewEvent
   * 公开方法，便于单元测试
   * @returns 单个事件、事件数组或 null（数据无效时）
   */
  parse(raw: unknown): EewEvent | EewEvent[] | null;

  /**
   * 心跳检测
   * @returns true 表示连接健康；false 表示需要计入失败次数
   */
  heartbeat(): boolean;

  /** 当前状态 */
  getStatus(): SourceStatus;
}
