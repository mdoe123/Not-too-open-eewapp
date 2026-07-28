// 调试设置分组
// 远程日志开关 + 服务器地址输入 + 连接状态指示
//
// 启用后通过 WebSocket 将 log() 日志发送到调试服务器（scripts/log-server.js），
// 替代 adb logcat，方便在手机端调试时实时查看日志。
import React, {useState, useEffect} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {DebugConfig} from '../../types';
import {AppColors} from '../../theme/colors';
import {ToggleRow} from './ToggleRow';
import {log} from '../../utils/logger';
import {
  connectRemoteLogSink,
  disconnectRemoteLogSink,
  onRemoteLogStatusChange,
  RemoteLogStatus,
} from '../../utils/remoteLogSink';

export interface DebugSectionProps {
  /** 当前调试配置 */
  debug: DebugConfig;
  /** 局部更新回调 */
  updateDebug: (partial: Partial<DebugConfig>) => void;
  /** 配色 */
  colors: AppColors;
}

/** 调试设置分组 */
export function DebugSection({debug, updateDebug, colors}: DebugSectionProps) {
  const [status, setStatus] = useState<RemoteLogStatus>('disconnected');

  // 监听远程日志连接状态
  useEffect(() => {
    const unsubscribe = onRemoteLogStatusChange(s => setStatus(s));
    return unsubscribe;
  }, []);

  // 挂载时若配置已启用且有 URL，自动连接（App 重启后恢复连接）
  useEffect(() => {
    if (debug.remoteLogEnabled && debug.remoteLogUrl) {
      connectRemoteLogSink(debug.remoteLogUrl);
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 启用/禁用远程日志
  const handleToggle = (enabled: boolean) => {
    updateDebug({remoteLogEnabled: enabled});
    if (enabled && debug.remoteLogUrl) {
      connectRemoteLogSink(debug.remoteLogUrl);
    } else if (!enabled) {
      disconnectRemoteLogSink();
    }
  };

  // URL 输入失焦时提交
  const [urlText, setUrlText] = useState(debug.remoteLogUrl);
  useEffect(() => {
    setUrlText(debug.remoteLogUrl);
  }, [debug.remoteLogUrl]);

  const handleUrlBlur = () => {
    const trimmed = urlText.trim();
    updateDebug({remoteLogUrl: trimmed});
    // 若已启用且 URL 变化，重连
    if (debug.remoteLogEnabled && trimmed) {
      connectRemoteLogSink(trimmed);
    }
  };

  // 手动测试连接按钮：立即用当前输入的 URL 触发连接
  const handleTestConnect = () => {
    const trimmed = urlText.trim();
    log('FLOAT', 'handleTestConnect', {url: trimmed, enabled: debug.remoteLogEnabled});
    // 保存 URL 到配置
    updateDebug({remoteLogUrl: trimmed, remoteLogEnabled: true});
    // 立即触发连接
    if (trimmed) {
      connectRemoteLogSink(trimmed);
    }
  };

  const statusText = {
    connected: '已连接',
    connecting: '连接中…',
    disconnected: '未连接',
  }[status];

  const statusColor = status === 'connected'
    ? colors.success
    : status === 'connecting'
    ? colors.warning
    : colors.textSecondary;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionHint, {color: colors.textSecondary}]}>
        通过 WebSocket 将日志发送到调试服务器，替代 adb logcat。先运行 yarn log-server 启动服务器
      </Text>
      <ToggleRow
        label="远程日志"
        description="启用后将日志发送到调试服务器"
        value={debug.remoteLogEnabled}
        onValueChange={handleToggle}
        colors={colors}
      />
      {debug.remoteLogEnabled ? (
        <View style={[styles.urlRow, {backgroundColor: colors.surface}]}>
          <Text style={[styles.urlLabel, {color: colors.textSecondary}]}>
            服务器
          </Text>
          <TextInput
            style={[
              styles.urlInput,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            value={urlText}
            placeholder="ws://127.0.0.1:8089"
            placeholderTextColor={colors.silent}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            onSubmitEditing={handleUrlBlur}
            onBlur={handleUrlBlur}
            onChangeText={setUrlText}
          />
        </View>
      ) : null}
      {debug.remoteLogEnabled ? (
        <View style={[styles.statusRow, {borderBottomColor: colors.border}]}>
          <Text style={[styles.statusLabel, {color: colors.textSecondary}]}>
            状态
          </Text>
          <Text style={[styles.statusValue, {color: statusColor}]}>
            {statusText}
          </Text>
        </View>
      ) : null}
      {debug.remoteLogEnabled ? (
        <Pressable
          style={({pressed}) => [
            styles.testBtn,
            {backgroundColor: colors.surface, borderColor: colors.border},
            pressed && styles.testBtnPressed,
          ]}
          onPress={handleTestConnect}
          accessibilityRole="button"
          accessibilityLabel="测试连接">
          <Text style={[styles.testBtnText, {color: colors.text}]}>
            测试连接
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  urlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  urlLabel: {
    fontSize: 15,
  },
  urlInput: {
    flex: 1,
    marginLeft: 12,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 13,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusLabel: {
    fontSize: 15,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  testBtn: {
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    alignItems: 'center',
  },
  testBtnPressed: {
    opacity: 0.6,
  },
  testBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
