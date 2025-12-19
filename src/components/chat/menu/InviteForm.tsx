/**
 * 邀请成员表单组件
 */

import { MenuHeader } from './MenuHeader';

interface InviteFormProps {
  userId: string;
  message: string;
  loading: boolean;
  onUserIdChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function InviteForm({
  userId,
  message,
  loading,
  onUserIdChange,
  onMessageChange,
  onSubmit,
  onBack,
}: InviteFormProps) {
  return (
    <>
      <MenuHeader title="邀请成员" onBack={onBack} />
      <div className="menu-form">
        <input
          type="text"
          value={userId}
          onChange={(e) => onUserIdChange(e.target.value)}
          placeholder="输入用户 ID"
          className="menu-input"
        />
        <input
          type="text"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="邀请消息（可选）"
          className="menu-input"
        />
        <button
          className="menu-submit"
          onClick={onSubmit}
          disabled={loading || !userId.trim()}
        >
          {loading ? '发送中...' : '发送邀请'}
        </button>
      </div>
    </>
  );
}
