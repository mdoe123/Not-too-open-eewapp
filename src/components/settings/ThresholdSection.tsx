// 预警阈值设置分组
// 两个滑块：触发预警震级、报警烈度
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {AlertConfig} from '../../types';
import {AppColors} from '../../theme/colors';
import {SliderRow} from './SliderRow';

export interface ThresholdSectionProps {
  /** 当前报警配置 */
  alert: AlertConfig;
  /** 局部更新回调 */
  updateAlert: (partial: Partial<AlertConfig>) => void;
  /** 配色 */
  colors: AppColors;
}

/** 预警阈值设置分组 */
export function ThresholdSection({
  alert,
  updateAlert,
  colors,
}: ThresholdSectionProps) {
  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionHint, {color: colors.textSecondary}]}>
        调整触发预警的震级与烈度阈值，低于阈值的事件将仅记录不报警
      </Text>
      <SliderRow
        label="触发预警震级"
        value={alert.minMagnitude}
        minimum={1.0}
        maximum={8.0}
        step={0.1}
        unit="级"
        onSlidingComplete={v => updateAlert({minMagnitude: round1(v)})}
        colors={colors}
      />
      <SliderRow
        label="报警烈度"
        value={alert.lockScreenIntensity}
        minimum={-3}
        maximum={6}
        step={1}
        unit="度"
        formatValue={v => v.toFixed(0)}
        onSlidingComplete={v => updateAlert({lockScreenIntensity: Math.round(v)})}
        colors={colors}
      />
    </View>
  );
}

/** 保留 1 位小数，规避浮点累加误差 */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 4,
  },
  sectionHint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
});
