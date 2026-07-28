// 数据源与报警配置类型定义
import {SourceType, SourceCategory} from './eew';

/**
 * 单个数据源配置
 */
export interface SourceConfig {
  /** 数据源类型 */
  type: SourceType;
  /** 显示名称（如"中国地震台网"） */
  name: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级（数字越小越优先） */
  priority: number;
  /**
   * 数据源分类
   * - eew: 预警数据源（eew API，提供地震预警）
   * - eqlist: 速报数据源（eqlist API，提供地震信息列表）
   *
   * 旧类型（cenc/jma/usgs/thirdParty）默认归为 eew。
   */
  category: SourceCategory;
  /** API/WebSocket 地址 */
  endpoint?: string;
  /** 鉴权密钥（如有） */
  apiKey?: string;
  /** 轮询间隔（HTTP 源使用，毫秒） */
  pollIntervalMs?: number;
  /**
   * 自定义源专用：连接协议
   * - ws: WebSocket（实时推送）
   * - http: HTTP GET 轮询
   *
   * 仅 type === 'customSource' 时必填。
   */
  protocol?: 'ws' | 'http';
  /**
   * 自定义源专用：字段映射规则
   *
   * 每个字段的值是一个"路径表达式"字符串：
   * - 纯路径：$.id、$.data.mag、$.events[0].id
   * - 路径 + 表达式：$.time * 1000、$.depth / 1000
   * - 可选字段：路径以 ? 结尾（如 $.intensity?），缺失时使用默认值
   *
   * 表达式支持四则运算：+ - * /
   * 操作数可以是路径（$.xxx）或数字字面量
   *
   * 仅 type === 'customSource' 时必填。
   */
  fieldMapping?: FieldMapping;
  /**
   * 自定义源专用：鉴权 token（可选）
   * - HTTP：添加 Authorization: Bearer <token> 请求头
   * - WebSocket：URL 追加 ?token=<token> 查询参数
   *
   * 安全设计：与 apiKey 一致，不持久化到 AsyncStorage（仅运行时内存持有）。
   */
  authToken?: string;
  /** 用户自定义备注（如"USGS 轮询源"），仅自定义源使用 */
  note?: string;
}

/**
 * 自定义源字段映射规则
 *
 * 每个字段的值是一个"路径表达式"字符串，App 按此规则从 API 返回的 JSON 中提取字段值。
 *
 * 路径表达式语法：
 * - 根对象：$
 * - 字段访问：$.id、$.data.mag
 * - 数组索引：$.events[0].id
 * - 可选标记：$.intensity?（缺失时用默认值）
 * - 四则运算：$.time * 1000、$.depth / 1000
 *
 * 表达式支持运算符：+ - * /
 * 操作数可为路径（$.xxx）或数字字面量（1000、3.14）
 *
 * 列表 API 支持（listPath）：
 * - 若 API 返回事件数组（如 USGS 的 {features:[...]}），配置 listPath 后，
 *   适配器先提取数组，再对每个元素应用字段映射（路径相对于元素）
 * - 未配置 listPath 时，按单事件解析（对根对象直接提取）
 */
export interface FieldMapping {
  /**
   * 列表路径（可选）。
   * 配置时，适配器先用此路径从响应根对象提取数组，
   * 再对每个数组元素应用下列字段映射（路径相对于元素）。
   * 未配置时，按单事件解析（对根对象直接提取）。
   *
   * 示例：$.features（USGS）、$.data.events、$（根数组）
   */
  listPath?: string;
  /** 事件唯一 ID（必填） */
  eventId: string;
  /**
   * 发震时间 Unix 毫秒（必填）
   * 若 API 返回秒级时间戳，用 $.time * 1000 转换为毫秒
   */
  originTime: string;
  /** 震级（必填） */
  magnitude: string;
  /** 震源深度 km（必填） */
  depth: string;
  /** 震中纬度（必填，范围 [-90, 90]） */
  lat: string;
  /** 震中经度（必填，范围 [-180, 180]） */
  lng: string;
  /** 震中位置描述（必填） */
  location: string;
  /** 预估烈度（可选，缺省时 App 自行计算） */
  intensity?: string;
  /** 是否最终报（可选，默认 false） */
  isFinal?: string;
  /** 是否取消报（可选，默认 false） */
  isCancel?: string;
}

