/**
 * 远程开发主页面 — IDE 布局
 *
 * 布局：
 *   上半部分：左 Claude 对话 | 中 文件内容查看 | 右 文件树
 *   下半部分：终端横栏（可拖拽调节高度）
 *
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

/** 路径面包屑 */
function PathBreadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const segments = path.split('/').filter(Boolean);
  return (
    <div className="rd-breadcrumb">
      <span
        className="rd-breadcrumb-seg rd-breadcrumb-root"
        role="button"
        tabIndex={0}
        onClick={() => onNavigate('/')}
      >
        /
      </span>
      {segments.map((seg, i) => {
        const fullPath = '/' + segments.slice(0, i + 1).join('/');
        return (
          <span key={fullPath} className="rd-breadcrumb-item">
            <span className="rd-breadcrumb-sep">/</span>
            <span
              className="rd-breadcrumb-seg"
              role="button"
              tabIndex={0}
              onClick={() => onNavigate(fullPath)}
            >
              {seg}
            </span>
          </span>
        );
      })}
    </div>
  );
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

  const [leftVisible, setLeftVisible] = useState(true);
  const [rightVisible, setRightVisible] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHRef = useRef(0);

  const [configModal, setConfigModal] = useState<ConfigModal>(null);
  const [showMachineForm, setShowMachineForm] = useState(false);
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // --- File browser state ---
  const [rootPath, setRootPath] = useState('/');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);

  useEffect(() => {
    if (!api) return;
    createMachineService(api).listMachines()
      .then((list) => setMachines(list))
      .catch(console.error);
  }, [api, setMachines]);

  useEffect(() => {
    if (selectedMachineId) {
      addTerminal(selectedMachineId);
    }
  }, [selectedMachineId, addTerminal]);

  useEffect(() => {
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
    setRootPath('/');
    setTreeKey((k) => k + 1);
  }, [selectedMachineId]);

  const handleBreadcrumbNavigate = useCallback((p: string) => {
    setRootPath(p);
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
    setTreeKey((k) => k + 1);
  }, []);

  const handleSelectFile = useCallback(async (entry: FileEntry) => {
    if (!selectedMachineId || !api) return;

    if (entry.is_dir) {
      setRootPath(entry.path);
      setSelectedFile(null);
      setFileContent(null);
      setFileError(null);
      setTreeKey((k) => k + 1);
      return;
    }

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

  const handleBackToTree = useCallback(() => {
    setSelectedFile(null);
    setFileContent(null);
    setFileError(null);
  }, []);

  const handleMachineChange = useCallback((id: string) => {
    setSelectedMachineId(id || null);
  }, [setSelectedMachineId]);

  // ─── 终端高度拖拽 ───
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartHRef.current = terminalHeight;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = dragStartYRef.current - ev.clientY;
      const next = Math.max(80, Math.min(window.innerHeight * 0.6, dragStartHRef.current + delta));
      setTerminalHeight(next);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

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

      {/* ========== IDE Body: 三列，终端被两侧夹住 ========== */}
      <div className="rd-ide-body">
        {/* --- Left: Claude Dialog (全高) --- */}
        {leftVisible && (
          <div className="rd-ide-left">
            <DialogPanel api={api} embedded />
          </div>
        )}

        {/* --- Center: 编辑器 + 终端（垂直分割） --- */}
        <div className="rd-ide-center">
          {/* 编辑器区域 */}
          <div className="rd-ide-editor">
            {!selectedFile && (
              <div className="rd-editor-empty">
                <span>从右侧文件树选择文件查看</span>
              </div>
            )}

            {selectedFile && (
              <div className="rd-editor-content">
                <div className="rd-editor-tab-bar">
                  <span className="rd-editor-tab active">{selectedFile.name}</span>
                  <button
                    type="button"
                    className="rd-editor-tab-close"
                    onClick={handleBackToTree}
                    title="关闭文件"
                  >
                    ✕
                  </button>
                  <span className="rd-editor-tab-meta">
                    {selectedFile.permissions} · {formatSize(selectedFile.size)}
                  </span>
                </div>
                <div className="rd-editor-body">
                  {fileLoading && <div className="rd-loading" style={{ padding: 16 }}>加载中…</div>}
                  {fileError && (
                    <div style={{ padding: 12, color: 'var(--status-error)', fontSize: 13 }}>{fileError}</div>
                  )}
                  {fileContent !== null && (
                    <FileViewer
                      filename={selectedFile.name}
                      content={fileContent}
                      truncated={selectedFile.size > 1024 * 1024}
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 拖拽条 */}
          <div
            className="rd-ide-resize-handle"
            onMouseDown={handleResizeMouseDown}
            role="separator"
            aria-orientation="horizontal"
          />

          {/* 终端区域 */}
          <div className="rd-ide-bottom" style={{ height: terminalHeight, minHeight: 80 }}>
            <TerminalPanel api={api} embedded />
          </div>
        </div>

        {/* --- Right: File Tree Sidebar (全高) --- */}
        {rightVisible && (
          <div className="rd-ide-right">
            <div className="rd-ide-panel-header">
              <span className="rd-ide-panel-title">文件浏览</span>
            </div>
            <PathBreadcrumb path={rootPath} onNavigate={handleBreadcrumbNavigate} />
            <div className="rd-ide-right-body">
              {!selectedMachineId && (
                <div className="rd-empty">请先选择机器</div>
              )}
              {selectedMachineId && (
                <FileTree
                  key={`${selectedMachineId}-${treeKey}`}
                  api={api}
                  machineId={selectedMachineId}
                  rootPath={rootPath}
                  selectedPath={selectedFile?.path ?? null}
                  onSelect={(entry) => void handleSelectFile(entry)}
                />
              )}
            </div>
          </div>
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
