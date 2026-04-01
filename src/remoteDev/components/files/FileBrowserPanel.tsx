/**
 * 文件浏览面板
 *
 * 左侧目录树 + 右侧文件预览（Monaco 只读）
 * 支持路径输入跳转
 */

import { useCallback, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { useRemoteDevStore } from '../../stores/remoteDevStore';
import { createFileService } from '../../services/fileService';
import type { FileEntry } from '../../types/remoteDev';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileBrowserPanel({ api }: { api: RemoteDevApiClient }) {
  const selectedMachineId = useRemoteDevStore((s) => s.selectedMachineId);
  const machines = useRemoteDevStore((s) => s.machines);
  const selected = machines.find((m) => m.machine_id === selectedMachineId);

  const [rootPath, setRootPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  const handleNavigate = useCallback(() => {
    const p = pathInput.trim() || '/';
    setRootPath(p);
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
    setTreeKey((k) => k + 1);
  }, [pathInput]);

  const handleSelectFile = useCallback(async (entry: FileEntry) => {
    if (entry.is_dir) return;
    if (!selectedMachineId) return;

    setSelectedFile(entry);
    setFileContent(null);
    setFileError(null);
    setFileLoading(true);

    try {
      const content = await createFileService(api).readFile(selectedMachineId, entry.path);
      setFileContent(content);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : '读取文件失败');
    } finally {
      setFileLoading(false);
    }
  }, [api, selectedMachineId]);

  if (!selectedMachineId || !selected) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-header">
          <h2 className="rd-panel-title">文件浏览</h2>
        </div>
        <div className="rd-empty">请先在「机器管理」中选择一台机器</div>
      </div>
    );
  }

  return (
    <div className="rd-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 520, padding: 0 }}>
      <div className="rd-panel-header" style={{ padding: '14px 20px' }}>
        <h2 className="rd-panel-title">文件浏览 · {selected.name}</h2>
      </div>

      <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8 }}>
        <input
          className="rd-input"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleNavigate(); }}
          placeholder="输入路径并回车"
          style={{ flex: 1 }}
        />
        <button type="button" className="rd-btn rd-btn-primary" onClick={handleNavigate}>
          跳转
        </button>
      </div>

      <div className="rd-file-browser" style={{ flex: 1, minHeight: 400 }}>
        <div className="rd-file-tree">
          <FileTree
            key={treeKey}
            api={api}
            machineId={selectedMachineId}
            rootPath={rootPath}
            selectedPath={selectedFile?.path ?? null}
            onSelect={(entry) => void handleSelectFile(entry)}
          />
        </div>

        <div className="rd-file-viewer">
          {!selectedFile && (
            <div className="rd-empty" style={{ height: '100%' }}>
              点击左侧文件查看内容
            </div>
          )}
          {selectedFile && fileLoading && (
            <div className="rd-loading" style={{ height: '100%' }}>
              加载文件中…
            </div>
          )}
          {selectedFile && fileError && (
            <div style={{ padding: 20 }}>
              <p style={{ color: 'var(--status-error)', fontSize: 13 }}>{fileError}</p>
            </div>
          )}
          {selectedFile && fileContent !== null && (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                padding: '6px 12px',
                fontSize: 11,
                color: 'var(--text-light)',
                borderBottom: '1px solid var(--border-subtle)',
              }}>
                {selectedFile.permissions} · {formatSize(selectedFile.size)} · {new Date(selectedFile.modified_at).toLocaleString()}
              </div>
              <div style={{ flex: 1 }}>
                <FileViewer
                  filename={selectedFile.name}
                  content={fileContent}
                  truncated={selectedFile.size > 1024 * 1024}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
