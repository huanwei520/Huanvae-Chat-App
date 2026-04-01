/**
 * 递归目录树组件
 *
 * 懒加载子目录：点击文件夹时才请求子目录内容
 */

import { useCallback, useState } from 'react';
import type { FileEntry } from '../../types/remoteDev';
import { createFileService } from '../../services/fileService';
import type { RemoteDevApiClient } from '../../services/apiClient';

interface FileTreeNodeProps {
  entry: FileEntry;
  api: RemoteDevApiClient;
  machineId: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (entry: FileEntry) => void;
}

function FileTreeNode({ entry, api, machineId, depth, selectedPath, onSelect }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.is_dir) {
      onSelect(entry);
      return;
    }

    if (expanded) {
      setExpanded(false);
      return;
    }

    if (children === null) {
      setLoading(true);
      try {
        const items = await createFileService(api).listDir(machineId, entry.path);
        const sorted = items.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setChildren(sorted);
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }

    setExpanded(true);
  }, [entry, expanded, children, api, machineId, onSelect]);

  const isSelected = selectedPath === entry.path;
  const icon = entry.is_dir
    ? expanded ? '📂' : '📁'
    : '📄';

  return (
    <>
      <div
        className={`rd-file-tree-item${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        role="button"
        tabIndex={0}
        onClick={() => void toggle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void toggle();
          }
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
        {loading && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-light)' }}>…</span>}
      </div>
      {expanded && children && children.map((child) => (
        <FileTreeNode
          key={child.path}
          entry={child}
          api={api}
          machineId={machineId}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

interface FileTreeProps {
  api: RemoteDevApiClient;
  machineId: string;
  rootPath: string;
  selectedPath: string | null;
  onSelect: (entry: FileEntry) => void;
}

export function FileTree({ api, machineId, rootPath, selectedPath, onSelect }: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await createFileService(api).listDir(machineId, rootPath);
      const sorted = items.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载目录失败');
    } finally {
      setLoading(false);
    }
  }, [api, machineId, rootPath]);

  // Load on first render / rootPath change
  useState(() => {
    void loadRoot();
  });

  if (loading && !entries) {
    return <div className="rd-loading" style={{ padding: 16 }}>加载目录…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 12 }}>
        <p style={{ color: 'var(--status-error)', fontSize: 12, marginBottom: 8 }}>{error}</p>
        <button type="button" className="rd-btn rd-btn-ghost" style={{ fontSize: 11 }} onClick={() => void loadRoot()}>
          重试
        </button>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return <div className="rd-empty" style={{ padding: 16, fontSize: 12 }}>空目录</div>;
  }

  return (
    <div>
      {entries.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          api={api}
          machineId={machineId}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
