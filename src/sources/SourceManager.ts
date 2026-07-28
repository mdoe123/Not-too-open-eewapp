// 数据源管理器：负责多源注册、主备切换与心跳探活
//
// 故障切换策略：
// 1. 启动时按 priority 升序选择第一个 enabled 的源作为主源，其余作为备用队列
// 2. 主源连接出错或断开时累计 failureCount
// 3. 心跳检查失败时累计 failureCount
// 4. 当 failureCount 达到 heartbeatFailureThreshold 且备用队列非空时，
//    切换到下一个备用源；否则继续重试当前源
// 5. 心跳成功时重置 failureCount
// 6. 切换期间通过 isSwitching 串行化，避免并发竞态导致多源同时激活
import {SourceAdapter, EewEventCallback, StatusCallback} from './SourceAdapter';
import {SourceConfig, AppConfig} from '../types';
import {log} from '../utils/logger';

export class SourceManager {
  /** 已注册的数据源适配器，按 SourceType 索引 */
  private adapters = new Map<string, SourceAdapter>();
  /** 当前激活的主源 */
  private activeSource?: SourceAdapter;
  /** 备用源队列（按优先级排序） */
  private backupQueue: SourceAdapter[] = [];
  /** 已失败的源列表（用于备用源耗尽后重新探测，P1-2 修复） */
  private failedSources: SourceAdapter[] = [];
  /** 当前主源连续失败次数 */
  private failureCount = 0;
  /** 心跳检查计数（用于触发已失败源的退避重试） */
  private heartbeatTickCount = 0;
  /** 切换阈值（来自 AppConfig.heartbeatFailureThreshold，下限 1） */
  private readonly threshold: number;
  /** 事件回调（透传给 adapter） */
  private onEvent: EewEventCallback;
  /** 状态回调（上报给上层） */
  private onStatus: StatusCallback;
  /** 是否正在切换中（防止并发切换竞态） */
  private isSwitching = false;
  /** 管理器是否已停止（停止后忽略所有操作） */
  private isStopped = false;
  /** 已失败源重试间隔（每 N 次心跳检查尝试一次重新激活） */
  private static readonly FAILED_RETRY_INTERVAL = 10;

  constructor(config: AppConfig, onEvent: EewEventCallback, onStatus: StatusCallback) {
    // 下限校验：threshold >= 1，避免 0 导致首次失败即切换（过于激进）
    this.threshold = Math.max(1, config.heartbeatFailureThreshold);
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    // TODO: 在 Task 3 中实例化各 SourceAdapter 并按 priority 排序
  }

  /**
   * 注册 adapter（供 Task 3 调用）
   * 同一 type 重复注册会覆盖
   */
  registerAdapter(config: SourceConfig, adapter: SourceAdapter): void {
    this.adapters.set(config.type, adapter);
  }

  /**
   * 启动：按优先级选择第一个 enabled 的源作为主源
   * @param sources 数据源配置列表
   */
  async start(sources: SourceConfig[]): Promise<void> {
    if (this.isStopped) return;

    const enabled = sources
      .filter(s => s.enabled)
      .sort((a, b) => a.priority - b.priority);

    if (enabled.length === 0) {
      log('MGR', 'start 无可用数据源');
      this.onStatus('error', '无可用数据源');
      return;
    }

    this.backupQueue = enabled
      .slice(1)
      .map(s => this.adapters.get(s.type))
      .filter((a): a is SourceAdapter => Boolean(a));

    // 主源存在性校验（替代原来的非空断言 !）
    const primary = this.adapters.get(enabled[0].type);
    if (!primary) {
      log('MGR', `start 主源 adapter 未注册: ${enabled[0].type}`);
      this.onStatus('error', `主源 adapter 未注册: ${enabled[0].type}`);
      return;
    }

    log('MGR', `start`, {
      primary: enabled[0].type,
      backupCount: this.backupQueue.length,
      enabledCount: enabled.length,
    });
    await this.activate(primary);
  }

