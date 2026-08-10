/**
 * 聊天菜单组件
 *
 * 显示当前聊天对象（好友/群聊）的操作菜单
 * 支持：删除好友、群名称修改、群头像上传、邀请成员、查看成员、
 *       设置/取消管理员、禁言/解除禁言、踢出成员、退出群聊
 *
 * 状态管理已提取到 useChatMenu Hook
 * 本组件仅负责渲染 UI
 *
 * ## 呈现形态：右侧滑出面板（非模态，不盖标题栏）
 *
 * 顶栏按钮打开的是 [ChatMenuPanel](./ChatMenuPanel.tsx) —— 从屏幕右侧滑入的面板，
 * **无遮罩**、只盖消息区与输入框、聊天标题栏始终可见；桌面与移动**同一组件、同一套交互**
 * （Esc / 关闭键 / 点面板外 关闭）。面板 body 里渲染当前 view：`main` 是按语义分组的
 * 设置列表（见 menu/MainMenu.tsx，群聊第一组是成员头像网格），`search` 是会话内消息查找，
 * 其余是各子视图（成员、公告、确认框……）。
 *
 * useChatMenu 的 `menuRef`（点击外部关闭）挂在**面板本体**上而不是顶栏容器上，
 * 原因与协作细节见 ChatMenuPanel 文件头。
 *
 * ## 会话内查找并入本面板
 *
 * 原先顶栏「更多操作」旁另有一颗放大镜按钮，现已删除（ChatPanel / MobileChatView 两端同步）；
 * 查找是本面板「会话」组里的一项，点进去切到 `search` view。选中某条结果后写定位请求并
 * `handleCloseMenu()` 收起面板，好让被定位的那条消息真的露出来。
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useChatMenu } from '../group/useChatMenu';
import { GroupRemarkInputModal } from '../group/GroupRemarkInputModal';
import { ChatMenuPanel } from './ChatMenuPanel';
import { useChatStore, useProfileViewStore } from '../../stores';
import { friendDisplayName } from '../../utils/friendName';
import { isFriendLikeTarget } from '../../utils/chatTarget';
import { MenuIcon } from '../../components/common/Icons';
import { ConversationMessageSearch } from '../../components/search/ConversationMessageSearch';
import { getSearchConversationId } from '../../components/search/conversationSearchTarget';
import {
  type ChatMenuProps,
  MainMenu,
  EditNameForm,
  EditNicknameForm,
  EditRemarkForm,
  InviteForm,
  MembersList,
  MemberActions,
  MuteSettings,
  ConfirmDialog,
  NoticesList,
  CreateNoticeForm,
  TransferOwner,
  InviteCodeList,
  GenerateCodeForm,
} from './menu';

export function ChatMenuButton({
  target,
  onFriendRemoved,
  onGroupUpdated,
  onGroupLeft,
  isMultiSelectMode = false,
  onToggleMultiSelect,
  onHistoryLoaded,
}: ChatMenuProps) {
  const menu = useChatMenu({
    target,
    onFriendRemoved,
    onGroupUpdated,
    onGroupLeft,
    onHistoryLoaded,
  });

  // 触发按钮所在容器：面板据此往上找聊天标题栏，把顶边贴在它下沿（不遮标题栏）
  const containerRef = useRef<HTMLDivElement>(null);

  // D7 群内私有备注：本群「我设的备注」映射，用于成员列表显示名替换
  const groupId = target.type === 'group' ? target.data.group_id : undefined;
  const groupRemarks = useChatStore((s) => (groupId ? s.groupMemberRemarks[groupId] : undefined));

  // 会话内查找的本地会话 ID（AI 不落本地 messages 表，但 AI 根本不渲染本组件）
  const searchConversationId = menu.currentUserId
    ? getSearchConversationId(target, menu.currentUserId)
    : null;

  // 成员网格在 main 视图就要有数据 —— 原先成员只在进「成员列表」视图时才拉。
  // 打开面板即拉一次（handleLoadMembers 内部自带 target.type !== 'group' 早返回）。
  //
  // ⚠️ 依赖只能是 isOpen：handleLoadMembers 的 useCallback 依赖里有 api / target，
  // 二者只要有一次 render 内换了引用，把它写进依赖数组就会「每次 render 重拉一次成员」
  // 甚至自激循环（拉取本身 setState → 再 render）。故用 latest-ref 持有最新回调。
  const loadMembersRef = useRef(menu.handleLoadMembers);
  loadMembersRef.current = menu.handleLoadMembers;
  const { isOpen } = menu;
  useEffect(() => {
    if (isOpen) {
      loadMembersRef.current();
    }
  }, [isOpen]);

  // 点成员网格里的头像 → 打开其资料页并收起面板（与成员操作面板里的「查看资料」同语义）
  const openProfileView = useProfileViewStore((s) => s.open);

  // 渲染视图内容
  const renderViewContent = () => {
    switch (menu.view) {
      case 'main':
        return (
          <MainMenu
            targetType={target.type}
            isOwnerOrAdmin={menu.isGroupOwnerOrAdmin}
            isOwner={menu.isGroupOwner}
            isMultiSelectMode={isMultiSelectMode}
            group={target.type === 'group' ? target.data : undefined}
            uploadingAvatar={menu.uploadingAvatar}
            avatarUploadProgress={menu.avatarUploadProgress}
            loadingHistory={menu.loadingHistory}
            historyProgress={menu.historyProgress}
            isFriendSpecialCare={menu.isFriendSpecialCare}
            isFriendBlacklisted={menu.isFriendBlacklisted}
            members={menu.members}
            loadingMembers={menu.loadingMembers}
            memberRemarks={groupRemarks}
            currentUserId={menu.currentUserId}
            onSelectMember={(member) => {
              openProfileView(member.user_id);
              menu.handleCloseMenu();
            }}
            onOpenSearch={
              searchConversationId ? () => menu.handleSetView('search') : undefined
            }
            onSetView={menu.handleSetView}
            onUploadAvatar={() => menu.fileInputRef.current?.click()}
            onToggleMultiSelect={() => {
              onToggleMultiSelect?.();
              menu.handleCloseMenu();
            }}
            onLoadAllHistory={menu.handleLoadAllHistory}
            onToggleSpecialCare={menu.handleToggleSpecialCare}
            onUnblacklist={menu.handleUnblacklist}
          />
        );

      case 'search':
        // searchConversationId 为空时主菜单根本不给入口，这里不可能被走到；
        // 保守起见返回 null 而不是渲染一个查不了东西的空面板。
        return searchConversationId && (
          <ConversationMessageSearch
            conversationId={searchConversationId}
            onBack={() => menu.handleSetView('main')}
            onJump={menu.handleCloseMenu}
          />
        );

      case 'edit-name':
        return (
          <EditNameForm
            value={menu.newGroupName}
            loading={menu.loading}
            onChange={menu.setNewGroupName}
            onSubmit={menu.handleUpdateGroupName}
            onBack={() => menu.handleSetView('main')}
          />
        );

      case 'edit-nickname':
        return (
          <EditNicknameForm
            value={menu.groupNickname}
            loading={menu.loading}
            onChange={menu.setGroupNickname}
            onSubmit={menu.handleUpdateGroupNickname}
            onClear={menu.handleClearGroupNickname}
            onBack={() => menu.handleSetView('main')}
          />
        );

      case 'edit-remark':
        return (
          <EditRemarkForm
            value={menu.friendRemark}
            loading={menu.loading}
            onChange={menu.setFriendRemark}
            onSubmit={menu.handleUpdateFriendRemark}
            onClear={menu.handleClearFriendRemark}
            onBack={() => menu.handleSetView('main')}
          />
        );

      case 'invite':
        return (
          <InviteForm
            userId={menu.inviteUserId}
            message={menu.inviteMessage}
            loading={menu.loading}
            onUserIdChange={menu.setInviteUserId}
            onMessageChange={menu.setInviteMessage}
            onSubmit={menu.handleInviteMember}
            onBack={() => menu.handleSetView('main')}
          />
        );

      case 'members':
        return (
          <MembersList
            members={menu.members}
            loadingMembers={menu.loadingMembers}
            currentUserId={menu.currentUserId}
            remarks={groupRemarks}
            onBack={() => menu.handleSetView('main')}
            onMemberClick={menu.handleMemberClick}
          />
        );

      case 'member-action':
        return menu.selectedMember && (
          <MemberActions
            member={menu.selectedMember}
            isOwner={menu.isGroupOwner}
            loading={menu.loading}
            canModerate={menu.canModerateSelectedMember}
            isSpecialCared={menu.isSelectedMemberSpecialCared}
            isBlocked={menu.isSelectedMemberBlocked}
            onBack={() => menu.handleSetView('members')}
            onViewProfile={menu.handleViewMemberProfile}
            onToggleSpecialCare={menu.handleToggleMemberSpecialCare}
            onToggleBlock={menu.handleToggleMemberBlock}
            onSetRemark={menu.openMemberRemarkModal}
            onToggleAdmin={menu.handleToggleAdmin}
            onMute={() => menu.handleSetView('mute-member')}
            onUnmute={menu.handleUnmuteMember}
            onKick={() => menu.handleSetView('confirm-kick')}
          />
        );

      case 'mute-member':
        return menu.selectedMember && (
          <MuteSettings
            member={menu.selectedMember}
            duration={menu.muteDuration}
            loading={menu.loading}
            onBack={() => menu.handleSetView('member-action')}
            onDurationChange={menu.setMuteDuration}
            onConfirm={menu.handleMuteMember}
          />
        );

      case 'confirm-delete':
        return (
          <ConfirmDialog
            title="确认删除"
            message={
              <>
                确定要删除好友{' '}
                <strong>{isFriendLikeTarget(target) ? friendDisplayName(target.data) : ''}</strong>{' '}
                吗？
              </>
            }
            warning="此操作无法撤销"
            confirmText="确认删除"
            loadingText="删除中..."
            loading={menu.loading}
            onConfirm={menu.handleRemoveFriend}
            onCancel={() => menu.handleSetView('main')}
          />
        );

      case 'confirm-blacklist':
        return (
          <ConfirmDialog
            title="确认拉黑"
            message={
              <>
                确定要拉黑好友{' '}
                <strong>{isFriendLikeTarget(target) ? friendDisplayName(target.data) : ''}</strong>{' '}
                吗？
              </>
            }
            warning="拉黑后对方将收不到你发送的消息"
            confirmText="确认拉黑"
            loadingText="处理中..."
            loading={menu.loading}
            onConfirm={menu.handleBlacklist}
            onCancel={() => menu.handleSetView('main')}
          />
        );

      case 'confirm-leave':
        return (
          <ConfirmDialog
            title="确认退出"
            message={
              <>
                确定要退出群聊{' '}
                <strong>{target.type === 'group' ? target.data.group_name : ''}</strong>{' '}
                吗？
              </>
            }
            confirmText="确认退出"
            loadingText="退出中..."
            loading={menu.loading}
            onConfirm={menu.handleLeaveGroup}
            onCancel={() => menu.handleSetView('main')}
          />
        );

      case 'confirm-kick':
        return menu.selectedMember && (
          <ConfirmDialog
            title="确认移除"
            message={
              <>
                确定要将 <strong>{menu.selectedMember.user_nickname}</strong> 移出群聊吗？
              </>
            }
            confirmText="确认移除"
            loadingText="处理中..."
            loading={menu.loading}
            onConfirm={menu.handleKickMember}
            onCancel={() => menu.handleSetView('member-action')}
          />
        );

      case 'notices':
        return (
          <NoticesList
            notices={menu.notices}
            loading={menu.loadingNotices}
            isOwnerOrAdmin={menu.isGroupOwnerOrAdmin}
            onBack={() => menu.handleSetView('main')}
            onCreateNotice={() => menu.handleSetView('create-notice')}
            onDeleteNotice={menu.handleDeleteNotice}
          />
        );

      case 'create-notice':
        return (
          <CreateNoticeForm
            loading={menu.loading}
            onBack={() => menu.handleSetView('notices')}
            onSubmit={menu.handleCreateNotice}
          />
        );

      case 'transfer-owner':
        return (
          <TransferOwner
            members={menu.members}
            loading={menu.loading}
            loadingMembers={menu.loadingMembers}
            currentUserId={undefined}
            remarks={groupRemarks}
            onBack={() => menu.handleSetView('main')}
            onTransfer={menu.handleTransferOwner}
          />
        );

      case 'confirm-disband':
        return (
          <ConfirmDialog
            title="确认解散"
            message={
              <>
                确定要解散群聊{' '}
                <strong>{target.type === 'group' ? target.data.group_name : ''}</strong>{' '}
                吗？
              </>
            }
            warning="此操作无法撤销，所有成员将被移出群聊"
            confirmText="确认解散"
            loadingText="解散中..."
            loading={menu.loading}
            onConfirm={menu.handleDisbandGroup}
            onCancel={() => menu.handleSetView('main')}
          />
        );

      case 'invite-codes':
        return (
          <InviteCodeList
            codes={menu.inviteCodes}
            loading={menu.loadingCodes}
            onBack={() => menu.handleSetView('main')}
            onGenerate={() => menu.handleSetView('generate-code')}
            onRevoke={menu.handleRevokeCode}
            onCopy={menu.handleCopyCode}
          />
        );

      case 'generate-code':
        return (
          <GenerateCodeForm
            loading={menu.loading}
            onBack={() => menu.handleSetView('invite-codes')}
            onSubmit={menu.handleGenerateCode}
          />
        );

      default:
        return null;
    }
  };

  // 面板标题栏：主标题=聊天对象名，副标题=设置域（原下拉菜单里的 MenuHeader 已由它承担）
  const panelTitle = target.type === 'group'
    ? target.data.group_name
    : friendDisplayName(target.data);
  const panelSubtitle = target.type === 'group' ? '群聊设置' : '好友设置';

  return (
    <div className="chat-menu-container" ref={containerRef}>
      <motion.button
        className="chat-menu-btn"
        onClick={menu.handleToggle}
        // 面板已无遮罩挡着 → 打开时这颗按钮仍可点。useChatMenu 的「点击外部关闭」听的是
        // document mousedown，若放任冒泡就会「mousedown 先关、紧接着 click 又开」= 关不掉。
        // 在 mousedown 上截停，把开合完全交给 onClick 这一条通路。
        onMouseDown={(e) => e.stopPropagation()}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        title="更多操作"
        aria-label="更多操作"
        aria-haspopup="dialog"
        aria-expanded={menu.isOpen}
      >
        <MenuIcon />
      </motion.button>

      {/* 隐藏的文件输入 */}
      <input
        ref={menu.fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        style={{ display: 'none' }}
        onChange={menu.handleAvatarUpload}
      />

      {/* 群头像裁剪弹窗 */}
      {menu.avatarCropModal}

      {/* 成员私有备注输入弹窗（成员操作面板「设置备注」触发，D7） */}
      {menu.selectedMember && (
        <GroupRemarkInputModal
          isOpen={menu.memberRemarkModalOpen}
          memberName={menu.selectedMember.user_nickname}
          currentRemark={menu.selectedMemberRemark}
          onSave={menu.handleSaveMemberRemark}
          onClose={menu.closeMemberRemarkModal}
        />
      )}

      <ChatMenuPanel
        open={menu.isOpen}
        title={panelTitle}
        subtitle={panelSubtitle}
        onClose={menu.handleCloseMenu}
        sheetRef={menu.menuRef}
        triggerRef={containerRef}
        footer={
          (menu.error || menu.success) ? (
            <div
              className={`menu-message ${menu.error ? 'error' : 'success'}`}
              role="status"
              aria-live="polite"
            >
              {menu.error || menu.success}
            </div>
          ) : null
        }
      >
        {renderViewContent()}
      </ChatMenuPanel>
    </div>
  );
}
