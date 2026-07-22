/**
 * 斜杠命令面板纯逻辑（可单测，无 React 依赖）。
 */
import type { BotCommand } from '../../api/bots';

/**
 * 解析输入是否处于"斜杠命令输入"态：整串形如 /xxx（斜杠 + 非空白，尚无空格）。
 * 返回斜杠后的查询串（可为空串），否则 null（非命令输入态）。
 */
export function parseSlashQuery(input: string): string | null {
  const m = /^\/(\S*)$/.exec(input);
  return m ? m[1] : null;
}

/** 按命令名前缀过滤（大小写不敏感）；空查询返回全部。 */
export function filterCommands(commands: BotCommand[], query: string): BotCommand[] {
  if (query === '') { return commands; }
  const q = query.toLowerCase();
  return commands.filter((c) => c.command.toLowerCase().startsWith(q));
}
