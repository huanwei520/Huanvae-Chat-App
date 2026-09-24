/**
 * 组合消息信封测试（src/chat/shared/combinedMessage.ts）
 *
 * 覆盖四件真实会写错的事：
 * 1. build → parse 往返一致（发送侧打包的内容接收侧原样拆出）；
 * 2. 严格校验：旧消息 / 普通文本 / 畸形 JSON / 字段不全的信封一律返回 null，
 *    绝不半拆 —— 这是「旧消息零感知、不崩溃」的实现点；
 * 3. stripCombinedEnvelope 对预览/搜索路径的语义：信封取正文，其余原样透传；
 * 4. 特殊字符往返：引号、换行、emoji、中文、看似 JSON 的正文都不丢不变形。
 */

import { describe, it, expect } from 'vitest';
import {
  buildCombinedMessageContent,
  parseCombinedMessageContent,
  stripCombinedEnvelope,
  type ReplySnapshot,
} from '../../src/chat/shared/combinedMessage';

const SNAPSHOT: ReplySnapshot = {
  reply_to: '019ae4ef-cbf6-7171-88c5-6a891004fc8f',
  sender_name: 'Alice',
  summary: '很早之前发的原文',
  message_type: 'text',
  send_time: '2025-06-01T12:00:00Z',
};

describe('buildCombinedMessageContent → parseCombinedMessageContent 往返', () => {
  it('往返一致：正文与快照逐字段还原', () => {
    const wire = buildCombinedMessageContent('这是回复正文', SNAPSHOT);
    const parsed = parseCombinedMessageContent(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.text).toBe('这是回复正文');
    expect(parsed!.reply).toEqual(SNAPSHOT);
  });

  it('信封是合法 JSON 且 message_type 仍为 text 语义（wire 面不变式）', () => {
    const wire = buildCombinedMessageContent('回复', SNAPSHOT);
    const obj = JSON.parse(wire);
    expect(obj.hv_combo_v1).toBe(1);
    expect(obj.text).toBe('回复');
    expect(obj.reply.reply_to).toBe(SNAPSHOT.reply_to);
  });

  it('特殊字符往返：引号 / 换行 / emoji / 反斜杠都不变形', () => {
    const tricky = '引号"反斜杠\\换行\n制表\temoji 🙂 中文「引号」</script>';
    const parsed = parseCombinedMessageContent(buildCombinedMessageContent(tricky, SNAPSHOT));
    expect(parsed!.text).toBe(tricky);
  });
});

describe('parseCombinedMessageContent 严格校验（兼容性核心）', () => {
  it('普通文本（旧消息绝大多数形态）返回 null', () => {
    expect(parseCombinedMessageContent('你好')).toBeNull();
    expect(parseCombinedMessageContent('')).toBeNull();
  });

  it('畸形 JSON 返回 null，绝不抛错', () => {
    expect(parseCombinedMessageContent('{"hv_combo_v1":1,"text":"截断')).toBeNull();
    expect(parseCombinedMessageContent('{not-json}')).toBeNull();
  });

  it('没有标记键的 JSON 返回 null（用户手打的普通 JSON 不被误拆）', () => {
    expect(parseCombinedMessageContent('{"text":"你好","reply":{}}')).toBeNull();
  });

  it('标记键存在但 reply 缺失 / 非对象返回 null', () => {
    expect(parseCombinedMessageContent('{"hv_combo_v1":1,"text":"hi"}')).toBeNull();
    expect(parseCombinedMessageContent('{"hv_combo_v1":1,"text":"hi","reply":"x"}')).toBeNull();
    expect(parseCombinedMessageContent('{"hv_combo_v1":1,"text":"hi","reply":[1,2]}')).toBeNull();
  });

  it('快照缺任一必填字段整包拒收（不半拆）', () => {
    for (const field of ['reply_to', 'sender_name', 'summary', 'message_type'] as const) {
      const broken: Record<string, unknown> = { ...SNAPSHOT };
      delete broken[field];
      const wire = JSON.stringify({ hv_combo_v1: 1, text: 'hi', reply: broken });
      expect(parseCombinedMessageContent(wire)).toBeNull();
    }
  });

  it('text 非字符串 / 根是数组 / 根是标量返回 null', () => {
    expect(parseCombinedMessageContent('{"hv_combo_v1":1,"text":5,"reply":' + JSON.stringify(SNAPSHOT) + '}')).toBeNull();
    expect(parseCombinedMessageContent('[{"hv_combo_v1":1}]')).toBeNull();
    expect(parseCombinedMessageContent('null')).toBeNull();
    expect(parseCombinedMessageContent('42')).toBeNull();
  });

  it('send_time 缺省容忍为 null（快照四件套齐全即可信），非字符串则拒收', () => {
    const withoutTime = JSON.stringify({
      hv_combo_v1: 1,
      text: 'hi',
      reply: { reply_to: 'u', sender_name: 'A', summary: 's', message_type: 'text' },
    });
    const parsed = parseCombinedMessageContent(withoutTime);
    expect(parsed!.reply.send_time).toBeNull();
    const badTime = JSON.stringify({
      hv_combo_v1: 1,
      text: 'hi',
      reply: { ...SNAPSHOT, send_time: 12345 },
    });
    expect(parseCombinedMessageContent(badTime)).toBeNull();
  });
});

describe('stripCombinedEnvelope（预览 / 搜索 / 通知路径用）', () => {
  it('信封取回复正文', () => {
    const wire = buildCombinedMessageContent('回复正文', SNAPSHOT);
    expect(stripCombinedEnvelope(wire)).toBe('回复正文');
  });

  it('非信封原样透传：普通文本、任意 JSON、空串', () => {
    expect(stripCombinedEnvelope('普通文本')).toBe('普通文本');
    expect(stripCombinedEnvelope('{"a":1}')).toBe('{"a":1}');
    expect(stripCombinedEnvelope('')).toBe('');
  });
});
