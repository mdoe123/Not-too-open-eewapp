#!/usr/bin/env node
/**
 * WebSocket 远程日志服务器
 *
 * 用于接收手机端 App 通过 WebSocket 发送的调试日志，替代 adb logcat。
 *
 * 用法：
 *   yarn log-server                          # 监听 0.0.0.0:8089
 *   node scripts/log-server.js --port 9090   # 自定义端口
 *
 * 手机端在设置页「调试设置」中启用远程日志，填入本机局域网 IP + 端口，如：
 *   ws://192.168.1.100:8089
 *
 * 服务器收到日志后输出到控制台，格式与 logger.ts 一致：
 *   [HH:mm:ss.SSS] [EEW:模块] 消息 {JSON数据}
 */

const {WebSocketServer} = require('ws');

// 解析命令行参数
const args = process.argv.slice(2);
let port = 8089;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  }
}

const wss = new WebSocketServer({host: '0.0.0.0', port});

// 连接的客户端列表
const clients = new Set();

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  clients.add(ws);
  console.log(`[server] 客户端已连接: ${clientIp}（当前 ${clients.size} 个连接）`);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      // 消息格式: { time, module, message, data? }
      const time = msg.time || new Date().toISOString().slice(11, 23);
      const moduleStr = msg.module ? `[EEW:${msg.module}]` : '[EEW]';
      const dataStr = msg.data ? ' ' + (typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data)) : '';
      console.log(`${time} ${moduleStr} ${msg.message || ''}${dataStr}`);
    } catch {
      // 非 JSON 消息，直接输出原始文本
      console.log(raw.toString());
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[server] 客户端断开: ${clientIp}（当前 ${clients.size} 个连接）`);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
});

console.log(`[server] 日志服务器已启动，监听 0.0.0.0:${port}`);
console.log('[server] 手机端请在设置页填入: ws://<本机局域网IP>:${port}');
console.log('[server] 按 Ctrl+C 停止');
