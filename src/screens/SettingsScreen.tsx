// 设置页面
// 组装四组可折叠配置（预警阈值、报警方式、数据源管理、系统能力）+ 模拟预警导航入口
// 使用 useConfig 持久化到 AsyncStorage，黑白简约风格，支持亮暗模式
// 四组配置使用 CollapsibleSection 包裹，眼睛图标展开/收起；模拟预警为独立导航卡片

import React, {useCallback} from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getColors} from '../theme/colors';
import {useConfig} from '../hooks/useConfig';
import {ThresholdSection} from '../components/settings/ThresholdSection';
import {AlertMethodSection} from '../components/settings/AlertMethodSection';
import {SourceManageSection} from '../components/settings/SourceManageSection';
import {SystemToggleSection} from '../components/settings/SystemToggleSection';
import {LocationSection} from '../components/settings/LocationSection';
import {DebugSection} from '../components/settings/DebugSection';
import {CollapsibleSection} from '../components/settings/CollapsibleSection';
import {ResetIcon, ChevronRightIcon} from '../components/icons/SettingsIcons';
import type {SettingsScreenProps} from '../navigation/types';

/**
 * 设置页面
 * 顶部标题栏 + 重置按钮（Alert 二次确认）+ 五组可折叠配置 + 模拟预警导航入口
 */
export default function SettingsScreen({navigation}: SettingsScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = getColors(isDark);
  const {config, updateAlert, updateSources, updateLocation, updateDebug, resetConfig} = useConfig();

  /** 重置配置（Alert 二次确认，避免误触） */
  const handleReset = useCallback(() => {
    Alert.alert(
      '重置配置',
      '将所有设置恢复为默认值，此操作不可撤销。',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '重置',
          style: 'destructive',
          onPress: () => resetConfig(),
        },
      ],
      {cancelable: true},
    );
  }, [resetConfig]);

  // 用 useCallback 缓存传递给子组件的回调，避免每次渲染都创建新引用
  const handleUpdateAlert = useCallback(
    (partial: Parameters<typeof updateAlert>[0]) => updateAlert(partial),
    [updateAlert],
  );
  const handleUpdateSources = useCallback(
    (sources: Parameters<typeof updateSources>[0]) => updateSources(sources),
    [updateSources],
  );
  const handleUpdateLocation = useCallback(
    (partial: Parameters<typeof updateLocation>[0]) => updateLocation(partial),
    [updateLocation],
  );
  const handleUpdateDebug = useCallback(
    (partial: Parameters<typeof updateDebug>[0]) => updateDebug(partial),
    [updateDebug],
  );

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top', 'bottom']}>
      {/* 标题栏 */}
      <View style={[styles.titleBar, {borderBottomColor: colors.border}]}>
        <Text style={[styles.title, {color: colors.text}]}>设置</Text>
        <Pressable
          style={({pressed}) => [
            styles.resetBtn,
            pressed && styles.resetBtnPressed,
          ]}
          onPress={handleReset}
          hitSlop={{top: 4, bottom: 4, left: 8, right: 8}}
          accessibilityLabel="重置配置"
          accessibilityRole="button">
          <ResetIcon size={22} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* 预警阈值 */}
        <CollapsibleSection title="预警阈值" colors={colors} defaultExpanded>
          <ThresholdSection
            alert={config.alert}
            updateAlert={handleUpdateAlert}
            colors={colors}
          />
        </CollapsibleSection>

        {/* 报警方式 */}
        <CollapsibleSection title="报警方式" colors={colors} defaultExpanded>
          <AlertMethodSection
            alert={config.alert}
            updateAlert={handleUpdateAlert}
            colors={colors}
          />
        </CollapsibleSection>

        {/* 位置设置：GPS 自动定位 / 手动输入经纬度 */}
        <CollapsibleSection title="位置设置" colors={colors} defaultExpanded>
          <LocationSection
            location={config.location}
            updateLocation={handleUpdateLocation}
            colors={colors}
          />
        </CollapsibleSection>

        {/* 数据源管理：默认折叠，避免首屏一次性挂载 15 个数据源行 + 多个滑块导致进入卡顿 */}
        <CollapsibleSection title="数据源管理" colors={colors} defaultExpanded={false}>
          <SourceManageSection
            sources={config.sources}
            updateSources={handleUpdateSources}
            colors={colors}
          />
        </CollapsibleSection>

        {/* 系统能力开关：默认折叠，配合数据源管理分组降低首屏渲染量 */}
        <CollapsibleSection title="系统能力" colors={colors} defaultExpanded={false}>
          <SystemToggleSection
            alert={config.alert}
            updateAlert={handleUpdateAlert}
            colors={colors}
          />
        </CollapsibleSection>

        {/* 调试设置：远程日志，默认折叠 */}
        <CollapsibleSection title="调试设置" colors={colors} defaultExpanded={false}>
          <DebugSection
            debug={config.debug}
            updateDebug={handleUpdateDebug}
            colors={colors}
          />
        </CollapsibleSection>

        {/* 模拟预警入口 */}
        <Pressable
          style={({pressed}) => [
            styles.navCard,
            {borderColor: colors.border},
            pressed && {backgroundColor: colors.surface},
          ]}
          onPress={() => navigation.navigate('SimulateAlert')}
          accessibilityRole="button"
          accessibilityLabel="模拟预警">
          <View style={styles.navLeft}>
            <Text style={[styles.navLabel, {color: colors.text}]}>模拟预警</Text>
            <Text style={[styles.navDesc, {color: colors.textSecondary}]}>
              配置并触发模拟地震预警测试
            </Text>
          </View>
          <ChevronRightIcon size={22} color={colors.textSecondary} />
        </Pressable>

        {/* 关于入口 */}
        <Pressable
          style={({pressed}) => [
            styles.navCard,
            {borderColor: colors.border},
            pressed && {backgroundColor: colors.surface},
          ]}
          onPress={() => navigation.navigate('About')}
          accessibilityRole="button"
          accessibilityLabel="关于">
          <View style={styles.navLeft}>
            <Text style={[styles.navLabel, {color: colors.text}]}>关于</Text>
            <Text style={[styles.navDesc, {color: colors.textSecondary}]}>
              用户协议、应用信息与开源许可
            </Text>
          </View>
          <ChevronRightIcon size={22} color={colors.textSecondary} />
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  resetBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetBtnPressed: {
    opacity: 0.5,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  navCard: {
    marginTop: 12,
    marginHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  navLeft: {
    flex: 1,
    paddingRight: 12,
  },
  navLabel: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  navDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});
