// 路径表达式提取工具（JS 层，前台使用）
//
// 从 JSON 数据中按"路径表达式"提取字段值，供 CustomSourceAdapter 解析自定义源数据。
//
// 语法说明：
// - 根对象：$
// - 字段访问：$.id、$.data.mag
// - 数组索引：$.events[0].id
// - 可选标记：$.intensity?（缺失时返回 undefined，不报错）
// - 四则运算：$.time * 1000、$.depth / 1000
// - 函数调用：Date.parse($.time)（解析日期字符串为 Unix 毫秒）
// - glob 通配符：$.No*（按 key 前缀匹配，提取为对象数组）
//
// 表达式支持运算符：+ - * /
// 操作数可为路径（$.xxx）或数字字面量（1000、3.14）
//
// 解析规则：
// 1. 表达式匹配 Date.parse(<path>)：视为函数调用，解析日期字符串
// 2. 字符串包含运算符（+ - * /）且运算符后有数字或 $：视为"路径 + 表达式"
// 3. 否则视为纯路径（支持末尾 * glob 通配符）
// 4. 路径以 ? 结尾：标记为可选，解析时去掉 ?

/** Date.parse(<path>) 函数调用语法正则 */
const DATE_PARSE_REGEX = /^Date\.parse\((.+)\)$/;

/**
 * 从原始数据中按路径表达式提取值
 *
 * @param raw 已解析的 JSON 数据（对象/数组/原始值）
 * @param pathExpr 路径表达式，如 $.id、$.time * 1000、$.intensity?、Date.parse($.time)
 * @returns 提取的值（可能为 string/number/boolean/对象/数组），可选字段缺失时返回 undefined
 */
export function extractByPath(raw: unknown, pathExpr: string): unknown {
  if (typeof pathExpr !== 'string' || pathExpr.length === 0) {
    return undefined;
  }

  // 检测是否为 Date.parse(<path>) 函数调用
  const dateParseMatch = pathExpr.match(DATE_PARSE_REGEX);
  if (dateParseMatch) {
    return tryParseDate(raw, dateParseMatch[1].trim());
  }

  // 检测是否为"路径 + 表达式"（含运算符）
  const exprResult = tryEvaluateExpression(raw, pathExpr);
  if (exprResult.matched) {
    return exprResult.value;
  }

  // 纯路径解析
  return resolvePath(raw, pathExpr);
}

/**
 * 尝试解析日期字符串为 Unix 毫秒
 *
 * 支持格式：
 * - "2026-07-18 13:47:20"（wolfx 风格，UTC+8 时区）
 * - "2026-07-18T13:47:20"（ISO 8601 无时区，按 UTC+8 解析）
 * - "2026-07-18T13:47:20+08:00"（ISO 8601 带时区，直接解析）
 * - 已是数字（Unix 秒/毫秒）：直接返回
 *
 * 时区策略：wolfx API 明确标注 UTC+8，固定按 Asia/Shanghai 时区解析，
 * 不依赖设备本地时区，保证用户在国外使用时也能正确解析中国地震数据。
 *
 * @param raw 原始数据
 * @param pathExpr 日期字段路径表达式，如 $.OriginTime
 * @returns Unix 毫秒，解析失败返回 undefined
 */
function tryParseDate(raw: unknown, pathExpr: string): number | undefined {
  const value = resolvePath(raw, pathExpr);
  if (value === undefined || value === null) {
    return undefined;
  }

  // 数字直接返回（兼容 Unix 秒/毫秒）
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  // 字符串解析
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // 纯数字字符串（如 "1700000000"）
  if (/^-?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }

  // 标准化为 ISO 8601 格式并按 UTC+8 解析
  let isoString = trimmed;
  // 替换空格为 T（"2026-07-18 13:47:20" → "2026-07-18T13:47:20"）
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(isoString)) {
    isoString = isoString.replace(' ', 'T');
  }
  // 若无时区标识，追加 +08:00（wolfx API 明确为 UTC+8）
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(isoString)) {
    isoString = isoString + '+08:00';
  }

  const timestamp = Date.parse(isoString);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * 提取并转为 string，失败返回默认值
 */
