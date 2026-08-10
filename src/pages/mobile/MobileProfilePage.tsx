/**
 * 移动端个人资料页面（独立整屏页，QQ / IM 风）
 *
 * 功能：显示当前用户信息、改昵称/邮箱/签名/密码、上传头像/封面。
 * 头像/昵称/封面等编辑逻辑收口到 [useProfileEditor]（与桌面 ProfileModal 共用）。
 *
 * 版式（独立整屏页，从右滑入）：
 *   固定 topbar（左返回 · 右保存，随滚动常驻；保存驱动当前 tab 表单的原保存逻辑，
 *     无改动置灰、有改动高亮，态由表单经 onSubmitStateChange 上报）
 *   通栏封面 banner（换封面浮层）
 *   → 身份 hero 卡（头像骑封面下沿 + 昵称/@id/签名预览）
 *   → 快览事实卡（地区/性别/注册于，分组信息卡；复用桌面 .profile-identity-facts）
 *   → 分段控件（基本信息/隐私/密码，iOS 风滑块）
 *   → 表单卡（复用共享表单；各表单 hideSubmit 隐藏内部按钮，保存统一走 topbar）
 * 骨架/身份类共用 profile-hero.css + pages/main.css，特化落 styles/mobile/profile-page.css。
 *
 * 两层 motion 结构（边缘侧滑返回，2026-08-10）：
 *   .mobile-profile-page        外层，只管定位与裁剪；pageVariants 独占其 transform（入退场滑入滑出）
 *   └ .mobile-profile-swipe-layer 内层，承载整页视觉（背景+内容+topbar）；
 *                                [useEdgeSwipeBack] 的 MotionValue 独占其 transform（跟手位移）
 * 两层各有各的 transform，互不抢帧（.claude/rules/animation.md 规则一/四）；外层不铺背景，
 * 侧滑时露出的是下面的主页面而不是本页底色。侧滑达标后调用的是 onClose——与顶栏返回键、
 * Android 系统返回（MobileMain.handleMobileBack 优先级分支）同一个返回动作。
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AvatarUploader, ProfileInfoForm, PrivacySettingsForm, PasswordForm, ProfileCoverActions } from '../../components/profile';
import { useProfileEditor } from '../../hooks/useProfileEditor';
import { useEdgeSwipeBack } from '../../hooks/useEdgeSwipeBack';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { formatDate } from '../../utils/time';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="22"
    height="22"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface MobileProfilePageProps {
  /** 关闭页面回调 */
  onClose: () => void;
}

const GENDER_LABELS: Record<string, string> = { male: '男', female: '女', other: '其他' };

type TabType = 'info' | 'privacy' | 'password';

// 分段控件顺序（滑块位移用其索引）
const TAB_ORDER: TabType[] = ['info', 'privacy', 'password'];

// ============================================
// 主组件
// ============================================

