/**
 * 远程开发顶部标签导航
 */

import { useRemoteDevStore } from '../stores/remoteDevStore';
import type { RemoteDevTab } from '../types/remoteDev';

const TABS: { key: RemoteDevTab; label: string }[] = [
  { key: 'machines', label: '机器管理' },
  { key: 'tokens', label: '中继 Token' },
  { key: 'terminal', label: '终端' },
  { key: 'files', label: '文件浏览' },
  { key: 'dialog', label: 'Claude 对话' },
];

export function TabNavigation() {
  const activeTab = useRemoteDevStore((s) => s.activeTab);
  const setActiveTab = useRemoteDevStore((s) => s.setActiveTab);

  return (
    <nav className="rd-tab-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          className={`rd-tab-btn ${activeTab === tab.key ? 'active' : ''}`}
          onClick={() => setActiveTab(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
