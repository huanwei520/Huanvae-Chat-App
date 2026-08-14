/**
 * senderNameColor —— 群聊昵称配色索引的纯逻辑 + 与 CSS token 的对齐契约
 *
 * 被测对象是 src/chat/shared/senderNameColor.ts。两类断言：
 *   1. 纯函数性质：同一 id 恒同色、取值落在 [0, N)、空值不抛错、只看 id 不看昵称
 *   2. 跨文件契约：SENDER_NAME_COLOR_COUNT 必须与 CSS 里真正定义了几个色 token 一致 ——
 *      少一个就会有发送者拿到未定义的 token（回退成继承色 = 看着像没上色），
 *      而这种缺陷在 vitest 里没有任何运行时表现（jsdom 不算 CSS 变量），只能静态扫。
 *
 * 静态扫用 __dirname（vitest 下 import.meta.url 不是 file: scheme，见 frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { senderNameColorIndex, SENDER_NAME_COLOR_COUNT } from '../../src/chat/shared/senderNameColor';

const CSS_PATH = resolve(__dirname, '../../src/styles/components/chat-bubble-meta.css');
const CSS = readFileSync(CSS_PATH, 'utf-8');

describe('senderNameColorIndex（昵称配色索引）', () => {
  it('同一个 id 恒得同一个索引（改名/重渲染都不该变色）', () => {
    for (const id of ['user-2', 'u', '张三', 'a-very-long-uuid-0123456789abcdef']) {
      expect(senderNameColorIndex(id)).toBe(senderNameColorIndex(id));
    }
  });

  it('取值一律落在 [0, SENDER_NAME_COLOR_COUNT) 内', () => {
    for (let i = 0; i < 200; i += 1) {
      const idx = senderNameColorIndex(`user-${i}`);
      expect(Number.isInteger(idx)).toBe(true);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(SENDER_NAME_COLOR_COUNT);
    }
  });

  it('确实会分色：200 个 id 至少落到 2 个以上的索引（否则这条判据没有区分力）', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i += 1) {
      seen.add(senderNameColorIndex(`user-${i}`));
    }
    // 正对照：既然要"不同人不同色"，就不能全落一个桶
    expect(seen.size).toBeGreaterThan(1);
    // 每个色号都用得上（200 个样本还覆盖不全 7 个桶就说明散列坏了）
    expect(seen.size).toBe(SENDER_NAME_COLOR_COUNT);
  });

  it('空 id / null / undefined → 落 0，不抛错', () => {
    expect(senderNameColorIndex('')).toBe(0);
    expect(senderNameColorIndex(null)).toBe(0);
    expect(senderNameColorIndex(undefined)).toBe(0);
  });
});

describe('昵称配色：TS 常量与 CSS token 的对齐契约', () => {
  /**
   * 取出某个选择器**那一个规则块**的正文（到第一个右花括号为止）。
   *
   * 🔴 必须按块取，不能全文扫：浅色与深色是**两份独立的**声明，全文取并集时
   * 「浅色少定义了一个色号」会被深色那份补上 ⇒ 判据静默失效（本次实测过：
   * 删掉浅色的 6 号，全文并集版 8/8 仍全绿）。
   */
  function blockBody(css: string, selectorRe: RegExp): string {
    const m = css.match(selectorRe);
    expect(m).not.toBeNull();
    return m![1];
  }

  /** 某段 CSS 里真正**定义**了的色号（`--sender-name-N:` 形式；`var(--sender-name-N)` 的使用处不算） */
  function definedHues(css: string): Set<number> {
    const hues = new Set<number>();
    for (const m of css.matchAll(/--sender-name-(\d+)\s*:/g)) {
      hues.add(Number(m[1]));
    }
    return hues;
  }

  const LIGHT_BLOCK = /\n:root\s*\{([^}]*)\}/;
  const DARK_BLOCK = /\n\[data-theme='dark'\]\s*\{([^}]*)\}/;

  it('浅色（:root）那份：定义的色号连续覆盖 0..N-1，个数 == SENDER_NAME_COLOR_COUNT', () => {
    const hues = definedHues(blockBody(CSS, LIGHT_BLOCK));
    // 正对照：真的扫到了东西（扫不到时下面几条会以 0 恒等 0 的形式假绿）
    expect(hues.size).toBeGreaterThan(0);
    expect(hues.size).toBe(SENDER_NAME_COLOR_COUNT);
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      expect(hues.has(i)).toBe(true);
    }
  });

  it('深色主题那份：同样连续覆盖 0..N-1（浅色那套在深底上会糊，缺一个就回退成浅色值）', () => {
    const hues = definedHues(blockBody(CSS, DARK_BLOCK));
    expect(hues.size).toBeGreaterThan(0);
    expect(hues.size).toBe(SENDER_NAME_COLOR_COUNT);
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      expect(hues.has(i)).toBe(true);
    }
  });

  it('深色值与浅色值逐个不同（照抄一份等于没做深色适配）', () => {
    const light = blockBody(CSS, LIGHT_BLOCK);
    const dark = blockBody(CSS, DARK_BLOCK);
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      const re = new RegExp(`--sender-name-${i}\\s*:\\s*([^;]+);`);
      const l = light.match(re)?.[1]?.trim();
      const d = dark.match(re)?.[1]?.trim();
      expect(l).toBeTruthy();
      expect(d).toBeTruthy();
      expect(d).not.toBe(l);
    }
  });

  it('每个色号都有一条把它接到 data-sender-hue 上的规则', () => {
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      const rule = new RegExp(
        `\\.bubble-sender-name\\[data-sender-hue='${i}'\\][^{]*\\{[^}]*var\\(--sender-name-${i}\\)`,
      );
      expect(CSS).toMatch(rule);
    }
  });
});

