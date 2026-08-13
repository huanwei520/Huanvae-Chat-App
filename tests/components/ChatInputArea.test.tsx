/**
 * ChatInputArea 斜杠命令面板集成测试
 *
 * 覆盖 bot 会话下的斜杠命令交互契约：
 * - 输入 `/` → 面板弹出全部命令；前缀过滤（/st → status+stop，/sto → 仅 stop）
 * - 面板打开时 Enter/键盘选中 = 填入 `/cmd `（可编辑），**绝不触发发送**
 * - Esc → 关闭面板
 *
 * 命令名一律中性 fixture（status/stop），不含任何真实内部指令名。
 * useApi 用稳定引用（hoisted）避免 effect 依赖抖动重复 fetch。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// 稳定的 api 引用（组件 useEffect 依赖 [api, botUserId]，不稳定会导致重复 fetch）
const apiMock = vi.hoisted(() => ({}));
// ChatInputArea 自 M-5 起还经 useComposerTrayOutbox 读 useSession（发送编排要 session.userId）。
// 这里只补一个**稳定引用**的假 session：本文件测的是斜杠命令面板，不碰发送编排。
// （引用必须稳定 —— 每次 render 返回新对象会虚假触发下游依赖 session 的 effect，
//   见 .claude/rules/frontend-test.md「mock context hook 的返回值必须引用稳定」）
const sessionMock = vi.hoisted(() => ({
  session: { userId: 'me', profile: { user_nickname: '我', user_avatar_url: '' } },
}));
vi.mock('../../src/contexts/SessionContext', async (orig) => ({
  ...(await orig()),
  useApi: () => apiMock,
  useSession: () => sessionMock,
}));

// bot 命令拉取确定化（与下面 seed 同值，effect 重取不 clobber）
const botsMock = vi.hoisted(() => ({
  getBotCommands: vi.fn().mockResolvedValue({
    commands: [
      { command: 'status', description: '状态' },
      { command: 'stop', description: '停止' },
    ],
  }),
}));
vi.mock('../../src/api/bots', async (orig) => ({
  ...(await orig()),
  getBotCommands: botsMock.getBotCommands,
}));

import { ChatInputArea } from '../../src/chat/shared/ChatInputArea';
import { useChatStore } from '../../src/stores/chatStore';
import { useBotCommandsStore } from '../../src/stores/botCommandsStore';
import type { Friend } from '../../src/types/chat';

const BOT_FRIEND: Friend = {
  friend_id: 'bot_x',
  friend_nickname: 'B',
  friend_avatar_url: null,
  add_time: '',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
};

const SEED_COMMANDS = [
  { command: 'status', description: '状态' },
  { command: 'stop', description: '停止' },
];

function Harness({ onSend }: { onSend: () => void }) {
  const [v, setV] = useState('');
  return (
    <ChatInputArea
      messageInput={v}
      onMessageChange={setV}
      onSendMessage={onSend}
    />
  );
}

beforeEach(() => {
  useBotCommandsStore.getState().clear();
  // 设置 bot 会话目标 + 预置命令（effect 会用同值再 fetch，无 clobber）
  useChatStore.getState().setChatTarget({ type: 'bot', data: BOT_FRIEND });
  useBotCommandsStore.setState({ commandsByBot: { bot_x: SEED_COMMANDS } });
});

function typeInput(value: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
}

describe('ChatInputArea 斜杠命令面板', () => {
  it('输入 / → 面板弹出全部命令', async () => {
    render(<Harness onSend={vi.fn()} />);
    typeInput('/');

    await waitFor(() => expect(screen.getByText('/status')).toBeInTheDocument());
    expect(screen.getByText('/stop')).toBeInTheDocument();
  });

  it('前缀过滤：/st 命中 status+stop，/sto 仅 stop', async () => {
    render(<Harness onSend={vi.fn()} />);

    typeInput('/st');
    await waitFor(() => expect(screen.getByText('/status')).toBeInTheDocument());
    expect(screen.getByText('/stop')).toBeInTheDocument();

    typeInput('/sto');
    await waitFor(() => expect(screen.queryByText('/status')).toBeNull());
    expect(screen.getByText('/stop')).toBeInTheDocument();
  });

  it('面板打开时按 Enter = 填入 `/status `，绝不触发发送', async () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);

    typeInput('/');
    await waitFor(() => expect(screen.getByText('/status')).toBeInTheDocument());

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(textarea.value).toBe('/status '));
    expect(onSend).not.toHaveBeenCalled();
    // 填入后已非命令输入态（尾随空格），面板关闭
    // 注：不能用 queryByText('/status')——testing-library 默认 normalizer 会把 textarea
    // 的 "/status " 裁成 "/status" 反而命中输入框本体；用 listbox role 精确判定面板关闭。
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('面板打开时按 Esc → 关闭面板', async () => {
    render(<Harness onSend={vi.fn()} />);

    typeInput('/');
    await waitFor(() => expect(screen.getByText('/status')).toBeInTheDocument());

    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    await waitFor(() => expect(screen.queryByText('/status')).toBeNull());
  });
});

// —— IME(输入法)组字 vs 普通回车发送 ——
// 覆盖 Mac 中文输入法：组字确认候选词的 Enter 不发送；组字结束后的 Enter 才发送。
// 用 friend 会话（非 bot）→ 斜杠面板恒关，Enter 直连发送主路径。
describe('ChatInputArea 输入法组字回车不误发', () => {
  beforeEach(() => {
    // 覆盖顶层 beforeEach 的 bot 目标：friend 会话下斜杠面板恒关
    useChatStore.getState().setChatTarget({ type: 'friend', data: BOT_FRIEND });
  });

  function typeAndGetTextarea(value: string) {
    typeInput(value);
    return screen.getByRole('textbox') as HTMLTextAreaElement;
  }

  it('普通回车（非组字）→ 发送', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const ta = typeAndGetTextarea('你好');
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('Shift+Enter → 换行，不发送', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const ta = typeAndGetTextarea('你好');
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('isComposing=true 的回车（确认候选词）→ 不发送', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const ta = typeAndGetTextarea('nihao');
    fireEvent.keyDown(ta, { key: 'Enter', isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keyCode=229 的回车（旧内核组字键码）→ 不发送', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const ta = typeAndGetTextarea('nihao');
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('compositionstart 后回车（isComposing 未随 keydown 置位的内核）→ 不发送', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const ta = typeAndGetTextarea('nihao');
    fireEvent.compositionStart(ta);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('compositionend 之后回车 → 发送', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    const ta = typeAndGetTextarea('你好');
    fireEvent.compositionStart(ta);
    fireEvent.compositionEnd(ta);
    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
