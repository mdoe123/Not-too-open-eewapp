// 用户协议/免责声明弹窗
// 首次启动时全屏展示，用户必须同意才能继续使用
//
// 设计要点：
// - 全屏 SafeAreaView（与 OnboardingScreen 模式一致）
// - 顶部黄色横幅强调"请仔细阅读"
// - 中部 ScrollView 展示协议摘要
// - 底部"同意并继续"按钮（用户必须同意才能使用，无拒绝选项）
// - 拦截返回键，用户无法通过返回键跳过
//
// 触发位置：App.tsx 中 useLegalDisclaimer.isAcknowledged === false 时渲染

import React, {useEffect, useCallback} from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  StatusBar,
  useColorScheme,
  BackHandler,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getColors} from '../theme/colors';
import {AGREEMENT_TITLE, AGREEMENT_SUMMARY} from '../legal/agreementText';

interface DisclaimerModalProps {
  /** 用户点击"同意并继续"时触发（由父组件写入 AsyncStorage） */
  onAgree: () => void;
}

/**
 * 用户协议/免责声明弹窗
 *
 * 首次启动拦截层，用户必须同意才能进入主应用。
 */
export default function DisclaimerModal({onAgree}: DisclaimerModalProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = getColors(isDark);

  // 拦截返回键：阻止默认返回行为，用户必须点击"同意并继续"
  useEffect(() => {
    const handler = () => true;
    const subscription = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => subscription.remove();
  }, []);

  const handleAgree = useCallback(() => {
    onAgree();
  }, [onAgree]);

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* 顶部黄色提示横幅 */}
      <View style={[styles.banner, {backgroundColor: colors.yellow}]}>
        <Text style={styles.bannerText}>
          请仔细阅读以下协议后再决定是否使用本应用
        </Text>
      </View>

      {/* 协议正文 */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}>
        <Text style={[styles.title, {color: colors.text}]}>
          {AGREEMENT_TITLE}
        </Text>
        <Text style={[styles.body, {color: colors.text}]}>
          {AGREEMENT_SUMMARY}
        </Text>
      </ScrollView>

      {/* 底部操作区 */}
      <View style={[styles.footer, {borderTopColor: colors.border}]}>
        <Pressable
          style={({pressed}) => [
            styles.agreeBtn,
            {backgroundColor: colors.text, borderColor: colors.text},
            pressed && styles.btnPressed,
          ]}
          onPress={handleAgree}
          accessibilityLabel="同意并继续"
          accessibilityRole="button">
          <Text style={[styles.agreeBtnText, {color: colors.background}]}>
            同意并继续
          </Text>
        </Pressable>
        <Text style={[styles.hint, {color: colors.textSecondary}]}>
          如不同意，请卸载本应用
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  banner: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000', // 黄色背景固定黑字，亮暗模式一致
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
  },
  footer: {
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  agreeBtn: {
    height: 48,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agreeBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  hint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  btnPressed: {
    opacity: 0.7,
  },
});