/**
 * 报警配置
 */
export interface AlertConfig {
  // ---- 阈值 ----
  /** 触发预警的最低震级（默认 3.0） */
  minMagnitude: number;
  /** 触发报警的烈度阈值（-3~6，默认 4） */
  lockScreenIntensity: number;

  // ---- 报警方式 ----
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  /** 闪光灯警报（橙红级烈度 ≥ 5 时闪烁，DB/T 113.1-2026 标准） */
  flashlightEnabled: boolean;
  /** 免打扰开始 "HH:mm" */
  quietHoursStart?: string;
  /** 免打扰结束 "HH:mm" */
  quietHoursEnd?: string;

  // ---- 系统能力开关 ----
  backgroundEnabled: boolean;
  floatingWindowEnabled: boolean;
  lockScreenEnabled: boolean;
  autoStartEnabled: boolean;
}

/**
 * 用户位置设置
 * - 'gps'：使用 GPS 自动定位（权限被拒/失败时降级北京坐标）
 * - 'manual'：使用用户手动输入的经纬度（GPS 不可用或想固定参考点时使用）
 */
export interface LocationConfig {
  /** 位置来源模式 */
  mode: 'gps' | 'manual';
  /** 手动纬度（mode='manual' 时生效，范围 -90~90） */
  manualLat: number;
  /** 手动经度（mode='manual' 时生效，范围 -180~180） */
  manualLng: number;
}

/**
 * 调试配置
 * - 远程日志：通过 WebSocket 将 log() 日志发送到调试服务器
 */
export interface DebugConfig {
  /** 是否启用远程日志 */
  remoteLogEnabled: boolean;
  /** 远程日志服务器地址（如 ws://192.168.1.100:8089） */
  remoteLogUrl: string;
}

/**
 * 应用全局配置
 */
export interface AppConfig {
  /** 配置版本号（用于版本化迁移，每次结构变更递增） */
  version: number;
  /** 数据源配置列表 */
  sources: SourceConfig[];
  /** 报警配置 */
  alert: AlertConfig;
  /** 用户位置设置（GPS 自动定位或手动输入坐标） */
  location: LocationConfig;
  /** 调试配置（远程日志等） */
  debug: DebugConfig;
  /** 全局轮询兜底间隔（默认 30000ms） */
  pollIntervalMs: number;
  /** 心跳失败切换阈值（默认 3 次） */
  heartbeatFailureThreshold: number;
}

