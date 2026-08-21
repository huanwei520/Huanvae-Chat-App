/**
 * JWT 工具函数单元测试
 *
 * 测试 src/utils/jwt.ts 中的 getTokenExpiresAt / getTokenRemainingMs
 *
 * 包含测试：
 * - 有效 JWT：正确提取 exp 并转为毫秒级时间戳
 * - 无 exp 字段：返回 null
 * - 格式无效：不足 3 段、非 base64、非 JSON 均返回 null
 * - 空字符串：返回 null
 * - getTokenRemainingMs：未过期返回正数，已过期返回 0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getTokenExpiresAt, getTokenRemainingMs } from '../../src/utils/jwt';

/**
 * 构造一个模拟 JWT（仅含 payload，header/signature 为占位）
 *
 * ⚠️ 用的是 **base64url**（RFC 7515 §2 规定 JWT 三段都是它），不是 `btoa` 的标准 base64。
 * 旧版本这里直接 `btoa(...)`，且旧注释断言"纯 ASCII payload 几乎不会产出 `+`/`/`、
 * 英文昵称账号用 `atob` 一直是好的" —— **该断言已被推翻**：
 * **纯 ASCII 输入下**，`+`/`/` 的触发字节是 `>` 0x3E、`?` 0x3F、`~` 0x7E、DEL 0x7F 四个，
 * 落在 payload 字节流下标 ≡ 2 (mod 3) 的位置就会命中。
 *
 * 🔴 但**那组条件只在纯 ASCII 这一档成立**，别把它当成通用判据：
 * 输入里只要出现一个非 ASCII 字节，四个 6-bit 单元就**全都**可能取到 62/63，
 * 字节集合与位置条件同时作废。下面 `base64 触发面（机制注释的机器复算件）` 那一组
 * 用**三维穷举**（b0/b1/b2 全扫）把两档的数字钉住，
 * 并用一条真实中文昵称反例钉住"通用判据不存在"这个结论 ——
 * 谁把 src/utils/jwt.ts 的注释改回"触发字节恰好是那 8 个值"，那条用例就会红。
 *
 * 所以上面那批"普通"用例覆盖不到的**不是**"中文昵称那一半"，而是
 * **任何含 `?` / `~` / `>` 且位置对齐的 payload（含纯 ASCII）**。
 * 下面 `base64url` 专项那组补的就是这一片，其中「纯 ASCII 含 `?`」那条是本条结论的回归钉子。
 */
function toBase64Url(text: string): string {
  // 先按 UTF-8 编码再 base64：btoa 只吃 latin1，中文直接喂会抛 InvalidCharacterError。
  const utf8 = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of utf8) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64 每 3 字节分组 (b0, b1, b2) 切出的 4 个 6-bit 单元，各自由哪些字节决定。
 * u0←b0 · u1←b0,b1 · u2←b1,b2 · u3←b2 —— 中间两个单元**跨字节**，
 * 这正是"只看某一个字节的取值"式判据必然漏掉它们的原因。
 */
const BASE64_UNIT_DECIDED_BY: readonly (readonly number[])[] = [[0], [0, 1], [1, 2], [2]];

/** 一个 6-bit 单元取到 62/63 就产出 `+` / `/`（base64url 里是 `-` / `_`）。 */
const BASE64_TRIGGER_MIN_UNIT_VALUE = 62;

/**
 * 定位一段字节流里**所有**产出 `+` / `/` 的 6-bit 单元，并给出决定它的字节及下标。
 *
 * 取样面声明：本函数**不固定任何维度** —— 四个单元位置全查，
 * 跨字节单元的两个决定字节都报出来。src/utils/jwt.ts 的机制注释引用的就是它。
 */
function findBase64TriggerUnits(bytes: Uint8Array): Array<{
  group: number;
  unitIndex: number;
  decidingBytes: Array<{ index: number; byte: number }>;
}> {
  const hits: Array<{
    group: number;
    unitIndex: number;
    decidingBytes: Array<{ index: number; byte: number }>;
  }> = [];

  for (let g = 0; g < bytes.length; g += 3) {
    const groupLen = Math.min(3, bytes.length - g);
    const b0 = bytes[g];
    const b1 = groupLen > 1 ? bytes[g + 1] : 0;
    const b2 = groupLen > 2 ? bytes[g + 2] : 0;
    const units = [
      b0 >> 2,
      ((b0 & 0x03) << 4) | (b1 >> 4),
      ((b1 & 0x0f) << 2) | (b2 >> 6),
      b2 & 0x3f,
    ];

    // 不足 3 字节的尾组只产出 groupLen + 1 个单元，多出来的是填充位、不落进输出字符。
    for (let i = 0; i < groupLen + 1; i += 1) {
      if (units[i] >= BASE64_TRIGGER_MIN_UNIT_VALUE) {
        hits.push({
          group: g,
          unitIndex: i,
          decidingBytes: BASE64_UNIT_DECIDED_BY[i].map((k) => ({
            index: g + k,
            byte: bytes[g + k],
          })),
        });
      }
    }
  }

  return hits;
}

