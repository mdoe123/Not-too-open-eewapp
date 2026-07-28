// 权限引导页 - 单行权限项组件
// 展示单个权限的图标、名称、用途说明与状态（已开启对勾 / 去开启按钮）
// 黑白简约风格，支持亮/暗模式，避免误触（按钮足够大，状态切换有视觉反馈）
//
// 状态：
// - granted: 显示绿色对勾 + "已开启"
// - not granted: 显示"去开启"按钮（带箭头图标）
// - loading: 按钮显示"请求中..."并禁用
// - background 信息项: 始终显示对勾（无操作）

import React from 'react';
import {StyleSheet, View, Text, Pressable, ActivityIndicator} from 'react-native';
import type {AppColors} from '../../theme/colors';
import type {PermissionItem, PermissionIconType} from './permissionItems';
import {
  LocationPermissionIcon,
  OverlayPermissionIcon,
  NotificationPermissionIcon,
  BatteryPermissionIcon,
  AutoStartPermissionIcon,
  BackgroundPermissionIcon,
  CheckCircleIcon,
  ArrowForwardIcon,
} from './OnboardingIcons';

/** PermissionRow 组件 Props */
export interface PermissionRowProps {
  /** 权限项定义 */
  item: PermissionItem;
  /** 是否已授予 */
  granted: boolean;
  /** 是否正在请求中 */
  loading: boolean;
  /** 点击"去开启"回调 */
  onRequest: () => void;
  /** 配色方案 */
  colors: AppColors;
}

/** 根据图标类型渲染对应 SVG 图标 */
function renderIcon(type: PermissionIconType, color: string): React.ReactNode {
  const size = 24;
  switch (type) {
    case 'location':
      return <LocationPermissionIcon size={size} color={color} />;
    case 'overlay':
      return <OverlayPermissionIcon size={size} color={color} />;
    case 'notification':
      return <NotificationPermissionIcon size={size} color={color} />;
    case 'battery':
      return <BatteryPermissionIcon size={size} color={color} />;
    case 'autostart':
      return <AutoStartPermissionIcon size={size} color={color} />;
    case 'background':
      return <BackgroundPermissionIcon size={size} color={color} />;
    default:
      return null;
  }
}

/**
 * 单行权限项组件
 *
 * 布局：[图标] [名称(带必填星号) + 说明] [状态/按钮]
 */
export default function PermissionRow({
  item,
  granted,
  loading,
  onRequest,
  colors,
}: PermissionRowProps) {
  // 已开启时使用主题语义色 success（亮色深绿，暗色浅绿）
  const grantedColor = colors.success;
  const iconColor = colors.text;

  return (
    <View
      style={[styles.container, {borderBottomColor: colors.border}]}
      accessibilityRole="summary">
      {/* 左侧图标 */}
      <View style={styles.iconWrap}>{renderIcon(item.icon, iconColor)}</View>

      {/* 中部：名称 + 说明 */}
      <View style={styles.textWrap}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, {color: colors.text}]} numberOfLines={1}>
            {item.title}
          </Text>
          {item.required && (
            <Text style={[styles.requiredMark, {color: colors.critical}]}>*</Text>
          )}
        </View>
        <Text
          style={[styles.description, {color: colors.textSecondary}]}
          numberOfLines={2}>
          {item.description}
        </Text>
      </View>

      {/* 右侧：状态标签 */}
      <View style={styles.statusWrap}>
        {granted ? (
          // 已开启：对勾 + 文字
          <View style={[styles.grantedTag, {borderColor: grantedColor}]}>
            <CheckCircleIcon size={16} color={grantedColor} />
            <Text style={[styles.grantedText, {color: grantedColor}]}>已开启</Text>
          </View>
        ) : loading ? (
          // 请求中：加载指示器
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
          </View>
        ) : (
          // 未开启：去开启按钮（信息项 background 不会进入此分支，因为 check 恒返回 true）
          <Pressable
            style={({pressed}) => [
              styles.actionBtn,
              {borderColor: colors.text},
              pressed && styles.actionBtnPressed,
            ]}
            onPress={onRequest}
            hitSlop={{top: 8, bottom: 8, left: 4, right: 4}}
            accessibilityLabel={`开启${item.title}`}
            accessibilityRole="button">
            <Text style={[styles.actionBtnText, {color: colors.text}]}>去开启</Text>
            <ArrowForwardIcon size={14} color={colors.text} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 64,
  },
  iconWrap: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
    marginRight: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  requiredMark: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 4,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
  statusWrap: {
    minWidth: 72,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  grantedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
  },
  grantedText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  loadingWrap: {
    width: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 4,
    minHeight: 36, // 避免误触，按钮足够大
  },
  actionBtnPressed: {
    opacity: 0.5,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    marginRight: 4,
  },
});
