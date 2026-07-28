// 模拟预警页面
// 配置模拟地震参数（震级/震源深度/震中距/延时），触发后注入一条模拟 EewEvent
// 到预警列表，触发悬浮窗/锁屏报警联动
//
// 事件注入机制：通过 simulatedEventBus 单例发布事件，useEewStream 订阅后注入 events 列表
// 坐标计算：根据震中距 + 随机方位角 + 用户位置（北京 mock）反算虚拟震中坐标
//
// 两个触发按钮：
// 1. 「触发模拟预警」：JS 层模拟（前台联动，锁屏后失效）
// 2. 「触发锁屏预警测试」：原生层模拟（绕过 JS 层，走真实锁屏预警路径）
//    用于测试锁屏预警功能，不依赖真实地震事件

import React, {useState, useRef, useCallback, useEffect} from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {getColors} from '../theme/colors';
import {SliderRow} from '../components/settings/SliderRow';
import {simulatedEventBus} from '../utils/simulatedEventBus';
import {calcCsis} from '../utils/eew';
import {BackgroundServiceManager} from '../native/BackgroundServiceManager';
import {EewEvent} from '../types';
import type {SimulateAlertScreenProps} from '../navigation/types';

/**
 * 根据预估烈度返回触发按钮配色
 * 烈度 <4 蓝色 / 4-5 黄色 / 6-7 橙色 / >=8 橙红色
 */
function intensityToColor(intensity: number): string {
  if (intensity < 4) return '#2196F3'; // 蓝色
  if (intensity < 6) return '#FFC107'; // 黄色
  if (intensity < 8) return '#FF9800'; // 橙色
  return '#FF5722'; // 橙红色
}

/** Mock 用户位置（北京，与 HomeScreen 一致） */
const MOCK_USER_LAT = 39.9;
const MOCK_USER_LNG = 116.4;

/**
 * 根据震中距 + 随机方位角 + 用户位置反算虚拟震中坐标
 * 使用平面近似公式（震中距 <= 1000km 误差可接受）
 */
function calcEpicenter(distanceKm: number, userLat: number, userLng: number): {lat: number, lng: number} {
  const bearing = Math.random() * 2 * Math.PI; // 随机方位角 0-2π
  const latRad = userLat * Math.PI / 180;
  const lat2 = userLat + (distanceKm / 111) * Math.cos(bearing);
  const lng2 = userLng + (distanceKm / (111 * Math.cos(latRad))) * Math.sin(bearing);
  return {
    lat: Number(lat2.toFixed(4)),
    lng: Number(lng2.toFixed(4)),
  };
}

/**
 * 模拟预警页面
 *
 * 参数不持久化（每次进入页面重置为默认值），符合"不回填"偏好。
 */