export function extractString(raw: unknown, pathExpr: string, defaultValue: string | null = null): string | null {
  const value = extractByPath(raw, pathExpr);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'string') {
    return value;
  }
  // 数字/布尔转字符串
  return String(value);
}

/**
 * 提取并转为 number，失败返回默认值
 */
export function extractNumber(raw: unknown, pathExpr: string, defaultValue: number | null = null): number | null {
  const value = extractByPath(raw, pathExpr);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : defaultValue;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return defaultValue;
}

/**
 * 提取并转为 boolean，失败返回默认值
 *
 * 宽松解析：
 * - boolean 直接返回
 * - number: 0 → false，非 0 → true
 * - string: 'true'/'1' → true，'false'/'0'/'' → false（大小写不敏感）
 */
export function extractBoolean(raw: unknown, pathExpr: string, defaultValue: boolean = false): boolean {
  const value = extractByPath(raw, pathExpr);
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === '') {
      return false;
    }
  }
  return defaultValue;
}

/**
 * 提取并转为数组，失败返回 null
 *
 * 用于 listPath 场景：从响应根对象提取事件数组（如 USGS 的 $.features）。
 *
 * 解析规则：
 * - 数组直接返回
 * - undefined/null 返回 null（表示字段缺失）
 * - 非数组值（对象/字符串/数字等）包装为单元素数组（容错）
 *
 * @param raw 已解析的 JSON 数据
 * @param pathExpr 路径表达式，如 $.features、$.data.events、$（根数组）
 * @returns 数组（可能为空），或 null 表示路径缺失
 */
export function extractArray(raw: unknown, pathExpr: string): unknown[] | null {
  const value = extractByPath(raw, pathExpr);
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value;
  }
  // 非数组值容错包装为单元素数组（如 API 偶尔返回单对象而非数组）
  return [value];
}

// ======================== 内部实现 ========================

/** 运算符正则：匹配 + - * /（前后有空格或操作数） */
const OPERATOR_REGEX = /\s+([+\-*/])\s+(.+)/;

/** 数字字面量正则 */
const NUMBER_LITERAL_REGEX = /^-?\d+(\.\d+)?$/;

/**
 * 尝试将路径表达式作为"路径 + 表达式"求值
 *
 * 匹配格式：`<路径> <运算符> <路径|数字>`
 * 例如：$.time * 1000、$.depth / 1000、$.a.b + $.c.d
 *
 * @returns matched=true 表示匹配成功，value 为求值结果；matched=false 表示不是表达式
 */
function tryEvaluateExpression(raw: unknown, pathExpr: string): {matched: boolean; value?: unknown} {
  const match = pathExpr.match(OPERATOR_REGEX);
  if (!match) {
    return {matched: false};
  }

  const leftExpr = pathExpr.substring(0, match.index).trim();
  const operator = match[1];
  const rightExpr = match[2].trim();

  if (leftExpr.length === 0 || rightExpr.length === 0) {
    return {matched: false};
  }

  // 解析左操作数
  const leftValue = resolvePath(raw, leftExpr);
  if (leftValue === undefined || leftValue === null) {
    // 左操作数缺失，表达式无法求值
    return {matched: true, value: undefined};
  }
  const leftNum = toNumber(leftValue);
  if (leftNum === null) {
    return {matched: false};
  }

  // 解析右操作数（可为路径或数字字面量）
  let rightNum: number | null;
  if (NUMBER_LITERAL_REGEX.test(rightExpr)) {
    rightNum = Number(rightExpr);
  } else {
    const rightValue = resolvePath(raw, rightExpr);
    if (rightValue === undefined || rightValue === null) {
      return {matched: true, value: undefined};
    }
    rightNum = toNumber(rightValue);
  }
  if (rightNum === null) {
    return {matched: false};
  }

  // 四则运算
  let result: number;
  switch (operator) {
    case '+':
      result = leftNum + rightNum;
      break;
    case '-':
      result = leftNum - rightNum;
      break;
    case '*':
      result = leftNum * rightNum;
      break;
    case '/':
      if (rightNum === 0) {
        return {matched: true, value: undefined};
      }
      result = leftNum / rightNum;
      break;
    default:
      return {matched: false};
  }

  return {matched: true, value: result};
}

