// 数据源状态栏组件
// 显示：当前主源名称、连接状态图标、备用源数量、切换提示
// 状态图标：connected(对勾) / connecting(旋转箭头) / disconnected(斜杠) / error(三角形感叹号)
// 半透明背景，叠加在地图上方

import React, {useEffect, useRef} from 'react';
import {StyleSheet, View, Text, Animated, Easing, Pressable} from 'react-native';
import {SourceStatus} from '../types';
import {ThemeColors} from '../theme/colors';
import {
  ConnectionIcon,
  ConnectingIcon,
  DisconnectedIcon,
  ErrorIcon,
} from './icons/Icons';

interface SourceStatusBarProps {
  /** 当前主源名称 */
  sourceName: string;
  /** 连接状态 */
  status: SourceStatus;
  /** 备用源数量 */
  backupCount: number;
  /** 切换提示（非 null 时显示横幅） */
  switchMessage: string | null;
  /** 当前配色 */
  colors: ThemeColors;
  /** 手动断开（测试用） */
  onDisconnect?: () => void;
  /** 手动重连（测试用） */
  onReconnect?: () => void;
  /** 切换到备用源（测试用） */
  onSwitchBackup?: () => void;
}

/** 状态对应的显示文本 */
function getStatusText(status: SourceStatus): string {
  switch (status) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中';
    case 'disconnected':
      return '已断开';
    case 'error':
      return '错误';
  }
}

/** 状态对应的状态色（使用主题语义色，避免硬编码） */
function getStatusColor(colors: ThemeColors, status: string): string {
  switch (status) {
    case 'connected':
      return colors.success;
    case 'connecting':
      return colors.yellow;
    case 'disconnected':
      return colors.silent;
    case 'error':
      return colors.error;
    default:
      return colors.silent;
  }
}

/** 根据状态渲染对应图标 */
function StatusIcon({
  status,
  size,
  colors,
}: {
  status: SourceStatus;
  size: number;
  colors: ThemeColors;
}) {
  const color = getStatusColor(colors, status);
  switch (status) {
    case 'connected':
      return <ConnectionIcon size={size} color={color} />;
    case 'connecting':
      return <RotatingIcon size={size} color={color} />;
    case 'disconnected':
      return <DisconnectedIcon size={size} color={color} />;
    case 'error':
      return <ErrorIcon size={size} color={color} />;
  }
}

/** 旋转动画包装器（连接中状态图标持续旋转） */
function RotatingIcon({size, color}: {size: number; color: string}) {
  const rotate = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [rotate]);

  return (
    <Animated.View
      style={{
        transform: [
          {
            rotate: rotate.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', '360deg'],
            }),
          },
        ],
      }}>
      <ConnectingIcon size={size} color={color} />
    </Animated.View>
  );
}

/**
 * 数据源状态栏
 * 半透明背景，叠加在地图上方
 */
export default function SourceStatusBar({
  sourceName,
  status,
  backupCount,
  switchMessage,
  colors,
  onDisconnect,
  onReconnect,
  onSwitchBackup,
}: SourceStatusBarProps) {
  const statusColor = getStatusColor(colors, status);

  return (
    <View style={styles.wrapper}>
      {/* 主状态行 */}
      <View
        style={[
          styles.container,
          {backgroundColor: colors.backgroundE6, borderColor: colors.border},
        ]}>
        {/* 状态图标 + 主源名称 */}
        <View style={styles.leftSection}>
          <StatusIcon status={status} size={16} colors={colors} />
          <Text style={[styles.sourceName, {color: colors.text}]} numberOfLines={2}>
            {sourceName}
          </Text>
          <Text style={[styles.statusText, {color: statusColor}]}>
            {getStatusText(status)}
          </Text>
        </View>

        {/* 分隔符 */}
        <View style={[styles.separator, {backgroundColor: colors.border}]} />

        {/* 备用源数量 */}
        <View style={styles.backupSection}>
          <Text style={[styles.backupLabel, {color: colors.textSecondary}]}>
            备用源
          </Text>
          <Text style={[styles.backupValue, {color: colors.text}]}>
            {backupCount}
          </Text>
        </View>

        {/* 分隔符 */}
        <View style={[styles.separator, {backgroundColor: colors.border}]} />

        {/* 测试按钮（断开/重连/切换） */}
        <View style={styles.testButtons}>
          {status === 'connected' ? (
            <Pressable
              style={({pressed}) => [
                styles.testBtn,
                pressed && styles.testBtnPressed,
              ]}
              onPress={onDisconnect}
              hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}>
              <Text style={[styles.testBtnText, {color: colors.textSecondary}]}>
                断开
              </Text>
            </Pressable>
          ) : (
            <Pressable
              style={({pressed}) => [
                styles.testBtn,
                pressed && styles.testBtnPressed,
              ]}
              onPress={onReconnect}
              hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}>
              <Text style={[styles.testBtnText, {color: colors.textSecondary}]}>
                重连
              </Text>
            </Pressable>
          )}
          <Pressable
            style={({pressed}) => [
              styles.testBtn,
              pressed && styles.testBtnPressed,
            ]}
            onPress={onSwitchBackup}
            disabled={backupCount === 0}
            hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}>
            <Text
              style={[
                styles.testBtnText,
                {
                  color: backupCount === 0 ? colors.border : colors.textSecondary,
                },
              ]}>
              切换
            </Text>
          </Pressable>
        </View>
      </View>

      {/* 切换提示横幅（自动消失） */}
      {switchMessage && (
        <View
          style={[
            styles.banner,
            {backgroundColor: colors.backgroundF0, borderColor: colors.border},
          ]}>
          <Text style={[styles.bannerText, {color: colors.text}]}>
            {switchMessage}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    zIndex: 10,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  sourceName: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  statusText: {
    fontSize: 12,
  },
  separator: {
    width: 1,
    height: 14,
  },
  backupSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  backupLabel: {
    fontSize: 12,
  },
  backupValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  testButtons: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 'auto',
  },
  testBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  testBtnPressed: {
    opacity: 0.6,
  },
  testBtnText: {
    fontSize: 12,
  },
  banner: {
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bannerText: {
    fontSize: 12,
  },
});
