/**
 * 远端流不得被静默丢弃（src/meeting/useWebRTC.ts 的 ontrack ↔ peer_joined）
 *
 * ## 这条守的是什么（外部审计 idx=76）
 * 改前 `pc.ontrack` 的第一件事是 `prev.find(p => p.id === peerId)`，找不到就 `return prev`
 * —— 而 `handleOffer` 自己写着「pc 不存在就先建一个」，也就是说**存在 participants 里
 * 还没有这个 peer、pc 却已经在收流的时刻**。`ontrack` 对同一条 track 只触发一次：
 * 当场 `return prev` = 这条流永远回不来。后续 `peer_joined` 只往列表里塞一条空壳，
 * 不重扫 `pc.getReceivers()`；`reclassifyStreams` 只管 camera/screen，救不回 `p.stream`,
 * 而**音频恰恰只从 `p.stream` 播**（MeetingPage 的 audioStream）。
 *
 * ## 为什么是静态契约而不是行为测试
 * 触发它需要真的 RTCPeerConnection + 信令 WS + 一次 setRemoteDescription 才能让 ontrack 响，
 * jsdom 三样都没有。这里守的是**结构不变量**：track 先落 ref（谁在列表里都收下）、
 * peer_joined 认领、连接关闭时清账。真机行为仍需另行复核。
 *
 * 断言一律**块内有界**（`[^}]` 不跨出块），并对每条做过 node 变异验证：
 * 把对应那行删掉/改回旧写法后必须翻红。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(__dirname, '../../src/meeting/useWebRTC.ts'), 'utf-8');

/** 抠出 `pc.ontrack = (event) => { ... }` 的函数体（到与之配平的右花括号为止） */
function ontrackBody(source: string): string {
  const start = source.indexOf('pc.ontrack = (event) => {');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; }
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { return source.slice(start, i + 1); }
    }
  }
  throw new Error('ontrack 函数体没有配平的右花括号');
}

describe('useWebRTC — 远端流的收留与认领', () => {
  it('存在一个模块级的远端流真值源 remoteStreamsRef', () => {
    expect(SOURCE).toMatch(/const\s+remoteStreamsRef\s*=\s*useRef<Map<string,\s*MediaStream>>\(new Map\(\)\)/);
  });

  it('ontrack 无条件把 track 落进 remoteStreamsRef（不再以 participants 里有没有这个 peer 为前提）', () => {
    const body = ontrackBody(SOURCE);

    expect(body).toMatch(/remoteStreamsRef\.current\.set\(peerId,\s*remoteStream\)/);
    // 旧写法的判据：在 setParticipants 里 find 到空就整体 return prev ⇒ track 被丢
    expect(body).not.toMatch(/const\s+existing\s*=\s*prev\.find[^}]*\}\s*\n?\s*if\s*\(!existing\)/);
    expect(body).not.toMatch(/if\s*\(!existing\)\s*\{[^}]*return\s+prev;/);
  });

  it('peer_joined 认领 ontrack 先收下的那条流（否则 offer 先到的那次永远接不上）', () => {
    const idx = SOURCE.indexOf("case 'peer_joined': {");
    expect(idx).toBeGreaterThan(-1);
    const block = SOURCE.slice(idx, SOURCE.indexOf("case 'peer_left'", idx));

    expect(block).toMatch(/const\s+buffered\s*=\s*remoteStreamsRef\.current\.get\(msg\.participant\.id\)/);
    expect(block).toMatch(/stream:\s*buffered/);
  });

  it('连接关闭 / 全量清场都要把它清掉（否则换人重进会拿到上一位的流）', () => {
    const close = SOURCE.slice(
      SOURCE.indexOf('const closePeerConnection = useCallback'),
      SOURCE.indexOf('// ========== 信令处理 =========='),
    );
    expect(close).toMatch(/remoteStreamsRef\.current\.delete\(peerId\)/);

    const cleanup = SOURCE.slice(
      SOURCE.indexOf('const cleanupPeers = useCallback'),
      SOURCE.indexOf('const cleanupPeers = useCallback') + 900,
    );
    expect(cleanup).toMatch(/remoteStreamsRef\.current\.clear\(\)/);
  });
});
