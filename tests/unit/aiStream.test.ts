/**
 * streamAIMessage SSE 流式解析专项测试（src/api/ai.ts）
 *
 * 全链路真实驱动：file 级 mock @tauri-apps/api/core，提供可控 FakeChannel；
 * streamAIMessage 同步调用 invoke，测试从 invoke 捕获 req + onEvent Channel，
 * 直接向 Channel 喂 chunk/done/error 事件，验证：
 *   - invoke 契约（命令名/URL/头/body/pin_ca 注入）
 *   - direct_ip 直连改写（rewriteUrlHost 真跑，仅 mock discovery）
 *   - SSE 行解析：跨 chunk 分片重组、全事件分发、done flush 尾块
 *   - settled 守卫：abort / done / error 后不再处理事件
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';

// vi.mock 工厂被提升到 import 之前，共享引用必须经 vi.hoisted（见 frontend-test.md）
const core = vi.hoisted(() => {
  const invoke = vi.fn();
  /** 可控 Channel 假件：SUT new 出实例并赋 onmessage，测试直接调用它喂事件 */
  class FakeChannel<T> {
    onmessage: (msg: T) => void = () => {};
  }
  return { invoke, FakeChannel };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke, Channel: core.FakeChannel }));

const discovery = vi.hoisted(() => ({
  resolveForSecureHttp: vi.fn(),
}));
vi.mock('../../src/services/discovery', () => ({
  resolveForSecureHttp: discovery.resolveForSecureHttp,
}));

import { streamAIMessage, type AIStreamCallbacks } from '../../src/api/ai';

/** 对齐 ai.ts 内部 SecureStreamEvent（未导出，测试侧镜像） */
type SecureStreamEvent =
  | { event: 'open'; status: number }
  | { event: 'chunk'; data: string }
  | { event: 'done' }
  | { event: 'error'; message: string };

/** invoke 捕获到的 req 形状（secure_http_stream 契约） */
interface CapturedReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  pin_ca?: boolean;
  extra_ca_pem?: string;
}

function makeApi() {
  return {
    getBaseUrl: vi.fn(() => 'https://api.example.com'),
    getAccessToken: vi.fn(() => 'tok'),
  } as unknown as ApiClient;
}

function makeCallbacks() {
  return {
    onConversationId: vi.fn(),
    onStatus: vi.fn(),
    onReasoning: vi.fn(),
    onContent: vi.fn(),
    onToolCall: vi.fn(),
    onToolCallPending: vi.fn(),
    onToolResult: vi.fn(),
    onUsage: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
  } satisfies AIStreamCallbacks;
}

/** 取第 n 次 invoke 调用捕获的命令名 / req / Channel */
function capture(callIndex = 0) {
  const call = core.invoke.mock.calls[callIndex] as unknown as [
    string,
    { req: CapturedReq; onEvent: { onmessage: (msg: SecureStreamEvent) => void } },
  ];
  return { cmd: call[0], req: call[1].req, ch: call[1].onEvent };
}

