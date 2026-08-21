/**
 * JWT 工具函数
 *
 * 解码 JWT payload 提取过期时间，用于主动刷新机制：
 * 在 Token 过期前 5 分钟自动触发刷新，避免因 Token 过期导致请求失败。
 */

/**
 * 解码 JWT 的 **base64url** 段
 *
 * 🔴 不能直接用 `atob`：JWS 规范（RFC 7515 §2 / RFC 7519）规定 JWT 的三段一律是
 * **base64url**（`+`→`-`、`/`→`_`，且去掉 `=` 填充），而 `atob` 只认标准 base64 字母表，
 * 遇到 `-` / `_` 直接抛 `InvalidCharacterError`。
 *
 * 🔴 **不存在"我的 payload 不含某几个字节、所以 `atob` 安全"这回事** ——
 * 任何"触发字节集合 + 位置"式判据都不能拿来给自己开绿灯，理由就是下面这段机制。
 *
 * 机制（取样面：**三维穷举** —— b0 / b1 / b2 三个字节各自全扫，一个维度都没钉死；
 * 复算件是 tests/unit/jwt.test.ts 的 `findBase64TriggerUnits` + 那条中文昵称回归用例）：
 * base64 把每 3 个字节 (b0, b1, b2) 切成 **4 个** 6-bit 单元，单元值取到 62 / 63 即 `+` / `/`。
 * - **输入字节全落在 ASCII（0..127）时**：2^21 = 2097152 种组合里只有**第 4 个**单元
 *   可能取到 62/63（命中 65536 组），条件是 b2 ∈ {0x3E `>`、0x3F `?`、0x7E `~`、0x7F DEL}
 *   且该字节在 payload UTF-8 字节流里的下标 ≡ 2 (mod 3)。
 * - **只要出现一个非 ASCII 字节**（中文昵称的 UTF-8 续字节就是）：2^24 = 16777216 种组合里
 *   **四个单元全都能**取到 62/63（各命中 524288 组）⇒ 上面那组字节集合与位置条件**全部作废**。
 *   判决性实例：payload `{"sub":"u1","name":"技术部","exp":1893456000}` 产出的 `/` 来自
 *   **第 3 个**单元，决定它的两个字节是 0xAF（下标 25，25 % 3 = 1）与 0xE9（下标 26）——
 *   0xAF 既不在上面那 4 个值里、下标也不 ≡ 2 (mod 3)。
 *
 * 🔴 由此两条都成立，别只记住其中一条：
 * ① **不存在"英文昵称账号用 `atob` 一直是好的"这回事** —— 纯 ASCII payload 照样触发，
 *   带 query 的头像 URL 里的 `?` 正是触发字节之一，让它成为常态；
 * ② **含非 ASCII 时连"哪些字节会触发"都问不出来** —— 四个单元全在场，
 *   没有任何白名单式自查能替代"用 base64url 解码"。
 * 失效是被 `catch` 吞掉的，表现只是「主动刷新那条 effect 不注册」，没有任何报错。
 *
 * 填充不是问题：`atob` 用的是 WHATWG「forgiving-base64」，本身容忍缺失的 `=`；
 * 这里仍显式补齐，让输入形状与标准 base64 完全一致，不依赖那份宽容。
 */
function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return atob(normalized + padding);
}

/**
 * 从 JWT Token 中提取过期时间戳
 *
 * @param token - JWT access_token（格式：header.payload.signature）
 * @returns 过期时间的毫秒级时间戳，解析失败返回 null
 */
export function getTokenExpiresAt(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) { return null; }

    const payload = JSON.parse(decodeBase64Url(parts[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * 计算 Token 距离过期还剩多少毫秒
 *
 * @param token - JWT access_token
 * @returns 剩余毫秒数，已过期返回 0，解析失败返回 null
 */
export function getTokenRemainingMs(token: string): number | null {
  const expiresAt = getTokenExpiresAt(token);
  if (expiresAt === null) { return null; }
  return Math.max(0, expiresAt - Date.now());
}