/**
 * 将值转为 number，失败返回 null
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return null;
}

/**
 * 按纯路径解析值
 *
 * 支持语法：
 * - $ 根对象
 * - $.field 字段访问
 * - $.a.b.c 嵌套字段
 * - $.array[0] 数组索引
 * - $.a.b[0].c 混合
 * - $.field? 可选标记（缺失返回 undefined）
 *
 * @param raw 原始数据
 * @param pathExpr 路径表达式（不含运算符）
 */
function resolvePath(raw: unknown, pathExpr: string): unknown {
  let expr = pathExpr.trim();
  if (expr.length === 0) {
    return undefined;
  }

  // 处理可选标记
  let optional = false;
  if (expr.endsWith('?')) {
    optional = true;
    expr = expr.substring(0, expr.length - 1).trim();
  }

  // 根对象
  if (expr === '$') {
    return raw;
  }

  // 必须以 $. 开头
  if (!expr.startsWith('$.')) {
    return undefined;
  }

  // 去掉 $. 前缀，解析剩余路径
  const pathStr = expr.substring(2);
  if (pathStr.length === 0) {
    return raw;
  }

  // 分词：字段名与数组索引
  // 例如：a.b[0].c → ['a', 'b', 0, 'c']
  const tokens = tokenizePath(pathStr);
  if (tokens.length === 0) {
    return undefined;
  }

  // 逐级访问
  let current: unknown = raw;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (current === undefined || current === null) {
      return optional ? undefined : undefined;
    }
    if (typeof token === 'number') {
      // 数组索引
      if (!Array.isArray(current)) {
        return optional ? undefined : undefined;
      }
      current = current[token];
    } else if (token.endsWith('*') && token.length > 1) {
      // glob 通配符：按 key 前缀匹配，收集为数组
      // 仅支持末尾 *，如 No* 匹配 No1、No2...No50
      // 必须是路径的最后一段（glob 后无更多 token）
      if (i !== tokens.length - 1) {
        return optional ? undefined : undefined;
      }
      if (typeof current !== 'object' || Array.isArray(current)) {
        return optional ? undefined : undefined;
      }
      const prefix = token.slice(0, -1); // 去掉末尾 *
      const obj = current as Record<string, unknown>;
      const collected: unknown[] = [];
      for (const key of Object.keys(obj)) {
        if (key.startsWith(prefix) && key.length > prefix.length) {
          collected.push(obj[key]);
        }
      }
      return collected;
    } else {
      // 字段访问
      if (typeof current !== 'object') {
        return optional ? undefined : undefined;
      }
      current = (current as Record<string, unknown>)[token];
    }
  }

  return current;
}

/**
 * 将路径字符串分词为字段名与数组索引
 *
 * 例如：a.b[0].c → ['a', 'b', 0, 'c']
 *      events[0].id → ['events', 0, 'id']
 *      data[2][3] → ['data', 2, 3]
 */
function tokenizePath(pathStr: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let i = 0;
  const len = pathStr.length;

  while (i < len) {
    const ch = pathStr[i];

    if (ch === '.') {
      // 字段分隔符，跳过
      i++;
      continue;
    }

    if (ch === '[') {
      // 数组索引开始
      i++; // 跳过 [
      let numStr = '';
      while (i < len && pathStr[i] !== ']') {
        numStr += pathStr[i];
        i++;
      }
      if (i < len && pathStr[i] === ']') {
        i++; // 跳过 ]
      }
      const num = parseInt(numStr, 10);
      if (Number.isFinite(num)) {
        tokens.push(num);
      }
      continue;
    }

    // 字段名（直到遇到 . 或 [）
    let fieldName = '';
    while (i < len && pathStr[i] !== '.' && pathStr[i] !== '[') {
      fieldName += pathStr[i];
      i++;
    }
    if (fieldName.length > 0) {
      tokens.push(fieldName);
    }
  }

  return tokens;
}
