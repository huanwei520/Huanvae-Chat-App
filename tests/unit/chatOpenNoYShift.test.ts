/**
 * 打开/切换会话「零位移入场」静态契约测试
 *
 * 契约：打开/切换会话时随 ChatPanel 重挂的面板骨架元素——
 * - ChatPanel 的 .chat-content（头部栏 + 消息区 + 输入区的总容器）
 * - ChatMessages / GroupChatMessages 的消息列表容器
 * - ChatInputArea 的输入区（正常态 + 禁言态）
 * 其 framer-motion initial/animate/exit 只允许 opacity，禁止 x / y / scale。
 *
 * 为什么连"输入区自己滑入"都不行（2026-06-11 实测根因）：
 * 输入区首帧 translateY(40) 会把元素边界伸出 .chat-content（overflow:hidden 也是
 * scroll container），扩出可滚动区；textarea 挂载 autofocus 触发 focus 滚动 →
 * .chat-content 被滚下（头部+消息区整体顶上去），动画回位时可滚区缩回、scrollTop
 * 逐帧钳回 0 → 头部栏和整个消息框出现「从上向下滑入」的假入场。
 *
 * 检测方式：静态读取源码，提取目标 motion 组件开标签内的 initial/animate/exit
 * 属性块（块内有界 [^}]，不跨出对象字面量），断言不含位移属性、且含 opacity
 * （防 vacuous——属性块为空也算 FAIL）。
 * vitest 因 MotionGlobalConfig.skipAnimations 测不出真实滚动钳制，只有本静态扫描能拦。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf-8');
/* eslint-enable no-undef */

/** 在 anchor（标识目标 motion 组件的唯一片段）之后提取 initial/animate/exit 的对象字面量内容 */
function extractMotionProps(src: string, anchor: string): { initial: string; animate: string; exit: string | null } {
  const idx = src.indexOf(anchor);
  expect(idx, `anchor 未找到: ${anchor}`).toBeGreaterThanOrEqual(0);
  // 只看 anchor 之后第一个开标签范围内的属性（到第一个 '>' 为止，块内有界）
  const tagEnd = src.indexOf('>', idx);
  const tag = src.slice(idx, tagEnd);
  const grab = (prop: string): string | null => {
    const m = tag.match(new RegExp(`${prop}=\\{\\{([^}]*)\\}\\}`));
    return m ? m[1] : null;
  };
  const initial = grab('initial');
  const animate = grab('animate');
  expect(initial, `${anchor} 缺 initial 对象字面量`).not.toBeNull();
  expect(animate, `${anchor} 缺 animate 对象字面量`).not.toBeNull();
  return { initial: initial!, animate: animate!, exit: grab('exit') };
}

/** 断言一个 motion 属性块只做淡入淡出：含 opacity、不含 x/y/scale 位移 */
function expectFadeOnly(block: string, label: string) {
  expect(block, `${label} 必须包含 opacity（防空断言）`).toMatch(/\bopacity\s*:/);
  expect(block, `${label} 不得包含 y 位移`).not.toMatch(/\by\s*:/);
  expect(block, `${label} 不得包含 x 位移`).not.toMatch(/\bx\s*:/);
  expect(block, `${label} 不得包含 scale`).not.toMatch(/\bscale\s*:/);
}

describe('打开/切换会话面板骨架零位移（只允许 opacity 淡入）', () => {
  it('ChatPanel .chat-content：opacity-only', () => {
    const src = read('src/chat/shared/ChatPanel.tsx');
    const props = extractMotionProps(src, 'className="chat-content"');
    expectFadeOnly(props.initial, 'chat-content initial');
    expectFadeOnly(props.animate, 'chat-content animate');
    expect(props.exit).not.toBeNull();
    expectFadeOnly(props.exit!, 'chat-content exit');
  });

  it.each([
    ['ChatMessages', 'src/chat/friend/ChatMessages.tsx'],
    ['GroupChatMessages', 'src/chat/group/GroupChatMessages.tsx'],
  ])('%s 消息列表容器：opacity-only', (_name, file) => {
    const src = read(file);
    const props = extractMotionProps(src, 'chat-messages-container--reverse');
    expectFadeOnly(props.initial, '消息容器 initial');
    expectFadeOnly(props.animate, '消息容器 animate');
  });

  it.each([
    ['正常态', 'key="input-area"'],
    ['禁言态', 'key="input-area-muted"'],
  ])('ChatInputArea %s：opacity-only（y 位移会经 overflow+autofocus 造成头部/消息区假下滑）', (_name, anchor) => {
    const src = read('src/chat/shared/ChatInputArea.tsx');
    const props = extractMotionProps(src, anchor);
    expectFadeOnly(props.initial, `输入区 ${anchor} initial`);
    expectFadeOnly(props.animate, `输入区 ${anchor} animate`);
    expect(props.exit, `输入区 ${anchor} 缺 exit`).not.toBeNull();
    expectFadeOnly(props.exit!, `输入区 ${anchor} exit`);
  });
});