export default function SimulateAlertScreen(_: SimulateAlertScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const colors = getColors(isDark);

  // 模拟参数（不持久化）
  const [magnitude, setMagnitude] = useState(5.5);
  const [depth, setDepth] = useState(15);
  const [distance, setDistance] = useState(100);
  const [delaySeconds, setDelaySeconds] = useState(5);

  // 触发状态
  const [countdown, setCountdown] = useState<number | null>(null); // null=未触发, >0=倒计时中
  const [triggered, setTriggered] = useState(false); // 已触发提示

  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggeredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 清理所有定时器
  const clearAllTimers = useCallback(() => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (triggeredTimerRef.current) {
      clearTimeout(triggeredTimerRef.current);
      triggeredTimerRef.current = null;
    }
  }, []);

  // 卸载时清理
  useEffect(() => {
    return clearAllTimers;
  }, [clearAllTimers]);

  /** 触发模拟预警 */
  const handleTrigger = useCallback(() => {
    clearAllTimers();

    const fireEvent = () => {
      const epicenter = calcEpicenter(distance, MOCK_USER_LAT, MOCK_USER_LNG);
      const event: EewEvent = {
        id: `simulate:${Date.now()}`,
        source: 'simulated',
        originTime: Date.now(),
        magnitude,
        depth,
        lat: epicenter.lat,
        lng: epicenter.lng,
        location: `模拟震中（距北京${distance}km）`,
        isFinal: false, // 持续预警状态
        receivedAt: Date.now(),
      };

      simulatedEventBus.emit(event);
      setCountdown(null);
      setTriggered(true);

      // 2 秒后恢复按钮状态
      triggeredTimerRef.current = setTimeout(() => {
        setTriggered(false);
      }, 2000);
    };

    if (delaySeconds > 0) {
      // 延时触发：启动倒计时
      setCountdown(delaySeconds);
      let remaining = delaySeconds;
      countdownTimerRef.current = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          fireEvent();
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    } else {
      // 立即触发
      fireEvent();
    }
  }, [magnitude, depth, distance, delaySeconds, clearAllTimers]);

  /** 取消倒计时 */
  const handleCancel = useCallback(() => {
    clearAllTimers();
    setCountdown(null);
  }, [clearAllTimers]);

  /**
   * 触发锁屏预警测试（原生层路径）
   *
   * 与「触发模拟预警」不同：
   * - 不通过 simulatedEventBus（JS 层），而是直接调用原生层 BackgroundServiceManager.testAlert
   * - 走真实的锁屏预警路径：构造事件 → emitEewEvent → 计算烈度/距离/S波 → showFloatingWindow
   * - 即使 App 在前台，也会强制通过原生层显示悬浮窗
   *
   * 测试场景：
   * 1. 前台测试：观察悬浮窗是否显示（屏幕将被点亮，10 秒 WakeLock）
   * 2. 锁屏测试：点击按钮后立即锁屏（5 秒延时推荐），观察锁屏界面悬浮窗
   * 3. 完全锁屏测试：锁屏后通过 ADB 广播触发（JS 层已挂起）
   *    adb shell am broadcast -a com.mdoeeewapp.android.cn.TEST_ALERT \
   *      --es magnitude 6.0 --es depth 15 --es lat 40.0 --es lng 116.0 --ez forceTrigger true
   */
  const handleTestLockScreenAlert = useCallback(() => {
    // 复用当前参数计算虚拟震中坐标
    const epicenter = calcEpicenter(distance, MOCK_USER_LAT, MOCK_USER_LNG);
    BackgroundServiceManager.testAlert({
      magnitude,
      depth,
      lat: epicenter.lat,
      lng: epicenter.lng,
      forceTrigger: true, // 强制触发，绕过阈值检查（测试用）
    });
    Alert.alert(
      '已触发锁屏预警测试',
      `震级 ${magnitude.toFixed(1)} / 深度 ${depth}km / 距离 ${distance}km\n` +
        `震中坐标：${epicenter.lat.toFixed(2)}, ${epicenter.lng.toFixed(2)}\n\n` +
        `悬浮窗应立即显示。\n` +
        `若要测试锁屏场景：\n` +
        `1. 设置延时 5 秒后点击本按钮\n` +
        `2. 立即按电源键锁屏\n` +
        `3. 等待悬浮窗在锁屏界面显示\n\n` +
        `完全锁屏测试请使用 ADB：\n` +
        `adb shell am broadcast -a com.mdoeeewapp.android.cn.TEST_ALERT ` +
        `--es magnitude ${magnitude.toFixed(1)} --es depth ${depth} ` +
        `--es lat ${epicenter.lat.toFixed(2)} --es lng ${epicenter.lng.toFixed(2)} ` +
        `--ez forceTrigger true`,
    );
  }, [magnitude, depth, distance]);

  const isCounting = countdown !== null && countdown > 0;

  // 预估烈度（综合震级、深度、震中距）
  const estimatedIntensity = calcCsis(magnitude, depth, distance);
  const triggerColor = intensityToColor(estimatedIntensity);

  return (
    <SafeAreaView
      style={[styles.container, {backgroundColor: colors.background}]}
      edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        {/* 说明 */}
        <View style={[styles.infoBox, {backgroundColor: colors.surface}]}>
          <Text style={[styles.infoText, {color: colors.textSecondary}]}>
            配置模拟地震参数，触发后事件将注入预警列表并触发联动（悬浮窗/锁屏报警）。震中位置根据震中距和随机方位角自动计算。
          </Text>
        </View>

        {/* 参数配置 */}
        <SliderRow
          label="震级"
          value={magnitude}
          minimum={3.0}
          maximum={8.0}
          step={0.1}
          unit="级"
          onSlidingComplete={setMagnitude}
          colors={colors}
          disabled={isCounting}
        />
        <SliderRow
          label="震源深度"
          value={depth}
          minimum={5}
          maximum={50}
          step={1}
          unit="km"
          formatValue={v => String(Math.round(v))}
          onSlidingComplete={setDepth}
          colors={colors}
          disabled={isCounting}
        />
        <SliderRow
          label="震中距"
          value={distance}
          minimum={0}
          maximum={1000}
          step={10}
          unit="km"
          formatValue={v => String(Math.round(v))}
          onSlidingComplete={setDistance}
          colors={colors}
          disabled={isCounting}
        />
        <SliderRow
          label="延时"
          value={delaySeconds}
          minimum={0}
          maximum={60}
          step={1}
          unit="秒"
          formatValue={v => String(Math.round(v))}
          onSlidingComplete={setDelaySeconds}
          colors={colors}
          hideDivider
          disabled={isCounting}
        />

        {/* 触发按钮区 */}
        <View style={styles.buttonArea}>
          {isCounting ? (
            <View style={styles.countdownRow}>
              <View style={[styles.countdownBox, {backgroundColor: colors.warning}]}>
                <Text style={styles.countdownText}>{countdown}s</Text>
              </View>
              <Pressable
                style={[styles.cancelBtn, {borderColor: colors.border}]}
                onPress={handleCancel}
                hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                <Text style={[styles.cancelBtnText, {color: colors.textSecondary}]}>
                  取消
                </Text>
              </Pressable>
            </View>
          ) : triggered ? (
            <View style={[styles.triggeredBox, {backgroundColor: colors.success}]}>
              <Text style={styles.triggeredText}>已触发</Text>
            </View>
          ) : (
            <Pressable
              style={({pressed}) => [
                styles.triggerBtn,
                {backgroundColor: triggerColor},
                pressed && styles.triggerBtnPressed,
              ]}
              onPress={handleTrigger}>
              <Text style={styles.triggerBtnText}>
                触发模拟预警{delaySeconds > 0 ? `（${delaySeconds}秒后）` : ''}
              </Text>
            </Pressable>
          )}
        </View>

        {/* 锁屏预警测试按钮区（原生层路径） */}
        <View style={styles.lockScreenTestArea}>
          <Pressable
            style={({pressed}) => [
              styles.lockScreenTestBtn,
              {borderColor: colors.text},
              pressed && styles.triggerBtnPressed,
              isCounting && styles.lockScreenTestBtnDisabled,
            ]}
            onPress={handleTestLockScreenAlert}
            disabled={isCounting}>
            <Text
              style={[
                styles.lockScreenTestBtnText,
                {color: colors.text},
              ]}>
              触发锁屏预警测试
            </Text>
          </Pressable>
          <Text style={[styles.lockScreenTestHint, {color: colors.textSecondary}]}>
            走原生层锁屏预警路径（绕过 JS 层），用于测试锁屏下悬浮窗显示。点击后会弹出 ADB 命令提示。
          </Text>
        </View>

        {/* 预估效果预览 */}
        <View style={[styles.previewBox, {backgroundColor: colors.surface}]}>
          <Text style={[styles.previewTitle, {color: colors.text}]}>
            预估效果
          </Text>
          <Text style={[styles.previewText, {color: colors.textSecondary}]}>
            震级 {magnitude.toFixed(1)} 级{magnitude >= 6.0 ? '（紧急）' : magnitude >= 5.0 ? '（警告）' : magnitude >= 4.0 ? '（提醒）' : '（信息）'}
            {'\n'}震源深度 {depth} km
            {'\n'}距您约 {distance} km
            {'\n'}{magnitude >= 4.0 ? '将触发悬浮窗' : '震级不足，不会触发悬浮窗'}
            {'\n'}{magnitude >= 5.0 ? '将触发锁屏报警（需满足阈值）' : '震级不足，不会触发锁屏报警'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  infoBox: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 20,
  },
  buttonArea: {
    marginTop: 24,
    marginBottom: 16,
    alignItems: 'center',
  },
  triggerBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  triggerBtnPressed: {
    opacity: 0.8,
  },
  triggerBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  countdownBox: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  countdownText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  triggeredBox: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  triggeredText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  lockScreenTestArea: {
    marginTop: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  lockScreenTestBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  lockScreenTestBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  lockScreenTestBtnDisabled: {
    opacity: 0.4,
  },
  lockScreenTestHint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  previewBox: {
    borderRadius: 10,
    padding: 14,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 22,
  },
});
