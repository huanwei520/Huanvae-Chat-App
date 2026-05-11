/**
 * 移动端小程序页面
 *
 * 功能：
 * - 公开小程序列表（仅 explore tab）+ 搜索
 * - 卡片点击 → 全屏 iframe 加载 buildMiniAppLaunchUrl 生成的带 token URL
 *
 * 与桌面端 MiniAppsModal 的差异：
 * - 不含「我的」tab、创建表单、OAuth 客户端管理、凭据展示弹窗
 * - 启动小程序用 iframe 而非 WebviewWindow（Tauri Android 不支持多窗口）
 *
 * launchingApp state 由 MobileMain 上抬持有，便于系统返回键优先级链统一判断。
 */

import { motion } from 'framer-motion';
import { useSession } from '../../contexts/SessionContext';
import { useMiniApps } from '../../hooks/useMiniApps';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { buildMiniAppLaunchUrl } from '../../components/miniapps/launch';
import type { MiniApp } from '../../hooks/useMiniApps';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

// 搜索图标
const SearchIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width="20"
    height="20"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
    />
  </svg>
);

const pageVariants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
  exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9 },
};

interface MobileMiniAppsPageProps {
  /** 当前正在启动的小程序（非 null 时显示 iframe 覆盖层） */
  launchingApp: MiniApp | null;
  /** 启动小程序回调 */
  onLaunch: (app: MiniApp) => void;
  /** 关闭 iframe 回到列表 */
  onLaunchEnd: () => void;
  /** 关闭整个页面（返回主界面） */
  onClose: () => void;
}

interface MiniAppCardProps {
  app: MiniApp;
  index: number;
  onOpen: () => void;
}

function MiniAppCard({ app, index, onOpen }: MiniAppCardProps) {
  return (
    <motion.div
      className="mobile-miniapp-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ delay: index * 0.03 }}
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
    >
      <div className="mobile-miniapp-card-icon">
        {app.icon_url ? (
          <img src={app.icon_url} alt={app.display_name} />
        ) : (
          <span className="mobile-miniapp-card-icon-placeholder">
            {app.display_name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="mobile-miniapp-card-info">
        <div className="mobile-miniapp-card-name" title={app.display_name}>
          {app.display_name}
        </div>
        {app.description && (
          <div className="mobile-miniapp-card-desc" title={app.description}>
            {app.description}
          </div>
        )}
        <div className="mobile-miniapp-card-dev">{app.developer_nickname}</div>
      </div>
    </motion.div>
  );
}

export function MobileMiniAppsPage({
  launchingApp,
  onLaunch,
  onLaunchEnd,
  onClose,
}: MobileMiniAppsPageProps) {
  const { session } = useSession();
  const { apps, loading, error, searchQuery, setSearchQuery } = useMiniApps();

  const launchUrl =
    launchingApp && session
      ? buildMiniAppLaunchUrl(session.serverUrl, launchingApp.access_url, session.accessToken)
      : null;

  return (
    <motion.div
      className="mobile-miniapps-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部栏 */}
      <header className="mobile-miniapps-header">
        <button className="mobile-miniapps-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-miniapps-title">小程序</h1>
        <div className="mobile-miniapps-placeholder" />
      </header>

      {/* 搜索栏 */}
      <div className="mobile-miniapps-search">
        <div className="mobile-miniapps-search-input">
          <SearchIcon />
          <input
            type="text"
            placeholder="搜索小程序..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 内容区 */}
      <div className="mobile-miniapps-content">
        {loading && apps.length === 0 && (
          <div className="mobile-miniapps-loading">
            <LoadingSpinner />
            <span>加载中...</span>
          </div>
        )}

        {error && (
          <div className="mobile-miniapps-error">
            <span className="mobile-miniapps-error-icon">&#x26A0;</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && apps.length === 0 && (
          <div className="mobile-miniapps-empty">
            <span className="mobile-miniapps-empty-icon">&#x1F4E6;</span>
            <span>{searchQuery ? '未找到匹配的小程序' : '暂无已发布的小程序'}</span>
          </div>
        )}

        {apps.length > 0 && (
          <div className="mobile-miniapps-grid">
            {apps.map((app, index) => (
              <MiniAppCard
                key={app.miniapp_id}
                app={app}
                index={index}
                onOpen={() => onLaunch(app)}
              />
            ))}
          </div>
        )}
      </div>

      {/* iframe 全屏覆盖层 */}
      {launchingApp && launchUrl && (
        <motion.div
          className="mobile-miniapp-iframe-page"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <header className="mobile-miniapp-iframe-header">
            <button className="mobile-miniapp-iframe-back" onClick={onLaunchEnd}>
              <BackIcon />
            </button>
            <h1 className="mobile-miniapp-iframe-title" title={launchingApp.display_name}>
              {launchingApp.display_name}
            </h1>
            <div className="mobile-miniapp-iframe-placeholder" />
          </header>
          <iframe
            className="mobile-miniapp-iframe"
            src={launchUrl}
            title={launchingApp.display_name}
            allow="camera; microphone; clipboard-read; clipboard-write; fullscreen"
          />
        </motion.div>
      )}
    </motion.div>
  );
}
