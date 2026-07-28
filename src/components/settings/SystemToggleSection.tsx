// 系统能力开关分组
// 后台运行 / 悬浮窗 / 锁屏报警 / 开机自启动
// 开关旁显示对应系统权限的实际开启状态（通过 useSystemPermissionStatus 检测）
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {AlertConfig} from '../../types';
import {AppColors} from '../../theme/colors';
import {ToggleRow} from './ToggleRow';
import {useSystemPermissionStatus} from '../../hooks/useSystemPermissionStatus';
import {
  BackgroundIcon,
  WindowIcon,
  LockIcon,
  PowerIcon,
} from '../icons/SettingsIcons';

export interface SystemToggleSectionProps {
  /** 当前报警配置 */
  alert: AlertConfig;
  /** 局部更新回调 */
  updateAlert: (partial: Partial<AlertConfig>) => void;
  /** 配色 */
  colors: AppColors;
}

/**
 * 系统能力开关分组
 * 每个开关旁显示对应系统权限的实际开启状态
 */
export function SystemToggleSection({
  alert,
  updateAlert,
  colors,
}: SystemToggleSectionProps) {
  const {overlay, notification, battery} = useSystemPermissionStatus();

  // 权限状态文字拼接
  const overlayStatus = overlay === null
    ? ''
    : overlay
      ? '（权限已开启）'
      : '（权限未开启）';
  const notificationStatus = notification === null
    ? ''
    : notification
      ? '（通知权限已开启）'
      : '（通知权限未开启）';
  const batteryStatus = battery === null
    ? ''
    : battery
      ? '（已加入电池优化白名单）'
      : '（未加入电池优化白名单）';

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionHint, {color: colors.textSecondary}]}>
        下方显示各能力对应的系统权限实际状态
      </Text>
      <ToggleRow
        label="后台运行"
        description={`在后台持续接收地震预警数据${notificationStatus}${batteryStatus}`}
        icon={<BackgroundIcon size={20} color={colors.text} />}
        value={alert.backgroundEnabled}
        onValueChange={v => updateAlert({backgroundEnabled: v})}
        colors={colors}
      />
      <ToggleRow
        label="悬浮窗"
        description={`地震发生时显示悬浮预警窗口${overlayStatus}`}
        icon={<WindowIcon size={20} color={colors.text} />}
        value={alert.floatingWindowEnabled}
        onValueChange={v => updateAlert({floatingWindowEnabled: v})}
        colors={colors}
      />
      <ToggleRow
        label="锁屏报警"
        description="锁屏状态下高震级地震触发报警（无需额外权限）"
        icon={<LockIcon size={20} color={colors.text} />}
        value={alert.lockScreenEnabled}
        onValueChange={v => updateAlert({lockScreenEnabled: v})}
        colors={colors}
      />
      <ToggleRow
        label="开机自启动"
        description="设备开机后自动启动预警服务（请到系统设置确认自启动状态）"
        icon={<PowerIcon size={20} color={colors.text} />}
        value={alert.autoStartEnabled}
        onValueChange={v => updateAlert({autoStartEnabled: v})}
        colors={colors}
        hideDivider
      />
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
});
