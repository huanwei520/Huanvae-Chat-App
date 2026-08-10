/**
 * 契约测试：会话内查找**只有一个入口** —— 侧边设置面板里的那一项。
 *
 * 背景：v1.1.26 曾在顶栏「更多操作」旁边单独加了一颗放大镜按钮（桌面 ChatPanel + 移动
 * MobileChatView 各一个）。产品口径改为「查找并进侧边栏」，那两颗按钮删除。
 * 这类"某个 UI 不该再出现"的要求只靠人眼复查必然回潮（顺手加回一个按钮太容易），
 * 故用源码静态扫描把它钉成机器可复查的不变量。
 *
 * 为什么是静态扫描而不是渲染断言：ChatPanel / MobileChatView 要跑起来需要 Session /
 * WebSocket / 消息 store 等整条依赖链，为一条"不存在"的断言搭那套 mock 不划算；
 * 而"入口有没有被加回来"在源码层面就是确定的（与 tests/App/AppUpdateToast.test.tsx
 * 同套路；vitest 静态扫描读文件用 __dirname，见 .claude/rules/frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

const CHAT_PANEL = read('src/chat/shared/ChatPanel.tsx');
const MOBILE_CHAT_VIEW = read('src/pages/mobile/MobileChatView.tsx');
const CHAT_MENU = read('src/chat/shared/ChatMenu.tsx');
const MAIN_MENU = read('src/chat/shared/menu/MainMenu.tsx');

/** 两端聊天外壳（桌面 / 移动），两端对齐的断言逐个对它们跑一遍 */
const SHELLS: [string, string][] = [
  ['ChatPanel（桌面）', CHAT_PANEL],
  ['MobileChatView（移动）', MOBILE_CHAT_VIEW],
];

describe('【三】顶栏不再有独立的查找入口（两端）', () => {
  it.each(SHELLS)('%s 不再挂载 ConversationMessageSearch', (_name, source) => {
    expect(source).not.toMatch(/ConversationMessageSearch/);
  });

  it.each(SHELLS)('%s 不再解析会话查找 ID（该逻辑已移进 ChatMenu）', (_name, source) => {
    expect(source).not.toMatch(/getSearchConversationId/);
  });

  it.each(SHELLS)('%s 不再有「查找聊天记录」按钮与其开关状态', (_name, source) => {
    expect(source).not.toMatch(/查找聊天记录/);
    expect(source).not.toMatch(/showConvSearch/);
  });
});

describe('【三】查找入口收敛到侧边面板', () => {
  it('MainMenu 的「查找聊天记录」项由 onOpenSearch 驱动', () => {
    // 块内有界：限定在同一个 <button> 元素内，避免匹配到文件里别处的同名 token
    expect(MAIN_MENU).toMatch(/<button[^>]*onClick=\{onOpenSearch\}[^>]*>[\s\S]{0,200}?查找聊天记录/);
  });

  it('ChatMenu 有 search 视图，渲染 ConversationMessageSearch', () => {
    expect(CHAT_MENU).toMatch(/import \{ ConversationMessageSearch \}/);
    expect(CHAT_MENU).toMatch(/case 'search':/);
    expect(CHAT_MENU).toMatch(/<ConversationMessageSearch[\s\S]{0,300}?conversationId=\{searchConversationId\}/);
  });

  it('ChatMenu 把「打开查找」接到 MainMenu 的 onOpenSearch 上', () => {
    expect(CHAT_MENU).toMatch(/onOpenSearch=\{[\s\S]{0,120}?handleSetView\('search'\)/);
  });

  it('选中结果后收起面板（onJump → handleCloseMenu），否则被定位的消息还被面板盖着', () => {
    expect(CHAT_MENU).toMatch(/onJump=\{menu\.handleCloseMenu\}/);
  });
});

describe('【一】非模态：触发按钮必须截停 mousedown，否则关不掉', () => {
  it('ChatMenu 的触发按钮在 mousedown 上 stopPropagation', () => {
    // 没有遮罩挡着 → 打开时按钮仍可点；useChatMenu 听 document mousedown 关菜单，
    // 放任冒泡就成了「mousedown 关 + click 再开」的自锁。删掉这行即 FAIL。
    expect(CHAT_MENU).toMatch(/onMouseDown=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it('ChatMenu 把触发容器交给面板做顶边锚点（面板据此不盖标题栏）', () => {
    expect(CHAT_MENU).toMatch(/triggerRef=\{containerRef\}/);
  });
});
