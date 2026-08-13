/**
 * 预发送待发区 Store（Zustand）
 *
 * @location src/stores/composerTrayStore.ts
 *
 * 「粘贴 / 选文件 / 拖入 ⇒ 先进输入框上方的待发区，回车才发」这套 Telegram 式流程的状态层。
 * 按会话分桶（key = {@link import('../chat/shared/conversationKey').draftKeyOf} 的产物），
 * 切会话不串、切回来还在。
 *
 * ## 为什么是 store 而不是 ChatInputArea 的局部 state
 * 待发区要跨「输入区」与「消息列表」两棵子树被读到（发送态覆盖层要知道这一批的形态），
 * 且桌面 ChatPanel 与移动 MobileChatView 各自挂一份 ChatInputArea —— 放局部 state 会随
 * 容器卸载而丢。放 store 后两端天然一致，且 ChatInputArea **不需要新增任何 props**，
 * 也就不必改它的两个父容器（其中 ChatPanel 本轮不归本单所有）。
 *
 * ## 缩略图 object URL 的归属
 * `previewUrl` 由本 store 在 `add` 时创建、在 `remove` / `clear` 时 revoke。
 * 由创建方负责释放是唯一不会漏的口径 —— 交给组件 unmount 释放的话，
 * 「待发区还在、组件因切会话卸载了」这条路径会把还要用的 URL 提前吊销。
 */

import { create } from 'zustand';
import { ALBUM_MAX_ITEMS, splitByCapacity, type TrayItemKind } from '../chat/shared/composerTrayPlan';

/**
 * 待发区一次最多放几个。
 *
 * 取值 = {@link ALBUM_MAX_ITEMS}（后端组上限 10），**两者是绑死的**：
 * composerTrayPlan.splitIntoShapes 不做分块，正是靠"总量 <= 组上限"保证任何一段都不超组上限。
 * 要放宽这里，必须同时给 splitIntoShapes 补分块。
 */
export const TRAY_MAX_ITEMS = ALBUM_MAX_ITEMS;

/**
 * 单个文件的体积上限（客户端粗筛）。
 *
 * 🔴 真值在服务端：`POST /api/storage/upload/request` 的响应里有 `max_file_size`
 * （backend-docs/storage/文件存储管理.md 示例值 107374182400 = 100 GiB），但那要等一次网络往返，
 * 而 spec §四 要求「超出大小上限**当场**提示，不进待发区」⇒ 客户端只能做粗筛。
 * 这里取 15 GiB —— 文件存储管理.md:879-882 的能力表把 15 GB 定为「可在线预览」的分界，
 * 超过它的东西传上去在聊天里也只能下载、不适合走消息通道。
 * ⚠️ 这个数字是本端选的，不是契约里的硬上限；要改由 huanwei 拍板。
 */
export const TRAY_MAX_FILE_BYTES = 15 * 1024 * 1024 * 1024;

/** 待发区里的一项 */
export interface TrayItem {
  /** 本地唯一 id（React key + 删除定位） */
  id: string;
  file: File;
  /**
   * 本地绝对路径；**粘贴进来的可能没有**（webview 的 clipboardData 只给 File 内容，不给路径），
   * 此时为空串。空串意味着这一份不进本地文件缓存映射，只是正常上传。
   */
  localPath: string;
  kind: TrayItemKind;
  /** 图片/视频的缩略图 object URL；文件为 null */
  previewUrl: string | null;
}

/** 加入待发区时的原始输入（id / previewUrl 由 store 生成） */
export interface TrayItemInput {
  file: File;
  localPath: string;
  kind: TrayItemKind;
}

/** 一次 add 的结果 —— 被挡下的必须回报给 UI，不许静默截断 */
export interface TrayAddResult {
  accepted: number;
  /** 超过 {@link TRAY_MAX_FILE_BYTES} 被挡下的文件名 */
  rejectedOversize: string[];
  /** 超过 {@link TRAY_MAX_ITEMS} 被挡下的文件名 */
  rejectedOverflow: string[];
}

