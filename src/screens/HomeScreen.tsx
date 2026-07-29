// 主界面
// 布局：标题栏（固定）+ 数据源状态条（固定）+ Tab（固定）+ 卡片列表（滚动）
//
// 地图已移除（原生模块保留备用）：
// - 高德 MapView 存在标注层与底图错位的 SDK 级渲染问题，无法修复
// - 改为纯卡片列表展示，默认显示地震信息（eqlist）Tab
//
// 预警联动集成（前台）：
// - useFloatingWindow：advisory 及以上级别显示悬浮窗倒计时
//
// 锁屏预警集成（后台）：
// - BackgroundServiceManager.updateConfig：alert 配置变更时同步到原生层
// - BackgroundServiceManager.updateLocation：用户位置变化时同步到原生层
// - BackgroundServiceManager.notifyAppInForeground：AppState active 时通知后台服务
//   （后台服务据此跳过悬浮窗触发，由 JS 层 useFloatingWindow 处理）

import React, {useMemo, useCallback, useState, useEffect} from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  StatusBar,
  useColorScheme,
  AppState,
  AppStateStatus,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {EewEvent, AlertLevel, DEFAULT_CONFIG} from '../types';
import {getColors} from '../theme/colors';
import {useEewStream} from '../hooks/useEewStream';
import {useConfig} from '../hooks/useConfig';
import {useFloatingWindow} from '../hooks/useFloatingWindow';
import {useUserLocation} from '../hooks/useUserLocation';
import {useBackgroundService} from '../hooks/useBackgroundService';
import {
  BackgroundServiceManager,
  buildLocationUpdate,
} from '../native/BackgroundServiceManager';
import {computeAlertLevelByIntensity, calcCsis, haversineDistance} from '../utils/eew';
import {log} from '../utils/logger';
import {connectRemoteLogSink} from '../utils/remoteLogSink';
import {SettingsIcon} from '../components/icons/Icons';
import EewCard from '../components/EewCard';
import EqInfoCard from '../components/EqInfoCard';
import type {HomeScreenProps} from '../navigation/types';

/**
 * 地震预警主界面
 *
 * 纯卡片列表布局，无地图。默认显示地震信息 Tab。
 */
