// 关于页面
// 展示应用信息、用户协议查看入口、开源许可信息
//
// 布局：
// - 顶部：App logo + 名称 + 版本号
// - 中部：信息列表（包名、开源协议、GitHub 仓库）
// - 底部：用户协议查看入口（点击展开完整协议）
//
// 从设置页"关于"入口进入

import React, {useCallback, useState} from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  Linking,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getColors} from '../theme/colors';
import {ChevronRightIcon, ChevronDownIcon, ChevronUpIcon} from '../components/icons/SettingsIcons';
import {AGREEMENT_TITLE, AGREEMENT_FULL} from '../legal/agreementText';
import type {AboutScreenProps} from '../navigation/types';

// 应用图标（与 AndroidManifest.xml 的 ic_launcher 一致）
const APP_ICON = require('../assets/app_icon.png');

/** 应用元信息（与 package.json / build.gradle 保持同步） */
const APP_NAME = 'NTOEEW';
const APP_FULL_NAME = 'Not Too Open EEW App';
const APP_VERSION = '1.0.0';
const APP_PACKAGE = 'com.mdoeeewapp.android.cn';
const APP_LICENSE = 'LGPL-3.0-only';
const GITHUB_URL = 'https://github.com/mdoe123/Not-too-open-eewapp';

/**
 * 关于页面
 */
export default function AboutScreen(_: AboutScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = getColors(isDark);
  const [agreementExpanded, setAgreementExpanded] = useState(false);

  /** 打开 GitHub 仓库 */
  const handleOpenGithub = useCallback(() => {
    Linking.openURL(GITHUB_URL).catch(() => {
      // 忽略打开失败
    });
  }, []);

  /** 切换用户协议展开状态 */
  const toggleAgreement = useCallback(() => {
    setAgreementExpanded(prev => !prev);
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* 顶部 logo + 应用名 */}
        <View style={styles.header}>
          <Image source={APP_ICON} style={styles.logo} resizeMode="contain" />
          <Text style={[styles.appName, {color: colors.text}]}>{APP_NAME}</Text>
          <Text style={[styles.appFullName, {color: colors.textSecondary}]}>
            {APP_FULL_NAME}
          </Text>
          <Text style={[styles.version, {color: colors.textSecondary}]}>
            版本 {APP_VERSION}
          </Text>
        </View>

        {/* 信息列表 */}
        <View style={[styles.infoCard, {borderColor: colors.border}]}>
          <InfoRow
            label="包名"
            value={APP_PACKAGE}
            colors={colors}
            hideDivider={false}
          />
          <InfoRow
            label="开源协议"
            value={APP_LICENSE}
            colors={colors}
            hideDivider={false}
          />
          <Pressable
            style={({pressed}) => [
              styles.infoRow,
              pressed && {backgroundColor: colors.surface},
            ]}
            onPress={handleOpenGithub}
            accessibilityRole="link"
            accessibilityLabel="GitHub 仓库">
            <View style={styles.infoRowLeft}>
              <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>
                GitHub 仓库
              </Text>
            </View>
            <View style={styles.infoRowRight}>
              <Text
                style={[styles.infoLink, {color: colors.text}]}
                numberOfLines={1}>
                查看源码
              </Text>
              <ChevronRightIcon size={18} color={colors.textSecondary} />
            </View>
          </Pressable>
        </View>

        {/* 用户协议展开/收起 */}
        <Pressable
          style={({pressed}) => [
            styles.agreementCard,
            {borderColor: colors.border},
            pressed && {backgroundColor: colors.surface},
          ]}
          onPress={toggleAgreement}
          accessibilityRole="button"
          accessibilityLabel={AGREEMENT_TITLE}
          accessibilityState={{expanded: agreementExpanded}}>
          <View style={styles.agreementHeader}>
            <View style={styles.agreementHeaderLeft}>
              <Text style={[styles.agreementTitle, {color: colors.text}]}>
                {AGREEMENT_TITLE}
              </Text>
              <Text style={[styles.agreementHint, {color: colors.textSecondary}]}>
                {agreementExpanded ? '点击收起' : '点击查看完整协议'}
              </Text>
            </View>
            {agreementExpanded ? (
              <ChevronUpIcon size={20} color={colors.textSecondary} />
            ) : (
              <ChevronDownIcon size={20} color={colors.textSecondary} />
            )}
          </View>
        </Pressable>

        {agreementExpanded && (
          <View style={[styles.agreementBody, {borderColor: colors.border}]}>
            <Text style={[styles.agreementText, {color: colors.text}]}>
              {AGREEMENT_FULL}
            </Text>
          </View>
        )}

        {/* 底部声明 */}
        <Text style={[styles.footerNote, {color: colors.textSecondary}]}>
          本应用不是官方预警渠道，不能替代官方预警系统。{'\n'}
          预警效果取决于用户配置的数据源。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** 信息行（纯展示，不可点击） */
function InfoRow({
  label,
  value,
  colors,
  hideDivider,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof getColors>;
  hideDivider: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoRowLeft}>
        <Text style={[styles.infoLabel, {color: colors.textSecondary}]}>
          {label}
        </Text>
      </View>
      <View style={styles.infoRowRight}>
        <Text
          style={[styles.infoValue, {color: colors.text}]}
          numberOfLines={1}>
          {value}
        </Text>
      </View>
      {!hideDivider && <View style={[styles.divider, {backgroundColor: colors.border}]} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 32,
    paddingBottom: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 88,
    height: 88,
    marginBottom: 16,
    borderRadius: 20,
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 4,
  },
  appFullName: {
    fontSize: 13,
    marginBottom: 4,
  },
  version: {
    fontSize: 13,
  },
  infoCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 16,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
  },
  infoRowLeft: {
    flex: 1,
    paddingRight: 12,
  },
  infoRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 15,
  },
  infoValue: {
    fontSize: 14,
    maxWidth: 200,
  },
  infoLink: {
    fontSize: 14,
    marginRight: 4,
  },
  divider: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: StyleSheet.hairlineWidth,
  },
  agreementCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginBottom: 0,
  },
  agreementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  agreementHeaderLeft: {
    flex: 1,
    paddingRight: 12,
  },
  agreementTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  agreementHint: {
    fontSize: 12,
  },
  agreementBody: {
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
    borderRadius: 10,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    marginTop: 8,
    marginBottom: 16,
    padding: 16,
  },
  agreementText: {
    fontSize: 13,
    lineHeight: 20,
  },
  footerNote: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 24,
  },
});