  /**
   * 激活指定 adapter 作为主源
   * - 重置失败计数
   * - 通过 adapter.connect 注册事件/状态回调
   * - connect 失败时通过 try-catch 捕获，上报 error 并触发下一轮切换
   * - 状态变为 error/disconnected 时触发 handleFailure
   */
  private async activate(adapter: SourceAdapter): Promise<void> {
    if (this.isStopped) return;

    // 切换前先断开旧源，避免多源同时推送事件
    if (this.activeSource && this.activeSource !== adapter) {
      try {
        await this.activeSource.disconnect();
      } catch (e) {
        // 旧源断开失败不影响新源激活
      }
    }

    this.activeSource = adapter;
    this.failureCount = 0;
    this.isSwitching = true;
    log('MGR', `activate ${adapter.sourceType}`);

    try {
      await adapter.connect(this.onEvent, (status, msg) => {
        this.onStatus(status, msg);
        // 切换期间忽略旧源的延迟回调，避免竞态
        if (this.isSwitching) return;
        if (status === 'error' || status === 'disconnected') {
          this.handleFailure();
        }
      });
    } catch (e) {
      // connect 抛出异常：上报并触发切换
      const errMsg = e instanceof Error ? e.message : String(e);
      log('MGR', `activate 连接失败 ${adapter.sourceType} - ${errMsg}`);
      this.onStatus('error', `数据源连接失败: ${adapter.sourceType} - ${errMsg}`);
      this.isSwitching = false;
      this.handleFailure();
      return;
    }

    this.isSwitching = false;
  }

  /**
   * 心跳失败处理：累计到达阈值后切换备用源
   * 若已无备用源，则将当前失败源加入 failedSources 等待退避重试
   * 切换期间忽略调用，避免并发竞态
   */
  handleFailure(): void {
    if (this.isStopped || this.isSwitching) return;

    this.failureCount++;
    const sourceType = this.activeSource?.sourceType ?? 'unknown';
    log('MGR', `handleFailure ${sourceType} ${this.failureCount}/${this.threshold}`);
    if (this.failureCount >= this.threshold) {
      // 将当前失败源加入 failedSources（用于后续退避重试）
      if (this.activeSource && !this.failedSources.includes(this.activeSource)) {
        this.failedSources.push(this.activeSource);
      }

      if (this.backupQueue.length > 0) {
        const next = this.backupQueue.shift()!;
        log('MGR', `切换到备用源 ${next.sourceType}`);
        this.onStatus('connecting', `切换到备用源: ${next.sourceType}`);
        // activate 是 async，这里不 await 以避免阻塞回调链
        // activate 内部已通过 isSwitching 防止重入
        void this.activate(next).catch(e => {
          const errMsg = e instanceof Error ? e.message : String(e);
          this.onStatus('error', `切换备用源失败: ${next.sourceType} - ${errMsg}`);
        });
      } else {
        // 备用源耗尽：上报无源可用，failedSources 中的源会在 checkHeartbeat 中定期重试
        log('MGR', '所有数据源均不可用，等待退避重试');
        this.onStatus('error', '所有数据源均不可用，等待退避重试');
      }
    }
  }

  /**
   * 定时心跳检查（由后台服务调用）
   * 心跳成功时重置失败计数；失败时计入并可能触发切换
   * 每 FAILED_RETRY_INTERVAL 次心跳，若 failedSources 非空，尝试重新激活最早失败的源
   */
  checkHeartbeat(): void {
    if (this.isStopped) return;
    if (this.isSwitching) return;

    this.heartbeatTickCount++;

    // 退避重试：每 N 次心跳检查，尝试重新激活已失败源
    if (
      this.heartbeatTickCount % SourceManager.FAILED_RETRY_INTERVAL === 0 &&
      this.failedSources.length > 0
    ) {
      const retrySource = this.failedSources.shift()!;
      log('MGR', `退避重试 ${retrySource.sourceType}`);
      this.onStatus('connecting', `退避重试数据源: ${retrySource.sourceType}`);
      void this.activate(retrySource).catch(() => {
        // 重试失败，重新加入 failedSources 等待下次重试
        this.failedSources.push(retrySource);
      });
      return;
    }

    if (!this.activeSource) return;

    if (!this.activeSource.heartbeat()) {
      log('MGR', `心跳失败 ${this.activeSource.sourceType}`);
      this.handleFailure();
    } else {
      this.failureCount = 0;
    }
  }

  /** 停止管理器，断开当前主源并清理所有引用 */
  async stop(): Promise<void> {
    log('MGR', `stop ${this.activeSource?.sourceType ?? 'none'}`);
    this.isStopped = true;
    if (this.activeSource) {
      try {
        await this.activeSource.disconnect();
      } catch (e) {
        // 停止时忽略断开异常
      }
    }
    this.activeSource = undefined;
    this.backupQueue = [];
    this.failedSources = [];
    this.adapters.clear();
    this.failureCount = 0;
    this.heartbeatTickCount = 0;
    this.isSwitching = false;
  }
}
