/**
 * 禁言设置组件
 */

import { MenuHeader } from './MenuHeader';
import { formatMuteDuration, MUTE_DURATION_OPTIONS } from './utils';
import type { GroupMember } from '../../../api/groups';

interface MuteSettingsProps {
  member: GroupMember;
  duration: number;
  loading: boolean;
  onBack: () => void;
  onDurationChange: (duration: number) => void;
  onConfirm: () => void;
}

export function MuteSettings({
  member,
  duration,
  loading,
  onBack,
  onDurationChange,
  onConfirm,
}: MuteSettingsProps) {
  return (
    <>
      <MenuHeader title={`禁言 ${member.user_nickname}`} onBack={onBack} />
      <div className="menu-form">
        <div className="mute-options">
          {MUTE_DURATION_OPTIONS.map((mins) => (
            <button
              key={mins}
              className={`mute-option ${duration === mins ? 'active' : ''}`}
              onClick={() => onDurationChange(mins)}
            >
              {formatMuteDuration(mins)}
            </button>
          ))}
        </div>
        <button
          className="menu-submit"
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? '处理中...' : '确认禁言'}
        </button>
      </div>
    </>
  );
}

