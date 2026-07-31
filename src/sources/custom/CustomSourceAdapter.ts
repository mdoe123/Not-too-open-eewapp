// 自定义数据源适配器（JS 层，前台使用）
//
// 实现 SourceAdapter 接口，支持用户自定义的地震数据 API：
// - protocol='ws'：WebSocket 实时推送（参考 BaseWolfxWsAdapter 的指数退避重连）
// - protocol='http'：HTTP GET 定时轮询（参考 BaseWolfxGetAdapter）
//
// 解析机制：
// - 用 jsonPathExtract 按 config.fieldMapping 提取字段，构造 EewEvent
// - 不做 adapter 级去重（用户 API 数据格式未知，去重交给上层 useEewStream 跨源去重）
//
// 鉴权：
// - HTTP：添加 Authorization: Bearer <authToken> 请求头
// - WebSocket：URL 追加 ?token=<authToken> 查询参数
//
// 合规设计：App 仅按用户配置的路径/表达式提取 JSON 字段，不执行用户代码，不内置转发逻辑。
// 锁屏可用性：前台使用本 JS 适配器；锁屏时由原生层 CustomSourceManager 接管（不依赖 JS）。

import {EewEvent, SourceStatus, SourceType} from '../../types';
import {SourceConfig} from '../../types';
import {SourceAdapter, EewEventCallback, StatusCallback} from '../SourceAdapter';
import {extractString, extractNumber, extractBoolean, extractArray} from './jsonPathExtract';
import {log} from '../../utils/logger';

/** 默认 HTTP 轮询间隔（毫秒） */
const DEFAULT_POLL_INTERVAL_MS = 2000;

/** WS 指数退避：初始重连延迟（毫秒） */
const INITIAL_RECONNECT_DELAY_MS = 1000;

/** WS 指数退避：最大重连延迟（毫秒） */
const MAX_RECONNECT_DELAY_MS = 30000;

/** WS 指数退避：倍数 */
const RECONNECT_BACKOFF_MULTIPLIER = 2;

/** HTTP 心跳超时倍数：上次成功响应超过 pollInterval * 该倍数即视为不健康 */
const HEARTBEAT_TIMEOUT_MULTIPLIER = 3;

/** HTTP 心跳超时下限（毫秒） */
const HEARTBEAT_TIMEOUT_MIN_MS = 10000;

/** WS 心跳包默认关键词（用户未配置 heartbeatKeyword 时使用） */
const DEFAULT_WS_HEARTBEAT_KEYWORD = 'heartbeat';

/** WS 心跳超时：首次未观察到间隔时的默认超时（毫秒） */
const WS_HEARTBEAT_DEFAULT_TIMEOUT_MS = 60_000;

/** WS 心跳超时：基于观察到的间隔计算时的下限（毫秒） */
const WS_HEARTBEAT_TIMEOUT_MIN_MS = 30_000;

/** WS 心跳超时：基于观察到的间隔计算时的上限（毫秒） */
const WS_HEARTBEAT_TIMEOUT_MAX_MS = 300_000;

/** WS 心跳超时：观察到的间隔的倍数（超时 = max(min, interval × multiplier)） */
const WS_HEARTBEAT_TIMEOUT_MULTIPLIER = 2;

/**
 * 自定义数据源适配器
 *
 * 同时支持 WebSocket 和 HTTP GET 轮询，根据 config.protocol 选择。
 * 用户在 CustomSourceEditor 中配置 URL、字段映射、鉴权 token。
 */
export class CustomSourceAdapter implements SourceAdapter {
  readonly sourceType: string = 'customSource';

  private status: SourceStatus = 'disconnected';
  private onEvent?: EewEventCallback;
  private onStatus?: StatusCallback;

  // WS 相关
  private ws: WebSocket | null = null;
  private isManualClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

  // WS 心跳检测相关
  /** 心跳包关键词（空字符串表示禁用心跳检测） */
  private readonly heartbeatKeyword: string;
  /** 上次收到心跳的时间戳（Unix 毫秒） */
  private lastHeartbeatAt = 0;
  /** 上次观察到的心跳间隔（毫秒，收到 ≥2 次心跳后填充） */
  private lastHeartbeatIntervalMs = 0;
  /** 心跳超时检测定时器 */
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  /** 心跳检测代际（每次 stop 递增，回调校验防止残余定时器误触发） */
  private heartbeatGeneration = 0;

