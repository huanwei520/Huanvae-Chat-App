/**
 * 回归契约：所有"输入后端大小写敏感标识符"的输入框必须带 autoCapitalize="none"
 * （配 autoCorrect="off" / spellCheck={false}），否则 macOS WKWebView 会对文本框做自动
 * 首字母大写，把 user_id / 账号 / 群邀请码 / 会议房间号 等大小写敏感字段篡改
 * （如 `rsrch-c-0709` → `Rsrch-c-0709`），后端精确匹配即假阴性（查无此人 / 加不进群）。
 *
 * 用静态扫描而非渲染断言的原因：
 * - AddFriendTab 已重构为 useAddFriendFlow hook 驱动，无独立渲染 harness；Login / Register /
 *   移动页渲染成本高、依赖多个 context。
 * - jsdom + mock invoke 测不出真 webview 的 autocapitalize 行为（与 secure-display-routing /
 *   animation-conflict 同套路：声明层不变量用源码静态扫描守门）。
 *
 * 定位方式：按每个输入框「唯一 placeholder」向前回溯到最近的 <input>/<motion.input> 元素起点、
 * 向后到该自闭合元素的 `/>`，只在该元素文本块内断言属性存在（块内有界，不跨相邻元素）。
 * vitest 静态扫描读源码用 __dirname，见 .claude/rules/frontend-test.md。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 取 src 中包含 placeholder 的那个 <input>/<motion.input> 自闭合元素的完整文本块。
 * input 无子节点，placeholder 之后的第一个 `/>` 即为该元素闭合，故块内有界、不会漏进相邻元素。
 */
export function elementContainingPlaceholder(src: string, placeholder: string): string {
  // 锚在 placeholder 属性本身（`placeholder="..."`），避免命中文件头注释里的同名散文
  // （如会议页注释「加入会议：输入房间号和密码加入」也含「输入房间号」）。
  const needle = `placeholder="${placeholder}"`;
  const phIdx = src.indexOf(needle);
  if (phIdx === -1) {
    throw new Error(`placeholder attr not found: ${needle}`);
  }
  const startInput = src.lastIndexOf('<input', phIdx);
  const startMotion = src.lastIndexOf('<motion.input', phIdx);
  const start = Math.max(startInput, startMotion);
  if (start === -1) {
    throw new Error(`element start not found for placeholder: ${placeholder}`);
  }
  const end = src.indexOf('/>', phIdx);
  if (end === -1) {
    throw new Error(`element end not found for placeholder: ${placeholder}`);
  }
  return src.slice(start, end + 2);
}

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
}

interface Case {
  file: string;
  placeholder: string;
  label: string;
}

// 每条 = 一个"用户输入的、后端大小写敏感的标识符"输入框。
const CASES: Case[] = [
  // 桌面加好友/加入群聊(邀请码) 旧 AddModal tab 页已随 req-23 删除（桌面改经搜索发现→详情申请）；
  // 加好友用户ID 输入已无桌面 harness，移动端仍保留（下方 MobileAddPage 用例守门）。
  { file: 'src/pages/mobile/MobileAddPage.tsx', placeholder: '输入对方的用户 ID', label: '移动加好友 用户ID' },
  { file: 'src/pages/Login.tsx', placeholder: '请输入账号', label: '登录 账号' },
  { file: 'src/pages/Register.tsx', placeholder: '请输入账号（user_id）', label: '注册 账号' },
  { file: 'src/pages/mobile/MobileAddPage.tsx', placeholder: '输入群邀请码', label: '移动加入群聊 邀请码' },
  // req-23 新增：创建机器人用户名是大小写敏感标识符（存储/唯一性区分大小写），须防 WKWebView 首字母大写污染
  { file: 'src/components/bots/CreateBotDialog.tsx', placeholder: '3-32 位字母 / 数字 / 下划线，且以 bot 结尾', label: '创建机器人 用户名（大小写敏感）' },
  { file: 'src/chat/shared/menu/InviteForm.tsx', placeholder: '输入用户 ID', label: '群邀请成员 用户ID' },
  { file: 'src/meeting/components/MeetingEntryModal.tsx', placeholder: '输入房间号', label: '桌面加入会议 房间号' },
  { file: 'src/pages/mobile/MobileMeetingEntryPage.tsx', placeholder: '输入房间号', label: '移动加入会议 房间号' },
];

describe('ID/账号/邀请码/房间号 输入框必须关闭 autoCapitalize（防 WKWebView 首字母大写污染大小写敏感标识符）', () => {
  it.each(CASES)('$label ($file) 元素块内带 autoCapitalize="none"', ({ file, placeholder }) => {
    const el = elementContainingPlaceholder(read(file), placeholder);
    expect(el).toContain('autoCapitalize="none"');
  });

  it.each(CASES)('$label ($file) 同块配套 autoCorrect="off" + spellCheck={false}（所输即所得）', ({ file, placeholder }) => {
    const el = elementContainingPlaceholder(read(file), placeholder);
    expect(el).toContain('autoCorrect="off"');
    expect(el).toContain('spellCheck={false}');
  });
});
