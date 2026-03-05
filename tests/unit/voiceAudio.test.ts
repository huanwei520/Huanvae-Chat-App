/**
 * AI 语音音频工具单元测试
 *
 * 测试 voiceAudio.ts 中的 encodeWAV 函数
 */

import { describe, it, expect, vi } from 'vitest';

// Mock 浏览器 Audio API（模块加载时 VoiceRecorder/TtsAudioQueue 可能引用）
vi.stubGlobal(
  'AudioContext',
  vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(),
    createScriptProcessor: vi.fn(),
    destination: {},
  })),
);

import { encodeWAV } from '../../src/chat/ai/voice/voiceAudio';

describe('encodeWAV - PCM Int16 转 WAV', () => {
  describe('缓冲区大小', () => {
    it('缓冲区大小应为 44 + samples.length * 2', () => {
      const samples = new Int16Array(100);
      const buffer = encodeWAV(samples, 24000);
      expect(buffer.byteLength).toBe(44 + 100 * 2);
    });

    it('空样本时仅 44 字节头部', () => {
      const samples = new Int16Array(0);
      const buffer = encodeWAV(samples, 24000);
      expect(buffer.byteLength).toBe(44);
    });
  });

  describe('RIFF 头部', () => {
    it('前 4 字节应为 RIFF', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);
      const riff = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      );
      expect(riff).toBe('RIFF');
    });
  });

  describe('WAVE 格式', () => {
    it('字节 8-11 应为 WAVE', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);
      const wave = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11),
      );
      expect(wave).toBe('WAVE');
    });
  });

  describe('fmt 块', () => {
    it('字节 12-15 应为 fmt ', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);
      const fmt = String.fromCharCode(
        view.getUint8(12),
        view.getUint8(13),
        view.getUint8(14),
        view.getUint8(15),
      );
      expect(fmt).toBe('fmt ');
    });
  });

  describe('采样率', () => {
    it('应正确存储 24000 采样率', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);
      expect(view.getUint32(24, true)).toBe(24000);
    });

    it('应正确存储 16000 采样率', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 16000);
      const view = new DataView(buffer);
      expect(view.getUint32(24, true)).toBe(16000);
    });

    it('应正确存储 44100 采样率', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 44100);
      const view = new DataView(buffer);
      expect(view.getUint32(24, true)).toBe(44100);
    });
  });

  describe('data 块', () => {
    it('字节 36 起应为 data 标记', () => {
      const samples = new Int16Array(10);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);
      const data = String.fromCharCode(
        view.getUint8(36),
        view.getUint8(37),
        view.getUint8(38),
        view.getUint8(39),
      );
      expect(data).toBe('data');
    });

    it('数据大小应正确', () => {
      const samples = new Int16Array(100);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);
      expect(view.getUint32(40, true)).toBe(100 * 2);
    });
  });

  describe('样本数据', () => {
    it('样本值应从偏移 44 正确编码', () => {
      const samples = new Int16Array([0, 100, -100, 32767, -32768]);
      const buffer = encodeWAV(samples, 24000);
      const view = new DataView(buffer);

      expect(view.getInt16(44, true)).toBe(0);
      expect(view.getInt16(46, true)).toBe(100);
      expect(view.getInt16(48, true)).toBe(-100);
      expect(view.getInt16(50, true)).toBe(32767);
      expect(view.getInt16(52, true)).toBe(-32768);
    });

    it('空样本时无数据区', () => {
      const samples = new Int16Array(0);
      const buffer = encodeWAV(samples, 24000);
      expect(buffer.byteLength).toBe(44);
    });
  });
});