  // HTTP 相关
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSuccessAt = 0;

  /** 数据源配置 */
  private readonly config: SourceConfig;
  /** 轮询间隔（毫秒，仅 HTTP 使用） */
  private readonly pollIntervalMs: number;
  /** HTTP 心跳超时阈值（毫秒） */
  private readonly heartbeatTimeoutMs: number;
  /**
   * 事件 id 前缀（用于区分多个自定义源，避免同 host 不同源的事件 ID 冲突）
   *
   * 组成：customSource-{host}-{priority}
   * - host：endpoint 主机名
   * - priority：源优先级（用户配置中每个源应唯一）
   *
   * 仅用 host 会导致同 host 不同源（如同一服务器不同路径的测试源与真实源）
   * 事件 ID 前缀相同，触发 mergeEvent 的"同 ID 保留震级高的"逻辑，互相覆盖。
   */
  private readonly idPrefix: string;

  constructor(config: SourceConfig) {
    this.config = config;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.heartbeatTimeoutMs = Math.max(
      this.pollIntervalMs * HEARTBEAT_TIMEOUT_MULTIPLIER,
      HEARTBEAT_TIMEOUT_MIN_MS,
    );
    this.idPrefix = `customSource-${extractHost(config.endpoint ?? '')}-${config.priority}`;
    // 心跳关键词：用户未配置（undefined）使用默认 'heartbeat'；显式配置空字符串禁用检测
    this.heartbeatKeyword = config.heartbeatKeyword ?? DEFAULT_WS_HEARTBEAT_KEYWORD;
  }

  /**
   * 建立连接
   *
   * 根据 config.protocol 选择 WebSocket 或 HTTP 轮询模式。
   */
  async connect(
    onEvent: EewEventCallback,
    onStatus: StatusCallback,
  ): Promise<void> {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.isManualClose = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    this.setStatus('connecting');

    if (this.config.protocol === 'ws') {
      log('CUSTOM', `connect WS ${this.config.name}`, {url: this.config.endpoint});
      this.openWebSocket();
    } else if (this.config.protocol === 'http') {
      log('CUSTOM', `connect HTTP ${this.config.name}`, {
        url: this.config.endpoint,
        intervalMs: this.pollIntervalMs,
      });
      await this.startHttpPolling();
    } else {
      this.setStatus('error', `未知协议: ${this.config.protocol ?? 'undefined'}`);
    }
  }

  /** 主动断开连接，释放 WS / 定时器资源 */
  async disconnect(): Promise<void> {
    this.isManualClose = true;
    log('CUSTOM', `disconnect ${this.config.name}`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // 忽略关闭异常
      }
      this.ws = null;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.lastSuccessAt = 0;
    this.lastHeartbeatAt = 0;
    this.lastHeartbeatIntervalMs = 0;
    this.setStatus('disconnected');
  }

  /**
   * 解析原始数据为统一 EewEvent 列表（公开方法，便于单元测试）
   *
   * 行为：
   * - 若 fieldMapping.listPath 配置：先提取数组，再对每个元素应用字段映射，返回多事件
   * - 若 listPath 未配置：对根对象提取单事件，返回单元素数组或空数组
   *
   * 必填字段缺失的元素会被跳过（不返回）。
   */
  parse(raw: unknown): EewEvent[] | null {
    return this.buildEvents(raw);
  }

