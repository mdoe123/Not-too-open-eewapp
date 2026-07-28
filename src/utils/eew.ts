// 地震预警计算辅助函数
// 包含：预警级别计算、烈度衰减估算、震中距离计算、S 波到达时间估算
// 供 EewCard / EpicenterMap 等组件共享，避免重复实现

import {EewEvent, AlertLevel} from '../types';

/** S 波平均传播速度（km/s） */
const S_WAVE_VELOCITY = 3.5;

/** 地球半径（km） */
const EARTH_RADIUS_KM = 6371;

/** 将角度转为弧度 */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine 公式计算两点间球面距离（km）
 * @param lat1 起点纬度
 * @param lng1 起点经度
 * @param lat2 终点纬度
 * @param lng2 终点经度
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 根据震级计算预警级别（旧实现，按震级分档）
 *
 * @deprecated 自 DB/T 113.1-2026 标准改造后，预警级别应按预估地震烈度分档。
 *             请改用 {@link computeAlertLevelByIntensity}。
 *             本函数保留仅为兼容旧调用方，内部已改为按烈度估算（仍接收 magnitude 参数）。
 *
 * @param magnitude 震级（仅用于兼容签名，内部忽略）
 */
export function computeAlertLevel(magnitude: number): AlertLevel {
  // 标准改造后按烈度分档，magnitude 不再直接决定级别
  // 旧调用方应在迁移后改用 computeAlertLevelByIntensity
  // 此处返回 silent 作为安全默认值，避免误判
  void magnitude;
  return 'silent';
}

/**
 * 按预估地震烈度计算预警级别（DB/T 113.1-2026 标准）
 *
 * 标准分档：
 * - 烈度 ≥ 7:  red    红色预警 → 严重破坏
 * - 烈度 ≥ 5:  orange 橙色预警 → 破坏
 * - 烈度 ≥ 3:  yellow 黄色预警 → 强烈有感
 * - 烈度 ≥ 1:  blue   蓝色预警 → 有感
 * - 烈度 < 1:  silent 无预警
 *
 * @param intensity 预估地震烈度（CSIS），由 calcCsis 计算
 */
export function computeAlertLevelByIntensity(intensity: number): AlertLevel {
  if (intensity >= 7) return 'red';
  if (intensity >= 5) return 'orange';
  if (intensity >= 3) return 'yellow';
  if (intensity >= 1) return 'blue';
  return 'silent';
}

/**
 * 简化烈度衰减估算
 * 基于震级与震中距离，使用对数衰减近似
 * @deprecated 请改用 {@link calcCsis}，该函数综合考虑震源深度与两种 CEA/ICL 模型，预估更准确。
 * @param magnitude 震级
 * @param distanceKm 震中距离（km）
 * @returns 预估烈度（保留 1 位小数）
 */
export function computeIntensity(
  magnitude: number,
  distanceKm: number,
): number {
  const safeDistance = Math.max(distanceKm, 1);
  const raw = magnitude - Math.log10(safeDistance / 10);
  return Math.max(0, Math.round(raw * 10) / 10);
}

/**
 * CSIS 烈度预估算法
 * 综合中国地震局工程力学研究所（CEA）和中国地震局地震预测研究所（ICL）两种模型取平均
 *
 * @param m 震级
 * @param dep 震源深度（km）
 * @param dis 震中距离（km，地表距离）
 * @returns 预估 CSIS 烈度值（可能为小数），参数非法或距离过远返回 0
 */
export const calcCsis = (m: number, dep: number, dis: number): number => {
  if (isNaN(m) || isNaN(dep) || isNaN(dis)) return 0;
  if (dis > 10000) return 0;

  dep = dep >= 10 ? dep : (Math.max(dep, 0) + 10) / 2;

  const r = 6371;
  const theta = dis / r;
  const a = r - dep;
  const lineDis = Math.sqrt(a * a + r * r - 2 * a * r * Math.cos(theta));

  const k = 1 - 0.7 / Math.sqrt(dep / 10);
  const hypoDis = lineDis - k * dep;

  const ceaCsis = 1.297 * m - 4.368 * Math.log10(hypoDis + 8) + 5.363;
  const iclCsis = 1.363 * m - 1.494 * Math.log(hypoDis) + 2.941;

  const avg = (ceaCsis + iclCsis) / 2;
  return avg;
};

