/**
 * 聊天菜单组件
 *
 * 显示当前聊天对象（好友/群聊）的操作菜单
 * 支持：删除好友、群名称修改、群头像上传、邀请成员、查看成员、
 *       设置/取消管理员、禁言/解除禁言、踢出成员、退出群聊
 *
 * 状态管理已提取到 useChatMenu Hook
 * 本组件仅负责渲染 UI
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useChatMenu } from '../../hooks/useChatMenu';
import { MenuIcon } from '../common/Icons';
import {
  type ChatMenuProps,
  MainMenu,
  EditNameForm,
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
}: ChatMenuProps) {
  const menu = useChatMenu({
    target,
    onFriendRemoved,
    onGroupUpdated,
    onGroupLeft,
  });

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
            onSetView={menu.handleSetView}
            onLoadMembers={menu.handleLoadMembers}
            onUploadAvatar={() => menu.fileInputRef.current?.click()}
            onToggleMultiSelect={() => {
              onToggleMultiSelect?.();
              menu.handleCloseMenu();
            }}
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
            currentUserId={undefined}
            isOwnerOrAdmin={menu.isGroupOwnerOrAdmin}
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
            onBack={() => menu.handleSetView('members')}
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
                <strong>{target.type === 'friend' ? target.data.friend_nickname : ''}</strong>{' '}
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

  return (
    <div className="chat-menu-container" ref={menu.menuRef}>
      <motion.button
        className="chat-menu-btn"
        onClick={menu.handleToggle}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        title="更多操作"
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

      <AnimatePresence>
        {menu.isOpen && (
          <motion.div
            className="chat-menu-dropdown"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15 }}
          >
            {renderViewContent()}

            {/* 错误/成功提示 */}
            {(menu.error || menu.success) && (
              <div className={`menu-message ${menu.error ? 'error' : 'success'}`}>
                {menu.error || menu.success}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
