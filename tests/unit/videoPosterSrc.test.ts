/**
 * videoPosterSrc —— 视频缩略图 src 的媒体片段追加
 *
 * 被测的是「缩略图 src 必须带 #t=0.1」这条不变量的**计算部分**：
 * 全仓没有封面生成机制，缩略图能不能出封面全看引擎肯不肯自发画首帧
 * （Chromium/WebView2 画、WKWebView 与 Android WebView 不画）——
 * `#t=0.1` 逼引擎 seek，seek 完成就必须把那一帧渲染出来。
 *
 * ⚠️ 本文件只覆盖纯函数。「四处缩略图确实调了它、而全屏播放确实没调」
 * 由 tests/unit/videoPosterWiring.test.ts 静态扫描守；两者缺一不可 ——
 * 纯函数再对，接错地方（比如接进 resolver 或接到播放器上）一样是 bug。
 */

import { describe, it, expect } from 'vitest';
import { videoPosterSrc } from '../../src/chat/shared/videoPosterSrc';

describe('videoPosterSrc', () => {
  it('普通 URL：追加 #t=0.1', () => {
    expect(videoPosterSrc('http://127.0.0.1:41234/media/clip.mp4')).toBe(
      'http://127.0.0.1:41234/media/clip.mp4#t=0.1',
    );
  });

  it('带 query 的 URL：#t 追在 query 之后（fragment 必须排在最末，否则会被当成 query 的一部分）', () => {
    const proxied = 'http://127.0.0.1:41234/proxy?u=abc&sig=xyz';
    expect(videoPosterSrc(proxied)).toBe('http://127.0.0.1:41234/proxy?u=abc&sig=xyz#t=0.1');
    // 反向断言：不能塞进 query 段
    expect(videoPosterSrc(proxied)).not.toContain('t=0.1&');
    expect(videoPosterSrc(proxied).indexOf('#')).toBeGreaterThan(
      videoPosterSrc(proxied).indexOf('sig=xyz'),
    );
  });

  it('asset:// 等非 http scheme 一视同仁（本函数不解析 scheme）', () => {
    expect(videoPosterSrc('asset://localhost/data/clip.mp4')).toBe(
      'asset://localhost/data/clip.mp4#t=0.1',
    );
  });

  it('已带 fragment 的 URL：原样返回，不拼第二个 #（那会得到非法地址）', () => {
    expect(videoPosterSrc('http://h/clip.mp4#t=5')).toBe('http://h/clip.mp4#t=5');
    expect(videoPosterSrc('http://h/clip.mp4#frag')).toBe('http://h/clip.mp4#frag');
    // 一个字符串里绝不出现两个 #
    expect(videoPosterSrc('http://h/clip.mp4#t=5').split('#')).toHaveLength(2);
  });

  it('空串：原样返回，不产出裸 "#t=0.1" 这种会被当成同页锚点的 src', () => {
    expect(videoPosterSrc('')).toBe('');
  });

  it('幂等：对已处理过的结果再调一次不会叠加', () => {
    const once = videoPosterSrc('http://h/clip.mp4');
    expect(videoPosterSrc(once)).toBe(once);
  });
});
