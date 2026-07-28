// SVG 线条图标集合
// 所有图标 24x24，stroke 当前颜色，fill none，strokeWidth 1.5
// 黑白简约风格：图标本身不带颜色，通过父级 color 样式继承

import React from 'react';
import {Svg, Circle, Path, Line, Polyline, Polygon} from 'react-native-svg';

/** 图标通用属性 */
interface IconProps {
  /** 尺寸（宽高相等），默认 24 */
  size?: number;
  /** 描边颜色，默认 'currentColor'（继承父级 color 样式） */
  color?: string;
  /** 无障碍标签 */
  accessibilityLabel?: string;
}

const defaultProps = {
  size: 24,
  color: 'currentColor',
};

/** 齿轮（设置）图标 */
export function SettingsIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '设置'}>
      {/* 齿轮外圈 */}
      <Circle cx="12" cy="12" r="7" stroke={color} strokeWidth={1.5} />
      {/* 中心孔 */}
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.5} />
      {/* 8 个齿（短线条辐射） */}
      <Line x1="12" y1="2" x2="12" y2="4.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="12" y1="19.5" x2="12" y2="22" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="2" y1="12" x2="4.5" y2="12" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="19.5" y1="12" x2="22" y2="12" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="4.9" y1="4.9" x2="6.7" y2="6.7" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="17.3" y1="17.3" x2="19.1" y2="19.1" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="19.1" y1="4.9" x2="17.3" y2="6.7" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1="6.7" y1="17.3" x2="4.9" y2="19.1" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </Svg>
  );
}

/** 已连接图标（圆圈内对勾） */
export function ConnectionIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '已连接'}>
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.5} />
      <Polyline
        points="7.5,12.5 10.5,15.5 16.5,9"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** 连接中图标（旋转箭头/加载圈） */
export function ConnectingIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '连接中'}>
      {/* 三分之二圆弧 */}
      <Path
        d="M21 12 A9 9 0 1 0 14 20.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
      {/* 箭头头部 */}
      <Polyline
        points="18,18.5 14,20.5 16,16.5"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** 断开图标（圆圈内斜杠） */
export function DisconnectedIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '已断开'}>
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.5} />
      <Line
        x1="7"
        y1="7"
        x2="17"
        y2="17"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 错误图标（三角形内感叹号） */
export function ErrorIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '错误'}>
      <Polygon
        points="12,3 22,20 2,20"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        fill="none"
      />
      <Line
        x1="12"
        y1="9.5"
        x2="12"
        y2="14"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <Circle cx="12" cy="17" r="0.8" fill={color} stroke={color} />
    </Svg>
  );
}

/** 定位图标（地图针） */
export function LocationIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '定位'}>
      {/* 针身（水滴形） */}
      <Path
        d="M12 2 C7.6 2 4 5.6 4 10 C4 15.5 12 22 12 22 C12 22 20 15.5 20 10 C20 5.6 16.4 2 12 2 Z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        fill="none"
      />
      {/* 内部小圆 */}
      <Circle cx="12" cy="10" r="2.5" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}

/** 时钟图标 */
export function ClockIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '时钟'}>
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.5} />
      {/* 时针 */}
      <Line
        x1="12"
        y1="12"
        x2="12"
        y2="7"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* 分针 */}
      <Line
        x1="12"
        y1="12"
        x2="16"
        y2="12"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** 波纹图标（同心圆） */
export function WaveIcon(props: IconProps) {
  const {size, color, accessibilityLabel} = {...defaultProps, ...props};
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityLabel={accessibilityLabel ?? '波纹'}>
      <Circle cx="12" cy="12" r="2.5" stroke={color} strokeWidth={1.5} />
      <Circle cx="12" cy="12" r="6" stroke={color} strokeWidth={1.5} />
      <Circle cx="12" cy="12" r="9.5" stroke={color} strokeWidth={1.5} />
    </Svg>
  );
}