  /**
   * 心跳检测
   *
   * - WS：检查 readyState === OPEN
   * - HTTP：检查定时器存活且上次成功响应未超时
   */
  heartbeat(): boolean {
    if (this.config.protocol === 'ws') {
      return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
    if (this.config.protocol === 'http') {
      if (this.timer === null || this.status !== 'connected') return false;
      if (this.lastSuccessAt === 0) return true;
      return Date.now() - this.lastSuccessAt < this.heartbeatTimeoutMs;
    }
    return false;
  }

  /** 获取当前连接状态 */
  getStatus(): SourceStatus {
    return this.status;
  }

  // ======================== WS 模式 ========================

  /**
   * 创建 WebSocket 连接并注册事件回调
   *
   * 鉴权：
   * 1. URL 追加 ?token=<authToken>（如有）
   * 2. onOpen 时 ws.send(wsAuthMessage)（如有），用于订阅/鉴权场景
   *
   * 心跳检测：
   * - onMessage 检测包含 heartbeatKeyword 的文本视为心跳，不传给解析器
   * - 启动心跳超时定时器，超时主动关闭 WS 并重连
   */
  private openWebSocket(): void {
    const url = this.buildWsUrl();
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.setStatus('connected');
      log('CUSTOM', `${this.config.name} WS 已连接`);

      // onOpen 后发送鉴权/订阅消息（如配置）
      const authMsg = this.config.wsAuthMessage;
      if (authMsg) {
        try {
          this.ws?.send(authMsg);
          log('CUSTOM', `${this.config.name} WS 已发送鉴权消息 (${authMsg.length} 字符)`);
        } catch (e) {
          log('CUSTOM', `${this.config.name} WS 发送鉴权消息失败 ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // 启动心跳超时检测（关键词非空时）
      this.startHeartbeatWatchdog();
    };

    this.ws.onmessage = (ev: WebSocketMessageEvent) => {
      if (!this.ws) return;
      const data =
        typeof ev.data === 'string' ? ev.data : String(ev.data);

      // 心跳包检测：包含关键词视为心跳，不传给解析器
      if (this.heartbeatKeyword && data.includes(this.heartbeatKeyword)) {
        this.onHeartbeatReceived();
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const events = this.buildEvents(parsed);
        if (events.length > 0) {
          for (const event of events) {
            this.onEvent?.(event);
          }
        } else {
          log('CUSTOM', `${this.config.name} 解析为空，跳过`);
        }
      } catch (e) {
        log('CUSTOM', `${this.config.name} 消息解析异常 ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    this.ws.onerror = () => {
      log('CUSTOM', `${this.config.name} WS 错误`);
      this.setStatus('error', 'WebSocket 错误');
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.stopHeartbeatWatchdog();
      // 重置心跳状态，避免重连后沿用旧连接的间隔值
      this.lastHeartbeatAt = 0;
      this.lastHeartbeatIntervalMs = 0;
      if (this.isManualClose) {
        log('CUSTOM', `${this.config.name} WS 已断开（主动）`);
        this.setStatus('disconnected');
      } else {
        log('CUSTOM', `${this.config.name} WS 意外断开，准备重连`);
        this.setStatus('disconnected', 'WebSocket 意外断开，准备重连');
        this.scheduleReconnect();
      }
    };
  }

  /**
   * 启动心跳超时检测定时器
   *
   * 超时阈值计算：
   * - 首次（lastHeartbeatIntervalMs === 0）：使用默认 60 秒
   * - 已观察到间隔：max(30s, interval × 2)，上限 300 秒
   *
   * 超时后主动关闭 WS（触发 onclose → scheduleReconnect）
   */
  private startHeartbeatWatchdog(): void {
    if (!this.heartbeatKeyword) return;
    this.stopHeartbeatWatchdog();

    const timeoutMs = this.computeHeartbeatTimeoutMs();
    // 不在此处设置 lastHeartbeatAt：避免首拍 interval 被误算为"启动到首拍"的时间。
    // lastHeartbeatAt 仅在 onHeartbeatReceived 中更新，保证 interval 是真实心跳间隔。
    // 若 lastHeartbeatAt 仍为 0（从未收到心跳），超时回调直接关闭重连。
    const gen = this.heartbeatGeneration;
    log('CUSTOM', `${this.config.name} 心跳检测启动，超时 ${timeoutMs}ms`);

    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      // 代际校验：若期间已被 stop/重启，跳过本次回调
      if (gen !== this.heartbeatGeneration) return;
      if (!this.ws || this.isManualClose) return;
      const elapsed = this.lastHeartbeatAt > 0 ? Date.now() - this.lastHeartbeatAt : timeoutMs;
      log('CUSTOM', `${this.config.name} 心跳超时 ${elapsed}ms（阈值 ${timeoutMs}ms），主动关闭重连`);
      try {
        this.ws.close();
      } catch {
        // 忽略关闭异常
      }
      // onclose 会接管：清理 + scheduleReconnect
    }, timeoutMs);
  }

  /** 计算当前心跳超时阈值（毫秒） */
  private computeHeartbeatTimeoutMs(): number {
    if (this.lastHeartbeatIntervalMs === 0) {
      return WS_HEARTBEAT_DEFAULT_TIMEOUT_MS;
    }
    const computed = this.lastHeartbeatIntervalMs * WS_HEARTBEAT_TIMEOUT_MULTIPLIER;
    return Math.min(
      Math.max(computed, WS_HEARTBEAT_TIMEOUT_MIN_MS),
      WS_HEARTBEAT_TIMEOUT_MAX_MS,
    );
  }

  /**
   * 收到心跳时调用：更新时间戳、计算间隔、重启定时器
   */
  private onHeartbeatReceived(): void {
    const now = Date.now();
    if (this.lastHeartbeatAt > 0) {
      const interval = now - this.lastHeartbeatAt;
      // 仅在合理范围内更新（避免异常值污染，如 >10 分钟的间隔通常是重连后第一拍）
      if (interval > 1000 && interval < 600_000) {
        this.lastHeartbeatIntervalMs = interval;
        log('CUSTOM', `${this.config.name} 心跳间隔 ${interval}ms`);
      }
    }
    this.lastHeartbeatAt = now;
    // 每次收到心跳都重启定时器（按最新阈值）
    this.startHeartbeatWatchdog();
  }

  /** 停止心跳超时检测定时器 */
  private stopHeartbeatWatchdog(): void {
    // 递增代际，使任何已派发但未执行的回调失效
    this.heartbeatGeneration++;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 构建 WS URL（追加 token 查询参数）
   */
  private buildWsUrl(): string {
    const base = this.config.endpoint ?? '';
    if (!this.config.authToken) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}token=${encodeURIComponent(this.config.authToken)}`;
  }

  /**
   * 调度指数退避重连
   */
  private scheduleReconnect(): void {
    if (this.isManualClose) return;
    if (this.reconnectTimer) return;

    const delay = this.reconnectDelay;
    log('CUSTOM', `${this.config.name} ${delay}ms 后重连`);
    this.setStatus('connecting', `${delay}ms 后重连...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(
        this.reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
        MAX_RECONNECT_DELAY_MS,
      );
      this.openWebSocket();
    }, delay);
  }

