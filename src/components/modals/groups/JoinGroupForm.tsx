/**
 * 加入群聊表单组件
 */

import { MotionAppButton } from '../../common/AppButton';

interface JoinGroupFormProps {
  inviteCode: string;
  loading: boolean;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
}

export function JoinGroupForm({
  inviteCode,
  loading,
  onCodeChange,
  onSubmit,
}: JoinGroupFormProps) {
  return (
    <>
      <div className="form-group">
        <label>邀请码</label>
        <input
          type="text"
          className="glass-input"
          value={inviteCode}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="输入群邀请码"
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <MotionAppButton
        variant="primary"
        size="lg"
        block
        onClick={onSubmit}
        disabled={loading || !inviteCode.trim()}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? '加入中...' : '加入群聊'}
      </MotionAppButton>
    </>
  );
}
