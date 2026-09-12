/**
 * MobileGuardPage — HuanvaeGuard 安卓全屏覆盖页（阶段 2b 前端双轨 · 安卓载体）
 *
 * 形态：单窗口内全屏覆盖页（App 安卓侧全屏页的统一形态，MobileFilesPage /
 * MobileLanTransferPage 同款：MobileMain state + AnimatePresence）。为何不用独立
 * WebviewWindow 的选型理由见 index.ts openHuanvaeGuardWindow 的 android 分支注释。
 *
 * 打开链：Sidebar 等价物 MobileDrawer「VPN 组网」→ openHuanvaeGuardWindow() →
 * （android 分支）派发 `huanvae-guard:open` → MobileMain 监听得 guardData → 渲染本组件。
 *
 * 凭据传递差异：桌面子窗口经 URL query(base64) 带入 token（index.ts 桌面分支不变）；
 * 本覆盖页与主窗口同 JS 上下文，经 initialData prop 直传 HuanvaeGuardPage。
 * token 保鲜（`session:tokens-updated` 监听 / `session:request-tokens` 索要）在页面
 * 组件内部，平台无关，零改动。载荷仅在内存传递，不落盘、不进 URL。
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import HuanvaeGuardPage from './HuanvaeGuardPage';
import type { HuanvaeGuardOverlayData } from './index';
import './mobileGuard.css';

const BackIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

interface MobileGuardPageProps {
  data: HuanvaeGuardOverlayData;
  onClose: () => void;
}

export function MobileGuardPage({ data, onClose }: MobileGuardPageProps) {
  // 🔴 initialData 必须引用稳定（2026-09-09）：HuanvaeGuardPage 的开页数据在挂载时消费一次，
  // 但下游任何残留的 initialData 依赖都会把「每次渲染的新对象」当成新入参，把已同步的
  // 新令牌重置回开页快照（token认证失败 根因的一半）。此处 useMemo + 父层 ref 双保险。
  const { userId, serverUrl, accessToken, refreshToken } = data;
  const initialData = useMemo(
    () => ({ userId, serverUrl, accessToken, refreshToken, installError: null }),
    [userId, serverUrl, accessToken, refreshToken],
  );
  return (
    <motion.div
      className="mobile-guard-page"
      initial={{ x: '-100%' }}
      animate={{ x: 0 }}
      exit={{ x: '-100%' }}
      transition={{ type: 'tween', duration: 0.25 }}
    >
      <header className="mobile-guard-header">
        <button className="mobile-guard-back" onClick={onClose} aria-label="返回">
          <BackIcon />
        </button>
        <h1 className="mobile-guard-title">VPN 组网</h1>
      </header>
      <div className="mobile-guard-body">
        {/* installError 是桌面 macOS 安装链的透传字段，安卓无此链，恒 null */}
        <HuanvaeGuardPage initialData={initialData} />
      </div>
    </motion.div>
  );
}
