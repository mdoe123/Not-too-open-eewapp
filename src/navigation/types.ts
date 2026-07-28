// 导航类型定义
// 定义根导航栈的页面参数列表，供所有页面共享类型安全的 navigation prop

import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {EewEvent} from '../types';

/** 根导航栈页面参数 */
export type RootStackParamList = {
  /** 权限引导页（Task 10，首次启动展示） */
  Onboarding: undefined;
  /** 主界面 */
  Home: undefined;
  /** 设置页面（Task 6 实现） */
  Settings: undefined;
  /** 地震详情页（从卡片点击进入） */
  EventDetail: {event: EewEvent};
  /** 模拟预警页面（从设置页进入） */
  SimulateAlert: undefined;
};

/** Onboarding 页面的 navigation/props 类型 */
export type OnboardingScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Onboarding'
>;

/** Home 页面的 navigation/props 类型 */
export type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

/** Settings 页面的 navigation/props 类型 */
export type SettingsScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Settings'
>;

/** EventDetail 页面的 navigation/props 类型 */
export type EventDetailScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'EventDetail'
>;

/** SimulateAlert 页面的 navigation/props 类型 */
export type SimulateAlertScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'SimulateAlert'
>;