export default function HomeScreen({navigation}: HomeScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = getColors(isDark);
  const eewStream = useEewStream();
  const {config} = useConfig();
  const alertConfig = config?.alert ?? DEFAULT_CONFIG.alert;

  // 默认显示地震信息（eqlist）Tab
  const [activeTab, setActiveTab] = useState<'eew' | 'eqlist'>('eqlist');

  // 取最新事件作为活跃预警
  const latestEvent = eewStream.events.length > 0 ? eewStream.events[0] : null;

  const locationConfig = config?.location ?? DEFAULT_CONFIG.location;
  const {location: userLocation, isMock} = useUserLocation({
    mode: locationConfig.mode,
    manualLat: locationConfig.manualLat,
    manualLng: locationConfig.manualLng,
  });

  // 多事件并发支持：活跃事件列表 + 每个事件对应的预警级别
  // - activeEvents：当前所有 eew 事件（按 originTime 降序），传给 useFloatingWindow 用于排序分组显示
  // - alertLevels：每个事件 id 对应的预警级别，由震中距→烈度→级别映射得到
  //   （DB/T 113.1-2026 标准：silent/blue/yellow/orange/red）
  const activeEvents = eewStream.events;
  const alertLevels = useMemo(() => {
    const map: Record<string, AlertLevel> = {};
    if (!userLocation) return map;
    for (const evt of activeEvents) {
      const dist = haversineDistance(evt.lat, evt.lng, userLocation.lat, userLocation.lng);
      const intensity = calcCsis(evt.magnitude, evt.depth || 0, dist);
      map[evt.id] = computeAlertLevelByIntensity(intensity);
    }
    return map;
  }, [activeEvents, userLocation]);

  // 兼容字段：最新事件的单事件预警级别（仅用于日志/调试，悬浮窗已改用 alertLevels 多事件逻辑）
  const alertLevel: AlertLevel = useMemo(() => {
    if (!latestEvent || !userLocation) return 'silent';
    return alertLevels[latestEvent.id] ?? 'silent';
  }, [latestEvent, userLocation, alertLevels]);

  // 标题栏位置小字：GPS 定位中 / 坐标 / 手动坐标
  const locationLabel = useMemo(() => {
    const coord = `${userLocation.lat.toFixed(2)}°N, ${userLocation.lng.toFixed(2)}°E`;
    if (locationConfig.mode === 'manual') {
      return `手动: ${coord}`;
    }
    if (isMock) {
      return '定位中…';
    }
    return coord;
  }, [isMock, userLocation, locationConfig.mode]);

  useFloatingWindow({
    events: activeEvents,
    alertLevels,
    userLocation,
    soundEnabled: alertConfig.soundEnabled,
    vibrationEnabled: alertConfig.vibrationEnabled,
    flashlightEnabled: alertConfig.flashlightEnabled,
  });

  // 后台保活：backgroundEnabled=true 时启动前台服务（常驻通知）
  useBackgroundService(alertConfig.backgroundEnabled);

  // 同步 alert 配置到原生层（供 EewBackgroundService 锁屏预警使用）
  // 配置变更时立即推送，原生层写入 SharedPreferences
  useEffect(() => {
    BackgroundServiceManager.updateConfig(alertConfig);
  }, [alertConfig]);

  // 同步用户位置到原生层（供 EewBackgroundService 计算震中距/烈度）
  // GPS 模式跟随实际定位，手动模式使用手动坐标
  useEffect(() => {
    if (!userLocation) return;
    BackgroundServiceManager.updateLocation(
      buildLocationUpdate(locationConfig, userLocation),
    );
  }, [userLocation, locationConfig]);

  // 同步当前活跃 customSource 到原生层（供 EewBackgroundService 锁屏预警接收数据）
  // 策略：从 config.sources 中筛选 enabled && customSource && category=eew 的源，
  //       按 priority 升序取第一个作为活跃源；若无则传 null（原生层不建立连接）
  useEffect(() => {
    if (!config) return;
    const eewCustomSources = config.sources
      .filter(
        s =>
          s.enabled &&
          s.type === 'customSource' &&
          (s.category ?? 'eew') === 'eew',
      )
      .sort((a, b) => a.priority - b.priority);
    const activeSource = eewCustomSources[0] ?? null;
    BackgroundServiceManager.updateCustomSource(activeSource);
  }, [config?.sources]);

  // AppState 监听：前后台切换时通知后台服务
  // - 'active'：App 回到前台，后台服务跳过悬浮窗触发（由 JS 层 useFloatingWindow 处理）
  // - 'background'/'inactive'：App 进入后台，后台服务接管触发锁屏预警
  //   （MIUI 下 onTrimMemory 和 SCREEN_OFF 不可靠，RN AppState 是最可靠的后台检测方式）
  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'active') {
          log('FLOAT', 'HomeScreen AppState active, notifyAppInForeground', {});
          BackgroundServiceManager.notifyAppInForeground();
          // 同时刷新配置，确保后台服务有最新状态
          BackgroundServiceManager.updateConfig(alertConfig);
          if (userLocation) {
            BackgroundServiceManager.updateLocation(
              buildLocationUpdate(locationConfig, userLocation),
            );
          }
        } else if (nextState === 'background' || nextState === 'inactive') {
          log('FLOAT', 'HomeScreen AppState background, notifyAppInBackground', {});
          BackgroundServiceManager.notifyAppInBackground();
        }
      },
    );
    return () => subscription.remove();
  }, [alertConfig, userLocation, locationConfig]);

  // 远程日志自动连接：配置启用且有 URL 时连接（App 启动后自动恢复）
  const debugConfig = config?.debug ?? DEFAULT_CONFIG.debug;
  useEffect(() => {
    log('FLOAT', 'HomeScreen remoteLog effect', {
      enabled: debugConfig.remoteLogEnabled,
      url: debugConfig.remoteLogUrl,
    });
    if (debugConfig.remoteLogEnabled && debugConfig.remoteLogUrl) {
      connectRemoteLogSink(debugConfig.remoteLogUrl);
    }
  }, [debugConfig.remoteLogEnabled, debugConfig.remoteLogUrl]);

  // 当前 Tab 的事件列表
  const listData = activeTab === 'eew' ? eewStream.events : eewStream.eqlistEvents;

  const renderCard = useCallback(
    ({item}: {item: EewEvent}) =>
      activeTab === 'eew' ? (
        <Pressable
          onPress={() => navigation.navigate('EventDetail', {event: item})}
          style={({pressed}) => pressed && styles.cardPressed}>
          <EewCard
            event={item}
            userLat={userLocation.lat}
            userLng={userLocation.lng}
            colors={colors}
          />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => navigation.navigate('EventDetail', {event: item})}
          style={({pressed}) => pressed && styles.cardPressed}>
          <EqInfoCard
            event={item}
            userLat={userLocation.lat}
            userLng={userLocation.lng}
            colors={colors}
          />
        </Pressable>
      ),
    [colors, activeTab, navigation, userLocation],
  );

  const renderItemSeparator = useCallback(() => <View style={styles.separator} />, []);

  const renderEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, {color: colors.textSecondary}]}>
          {activeTab === 'eew'
            ? eewStream.sourceStatus === 'connected'
              ? '等待预警事件...'
              : '数据源未连接'
            : eewStream.sourceStatus === 'connected'
            ? '暂无地震信息'
            : '速报数据源未连接'}
        </Text>
      </View>
    ),
    [colors.textSecondary, eewStream.sourceStatus, activeTab],
  );

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top', 'bottom']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* 标题栏（固定）：标题 + 位置小字 + 设置按钮 */}
      <View style={[styles.titleBar, {borderBottomColor: colors.border}]}>
        <View style={styles.titleLeft}>
          <Text style={[styles.title, {color: colors.text}]}>地震信息</Text>
          <Text
            style={[styles.subtitle, {color: colors.textSecondary}]}
            numberOfLines={1}>
            {locationLabel}
          </Text>
        </View>
        <Pressable
          style={({pressed}) => [
            styles.settingsBtn,
            pressed && styles.settingsBtnPressed,
          ]}
          onPress={() => navigation.navigate('Settings')}
          hitSlop={{top: 4, bottom: 4, left: 8, right: 8}}
          accessibilityLabel="设置"
          accessibilityRole="button">
          <SettingsIcon size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Tab 切换条（固定） */}
      <View style={[styles.tabBar, {borderBottomColor: colors.border, backgroundColor: colors.background}]}>
        <Pressable
          style={styles.tabItem}
          onPress={() => setActiveTab('eqlist')}
          accessibilityRole="tab"
          accessibilityLabel="地震信息">
          <Text
            style={[
              styles.tabText,
              {
                color: activeTab === 'eqlist' ? colors.text : colors.textSecondary,
                fontWeight: activeTab === 'eqlist' ? '700' : '500',
              },
            ]}>
            地震信息
          </Text>
          {activeTab === 'eqlist' && (
            <View style={[styles.tabIndicator, {backgroundColor: colors.text}]} />
          )}
        </Pressable>
        <Pressable
          style={styles.tabItem}
          onPress={() => setActiveTab('eew')}
          accessibilityRole="tab"
          accessibilityLabel="实时预警">
          <Text
            style={[
              styles.tabText,
              {
                color: activeTab === 'eew' ? colors.text : colors.textSecondary,
                fontWeight: activeTab === 'eew' ? '700' : '500',
              },
            ]}>
            实时预警
          </Text>
          {activeTab === 'eew' && (
            <View style={[styles.tabIndicator, {backgroundColor: colors.text}]} />
          )}
        </Pressable>
        {listData.length > 0 && (
          <Text style={[styles.eventCount, {color: colors.textSecondary}]}>
            共 {listData.length} 条
          </Text>
        )}
      </View>

      {/* 卡片列表（滚动） */}
      <FlatList
        data={listData}
        keyExtractor={item => item.id}
        renderItem={renderCard}
        ListEmptyComponent={renderEmpty}
        ItemSeparatorComponent={renderItemSeparator}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
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
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleLeft: {
    flex: 1,
    paddingRight: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 1,
  },
  settingsBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBtnPressed: {
    opacity: 0.5,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    position: 'relative',
  },
  tabText: {
    fontSize: 13,
  },
  tabIndicator: {
    position: 'absolute',
    bottom: -1,
    left: 12,
    right: 12,
    height: 2,
    borderRadius: 1,
  },
  eventCount: {
    fontSize: 12,
    marginLeft: 'auto',
    marginRight: 4,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  separator: {
    height: 8,
  },
  cardPressed: {
    opacity: 0.7,
  },
});