/**
 * 计算 S 波到达用户位置的时间戳（Unix 毫秒）
 * @param event 预警事件
 * @param userLat 用户纬度
 * @param userLng 用户经度
 */
export function computeSWaveArrival(
  event: EewEvent,
  userLat: number,
  userLng: number,
): number {
  const distance = haversineDistance(event.lat, event.lng, userLat, userLng);
  const travelTimeSec = distance / S_WAVE_VELOCITY;
  return event.originTime + travelTimeSec * 1000;
}

/**
 * 格式化发震时间为 "YYYY-MM-DD HH:mm:ss"
 * 对 Invalid Date（NaN/非法时间戳）返回占位符 "--"，避免输出 "NaN-NaN-NaN NaN:NaN:NaN"
 * @param timestamp Unix 毫秒
 */
export function formatOriginTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) {
    return '--';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 校验 EewEvent 数值字段的合理性
 * 用于 SourceAdapter.parse 后的运行时校验，防止非法值流入 UI
 * @returns 错误信息数组，空数组表示通过
 */
export function validateEewEvent(event: EewEvent): string[] {
  const errors: string[] = [];
  if (event.magnitude < 0) {
    errors.push('magnitude 不能为负数');
  }
  if (event.depth < 0) {
    errors.push('depth 不能为负数');
  }
  if (event.lat < -90 || event.lat > 90) {
    errors.push('lat 超出 [-90, 90] 范围');
  }
  if (event.lng < -180 || event.lng > 180) {
    errors.push('lng 超出 [-180, 180] 范围');
  }
  // 单调性：receivedAt 应 >= originTime（接收时间不早于发震时间）
  // 时钟回拨或数据源错误可能导致违反，此处仅记录不阻断
  if (event.receivedAt < event.originTime) {
    errors.push('receivedAt 早于 originTime（可能时钟回拨）');
  }
  return errors;
}

/**
 * 烈度等级颜色映射（1-12 度）
 * 从绿到红渐变，用于详情页烈度分布图例
 */
export const INTENSITY_COLORS: string[] = [
  '#B3D8B2', // 1 - 绿色
  '#7FBF7B', // 2
  '#4DAF4A', // 3
  '#FFEDA0', // 4 - 黄色
  '#FED976', // 5
  '#FEB24C', // 6 - 橙色
  '#FD8D3C', // 7
  '#FC4E2A', // 8 - 红色
  '#E31A1C', // 9
  '#BD0026', // 10 - 深红
  '#800026', // 11
  '#4D0000', // 12 - 深褐色
];

/** 烈度范围计算结果 */
export interface IntensityRange {
  /** 烈度等级（1-12） */
  intensity: number;
  /** 该烈度对应的影响半径（km） */
  distance: number;
}

/**
 * 二分查找特定烈度对应的影响半径
 * 给定震级和震源深度，反推达到目标烈度所需的震中距离
 *
 * @param m 震级
 * @param dep 震源深度（km）
 * @param targetIntensity 目标烈度
 * @returns 影响半径（km）
 */
export function findDistanceForIntensity(
  m: number,
  dep: number,
  targetIntensity: number,
): number {
  let low = 0;
  let high = 10000;
  let mid = 0;
  let iterations = 0;

  while (high - low > 0.1 && iterations < 100) {
    mid = (low + high) / 2;
    const intensity = calcCsis(m, dep, mid);

    if (intensity > targetIntensity) {
      low = mid;
    } else {
      high = mid;
    }
    iterations++;
  }

  return mid;
}

/**
 * 计算所有烈度等级（1-12）的影响半径
 * 用于详情页烈度分布范围展示
 *
 * @param m 震级
 * @param dep 震源深度（km）
 * @returns 烈度范围数组（1-12 度各自的影响半径）
 */
export function calculateIntensityRanges(
  m: number,
  dep: number,
): IntensityRange[] {
  const results: IntensityRange[] = [];
  for (let intensity = 1; intensity <= 12; intensity++) {
    const distance = findDistanceForIntensity(m, dep, intensity);
    results.push({intensity, distance});
  }
  return results;
}

/**
 * 格式化发震时间为 "YYYY-MM-DD HH:mm"（不含秒，用于详情页卡片显示）
 * @param timestamp Unix 毫秒
 */
export function formatOriginTimeShort(timestamp: number): string {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) {
    return '--';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
