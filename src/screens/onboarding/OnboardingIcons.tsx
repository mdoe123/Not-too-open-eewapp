// 权限引导页专用 SVG 线条图标
// 统一规格：24x24 viewBox，stroke=currentColor，fill=none，strokeWidth=1.5
// 黑白简约风格：图标本身不带颜色，通过父级 color 样式继承
// 复用 SettingsIcons / Icons 的风格约定

import React from 'react';
import {Svg, Circle, Line, Path, Rect, Polyline, Ellipse} from 'react-native-svg';

/** 通用图标 Props */
export interface OnboardingIconProps {
  /** 尺寸（宽高相等），默认 24 */
  size?: number;
  /** 描边颜色，默认 '#000'（由父级显式传入以适配亮/暗模式） */
  color?: string;
}

/** 默认 stroke 配置 */
const STROKE_W = 1.5;
const STROKE_CAP = 'round' as const;
const STROKE_JOIN = 'round' as const;

/** 位置权限图标（地图针 + 同心圆，表示定位） */
export function LocationPermissionIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 针身（水滴形） */}
      <Path
        d="M12 2 C7.6 2 4 5.6 4 10 C4 15.5 12 22 12 22 C12 22 20 15.5 20 10 C20 5.6 16.4 2 12 2 Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinejoin={STROKE_JOIN}
      />
      {/* 内部小圆 */}
      <Circle cx="12" cy="10" r="2.5" stroke={color} strokeWidth={STROKE_W} />
    </Svg>
  );
}

/** 悬浮窗权限图标（窗口叠加，表示悬浮层） */
export function OverlayPermissionIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 底层窗口 */}
      <Rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      {/* 叠加窗口（虚线感，用半透明） */}
      <Rect
        x="8"
        y="8"
        width="11"
        height="11"
        rx="1"
        stroke={color}
        strokeWidth={STROKE_W}
        opacity={0.6}
      />
      {/* 顶层窗格分隔线 */}
      <Line x1="3.5" y1="7" x2="8" y2="7" stroke={color} strokeWidth={STROKE_W} />
    </Svg>
  );
}

/** 通知权限图标（铃铛） */
export function NotificationPermissionIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5.5 17.5H18.5L17 15.5V10.5C17 7.46 14.54 5 12 5C9.46 5 7 7.46 7 10.5V15.5L5.5 17.5Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Path
        d="M10 19.5C10 20.6 10.9 21.5 12 21.5C13.1 21.5 14 20.6 14 19.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 电池优化图标（电池 + 闪电，表示省电白名单） */
export function BatteryPermissionIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 电池外壳 */}
      <Rect x="3" y="7" width="15" height="10" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      {/* 电池正极 */}
      <Line x1="20" y1="10" x2="20" y2="14" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      {/* 内部闪电符号 */}
      <Path
        d="M11.5 9 L8.5 13 L10.5 13 L9.5 15 L12.5 11 L10.5 11 Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 自启动权限图标（电源符号，表示开机启动） */
export function AutoStartPermissionIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 电源竖线 */}
      <Path d="M12 3V11" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      {/* 电源弧线 */}
      <Path
        d="M6.5 6.5A8 8 0 1 0 17.5 6.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 已开启对勾图标（圆圈内对勾，绿色由父级传入） */
export function CheckCircleIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={STROKE_W} />
      <Polyline
        points="7.5,12.5 10.5,15.5 16.5,9"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
        fill="none"
      />
    </Svg>
  );
}

/** App logo 地震波纹图标（同心圆 + 中心点，表示地震波） */
export function WaveLogoIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 中心震源点 */}
      <Circle cx="12" cy="12" r="1.8" fill={color} />
      {/* 内圈波纹 */}
      <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={STROKE_W} />
      {/* 中圈波纹 */}
      <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={STROKE_W} opacity={0.7} />
      {/* 外圈波纹（断开效果，用两段弧线） */}
      <Ellipse
        cx="12"
        cy="12"
        rx="11"
        ry="11"
        stroke={color}
        strokeWidth={STROKE_W}
        opacity={0.4}
      />
    </Svg>
  );
}

/** 去开启箭头图标（向右箭头） */
export function ArrowForwardIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="4" y1="12" x2="19" y2="12" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Polyline
        points="14,7 19,12 14,17"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
        fill="none"
      />
    </Svg>
  );
}

/** 后台运行图标（窗口 + 进程指示，复用 SettingsIcons 的 BackgroundIcon 风格） */
export function BackgroundPermissionIcon({size = 24, color = '#000'}: OnboardingIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="4" width="18" height="13" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="3" y1="8" x2="21" y2="8" stroke={color} strokeWidth={STROKE_W} />
      <Circle cx="5.5" cy="6" r="0.5" fill={color} />
      <Circle cx="7.5" cy="6" r="0.5" fill={color} />
      {/* 底部支架 */}
      <Path d="M9 20.5H15" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Path d="M12 17V20.5" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}
