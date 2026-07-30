// 设置页专用 SVG 线条图标
// 统一规格：24x24 viewBox，stroke=currentColor，fill=none，strokeWidth=1.5
// 通过外层组件设置 color 来控制图标颜色，自动适配亮/暗模式
import React from 'react';
import {Svg, Circle, Line, Path, Rect, Polyline} from 'react-native-svg';

/** 通用图标 Props */
export interface IconProps {
  size?: number;
  color?: string;
}

/** 默认 stroke 配置 */
const STROKE_W = 1.5;
const STROKE_CAP = 'round' as const;
const STROKE_JOIN = 'round' as const;

/** 睁眼 - 表示分组展开 */
export function EyeOpenIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Circle cx="12" cy="12" r="3.2" stroke={color} strokeWidth={STROKE_W} />
    </Svg>
  );
}

/** 闭眼 - 表示分组收起 */
export function EyeClosedIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 10.5C2 10.5 5 16 12 16C19 16 22 10.5 22 10.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Path
        d="M2 13.5C2 13.5 5 19 12 19C19 19 22 13.5 22 13.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
        opacity={0.5}
      />
      <Line x1="4" y1="3.5" x2="20" y2="20.5" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 上箭头 - 优先级上调 */
export function ChevronUpIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="6 14.5 12 8.5 18 14.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 下箭头 - 优先级下调 */
export function ChevronDownIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="6 9.5 12 15.5 18 9.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 右箭头 - 导航入口 */
export function ChevronRightIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="9 6 15 12 9 18"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 铃声 - 报警方式 */
export function BellIcon({size = 24, color = '#000'}: IconProps) {
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

/** 振动 - 报警方式 */
export function VibrateIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="7.5" y="5.5" width="9" height="13" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="3" y1="9" x2="4.5" y2="10" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="4.5" y1="14" x2="3" y2="15" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="21" y1="9" x2="19.5" y2="10" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="19.5" y1="14" x2="21" y2="15" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="2" y1="12" x2="3" y2="12" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="22" y1="12" x2="21" y2="12" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 闪光灯 - 报警方式（手电筒造型） */
export function FlashlightIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 3.5H15L14.5 8H9.5L9 3.5Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinejoin={STROKE_JOIN}
      />
      <Rect x="9.5" y="8" width="5" height="12.5" rx="0.8" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="11" y1="3.5" x2="11" y2="2" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="13" y1="3.5" x2="13" y2="2" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 扬声器 - 自动调节音量 */
export function VolumeIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 9.5H7.5L13 5.5V18.5L7.5 14.5H4V9.5Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinejoin={STROKE_JOIN}
      />
      <Path
        d="M16 9C17 10 17 14 16 15"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
      <Path
        d="M18.5 7C20.5 9.5 20.5 14.5 18.5 17"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
    </Svg>
  );
}

/** 月亮 - 免打扰 */
export function MoonIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4A6.5 6.5 0 0 0 20 14.5Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 服务器 - 数据源 */
export function ServerIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3.5" y="4" width="17" height="6.5" rx="1.2" stroke={color} strokeWidth={STROKE_W} />
      <Rect x="3.5" y="13.5" width="17" height="6.5" rx="1.2" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="6.5" y1="7.2" x2="6.6" y2="7.2" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="6.5" y1="16.8" x2="6.6" y2="16.8" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="10" y1="7.2" x2="17" y2="7.2" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} opacity={0.5} />
      <Line x1="10" y1="16.8" x2="17" y2="16.8" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} opacity={0.5} />
    </Svg>
  );
}

/** 位置（定位针） */
export function LocationIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21c4-4.5 7-8.3 7-11.5A7 7 0 0 0 5 9.5c0 3.2 3 7 7 11.5z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinejoin={STROKE_CAP}
      />
      <Circle cx="12" cy="9.5" r="2.4" stroke={color} strokeWidth={STROKE_W} />
    </Svg>
  );
}

/** 后台运行 */
export function BackgroundIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="4" width="18" height="13" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="3" y1="8" x2="21" y2="8" stroke={color} strokeWidth={STROKE_W} />
      <Circle cx="5.5" cy="6" r="0.5" fill={color} />
      <Circle cx="7.5" cy="6" r="0.5" fill={color} />
      <Path
        d="M9 20.5H15"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
      <Path
        d="M12 17V20.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
    </Svg>
  );
}