export function MobileProfilePage({ onClose }: MobileProfilePageProps) {
  const [activeTab, setActiveTab] = useState<TabType>('info');
  // 顶部 header 保存键的提交态：由当前 tab 的表单经 onSubmitStateChange 上报（canSave/saving/submit）。
  const [saveCtl, setSaveCtl] = useState<{ canSave: boolean; saving: boolean; submit: () => void } | null>(null);
  // 滚过封面后，固定 topbar 浮现磨砂底（iOS 大标题式：封面上透明、内容上磨砂）。
  const [navSolid, setNavSolid] = useState(false);
  // 左边缘右滑 = 返回上一层，落到与顶栏返回键相同的 onClose。
  const { x: swipeX, handlers: swipeHandlers } = useEdgeSwipeBack({ onBack: onClose });
  const {
    session,
    error,
    success,
    uploadingAvatar,
    uploadProgress,
    updatingNickname,
    savingBackground,
    backgroundProgress,
    backgroundNotice,
    clearBackgroundNotice,
    handleAvatarSelect,
    handleNicknameUpdate,
    handleBackgroundSelect,
    handleBackgroundReset,
    handleSuccess,
    handleError,
    cropModal,
  } = useProfileEditor();

  // 封面图走显示收口点（私有 CA）：background_url 是后端原始相对路径。
  const backgroundUrl = resolveServerAvatarUrl(session?.profile.background_url);

  if (!session) {
    return null;
  }

  // 身份快览事实（只读展示；随保存后 session 更新，与桌面身份栏一致）
  const region = session.profile.region ?? '';
  const genderLabel = session.profile.gender ? (GENDER_LABELS[session.profile.gender] ?? '') : '';
  const registerTime = formatDate(session.profile.created_at);
  const signature = session.profile.user_signature;

  const activeIndex = TAB_ORDER.indexOf(activeTab);

  // 切 tab 时先清空保存态（旧表单卸载、新表单挂载后会重新上报），避免 header 指向已卸载表单的 submit。
  const switchTab = (t: TabType) => {
    setSaveCtl(null);
    setActiveTab(t);
  };
  const canSaveNow = !!saveCtl?.canSave && !saveCtl.saving;

  const handleContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const solid = e.currentTarget.scrollTop > 140;
    setNavSolid((prev) => (prev === solid ? prev : solid));
  };

  // 页面动画
  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <motion.div
      className="mobile-profile-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 侧滑层：整页视觉都在这一层，x 由 useEdgeSwipeBack 独占（跟手/回弹） */}
      <motion.div className="mobile-profile-swipe-layer" style={{ x: swipeX }} {...swipeHandlers}>
        {/* 内容区域（整块滚动，封面区在最顶通栏） */}
        <div className="mobile-profile-content" onScroll={handleContentScroll}>
          {/* 通栏封面 banner + 封面交互层（返回/保存已上移到固定 topbar） */}
          <div className="qq-hero qq-hero--mobile">
            <div
              className="qq-hero-cover"
              style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
            >
              <ProfileCoverActions
                hasBackground={!!session.profile.background_url}
                saving={savingBackground}
                progress={backgroundProgress}
                notice={backgroundNotice}
                onSelect={handleBackgroundSelect}
                onReset={handleBackgroundReset}
                onClearNotice={clearBackgroundNotice}
              />
            </div>
          </div>

          {/* 内层（左右留白），承载 hero / 事实 / 分段 / 表单 */}
          <div className="mobile-profile-body">
            {/* 身份 hero 卡：头像骑封面下沿 + 昵称/@id + 签名预览 */}
            <section className="mobile-profile-hero">
              <div className="mobile-profile-avatar-section">
                <AvatarUploader
                  session={session}
                  uploading={uploadingAvatar}
                  uploadProgress={uploadProgress}
                  onFileSelect={handleAvatarSelect}
                  onNicknameUpdate={handleNicknameUpdate}
                  nicknameUpdating={updatingNickname}
                />
              </div>
              <p className={`profile-identity-signature${signature ? '' : ' is-empty'}`}>
                {signature || '这个人很懒，什么都没写下~'}
              </p>
            </section>

            {/* 快览事实卡（分组信息卡；全空则 :empty 自动隐藏） */}
            <div className="profile-identity-facts mobile-profile-facts">
              {region && (
                <div className="profile-fact">
                  <span className="profile-fact-label">地区</span>
                  <span className="profile-fact-value">{region}</span>
                </div>
              )}
              {genderLabel && (
                <div className="profile-fact">
                  <span className="profile-fact-label">性别</span>
                  <span className="profile-fact-value">{genderLabel}</span>
                </div>
              )}
              {registerTime && (
                <div className="profile-fact">
                  <span className="profile-fact-label">注册于</span>
                  <span className="profile-fact-value">{registerTime}</span>
                </div>
              )}
            </div>

            {/* 分段控件（iOS 风滑块） */}
            <div className="mobile-profile-seg" role="tablist" aria-label="资料分区">
              <span
                className="mobile-profile-seg-thumb"
                aria-hidden="true"
                style={{ transform: `translateX(${activeIndex * 100}%)` }}
              />
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'info'}
                className={`mobile-profile-seg-btn ${activeTab === 'info' ? 'active' : ''}`}
                onClick={() => switchTab('info')}
              >
                基本信息
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'privacy'}
                className={`mobile-profile-seg-btn ${activeTab === 'privacy' ? 'active' : ''}`}
                onClick={() => switchTab('privacy')}
              >
                隐私设置
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'password'}
                className={`mobile-profile-seg-btn ${activeTab === 'password' ? 'active' : ''}`}
                onClick={() => switchTab('password')}
              >
                修改密码
              </button>
            </div>

            {/* 表单卡（保存键上移到顶部 header，故各表单 hideSubmit 隐藏内部按钮） */}
            <div className="mobile-profile-form">
              {activeTab === 'info' && (
                <ProfileInfoForm onSuccess={handleSuccess} onError={handleError} showRegisterTime={false} hideSubmit onSubmitStateChange={setSaveCtl} />
              )}
              {activeTab === 'privacy' && (
                <PrivacySettingsForm onSuccess={handleSuccess} onError={handleError} hideSubmit onSubmitStateChange={setSaveCtl} />
              )}
              {activeTab === 'password' && (
                <PasswordForm onSuccess={handleSuccess} onError={handleError} hideSubmit onSubmitStateChange={setSaveCtl} />
              )}

              {/* 错误/成功提示 */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="mobile-profile-error"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {error}
                  </motion.div>
                )}
                {success && (
                  <motion.div
                    className="mobile-profile-success"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {success}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* 固定顶部导航条（覆盖在滚动内容之上，随滚动常驻）：左返回 · 右保存。
            bar 本身不拦截点击（pointer-events:none），仅两个按钮可点，故封面换图区仍可点。 */}
        <div className={`mobile-profile-topbar ${navSolid ? 'is-solid' : ''}`}>
          <button
            type="button"
            className="qq-hero-btn qq-hero-btn--icon mobile-profile-topbtn"
            onClick={onClose}
            aria-label="返回"
          >
            <BackIcon />
          </button>
          <button
            type="button"
            className={`mobile-profile-save ${canSaveNow ? 'is-active' : ''}`}
            onClick={() => saveCtl?.submit()}
            disabled={!canSaveNow}
          >
            {saveCtl?.saving ? '保存中' : '保存'}
          </button>
        </div>
      </motion.div>
      {cropModal}
    </motion.div>
  );
}
