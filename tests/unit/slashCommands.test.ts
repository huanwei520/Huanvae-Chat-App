/**
 * 斜杠命令面板纯逻辑测试（src/chat/shared/slashCommands.ts）
 *
 * - parseSlashQuery：识别"整串形如 /xxx（斜杠 + 非空白，尚无空格）"输入态，
 *   返回斜杠后的查询串（可为空串），否则 null。
 * - filterCommands：按命令名前缀过滤（大小写不敏感），空查询返回全部。
 *
 * fixture 命令名用中性占位（status / report / stop），不含任何真实内部编排命令名。
 */

import { describe, it, expect } from 'vitest';
import { parseSlashQuery, filterCommands } from '../../src/chat/shared/slashCommands';
import type { BotCommand } from '../../src/api/bots';

describe('parseSlashQuery', () => {
  it('单个斜杠 → 空查询串', () => {
    expect(parseSlashQuery('/')).toBe('');
  });

  it('/st → "st"', () => {
    expect(parseSlashQuery('/st')).toBe('st');
  });

  it('尾随空格视为已结束命令输入态 → null', () => {
    expect(parseSlashQuery('/status ')).toBeNull();
  });

  it('非斜杠开头 → null', () => {
    expect(parseSlashQuery('hello')).toBeNull();
  });

  it('空串 → null', () => {
    expect(parseSlashQuery('')).toBeNull();
  });

  it('斜杠后含空格（多词）→ null', () => {
    expect(parseSlashQuery('/multi word')).toBeNull();
  });

  it('斜杠不在开头 → null', () => {
    expect(parseSlashQuery('x/y')).toBeNull();
  });
});

describe('filterCommands', () => {
  const commands: BotCommand[] = [
    { command: 'status', description: '状态' },
    { command: 'report', description: '报表' },
    { command: 'stop', description: '停止' },
  ];

  it('空查询 → 返回全部', () => {
    expect(filterCommands(commands, '').map((c) => c.command)).toEqual([
      'status',
      'report',
      'stop',
    ]);
  });

  it('前缀 "st" → status + stop（startsWith）', () => {
    expect(filterCommands(commands, 'st').map((c) => c.command)).toEqual(['status', 'stop']);
  });

  it('大小写不敏感："ST" 等价于 "st"', () => {
    expect(filterCommands(commands, 'ST').map((c) => c.command)).toEqual(['status', 'stop']);
  });

  it('完整命令名 "report" → 仅 report', () => {
    expect(filterCommands(commands, 'report').map((c) => c.command)).toEqual(['report']);
  });

  it('无匹配前缀 → 空数组', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});
