// 通用设置行：左侧标签（含可选描述/图标）+ 右侧自定义内容 + 底部细分隔线
import React from 'react';
import {StyleSheet, Text, View, ViewStyle} from 'react-native';
import {AppColors} from '../../theme/colors';

export interface SettingRowProps {
  /** 主标签 */
  label: string;
  /** 辅助说明（可选，显示在标签下方） */
  description?: string;
  /** 左侧图标（可选） */
  icon?: React.ReactNode;
  /** 右侧自定义内容 */
  children?: React.ReactNode;
  /** 配色 */
  colors: AppColors;
  /** 是否隐藏底部分隔线（默认 false） */
  hideDivider?: boolean;
  /** 自定义容器样式 */
  style?: ViewStyle;
}

/** 通用设置行 */
export function SettingRow({
  label,
  description,
  icon,
  children,
  colors,
  hideDivider = false,
  style,
}: SettingRowProps) {
  return (
    <View
      style={[
        styles.container,
        {borderBottomColor: colors.border},
        hideDivider ? null : styles.withDivider,
        style,
      ]}>
      <View style={styles.left}>
        {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
        <View style={styles.textWrap}>
          <Text style={[styles.label, {color: colors.text}]} numberOfLines={2}>
            {label}
          </Text>
          {description ? (
            <Text
              style={[styles.description, {color: colors.textSecondary}]}
              numberOfLines={3}>
              {description}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 56,
  },
  withDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
  },
  iconWrap: {
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
