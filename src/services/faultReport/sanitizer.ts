/**
 * 故障日志脱敏器（写入前强制执行 —— 红线：token/密码/密钥/鉴权头一律按模式脱敏后才可入日志）
 *
 * 模式覆盖（与服务器端/单测三方对齐）：
 * - `Bearer <token>` 鉴权载荷
 * - `authorization: ...` / `Authorization: ...` 头整行
 * - `token=` / `access_token=` / `refresh_token=` / `password=` / `passwd=` / `pwd=` /
 *   `secret=` / `api_key=` / `apikey=` 等键值对（URL query、表单、日志键值通用）
 * - JSON 同名字段："token": "..." / {'password': '...'} 等（双引号/单引号兼容）
 * - 长十六进制串（≥32 位，常见为裸 token/哈希泄露形态）整体替换
 *
 * 【聊天正文零采集】按构造实现：采集面只有 console / 未捕获异常 / 网络错误摘要(URL+状态码) /
 * Rust log / 设备元数据，不存在任何聊天消息读取路径（见 capture.ts —— 不挂接消息存储/渲染层）。
 *
 * 所有替换使用固定占位符，保留键名便于后台定位问题上下文。
 *
 * @module services/faultReport/sanitizer
 */

/** 固定占位符 */
export const REDACTED = '[REDACTED]';

/** 聊天载体对象丢弃占位符（零采集红线：不序列化其任何字段） */
export const CHAT_CARRIER_REDACTED = '[聊天对象已按零采集红线丢弃]';

/** 会话特征键：与 content 同现即判为消息/会话载体对象 */
const CHAT_CONTEXT_KEYS = [
  'conversationid', 'messageid', 'senderid', 'receiverid', 'chatid', 'sessionid', 'peerid',
];

/**
 * 判定一个值是否为「聊天正文载体对象」（零采集红线专用，写入前第一道丢弃）。
 *
 * 判据（机械可验）：深度 ≤2 的对象/数组元素，同时满足：
 * - 含 string 型 `content` 键（聊天正文的统一承载键）；且
 * - 含任一会话特征键（会话/消息/发送者 ID 族）。
 *
 * 命中即整体丢弃（不序列化任何字段），防 console/异常参数把聊天调试输出带入故障日志。
 * 刻意保守：正常日志对象（如 {level:'info', msg:'ok'}）不含 content 键，不会命中。
 */
export function isChatCarrierObject(value: unknown, depth = 0): boolean {
  if (depth > 2 || value === null || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  const hasContent = typeof obj['content'] === 'string';
  const keys = Object.keys(obj).map((k) => k.toLowerCase().replace(/[\s_-]/g, ''));
  if (hasContent && keys.some((k) => CHAT_CONTEXT_KEYS.includes(k))) {
    return true;
  }
  // 数组与单层嵌套属性继续扫（如 { data: {...message} } / { messages: [...] }）
  for (const child of Object.values(obj)) {
    if (child === null || typeof child !== 'object') {
      continue;
    }
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isChatCarrierObject(item, depth + 1)) {
          return true;
        }
      }
    } else if (isChatCarrierObject(child, depth + 1)) {
      return true;
    }
  }
  return false;
}

/**
 * 键值对形态：key=xxx / key: xxx / key= "xxx"（值到空白、引号、&、; 、逗号、} 为止）。
 * 键名集合覆盖 token/密码/密钥/鉴权族及其常见别名。
 */
const KEY_VALUE_PATTERN =
  /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|sessionid|cookie)\s*(?:=|:)\s*)(?:"([^"]*)"|'([^']*)'|([^\s&;",}]+))/gi;

/** JSON 同名字段（双引号键）：值整体替换，保留键名。content 族为聊天正文零采集兜底（见 isChatCarrierObject） */
const JSON_FIELD_PATTERN =
  /("(?:(?:access|refresh|id|auth)[_-]?token|token|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|session[_-]?id|sessionid|cookie|authorization|msg[_-]?content|message[_-]?content|chat[_-]?content|content)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

/** Authorization 头整行（http 头/日志行形态） */
const AUTH_HEADER_PATTERN = /^([ \t]*authorization[ \t]*:[ \t]*).+$/gim;

/** Bearer 载荷 */
const BEARER_PATTERN = /(\bBearer\s+)\S+/gi;

/** 裸长十六进制串（≥32 位）：JWT 签名段/裸哈希 token 泄露形态 */
const LONG_HEX_PATTERN = /\b[0-9a-fA-F]{32,}\b/g;

/** 判定一个键名是否属于脱敏键集合（供 JSON 单引号形态与动态字段判断使用） */
function isSensitiveKeyName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[\s_-]/g, '');
  return [
    'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'token',
    'password', 'passwd', 'pwd', 'secret', 'clientsecret',
    'apikey', 'accesskey', 'privatekey', 'sessionid', 'cookie', 'authorization',
  ].includes(normalized);
}

