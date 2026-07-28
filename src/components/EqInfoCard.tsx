// 地震速报卡组件（eqlist）
// 展示已确定的地震信息：震级、位置、距离、预估烈度、震源深度、发震时间
// 与 EewCard 区别：不含 S 波倒计时与每秒 tick 定时器（速报为最终结果，无需倒计时）
// 卡片左侧竖条颜色按"震中预估烈度"分档（DB/T 113.1-2026 标准），右侧显示"本地预估烈度"数值
// 黑白简约风格：白底黑字 / 黑底白字，仅级别竖条用彩色

import React, {useMemo} from 'react';
import {StyleSheet, View, Text} from 'react-native';
import {EewEvent, AlertLevel} from '../types';
import {ThemeColors} from '../theme/colors';
import {LocationIcon, ClockIcon} from './icons/Icons';
import {
  computeAlertLevelByIntensity,
  calcCsis,
  haversineDistance,
  formatOriginTime,
} from '../utils/eew';
import {getSourceAgency} from '../utils/sourceLabels';

interface EqInfoCardProps {
  /** 速报事件 */
  event: EewEvent;
  /** 用户纬度（用于计算距离） */
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

/**
 * 地震速报卡
 * 无倒计时，纯信息展示
 */
export default function EqInfoCard({event, userLat, userLng, colors}: EqInfoCardProps) {
  // 缓存距离/烈度/级别，依赖 event 核心字段与用户位置
  // - epicenterIntensity: 震中预估烈度（距离=0），用于左侧竖条颜色分档
  // - intensity: 本地预估烈度（基于用户距离），用于右侧数值显示
  const cached = useMemo(() => {
    const distance = haversineDistance(event.lat, event.lng, userLat, userLng);
    const epicenterIntensity = calcCsis(event.magnitude, event.depth || 0, 0);
    const intensity = calcCsis(event.magnitude, event.depth || 0, distance);
    const alertLevel = computeAlertLevelByIntensity(epicenterIntensity);
    return {distance, intensity, epicenterIntensity, alertLevel};
  }, [event.id, event.lat, event.lng, event.magnitude, event.depth, userLat, userLng]);

  const levelColor = getLevelColor(colors, cached.alertLevel);

  return (
    <View style={[styles.card, {backgroundColor: colors.surface, borderColor: colors.border}]}>
      {/* 左侧级别竖条（颜色按震中预估烈度分档） */}
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

        {/* 第三行：深度 + 发震时间 */}
        <View style={styles.rowBottom}>
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
  separator: {
    width: 1,
    height: 10,
  },
});
