/**
 * 故障日志脱敏单测（红线：token/密码/密钥/鉴权头一律写入前脱敏）
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeForFaultLog,
  sanitizeUrlForFaultLog,
  stringifyAndSanitize,
  isChatCarrierObject,
  CHAT_CARRIER_REDACTED,
  REDACTED,
} from '../../src/services/faultReport/sanitizer';

describe('faultReport sanitizer —— 脱敏红线', () => {
  it('Bearer 载荷脱敏', () => {
    const out = sanitizeForFaultLog('请求头: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain(`Bearer ${REDACTED}`);
  });

  it.each([
    ['token=abc123', 'abc123'],
    ['token: abc123', 'abc123'],
    ['password=hunter2', 'hunter2'],
    ['passwd=hunter2', 'hunter2'],
    ['pwd: hunter2', 'hunter2'],
    ['secret=my-secret-val', 'my-secret-val'],
    ['client_secret=cs_val', 'cs_val'],
    ['refresh_token=rt_val', 'rt_val'],
    ['access_token=at_val', 'at_val'],
    ['api_key=AKIAEXAMPLE', 'AKIAEXAMPLE'],
    ['apikey=AKIAEXAMPLE', 'AKIAEXAMPLE'],
    ['session_id=sess123', 'sess123'],
  ])('键值对形态 %s 脱敏', (src, secret) => {
    const out = sanitizeForFaultLog(src);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it('URL query 中的 token= 脱敏且保留其余参数', () => {
    const out = sanitizeForFaultLog('GET /api/files?token=qsh123456&size=10 HTTP/1.1');
    expect(out).not.toContain('qsh123456');
    expect(out).toContain('size=10');
  });

  it('JSON 双引号同名字段脱敏，非敏感字段保留', () => {
    const src = '{"user_id":"u1","token":"s3cr3t-value","password":"pw12345","note":"ok"}';
    const out = sanitizeForFaultLog(src);
    expect(out).not.toContain('s3cr3t-value');
    expect(out).not.toContain('pw12345');
    expect(out).toContain('u1');
    expect(out).toContain('"note":"ok"');
  });

  it('JSON 嵌套同名字段（access_token / refresh_token / authorization）脱敏', () => {
    const src = '{"data":{"access_token":"aaa.bbb.ccc","refresh_token":"rrr","authorization":"Basic abc"}}';
    const out = sanitizeForFaultLog(src);
    expect(out).not.toContain('aaa.bbb.ccc');
    expect(out).not.toContain('rrr');
    expect(out).not.toContain('Basic abc');
  });

  it('authorization 头整行脱敏', () => {
    const out = sanitizeForFaultLog('authorization: Bearer sometokenvalue123');
    expect(out).not.toContain('sometokenvalue123');
    expect(out.toLowerCase()).toContain('authorization:');
  });

  it('长十六进制串脱敏', () => {
    const hex = 'deadbeef'.repeat(6); // 48 位
    const out = sanitizeForFaultLog(`sig=${hex} ok`);
    expect(out).not.toContain(hex);
    expect(out).toContain('ok');
  });

  it('普通文本不受影响（不误伤）', () => {
    const src = 'GET /api/messages?since=1700000000&limit=50 -> 200';
    expect(sanitizeForFaultLog(src)).toBe(src);
  });

  it('幂等：已脱敏文本再次脱敏结果不变', () => {
    const once = sanitizeForFaultLog('login token=abc123 done');
    const twice = sanitizeForFaultLog(once);
    expect(twice).toBe(once);
  });

  it('聊天正文形态的输入不因“看起来像日志”而泄漏键值 —— 值一律替换', () => {
    // 即使正文里出现 token= 形态，也只可能整值替换，绝不会原样保留
    const out = sanitizeForFaultLog('user said: my token=letmein please');
    expect(out).not.toContain('letmein');
  });

  it('stringifyAndSanitize：Error 堆栈中令牌脱敏', () => {
    const err = new Error('request failed with token=sk-live-abcdef123456');
    const out = stringifyAndSanitize(err);
    expect(out).not.toContain('sk-live-abcdef123456');
    expect(out).toContain('request failed');
  });

  it('stringifyAndSanitize：对象序列化后脱敏', () => {
    const out = stringifyAndSanitize({ url: '/api/x', password: 'p@ss' });
    expect(out).not.toContain('p@ss');
    expect(out).toContain('/api/x');
  });
});

describe('sanitizeUrlForFaultLog —— 网络错误 URL 专项脱敏（query 值一律剥除）', () => {
  it('绝对 URL：敏感键 access_token 的值被剥除，键名保留', () => {
    const out = sanitizeUrlForFaultLog('https://api.example.cn/v1/list?access_token=SECRET-TOK-123&page=2');
    expect(out).not.toContain('SECRET-TOK-123');
    expect(out).toContain('access_token=');
    expect(out).toContain('page=');
  });

  it('绝对 URL：非敏感键的值也一并剥除（值一律不可信）', () => {
    const out = sanitizeUrlForFaultLog('https://api.example.cn/v1/list?sign=9f8e7d6c&uid=42');
    expect(out).not.toContain('9f8e7d6c');
    expect(out).not.toContain('uid=42');
    expect(out).toContain('sign=');
    expect(out).toContain('uid=');
  });

  it('hash 片段整体剥除（含 hash 中的鉴权态）', () => {
    const out = sanitizeUrlForFaultLog('https://app.example.cn/session#access_token=HASH-SECRET');
    expect(out).not.toContain('HASH-SECRET');
    expect(out).not.toContain('#');
  });

  it('无 query 的绝对 URL：仅剥 hash，路径原样', () => {
    const out = sanitizeUrlForFaultLog('https://127.0.0.1:1/definitely-unreachable');
    expect(out).toBe('https://127.0.0.1:1/definitely-unreachable');
  });

  it('相对路径：query 值剥除，路径保留', () => {
    const out = sanitizeUrlForFaultLog('/api/fault-reports?token=REL-SECRET&size=10');
    expect(out).not.toContain('REL-SECRET');
    expect(out).toContain('/api/fault-reports?');
    expect(out).toContain('token=');
  });

  it('纯文本形态：过通用脱敏兑底', () => {
    const out = sanitizeUrlForFaultLog('Bearer ABC.123.XYZ');
    expect(out).not.toContain('ABC.123.XYZ');
    expect(out).toContain('Bearer');
  });

  it('幂等：已脱敏 URL 再次处理结果不变', () => {
    const once = sanitizeUrlForFaultLog('https://api.example.cn/v1/x?token=SECRET&k=v');
    const twice = sanitizeUrlForFaultLog(once);
    expect(twice).toBe(once);
    expect(twice).not.toContain('SECRET');
  });

  it('脱敏后仍可解析回原路径与参数结构（可诊断性）', () => {
    const out = sanitizeUrlForFaultLog('https://api.example.cn/v1/fault-reports?auth_bearer=SEC&ts=1789500000');
    const parsed = new URL(out);
    expect(parsed.origin + parsed.pathname).toBe('https://api.example.cn/v1/fault-reports');
    expect(parsed.searchParams.get('auth_bearer')).toBe(REDACTED);
    expect(parsed.searchParams.get('ts')).toBe(REDACTED);
  });
});

describe('聊天正文零采集（硬红线）：载体对象丢弃 + JSON content 族兑底', () => {
  it('isChatCarrierObject：消息对象（content+conversationId）命中', () => {
    expect(isChatCarrierObject({ id: 'm1', content: '你好，明天见', conversationId: 'c9', senderId: 'u1' })).toBe(true);
  });

  it('isChatCarrierObject：嵌套/数组形态命中（{data:{...msg}} / {messages:[...]}）', () => {
    expect(isChatCarrierObject({ data: { content: '秘密', messageId: 'm2' } })).toBe(true);
    expect(isChatCarrierObject({ messages: [{ content: '秘密', chatId: 'c1' }] })).toBe(true);
  });

  it('isChatCarrierObject：普通日志对象不误伤（无 content 键）', () => {
    expect(isChatCarrierObject({ level: 'info', msg: 'ok', count: 3 })).toBe(false);
    expect(isChatCarrierObject({ url: '/api/x', status: 200 })).toBe(false);
  });

  it('stringifyAndSanitize：消息对象整体丢弃，正文零序列化', () => {
    const out = stringifyAndSanitize({ id: 'm1', content: '今晚老地方见', conversationId: 'c9', senderId: 'u1' });
    expect(out).toBe(CHAT_CARRIER_REDACTED);
    expect(out).not.toContain('今晚老地方见');
    expect(out).not.toContain('"c9"');
  });

  it('JSON 兑底：非载体形态但含 content 字符串值被剥（防变体漏网）', () => {
    const out = sanitizeForFaultLog('render done {"content":"聊天内容别采集","other":"ok"}');
    expect(out).not.toContain('聊天内容别采集');
    expect(out).toContain('"content"');
    expect(out).toContain('"ok"');
  });
});
