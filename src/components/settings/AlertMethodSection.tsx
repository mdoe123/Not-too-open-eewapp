// 报警方式设置分组
// 铃声 / 振动 / 免打扰时段（开关 + 起止时间输入，HH:mm 格式校验）
import React, {useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {AlertConfig} from '../../types';
import {AppColors} from '../../theme/colors';
import {SettingRow} from './SettingRow';
import {ToggleRow} from './ToggleRow';
import {SliderRow} from './SliderRow';
import {BellIcon, VibrateIcon, FlashlightIcon, MoonIcon, VolumeIcon, NotificationIcon} from '../icons/SettingsIcons';

export interface AlertMethodSectionProps {
  /** 当前报警配置 */
  alert: AlertConfig;
  /** 局部更新回调 */
  updateAlert: (partial: Partial<AlertConfig>) => void;
  /** 配色 */
  colors: AppColors;
}

/** HH:mm 校验正则 */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 校验 HH:mm 格式字符串 */
function isValidTime(s: string): boolean {
  return TIME_RE.test(s);
}

/** 报警方式设置分组 */
export function AlertMethodSection({
  alert,
  updateAlert,
  colors,
}: AlertMethodSectionProps) {
  // 免打扰是否启用：要求 start 和 end 同时存在且格式有效
  // 仅有一个时间视为半残状态，不应启用（避免单边配置导致行为不一致）
  const quietEnabled =
    isValidTime(alert.quietHoursStart ?? '') &&
    isValidTime(alert.quietHoursEnd ?? '');

  return (
    <View style={styles.wrap}>
      <ToggleRow
        label="消息通知"
        description="事件到达时发送系统通知栏消息（不受阈值影响）"
        icon={<NotificationIcon size={20} color={colors.text} />}
        value={alert.notificationEnabled}
        onValueChange={v => updateAlert({notificationEnabled: v})}
        colors={colors}
      />
      <ToggleRow
        label="铃声"
        description="地震预警时播放铃声"
        icon={<BellIcon size={20} color={colors.text} />}
        value={alert.soundEnabled}
        onValueChange={v => updateAlert({soundEnabled: v})}
        colors={colors}
      />
      <ToggleRow
        label="振动"
        description="地震预警时设备振动"
        icon={<VibrateIcon size={20} color={colors.text} />}
        value={alert.vibrationEnabled}
        onValueChange={v => updateAlert({vibrationEnabled: v})}
        colors={colors}
      />
      <ToggleRow
        label="闪光灯"
        description="橙红级烈度 ≥ 5 时闪烁"
        icon={<FlashlightIcon size={20} color={colors.text} />}
        value={alert.flashlightEnabled}
        onValueChange={v => updateAlert({flashlightEnabled: v})}
        colors={colors}
      />
      <View style={[styles.subGroup, {borderBottomColor: colors.border}]}>
        <ToggleRow
          label="自动调节音量"
          description="预警时自动调高媒体音量，结束后恢复"
          icon={<VolumeIcon size={20} color={colors.text} />}
          value={alert.autoVolumeEnabled}
          onValueChange={v => updateAlert({autoVolumeEnabled: v})}
          colors={colors}
        />
        {alert.autoVolumeEnabled ? (
          <SliderRow
            label="预警音量"
            value={alert.alertVolume}
            minimum={0}
            maximum={100}
            step={1}
            unit="%"
            formatValue={v => `${Math.round(v)}`}
            onSlidingComplete={v => updateAlert({alertVolume: Math.round(v)})}
            colors={colors}
          />
        ) : null}
      </View>
      <View style={[styles.subGroup, {borderBottomColor: colors.border}]}>
        <ToggleRow
          label="免打扰时段"
          description="在指定时段内不触发铃声与振动"
          icon={<MoonIcon size={20} color={colors.text} />}
          value={quietEnabled}
          onValueChange={enabled => {
            if (enabled) {
              // 启用时写入默认时段 22:00 - 07:00
              updateAlert({
                quietHoursStart: alert.quietHoursStart ?? '22:00',
                quietHoursEnd: alert.quietHoursEnd ?? '07:00',
              });
            } else {
              updateAlert({quietHoursStart: undefined, quietHoursEnd: undefined});
            }
          }}
          colors={colors}
        />
        {quietEnabled ? (
          <View style={[styles.timeRow, {backgroundColor: colors.surface}]}>
            <Text style={[styles.timeLabel, {color: colors.textSecondary}]}>
              起止时间
            </Text>
            <View style={styles.timeInputs}>
              <TimeInput
                value={alert.quietHoursStart ?? ''}
                placeholder="22:00"
                colors={colors}
                onCommit={v => updateAlert({quietHoursStart: v})}
              />
              <Text style={[styles.dash, {color: colors.textSecondary}]}>—</Text>
              <TimeInput
                value={alert.quietHoursEnd ?? ''}
                placeholder="07:00"
                colors={colors}
                onCommit={v => updateAlert({quietHoursEnd: v})}
              />
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** 时间输入框：HH:mm，失焦时校验，无效则回退 */
interface TimeInputProps {
  value: string;
  placeholder: string;
  colors: AppColors;
  onCommit: (v: string) => void;
}

function TimeInput({value, placeholder, colors, onCommit}: TimeInputProps) {
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);

  // 配置变化时同步显示（如重置）
  React.useEffect(() => {
    setText(value);
    setError(false);
  }, [value]);

  return (
    <View>
      <TextInput
        style={[
          styles.timeInput,
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
        maxLength={5}
        onChangeText={t => {
          setText(t);
          if (error) {
            setError(false);
          }
        }}
        onBlur={() => {
          if (isValidTime(text)) {
            setError(false);
            onCommit(text);
          } else {
            // 无效：回退到上次有效值
            setError(true);
            setText(value);
          }
        }}
      />
      {error ? (
        <Text style={[styles.errText, {color: colors.critical}]}>
          格式应为 HH:mm
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 4,
  },
  subGroup: {
    // 子分组容器：底部由最后一行的 ToggleRow 分隔线处理
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timeLabel: {
    fontSize: 15,
  },
  timeInputs: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeInput: {
    width: 76,
    height: 38,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 8,
    fontSize: 15,
    textAlign: 'center',
  },
  dash: {
    fontSize: 16,
    marginHorizontal: 8,
  },
  errText: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
});
