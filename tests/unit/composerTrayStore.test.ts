/**
 * 待发区 store：加入 / 逐个删除 / 继续追加 / 超限当场挡下（spec §三 + §四）
 *
 * 「被挡下的必须回报」是这里的重点 —— 静默截断会让用户以为发了 12 个、实际只发 10 个。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useComposerTrayStore,
  selectTrayItems,
  TRAY_MAX_ITEMS,
  TRAY_MAX_FILE_BYTES,
  type TrayItemInput,
} from '../../src/stores/composerTrayStore';

const KEY = 'friend:u1';
const OTHER = 'group:g1';

function input(name: string, size = 10, kind: TrayItemInput['kind'] = 'image'): TrayItemInput {
  const file = new File(['x'], name, { type: kind === 'image' ? 'image/png' : 'application/pdf' });
  // jsdom 的 File.size 只读，用 defineProperty 造出想要的体积（不真的分配那么多字节）
  Object.defineProperty(file, 'size', { value: size });
  return { file, localPath: `/tmp/${name}`, kind };
}

function items(key = KEY) {
  return selectTrayItems(key)(useComposerTrayStore.getState());
}

beforeEach(() => {
  useComposerTrayStore.setState({ itemsByConversation: {} });
});

describe('加入 / 追加 / 删除', () => {
  it('加入后可读到，且按会话分桶（别的会话看不到）', () => {
    useComposerTrayStore.getState().add(KEY, [input('a.png'), input('b.png')]);
    expect(items().map((i) => i.file.name)).toEqual(['a.png', 'b.png']);
    expect(items(OTHER)).toEqual([]);
  });

  it('继续追加是拼在后面，不是覆盖', () => {
    const st = useComposerTrayStore.getState();
    st.add(KEY, [input('a.png')]);
    st.add(KEY, [input('b.png')]);
    expect(items().map((i) => i.file.name)).toEqual(['a.png', 'b.png']);
  });

  it('逐个删除只摘掉那一个', () => {
    const st = useComposerTrayStore.getState();
    st.add(KEY, [input('a.png'), input('b.png'), input('c.png')]);
    st.remove(KEY, items()[1].id);
    expect(items().map((i) => i.file.name)).toEqual(['a.png', 'c.png']);
  });

  it('clear 清空该会话，其它会话不受影响', () => {
    const st = useComposerTrayStore.getState();
    st.add(KEY, [input('a.png')]);
    st.add(OTHER, [input('z.png')]);
    st.clear(KEY);
    expect(items()).toEqual([]);
    expect(items(OTHER)).toHaveLength(1);
  });

  it('空待发区返回**同一个**空数组引用（引用抖动会让下游 effect 空转）', () => {
    expect(items()).toBe(items());
  });
});

describe('超限：当场挡下并如实回报（不静默截断）', () => {
  it('单个超体积 ⇒ 不进待发区，文件名出现在 rejectedOversize', () => {
    const big = input('huge.mp4', TRAY_MAX_FILE_BYTES + 1, 'video');
    const ok = input('small.png', 10);
    const result = useComposerTrayStore.getState().add(KEY, [big, ok]);
    expect(result.accepted).toBe(1);
    expect(result.rejectedOversize).toEqual(['huge.mp4']);
    expect(items().map((i) => i.file.name)).toEqual(['small.png']);
  });

  it('恰好等于上限 ⇒ 放行（边界是"超过"才挡）', () => {
    const result = useComposerTrayStore.getState().add(KEY, [input('edge.png', TRAY_MAX_FILE_BYTES)]);
    expect(result.rejectedOversize).toEqual([]);
    expect(result.accepted).toBe(1);
  });

  it('超数量 ⇒ 多出来的进 rejectedOverflow，已有的不受影响', () => {
    const st = useComposerTrayStore.getState();
    const first = Array.from({ length: TRAY_MAX_ITEMS }, (_, i) => input(`f${i}.png`));
    st.add(KEY, first);
    const result = st.add(KEY, [input('x.png'), input('y.png')]);
    expect(result.accepted).toBe(0);
    expect(result.rejectedOverflow).toEqual(['x.png', 'y.png']);
    expect(items()).toHaveLength(TRAY_MAX_ITEMS);
  });

  it('体积挡在数量之前：超大文件不该先占掉名额', () => {
    const st = useComposerTrayStore.getState();
    st.add(KEY, Array.from({ length: TRAY_MAX_ITEMS - 1 }, (_, i) => input(`f${i}.png`)));
    // 一个超大 + 一个正常：超大被体积挡掉，正常的应当能占到最后一个名额
    const result = st.add(KEY, [input('huge.mp4', TRAY_MAX_FILE_BYTES + 1, 'video'), input('ok.png')]);
    expect(result.rejectedOversize).toEqual(['huge.mp4']);
    expect(result.rejectedOverflow).toEqual([]);
    expect(result.accepted).toBe(1);
    expect(items().map((i) => i.file.name)).toContain('ok.png');
  });
});

describe('缩略图 URL', () => {
  it('文件类型不生成 previewUrl（只有图片/视频才有缩略图）', () => {
    useComposerTrayStore.getState().add(KEY, [input('doc.pdf', 10, 'file')]);
    expect(items()[0].previewUrl).toBeNull();
  });
});
