/**
 * 小程序管理弹窗
 *
 * 功能：
 * - 双 Tab 切换：探索已发布小程序 / 管理我的小程序
 * - 搜索过滤
 * - 创建小程序（带表单弹窗）
 * - 小程序卡片：打开、发布/取消发布、容器操作、删除
 * - 容器详情弹窗（SSH 信息展示）
 *
 * 复用：
 * - modal-overlay / modal-content / modal-header / close-btn / files-count CSS 类
 * - modalVariants / contentVariants 动画模式（与 FilesModal 一致）
 * - cardVariants 使用 custom stagger 延迟入场，避免 layout 动画冲突
 * - SearchIcon / CloseIcon 来自 Icons.tsx
 * - LoadingSpinner 公共组件
 * - createPortal 渲染到 body（与 Sidebar 浮层一致）
 * - useMiniApps Hook 封装全部状态逻辑（解构出具体函数以稳定回调引用）
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SearchIcon, CloseIcon } from '../common/Icons';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useSession } from '../../contexts/SessionContext';
import {
  useMiniApps,
  type MiniAppTab,
  type MiniApp,
  type MiniAppStatus,
  type CreateMiniAppRequest,
  type MiniAppContainer,
} from '../../hooks/useMiniApps';
import { OAuthClientsPanel } from '../oauth/OAuthClientsPanel';
import { buildMiniAppLaunchUrl, buildResourceProposal } from './launch';

// ============================================
// 类型定义
// ============================================

interface MiniAppsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// 常量
// ============================================

const TAB_CONFIG: { key: MiniAppTab; label: string }[] = [
  { key: 'explore', label: '探索' },
  { key: 'mine', label: '我的' },
];

const STATUS_MAP: Record<MiniAppStatus, { label: string; className: string }> = {
  pending: { label: '待审批', className: 'status-pending' },
  approved: { label: '已批准', className: 'status-approved' },
  rejected: { label: '已驳回', className: 'status-rejected' },
  draft: { label: '草稿', className: 'status-draft' },
  running: { label: '运行中', className: 'status-running' },
  published: { label: '已发布', className: 'status-published' },
  stopped: { label: '已停止', className: 'status-stopped' },
};

// ============================================
// 动画变体
// modalVariants / contentVariants 与 FilesModal 保持一致
// cardVariants 使用 custom(index) 实现 stagger 入场
// Tab 切换时 grid 整组 mode="wait" 淡入淡出，不使用 layout/popLayout
// ============================================

const modalVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const contentVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, damping: 25, stiffness: 300 },
  },
  exit: { opacity: 0, scale: 0.95, y: 20 },
};

const cardVariants = {
  initial: { opacity: 0, y: 16 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.03, duration: 0.2 },
  }),
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

// ============================================
// 子组件
// ============================================

/** 状态徽章 */
function StatusBadge({ status }: { status: MiniAppStatus }) {
  const config = STATUS_MAP[status] || STATUS_MAP.draft;
  return <span className={`miniapp-status-badge ${config.className}`}>{config.label}</span>;
}

/** 空状态 */
function EmptyState({
  loading,
  error,
  searchQuery,
  count,
  isMine,
}: {
  loading: boolean;
  error: string | null;
  searchQuery: string;
  count: number;
  isMine: boolean;
}) {
  if (loading && count === 0) {
    return (
      <div className="miniapp-loading">
        <LoadingSpinner />
        <span>加载中...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="miniapp-error">
        <span className="miniapp-error-icon">&#x26A0;</span>
        <span>{error}</span>
      </div>
    );
  }
  if (count === 0) {
    let text = '暂无已发布的小程序';
    if (searchQuery) {
      text = '未找到匹配的小程序';
    } else if (isMine) {
      text = '暂无小程序，点击右上角创建';
    }
    return (
      <div className="miniapp-empty">
        <span className="miniapp-empty-icon">&#x1F4E6;</span>
        <span>{text}</span>
      </div>
    );
  }
  return null;
}