describe('streamAIMessage SSE 流式解析 (api/ai)', () => {
  beforeEach(() => {
    core.invoke.mockReset();
    core.invoke.mockResolvedValue(undefined);
    discovery.resolveForSecureHttp.mockReset();
    discovery.resolveForSecureHttp.mockReturnValue(null);
  });

  it('invoke 契约：命令名/POST/URL/头/body，无 conversationId 时 body 不含 conversation_id，默认注入 pin_ca', async () => {
    const cb = makeCallbacks();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb);

    const { cmd, req, ch } = capture();
    expect(cmd).toBe('secure_http_stream');
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.example.com/api/ai/chat/stream');
    expect(req.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    });
    // 精确整体比对：无 conversation_id 键
    expect(JSON.parse(req.body)).toEqual({ message: 'hi' });
    expect(req.pin_ca).toBe(true);

    ch.onmessage({ event: 'done' });
    await p;
  });

  it('invoke 契约：传 conversationId 时 body 含 conversation_id', async () => {
    const p = streamAIMessage(makeApi(), 'hi', 'conv-9', makeCallbacks());

    const { req, ch } = capture();
    expect(JSON.parse(req.body)).toEqual({ message: 'hi', conversation_id: 'conv-9' });

    ch.onmessage({ event: 'done' });
    await p;
  });

  it('direct_ip 注入：URL 主机改写为 IP:端口，direct_* 不下发 Rust（req 无这两个键）', async () => {
    discovery.resolveForSecureHttp.mockReturnValue({
      pin_ca: true,
      direct_ip: '10.0.0.9',
      direct_port: 8443,
    });
    const p = streamAIMessage(makeApi(), 'hi', undefined, makeCallbacks());

    const { req, ch } = capture();
    expect(req.url).toBe('https://10.0.0.9:8443/api/ai/chat/stream');
    expect(req.pin_ca).toBe(true);
    expect(req).not.toHaveProperty('direct_ip');
    expect(req).not.toHaveProperty('direct_port');

    ch.onmessage({ event: 'done' });
    await p;
  });

  it('分片重组：SSE 行被拆到两个 chunk 时缓冲拼回，onContent 恰好触发一次', async () => {
    const cb = makeCallbacks();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb);
    const { ch } = capture();

    ch.onmessage({ event: 'chunk', data: 'event: content\nda' });
    // 行未完整（'da' 留在 buffer），不得提前分发
    expect(cb.onContent).not.toHaveBeenCalled();

    ch.onmessage({ event: 'chunk', data: 'ta: hello\n\n' });
    expect(cb.onContent).toHaveBeenCalledTimes(1);
    expect(cb.onContent).toHaveBeenCalledWith('hello');

    ch.onmessage({ event: 'done' });
    await p;
  });

  it('事件分发：全部 SSE 事件类型按精确载荷分发（含空 data 行与裸 data: 行）', async () => {
    const cb = makeCallbacks();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb);
    const { ch } = capture();

    const sse = [
      'event: conversation_id',
      'data: c-1',
      '',
      'event: status',
      'data: thinking',
      '',
      // reasoning 空 data 行（'data: ' 带尾随空格）→ 补 '\n'
      'event: reasoning',
      'data: ',
      '',
      // content 裸 'data:'（无空格，仅 content 事件下有效）→ 补 '\n'
      'event: content',
      'data:',
      '',
      'event: tool_call',
      'data: {"id":"t1","name":"search","arguments":"{\\"q\\":\\"x\\"}"}',
      '',
      'event: tool_call_pending',
      'data: {"pending_id":"p1","name":"send_msg","arguments":"{}","expires_at":"2026-01-01T00:00:00Z"}',
      '',
      'event: tool_result',
      'data: {"name":"search","success":true}',
      '',
      'event: usage',
      'data: {"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}',
      '',
      'event: error',
      'data: boom',
      '',
      'event: done',
      'data: ',
      '',
    ].join('\n');
    ch.onmessage({ event: 'chunk', data: sse });

    expect(cb.onConversationId).toHaveBeenCalledWith('c-1');
    expect(cb.onStatus).toHaveBeenCalledWith('thinking');
    expect(cb.onReasoning).toHaveBeenCalledWith('\n');
    expect(cb.onContent).toHaveBeenCalledTimes(1);
    expect(cb.onContent).toHaveBeenCalledWith('\n');
    expect(cb.onToolCall).toHaveBeenCalledWith({ id: 't1', name: 'search', arguments: '{"q":"x"}' });
    expect(cb.onToolCallPending).toHaveBeenCalledWith({
      pending_id: 'p1',
      name: 'send_msg',
      arguments: '{}',
      expires_at: '2026-01-01T00:00:00Z',
    });
    expect(cb.onToolResult).toHaveBeenCalledWith({ name: 'search', success: true });
    expect(cb.onUsage).toHaveBeenCalledWith({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    expect(cb.onError).toHaveBeenCalledWith('boom');
    expect(cb.onDone).toHaveBeenCalledTimes(1);

    ch.onmessage({ event: 'done' });
    await p;
  });

  it('tool_call 载荷非法 JSON：onToolCall 不触发、不抛错，后续事件照常分发', async () => {
    const cb = makeCallbacks();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb);
    const { ch } = capture();

    ch.onmessage({
      event: 'chunk',
      data: 'event: tool_call\ndata: {not-json\n\nevent: content\ndata: after\n\n',
    });
    expect(cb.onToolCall).not.toHaveBeenCalled();
    expect(cb.onContent).toHaveBeenCalledWith('after');

    ch.onmessage({ event: 'done' });
    await p;
  });

  it('done flush：无尾随换行的残留行在 done 时补 \\n 冲刷分发，promise resolve', async () => {
    const cb = makeCallbacks();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb);
    const { ch } = capture();

    ch.onmessage({ event: 'chunk', data: 'event: content\ndata: tail' });
    expect(cb.onContent).not.toHaveBeenCalled();

    ch.onmessage({ event: 'done' });
    expect(cb.onContent).toHaveBeenCalledTimes(1);
    expect(cb.onContent).toHaveBeenCalledWith('tail');
    await p;
  });

  it('通道 error（JSON 错误体）：reject 并解出 error 字段', async () => {
    const p = streamAIMessage(makeApi(), 'hi', undefined, makeCallbacks());
    const { ch } = capture();

    ch.onmessage({ event: 'error', message: '{"error":"上游 500"}' });
    await expect(p).rejects.toThrow('上游 500');
  });

  it('通道 error（非 JSON 错误体）：reject 原始 message', async () => {
    const p = streamAIMessage(makeApi(), 'hi', undefined, makeCallbacks());
    const { ch } = capture();

    ch.onmessage({ event: 'error', message: 'raw fail' });
    await expect(p).rejects.toThrow('raw fail');
  });

  it('abort：中止后收到 chunk 即提前 resolve、不分发该 chunk，settle 后再喂事件为 no-op', async () => {
    const cb = makeCallbacks();
    const ac = new AbortController();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb, ac.signal);
    const { ch } = capture();

    ac.abort();
    ch.onmessage({ event: 'chunk', data: 'event: content\ndata: x\n\n' });
    await p; // 提前 resolve
    expect(cb.onContent).not.toHaveBeenCalled();

    // settled 守卫：后续事件直接忽略
    ch.onmessage({ event: 'chunk', data: 'event: content\ndata: y\n\n' });
    expect(cb.onContent).not.toHaveBeenCalled();
  });

  it('invoke 本身 reject：promise 以该错误 reject', async () => {
    core.invoke.mockRejectedValue(new Error('invoke boom'));
    const p = streamAIMessage(makeApi(), 'hi', undefined, makeCallbacks());
    await expect(p).rejects.toThrow('invoke boom');
  });

  it('done 之后的事件被忽略（settled 守卫）：onContent 不再触发', async () => {
    const cb = makeCallbacks();
    const p = streamAIMessage(makeApi(), 'hi', undefined, cb);
    const { ch } = capture();

    ch.onmessage({ event: 'done' });
    await p;

    ch.onmessage({ event: 'chunk', data: 'event: content\ndata: x\n\n' });
    expect(cb.onContent).not.toHaveBeenCalled();
  });
});