/**
 * 三维穷举：b0 / b1 / b2 各自扫遍 `0..maxByte`，统计四个单元位置各有多少组合能取到 62/63。
 *
 * 取样面声明：**三个维度都扫，一个都不钉死**。
 * 每个单元只依赖 1–2 个字节，所以按依赖字节枚举、剩下那些维度乘 `n` 即可，
 * 与朴素三重循环等价但只需 O(n²) 次迭代（`maxByte = 255` 时 65536 次）。
 */
function countBase64UnitHits(maxByte: number): [number, number, number, number] {
  const n = maxByte + 1;
  const hits: [number, number, number, number] = [0, 0, 0, 0];

  for (let b0 = 0; b0 < n; b0 += 1) {
    if (b0 >> 2 >= BASE64_TRIGGER_MIN_UNIT_VALUE) {
      hits[0] += n * n; // b1 / b2 任意
    }
    for (let b1 = 0; b1 < n; b1 += 1) {
      if ((((b0 & 0x03) << 4) | (b1 >> 4)) >= BASE64_TRIGGER_MIN_UNIT_VALUE) {
        hits[1] += n; // b2 任意
      }
    }
  }

  for (let b1 = 0; b1 < n; b1 += 1) {
    for (let b2 = 0; b2 < n; b2 += 1) {
      if ((((b1 & 0x0f) << 2) | (b2 >> 6)) >= BASE64_TRIGGER_MIN_UNIT_VALUE) {
        hits[2] += n; // b0 任意
      }
    }
  }

  for (let b2 = 0; b2 < n; b2 += 1) {
    if ((b2 & 0x3f) >= BASE64_TRIGGER_MIN_UNIT_VALUE) {
      hits[3] += n * n; // b0 / b1 任意
    }
  }

  return hits;
}

function createMockJwt(payload: Record<string, unknown>): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = toBase64Url(JSON.stringify(payload));
  const signature = 'mock-signature';
  return `${header}.${body}.${signature}`;
}

