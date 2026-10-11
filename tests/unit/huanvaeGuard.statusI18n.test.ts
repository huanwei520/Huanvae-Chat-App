/**
 * VPN 页设备在线状态本地化（STATUS_LABELS / localizeStatus）定向测试 —— 块 d6y9q3za 修复轮 (testharness 层)
 *
 * 被测对象：src/huanvaeGuard/HuanvaeGuardPage.tsx 内的 STATUS_LABELS 映射与 localizeStatus 兜底函数
 * （修复 commit e2b7b80a，分支 fix/d6y9q3za-vpn-status-i18n）。
 *
 * 缺陷背景（DEF-1/DEF-2，来源 dojmqqbi-1 分诊单 tri-muq5vf84yer）：
 *   修复前 STATUS_LABELS 仅 online/offline/unknown 三条，服务端作证态 lost 与客户端声明态
 *   reconnecting 无条目 → `?? status` 把英文原文裸透传给用户。
 *
 * 契约真值源：/work/Huanvae-Chat-Rust/docs/hg-online-status-contract.md
 *   §1（行 14-17）客户端可声明三态 online/reconnecting/offline + 服务端作证态 lost；
 *   §1（行 19）完整 DB 值域 = 上述 4 值 + 服务端管理态 locked；
 *   §2（行 31）枚举外值整帧被拒 → 显示层契约内不可能收到第 6 种英文枚举；
 *   unknown 为客户端本机兜底键（d.status 为 null 时替换，见群组成员表渲染处）。
 *
 * 测法（与本仓既有静态契约测试同套路，见 tests/e2e-mode-routing.test.ts 头注）：
 *   测试运行时直接读取被测源文件，提取 STATUS_LABELS 字面量与 localizeStatus 函数体，
 *   以 new Function 在真实源文本上求值 —— 防止测试副本与源码漂移；另加源码级锚点断言
 *   锁定 fallback 形态与三处调用点全覆盖。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(__dirname, '..', '..', 'src', 'huanvaeGuard', 'HuanvaeGuardPage.tsx');
const PAGE = readFileSync(PAGE_PATH, 'utf-8');

/** 从源码提取 `const NAME = { ... };` 的对象字面量文本（纯 JS，无 TS 注解） */
function extractObjectLiteral(name: string): string {
  const re = new RegExp(`const ${name}[^=]*=\\s*(\\{[\\s\\S]*?\\n\\});`);
  const m = PAGE.match(re);
  if (!m) { throw new Error(`cannot extract const ${name} from ${PAGE_PATH}`); }
  return m[1];
}