  // ======================== HTTP 模式 ========================

  /**
   * 启动 HTTP 轮询
   *
   * - 立即拉取一次，随后按 pollIntervalMs 定时轮询
   * - 首次拉取成功后上报 connected
   */
  private async startHttpPolling(): Promise<void> {
    await this.poll();
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
    this.setStatus('connected');
    log('CUSTOM', `${this.config.name} HTTP 已连接`);
  }

  /**
   * 拉取一次数据
   */
  private async poll(): Promise<void> {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (this.config.authToken) {
        headers.Authorization = `Bearer ${this.config.authToken}`;
      }

      const resp = await fetch(this.config.endpoint ?? '', {headers});
      if (!resp.ok) {
        log('CUSTOM', `${this.config.name} HTTP错误 ${resp.status}`);
        this.setStatus('error', `HTTP ${resp.status}`);
        return;
      }
      const json = await resp.json();
      this.lastSuccessAt = Date.now();

      const events = this.buildEvents(json);
      if (events.length > 0) {
        for (const event of events) {
          this.onEvent?.(event);
        }
      } else {
        log('CUSTOM', `${this.config.name} 无有效事件`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log('CUSTOM', `${this.config.name} 拉取异常 ${msg}`);
      this.setStatus('error', `拉取失败: ${msg}`);
    }
  }

  // ======================== 事件构造 ========================

  /**
   * 构造事件列表（支持列表 API 和单事件 API）
   *
   * 行为：
   * - 若 fieldMapping.listPath 配置：先用 listPath 提取数组，
   *   再对每个数组元素调用 buildSingleEvent（字段映射相对于元素），返回所有有效事件
   * - 若 listPath 未配置：对根对象调用 buildSingleEvent，返回单元素数组或空数组
   *
   * @returns EewEvent 数组（可能为空），不会返回 null
   */
  private buildEvents(raw: unknown): EewEvent[] {
    const mapping = this.config.fieldMapping;
    if (!mapping) {
      log('CUSTOM', `${this.config.name} 无 fieldMapping 配置`);
      return [];
    }

    if (mapping.listPath) {
      const arr = extractArray(raw, mapping.listPath);
      if (arr === null) {
        log('CUSTOM', `${this.config.name} listPath ${mapping.listPath} 提取为空`);
        return [];
      }
      const events: EewEvent[] = [];
      for (const item of arr) {
        const event = this.buildSingleEvent(item);
        if (event) {
          events.push(event);
        }
      }
      if (events.length === 0) {
        log('CUSTOM', `${this.config.name} 列表解析后无有效事件`);
      }
      return events;
    }

    // 无 listPath：单事件解析
    const single = this.buildSingleEvent(raw);
    return single ? [single] : [];
  }

  /**
   * 按 fieldMapping 从单个数据对象提取字段，构造 EewEvent
   *
   * 必填字段（eventId/originTime/magnitude/depth/lat/lng/location）缺失时返回 null。
   * 可选字段（intensity/isFinal/isCancel）缺失时使用默认值。
   *
   * 注意：raw 是单个事件对象（而非整个 API 响应）。
   * 列表 API 场景下，由 buildEvents 先用 listPath 提取数组元素后传入。
   */
  private buildSingleEvent(raw: unknown): EewEvent | null {
    const mapping = this.config.fieldMapping;
    if (!mapping) {
      log('CUSTOM', `${this.config.name} 无 fieldMapping 配置`);
      return null;
    }

    const id = extractString(raw, mapping.eventId);
    const originTime = extractNumber(raw, mapping.originTime);
    const magnitude = extractNumber(raw, mapping.magnitude);
    const depth = extractNumber(raw, mapping.depth);
    const lat = extractNumber(raw, mapping.lat);
    const lng = extractNumber(raw, mapping.lng);
    const location = extractString(raw, mapping.location);

    // 必填字段校验
    if (id === null || originTime === null || magnitude === null ||
        depth === null || lat === null || lng === null || location === null) {
      log('CUSTOM', `${this.config.name} 必填字段缺失`, {
        id: id === null, originTime: originTime === null,
        magnitude: magnitude === null, depth: depth === null,
        lat: lat === null, lng: lng === null, location: location === null,
      });
      return null;
    }

    // 可选字段（extractNumber 缺失返回 null，最终 ?? undefined 转 EewEvent 的可选语义）
    const intensity = mapping.intensity
      ? extractNumber(raw, mapping.intensity)
      : null;
    const isFinal = mapping.isFinal ? extractBoolean(raw, mapping.isFinal) : false;
    const isCancel = mapping.isCancel ? extractBoolean(raw, mapping.isCancel) : false;
    const reportNum = mapping.reportNum ? extractNumber(raw, mapping.reportNum) : null;
    const reportType = mapping.reportType ? extractString(raw, mapping.reportType) : null;

    return {
      id: `${this.idPrefix}-${id}`,
      source: 'customSource' as SourceType,
      originTime,
      magnitude,
      depth,
      lat,
      lng,
      location,
      intensity: intensity ?? undefined,
      isFinal: isFinal || isCancel,
      isCancel,
      receivedAt: Date.now(),
      reportNum: reportNum ?? undefined,
      reportType: reportType ?? undefined,
      sourceName: this.config.name,
    };
  }

  /** 统一设置状态并上报 */
  private setStatus(status: SourceStatus, message?: string): void {
    this.status = status;
    this.onStatus?.(status, message);
  }
}

/**
 * 从 URL 中提取主机名，用于事件 id 前缀（区分多个自定义源）
 *
 * 例如：wss://api.example.com/path → api.example.com
 *      https://example.com:8080/api → example.com
 *      invalid-url → invalid-url
 */
function extractHost(url: string): string {
  try {
    // 简单提取：去掉协议前缀，取第一个 / 或 : 之前的部分
    const noProto = url.replace(/^[a-z]+:\/\//i, '');
    const host = noProto.split('/')[0].split(':')[0];
    return host || 'unknown';
  } catch {
    return 'unknown';
  }
}
