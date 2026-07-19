/**
 * 统一 Bot 徽章（Telegram 式 "Bot" 小标签）
 *
 * @location src/components/common/BotBadge.tsx
 *
 * bot 是真实好友行（friend_id 带 bot_ 前缀，判别用 src/api/bots.ts 的 isBotUserId），
 * 各列表/资料页/聊天顶栏用本组件统一标识 bot 身份。
 * 消费方：UnifiedList / MobileChatList / OtherProfilePanel / MobileContacts / MobileChatView。
 * 颜色引用 variables.css 静态 token（--bot-badge-bg / --bot-badge-text），观感与原内联实现一致。
 */

export function BotBadge() {
  return (
    <span
      className="bot-badge"
      style={{
        fontSize: '10px',
        padding: '1px 4px',
        borderRadius: '3px',
        background: 'var(--bot-badge-bg)',
        color: 'var(--bot-badge-text)',
        marginLeft: 4,
        display: 'inline-block',
      }}
    >
      Bot
    </span>
  );
}
