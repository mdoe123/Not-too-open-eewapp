// 位置设置分组
// 模式切换（GPS 自动定位 / 手动输入经纬度）+ 手动模式下的经纬度输入框
//
// 设计：
// - GPS 模式：使用系统 GPS 定位，权限被拒/失败时降级北京坐标
// - 手动模式：用户输入经纬度，适合 GPS 不可用或想固定参考点的场景
// - 经纬度输入失焦时校验范围（纬度 -90~90，经度 -180~180），无效回退
import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {LocationConfig} from '../../types';
import {AppColors} from '../../theme/colors';
import {ToggleRow} from './ToggleRow';
import {LocationIcon} from '../icons/SettingsIcons';

export interface LocationSectionProps {
  /** 当前位置配置 */
  location: LocationConfig;
  /** 局部更新回调 */
  updateLocation: (partial: Partial<LocationConfig>) => void;
  /** 配色 */
  colors: AppColors;
}

/** 位置设置分组 */
export function LocationSection({
  location,
  updateLocation,
  colors,
}: LocationSectionProps) {
  const isManual = location.mode === 'manual';

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionHint, {color: colors.textSecondary}]}>
        选择位置来源：GPS 自动定位或手动输入经纬度。距离、烈度、倒计时均基于此位置计算
      </Text>
      <ToggleRow
        label="手动输入位置"
        description="开启后使用下方输入的经纬度，关闭则使用 GPS 自动定位"
        icon={<LocationIcon size={20} color={colors.text} />}
        value={isManual}
        onValueChange={v => updateLocation({mode: v ? 'manual' : 'gps'})}
        colors={colors}
      />
      {isManual ? (
        <View style={[styles.coordRow, {backgroundColor: colors.surface}]}>
          <Text style={[styles.coordLabel, {color: colors.textSecondary}]}>
            经纬度
          </Text>
          <View style={styles.coordInputs}>
            <CoordInput
              value={location.manualLat}
              placeholder="纬度"
              min={-90}
              max={90}
              colors={colors}
              onCommit={v => updateLocation({manualLat: v})}
            />
            <Text style={[styles.dash, {color: colors.textSecondary}]}>,</Text>
            <CoordInput
              value={location.manualLng}
              placeholder="经度"
              min={-180}
              max={180}
              colors={colors}
              onCommit={v => updateLocation({manualLng: v})}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** 经纬度输入框：失焦时校验范围，无效回退到上次有效值 */
interface CoordInputProps {
  value: number;
  placeholder: string;
  min: number;
  max: number;
  colors: AppColors;
  onCommit: (v: number) => void;
}

function CoordInput({value, placeholder, min, max, colors, onCommit}: CoordInputProps) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState(false);

  // 配置变化时同步显示（如重置）
  React.useEffect(() => {
    setText(String(value));
    setError(false);
  }, [value]);

  const onBlur = () => {
    const parsed = parseFloat(text);
    if (!isNaN(parsed) && parsed >= min && parsed <= max) {
      setError(false);
      onCommit(parsed);
    } else {
      setError(true);
      setText(String(value));
    }
  };

  return (
    <View>
      <TextInput
        style={[
          styles.coordInput,
          {
            color: colors.text,
            borderColor: error ? colors.critical : colors.border,
            backgroundColor: colors.background,
          },
        ]}
        value={text}
        placeholder={placeholder}
        placeholderTextColor={colors.silent}
        keyboardType="numeric"
        returnKeyType="done"
        onSubmitEditing={onBlur}
        onBlur={onBlur}
        onChangeText={t => {
          setText(t);
          if (error) {
            setError(false);
          }
        }}
      />
      {error ? (
        <Text style={[styles.errText, {color: colors.critical}]}>
          范围 {min}~{max}
        </Text>
      ) : null}
    </View>
  );
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
  coordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  coordLabel: {
    fontSize: 15,
  },
  coordInputs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  coordInput: {
    width: 80,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 14,
    textAlign: 'center',
  },
  dash: {
    fontSize: 16,
    marginHorizontal: 6,
  },
  errText: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
});