/**
 * 「深底上可读」的那套色只许有**一份**定义（`--sender-name-on-dark-N`）。
 *
 * 它有两个消费方，而两者从来没有任何东西检查它们是否一致：
 *   1. 深色主题：`[data-theme='dark']` 把 `--sender-name-N` 重绑到它；
 *   2. 无配文媒体的昵称药丸（`.media-bubble-bare > .bubble-sender-name`）——
 *      那是**两个主题下都是深色**的半透明小胶囊，所以它不能读 `--sender-name-N`
 *      （浅色主题下那是浅底用的色，压在深胶囊上看不清）。
 *
 * 昵称移进气泡那一版（2026-08-14 12:16）把第 2 个消费方写成了**七个字面 hex**，
 * 与深色主题那七个逐字相同 ⇒ 两份真值源、无人复查：改深色主题的色，药丸不跟，
 * 而且没有任何测试会红。本组断言把它钉成一份。
 */
describe('昵称配色：深底色只有一份真值源（--sender-name-on-dark-N）', () => {
  /** `:root` 那一块的正文（与上面同一套按块取法，理由见 blockBody 的注释） */
  const ROOT_BLOCK = /\n:root\s*\{([^}]*)\}/;
  const DARK_THEME_BLOCK = /\n\[data-theme='dark'\]\s*\{([^}]*)\}/;

  function block(re: RegExp): string {
    const m = CSS.match(re);
    expect(m).not.toBeNull();
    return m![1];
  }

  it(':root 里定义了 0..N-1 全套 on-dark 色值，且都是字面色值（不是再指向别处）', () => {
    const root = block(ROOT_BLOCK);
    // 正对照：真的扫到了东西
    expect(root.length).toBeGreaterThan(0);
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      const m = root.match(new RegExp(`--sender-name-on-dark-${i}\\s*:\\s*([^;]+);`));
      expect(m, `:root 缺 --sender-name-on-dark-${i}`).not.toBeNull();
      expect(m![1].trim()).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('深色主题把 --sender-name-N 逐个重绑到 on-dark 那份，不再自己写 hex', () => {
    const dark = block(DARK_THEME_BLOCK);
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      const m = dark.match(new RegExp(`--sender-name-${i}\\s*:\\s*([^;]+);`));
      expect(m, `深色主题缺 --sender-name-${i}`).not.toBeNull();
      expect(m![1].trim()).toBe(`var(--sender-name-on-dark-${i})`);
    }
    // 反向断言：整块里一个字面 hex 都不许剩（剩一个就是第二份真值源）
    expect(dark).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('药丸（.media-bubble-bare 内）每个色号都走 on-dark token，且不含任何字面 hex', () => {
    for (let i = 0; i < SENDER_NAME_COLOR_COUNT; i += 1) {
      const ruleRe = new RegExp(
        `\\.media-bubble-bare\\s*>\\s*\\.bubble-sender-name\\[data-sender-hue='${i}'\\]\\s*\\{([^}]*)\\}`,
      );
      const m = CSS.match(ruleRe);
      expect(m, `药丸缺 data-sender-hue='${i}' 的规则`).not.toBeNull();
      const body = m![1];
      expect(body).toContain(`var(--sender-name-on-dark-${i})`);
      // 同一条规则里再冒出字面色值 = 又分叉了
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});
