// 实时预警卡组件
// 显示：震级（大字号）、位置、S 波倒计时、预估烈度、震源深度、发震时间
// 卡片左侧竖条颜色按"震中预估烈度"分档（DB/T 113.1-2026 标准），右侧显示"本地预估烈度"数值
// 黑白简约风格：白底黑字 / 黑底白字，仅级别竖条用彩色
//
// 性能优化（P1-14/P1-15 修复）：
// - 距离/烈度/S波到达时间用 useMemo 缓存，依赖 event.id/userLat/userLng
// - 倒计时每秒触发 setTick 仍保留，但计算量已降到最低
// - alertLevel 也 memo 化

import React, {useState, useEffect, useMemo} from 'react';
import {StyleSheet, View, Text} from 'react-native';
import {EewEvent, AlertLevel} from '../types';
import {ThemeColors} from '../theme/colors';
import {ClockIcon, LocationIcon, WaveIcon} from './icons/Icons';
import {
  computeAlertLevelByIntensity,
  calcCsis,
  computeSWaveArrival,
  haversineDistance,
  formatOriginTime,
} from '../utils/eew';
import {getSourceAgency} from '../utils/sourceLabels';

interface EewCardProps {
  /** 预警事件 */
  event: EewEvent;
  /** 用户纬度（用于计算距离与 S 波到达时间） */
  userLat: number;
  /** 用户经度 */
  userLng: number;
  /** 当前配色 */
  colors: ThemeColors;
}

/** 预警级别对应的竖条颜色键 */
function getLevelColor(colors: ThemeColors, level: AlertLevel): string {
  return colors[level];
}

/** 格式化倒计时：超过 60s 显示 "Xm Ys"，否则 "Xs"；0 显示 null（由调用方处理） */
function formatCountdown(seconds: number): string {
  if (seconds <= 0) return '已到达';
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  return `${seconds}s`;
}

/**
 * 实时预警卡
 * 倒计时每秒刷新一次，S 波到达后显示"已到达"
 */
export default function EewCard({event, userLat, userLng, colors}: EewCardProps) {
  // 每秒触发一次重绘以更新倒计时
  // 注意：每张卡片独立定时器，FlatList 最多展示 20 条 = 20 个定时器
  // 优化：arrived 后停止定时器（倒计时归零不再需要更新）
  const [, setTick] = useState(0);
  const [arrived, setArrived] = useState(false);

  // 缓存距离/烈度/S波到达时间，依赖 event.id/userLat/userLng
  // 避免每秒 tick 重复计算 Haversine（P1-15）
  // - epicenterIntensity: 震中预估烈度（距离=0），用于左侧竖条颜色分档
  // - intensity: 本地预估烈度（基于用户距离），用于右侧数值显示
  const cached = useMemo(() => {
    const distance = haversineDistance(event.lat, event.lng, userLat, userLng);
    const epicenterIntensity = calcCsis(event.magnitude, event.depth || 0, 0);
    const intensity = calcCsis(event.magnitude, event.depth || 0, distance);
    const sWaveArrival = computeSWaveArrival(event, userLat, userLng);
    const alertLevel = computeAlertLevelByIntensity(epicenterIntensity);
    return {distance, intensity, epicenterIntensity, sWaveArrival, alertLevel};
  }, [event.id, event.lat, event.lng, event.magnitude, event.depth, userLat, userLng]);

  useEffect(() => {
    // 已到达则停止定时器，减少不必要的 tick
    if (arrived) {
      return;
    }
    const timer = setInterval(() => {
      const remain = Math.max(
        0,
        Math.ceil((cached.sWaveArrival - Date.now()) / 1000),
      );
      if (remain <= 0) {
        setArrived(true);
      } else {
        setTick(t => t + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [arrived, cached.sWaveArrival]);

  const remainingSec = Math.max(
    0,
    Math.ceil((cached.sWaveArrival - Date.now()) / 1000),
  );
  const levelColor = getLevelColor(colors, cached.alertLevel);

  return (
    <View style={[styles.card, {backgroundColor: colors.surface, borderColor: colors.border}]}>
      {/* 左侧预警级别竖条（颜色按震中预估烈度分档） */}
      <View style={[styles.levelBar, {backgroundColor: levelColor}]} />

      <View style={styles.content}>
        {/* 第一行：震级（大字号）+ 机构标签 + 烈度 */}
        <View style={styles.rowTop}>
          <View style={styles.magGroup}>
            <Text style={[styles.magnitude, {color: colors.text}]}>
              M{event.magnitude.toFixed(1)}
            </Text>
            <View style={[styles.agencyBadge, {backgroundColor: colors.border}]}>
              <Text style={[styles.agencyText, {color: colors.textSecondary}]}>
                {getSourceAgency(event.source)}
              </Text>
            </View>
          </View>
          <View style={styles.intensityBadge}>
            <Text style={[styles.intensityLabel, {color: colors.textSecondary}]}>
              预估烈度
            </Text>
            <Text style={[styles.intensityValue, {color: colors.text}]}>
              {cached.intensity.toFixed(1)}
            </Text>
          </View>
        </View>

        {/* 第二行：位置 */}
        <View style={styles.rowLocation}>
          <LocationIcon size={14} color={colors.textSecondary} />
          <Text
            style={[styles.location, {color: colors.text}]}
            numberOfLines={1}>
            {event.location}
          </Text>
          <Text style={[styles.distance, {color: colors.textSecondary}]}>
            距您 {Math.round(cached.distance)}km
          </Text>
        </View>

        {/* 第三行：倒计时 + 深度 + 发震时间 */}
        <View style={styles.rowBottom}>
          {/* S 波倒计时 */}
          <View style={styles.infoItem}>
            <WaveIcon size={14} color={arrived ? colors.textSecondary : levelColor} />
            <Text
              style={[
                styles.infoText,
                {color: arrived ? colors.textSecondary : colors.text},
                !arrived && styles.countdownActive,
              ]}>
              S波 {formatCountdown(remainingSec)}
            </Text>
          </View>

          {/* 分隔符 */}
          <View style={[styles.separator, {backgroundColor: colors.border}]} />

          {/* 震源深度 */}
          <View style={styles.infoItem}>
            <Text style={[styles.infoText, {color: colors.textSecondary}]}>
              深度 {event.depth}km
            </Text>
          </View>

          {/* 分隔符 */}
          <View style={[styles.separator, {backgroundColor: colors.border}]} />

          {/* 发震时间 */}
          <View style={styles.infoItem}>
            <ClockIcon size={14} color={colors.textSecondary} />
            <Text style={[styles.infoText, {color: colors.textSecondary}]}>
              {formatOriginTime(event.originTime)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    minHeight: 92,
  },
  levelBar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  magGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  magnitude: {
    fontSize: 28,
    fontWeight: '700',
  },
  agencyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  agencyText: {
    fontSize: 10,
    fontWeight: '500',
  },
  intensityBadge: {
    alignItems: 'flex-end',
  },
  intensityLabel: {
    fontSize: 11,
  },
  intensityValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  rowLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  location: {
    fontSize: 14,
    fontWeight: '500',
  },
  distance: {
    fontSize: 12,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  infoText: {
    fontSize: 12,
  },
  countdownActive: {
    fontWeight: '600',
  },
  separator: {
    width: 1,
    height: 10,
  },
});
