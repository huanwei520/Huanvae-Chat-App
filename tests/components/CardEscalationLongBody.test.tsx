/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regression guard for req-19: a LONG (~2500-char, multi-line) escalation card body
 * (the "求救正文") must render FULLY — CardRenderer must not truncate / clamp it.
 *
 * Honest disclaimer (same as tests/unit/cardCodeWrap.test.ts): vitest runs in jsdom
 * with NO layout engine, so it CANNOT observe CSS clipping / overflow visually —
 * real-machine visual verification is separate and login-gated. This file instead pins
 * two source-level invariants that keep the full body visible so neither can be
 * silently reverted:
 *   1. Render layer — a long multi-line markdown body renders every line into the DOM.
 *      CardRenderer applies NO JS/React-level truncation to markdown/text nodes; the
 *      only component-side line cap (CARD_LOG_TAIL_MAX_LINES = 200) lives on `log-tail`
 *      nodes exclusively, so a markdown escalation body is never head/middle/tail-dropped.
 *   2. Declaration layer — the `.card-renderer` / `.card-markdown` / `.card-text` base
 *      CSS blocks contain no vertical clamp (`max-height` / `line-clamp` /
 *      `-webkit-line-clamp` (⊂ `line-clamp`) / `-webkit-box`), so no future CSS edit can
 *      silently reintroduce clipping. Block-bounded static scan (`[^}]*` stops at the
 *      first `}`) targets each selector's OWN rule, never a descendant rule.
 */

// 稳定单例 api 对象(真实 Context 的 value 引用稳定,mock 必须对齐)
const apiMock = vi.hoisted(() => ({}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiMock,
}));

const interactMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/messages', () => ({
  interactWithCard: interactMock,
}));

const klinechartsMock = vi.hoisted(() => {
  const applyNewData = vi.fn();
  const setStyles = vi.fn();
  const init = vi.fn(() => ({ applyNewData, setStyles }));
  const dispose = vi.fn();
  return { init, dispose, applyNewData, setStyles };
});
vi.mock('klinecharts', () => ({
  init: klinechartsMock.init,
  dispose: klinechartsMock.dispose,
}));

import { CardRenderer } from '../../src/chat/shared/CardRenderer';

/** 构造卡片 schema JSON 串 */
function cardJson(nodes: unknown[]): string {
  return JSON.stringify({ version: 1, nodes });
}

/**
 * 构造一份长(~2500+ 字符)多行的求救正文 markdown:头/中/尾标记 + 40 条列表明细 +
 * 代码块,用于断言渲染层完整落 DOM(每一行都在,无头/中/尾丢失)。
 */
function buildLongEscalationBody(): string {
  const lines: string[] = [];
  lines.push('ESC-HEAD-KEEPME 顶部求救标记');
  lines.push('');
  lines.push('## 求救理由(escalation reason)');
  lines.push('');
  for (let n = 1; n <= 40; n += 1) {
    const nn = String(n).padStart(2, '0');
    lines.push(`- 求救细节行 ESC-LINE-${nn}:need-decision context padding text keep every line visible`);
    if (n === 20) {
      lines.push('');
      lines.push('ESC-MID-KEEPME 中部求救标记');
      lines.push('');
    }
  }
  lines.push('');
  lines.push('```');
  lines.push('CODEBLOCK-KEEPME 代码块正文行一');
  lines.push('const decision = "need-human-review";');
  lines.push('```');
  lines.push('');
  lines.push('ESC-TAIL-KEEPME 尾部求救标记 — 完整正文到此结束');
  return lines.join('\n');
}

describe('req-19 长求救正文完整渲染(无截断)', () => {
  beforeEach(() => {
    cleanup();
    interactMock.mockReset();
  });

  it('long markdown escalation body renders every line (no JS truncation)', () => {
    const body = buildLongEscalationBody();
    // 文档级规模:证明这是"长正文"而非几行小卡片
    expect(body.length).toBeGreaterThan(2000);

    const content = cardJson([{ type: 'markdown', text: body }]);
    const { container } = render(
      <CardRenderer messageContent={content} messageUuid="req19-md" sourceType="friend" />,
    );

    // 走 markdown 渲染路径
    expect(container.querySelector('.card-markdown')).not.toBeNull();
    // 且不是 log-tail 路径 —— 组件侧 200 行截断只作用于 log-tail,不作用于 markdown
    expect(container.querySelector('.card-log-tail')).toBeNull();

    const text = container.textContent ?? '';
    // 头/中/尾/代码块四处锚点全部在场 → 无任何一段被丢弃
    expect(text).toContain('ESC-HEAD-KEEPME');
    expect(text).toContain('ESC-MID-KEEPME');
    expect(text).toContain('ESC-TAIL-KEEPME');
    expect(text).toContain('CODEBLOCK-KEEPME');
    // 40 条明细逐行核对(每一行都渲染 → 中间不被裁掉)
    for (let n = 1; n <= 40; n += 1) {
      expect(text).toContain(`ESC-LINE-${String(n).padStart(2, '0')}`);
    }

    // 尾部标记独占一个段落节点,可被 DOM 查询直接命中(渲染确实到达文末)
    expect(screen.getByText(/ESC-TAIL-KEEPME/)).toBeTruthy();
  });

  it('CardRenderer CSS body surfaces declare no vertical clamp', () => {
    const css = readFileSync(resolve(__dirname, '../../src/chat/shared/CardRenderer.css'), 'utf-8');

    // 块内有界正则:`\s*\{` 只匹配"选择器紧跟自身规则块"的那条,
    // 不会误命中 `.card-markdown .markdown-body pre code {` 这类后代规则。
    const clampRe = /max-height|line-clamp|-webkit-box/;

    const rendererBlock = css.match(/\.card-renderer\s*\{[^}]*\}/);
    expect(rendererBlock).not.toBeNull();
    expect(rendererBlock![0]).not.toMatch(clampRe);

    const markdownBlock = css.match(/\.card-markdown\s*\{[^}]*\}/);
    expect(markdownBlock).not.toBeNull();
    expect(markdownBlock![0]).not.toMatch(clampRe);

    const textBlock = css.match(/\.card-text\s*\{[^}]*\}/);
    expect(textBlock).not.toBeNull();
    expect(textBlock![0]).not.toMatch(clampRe);
  });
});
