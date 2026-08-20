/**
 * 邀请成员表单（群设置面板的 `invite` 视图）
 *
 * @location src/chat/shared/menu/InviteForm.tsx
 *
 * 选人整个复用 `components/share/ShareTargetPicker`（转发 / 会议分享 / 群名片同一个组件），
 * 只多传一个 `targetTypes={['friend']}` 把群那一段收掉 —— 往群里邀请一个群没有意义。
 * 复用而不是自己再写一遍列表，是因为「可搜索 + 多选 + 按最近排序 + 已选 chip」这套
 * 交互一旦分叉，四个入口就会各自漂移。
 *
 * 🔴 原先这里是一个「输入用户 ID」的文本框：要求用户先从别处抄到对方的 user_id 才能邀请，
 * 而 App 里根本没有展示 user_id 的地方。该框已**整块删除**，不留「也可以手输 ID」的第二条路
 * （邀请非好友入群这个场景在 App 里没有任何现存入口，见交付说明）。
 *
 * 附言（`message`）仍由本视图承担，是**父级受控**的：选择器打开时它已经填好，
 * `onInvite` 一并带出去。
 *
 * 挂载语义与另外三个消费方一致：`{pickerOpen && <ShareTargetPicker …/>}`，
 * 关闭由选择器自己播完退场动画后回调。
 */

import { useState } from 'react';
import { MenuHeader } from './MenuHeader';
import { ShareTargetPicker, type ShareTarget } from '../../../components/share/ShareTargetPicker';

/** 只让选好友：往群里邀请一个群没有意义，且 invite 接口只收 user_ids */
const INVITE_TARGET_TYPES: ReadonlyArray<'friend' | 'group'> = ['friend'];

interface InviteFormProps {
  /** 邀请附言（父级受控，见 useChatMenu 的 inviteMessage） */
  message: string;
  loading: boolean;
  onMessageChange: (value: string) => void;
  /**
   * 执行邀请。**失败必须抛**——选择器靠 reject 才会把错误文案摆在面板上、
   * 不关闭、不清空已选（见 useChatMenu.handleInviteMembers 的注释）。
   */
  onInvite: (userIds: string[]) => Promise<void>;
  onBack: () => void;
}

export function InviteForm({
  message,
  loading,
  onMessageChange,
  onInvite,
  onBack,
}: InviteFormProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <>
      <MenuHeader title="邀请成员" onBack={onBack} />
      <div className="menu-form">
        <input
          type="text"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          placeholder="邀请消息（可选）"
          className="menu-input"
        />
        <button
          className="menu-submit"
          onClick={() => setPickerOpen(true)}
          disabled={loading}
        >
          {loading ? '发送中...' : '从好友列表选择'}
        </button>
      </div>

      {pickerOpen && (
        <ShareTargetPicker
          title="邀请好友入群"
          targetTypes={INVITE_TARGET_TYPES}
          confirmLabel="邀请"
          sentLabel="已邀请"
          countUnit="位好友"
          onConfirm={(targets: ShareTarget[]) => onInvite(targets.map((t) => t.id))}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
