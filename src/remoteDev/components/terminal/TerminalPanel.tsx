/**
 * 多终端标签页管理
 *
 * 支持 embedded 模式（无外层面板包装，直接嵌入 IDE 底部面板）
 * 选中机器后自动出现在标签中
 */

import { useEffect, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { useRemoteDevStore } from '../../stores/remoteDevStore';
import { TerminalInstance } from './TerminalInstance';

export function TerminalPanel({ api, embedded }: { api: RemoteDevApiClient; embedded?: boolean }) {
  const machines = useRemoteDevStore((s) => s.machines);
  const openTerminals = useRemoteDevStore((s) => s.openTerminals);
  const removeTerminal = useRemoteDevStore((s) => s.removeTerminal);

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (openTerminals.length === 0) {
      setActiveId(null);
      return;
    }
    if (!activeId || !openTerminals.includes(activeId)) {
      setActiveId(openTerminals[openTerminals.length - 1]);
    }
  }, [openTerminals, activeId]);

  const terminalContent = (
    <div
      className="rd-terminal-container"
      style={embedded ? undefined : {
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
        minHeight: 360,
      }}
    >
      <div className="rd-terminal-tabs">
        {openTerminals.length === 0 ? (
          <span style={{ padding: '6px 12px', fontSize: 12, color: '#8b949e' }}>
            选择机器后自动打开终端
          </span>
        ) : (
          openTerminals.map((id) => {
            const m = machines.find((x) => x.machine_id === id);
            const label = m?.name ?? id.slice(0, 8);
            const isActive = id === activeId;
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  type="button"
                  className={`rd-terminal-tab${isActive ? ' active' : ''}`}
                  onClick={() => setActiveId(id)}
                >
                  {label}
                </button>
                <button
                  type="button"
                  className="rd-terminal-tab-close"
                  aria-label="关闭标签"
                  onClick={() => {
                    removeTerminal(id);
                    if (activeId === id) {
                      setActiveId(null);
                    }
                  }}
                >
                  ×
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="rd-terminal-body">
        {openTerminals.length === 0 ? (
          <div className="rd-empty" style={{ padding: 16, color: '#8b949e' }}>在顶部选择机器即可打开终端</div>
        ) : (
          openTerminals.map((id) => (
            <TerminalInstance
              key={id}
              api={api}
              machineId={id}
              visible={id === activeId}
            />
          ))
        )}
      </div>
    </div>
  );

  if (embedded) return terminalContent;

  return (
    <div className="rd-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 480 }}>
      <div className="rd-panel-header">
        <h2 className="rd-panel-title">Web 终端</h2>
      </div>
      {terminalContent}
    </div>
  );
}
