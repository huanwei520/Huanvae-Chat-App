/**
 * .image-message CSS 防回归测试
 *
 * 验证两个关键 CSS 改动落地（防止后续 PR 误回退）：
 *
 * 1. `.image-message .message-image` 使用 `object-fit: contain`（不再用 cover）
 *    原因：cover 会裁剪溢出部分；contain 保持图片比例完整显示。
 *    Bug：Android 窄屏（< 380px）气泡 max-width: calc(100% - 58px) < 280px 容器，
 *    cover 会让超宽图片被截断显示不全。
 *
 * 2. `.image-message` 含 `max-width: 100%`
 *    原因：容器尺寸由 JS calculateDisplaySize 硬编码 280px max，需要 CSS 约束
 *    让窄屏下容器收缩到气泡内，配合 object-fit: contain 实现完整缩放。
 *
 * 测试形式：静态扫描 src/styles/pages/main.css。
 * 原因：vitest 默认 jsdom 不计算 CSS（仅 DOM 解析），完整 render + 量测尺寸需要
 * 浏览器渲染引擎，成本远高于 grep 字面量；该测试拦的是配置回退，足够。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAIN_CSS_PATH = resolve(__dirname, '../../src/styles/pages/main.css');
const MAIN_CSS = readFileSync(MAIN_CSS_PATH, 'utf-8');

describe('.image-message 防回归', () => {
  it('.image-message .message-image 使用 object-fit: contain（不再用 cover）', () => {
    // 定位 .image-message .message-image 规则块
    const ruleBlock = MAIN_CSS.match(
      /\.image-message\s+\.message-image\s*\{[^}]*\}/,
    );
    expect(ruleBlock).not.toBeNull();
    // 精确匹配 CSS 声明形式：属性后必须紧跟 `;` 或行尾，避免注释中提到的字面量误命中
    expect(ruleBlock![0]).toMatch(/object-fit\s*:\s*contain\s*;/);
    expect(ruleBlock![0]).not.toMatch(/object-fit\s*:\s*cover\s*;/);
  });

  it('.image-message 规则含 max-width: 100%', () => {
    // 匹配独立的 .image-message 规则块（不是 .image-message .xxx 后代选择器）
    // 用负向 lookahead 排除后代选择器（如 .image-message .message-image）
    const ruleBlock = MAIN_CSS.match(/\.image-message\s*\{[^}]*\}/);
    expect(ruleBlock).not.toBeNull();
    expect(ruleBlock![0]).toMatch(/max-width:\s*100%/);
  });

  it('.image-message 规则保留 overflow: hidden（裁圆角和阻止溢出）', () => {
    const ruleBlock = MAIN_CSS.match(/\.image-message\s*\{[^}]*\}/);
    expect(ruleBlock).not.toBeNull();
    expect(ruleBlock![0]).toMatch(/overflow:\s*hidden/);
  });
});
