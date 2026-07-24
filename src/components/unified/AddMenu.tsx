/**
 * "+" 轻量下拉菜单（req-23，huanwei 定稿 #2/#4）
 *
 * 触发按钮镜像 UnifiedList 的 header-add-btn（含通知红点）；点开一个轻量下拉，
 * 三项：
 * - 创建群聊：内置 CreateGroupPanel，复用 createGroup + addGroup 增量添加
 * - 创建机器人：复用 CreateBotDialog + useBots，成功后 SecretDisplay 一次性展示 token
 * - 待通过申请：打开 PendingRequestsPanel（收到需处理 + 我发出的仅展示）
 *
 * 动画：下拉 add-menu-dropdown 用 framer-motion（dropdownVariants）控制 transform/opacity，
 * 故 add-menu.css 内该选择器禁写 transition: transform / opacity（防抢帧）。
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../../contexts/SessionContext';
import { createGroup, type Group } from '../../api/groups';
import { CreateBotDialog } from '../bots/CreateBotDialog';
import { SecretDisplay, type SecretField } from '../common/SecretDisplay';
import { useBots } from '../../hooks/useBots';
import { CloseIcon } from '../common/Icons';
import { PendingRequestsPanel } from './PendingRequestsPanel';
import type { CreateBotRequest } from '../../api/bots';
import '../../styles/components/add-menu.css';

// 添加按钮图标（+号）——与 UnifiedList 的 PlusIcon 一致
const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const TOKEN_WARNING = 'Token 仅此一次明文展示，请立即妥善保存；关闭后无法再次查看，只能重置。';

/** 下拉展开/收起动画：transform + opacity 全权交给 framer-motion */
const dropdownVariants = {
  initial: { opacity: 0, y: -8, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.12 } },
};

/** token 一次性展示态（SecretDisplay 关闭即清空，不落盘） */
interface TokenDisplayState {
  title: string;
  fields: SecretField[];
}

type ActivePanel = 'create-group' | 'create-bot' | 'pending' | null;

interface AddMenuProps {
  pendingNotificationCount?: number;
  addGroup?: (group: Group) => void;
  refreshGroups?: () => void;
  refreshFriends?: () => void;
}

/** 创建群聊表单（内置，复用 miniapp-create-* 弹窗 CSS + createGroup + addGroup） */
function CreateGroupPanel({ onClose, addGroup }: { onClose: () => void; addGroup?: (group: Group) => void }) {
  const api = useApi();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('请输入群名称');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await createGroup(api, {
        group_name: name.trim(),
        group_description: desc.trim() || undefined,
      });
      // 增量添加（无需全量刷新），身份为 owner
      addGroup?.({
        group_id: res.group_id,
        group_name: res.group_name,
        group_avatar_url: '',
        role: 'owner',
        unread_count: 0,
        last_message_content: null,
        last_message_time: null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="modal-overlay miniapp-create-overlay" onClick={onClose}>
      <div className="miniapp-create-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="miniapp-create-header">
          <h3>创建群聊</h3>
          <button className="close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <label className="miniapp-field">
            <span className="miniapp-field-label">
              群名称 <span className="miniapp-required">*</span>
            </span>
            <input
              type="text"
              placeholder="给群聊起个名字"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
            />
          </label>
          <label className="miniapp-field">
            <span className="miniapp-field-label">群简介</span>
            <textarea
              placeholder="可选，简要描述群聊用途"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={200}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={onClose}>
            取消
          </button>
          <button className="miniapp-btn primary" onClick={handleSubmit} disabled={loading || !name.trim()}>
            {loading ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * 创建机器人面板（内置）。useBots 挂在这里而非 AddMenu 顶层 ——
 * 只有下拉选中「创建机器人」时才挂载，避免主页面常驻 header 一加载就 GET /api/bots。
 * token 展示态由父级 AddMenu 持有（对话框关闭后仍需展示）。
 */
function CreateBotPanel({ onClose, onCreated }: { onClose: () => void; onCreated: (t: TokenDisplayState) => void }) {
  const { create, operatingId, error } = useBots();

  const handleCreate = useCallback(
    async (data: CreateBotRequest) => {
      const res = await create(data);
      if (res) {
        onCreated({
          title: '机器人创建成功',
          fields: [
            { label: 'Bot ID', value: res.bot_user_id },
            { label: '用户名', value: res.username },
            { label: 'Token', value: res.token },
          ],
        });
      }
    },
    [create, onCreated],
  );

  return (
    <CreateBotDialog
      onClose={onClose}
      onCreate={handleCreate}
      creating={operatingId === '__creating__'}
      error={error}
    />
  );
}

export function AddMenu({
  pendingNotificationCount = 0,
  addGroup,
  refreshGroups,
  refreshFriends,
}: AddMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [panel, setPanel] = useState<ActivePanel>(null);
  const [tokenDisplay, setTokenDisplay] = useState<TokenDisplayState | null>(null);

  const pendingCount = pendingNotificationCount;
  const badgeText = pendingCount > 99 ? '99+' : String(pendingCount);

  return (
    <div className="add-menu">
      <button
        className="header-add-btn"
        onClick={() => setMenuOpen((o) => !o)}
        title="添加"
      >
        <PlusIcon />
        {pendingCount > 0 && <span className="notification-badge">{badgeText}</span>}
      </button>

      {/* 透明点击遮罩：点外部即收起下拉（无需退场动画，随 menuOpen 即时切换） */}
      {menuOpen && <div className="add-menu-backdrop" onClick={() => setMenuOpen(false)} />}

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="add-menu-dropdown"
            className="add-menu-dropdown"
            variants={dropdownVariants}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <button
              className="add-menu-item"
              onClick={() => {
                setPanel('create-group');
                setMenuOpen(false);
              }}
            >
              <span>创建群聊</span>
            </button>
            <button
              className="add-menu-item"
              onClick={() => {
                setPanel('create-bot');
                setMenuOpen(false);
              }}
            >
              <span>创建机器人</span>
            </button>
            <button
              className="add-menu-item"
              onClick={() => {
                setPanel('pending');
                setMenuOpen(false);
              }}
            >
              <span>待通过申请</span>
              {pendingCount > 0 && <span className="add-menu-item-badge">{badgeText}</span>}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 创建群聊面板 */}
      {panel === 'create-group' && (
        <CreateGroupPanel onClose={() => setPanel(null)} addGroup={addGroup} />
      )}

      {/* 创建机器人面板（useBots 仅在此挂载时运行，避免主页面常驻拉取 bot 列表） */}
      {panel === 'create-bot' && (
        <CreateBotPanel
          onClose={() => setPanel(null)}
          onCreated={(t) => {
            setPanel(null);
            setTokenDisplay(t);
          }}
        />
      )}

      {/* 待通过申请面板；关闭时兜底刷新群列表（接受邀请已走 addGroup 增量，这里保底一致性） */}
      {panel === 'pending' && (
        <PendingRequestsPanel
          onClose={() => {
            setPanel(null);
            refreshGroups?.();
          }}
          onFriendAdded={refreshFriends}
          addGroup={addGroup}
        />
      )}

      {/* token 一次性展示：portal 到 body + fixed z-10001，避免被弹层遮挡 */}
      {tokenDisplay &&
        createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: 10001 }}>
            <SecretDisplay
              title={tokenDisplay.title}
              warningText={TOKEN_WARNING}
              fields={tokenDisplay.fields}
              onClose={() => setTokenDisplay(null)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

export default AddMenu;
