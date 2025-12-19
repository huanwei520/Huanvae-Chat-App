/**
 * 添加好友表单 Tab
 */

import { motion } from 'framer-motion';

interface AddFriendTabProps {
  friendId: string;
  friendReason: string;
  loading: boolean;
  onFriendIdChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSubmit: () => void;
}

export function AddFriendTab({
  friendId,
  friendReason,
  loading,
  onFriendIdChange,
  onReasonChange,
  onSubmit,
}: AddFriendTabProps) {
  return (
    <>
      <div className="form-group">
        <label>用户 ID</label>
        <input
          type="text"
          className="glass-input"
          value={friendId}
          onChange={(e) => onFriendIdChange(e.target.value)}
          placeholder="输入对方的用户 ID"
        />
      </div>
      <div className="form-group">
        <label>验证消息（可选）</label>
        <input
          type="text"
          className="glass-input"
          value={friendReason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="向对方介绍一下自己"
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
      </div>
      <motion.button
        className="glass-button"
        onClick={onSubmit}
        disabled={loading || !friendId.trim()}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? '发送中...' : '发送好友请求'}
      </motion.button>
    </>
  );
}