/** 当前配置版本号（结构变更时递增）
 *
 * 版本历史：
 * - v1: 初始版本
 * - v2: 新增 SourceConfig.category 字段（eew/eqlist）；新增 4 个 eqlist 数据源
 * - v3: 新增 2 个测试数据源（testEew/testEqlist，默认禁用，用于无网络测试）
 * - v4: 移除测试数据源（改用模拟预警页面替代）；剔除旧用户持久化的 test 源
 * - v5: 新增 LocationConfig（location 字段），支持 GPS/手动模式切换
 * - v6: 默认启用 wolfxGetCencEqlist 数据源（修复地震信息列表为空的 bug）
 * - v7: 新增 DebugConfig（debug 字段），支持远程日志调试
 * - v8: 新增 AlertConfig.flashlightEnabled 字段（闪光灯警报，DB/T 113.1-2026 标准）
 * - v9: 移除 AlertConfig.lockScreenMagnitude 字段；lockScreenIntensity 范围调整为 -3~6
 * - v10: 新增 SourceType 'customSource'（自定义数据源）；SourceConfig 新增
 *        protocol/fieldMapping/authToken/note 可选字段（仅 customSource 使用）
 *        新增 FieldMapping 接口。所有新字段可选，向后兼容，旧配置无需特殊处理。
 * - v11: 合规改造——DEFAULT_CONFIG.sources 清空为 []（新用户开箱无预填源）。
 *        用户通过 ① 社区分享 JSON 导入源配置 ② 自部署 Serverless 脚本获取源。
 *        保留 wolfx 适配器代码做向后兼容，老用户升级后已配置的 wolfx 源仍可用。
 *        新增 LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY 常量（首次启动免责声明确认标记）。
 *        迁移策略：不强制清空用户已配置的源，仅影响新安装。
 * - v12: FieldMapping 新增可选 listPath 字段，支持列表 API 直消费（如 USGS/EMSC）。
 *        配置 listPath 时，适配器先提取数组再对每个元素应用字段映射。
 *        未配置 listPath 时保持单事件解析，完全向后兼容。
 *        迁移策略：listPath 为可选字段，旧配置无需特殊处理。
 * - v13: 彻底合规改造——删除所有 wolfx* 适配器代码和 SourceType 字面量。
 *        SourceType 联合仅保留 'customSource' | 'simulated'。
 *        迁移策略：强制清空所有 type 非 'customSource' 的源（包括老用户已配置的 wolfx 源）。
 *        老用户需通过扫码导入/文件夹扫描/文件选择器/手动填写重新配置源。
 *        新增文件夹扫描和文件选择器导入入口（见 docs/file-import.md）。
 *        原生层 EewBackgroundService 改为读 customSource 配置（不再硬编码 wolfx 端点）。
 */
export const CURRENT_CONFIG_VERSION = 13;

/**
 * AsyncStorage 中存储免责声明确认标记的 key
 * - 'true'：用户已同意免责声明
 * - 未设置/其他值：首次启动需弹出免责声明
 */
export const LEGAL_DISCLAIMER_ACKNOWLEDGED_KEY = '@eew_app_legal_disclaimer_acknowledged';

/**
 * 默认配置
 *
 * 合规设计（v11+）：
 * - DEFAULT_CONFIG.sources 为空数组（不预填任何数据源 URL）
 * - App 作为纯工具，不内置转发逻辑，合规责任由用户承担
 * - 新用户开箱看到空源列表，需通过以下方式添加源：
 *   ① 社区分享：从其他用户分享的 JSON 导入源配置
 *   ② 自部署：阅读 docs/deploy-guide.md 在 Cloudflare Worker/Vercel/Deno Deploy 免费部署
 * - wolfx 适配器代码保留（src/sources/wolfx/），老用户升级后已配置的 wolfx 源仍可用
 *
 * 数据源分类说明：
 * - eew：EEW 预警数据源（震前几秒到几十秒预警，实时性要求高）
 * - eqlist：速报数据源（震后几分钟内的地震信息列表）
 */
export const DEFAULT_CONFIG: AppConfig = {
  version: CURRENT_CONFIG_VERSION,
  sources: [
    // 合规改造（v11）：不预填任何数据源。
    // 新用户需通过"设置 → 数据源管理 → 添加"自行配置自定义源，
    // 或通过"分享 → 导入"导入社区分享的源配置 JSON。
    // 详见 docs/custom-source-guide.md 和 docs/deploy-guide.md。
  ],
  alert: {
    minMagnitude: 3.0,
    lockScreenIntensity: 4,
    soundEnabled: true,
    vibrationEnabled: true,
    flashlightEnabled: true,
    backgroundEnabled: true,
    floatingWindowEnabled: true,
    lockScreenEnabled: true,
    autoStartEnabled: true,
  },
  // 默认使用 GPS 自动定位；手动模式默认坐标为北京（与 GPS 降级值一致）
  location: {
    mode: 'gps',
    manualLat: 39.9,
    manualLng: 116.4,
  },
  // 调试配置默认关闭，需在设置页手动启用
  debug: {
    remoteLogEnabled: false,
    remoteLogUrl: '',
  },
  pollIntervalMs: 30000,
  heartbeatFailureThreshold: 3,
};
