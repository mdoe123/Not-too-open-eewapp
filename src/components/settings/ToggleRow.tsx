// 开关设置行：标签 + 描述 + RN 内置 Switch
import React from 'react';
import {Switch} from 'react-native';
import {SettingRow} from './SettingRow';
import {AppColors} from '../../theme/colors';

export interface ToggleRowProps {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  value: boolean;
  onValueChange: (v: boolean) => void;
  colors: AppColors;
  hideDivider?: boolean;
}

/** 开关设置行 */
export function ToggleRow({
  label,
  description,
  icon,
  value,
  onValueChange,
  colors,
  hideDivider,
}: ToggleRowProps) {
  return (
    <SettingRow
      label={label}
      description={description}
      icon={icon}
      colors={colors}
      hideDivider={hideDivider}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{
          false: colors.border,
          true: colors.text,
        }}
        thumbColor={value ? colors.background : colors.surface}
        ios_backgroundColor={colors.border}
      />
    </SettingRow>
  );
}
