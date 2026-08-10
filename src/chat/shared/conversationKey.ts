/**
 * 会话身份 key（纯函数，零 React / 零 Tauri 依赖）
 *
 * @module chat/shared
 * @location src/chat/shared/conversationKey.ts
 *
 * 「当前是哪个会话」这件事有两个消费方，必须用同一个口径，否则会串会话：
 * 1. 按会话独立的输入框草稿（useMainPage）
 * 2. 「正在回复」草稿的归属校验（ChatInputArea / ChatMessages / GroupChatMessages）
 *
 * 原先它只存在于 useMainPage.ts 里，而 ChatInputArea 想复用就得 import 那个 hook 模块
 * —— 会把整条 hook 依赖链拖进来（见 .claude/rules/common.md「跨端复用 pure function 时
 * 检查源文件的依赖污染」）。所以抽到本模块，两边各自 import 这里。
 */

import type { ChatTarget } from '../../types/chat';

/**
 * 群会话 key。
 *
 * 单独导出是因为消息列表侧只拿得到 groupId、拿不到整个 ChatTarget，
 * 而在那里手写 `group:${id}` 会让 key 格式出现第二个真值源 —— 一旦格式改动
 * 就会静默失配（草稿显示不出来、或串到别的会话）。格式只在本模块内存在一次。
 */
export function groupConversationKey(groupId: string): string {
  return `group:${groupId}`;
}

/** 私聊 / bot 会话 key（两者数据形态一致，都用 friend_id） */
export function friendConversationKey(type: 'friend' | 'bot', friendId: string): string {
  return `${type}:${friendId}`;
}

/**
 * 会话草稿 key：与 ChatTarget 的联合类型一一对应，唯一即可。
 * 抽成模块级纯函数（而非组件内嵌套三元），便于单测覆盖各分支。
 */
export function draftKeyOf(target: ChatTarget | null | undefined): string | null {
  if (!target) { return null; }
  switch (target.type) {
    case 'group':
      return groupConversationKey(target.data.group_id);
    case 'ai':
      return `ai:${target.conversationId ?? 'default'}`;
    default:
      return friendConversationKey(target.type, target.data.friend_id);
  }
}
