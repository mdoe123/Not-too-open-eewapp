// 权限引导页 - 权限项定义
// 定义需要在引导页展示的权限项列表，每项包含检查与请求逻辑
// 整合 Task 7（悬浮窗）、Task 9（开机自启）的权限请求入口
//
// 设计说明：
// - 位置 / 悬浮窗 / 通知 为 required（必须授予才能完成引导）
// - 电池优化 / 自启动 为推荐项（required=false，不阻塞完成，但强烈建议开启）
// - 后台运行检测通知权限（前台服务依赖通知），作为后台能力的代理检测

import {Platform, Linking} from 'react-native';
import {check, request, checkMultiple, requestMultiple, RESULTS, PERMISSIONS, checkNotifications, requestNotifications} from 'react-native-permissions';
import {FloatingWindowManager} from '../../native/FloatingWindowManager';
import {AutoStartManager} from '../../native/AutoStartManager';
import {PermissionManager} from '../../native/PermissionManager';

/** 权限项标识 */
export type PermissionId =
  | 'location'
  | 'overlay'
  | 'notification'
  | 'battery'
  | 'autostart'
  | 'background';

/** 权限项图标类型（与 OnboardingIcons 一一对应） */
export type PermissionIconType =
  | 'location'
  | 'overlay'
  | 'notification'
  | 'battery'
  | 'autostart'
  | 'background';

/** 权限项定义 */
export interface PermissionItem {
  /** 权限标识 */
  id: PermissionId;
  /** 权限名称（中文） */
  title: string;
  /** 用途说明（中文） */
  description: string;
  /** 对应的图标类型 */
  icon: PermissionIconType;
  /** 是否必须授予（true 时阻塞"完成"按钮） */
  required: boolean;
  /** 检查权限是否已授予，返回 true 表示已授予 */
  check: () => Promise<boolean>;
  /** 请求权限（弹出系统对话框或跳转设置页），返回 true 表示已授予 */
  request: () => Promise<boolean>;
}

/**
 * 判断 react-native-permissions 的 PermissionStatus 是否为已授予
 * GRANTED / LIMITED 视为已授予；UNAVAILABLE / DENIED / BLOCKED 视为未授予
 */
function isGranted(status: string): boolean {
  return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
}

/**
 * 位置权限检查
 * 非 Android 平台直接返回 true（iOS 暂未适配，本应用仅面向 Android）
 *
 * Android 12+ 用户可能只授予"大致位置"（ACCESS_COARSE_LOCATION），
 * 此时 FINE 为 DENIED 但 COARSE 为 GRANTED，仍可降级到网络定位。
 * 任一位置权限授予即视为已授权。
 */
async function checkLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    const statuses = await checkMultiple([
      PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
    ]);
    return (
      isGranted(statuses[PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION]) ||
      isGranted(statuses[PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION])
    );
  } catch {
    return false;
  }
}

/**
 * 位置权限请求
 *
 * 同时请求 ACCESS_FINE_LOCATION 和 ACCESS_COARSE_LOCATION，
 * 系统会弹出"精确位置/大致位置"选择对话框。
 * 用户授予任一即视为成功（COARSE 时降级到网络定位）。
 */
async function requestLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    const statuses = await requestMultiple([
      PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION,
    ]);
    return (
      isGranted(statuses[PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION]) ||
      isGranted(statuses[PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION])
    );
  } catch {
    return false;
  }
}

/**
 * 通知权限检查
 * 使用 checkNotifications() 自动适配 Android 13+（POST_NOTIFICATIONS）与 Android 12 及以下
 * Android 12 及以下系统通知默认开启，库会返回 GRANTED
 */
async function checkNotification(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    const response = await checkNotifications();
    return isGranted(response.status);
  } catch {
    return false;
  }
}

/** 通知权限请求 */
async function requestNotification(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    const response = await requestNotifications();
    return isGranted(response.status);
  } catch {
    return false;
  }
}

/**
 * 电池优化白名单检查
 * 通过 PermissionManager 原生模块调 PowerManager.isIgnoringBatteryOptimizations 真实检测
 * 返回 true 表示已加入白名单（不受电池优化限制），false 表示受限制
 */
async function checkBattery(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    return await PermissionManager.isBatteryOptimized();
  } catch {
    return false;
  }
}

/**
 * 电池优化请求
 * 跳转到系统电池优化白名单申请页（ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS）
 * 用户授权后应用将被加入白名单，避免后台被系统杀掉。
 * 返回 true 表示已加入白名单（无需跳转），false 表示已跳转设置页（用户需手动操作）
 */
async function requestBattery(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  try {
    return await PermissionManager.requestBatteryOptimization();
  } catch {
    return false;
  }
}

/**
 * 后台运行检查
 * 前台服务（EewBackgroundService）依赖通知权限才能正常运行，
 * 因此用通知权限作为后台运行能力的代理检测。
 * 返回 true 表示通知权限已开启（后台能力可用），false 表示通知权限未开启
 */
async function checkBackground(): Promise<boolean> {
  return checkNotification();
}

/** 后台运行请求（请求通知权限，作为后台能力的代理） */
async function requestBackground(): Promise<boolean> {
  return requestNotification();
}

/**
 * 权限引导项列表（按展示顺序排列）
 *
 * 顺序：位置 → 悬浮窗 → 通知 → 电池优化 → 自启动 → 后台运行
 * 前 3 项为必须，后 3 项为推荐/说明
 */
export const PERMISSION_ITEMS: PermissionItem[] = [
  {
    id: 'location',
    title: '位置权限',
    description: '计算您与震中的距离、预估地震烈度，提供精准预警',
    icon: 'location',
    required: true,
    check: checkLocation,
    request: requestLocation,
  },
  {
    id: 'overlay',
    title: '悬浮窗权限',
    description: '在其他应用上方显示预警倒计时悬浮窗，及时提醒避险',
    icon: 'overlay',
    required: true,
    check: () => FloatingWindowManager.hasPermission(),
    request: () => FloatingWindowManager.requestPermission(),
  },
  {
    id: 'notification',
    title: '通知权限',
    description: '接收地震预警推送通知，确保预警信息及时送达',
    icon: 'notification',
    required: true,
    check: checkNotification,
    request: requestNotification,
  },
  {
    id: 'battery',
    title: '电池优化白名单',
    description: '加入电池优化白名单，避免后台预警服务被系统杀掉',
    icon: 'battery',
    required: false,
    check: checkBattery,
    request: requestBattery,
  },
  {
    id: 'autostart',
    title: '自启动权限',
    description: '部分厂商手机需手动允许开机自启，确保重启后仍可接收预警（无法自动检测状态，请手动确认）',
    icon: 'autostart',
    required: false,
    check: () => AutoStartManager.isAutoStartEnabled(),
    request: () => AutoStartManager.openAutoStartSettings(),
  },
  {
    id: 'background',
    title: '保持后台运行',
    description: '后台运行依赖通知权限，请确保通知权限已开启以持续接收预警',
    icon: 'background',
    required: false,
    check: checkBackground,
    request: requestBackground,
  },
];

/** 所有 required 权限项的 id 列表（用于计算 allRequiredGranted） */
export const REQUIRED_PERMISSION_IDS: PermissionId[] = PERMISSION_ITEMS.filter(
  item => item.required,
).map(item => item.id);
