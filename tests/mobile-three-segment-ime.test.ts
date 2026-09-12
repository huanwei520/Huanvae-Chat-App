/**
 * 移动端聊天页三段式 IME 布局契约
 *
 * 契约（键盘弹起后）：顶部栏固定不动（位移恒为零）、仅中间聊天列表区被压缩、
 * 输入栏贴键盘上沿。结构实现：
 * - CSS：`.mobile-chat-view` flex 纵向三段；header/input flex-shrink: 0；
 *   messages 唯一可压缩段（flex-basis 0 + min-height: 0）。
 * - 页面侧护栏：`useImeThreeSegmentLayout`（文档滚动钉扎 + 压缩贴底保持），
 *   只挂在 MobileChatView，桌面共用代码禁止引用。
 * - IME 避让唯一权威通道是壳层 MainActivity ime() insets（API<30 由 manifest
 *   adjustResize 兜底），页面侧必须保持 interactive-widget=overlays-content
 *   关闭 Chromium 双通道缩放（与 tests/safe-area-viewport.test.ts 的契约配套）。
 *
 * 与 tests/safe-area-viewport.test.ts 一致：vitest 下用 __dirname 读源文件。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const CSS = readFileSync(resolve(ROOT, 'src/styles/mobile/chat-view.css'), 'utf-8');
const VIEW_TSX = readFileSync(resolve(ROOT, 'src/pages/mobile/MobileChatView.tsx'), 'utf-8');
const HOOK_REL = 'src/pages/mobile/useImeThreeSegmentLayout.ts';
const HOOK = readFileSync(resolve(ROOT, HOOK_REL), 'utf-8');

/** 取某个顶层选择器块的声明区文本（选择器行起，到块后第一个空行为止） */
function ruleBlock(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} 应存在于 chat-view.css`).toBeGreaterThanOrEqual(0);
  const next = css.slice(at).indexOf('\n\n', 1);
  return css.slice(at, next === -1 ? undefined : at + next);
}

/** 递归收集目录下全部文件路径（跳过 node_modules 语义上不存在于 src 内） */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { out.push(...walkFiles(p)); } else { out.push(p); }
  }
  return out;
}

describe('移动端聊天页三段式 IME 布局契约', () => {
  it('容器：flex 纵向三段（flex-direction: column）', () => {
    const block = ruleBlock(CSS, '.mobile-chat-view');
    expect(block).toMatch(/display:\s*flex/);
    expect(block).toMatch(/flex-direction:\s*column/);
  });

  it('第一段 顶栏固定：flex-shrink: 0（键盘弹起位移恒为零的结构保证）', () => {
    const block = ruleBlock(CSS, '.mobile-chat-header');
    expect(block).toMatch(/flex-shrink:\s*0/);
  });

  it('第二段 消息区唯一可压缩：flex-basis 0 + min-height: 0', () => {
    const block = ruleBlock(CSS, '.mobile-chat-messages');
    expect(block).toMatch(/flex:\s*1\s+1\s+0%/);
    expect(block).toMatch(/min-height:\s*0/);
  });

  it('第三段 输入栏不压缩：flex-shrink: 0（贴容器底沿 = 键盘上沿）', () => {
    const block = ruleBlock(CSS, '.mobile-chat-input');
    expect(block).toMatch(/flex-shrink:\s*0/);
  });

  it('页面侧护栏 hook 挂在 MobileChatView 上', () => {
    expect(VIEW_TSX).toMatch(/useImeThreeSegmentLayout\(/);
  });

  it('护栏 hook 含两条保证：文档滚动钉扎 + 压缩贴底保持（column-reverse 语义）', () => {
    expect(HOOK).toMatch(/scrollingElement/); // Guard A：文档滚动钉扎
    expect(HOOK).toMatch(/\.scrollTop = 0/); // Guard B：压缩后恢复贴底
    expect(HOOK).toMatch(/BOTTOM_EPS/); // 贴底判定阈值
  });

  it('桌面共用代码零引用：useImeThreeSegmentLayout 只允许出现在 src/pages/mobile/ 下（桌面零改动红线的结构性钉子）', () => {
    const srcRoot = resolve(ROOT, 'src');
    const offenders = walkFiles(srcRoot).filter((p) => {
      const norm = p.split('\\').join('/');
      if (norm.includes('/pages/mobile/') || norm.includes('/styles/mobile/')) { return false; } // 移动端自有目录：合法
      try {
        return readFileSync(p, 'utf-8').includes('useImeThreeSegmentLayout');
      } catch {
        return false; // 二进制等不可读文件跳过
      }
    });
    expect(offenders, `移动端 IME 护栏 hook 泄漏到桌面共用代码: ${offenders.join(', ')}`).toEqual([]);
  });

  it('IME 避让通道仍然单通道：index.html 保留 interactive-widget=overlays-content（与壳层 ime() insets 配套，防 Chromium 双通道）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf-8');
    expect(html).toMatch(/interactive-widget\s*=\s*overlays-content/);
  });
});