/** 悬浮窗 */
export function WindowIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3.5" y="3.5" width="17" height="17" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      <Rect x="8" y="8" width="11" height="11" rx="1" stroke={color} strokeWidth={STROKE_W} opacity={0.6} />
      <Line x1="3.5" y1="7" x2="8" y2="7" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="3.5" y1="11" x2="6" y2="11" stroke={color} strokeWidth={STROKE_W} opacity={0.6} />
    </Svg>
  );
}

/** 锁屏 */
export function LockIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="5" y="10.5" width="14" height="10" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      <Path
        d="M8 10.5V7.5C8 5.01 9.79 3 12 3C14.21 3 16 5.01 16 7.5V10.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Circle cx="12" cy="15.5" r="1.2" stroke={color} strokeWidth={STROKE_W} />
    </Svg>
  );
}

/** 电源 - 开机自启动 */
export function PowerIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3V11"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
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

/** 重置 */
export function ResetIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3.5 9A8.5 8.5 0 1 1 4 14.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Polyline
        points="3 4 3.5 9 8.5 8.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 加号 - 添加 */
export function PlusIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 分享 - 社区分享源配置 */
export function ShareIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="6" cy="12" r="2.5" stroke={color} strokeWidth={STROKE_W} />
      <Circle cx="18" cy="6" r="2.5" stroke={color} strokeWidth={STROKE_W} />
      <Circle cx="18" cy="18" r="2.5" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="8.2" y1="10.8" x2="15.8" y2="7.2" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="8.2" y1="13.2" x2="15.8" y2="16.8" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 编辑 - 编辑源配置 */
export function EditIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20H8L18.5 9.5L14.5 5.5L4 16V20Z"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Line x1="13" y1="7" x2="17" y2="11" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 垃圾桶 - 删除源 */
export function TrashIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 7H20"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
      <Path
        d="M9 7V5C9 4.4 9.4 4 10 4H14C14.6 4 15 4.4 15 5V7"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Path
        d="M6 7L7 20H17L18 7"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Line x1="10" y1="11" x2="10" y2="17" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="14" y1="11" x2="14" y2="17" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 导入 - 从剪贴板/JSON 导入源 */
export function ImportIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 3V14"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
      <Polyline
        points="8 10 12 14 16 10"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Path
        d="M4 17V19C4 20.1 4.9 21 6 21H18C19.1 21 20 20.1 20 19V17"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 复制 - 复制到剪贴板 */
export function CopyIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="8" y="8" width="12" height="12" rx="1.5" stroke={color} strokeWidth={STROKE_W} />
      <Path
        d="M4 16V5C4 4.4 4.4 4 5 4H16"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
    </Svg>
  );
}

/** 二维码 - 分享源配置二维码 */
export function QrCodeIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3.5" y="3.5" width="6" height="6" rx="0.5" stroke={color} strokeWidth={STROKE_W} />
      <Rect x="14.5" y="3.5" width="6" height="6" rx="0.5" stroke={color} strokeWidth={STROKE_W} />
      <Rect x="3.5" y="14.5" width="6" height="6" rx="0.5" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="14.5" y1="14.5" x2="14.5" y2="17" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="17" y1="14.5" x2="17" y2="20.5" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="20.5" y1="14.5" x2="20.5" y2="20.5" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="14.5" y1="20.5" x2="20.5" y2="20.5" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Line x1="17" y1="17" x2="20.5" y2="17" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** 扫码 - 扫描二维码导入源（取景框造型 + 扫描线） */
export function QrScanIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* 四角 L 形取景框 */}
      <Polyline
        points="3 8 3 3 8 3"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Polyline
        points="16 3 21 3 21 8"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Polyline
        points="21 16 21 21 16 21"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      <Polyline
        points="8 21 3 21 3 16"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
        strokeLinejoin={STROKE_JOIN}
      />
      {/* 扫描线 */}
      <Line x1="3" y1="12" x2="21" y2="12" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
    </Svg>
  );
}

/** HTTP 明文连接（地球+连线造型） */
export function HttpIcon({size = 24, color = '#000'}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth={STROKE_W} />
      <Line x1="3.5" y1="12" x2="20.5" y2="12" stroke={color} strokeWidth={STROKE_W} strokeLinecap={STROKE_CAP} />
      <Path
        d="M12 3.5C15 6.5 15 17.5 12 20.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
      <Path
        d="M12 3.5C9 6.5 9 17.5 12 20.5"
        stroke={color}
        strokeWidth={STROKE_W}
        strokeLinecap={STROKE_CAP}
      />
    </Svg>
  );
}