/** 创建弹窗 */
function CreateDialog({
  isOpen,
  onClose,
  onCreate,
  creating,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: CreateMiniAppRequest) => void;
  creating: boolean;
}) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [cpu, setCpu] = useState('');
  const [mem, setMem] = useState('');

  const handleSubmit = () => {
    if (!name.trim() || !displayName.trim()) {
      return;
    }
    onCreate({
      name: name.trim(),
      display_name: displayName.trim(),
      description: description.trim() || undefined,
      ...buildResourceProposal(cpu, mem),
    });
  };

  const handleClose = () => {
    setName('');
    setDisplayName('');
    setDescription('');
    setCpu('');
    setMem('');
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <motion.div
      className="modal-overlay miniapp-create-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleClose}
    >
      <motion.div
        className="miniapp-create-dialog"
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="miniapp-create-header">
          <h3>申请创建小程序</h3>
          <button className="close-btn" onClick={handleClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <label className="miniapp-field">
            <span className="miniapp-field-label">
              路径名称 <span className="miniapp-required">*</span>
            </span>
            <input
              type="text"
              placeholder="仅限小写字母、数字、短横线"
              value={name}
              onChange={(e) => setName(e.target.value)}
              pattern="[a-z0-9-]+"
              maxLength={50}
            />
          </label>
          <label className="miniapp-field">
            <span className="miniapp-field-label">
              显示名称 <span className="miniapp-required">*</span>
            </span>
            <input
              type="text"
              placeholder="小程序显示名称"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
            />
          </label>
          <label className="miniapp-field">
            <span className="miniapp-field-label">描述</span>
            <textarea
              placeholder="可选，简要描述小程序功能"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <div className="miniapp-field-row">
            <label className="miniapp-field">
              <span className="miniapp-field-label">CPU 核数（提议）</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                placeholder="默认 2"
                value={cpu}
                onChange={(e) => setCpu(e.target.value)}
              />
            </label>
            <label className="miniapp-field">
              <span className="miniapp-field-label">内存（提议，GB）</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="默认 2"
                value={mem}
                onChange={(e) => setMem(e.target.value)}
              />
            </label>
          </div>
          <p className="miniapp-field-hint">
            资源为申请提议值，管理员审批时可调整，并受后端硬上限限制；留空则使用默认 2核 / 2GB。
          </p>
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={handleClose}>
            取消
          </button>
          <button
            className="miniapp-btn primary"
            onClick={handleSubmit}
            disabled={creating || !name.trim() || !displayName.trim()}
          >
            {creating ? '提交中...' : '提交申请'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** 容器信息弹窗 */
function ContainerInfoDialog({
  info,
  onClose,
  onResetPassword,
  resetting,
}: {
  info: MiniAppContainer;
  onClose: () => void;
  onResetPassword: () => void;
  resetting: boolean;
}) {
  return createPortal(
    <motion.div
      className="modal-overlay miniapp-create-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="miniapp-create-dialog miniapp-container-dialog"
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="miniapp-create-header">
          <h3>容器信息</h3>
          <button className="close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <div className="miniapp-info-row">
            <span className="miniapp-info-label">名称</span>
            <span className="miniapp-info-value">{info.name}</span>
          </div>
          <div className="miniapp-info-row">
            <span className="miniapp-info-label">状态</span>
            <span className="miniapp-info-value">{info.status}</span>
          </div>
          <div className="miniapp-info-row">
            <span className="miniapp-info-label">容器 ID</span>
            <code className="miniapp-info-code">{info.container_id.slice(0, 12)}</code>
          </div>
          <div className="miniapp-info-row">
            <span className="miniapp-info-label">SSH 端口</span>
            <code className="miniapp-info-code">{info.ssh.ssh_port}</code>
          </div>
          <div className="miniapp-info-row">
            <span className="miniapp-info-label">SSH 用户</span>
            <code className="miniapp-info-code">{info.ssh.ssh_user}</code>
          </div>
          <div className="miniapp-info-row">
            <span className="miniapp-info-label">SSH 密码</span>
            <code className="miniapp-info-code">{info.ssh.ssh_password}</code>
          </div>
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={onClose}>
            关闭
          </button>
          <button
            className="miniapp-btn primary"
            onClick={onResetPassword}
            disabled={resetting}
          >
            {resetting ? '重置中...' : '重置密码'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

/** 小程序卡片 */
export function AppCard({
  app,
  index,
  isMine,
  operating,
  onOpen,
  onPublish,
  onUnpublish,
  onStart,
  onStop,
  onRestart,
  onContainerInfo,
  onDelete,
}: {
  app: MiniApp;
  index: number;
  isMine: boolean;
  operating: boolean;
  onOpen: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onContainerInfo: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      className="miniapp-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      custom={index}
      whileHover={{ y: -2 }}
    >
      <div className="miniapp-card-header">
        <div className="miniapp-card-icon">
          {app.icon_url ? (
            <img src={app.icon_url} alt={app.display_name} />
          ) : (
            <span className="miniapp-card-icon-placeholder">
              {app.display_name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="miniapp-card-meta">
          <h4 className="miniapp-card-name">{app.display_name}</h4>
          {isMine && <StatusBadge status={app.status} />}
        </div>
      </div>

      {app.description && (
        <p className="miniapp-card-desc">{app.description}</p>
      )}

      {isMine && app.status === 'rejected' && app.reject_reason && (
        <p className="miniapp-card-reject-reason">
          驳回原因：{app.reject_reason}
        </p>
      )}

      <div className="miniapp-card-info">
        <span className="miniapp-card-dev">
          {isMine ? app.name : app.developer_nickname}
        </span>
        <span className="miniapp-card-time">
          {app.published_at
            ? new Date(app.published_at).toLocaleDateString('zh-CN')
            : new Date(app.updated_at).toLocaleDateString('zh-CN')}
        </span>
      </div>

      <div className="miniapp-card-actions">
        <button
          className="miniapp-btn small primary"
          onClick={onOpen}
          disabled={operating || (isMine && app.status === 'stopped')}
        >
          打开
        </button>

        {isMine && (
          <>
            {app.status === 'running' && (
              <button
                className="miniapp-btn small"
                onClick={onPublish}
                disabled={operating}
              >
                发布
              </button>
            )}
            {app.status === 'published' && (
              <button
                className="miniapp-btn small"
                onClick={onUnpublish}
                disabled={operating}
              >
                取消发布
              </button>
            )}
            {app.status === 'stopped' && (
              <button
                className="miniapp-btn small"
                onClick={onStart}
                disabled={operating}
              >
                启动
              </button>
            )}
            {(app.status === 'running' || app.status === 'published') && (
              <>
                <button
                  className="miniapp-btn small"
                  onClick={onStop}
                  disabled={operating}
                >
                  停止
                </button>
                <button
                  className="miniapp-btn small"
                  onClick={onRestart}
                  disabled={operating}
                >
                  重启
                </button>
              </>
            )}
            <button
              className="miniapp-btn small"
              onClick={onContainerInfo}
              disabled={operating}
            >
              容器
            </button>
            <button
              className="miniapp-btn small danger"
              onClick={onDelete}
              disabled={operating}
            >
              删除
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ============================================
// 主组件
// ============================================

export function MiniAppsModal({ isOpen, onClose }: MiniAppsModalProps) {
  const { session } = useSession();
  const {
    tab, setTab, apps, loading, error,
    searchQuery, setSearchQuery, operatingId,
    create, remove, publish, unpublish,
    start, stop, restart,
    containerInfo: getContainerInfo, resetPassword,
  } = useMiniApps();
  const [showCreate, setShowCreate] = useState(false);
  const [showOAuthClients, setShowOAuthClients] = useState(false);
  const [containerInfo, setContainerInfo] = useState<MiniAppContainer | null>(null);

  const handleCreate = useCallback(
    async (data: CreateMiniAppRequest) => {
      // 审批制:提交申请成功(status=pending),不再即时返回容器/凭据。
      // 关闭表单 + 切到「我的」,新申请以「待审批」徽章出现在列表中。
      const result = await create(data);
      if (result) {
        setShowCreate(false);
        setTab('mine');
      }
    },
    [create, setTab],
  );

  const handleOpen = useCallback(async (app: MiniApp) => {
    if (!app.access_url || !session) {
      return;
    }

    const windowLabel = `miniapp-${app.miniapp_id.slice(0, 8)}`;

    const existing = await WebviewWindow.getByLabel(windowLabel);
    if (existing) {
      await existing.setFocus();
      return;
    }

    const fullUrl = buildMiniAppLaunchUrl(session.serverUrl, app.access_url, session.accessToken);

    const appWindow = new WebviewWindow(windowLabel, {
      url: fullUrl,
      title: app.display_name,
      width: 1200,
      height: 800,
      minWidth: 600,
      minHeight: 400,
      center: true,
      decorations: true,
      resizable: true,
      focus: true,
    });

    appWindow.once('tauri://error', (e) => {
      console.error(`[MiniApps] 打开小程序窗口失败 (${app.display_name}):`, e);
    });
  }, [session]);

  const handleContainerInfo = useCallback(
    async (id: string) => {
      const info = await getContainerInfo(id);
      if (info) {
        setContainerInfo(info);
      }
    },
    [getContainerInfo],
  );

  const handleResetPassword = useCallback(async () => {
    if (!containerInfo) {
      return;
    }
    const newPass = await resetPassword(containerInfo.miniapp_id);
    if (newPass && containerInfo) {
      setContainerInfo({
        ...containerInfo,
        ssh: { ...containerInfo.ssh, ssh_password: newPass },
      });
    }
  }, [containerInfo, resetPassword]);

  const handleDelete = useCallback(
    async (id: string) => {
      await remove(id);
    },
    [remove],
  );

  const content = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className="modal-content miniapps-modal"
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="modal-header">
              <div className="miniapps-header-left">
                <h2>小程序</h2>
                <span className="files-count">{apps.length} 个</span>
              </div>
              <div className="miniapps-header-right">
                {tab === 'mine' && (
                  <>
                    <motion.button
                      className="miniapp-btn"
                      onClick={() => setShowOAuthClients(true)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      OAuth 客户端
                    </motion.button>
                    <motion.button
                      className="miniapp-btn primary"
                      onClick={() => setShowCreate(true)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      + 创建
                    </motion.button>
                  </>
                )}
                <motion.button
                  className="close-btn"
                  onClick={onClose}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <CloseIcon />
                </motion.button>
              </div>
            </div>

            {/* Tab 栏 */}
            <div className="miniapps-tabs">
              {TAB_CONFIG.map((t) => (
                <button
                  key={t.key}
                  className={`miniapps-tab ${tab === t.key ? 'active' : ''}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 搜索栏 */}
            <div className="miniapps-search">
              <SearchIcon />
              <input
                type="text"
                placeholder="搜索小程序..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* 内容区 */}
            <div className="miniapps-body">
              <EmptyState
                loading={loading}
                error={error}
                searchQuery={searchQuery}
                count={apps.length}
                isMine={tab === 'mine'}
              />

              {apps.length > 0 && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={tab}
                    className="miniapps-grid"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    {apps.map((app, i) => (
                      <AppCard
                        key={app.miniapp_id}
                        app={app}
                        index={i}
                        isMine={tab === 'mine'}
                        operating={operatingId === app.miniapp_id}
                        onOpen={() => handleOpen(app)}
                        onPublish={() => publish(app.miniapp_id)}
                        onUnpublish={() => unpublish(app.miniapp_id)}
                        onStart={() => start(app.miniapp_id)}
                        onStop={() => stop(app.miniapp_id)}
                        onRestart={() => restart(app.miniapp_id)}
                        onContainerInfo={() => handleContainerInfo(app.miniapp_id)}
                        onDelete={() => handleDelete(app.miniapp_id)}
                      />
                    ))}
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {createPortal(content, document.body)}

      <AnimatePresence>
        {showCreate && (
          <CreateDialog
            isOpen={showCreate}
            onClose={() => setShowCreate(false)}
            onCreate={handleCreate}
            creating={operatingId === '__creating__'}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {containerInfo && (
          <ContainerInfoDialog
            info={containerInfo}
            onClose={() => setContainerInfo(null)}
            onResetPassword={handleResetPassword}
            resetting={operatingId === containerInfo.miniapp_id}
          />
        )}
      </AnimatePresence>

      {createPortal(
        <AnimatePresence>
          {showOAuthClients && (
            <OAuthClientsPanel onBack={() => setShowOAuthClients(false)} />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
