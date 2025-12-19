/**
 * 标签导航组件
 */

import type { TabType } from './types';

interface TabNavigationProps {
  activeTab: TabType;
  friendRequestsCount: number;
  groupInvitesCount: number;
  onTabChange: (tab: TabType) => void;
}

export function TabNavigation({
  activeTab,
  friendRequestsCount,
  groupInvitesCount,
  onTabChange,
}: TabNavigationProps) {
  return (
    <div className="add-modal-tabs">
      <div className="tab-group">
        <span className="tab-group-label">好友</span>
        <div className="tab-buttons">
          <button
            className={`tab-btn ${activeTab === 'add-friend' ? 'active' : ''}`}
            onClick={() => onTabChange('add-friend')}
          >
            添加
          </button>
          <button
            className={`tab-btn ${activeTab === 'friend-requests' ? 'active' : ''}`}
            onClick={() => onTabChange('friend-requests')}
          >
            申请
            {friendRequestsCount > 0 && (
              <span className="badge">{friendRequestsCount}</span>
            )}
          </button>
        </div>
      </div>
      <div className="tab-group">
        <span className="tab-group-label">群聊</span>
        <div className="tab-buttons">
          <button
            className={`tab-btn ${activeTab === 'create-group' ? 'active' : ''}`}
            onClick={() => onTabChange('create-group')}
          >
            创建
          </button>
          <button
            className={`tab-btn ${activeTab === 'join-group' ? 'active' : ''}`}
            onClick={() => onTabChange('join-group')}
          >
            加入
          </button>
          <button
            className={`tab-btn ${activeTab === 'group-invites' ? 'active' : ''}`}
            onClick={() => onTabChange('group-invites')}
          >
            邀请
            {groupInvitesCount > 0 && (
              <span className="badge">{groupInvitesCount}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
