/**
 * 「连发组的头像贴在气泡下沿，而不是最后一条的顶部」的防回归（静态守卫）
 *
 * huanwei 2026-08-14 原话（唯一真值源）：
 *   「多条消息的气泡头像，让头像处于**气泡的下底部**而不是**最后一条的顶部**」
 *
 * 修的**不是**「挂在哪一条」——`senderRunGate.avatarAnchorKeys` 早就把头像挂在组内
 * 最新那条（列表是 column-reverse ⇒ 视觉最下面那条），那一层是对的、本次一个字没动。
 * 错的是**那一行内部的垂直对齐**：`.message-bubble` 是 flex 行且**没有** `align-items`
 * ⇒ 默认 `stretch`，而头像有确定的 38px 高 ⇒ stretch 对它无效 ⇒ 落在交叉轴起点（顶部）。
 *
 * 本文件钉三件事：
 *   1. `.bubble-avatar--bottom` 规则块内必须有 `align-self: flex-end`（修复本体）；
 *   2. 群聊气泡的**两个**分支都要带上这个类 —— 真头像与占位孔
 *      （`GroupMessageBubble.tsx` 里 `showAvatar` 三元的两侧）。漏掉任何一侧都会让
 *      「有头像的行」和「留空位的行」用两套对齐，组内气泡左缘不再是一条线；
 *   3. **不许**改成给 `.message-bubble` 加 `align-items` —— 那会把 `.bubble-content`
 *      也从 stretch 改成 hug，波及每一条消息（含 1:1 与 AI 对话），远超他提的范围。
 *
 * 为什么用 modifier 类而不是直接改全局 `.bubble-avatar`：AI 对话复用了**同一个类名**
 * （chat/ai/AIMessageBubble.tsx 一处 + chat/ai/AIChatMessages.tsx 两处），
 * 且三处同样是 `.message-bubble` 的**直接子元素** ⇒ 后代 / 子选择器都区分不开。
 * 他只提了群聊连发，所以让群聊那侧显式 opt-in。1:1 侧不受影响：那边气泡区根本没有头像
 * （`grep -c bubble-avatar src/chat/friend/MessageBubble.tsx` = 0）。
 *
 * ⚠️ 本文件只是**声明层**守卫：jsdom 无布局引擎，`getBoundingClientRect()` 恒 0，
 * 「头像到底有没有贴到气泡下沿」在 vitest 里没有任何可观测量
 * （.claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」一族）。
 * 真正的判据是真机截图，最终由 huanwei 终验。
 *
 * 规则块抠法沿用同目录既有文件：从选择器起到**第一个右花括号**为止。
 * ⇒ 被扫的 CSS 注释里不许出现花括号（.claude/rules/animation.md 末尾那条已实证过的坑）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const META_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/components/chat-bubble-meta.css'),
  'utf-8',
);
const MAIN_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/pages/main.css'),
  'utf-8',
);
const GROUP_BUBBLE = readFileSync(
  resolve(__dirname, '../../src/chat/group/GroupMessageBubble.tsx'),
  'utf-8',
);

/** 从选择器开头抠到第一个右花括号；抠不到直接让用例失败（选择器被改名也算回归） */
function ruleBlock(css: string, selectorPattern: RegExp): string {
  const m = css.match(selectorPattern);
  expect(m, `规则块没找到：${selectorPattern}`).not.toBeNull();
  return m![0];
}

describe('头像沉到连发组下沿（CSS 声明层）', () => {
  it('.bubble-avatar--bottom 规则块内声明 align-self: flex-end', () => {
    const block = ruleBlock(META_CSS, /\.bubble-avatar--bottom\s*\{[^}]*\}/);

    expect(block).toMatch(/align-self:\s*flex-end/);
  });

  it('🔴 反向：不得改用给 .message-bubble 加 align-items（波及 .bubble-content 与全部气泡）', () => {
    const block = ruleBlock(MAIN_CSS, /^\.message-bubble\s*\{[^}]*\}/m);

    // 正对照：确实抠到了那个块（它一直声明 display: flex），证明这条断言不是在空串上恒真
    expect(block).toMatch(/display:\s*flex/);
    expect(block).not.toMatch(/align-items/);
  });

  it('.bubble-avatar 的基础块不带 align-self（对齐是 opt-in，AI 对话那三处不受波及）', () => {
    const block = ruleBlock(MAIN_CSS, /^\.bubble-avatar\s*\{[^}]*\}/m);

    // 正对照：抠到的确实是那个基础块（它一直声明 38px 见方）
    expect(block).toMatch(/width:\s*38px/);
    expect(block).not.toMatch(/align-self/);
  });
});

describe('群聊气泡两个分支都带上这个类（漏一侧则组内左缘参差）', () => {
  it('真头像那一支带 bubble-avatar--bottom', () => {
    expect(GROUP_BUBBLE).toMatch(/className=\{`bubble-avatar bubble-avatar--bottom clickable/);
  });

  it('占位孔那一支带 bubble-avatar--bottom，且仍保留 --hole', () => {
    expect(GROUP_BUBBLE).toMatch(
      /className="bubble-avatar bubble-avatar--bottom bubble-avatar--hole"/,
    );
  });

  it('全文件里 bubble-avatar 一共只有这两个渲染点，两个都已 opt-in', () => {
    const rendered = GROUP_BUBBLE.match(/className=[{"]`?bubble-avatar /g) ?? [];
    const optedIn = GROUP_BUBBLE.match(/bubble-avatar bubble-avatar--bottom/g) ?? [];

    expect(rendered).toHaveLength(2);
    expect(optedIn).toHaveLength(2);
  });
});