describe('JWT 工具函数 (utils/jwt)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // getTokenExpiresAt
  // ============================================

  describe('getTokenExpiresAt', () => {
    it('应从有效 JWT 中提取 exp 并返回毫秒级时间戳', () => {
      const expSeconds = 1700000000;
      const token = createMockJwt({ exp: expSeconds, sub: 'user-1' });

      expect(getTokenExpiresAt(token)).toBe(expSeconds * 1000);
    });

    it('exp 为 0 时应返回 0（作为有效时间戳）', () => {
      const token = createMockJwt({ exp: 0 });
      expect(getTokenExpiresAt(token)).toBe(0);
    });

    it('无 exp 字段应返回 null', () => {
      const token = createMockJwt({ sub: 'user-1', iat: 1700000000 });
      expect(getTokenExpiresAt(token)).toBeNull();
    });

    it('exp 为字符串应返回 null', () => {
      const token = createMockJwt({ exp: '1700000000' });
      expect(getTokenExpiresAt(token)).toBeNull();
    });

    it('格式不足 3 段应返回 null', () => {
      expect(getTokenExpiresAt('only-two.parts')).toBeNull();
      expect(getTokenExpiresAt('single')).toBeNull();
    });

    it('payload 非有效 base64 应返回 null', () => {
      expect(getTokenExpiresAt('header.!!!invalid!!!.signature')).toBeNull();
    });

    it('payload 非有效 JSON 应返回 null', () => {
      const notJson = btoa('this is not json');
      expect(getTokenExpiresAt(`header.${notJson}.signature`)).toBeNull();
    });

    it('空字符串应返回 null', () => {
      expect(getTokenExpiresAt('')).toBeNull();
    });
  });

  // ============================================
  // base64url 专项（回归：旧实现直接 atob，遇到 -/_ 必抛 → exp 被 catch 吞成 null）
  // ============================================

  describe('base64url payload（含 - / _）', () => {
    /**
     * 判据先自证有效：样本必须**真的**含 `-` 或 `_`，
     * 否则这条用例在旧实现下也会绿（等于没测）。
     */
    it('payload 含 base64url 专属字符时仍能解出 exp', () => {
      const expSeconds = 1700000000;
      // 中文昵称 ⇒ payload 出现非 ASCII 字节 ⇒ base64 里才可能出现 +//，
      // 转成 base64url 后就是 -/_。
      const token = createMockJwt({ exp: expSeconds, nickname: '测试用户abc', sub: 'u-1' });
      const payloadSegment = token.split('.')[1];

      expect(payloadSegment).toMatch(/[-_]/);
      // 负对照：同一段喂给 atob（旧实现那一步）必抛 —— 证明本用例守的是真失效。
      expect(() => atob(payloadSegment)).toThrow();

      expect(getTokenExpiresAt(token)).toBe(expSeconds * 1000);
    });

    /**
     * 🔴 回归钉子：**纯 ASCII** payload 一样会把 `atob` 打挂。
     *
     * 这条钉的是一句被实测推翻的旧论断（"纯 ASCII 几乎不可能命中 / 英文昵称账号一直是好的"）。
     * 触发字节 `?` (0x3F) 是 ASCII；**在纯 ASCII 这一档**，能否命中还取决于
     * 它在 payload 字节流里的下标 ≡ 2 (mod 3)（含非 ASCII 时这个条件不成立，见下一组），
     * 所以这里扫 3 个连续偏移，结构上必然覆盖到对齐的那一个。
     * 谁要是把注释改回"英文昵称一直是好的"，这条用例仍然会站在这里打脸。
     */
    it('纯 ASCII 且含 ? 的 payload 同样会打挂 atob，新实现必须解得出', () => {
      const expSeconds = 1700000000;
      let alignedCount = 0;

      for (let pad = 0; pad < 3; pad += 1) {
        const payload = {
          exp: expSeconds,
          avatar: `https://cdn.example.com/${'a'.repeat(pad)}.png?v=1`,
        };
        const json = JSON.stringify(payload);

        // 判据自证 ①：样本必须是**纯可打印 ASCII** —— 否则测的是"中文昵称那一半"，
        // 证不了"纯 ASCII 也会中"这个结论。
        expect(json).not.toMatch(/[^\x20-\x7E]/);

        const token = createMockJwt(payload);
        const payloadSegment = token.split('.')[1];

        // 不管对齐与否，新实现都必须解得出 exp。
        expect(getTokenExpiresAt(token)).toBe(expSeconds * 1000);

        if (/[-_]/.test(payloadSegment)) {
          alignedCount += 1;
          // 判据自证 ②：同一段喂给旧写法（atob）必抛 —— 证明守的是真失效，不是恒真断言。
          expect(() => atob(payloadSegment)).toThrow();
        }
      }

      // 判据自证 ③：3 个连续偏移里至少命中 1 个（下标 ≡ 2 mod 3 必被覆盖）。
      // 为 0 说明构造压根没触发，那这条用例就是假绿 —— 直接红。
      expect(alignedCount).toBeGreaterThan(0);
    });

    /**
     * 逐个长度扫一遍，覆盖 `length % 4` 的全部余数（缺 `=` 填充的三种形态）。
     * 每个样本都断言 exp 解得出来，任何一个填充分支写错都会红。
     */
    it('各种长度（缺省填充的三种余数）都能解出 exp', () => {
      const expSeconds = 1712345678;
      for (let padLen = 0; padLen < 8; padLen += 1) {
        const token = createMockJwt({ exp: expSeconds, pad: 'x'.repeat(padLen) });
        expect(getTokenExpiresAt(token)).toBe(expSeconds * 1000);
      }
    });
  });

  // ============================================
  // base64 触发面（src/utils/jwt.ts 机制注释的机器复算件）
  //
  // 🔴 这一组存在的唯一理由：那段注释此前写着"触发字节集合**恰好是** b2 属于
  // {0x3E,0x3F,0x7E,0x7F,0xBE,0xBF,0xFE,0xFF} 这 8 个值 + 下标 ≡ 2 (mod 3)"，
  // 并挂着【实测】标签 —— 而它的实测是**一维**的（b0/b1 被钉死只扫 b2）。
  // 按那句话推理的人会得出"我的 payload 里没有那 8 个字节 ⇒ atob 安全"，
  // 而下面第三条用例就是它的判决性反例。谁把那句话写回去，这一组会红。
  // ============================================

  describe('base64 触发面（机制注释的机器复算件）', () => {
    it('纯 ASCII 输入：三维穷举下只有第 4 个 6-bit 单元能产出 + 或 /', () => {
      // 取样面：b0/b1/b2 三个维度各扫 0..127，共 2^21 = 2097152 种组合，一个维度都没钉死。
      const hits = countBase64UnitHits(127);

      // 前三个单元结构上够不着 62/63：u0 需要 b0 ≥ 0xF8、u1 需要 b1 ≥ 0xE0、u2 需要 b2 ≥ 0x80，
      // 三个门槛全在 ASCII 之外。
      expect(hits[0]).toBe(0);
      expect(hits[1]).toBe(0);
      expect(hits[2]).toBe(0);
      // u3 = b2 & 0x3F ∈ {62,63} ⇔ b2 ∈ {0x3E,0x3F,0x7E,0x7F}（4 个值 × 128 b0 × 128 b1）。
      expect(hits[3]).toBe(4 * 128 * 128);
    });

    it('全字节输入：三维穷举下四个 6-bit 单元全都能产出 + 或 /', () => {
      // 取样面：b0/b1/b2 三个维度各扫 0..255，共 2^24 = 16777216 种组合。
      const hits = countBase64UnitHits(255);

      // 🔴 与上一条形状不同（0,0,0,65536 → 524288 ×4）⇒ 判据有区分力，
      // 不是"怎么扫都得同一个数"的恒真断言。
      expect(hits).toEqual([524288, 524288, 524288, 524288]);
    });

    it('中文昵称反例：触发点落在第 3 个单元，旧注释那套"8 值 + 下标≡2(mod3)"三条断言全不成立', () => {
      const expSeconds = 1893456000;
      const payload = { sub: 'u1', name: '技术部', exp: expSeconds };
      const json = JSON.stringify(payload);

      // 判据自证 ①：样本得是真的含非 ASCII，否则测的是另一档。
      expect(json).toMatch(/[^\x20-\x7E]/);

      const bytes = new TextEncoder().encode(json);
      const hits = findBase64TriggerUnits(bytes);

      // 判据自证 ②：这个样本必须**真的**触发，否则下面三条"不成立"是空断言。
      expect(hits.length).toBeGreaterThan(0);

      const OLD_TRIGGER_SET = [0x3e, 0x3f, 0x7e, 0x7f, 0xbe, 0xbf, 0xfe, 0xff];
      const onlyLastUnit = hits.every((h) => h.unitIndex === 3);
      const allBytesInOldSet = hits.every((h) =>
        h.decidingBytes.every((d) => OLD_TRIGGER_SET.includes(d.byte)),
      );
      const allIndexMod3Is2 = hits.every((h) =>
        h.decidingBytes.every((d) => d.index % 3 === 2),
      );

      // 旧注释断言 ①「只有每 3 字节分组的最后一个 6-bit 单元可能取到 62/63」
      expect(onlyLastUnit).toBe(false);
      // 旧注释断言 ②「触发字节集合恰好是那 8 个值」
      expect(allBytesInOldSet).toBe(false);
      // 旧注释断言 ③「下标必须 ≡ 2 (mod 3)」
      expect(allIndexMod3Is2).toBe(false);

      // 钉住具体位置，免得将来"三条都 false"是因为别的原因偶然成立：
      // 触发的是第 3 个单元（unitIndex = 2），决定它的是 0xAF(下标 25) 与 0xE9(下标 26)。
      expect(hits).toEqual([
        {
          group: 24,
          unitIndex: 2,
          decidingBytes: [
            { index: 25, byte: 0xaf },
            { index: 26, byte: 0xe9 },
          ],
        },
      ]);

      // 端到端：旧写法（atob）必抛，新写法必须解得出 exp。
      const token = createMockJwt(payload);
      const payloadSegment = token.split('.')[1];
      expect(payloadSegment).toMatch(/[-_]/);
      expect(() => atob(payloadSegment)).toThrow();
      expect(getTokenExpiresAt(token)).toBe(expSeconds * 1000);
    });
  });

  // ============================================
  // getTokenRemainingMs
  // ============================================

  describe('getTokenRemainingMs', () => {
    it('Token 未过期时应返回正数', () => {
      const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 小时后
      const token = createMockJwt({ exp: futureExp });

      const remaining = getTokenRemainingMs(token);
      expect(remaining).not.toBeNull();
      expect(remaining!).toBeGreaterThan(0);
      expect(remaining!).toBeLessThanOrEqual(3600 * 1000);
    });

    it('Token 已过期应返回 0', () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 小时前
      const token = createMockJwt({ exp: pastExp });

      expect(getTokenRemainingMs(token)).toBe(0);
    });

    it('无效 Token 应返回 null', () => {
      expect(getTokenRemainingMs('invalid')).toBeNull();
    });

    it('剩余时间精度在合理范围内（±2 秒）', () => {
      const secondsFromNow = 600; // 10 分钟后
      const futureExp = Math.floor(Date.now() / 1000) + secondsFromNow;
      const token = createMockJwt({ exp: futureExp });

      const remaining = getTokenRemainingMs(token)!;
      const expectedMs = secondsFromNow * 1000;

      expect(Math.abs(remaining - expectedMs)).toBeLessThan(2000);
    });
  });
});
