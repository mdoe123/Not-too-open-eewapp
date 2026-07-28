// 滑块设置行：标签 + 当前值 + 滑块
// 使用 @react-native-community/slider（RN 0.86 已移除内置 Slider）
// 黑白风格：轨道用 border 色，已选部分用 text 色
//
// 性能优化（P1-16 修复）：
// - 内部维护本地显示值，onValueChange 仅更新本地 state（不触发父组件重渲染）
// - onSlidingComplete 才回调上层提交配置（避免拖动期间高频写存储）
// - 拖动时滑块与数值显示流畅，不受父组件 re-render 影响
import React, {memo, useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import Slider from '@react-native-community/slider';
import {AppColors} from '../../theme/colors';

export interface SliderRowProps {
  /** 标签 */
  label: string;
  /** 当前值（来自父组件配置） */
  value: number;
  /** 最小值 */
  minimum: number;
  /** 最大值 */
  maximum: number;
  /** 步长 */
  step: number;
  /** 单位文案（如 "级"、"度"） */
  unit?: string;
  /** 数值格式化（默认保留 1 位小数） */
  formatValue?: (v: number) => string;
  /**
   * 值变更回调（拖动过程中持续触发，仅用于实时反馈，不应在此写存储）
   * 若不需要实时反馈，可不传，仅使用 onSlidingComplete
   */
  onValueChange?: (v: number) => void;
  /** 滑动完成回调（用户松手时触发），应在此提交配置到持久化层 */
  onSlidingComplete: (v: number) => void;
  /** 配色 */
  colors: AppColors;
  /** 是否隐藏底部分隔线（默认 false） */
  hideDivider?: boolean;
  /** 是否禁用滑块（默认 false） */
  disabled?: boolean;
}

/** 滑块设置行 */
// React.memo：父组件（如设置页）重渲染时，仅当本行 props 变化才重渲染
// 配合 onSlidingComplete 提交模式，拖动任意滑块不会触发其他 SliderRow 重渲染
export const SliderRow = memo(function SliderRow({
  label,
  value,
  minimum,
  maximum,
  step,
  unit,
  formatValue,
  onValueChange,
  onSlidingComplete,
  colors,
  hideDivider = false,
  disabled = false,
}: SliderRowProps) {
  // 本地显示值：拖动时即时更新，不依赖父组件 re-render
  const [localValue, setLocalValue] = useState(value);

  // 父组件 value 变化时（如重置配置）同步本地值
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const display = formatValue
    ? formatValue(localValue)
    : Number.isInteger(step)
    ? localValue.toFixed(0)
    : localValue.toFixed(1);

  return (
    <View
      style={[
        styles.container,
        hideDivider ? null : [styles.withDivider, {borderBottomColor: colors.border}],
      ]}>
      <View style={styles.header}>
        <Text style={[styles.label, {color: colors.text}]}>{label}</Text>
        <Text style={[styles.value, {color: colors.text}]}>
          {display}
          {unit ? <Text style={[styles.unit, {color: colors.textSecondary}]}> {unit}</Text> : null}
        </Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={minimum}
        maximumValue={maximum}
        step={step}
        value={localValue}
        disabled={disabled}
        onValueChange={v => {
          // 仅更新本地显示，不触发父组件 re-render
          setLocalValue(v);
          onValueChange?.(v);
        }}
        onSlidingComplete={v => {
          // 拖动完成，提交到上层配置
          onSlidingComplete(v);
        }}
        minimumTrackTintColor={colors.text}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.text}
      />
      <View style={styles.rangeRow}>
        <Text style={[styles.range, {color: colors.textSecondary}]}>
          {Number.isInteger(step) ? minimum.toFixed(0) : minimum.toFixed(1)}
        </Text>
        <Text style={[styles.range, {color: colors.textSecondary}]}>
          {Number.isInteger(step) ? maximum.toFixed(0) : maximum.toFixed(1)}
        </Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  withDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
    flex: 1,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
  },
  unit: {
    fontSize: 13,
    fontWeight: '400',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  range: {
    fontSize: 11,
  },
});
