// 权限引导页
// 首次启动时展示，引导用户授予地震预警所需权限
// 黑白简约风格，支持亮/暗模式，使用 ScrollView 适配小屏
//
// 布局：
// - 顶部：App logo（地震波纹）+ 标题"地震预警"+ 副标题
// - 中部：权限项列表（PermissionRow）
// - 底部："完成"按钮（仅 allRequiredGranted 时可点击）+ "稍后设置"文字按钮
//
// 完成逻辑：
// - "完成"按钮：写入 onboarding 完成标志 → navigate('Home')（reset 而非 push，避免返回键回到引导页）
// - "稍后设置"：同样写入标志 → navigate('Home')（用户可后续在设置页重新引导）

import React, {useCallback} from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  StatusBar,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect} from '@react-navigation/native';
import {getColors} from '../../theme/colors';
import {PERMISSION_ITEMS} from './permissionItems';
import PermissionRow from './PermissionRow';
import {WaveLogoIcon} from './OnboardingIcons';
import {usePermissions} from '../../hooks/usePermissions';
import {useOnboarding} from '../../hooks/useOnboarding';
import type {OnboardingScreenProps} from '../../navigation/types';

/**
 * 权限引导页组件
 */
export default function OnboardingScreen({
  navigation,
}: OnboardingScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = getColors(isDark);
  const {statusMap, loadingMap, allRequiredGranted, requestPermission, refreshStatus} =
    usePermissions();
  const {completeOnboarding} = useOnboarding();

  // 屏幕重新聚焦时刷新权限状态（P1-17 修复）
  // 用户从系统设置页返回 App 后，权限状态可能已变化，需重新检查
  useFocusEffect(
    React.useCallback(() => {
      refreshStatus();
    }, [refreshStatus]),
  );

  /** 点击"完成"：写入标志并跳转 Home（replace 避免返回键回到引导页） */
  const handleComplete = useCallback(async () => {
    if (!allRequiredGranted) {
      return;
    }
    await completeOnboarding();
    navigation.replace('Home');
  }, [allRequiredGranted, completeOnboarding, navigation]);

  /** 点击"稍后设置"：写入标志并跳转 Home（用户可后续在设置页重新引导） */
  const handleSkip = useCallback(async () => {
    await completeOnboarding();
    navigation.replace('Home');
  }, [completeOnboarding, navigation]);

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}>
        {/* 顶部 logo + 标题 */}
        <View style={styles.header}>
          <View style={[styles.logoWrap, {borderColor: colors.text}]}>
            <WaveLogoIcon size={40} color={colors.text} />
          </View>
          <Text style={[styles.title, {color: colors.text}]}>地震预警</Text>
          <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
            开启以下权限以确保预警及时送达
          </Text>
        </View>

        {/* 权限项列表 */}
        <View style={[styles.listWrap, {borderColor: colors.border}]}>
          {PERMISSION_ITEMS.map(item => (
            <PermissionRow
              key={item.id}
              item={item}
              granted={statusMap[item.id]}
              loading={loadingMap[item.id]}
              onRequest={() => requestPermission(item.id)}
              colors={colors}
            />
          ))}
        </View>

        {/* 必填项提示 */}
        <Text style={[styles.requiredHint, {color: colors.critical}]}>
          * 为必开启权限，需全部开启才能完成设置
        </Text>
      </ScrollView>

      {/* 底部操作区 */}
      <View
        style={[styles.footer, {borderTopColor: colors.border}]}
        accessibilityRole="toolbar">
        <Pressable
          style={({pressed}) => [
            styles.completeBtn,
            {
              backgroundColor: allRequiredGranted ? colors.text : colors.surface,
              borderColor: colors.text,
            },
            allRequiredGranted && pressed && styles.completeBtnPressed,
          ]}
          onPress={handleComplete}
          disabled={!allRequiredGranted}
          accessibilityLabel="完成设置"
          accessibilityRole="button"
          accessibilityState={{disabled: !allRequiredGranted}}>
          <Text
            style={[
              styles.completeBtnText,
              {
                color: allRequiredGranted
                  ? colors.background
                  : colors.textSecondary,
              },
            ]}>
            完成
          </Text>
        </Pressable>

        <Pressable
          style={({pressed}) => [
            styles.skipBtn,
            pressed && styles.skipBtnPressed,
          ]}
          onPress={handleSkip}
          hitSlop={{top: 12, bottom: 12, left: 16, right: 16}}
          accessibilityLabel="稍后设置"
          accessibilityRole="button">
          <Text style={[styles.skipBtnText, {color: colors.textSecondary}]}>
            稍后设置
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  listWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  requiredHint: {
    fontSize: 11,
    marginTop: 12,
    marginLeft: 4,
  },
  footer: {
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  completeBtn: {
    height: 48, // 足够大，避免误触
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeBtnPressed: {
    opacity: 0.7,
  },
  completeBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  skipBtn: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  skipBtnPressed: {
    opacity: 0.5,
  },
  skipBtnText: {
    fontSize: 14,
  },
});
