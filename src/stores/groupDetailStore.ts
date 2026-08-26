/**
 * 群详情弹窗查看状态 (Zustand)
 *
 * @location src/stores/groupDetailStore.ts
 *
 * 跨组件共享"当前正在查看哪个群的详情弹窗"。任意群名/群头像点击处可调用 open(groupId, source)
 * 打开，由顶层挂载的 GroupDetailView 订阅渲染（桌面右侧抽屉 / 移动整页）。
 * 用独立小 store 而非塞进核心 chatStore，避免污染核心状态、降低改动面。
 *
 * ## 为什么 store 里要存 `source`
 *
 * 后端 migration 045 起 `POST /api/groups/{id}/apply` 的 `source` **必填**，取值就是
 * 「这个群是怎么被我看到的」（扫码 / 搜索群 ID / 好友推荐），服务端据此挑对应的
 * `allow_join_via_*` 开关判定。而**只有打开这个面板的那个入口知道答案** ——
 * 面板自己看不出来是从搜索结果点进来的还是从群名片点进来的。所以 source 必须随 open 一起进来。
 */

import { create } from 'zustand';
import type { GroupJoinSource } from '../api/groups';

interface GroupDetailState {
  /** 当前查看的群 id（null = 关闭） */
  groupId: string | null;
  /**
   * 本次是从哪条加群路径打开的 —— 面板发起 apply 时原样带给服务端。
   *
   * `null` = **不是从任何一条加群路径来的**（群聊顶栏点进详情那种成员入口）。
   * 它不是"没填"，是一个有含义的显式取值：这种入口下服务端要的 `source` 不存在，
   * 面板因此不提供加群按钮（成员本来也走「进入群聊」那一支）。
   */
  source: GroupJoinSource | null;
  /**
   * 打开某群的详情弹窗。
   *
   * 🔴 **`source` 必填、且没有默认值** —— 与服务端同一条理由：三个开关的全部意义就是按来源分流，
   * 给任何默认值等于给了一条绕过开关的路。成员入口显式传 `null`，
   * 而不是"省略参数让它落进某一档"。
   *
   * 机器守门：`tests/api/applyJoinSource.test.ts` 递归走 `src/`，
   * 任何 `openGroupDetail(` 调用点漏传第二个实参即 FAIL（枚举源是走出来的，不是手写清单）。
   */
  open: (groupId: string, source: GroupJoinSource | null) => void;
  /** 关闭详情弹窗 */
  close: () => void;
}

export const useGroupDetailStore = create<GroupDetailState>((set) => ({
  groupId: null,
  source: null,
  open: (groupId, source) => set({ groupId, source }),
  close: () => set({ groupId: null }),
}));
