/**
 * 群聊管理标签导航组件
 */

import { PlusIcon } from '../../common/Icons';
import type { TabType } from './types';

interface GroupsTabNavigationProps {
  activeTab: TabType;
  invitationsCount: number;
  onTabChange: (tab: TabType) => void;
}

export function GroupsTabNavigation({
  activeTab,
  invitationsCount,
  onTabChange,
}: GroupsTabNavigationProps) {
  return (
    <div className="profile-tabs groups-tabs">
      <button
        className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`}
        onClick={() => onTabChange('list')}
      >
        我的群聊
      </button>
      <button
        className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
        onClick={() => onTabChange('create')}
      >
        <PlusIcon />
      </button>
      <button
        className={`tab-btn ${activeTab === 'join' ? 'active' : ''}`}
        onClick={() => onTabChange('join')}
      >
        加入
      </button>
      <button
        className={`tab-btn ${activeTab === 'invitations' ? 'active' : ''}`}
        onClick={() => onTabChange('invitations')}
      >
        邀请
        {invitationsCount > 0 && (
          <span className="badge">{invitationsCount}</span>
        )}
      </button>
    </div>
  );
}
