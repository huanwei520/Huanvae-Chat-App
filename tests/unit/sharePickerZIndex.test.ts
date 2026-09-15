/**
 * 分享选择器 z 分层契约 —— 真机实测暴露的「看得见、点不动」缺陷防回归
 *
 * 病历（2026-09-14 安卓真机）：从「群详情 → 分享该群」打开 `.share-picker-overlay`
 * 时，好友行点击无效（`.share-picker-count` 恒为「已选 0 个会话」），而同一选择器
 * 从会议页打开时工作正常 —— 差别只在「触发方是不是一个浮层」。
 *
 * 根因：`.other-profile-overlay`（个人资料/群详情面板）z-index=10001，
 * `.share-picker-overlay` z-index=10000 ⇒ 选择器画在面板**下面**；真机
 * `document.elementsFromPoint(206,245)` 返回
 *   [qq-hero-card, other-profile-panel, other-profile-shell, other-profile-overlay,
 *    share-picker-row-name, share-picker-row…]
 * 即面板内容排在选择器行之前，触摸全被面板吞掉。CDP 把选择器 z-index 临时提到
 * 10002 后同一坐标立刻「已选 1 个会话」，故根因实锤。
 *
 * 本测试锁「选择器必须高于常见触发浮层」这条不变量 —— 这类缺陷 jsdom 抓不到
 * （不算层叠），只能静态扫 CSS。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PICKER_CSS = resolve(__dirname, '../../src/components/share/ShareTargetPicker.css');
const MAIN_CSS = resolve(__dirname, '../../src/styles/pages/main.css');

/** 取某选择器规则块里的 z-index 数值 */
function zIndexOf(css: string, selector: string): number {
  const at = css.indexOf(selector);
  expect(at).toBeGreaterThanOrEqual(0);
  const block = css.slice(at, css.indexOf('}', at));
  const m = block.match(/z-index:\s*(\d+)/);
  expect(m).not.toBeNull();
  return Number(m![1]);
}

describe('分享选择器 z 分层（> 触发它的浮层）', () => {
  const pickerCss = readFileSync(PICKER_CSS, 'utf8');
  const mainCss = readFileSync(MAIN_CSS, 'utf8');

  it('必须高于个人资料/群详情面板 .other-profile-overlay（本次病历的一面）', () => {
    const picker = zIndexOf(pickerCss, '.share-picker-overlay');
    const profile = zIndexOf(mainCss, '.other-profile-overlay');
    expect(profile).toBe(10001); // 面板侧不动，锁住现状
    expect(picker).toBeGreaterThan(profile);
  });

  it('必须高于 10002 家族的深层面板（群详情同类浮层）', () => {
    expect(zIndexOf(pickerCss, '.share-picker-overlay')).toBeGreaterThan(10002);
  });

  it('仍低于移动端最高层 100000（媒体预览层，保持既有层级语义）', () => {
    const preview = zIndexOf(
      readFileSync(resolve(__dirname, '../../src/styles/mobile/chat-view.css'), 'utf8'),
      '.mobile-media-preview-overlay',
    );
    expect(preview).toBe(100000);
    expect(zIndexOf(pickerCss, '.share-picker-overlay')).toBeLessThan(preview);
  });
});
