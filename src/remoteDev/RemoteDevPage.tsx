/**
 * 远程开发主页面 — IDE 布局
 *
 * 布局：左侧 Claude 对话 | 中间代码查看 | 右侧文件树 | 底部终端
 * 机器管理和 Token 管理通过 Header 按钮以弹窗形式打开
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { parseWindowDataFromUrl } from './api';
import { createRemoteDevApiClient, type RemoteDevApiClient } from './services/apiClient';
import { createMachineService } from './services/machineService';
import { createFileService } from './services/fileService';
import { useRemoteDevStore } from './stores/remoteDevStore';
import { TokenListPanel } from './components/tokens/TokenListPanel';
import { UsagePanel } from './components/tokens/UsagePanel';
import { MachineListPanel } from './components/machines/MachineListPanel';
import { MachineForm } from './components/machines/MachineForm';
import { SetupStatusPanel } from './components/machines/SetupStatusPanel';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { DialogPanel } from './components/dialog/DialogPanel';
import { FileTree } from './components/files/FileTree';
import { FileViewer } from './components/files/FileViewer';
import type { FileEntry, ConfigModal } from './types/remoteDev';
import './RemoteDevPage.css';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RemoteDevPage() {
  const windowData = useMemo(() => parseWindowDataFromUrl(), []);

  const api = useMemo<RemoteDevApiClient | null>(() => {
    if (!windowData) return null;
    return createRemoteDevApiClient({
      serverUrl: windowData.serverUrl,
      accessToken: windowData.accessToken,
      refreshToken: windowData.refreshToken,
      onTokenRefresh: (newAccess) => {
        console.warn('[RemoteDev] Token 已刷新', { newAccess: newAccess.slice(0, 10) + '...' });
      },
      onSessionExpired: () => {
        console.error('[RemoteDev] 会话已过期');
      },
    });
  }, [windowData]);

  const machines = useRemoteDevStore((s) => s.machines);
  const setMachines = useRemoteDevStore((s) => s.setMachines);
  const selectedMachineId = useRemoteDevStore((s) => s.selectedMachineId);
  const setSelectedMachineId = useRemoteDevStore((s) => s.setSelectedMachineId);
  const addTerminal = useRemoteDevStore((s) => s.addTerminal);

  // --- Panel visibility ---
  const [leftVisible, setLeftVisible] = useState(true);
  const [bottomVisible, setBottomVisible] = useState(true);
  const [rightVisible, setRightVisible] = useState(true);

  // --- Terminal panel resize ---
  const [terminalHeight, setTerminalHeight] = useState(260);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(0);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const delta = dragStartYRef.current - e.clientY;
      const newHeight = Math.max(120, Math.min(600, dragStartHeightRef.current + delta));
      setTerminalHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = terminalHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [terminalHeight]);

  // --- Config modal ---
  const [configModal, setConfigModal] = useState<ConfigModal>(null);
  const [showMachineForm, setShowMachineForm] = useState(false);
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // --- File browser state ---
  const [rootPath, setRootPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  // Load machines on mount
  useEffect(() => {
    if (!api) return;
    createMachineService(api).listMachines()
      .then((list) => setMachines(list))
      .catch(console.error);
  }, [api, setMachines]);

  // Auto-connect terminal when machine selected
  useEffect(() => {
    if (selectedMachineId) {
      addTerminal(selectedMachineId);
    }
  }, [selectedMachineId, addTerminal]);

  // Reset file browser when machine changes
  useEffect(() => {
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
    setRootPath('/');
    setPathInput('/');
    setTreeKey((k) => k + 1);
  }, [selectedMachineId]);

  const handlePathNavigate = useCallback(() => {
    const p = pathInput.trim() || '/';
    setRootPath(p);
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
    setTreeKey((k) => k + 1);
  }, [pathInput]);

  const handleSelectFile = useCallback(async (entry: FileEntry) => {
    if (entry.is_dir || !selectedMachineId || !api) return;

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

  const handleMachineChange = useCallback((id: string) => {
    setSelectedMachineId(id || null);
  }, [setSelectedMachineId]);

  if (!windowData || !api) {
    return (
      <div className="rd-page">
        <div className="rd-empty" style={{ flex: 1 }}>
          <p>无法加载远程开发数据</p>
          <p style={{ fontSize: 12 }}>请从主窗口重新打开</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rd-page">
      {/* ========== IDE Header ========== */}
      <div className="rd-ide-header">
        <div className="rd-ide-header-left">
          <label htmlFor="rd-machine-sel">机器</label>
          <select
            id="rd-machine-sel"
            className="rd-ide-machine-select"
            value={selectedMachineId ?? ''}
            onChange={(e) => handleMachineChange(e.target.value)}
          >
            <option value="">选择机器…</option>
            {machines.map((m) => (
              <option key={m.machine_id} value={m.machine_id}>
                {m.name} ({m.hostname})
              </option>
            ))}
          </select>
        </div>

        <div className="rd-ide-header-right">
          <button
            type="button"
            className={`rd-ide-header-btn${leftVisible ? ' active' : ''}`}
            onClick={() => setLeftVisible(!leftVisible)}
          >
            💬 对话
          </button>
          <button
            type="button"
            className={`rd-ide-header-btn${rightVisible ? ' active' : ''}`}
            onClick={() => setRightVisible(!rightVisible)}
          >
            📂 文件
          </button>
          <button
            type="button"
            className={`rd-ide-header-btn${bottomVisible ? ' active' : ''}`}
            onClick={() => setBottomVisible(!bottomVisible)}
          >
            ⌨ 终端
          </button>

          <div className="rd-ide-separator" />

          <button
            type="button"
            className="rd-ide-header-btn"
            onClick={() => setConfigModal('machines')}
          >
            ⚙ 管理机器
          </button>
          <button
            type="button"
            className="rd-ide-header-btn"
            onClick={() => setConfigModal('tokens')}
          >
            🔑 Token
          </button>
        </div>
      </div>

      {/* ========== IDE Body ========== */}
      <div className="rd-ide-body">
        <div className="rd-ide-main">
          {/* --- Left: Claude Dialog --- */}
          {leftVisible && (
            <div className="rd-ide-left">
              <div className="rd-ide-panel-header">
                <span className="rd-ide-panel-title">Claude 对话</span>
              </div>
              <div className="rd-ide-left-body">
                <DialogPanel api={api} embedded />
              </div>
            </div>
          )}

          {/* --- Center: Code Viewer --- */}
          <div className="rd-ide-center">
            {selectedFile && (
              <div className="rd-ide-center-header">
                <span className="rd-ide-center-filename">{selectedFile.path}</span>
                <span className="rd-ide-center-meta">
                  {selectedFile.permissions} · {formatSize(selectedFile.size)}
                </span>
              </div>
            )}
            <div className="rd-ide-center-body">
              {!selectedMachineId && (
                <div className="rd-empty" style={{ height: '100%' }}>
                  请在顶部选择一台机器
                </div>
              )}
              {selectedMachineId && !selectedFile && (
                <div className="rd-empty" style={{ height: '100%' }}>
                  在右侧文件树中选择文件查看内容
                </div>
              )}
              {selectedFile && fileLoading && (
                <div className="rd-loading" style={{ height: '100%' }}>加载中…</div>
              )}
              {selectedFile && fileError && (
                <div style={{ padding: 20 }}>
                  <p style={{ color: 'var(--status-error)', fontSize: 13 }}>{fileError}</p>
                </div>
              )}
              {selectedFile && fileContent !== null && (
                <FileViewer
                  filename={selectedFile.name}
                  content={fileContent}
                  truncated={selectedFile.size > 1024 * 1024}
                />
              )}
            </div>
          </div>

          {/* --- Right: File Tree --- */}
          {rightVisible && (
            <div className="rd-ide-right">
              <div className="rd-ide-panel-header">
                <span className="rd-ide-panel-title">文件浏览</span>
              </div>
              <div className="rd-ide-right-path">
                <input
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePathNavigate(); }}
                  placeholder="/"
                />
                <button type="button" onClick={handlePathNavigate}>跳转</button>
              </div>
              <div className="rd-ide-right-body">
                {selectedMachineId ? (
                  <FileTree
                    key={`${selectedMachineId}-${treeKey}`}
                    api={api}
                    machineId={selectedMachineId}
                    rootPath={rootPath}
                    selectedPath={selectedFile?.path ?? null}
                    onSelect={(entry) => void handleSelectFile(entry)}
                  />
                ) : (
                  <div className="rd-empty">请先选择机器</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* --- Bottom: Terminal (resizable) --- */}
        {bottomVisible && (
          <>
            <div
              className="rd-ide-resize-handle"
              onMouseDown={handleDragStart}
              role="separator"
              aria-orientation="horizontal"
            />
            <div className="rd-ide-bottom" style={{ height: terminalHeight }}>
              <TerminalPanel api={api} embedded />
            </div>
          </>
        )}
      </div>

      {/* ========== Config Modals ========== */}
      {configModal === 'machines' && (
        <div className="rd-dialog-overlay" onClick={() => setConfigModal(null)} role="presentation">
          <div className="rd-dialog rd-dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog">
            <MachineListPanel
              api={api}
              onAdd={() => { setEditingMachineId(null); setShowMachineForm(true); }}
              onEdit={(id) => { setEditingMachineId(id); setShowMachineForm(true); }}
              onSetup={(id) => { setSelectedMachineId(id); setShowSetup(true); }}
            />
            <div className="rd-dialog-actions">
              <button type="button" className="rd-btn rd-btn-ghost" onClick={() => setConfigModal(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {configModal === 'tokens' && (
        <div className="rd-dialog-overlay" onClick={() => setConfigModal(null)} role="presentation">
          <div className="rd-dialog rd-dialog-wide" onClick={(e) => e.stopPropagation()} role="dialog">
            <TokenListPanel api={api} />
            <UsagePanel api={api} />
            <div className="rd-dialog-actions">
              <button type="button" className="rd-btn rd-btn-ghost" onClick={() => setConfigModal(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showMachineForm && (
        <MachineForm
          api={api}
          machineId={editingMachineId}
          onClose={() => { setShowMachineForm(false); setEditingMachineId(null); }}
        />
      )}

      {showSetup && selectedMachineId && (
        <SetupStatusPanel
          api={api}
          machineId={selectedMachineId}
          onClose={() => setShowSetup(false)}
        />
      )}
    </div>
  );
}
