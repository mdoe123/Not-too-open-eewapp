// 地震预警核心数据模型
// 所有数据源解析后统一输出 EewEvent 结构，便于上层无差别消费

/**
 * 地震预警事件统一结构
 *
 * 不论数据源是 CENC / JMA / USGS 还是第三方，
 * 经 SourceAdapter.parse 后都必须填充本结构。
 */
export interface EewEvent {
  /** 事件唯一 ID（由数据源 + 原始 ID 拼接，避免跨源冲突） */
  id: string;
  /** 数据来源 */
  source: SourceType;
  /** 发震时间（Unix 毫秒） */
  originTime: number;
  /** 震级（应 >= 0，负震级无物理意义） */
  magnitude: number;
  /** 震源深度（km，应 >= 0） */
  depth: number;
  /** 震中纬度（范围 [-90, 90]） */
  lat: number;
  /** 震中经度（范围 [-180, 180]） */
  lng: number;
  /** 震中位置描述（人类可读） */
  location: string;
  /** 预估烈度（若数据源提供） */
  intensity?: number;
  /** 是否为最终确定结果（vs 初报） */
  isFinal?: boolean;
  /**
   * 是否为取消报（JMA 数据源支持，表示预警被取消）
   * true 时悬浮窗显示"地震预警取消"，3 秒后自动隐藏
   */
  isCancel?: boolean;
  /**
   * App 接收到的时间（Unix 毫秒）
   * 单调性约束：应 >= originTime（接收时间不早于发震时间）
   * 时钟回拨或数据源错误可能导致违反，使用前应校验
   */
  receivedAt: number;
}

/**
 * 支持的数据源类型
 *
 * 合规改造（v13+）：删除所有 wolfx* 和旧占位类型（cenc/jma/usgs/thirdParty）。
 * App 不预置任何数据源，所有源由用户通过以下方式导入：
 *   ① 扫码导入（P2P 二维码分享）
 *   ② 文件夹扫描（见 docs/file-import.md）
 *   ③ 文件选择器导入（SAF）
 *   ④ 手动填写（CustomSourceEditor）
 *
 * - customSource: 用户配置的自定义数据源（HTTP/WebSocket + 字段映射）
 * - simulated: 模拟预警页面手动触发的测试事件（非数据源）
 */
export type SourceType =
  // 自定义数据源（用户填写 URL + 字段映射，App 原生层连接解析）
  | 'customSource'
  // 模拟事件标识（非数据源，仅用于模拟预警功能）
  | 'simulated';

/**
 * 数据源分类
 * - eew: 预警数据源（eew API，提供地震预警）
 * - eqlist: 速报数据源（eqlist API，提供地震信息列表）
 */
export type SourceCategory = 'eew' | 'eqlist';

/**
 * 数据源连接状态
 * - connecting: 连接中
 * - connected: 已连接
 * - disconnected: 已断开
 * - error: 错误
 */
export type SourceStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * 报警级别（按预估地震烈度分档，DB/T 113.1-2026 标准）
 * 严重程度由低到高：silent < blue < yellow < orange < red
 *
 * 标准分档：
 * - silent: 无预警（烈度 < 1）
 * - blue:   蓝色预警（烈度 ≥ 1 且 < 3）→ 有感
 * - yellow: 黄色预警（烈度 ≥ 3 且 < 5）→ 强烈有感
 * - orange: 橙色预警（烈度 ≥ 5 且 < 7）→ 破坏
 * - red:    红色预警（烈度 ≥ 7）→ 严重破坏
 */
export type AlertLevel = 'silent' | 'blue' | 'yellow' | 'orange' | 'red';

/**
 * 用户位置（用于计算距离与烈度衰减）
 */
export interface UserLocation {
  /** 纬度 */
  lat: number;
  /** 经度 */
  lng: number;
  /** 定位精度（米） */
  accuracy?: number;
  /** 定位时间戳（Unix 毫秒） */
  timestamp: number;
}
