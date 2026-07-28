// 应用配色方案
// 黑白简约风格，提供亮色与暗色两套配色
// 各屏幕通过 useColorScheme 选择对应配色，保证暗色模式可用
//
// 语义色说明：
// - silent/blue/yellow/orange/red: 预警级别色（DB/T 113.1-2026 标准，按预估地震烈度分档）
//   silent: 无预警（烈度 < 1）
//   blue:   蓝色预警（烈度 ≥ 1 且 < 3）RGB(55,100,255)
//   yellow: 黄色预警（烈度 ≥ 3 且 < 5）RGB(250,230,0)
//   orange: 橙色预警（烈度 ≥ 5 且 < 7）RGB(240,150,20)
//   red:    红色预警（烈度 ≥ 7）RGB(220,40,40)
// - success: 成功状态色（已连接、已开启权限等）
// - error: 错误状态色（连接错误、配置错误等）
// - warning/critical: 通用语义色（用于警告/错误状态，非预警级别）
// - backgroundE6/F0: 半透明背景色（用于叠加层，避免 hex 拼接脆弱性）

export const lightColors = {
  background: '#FFFFFF',
  surface: '#F5F5F5',
  text: '#000000',
  textSecondary: '#666666',
  border: '#E0E0E0',
  // 预警级别色（DB/T 113.1-2026 标准）
  silent: '#9E9E9E',
  blue: '#3764FF',    // RGB(55,100,255)
  yellow: '#FAE600',  // RGB(250,230,0)
  orange: '#F09614',  // RGB(240,150,20)
  red: '#DC2828',     // RGB(220,40,40)
  // 通用语义状态色（非预警用途）
  success: '#2E7D32',
  error: '#F44336',
  warning: '#FF9800',
  critical: '#F44336',
  // 半透明背景色（用于叠加层，避免 hex 拼接脆弱性）
  backgroundE6: 'rgba(255, 255, 255, 0.9)',
  backgroundF0: 'rgba(255, 255, 255, 0.94)',
};

export const darkColors = {
  background: '#000000',
  surface: '#1A1A1A',
  text: '#FFFFFF',
  textSecondary: '#AAAAAA',
  border: '#333333',
  // 预警级别色（DB/T 113.1-2026 标准，暗色模式下亮度略调高）
  silent: '#9E9E9E',
  blue: '#5B7FFF',    // 暗色模式蓝色提亮
  yellow: '#FFEB3B',  // 暗色模式黄色提亮
  orange: '#FFB74D',  // 暗色模式橙色提亮
  red: '#EF5350',     // 暗色模式红色提亮
  // 通用语义状态色（非预警用途）
  success: '#81C784',
  error: '#EF5350',
  warning: '#FFB74D',
  critical: '#EF5350',
  // 半透明背景色（用于叠加层，避免 hex 拼接脆弱性）
  backgroundE6: 'rgba(0, 0, 0, 0.9)',
  backgroundF0: 'rgba(0, 0, 0, 0.94)',
};

/** 配色对象类型 */
export type AppColors = typeof lightColors;

/**
 * 配色类型别名（供其他模块使用统一命名）
 * 同时导出 ThemeColors 别名，保持与并行开发的组件命名兼容
 */
export type ThemeColors = AppColors;

/**
 * 根据系统颜色方案返回对应配色
 * @param isDark 是否为暗色模式
 */
export function getColors(isDark: boolean): AppColors {
  return isDark ? darkColors : lightColors;
}
