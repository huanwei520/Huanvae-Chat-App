/**
 * 文件夹选择器
 *
 * 点击触发浮层显示目录树，点击目录即选中
 * 复用 fileService 的 listDir 接口获取目录列表
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileService } from '../../services/fileService';
import type { RemoteDevApiClient } from '../../services/apiClient';
import type { FileEntry } from '../../types/remoteDev';

interface FolderNodeProps {
  entry: FileEntry;
  api: RemoteDevApiClient;
  machineId: string;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}

function FolderNode({ entry, api, machineId, depth, selectedPath, onSelect }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    onSelect(entry.path);

    if (!expanded && children === null) {
      setLoading(true);
      try {
        const items = await createFileService(api).listDir(machineId, entry.path);
        setChildren(items.filter((e) => e.is_dir).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        setChildren([]);
      } finally {
        setLoading(false);
      }
    }

    setExpanded(!expanded);
  }, [entry.path, expanded, children, api, machineId, onSelect]);

  const isSelected = selectedPath === entry.path;

  return (
    <>
      <div
        className={`rd-folder-node${isSelected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        role="button"
        tabIndex={0}
        onClick={() => void handleClick()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void handleClick();
          }
        }}
      >
        <span style={{ fontSize: 12, flexShrink: 0, width: 14, textAlign: 'center' }}>
          {expanded ? '▼' : '▶'}
        </span>
        <span style={{ fontSize: 14, flexShrink: 0 }}>📁</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</span>
        {loading && <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5 }}>…</span>}
      </div>
      {expanded && children && children.map((child) => (
        <FolderNode
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

interface FolderPickerProps {
  api: RemoteDevApiClient;
  machineId: string;
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
}

export function FolderPicker({ api, machineId, value, onChange, disabled }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [rootDirs, setRootDirs] = useState<FileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRootDirs(null);
    setOpen(false);
  }, [machineId]);

  useEffect(() => {
    if (!open || rootDirs) return;
    setLoading(true);
    createFileService(api).listDir(machineId, '/')
      .then((items) => {
        setRootDirs(items.filter((e) => e.is_dir).sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => setRootDirs([]))
      .finally(() => setLoading(false));
  }, [open, rootDirs, api, machineId]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleSelect = useCallback((path: string) => {
    onChange(path);
  }, [onChange]);

  return (
    <div className="rd-folder-picker" ref={pickerRef}>
      <div
        className={`rd-folder-picker-display${disabled ? ' disabled' : ''}`}
        onClick={() => { if (!disabled) setOpen(!open); }}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <span className="rd-folder-picker-value">{value || '选择文件夹…'}</span>
        <span className="rd-folder-picker-arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="rd-folder-picker-dropdown">
          {/* Root "/" selectable */}
          <div
            className={`rd-folder-node${value === '/' ? ' selected' : ''}`}
            style={{ paddingLeft: 8 }}
            role="button"
            tabIndex={0}
            onClick={() => handleSelect('/')}
          >
            <span style={{ fontSize: 14, flexShrink: 0 }}>🏠</span>
            <span>/ (根目录)</span>
          </div>

          {loading && <div style={{ padding: 8, fontSize: 12, color: '#8b949e' }}>加载中…</div>}
          {rootDirs && rootDirs.map((entry) => (
            <FolderNode
              key={entry.path}
              entry={entry}
              api={api}
              machineId={machineId}
              depth={1}
              selectedPath={value}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
