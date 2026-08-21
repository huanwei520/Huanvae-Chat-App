/**
 * 媒体预览 handoff：令牌不许留在 localStorage 里
 *
 * 背景（真实缺陷）：`openMediaWindow` 把 `{ serverUrl, accessToken, sequence, ... }`
 * 整个 JSON.stringify 进 localStorage 的 `huanvae_media_data` 键，交给独立预览窗读。
 * 预览窗读完**不清**，而 `clearMediaData` 虽然写了、导出了、注释了「窗口关闭时调用」，
 * 全仓却没有一个业务调用点 —— 于是每点开一张图/一段视频，
 * 完整的 accessToken 就在磁盘上多留一份，直到下次被覆盖或用户卸载。
 * 且 localStorage 按 origin 共享：同 origin 的其它 webview 一行 `getItem` 就能读走。
 *
 * 修法是把「读」改成「取走」（read + remove 同一个动作），让"忘记清理"结构上不可能发生。
 * 本文件钉的就是这条不变量。
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  takeMediaData,
  clearMediaData,
  type MediaStorageData,
} from '../../src/media/api';

/**
 * tests/setup.ts 把 `window.localStorage` 换成了一组 `vi.fn()` —— **不真存东西**
 *（`getItem` 恒返回 undefined）。用它测「读完有没有真的删掉」等于什么都没测：
 * 无论被测代码删不删，读回来都是 undefined。
 *
 * 所以这里装一份**真会存**的内存实现，本文件用完在 afterAll 里还原，
 * 不影响同一 worker 里跑的其它测试文件。
 */
const realStoreDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

function installMemoryLocalStorage(): void {
  const map = new Map<string, string>();
  const impl: Storage = {
    get length() { return map.size; },
    clear: () => { map.clear(); },
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  };
  Object.defineProperty(window, 'localStorage', { value: impl, configurable: true });
}

/** 与 src/media/api.ts 的 STORAGE_KEY 逐字一致（那是私有常量，这里显式重述以钉死契约） */
const STORAGE_KEY = 'huanvae_media_data';

const SAMPLE: MediaStorageData = {
  sequence: [
    {
      type: 'image',
      fileUuid: 'file-uuid-1',
      filename: 'a.jpg',
      urlType: 'friend',
    },
  ],
  index: 0,
  serverUrl: 'https://example.invalid',
  accessToken: 'eyJ-super-secret-token',
  groupId: null,
};

describe('takeMediaData：读完必须把 localStorage 里那份删掉', () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  afterAll(() => {
    if (realStoreDescriptor) {
      Object.defineProperty(window, 'localStorage', realStoreDescriptor);
    }
  });

  it('判据自证：这份内存实现真的会存、也真的会删（否则下面所有 null 都是假的）', () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    localStorage.setItem(STORAGE_KEY, 'sentinel');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('sentinel');
    localStorage.removeItem(STORAGE_KEY);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('读得出完整 handoff，且读完键就没了', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE));
    // 判据自证：写进去之后确实读得到（否则下面那个 null 是假的）
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    const got = takeMediaData();
    expect(got?.accessToken).toBe('eyJ-super-secret-token');
    expect(got?.sequence).toHaveLength(1);

    // 🔴 核心：令牌不许还在盘上
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('第二次取只能拿到 null —— 令牌是一次性的，不会被别的 webview 捡到', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE));
    takeMediaData();
    expect(takeMediaData()).toBeNull();
  });

  it('JSON 坏掉时同样要删（坏掉的那份一样可能带着令牌）', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json');
    expect(takeMediaData()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('本来就没有时不炸、也不留下任何键', () => {
    expect(takeMediaData()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clearMediaData 仍可单独调用（openMediaWindow 的 tauri://error 兜底路径）', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE));
    clearMediaData();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
