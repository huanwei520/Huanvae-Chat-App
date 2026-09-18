/**
 * 故障日志环形缓冲（字节上限，超限滚动丢弃最旧）
 *
 * - 容量按【字节】计（UTF-8 编码后），上限见 config.FAULT_LOG_BUFFER_MAX_BYTES（10MB）
 * - push 时逐条计入；单条超上限时整条丢弃（并记一条丢弃计数），多条超限时从队首滚动丢弃
 * - snapshot(sinceMs) 按时间窗导出（供"开启记录自动附带最近 5 分钟"使用）
 * - 记录写入【前】由调用方完成脱敏（本缓冲不做二次脱敏，脱敏单测见 sanitizer）
 *
 * @module services/faultReport/ringBuffer
 */

import { FAULT_LOG_BUFFER_MAX_BYTES } from './config';

export interface FaultLogEntry {
  /** epoch ms */
  at: number;
  /** 来源面：frontend console / exception / network / rust */
  source: 'console' | 'exception' | 'network' | 'rust';
  /** 级别（console 级别或 error/info） */
  level: string;
  /** 已脱敏文本 */
  text: string;
}

function utf8Bytes(s: string): number {
  // TextEncoder 每次新建开销大；jsdom/浏览器均支持全局 TextEncoder。
  if (typeof TextEncoder !== 'undefined') {
    const enc = faultTextEncoder ?? (faultTextEncoder = new TextEncoder());
    return enc.encode(s).length;
  }
  // 退化估算（不含 TextEncoder 的极端环境）
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      n += 1;
    } else if (c < 0x800 || (c >= 0xd800 && c < 0xe000)) {
      n += 2;
    } else {
      n += 3;
    }
  }
  return n;
}

let faultTextEncoder: TextEncoder | null = null;

export class FaultRingBuffer {
  private entries: FaultLogEntry[] = [];
  private bytes = 0;
  private droppedCount = 0;

  constructor(private readonly maxBytes: number = FAULT_LOG_BUFFER_MAX_BYTES) {
    if (maxBytes <= 0) {
      throw new Error(`FaultRingBuffer maxBytes must be > 0, got ${maxBytes}`);
    }
  }

  /** 写入一条（调用方保证已脱敏）。返回是否实际入缓冲（false = 单条超上限被整条丢弃）。 */
  push(entry: FaultLogEntry): boolean {
    const size = utf8Bytes(entry.text) + 64 /* 元数据冗余 */;
    if (size > this.maxBytes) {
      this.droppedCount += 1;
      return false;
    }
    while (this.bytes + size > this.maxBytes && this.entries.length > 0) {
      const oldest = this.entries.shift();
      if (oldest) {
        this.bytes -= utf8Bytes(oldest.text) + 64;
        this.droppedCount += 1;
      }
    }
    this.entries.push(entry);
    this.bytes += size;
    return true;
  }

  /**
   * 导出时间窗内的记录（at >= sinceMs），渲染为行文本（含时间戳与来源前缀）。
   * 若发生过滚动丢弃，在首行附丢弃计数，保证后台可感知窗口截断。
   */
  snapshot(sinceMs = 0): string {
    const picked = this.entries.filter((e) => e.at >= sinceMs);
    const droppedInWindow = this.droppedCount > 0 ? `\n[buffer] 已滚动丢弃最旧记录 ${this.droppedCount} 条（10MB 上限）` : '';
    const body = picked
      .map((e) => `${new Date(e.at).toISOString()} [${e.source}/${e.level}] ${e.text}`)
      .join('\n');
    return (body + droppedInWindow).trim();
  }

  /** 当前缓冲条数 / 字节数 / 累计丢弃数（UI 展示与测试断言用） */
  stats(): { count: number; bytes: number; dropped: number } {
    return { count: this.entries.length, bytes: this.bytes, dropped: this.droppedCount };
  }

  /** 清空（提交成功后调用，避免旧报告残留进下一次） */
  clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.droppedCount = 0;
  }
}
