/**
 * wsHandlers.isGroupSenderFolded — 群消息折叠发送者判定测试（M2 通知抑制依据）
 *
 * 锁定契约：群消息发送者「对我已折叠」时（D6 群内屏蔽 / 好友拉黑后发的），
 * 该消息在列表渲染成折叠占位，wsHandlers 据此抑制系统通知。判定须与 GroupMessageBubble
 * 的折叠逻辑一致：D6 屏蔽始终折叠；好友拉黑仅折叠拉黑时间点之后发的。
 */

import { describe, it, expect } from 'vitest';

// 仅 import 纯函数；不触发 wsHandlers 的副作用依赖
import { isGroupSenderFolded } from '../../src/contexts/wsHandlers';

const T0 = '2026-02-01T00:00:00Z';   // 拉黑时间点
const BEFORE = '2026-01-31T23:59:59Z';
const AFTER = '2026-02-01T00:00:01Z';

describe('isGroupSenderFolded', () => {
  it('D6 群内屏蔽：发送者在屏蔽集 → 折叠（与发送时间无关）', () => {
    expect(isGroupSenderFolded(['u2'], {}, 'u2', BEFORE)).toBe(true);
    expect(isGroupSenderFolded(['u2'], {}, 'u2', AFTER)).toBe(true);
  });

  it('好友拉黑：发送时间晚于拉黑时间点 → 折叠', () => {
    expect(isGroupSenderFolded(undefined, { u2: T0 }, 'u2', AFTER)).toBe(true);
  });

  it('好友拉黑：发送时间早于拉黑时间点 → 不折叠（保留拉黑前历史）', () => {
    expect(isGroupSenderFolded(undefined, { u2: T0 }, 'u2', BEFORE)).toBe(false);
  });

  it('既未屏蔽也未拉黑 → 不折叠', () => {
    expect(isGroupSenderFolded([], {}, 'u2', AFTER)).toBe(false);
    expect(isGroupSenderFolded(undefined, {}, 'u2', AFTER)).toBe(false);
  });

  it('屏蔽集为他人 / 拉黑为他人 → 该发送者不折叠', () => {
    expect(isGroupSenderFolded(['other'], { other: T0 }, 'u2', AFTER)).toBe(false);
  });
});