/** 从源码提取 `function NAME(...)` 的完整函数体文本，并剥离 TS 类型注解使其可 eval */
function extractFunction(name: string): string {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`);
  const m = PAGE.match(re);
  if (!m) { throw new Error(`cannot extract function ${name} from ${PAGE_PATH}`); }
  return m[0].replace(/: string/g, '');
}

// 与被测源码同源求值：STATUS_LABELS / localizeStatus 都来自对真实源文本的提取
const STATUS_LABELS = new Function(`return ${extractObjectLiteral('STATUS_LABELS')};`)() as Record<
  string,
  string
>;
const localizeStatus = new Function(
  'STATUS_LABELS',
  `${extractFunction('localizeStatus')}\nreturn localizeStatus;`,
)(STATUS_LABELS) as (status: string) => string;

/** 契约 §1 完整 DB 值域（行 14-17 四值 + 行 19 locked）→ 必须显示的中文标签 */
const CONTRACT_LABELS: Array<[string, string]> = [
  ['online', '在线'],
  ['reconnecting', '重连中'],
  ['offline', '离线'],
  ['lost', '失联'],
  ['locked', '已锁定'],
];

describe('STATUS_LABELS —— 契约全值域逐态核对（DEF-1/DEF-2 回归锁）', () => {
  it('契约 §1 五值逐条映射中文（lost→失联、reconnecting→重连中 缺一即 FAIL）', () => {
    for (const [value, label] of CONTRACT_LABELS) {
      expect(STATUS_LABELS[value], `STATUS_LABELS[${value}]`).toBe(label);
    }
  });

  it('客户端本机兜底键 unknown → 未知', () => {
    expect(STATUS_LABELS['unknown']).toBe('未知');
  });

  it('键全集 = 契约 5 值 + unknown，共 6 条（多键/少键都不允许）', () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual(
      ['lost', 'locked', 'offline', 'online', 'reconnecting', 'unknown'].sort(),
    );
  });

  it('localizeStatus：契约全值域经函数返回中文（显示层三处调用都走它）', () => {
    for (const [value, label] of CONTRACT_LABELS) {
      expect(localizeStatus(value)).toBe(label);
    }
    expect(localizeStatus('unknown')).toBe('未知');
  });
});

describe('localizeStatus —— fallback 不透传英文原文（修复点回归锁）', () => {
  it('未知字符串一律中文兜底「未知状态」，绝不回显输入', () => {
    const unknownBattery = [
      '',
      '   ',
      'unrecognized',
      'connecting',
      'dead',
      'ONLINE',
      'Online',
      'LOST',
      'RECONNECTING',
      ' lost',
      'lost ',
      'lost\\n',
      'online\\r',
      'locked\\u00a0',
      '未知',
      'xyz',
      'unknown2',
      'hg_status_failed',
    ];
    for (const input of unknownBattery) {
      const out = localizeStatus(input);
      expect(out, `localizeStatus(${JSON.stringify(input)})`).toBe('未知状态');
      expect(out).not.toBe(input);
    }
  });

  it('源码锚点：fallback 必须是中文兜底字面量，禁止恢复 `?? status` 透传形态', () => {
    expect(PAGE).toMatch(/return STATUS_LABELS\[status\] \?\? '未知状态';/);
    expect(PAGE).not.toMatch(/STATUS_LABELS\[status\] \?\? status/);
  });
});

describe('localizeStatus —— 对抗与健壮性', () => {
  // 原型链键：Record 求值会命中 Object.prototype 继承成员。契约 §2 行 31：
  // 服务端对枚举外值整帧拒绝（DB 值域封闭，行 19），这些键在契约内不可达；
  // 且该行为类在基线 41c191bc（`?? status` 形态）完全相同 —— 非本修复引入。
  // 本组用例锁定（characterize）当前真实行为并验证「不透传英文原文」这一任务硬性要求；
  // 加固建议（hasOwnProperty 守卫 / Object.create(null)）留给后续产品卡，见块 testharness 交付。
  const PROTO_KEYS = [
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    'valueOf',
    'toLocaleString',
    'isPrototypeOf',
    'propertyIsEnumerable',
  ];

  it('对抗输入（含原型链键）输出永不等于输入原文（不透传英文）', () => {
    for (const key of PROTO_KEYS) {
      const out = localizeStatus(key);
      expect(out, `localizeStatus(${key}) 不得回显原文`).not.toBe(key);
    }
  });

  it('characterization：原型链键当前命中 Object.prototype 继承成员而非「未知状态」', () => {
    for (const key of PROTO_KEYS) {
      const out = localizeStatus(key) as unknown;
      expect(['function', 'object'], `${key} 当前返回继承成员`).toContain(typeof out);
    }
    // 锚定一个具体值，行为一旦变化（如未来加固）此断言会 FAIL 提示同步更新
    expect(typeof (localizeStatus('toString') as unknown)).toBe('function');
    expect(typeof (localizeStatus('__proto__') as unknown)).toBe('object');
  });

  it('null / undefined / 数字等畸形入参不抛异常且不回显', () => {
    const weird = [null, undefined, 0, 1, NaN, {}, ['online']] as unknown as string[];
    for (const input of weird) {
      const out = localizeStatus(input);
      expect(out !== input || (typeof out === 'string' && out === '未知状态')).toBe(true);
    }
    expect(localizeStatus(String(null))).toBe('未知状态');
    expect(localizeStatus(String(undefined))).toBe('未知状态');
  });
});

describe('localizeStatus —— 调用点覆盖（显示面无裸透传旁路）', () => {
  it('定义 1 处 + 调用 3 处，全集闭合（第 4 处出现即说明有新显示面未走本地化）', () => {
    const count = PAGE.split('localizeStatus').length - 1;
    expect(count).toBe(4); // 函数定义行 + :597 日志 + :1344 设备列表行 + :1652 群组成员表
  });

  it('三处调用点逐一定位在案（状态变更日志 / 设备列表行 / 群组成员表）', () => {
    expect(PAGE).toMatch(/localizeStatus\(event\.payload\.status\)/);
    expect(PAGE).toMatch(/\{localizeStatus\(statusKey\)\}/);
    expect(PAGE).toMatch(/localizeStatus\(d\.status \?\? 'unknown'\)/);
  });
});
