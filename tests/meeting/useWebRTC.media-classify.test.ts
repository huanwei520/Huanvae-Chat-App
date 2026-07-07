/**
 * 媒体轨道分类单元测试（src/meeting/webrtcCore.ts classifyMediaTracks）
 *
 * 回归重点（R1）：
 * - media_type 早到（track 未到）先入表：track=null 时分类不误判
 * - track 到达后按 mid→kind 正确分 camera/screen
 * - 同开两路（camera + screen）分类正确、互不混流
 * - 非 video 轨 / mid 未映射的轨不参与分类
 */

import { describe, it, expect } from 'vitest';
import { classifyMediaTracks, type TransceiverView } from '../../src/meeting/webrtcCore';
import type { MediaKind } from '../../src/meeting/api';

const map = (entries: Array<[string, MediaKind]>): Map<string, MediaKind> => new Map(entries);

describe('classifyMediaTracks', () => {
  it('media_type 早到、track 未到：不误判（两者皆 null）', () => {
    const transceivers: TransceiverView[] = [{ mid: '2', track: null }];
    const result = classifyMediaTracks(transceivers, map([['2', 'camera']]));
    expect(result).toEqual({ cameraTrackId: null, screenTrackId: null });
  });

  it('track 到达后按 mid→camera 正确归类', () => {
    const transceivers: TransceiverView[] = [
      { mid: '2', track: { id: 'cam1', kind: 'video' } },
    ];
    const result = classifyMediaTracks(transceivers, map([['2', 'camera']]));
    expect(result).toEqual({ cameraTrackId: 'cam1', screenTrackId: null });
  });

  it('同开两路：camera + screen 分类正确、互不混流', () => {
    const transceivers: TransceiverView[] = [
      { mid: '2', track: { id: 'cam1', kind: 'video' } },
      { mid: '3', track: { id: 'scr1', kind: 'video' } },
    ];
    const result = classifyMediaTracks(transceivers, map([['2', 'camera'], ['3', 'screen']]));
    expect(result).toEqual({ cameraTrackId: 'cam1', screenTrackId: 'scr1' });
  });

  it('音频轨（kind !== video）不参与分类', () => {
    const transceivers: TransceiverView[] = [
      { mid: '0', track: { id: 'aud1', kind: 'audio' } },
      { mid: '2', track: { id: 'cam1', kind: 'video' } },
    ];
    // 即便 mid '0' 被误映射为 camera，audio 轨也不应被归类
    const result = classifyMediaTracks(transceivers, map([['0', 'camera'], ['2', 'camera']]));
    expect(result.cameraTrackId).toBe('cam1');
    expect(result.screenTrackId).toBeNull();
  });

  it('mid 无映射的视频轨不参与分类', () => {
    const transceivers: TransceiverView[] = [
      { mid: '5', track: { id: 'vid5', kind: 'video' } },
    ];
    const result = classifyMediaTracks(transceivers, map([['2', 'camera']]));
    expect(result).toEqual({ cameraTrackId: null, screenTrackId: null });
  });

  it('mid 为 null（尚未 setLocalDescription）的轨不参与分类', () => {
    const transceivers: TransceiverView[] = [
      { mid: null, track: { id: 'vidx', kind: 'video' } },
    ];
    const result = classifyMediaTracks(transceivers, map([['2', 'camera']]));
    expect(result).toEqual({ cameraTrackId: null, screenTrackId: null });
  });
});
