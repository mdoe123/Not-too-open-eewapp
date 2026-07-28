// 可折叠分组：标题 + 眼睛图标（睁开=展开，闭合=收起），点击标题区切换
// 用于减少设置页顶部菜单杂乱，符合用户偏好
import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {AppColors} from '../../theme/colors';
import {EyeOpenIcon, EyeClosedIcon} from '../icons/SettingsIcons';

export interface CollapsibleSectionProps {
  /** 分组标题 */
  title: string;
  /** 标题左侧图标（可选） */
  icon?: React.ReactNode;
  /** 是否默认展开（默认 true） */
  defaultExpanded?: boolean;
  /** 配色 */
  colors: AppColors;
  /** 子内容 */
  children: React.ReactNode;
}

/** 可折叠分组 */
export function CollapsibleSection({
  title,
  icon,
  defaultExpanded = true,
  colors,
  children,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View
      style={[
        styles.container,
        {backgroundColor: colors.background, borderColor: colors.border},
      ]}>
      <Pressable
        style={({pressed}) => [
          styles.header,
          {backgroundColor: pressed ? colors.surface : colors.background},
        ]}
        onPress={() => setExpanded(prev => !prev)}
        accessibilityRole="button"
        accessibilityState={{expanded}}
        accessibilityLabel={`${title}，${expanded ? '收起' : '展开'}`}
        hitSlop={{top: 8, bottom: 8}}>
        <View style={styles.headerLeft}>
          {icon ? <View style={styles.headerIcon}>{icon}</View> : null}
          <Text style={[styles.title, {color: colors.text}]}>{title}</Text>
        </View>
        <View style={styles.eyeBtn}>
          {expanded ? (
            <EyeOpenIcon size={22} color={colors.text} />
          ) : (
            <EyeClosedIcon size={22} color={colors.textSecondary} />
          )}
        </View>
      </Pressable>
      {expanded ? (
        <View style={[styles.body, {backgroundColor: colors.background}]}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 12,
    marginHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerIcon: {
    marginRight: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  eyeBtn: {
    padding: 6,
  },
  body: {
    paddingTop: 4,
    paddingBottom: 4,
  },
});