interface ComposerTrayState {
  /** key = 会话 key（draftKeyOf 的产物） */
  itemsByConversation: Record<string, TrayItem[]>;
}

interface ComposerTrayActions {
  add: (conversationKey: string, inputs: readonly TrayItemInput[]) => TrayAddResult;
  remove: (conversationKey: string, itemId: string) => void;
  clear: (conversationKey: string) => void;
}

export type ComposerTrayStore = ComposerTrayState & ComposerTrayActions;

/** 稳定空数组：选择器返回新 `[]` 会让每次 render 引用抖动，触发下游 effect 空转 */
const EMPTY_ITEMS: TrayItem[] = [];

/**
 * object URL 的创建口。
 *
 * 抽成函数是为了 jsdom 下可被测试替换 —— jsdom 没有 `URL.createObjectURL`，
 * 直接调用会抛 `TypeError: URL.createObjectURL is not a function`，
 * 而那会让"加入待发区"这条主路径在单测里根本跑不起来。
 */
function makePreviewUrl(kind: TrayItemKind, file: File): string | null {
  if (kind === 'file') { return null; }
  if (typeof URL.createObjectURL !== 'function') { return null; }
  return URL.createObjectURL(file);
}

function revokePreviewUrl(url: string | null): void {
  if (url && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

let idSeq = 0;
/** 本地 id：不用 crypto.randomUUID —— 它在部分 webview 的非安全上下文里不存在 */
function nextItemId(): string {
  idSeq += 1;
  return `tray_${idSeq}`;
}

export const useComposerTrayStore = create<ComposerTrayStore>((set, get) => ({
  itemsByConversation: {},

  add: (conversationKey, inputs) => {
    const existing = get().itemsByConversation[conversationKey] ?? EMPTY_ITEMS;

    // 先按体积挡（当场提示，不进待发区），再按数量挡 —— 顺序要紧：
    // 反过来的话，一个超大文件会先占掉名额、再被踢掉，用户看到的"还能放几个"是错的。
    const sized = inputs.filter((i) => i.file.size <= TRAY_MAX_FILE_BYTES);
    const rejectedOversize = inputs
      .filter((i) => i.file.size > TRAY_MAX_FILE_BYTES)
      .map((i) => i.file.name);

    const { accepted, overflow } = splitByCapacity(existing.length, sized, TRAY_MAX_ITEMS);

    if (accepted.length > 0) {
      const newItems: TrayItem[] = accepted.map((i) => ({
        id: nextItemId(),
        file: i.file,
        localPath: i.localPath,
        kind: i.kind,
        previewUrl: makePreviewUrl(i.kind, i.file),
      }));
      set((state) => ({
        itemsByConversation: {
          ...state.itemsByConversation,
          [conversationKey]: [...(state.itemsByConversation[conversationKey] ?? []), ...newItems],
        },
      }));
    }

    return {
      accepted: accepted.length,
      rejectedOversize,
      rejectedOverflow: overflow.map((i) => i.file.name),
    };
  },

  remove: (conversationKey, itemId) => {
    const list = get().itemsByConversation[conversationKey];
    if (!list) { return; }
    const target = list.find((i) => i.id === itemId);
    if (!target) { return; }
    revokePreviewUrl(target.previewUrl);
    set((state) => ({
      itemsByConversation: {
        ...state.itemsByConversation,
        [conversationKey]: (state.itemsByConversation[conversationKey] ?? []).filter((i) => i.id !== itemId),
      },
    }));
  },

  clear: (conversationKey) => {
    const list = get().itemsByConversation[conversationKey];
    if (!list || list.length === 0) { return; }
    list.forEach((i) => revokePreviewUrl(i.previewUrl));
    set((state) => {
      const next = { ...state.itemsByConversation };
      delete next[conversationKey];
      return { itemsByConversation: next };
    });
  },
}));

/** 取某会话的待发区内容（无内容时返回稳定空数组，不制造引用抖动） */
export function selectTrayItems(conversationKey: string | null) {
  return (state: ComposerTrayStore): TrayItem[] =>
    (conversationKey ? state.itemsByConversation[conversationKey] : undefined) ?? EMPTY_ITEMS;
}
