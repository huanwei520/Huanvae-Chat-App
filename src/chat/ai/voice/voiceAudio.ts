/**
 * AI 语音通话音频工具
 *
 * - encodeWAV: PCM Int16 → WAV ArrayBuffer（24kHz/16-bit/mono）
 * - VoiceRecorder: 持续录音，每帧编码 WAV 并通过回调发送，内置前端 VAD
 * - TtsAudioQueue: 分句 TTS 音频排队播放器
 */

const SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

/** RMS 能量阈值，超过此值认为有语音活动 */
const SPEECH_RMS_THRESHOLD = 0.02;
/** 连续超过阈值的帧数，达到后判定为用户说话 */
const SPEECH_FRAMES_THRESHOLD = 3;

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** PCM Int16 → WAV ArrayBuffer（含 RIFF/WAVE 文件头） */
export function encodeWAV(samples: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  return buffer;
}

/** 计算 Float32 PCM 数据的 RMS 能量 */
function computeRMS(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

/**
 * 持续录音器
 *
 * 使用 getUserMedia + AudioContext(16kHz) + ScriptProcessor 获取 PCM，
 * 每帧自动编码为 WAV 并通过 onAudioFrame 回调发送给 WebSocket。
 * 内置前端 VAD：当连续多帧 RMS 能量超过阈值时触发 onSpeechDetected 回调。
 */
export class VoiceRecorder {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private _isMuted = false;
  private speechFrameCount = 0;

  onAudioFrame: ((wav: ArrayBuffer) => void) | null = null;
  onSpeechDetected: (() => void) | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (this._isMuted) { return; }

      const pcmFloat = e.inputBuffer.getChannelData(0);

      // 前端 VAD：检测用户说话
      const rms = computeRMS(pcmFloat);
      if (rms > SPEECH_RMS_THRESHOLD) {
        this.speechFrameCount++;
        if (this.speechFrameCount >= SPEECH_FRAMES_THRESHOLD) {
          this.onSpeechDetected?.();
          this.speechFrameCount = 0;
        }
      } else {
        this.speechFrameCount = 0;
      }

      // Float32 → Int16
      const pcm16 = new Int16Array(pcmFloat.length);
      for (let i = 0; i < pcmFloat.length; i++) {
        const s = Math.max(-1, Math.min(1, pcmFloat[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const wav = encodeWAV(pcm16, SAMPLE_RATE);
      this.onAudioFrame?.(wav);
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  mute() { this._isMuted = true; }
  unmute() { this._isMuted = false; }
  get isMuted() { return this._isMuted; }

  stop() {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.processor = null;
    this.source = null;

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    this.onAudioFrame = null;
    this.onSpeechDetected = null;
    this.speechFrameCount = 0;
  }
}

/**
 * 分句 TTS 音频排队播放器
 *
 * 服务端按句推送 WAV 音频帧，本类按序解码并播放。
 * 支持 flush() 清空队列（用于打断）。
 */
export class TtsAudioQueue {
  private audioContext: AudioContext;
  private queue: ArrayBuffer[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private _isPlaying = false;

  onPlayStateChange: ((playing: boolean) => void) | null = null;

  constructor() {
    this.audioContext = new AudioContext();
  }

  get isPlaying() { return this._isPlaying; }

  enqueue(wavBuffer: ArrayBuffer) {
    this.queue.push(wavBuffer);
    if (!this._isPlaying) {
      this.playNext();
    }
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.setPlaying(false);
      return;
    }

    this.setPlaying(true);
    const buf = this.queue.shift()!;

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      const decoded = await this.audioContext.decodeAudioData(buf.slice(0));
      const source = this.audioContext.createBufferSource();
      source.buffer = decoded;
      source.connect(this.audioContext.destination);
      this.currentSource = source;
      source.onended = () => {
        this.currentSource = null;
        this.playNext();
      };
      source.start();
    } catch {
      this.currentSource = null;
      this.playNext();
    }
  }

  flush() {
    this.queue.length = 0;
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
    this.setPlaying(false);
  }

  private setPlaying(v: boolean) {
    if (this._isPlaying !== v) {
      this._isPlaying = v;
      this.onPlayStateChange?.(v);
    }
  }

  destroy() {
    this.flush();
    this.audioContext.close().catch(() => {});
    this.onPlayStateChange = null;
  }
}
