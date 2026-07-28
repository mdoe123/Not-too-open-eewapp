// 远程日志 WebSocket 客户端
//
// 实现 LogSink 接口，通过 WebSocket 将日志发送到调试服务器（scripts/log-server.js）。
// 断线自动重连（指数退避，上限 30s）。
//
// 用法：
//   import {connectRemoteLogSink, disconnectRemoteLogSink} from '../utils/remoteLogSink';
//   connectRemoteLogSink('ws://192.168.1.100:8089');  // 连接并注册为全局 sink
//   disconnectRemoteLogSink();                         // 断开并取消注册

import {LogSink, LogModule, setLogSink} from './logger';

/** 初始重连延迟（毫秒） */
const INITIAL_RECONNECT_DELAY_MS = 1000;

/** 最大重连延迟（毫秒） */
const MAX_RECONNECT_DELAY_MS = 30000;

/** 重连退避倍数 */
const RECONNECT_BACKOFF_MULTIPLIER = 2;

/** 连接状态回调类型 */
export type RemoteLogStatus = 'disconnected' | 'connecting' | 'connected';

/** 状态变化监听器列表 */
const statusListeners = new Set<(status: RemoteLogStatus) => void>();

/** 当前状态 */
let currentStatus: RemoteLogStatus = 'disconnected';

/** WebSocket 实例 */
let ws: WebSocket | null = null;

/** 目标服务器 URL */
let targetUrl: string = '';

/** 是否为主动关闭 */
let isManualClose = false;

/** 重连定时器 */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前重连延迟 */
let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

/**
 * 远程日志 sink 实现
 *
 * 将日志通过 WebSocket 发送到调试服务器。
 * 消息格式：JSON.stringify({ time, module, message, data })
 */
const remoteSink: LogSink = {
  send(module: LogModule, message: string, data?: unknown): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      const payload = JSON.stringify({
        time: new Date().toISOString().slice(11, 23),
        module,
        message,
        data,
      });
      ws.send(payload);
    } catch {
      // 发送失败忽略，不影响主流程
    }
  },
};

/**
 * 更新连接状态并通知监听器
 */
function setStatus(status: RemoteLogStatus): void {
  currentStatus = status;
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch {
      // 监听器异常忽略
    }
  }
}

/**
 * 创建 WebSocket 连接
 */
function openWebSocket(): void {
  ws = new WebSocket(targetUrl);

  ws.onopen = () => {
    reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    setStatus('connected');
  };

  ws.onclose = () => {
    ws = null;
    if (isManualClose) {
      setStatus('disconnected');
    } else {
      setStatus('connecting');
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    // onerror 后通常紧跟 onclose，此处不额外处理
  };
}

/**
 * 调度指数退避重连
 */
function scheduleReconnect(): void {
  if (isManualClose) return;
  if (reconnectTimer) return;

  const delay = reconnectDelay;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(
      reconnectDelay * RECONNECT_BACKOFF_MULTIPLIER,
      MAX_RECONNECT_DELAY_MS,
    );
    openWebSocket();
  }, delay);
}

/**
 * 连接远程日志服务器
 *
 * 连接成功后自动注册为全局 LogSink，所有 log() 调用将转发到服务器。
 * 已连接时调用会先断开旧连接再重连。
 *
 * @param url 服务器 WebSocket 地址，如 'ws://192.168.1.100:8089'
 */
export function connectRemoteLogSink(url: string): void {
  // 先断开旧连接
  disconnectRemoteLogSink();

  targetUrl = url;
  isManualClose = false;
  reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  setStatus('connecting');

  // 注册为全局 sink
  setLogSink(remoteSink);

  openWebSocket();
}

/**
 * 断开远程日志服务器
 *
 * 取消全局 sink 注册，关闭 WebSocket，停止重连。
 */
export function disconnectRemoteLogSink(): void {
  isManualClose = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    try {
      ws.close();
    } catch {
      // 关闭异常忽略
    }
    ws = null;
  }

  setLogSink(null);
  setStatus('disconnected');
}

/**
 * 获取当前连接状态
 */
export function getRemoteLogSinkStatus(): RemoteLogStatus {
  return currentStatus;
}

/**
 * 监听连接状态变化
 *
 * @param listener 状态变化回调
 * @returns 取消监听函数
 */
export function onRemoteLogStatusChange(
  listener: (status: RemoteLogStatus) => void,
): () => void {
  statusListeners.add(listener);
  // 立即通知一次当前状态
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}
