/**
 * 会议分享动作面板（移动端会议室「分享」入口专用）
 *
 * 2026-09-10 会议分享改版（块 1788982832352-3）：分享入口收敛为会议室内右上角
 * 分享按钮之后，点分享不再直开选人面板，而是先弹两类选项：
 * - 「转发给好友」：上抛 onForward 意图，由调用方打开既有 ShareMeetingModal
 *   （选人 + meeting_invite 发送逻辑零改动，沿用原链路）；
 * - 「复制会议链接」：上抛 onCopy 意图，由调用方把会议信息写入系统剪贴板
 *   （文案 = buildMeetingInviteText，与加入页「粘贴房间信息」解析器同构）。
 *
 * 本组件只负责呈现与意图上抛，不做发送/剪贴板副作用（副作用留在调用方，
 * jsdom 单测只断言意图回调；Android 返回键关闭由调用方统一编排）。
 *
 * @module meeting/components/MeetingShareSheet
 */

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CopyIcon, ForwardIcon } from '../../components/common/Icons';
import './MeetingShareSheet.css';

/**
 * 会议分享/复制文案（与桌面端会议窗「复制会议信息」、加入页粘贴解析同一格式：
 * 「房间号:」与「密码:」两行即可被加入页的 parseRoomInfo 正则解析回填）
 */
export function buildMeetingInviteText(meeting: {
  roomName: string;
  roomId: string;
  password: string;
}): string {
  return `会议名称: ${meeting.roomName}\n房间号: ${meeting.roomId}\n密码: ${meeting.password}`;
}

interface MeetingShareSheetProps {
  /** 是否显示 */
  open: boolean;
  /** 会议名称（预览行展示；密码不进面板预览，与 ShareMeetingModal 预览同一口径） */
  roomName: string;
  /** 房间号（预览行展示） */
  roomId: string;
  /** 关闭（点遮罩/取消） */
  onClose: () => void;
  /** 「转发给好友」意图（调用方据此打开既有 ShareMeetingModal） */
  onForward: () => void;
  /** 「复制会议链接」意图（调用方据此写系统剪贴板） */
  onCopy: () => void;
}

export function MeetingShareSheet({
  open,
  roomName,
  roomId,
  onClose,
  onForward,
  onCopy,
}: MeetingShareSheetProps) {
  const sheet = (
    <AnimatePresence>
      {open && (
        <motion.div
          className="meeting-share-sheet-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="meeting-share-sheet"
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0.6 }}
            transition={{ type: 'tween', duration: 0.22 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="分享会议"
          >
            {/* 顶部：会议预览（名称 + 房间号） */}
            <div className="meeting-share-sheet-header">
              <span className="meeting-share-sheet-title">分享会议</span>
              <span className="meeting-share-sheet-preview">
                {roomName} · #{roomId}
              </span>
            </div>

            {/* 选项①：转发给好友（沿用既有选人/发送链路） */}
            <button
              type="button"
              className="meeting-share-option"
              onClick={onForward}
            >
              <span className="meeting-share-option-icon">
                <ForwardIcon />
              </span>
              <span className="meeting-share-option-texts">
                <span className="meeting-share-option-name">转发给好友</span>
                <span className="meeting-share-option-desc">选择好友或群聊发送会议邀请</span>
              </span>
            </button>

            {/* 选项②：复制会议链接（会议信息写入系统剪贴板） */}
            <button
              type="button"
              className="meeting-share-option"
              onClick={onCopy}
            >
              <span className="meeting-share-option-icon">
                <CopyIcon />
              </span>
              <span className="meeting-share-option-texts">
                <span className="meeting-share-option-name">复制会议链接</span>
                <span className="meeting-share-option-desc">
                  复制会议名称、房间号和密码，粘贴即可入会
                </span>
              </span>
            </button>

            {/* 取消 */}
            <button
              type="button"
              className="meeting-share-sheet-cancel"
              onClick={onClose}
            >
              取消
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(sheet, document.body);
}
