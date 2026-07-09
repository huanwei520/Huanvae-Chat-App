/**
 * 默认头像占位色 token 防回归契约测试（静态源码扫描）
 *
 * 需求真值：所有"无头像"用户/群默认头像 = 统一固定蓝，不随用户自选主题主色变化。
 *
 * 根因加固：src/styles/variables.css 的
 *   --avatar-placeholder-initial-start / --avatar-placeholder-initial-end
 * 曾定义为 var(--color-primary-7 / -4)。而 ThemeProvider 会在运行时用用户自选主色覆盖
 * --color-primary-*，导致默认头像跟随主题变色（暖色主题 → 红橙），违背"统一蓝"。
 *
 * 本测试断言这两个 token 是**字面 hex**（#2563eb / #93c5fd）且**不含 var(**，
 * 防止未来又被改回"跟随主题"的 var(--color-primary-*) 写法。
 *
 * 测试形式：readFileSync 静态扫描 CSS 源码（vitest 下用 __dirname，不用 import.meta.url）。
 * 原因：vitest（jsdom）不跑 PostCSS，无法在运行时观察 CSS 变量最终解析值；只有静态断言
 * 源码里 token 的字面定义才能拦住"改回 var()"这类回归。
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VARIABLES_CSS = readFileSync(
  resolve(__dirname, '../../src/styles/variables.css'),
  'utf-8',
);
/* eslint-enable no-undef */

/**
 * 取某个 CSS 自定义属性的**声明值**（已剥离 /* ... *\/ 注释，避免注释里的 "was var(...)"
 * 之类文案污染 "不含 var(" 断言）。块内有界：只吃到该声明的分号为止。
 */
function readTokenValue(source: string, tokenName: string): string | null {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`${tokenName.replace(/[-]/g, '\\-')}:\\s*([^;]+);`);
  const m = withoutComments.match(re);
  return m ? m[1].trim() : null;
}

describe('默认头像占位色 token 固定蓝契约（variables.css）', () => {
  it('--avatar-placeholder-initial-start 是字面 #2563eb（固定蓝，不是 var()）', () => {
    const value = readTokenValue(VARIABLES_CSS, '--avatar-placeholder-initial-start');
    expect(value).not.toBeNull();
    expect(value).toBe('#2563eb');
    expect(value).not.toContain('var(');
  });

  it('--avatar-placeholder-initial-end 是字面 #93c5fd（固定浅蓝，不是 var()）', () => {
    const value = readTokenValue(VARIABLES_CSS, '--avatar-placeholder-initial-end');
    expect(value).not.toBeNull();
    expect(value).toBe('#93c5fd');
    expect(value).not.toContain('var(');
  });

  it('两个 initial token 的值里都不出现 --color-primary-*（防跟随主题主色）', () => {
    const start = readTokenValue(VARIABLES_CSS, '--avatar-placeholder-initial-start');
    const end = readTokenValue(VARIABLES_CSS, '--avatar-placeholder-initial-end');
    expect(start).not.toContain('--color-primary');
    expect(end).not.toContain('--color-primary');
  });
});
