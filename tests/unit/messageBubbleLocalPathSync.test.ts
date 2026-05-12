/**
 * MessageBubble / GroupMessageBubble 的 localPath 数据源契约测试
 *
 * 防回归目标：
 * MessageBubble 和 GroupMessageBubble 必须通过 useFileCache 拿 localPath
 * （订阅 chatStore.fileCacheStore 的 downloadTask），而非用本地 useState +
 * 一次性 useEffect + getCachedFilePath。
 *
 * 历史 bug（2026-05-13）：
 *   - 两个组件用 `const [localPath, setLocalPath] = useState(null) + useEffect 一次性 getCachedFilePath`
 *   - 下载完成后 store 更新，但本地 state 不订阅 store → localPath 仍 null
 *   - 右键菜单"在文件夹中显示"按钮依赖 localPath 非空 → 看不到（需切换会话才生效）
 *   - 同时 LocalBadge 用 useFileCache 拿 isLocal 是订阅 store 的 → 右上角徽章正常显示
 *
 * 修复：改用 useFileCache 共用同一数据源，自动订阅 store 变化。
 *
 * 测试形式：源码静态扫描
 * 原因：MessageBubble 渲染依赖大量 context (SessionContext / WebSocketContext / FileCache store)
 * 完整 render 需要 mock 整个依赖图。结构性测试足以防止 future 改动回退到一次性 getCachedFilePath。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MSG_BUBBLE_PATH = resolve(__dirname, '../../src/chat/friend/MessageBubble.tsx');
const GROUP_BUBBLE_PATH = resolve(__dirname, '../../src/chat/group/GroupMessageBubble.tsx');

const FRIEND_SOURCE = readFileSync(MSG_BUBBLE_PATH, 'utf-8');
const GROUP_SOURCE = readFileSync(GROUP_BUBBLE_PATH, 'utf-8');

describe('MessageBubble / GroupMessageBubble localPath 数据源防回归', () => {
  it('MessageBubble import useFileCache', () => {
    expect(FRIEND_SOURCE).toMatch(
      /import\s*\{[^}]*\buseFileCache\b[^}]*\}\s*from\s*['"][^'"]*hooks\/useFileCache['"]/,
    );
  });

  it('MessageBubble 通过 useFileCache 解构 localPath（不用本地 useState）', () => {
    expect(FRIEND_SOURCE).toMatch(/const\s*\{\s*localPath\s*\}\s*=\s*useFileCache\s*\(/);
  });

  it('MessageBubble 不再 import getCachedFilePath', () => {
    expect(FRIEND_SOURCE).not.toMatch(/import\s*\{[^}]*\bgetCachedFilePath\b[^}]*\}/);
  });

  it('MessageBubble 不再用 useState + setLocalPath 模式', () => {
    expect(FRIEND_SOURCE).not.toMatch(/setLocalPath\s*\(/);
  });

  it('GroupMessageBubble import useFileCache', () => {
    expect(GROUP_SOURCE).toMatch(
      /import\s*\{[^}]*\buseFileCache\b[^}]*\}\s*from\s*['"][^'"]*hooks\/useFileCache['"]/,
    );
  });

  it('GroupMessageBubble 通过 useFileCache 解构 localPath', () => {
    expect(GROUP_SOURCE).toMatch(/const\s*\{\s*localPath\s*\}\s*=\s*useFileCache\s*\(/);
  });

  it('GroupMessageBubble 不再 import getCachedFilePath', () => {
    expect(GROUP_SOURCE).not.toMatch(/import\s*\{[^}]*\bgetCachedFilePath\b[^}]*\}/);
  });

  it('GroupMessageBubble 不再用 setLocalPath 模式', () => {
    expect(GROUP_SOURCE).not.toMatch(/setLocalPath\s*\(/);
  });
});