/**
 * URL 专项脱敏（网络错误摘要写入前强制执行）。
 *
 * URL query 常见携带 token/签名/会话等敏感值，且键名无法穷举，
 * 故按「query 值一律不可信」处理：
 * - 所有 query 参数值统一替换为固定占位符（键名保留，便于后台定位问题上下文）；
 * - hash 片段整体剥除（SPA 路由可能在 hash 中携带鉴权态）；
 * - 非 URL 形态（相对路径/解析失败）：有 `?` 时同样剥除 query 值；随后整串再过通用文本脱敏兜底。
 *
 * 幂等：已脱敏 URL 再次处理结果不变（占位符不含敏感形态）。
 */
export function sanitizeUrlForFaultLog(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }
  let hashStripped = input;
  const hashIndex = hashStripped.indexOf('#');
  if (hashIndex >= 0) {
    hashStripped = hashStripped.slice(0, hashIndex);
  }
  try {
    const parsed = new URL(hashStripped);
    for (const key of Array.from(parsed.searchParams.keys())) {
      parsed.searchParams.set(key, REDACTED);
    }
    return sanitizeForFaultLog(parsed.toString());
  } catch {
    const qIndex = hashStripped.indexOf('?');
    if (qIndex >= 0) {
      const query = hashStripped.slice(qIndex + 1);
      const redactedQuery = query
        .split('&')
        .map((pair) => (pair.includes('=') ? `${pair.slice(0, pair.indexOf('=') + 1)}${REDACTED}` : pair))
        .join('&');
      return sanitizeForFaultLog(`${hashStripped.slice(0, qIndex)}?${redactedQuery}`);
    }
    return sanitizeForFaultLog(hashStripped);
  }
}

/**
 * 对单条日志文本做脱敏。幂等：对已脱敏文本再次执行结果不变（占位符不含敏感形态）。
 */
export function sanitizeForFaultLog(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }

  let out = input;

  // 1) JSON 双引号同名字段（先于键值对，避免已被 KV 规则改写出中间态）
  out = out.replace(JSON_FIELD_PATTERN, (_m, keyPart: string) => `${keyPart}"${REDACTED}"`);

  // 2) 键值对（= 与 : 形态；双/单引号/裸值；正则保证三选一必有一个值捕获，统一替换）
  out = out.replace(KEY_VALUE_PATTERN, (_match, keyPart: string) => `${keyPart}${REDACTED}`);

  // 3) Authorization 头整行
  out = out.replace(AUTH_HEADER_PATTERN, (_m, keyPart: string) => `${keyPart}${REDACTED}`);

  // 4) Bearer 载荷
  out = out.replace(BEARER_PATTERN, (_m, keyPart: string) => `${keyPart}${REDACTED}`);

  // 5) JSON 单引号同名字段（{'token': 'xxx'} 形态）
  out = out.replace(/('[^']{2,40}'\s*:\s*')([^']*)(')/g, (match, keyPart: string, value: string, tail: string) => {
    const keyNameMatch = /^'([^']+)'/.exec(keyPart);
    if (keyNameMatch && isSensitiveKeyName(keyNameMatch[1]) && value !== REDACTED) {
      return `${keyPart}${REDACTED}${tail}`;
    }
    return match;
  });

  // 6) 裸长十六进制串（放最后，避免把前面占位符形态误伤 —— 占位符无长 hex）
  out = out.replace(LONG_HEX_PATTERN, REDACTED);

  return out;
}

/**
 * 对任意 console 参数做安全字符串化 + 脱敏。
 * - Error: 取 name/message/stack（stack 同样过脱敏）
 * - 对象: 尝试 JSON.stringify（失败降级 String()），字符串化结果过脱敏
 */
export function stringifyAndSanitize(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = value.stack ? `${value.name}: ${value.message}\n${value.stack}` : `${value.name}: ${value.message}`;
  } else if (typeof value === 'string') {
    text = value;
  } else {
    // 零采集红线第一道：消息/会话载体对象整体丢弃，不序列化任何字段
    if (isChatCarrierObject(value)) {
      return CHAT_CARRIER_REDACTED;
    }
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  // 第二道兜底：字符串化后 content 族 JSON 键值剥除（防载体对象形态变体漏网）
  return sanitizeForFaultLog(text);
}
