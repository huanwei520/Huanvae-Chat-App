/**
 * 入群与可见性设置（群设置面板的 `join-policy` 视图，**仅群主**）
 *
 * @location src/chat/shared/menu/JoinPolicyForm.tsx
 *
 * 契约真值源：`backend-docs/groups/群聊管理.md`「7.1 修改入群策略」
 * （`PUT /api/groups/{group_id}/join-policy`，权限**仅群主** —— 管理员也会被后端 403）
 * 与 `GroupInfo` 字段表（`GET /api/groups/{group_id}`，权限=本群活跃成员）。
 *
 * ## 五个字段，两种语义方向
 *
 * | 字段 | 管什么 | 动作方 |
 * |------|--------|--------|
 * | `join_approval_required` | 要不要审核（apply 链**与 invite 链**） | 想进群的人 |
 * | `admin_can_approve` | 谁能按同意 | 群主 / 管理员 |
 * | `card_share_scope` | 谁能把群作为名片分享出去 | **本群成员** |
 * | `qr_show_scope` | 谁能展示群二维码 | **本群成员** |
 * | `search_scope` | 谁**搜得到**本群 | **群外的人** ⚠️ |
 *
 * ⚠️ 最后一行方向相反：`owner_only` 在前两个 scope 是「只有群主能分享 / 出码」，
 * 在 `search_scope` 是「只有群主搜得到本群」= **别人搜不到**。文案按这个方向写，别写反。
 *
 * ## 三条设计约束
 *
 * 1. **只发被改的那一个键**：契约是「只更新请求体里真正出现的那些」，过滤在
 *    [`updateJoinPolicy`](../../../api/groups.ts) 里做，本视图一次只交一个键。
 * 2. **不做乐观更新**：请求未回来之前 UI 一律不动（受控 `checked` / `aria-pressed`
 *    始终读 state），成功后用响应的**完整五值整体回填**。先切后失败＝用户以为设置成了。
 * 3. **错误按状态码分三档 + 网络失败单列**：合成一句「操作失败」等于让用户对着
 *    「你不是群主」这种改不了的事一直重试。见 [`describeJoinPolicyUpdateError`]。
 *
 * 样式全部复用既有 class（`menu-form` / `menu-hint` / `menu-checkbox` / `mute-options` /
 * `mute-option` / `menu-loading` / `menu-message`），**零新增 CSS** ⇒ 不触发动画门禁
 * （本文件也无 `motion.*`）。
 */

import { useCallback, useEffect, useState } from 'react';
import { MenuHeader } from './MenuHeader';
import { useApi } from '../../../contexts/SessionContext';
import { apiErrorStatus } from '../../../api/client';
import {
  getGroupDetail,
  updateJoinPolicy,
  JOIN_POLICY_DEFAULTS,
  type GroupScope,
  type SearchScope,
  type JoinPolicy,
  type JoinPolicyPatch,
} from '../../../api/groups';

/** `card_share_scope` / `qr_show_scope` 的三档呈现顺序（宽 → 窄） */
const MEMBER_SCOPE_ORDER: ReadonlyArray<GroupScope> = ['all_members', 'admins', 'owner_only'];

/**
 * `search_scope` 的三档呈现顺序（宽 → 窄）。**最松档是 `everyone`，不是 `all_members`** ——
 * 与上面那组**刻意不共用**，理由见 [`SearchScope`]（同名反义）。
 */
const SEARCH_SCOPE_ORDER: ReadonlyArray<SearchScope> = ['everyone', 'admins', 'owner_only'];

/** `card_share_scope` / `qr_show_scope`：动作方是本群成员 */
const MEMBER_SCOPE_LABELS: Readonly<Record<GroupScope, string>> = {
  all_members: '全体成员',
  admins: '群主和管理员',
  owner_only: '仅群主',
};

/**
 * `search_scope`：动作方是**群外的人** ⇒ 档位要按"谁看得到"讲，不能照抄成员版文案。
 * 最松档 `everyone` 是「任何登录用户」，**不是**「本群全体成员」——
 * 正因为这两件事会被同一个 `all_members` 读混，取值才单独改名（见 [`SearchScope`]）。
 */
const SEARCH_SCOPE_LABELS: Readonly<Record<SearchScope, string>> = {
  everyone: '任何人',
  admins: '仅群主和管理员',
  owner_only: '仅群主（别人搜不到）',
};

/**
 * 把 `GroupInfo` 里可能缺的五个字段补成完整五值 —— **本视图唯一一处应用回落的地方**。
 *
 * 值一律取自 [`JOIN_POLICY_DEFAULTS`]，这里不写任何字面量默认值（回落值只许有一个落点）。
 * 之所以需要它：那五个字段在 `GroupInfo` 里全是 `?:`，因为后端源码有该端点但**是否已上线
 * 到当前生产未经验证**，读到 `undefined` 时要能照契约默认值把面板显示出来。
 */
export function applyJoinPolicyDefaults(source: JoinPolicyPatch): JoinPolicy {
  return {
    join_approval_required:
      source.join_approval_required ?? JOIN_POLICY_DEFAULTS.join_approval_required,
    admin_can_approve: source.admin_can_approve ?? JOIN_POLICY_DEFAULTS.admin_can_approve,
    card_share_scope: source.card_share_scope ?? JOIN_POLICY_DEFAULTS.card_share_scope,
    qr_show_scope: source.qr_show_scope ?? JOIN_POLICY_DEFAULTS.qr_show_scope,
    search_scope: source.search_scope ?? JOIN_POLICY_DEFAULTS.search_scope,
  };
}

/**
 * `PUT /join-policy` 的三档错误 → 用户能据以行动的一句话。
 *
 * 契约「错误响应」：`400` 三档取值不在白名单内（客户端构造问题，用户改不了）·
 * `403` 群存在但你不是群主（管理员也会吃这个）· `404` 群不存在（多半刚被解散）。
 * `status` 为 null（网络层失败，拿不到状态码）时**回落到原始异常文案，不猜成三档里的任何一档**。
 */
export function describeJoinPolicyUpdateError(status: number | null, fallback: string): string {
  switch (status) {
    case 400:
      return '设置值不被服务器接受（客户端版本可能过旧）';
    case 403:
      return '只有群主可以修改这些设置';
    case 404:
      return '该群聊不存在或已解散';
    default:
      return fallback;
  }
}

/**
 * `GET /api/groups/{id}` 的错误 → 一句话。与上面那条**不共用**：同一个状态码在这两个端点上
 * 是两件不同的事（这里 403 = 你不是本群活跃成员，那里 403 = 你不是群主）。
 */
export function describeGroupDetailError(status: number | null, fallback: string): string {
  switch (status) {
    case 403:
      return '你已不是本群成员，无法查看群设置';
    case 404:
      return '该群聊不存在或已解散';
    default:
      return fallback;
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface JoinPolicyFormProps {
  groupId: string;
  onBack: () => void;
}

export function JoinPolicyForm({ groupId, onBack }: JoinPolicyFormProps) {
  const api = useApi();
  const [policy, setPolicy] = useState<JoinPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  /** 有请求在途 ⇒ 全部控件禁用，避免并发写把两次修改互相盖掉（响应是全量回填的） */
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGroupDetail(api, groupId)
      .then((info) => {
        if (cancelled) {
          return;
        }
        setPolicy(applyJoinPolicyDefaults(info));
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(describeGroupDetailError(apiErrorStatus(err), errorText(err, '加载群设置失败')));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, groupId]);

  /**
   * 提交一次修改。**先发请求、成功才动 UI**（不乐观更新），成功后用响应的完整五值整体回填 ——
   * 契约承诺 `data` 是更新之后的五值，所以这里不做本地合并，服务端说什么就是什么。
   *
   * 收 `JoinPolicyPatch` 而不是 `(key, value)` 两参：调用点写成 `{ card_share_scope: s }`
   * 时键与值的类型由 TS 逐键校验；两参写法要靠计算键 + `as` 断言才编得过，而那个断言
   * 恰好会把「键名写错 / 值给错档」这类错误一并放过去。
   */
  const save = useCallback(
    async (patch: JoinPolicyPatch) => {
      setError(null);
      setSaving(true);
      try {
        const next = await updateJoinPolicy(api, groupId, patch);
        setPolicy(next);
      } catch (err: unknown) {
        setError(
          describeJoinPolicyUpdateError(apiErrorStatus(err), errorText(err, '保存失败')),
        );
      } finally {
        setSaving(false);
      }
    },
    [api, groupId],
  );

  /**
   * 三档选择器：一组按钮，选中项 aria-pressed=true（不只靠 class 表达选中态）。
   *
   * 对档位类型 `S` 泛型化，因为 `search_scope` 的取值集合与另两列**不同**
   * （最松档 `everyone` vs `all_members`）；写死一个联合类型会让两组互相串档。
   *
   * ⚠️ 写成 `function` 声明而不是泛型箭头函数：`.tsx` 里 `const f = <S extends string>(…) => …`
   * 的开头会被 ESLint 的 `indent` 规则当成 JSX 标签解析，整段 JSX 缩进期望值全错（tsc 正常，
   * 只有 lint 红）。函数声明形式没有这个歧义。
   */
  function renderScope<S extends string>(
    groupLabel: string,
    order: ReadonlyArray<S>,
    labels: Readonly<Record<S, string>>,
    current: S,
    onPick: (scope: S) => void,
  ) {
    return (
      <div className="mute-options" role="group" aria-label={groupLabel}>
        {order.map((scope) => (
          <button
            key={scope}
            type="button"
            className={`mute-option ${current === scope ? 'active' : ''}`}
            aria-pressed={current === scope}
            disabled={saving}
            onClick={() => onPick(scope)}
          >
            {labels[scope]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <MenuHeader title="入群与可见性" onBack={onBack} />
      <div className="menu-form">
        {loading && <div className="menu-loading">加载中...</div>}

        {error && (
          <div className="menu-message error" role="status" aria-live="polite">
            {error}
          </div>
        )}

        {saving && <p className="menu-hint">保存中...</p>}

        {policy && (
          <>
            <label className="menu-checkbox">
              <input
                type="checkbox"
                checked={policy.join_approval_required}
                disabled={saving}
                onChange={(e) => save({ join_approval_required: e.target.checked })}
              />
              <span>需要入群审核</span>
            </label>
            <p className="menu-hint">
              开启后，无论是搜索申请还是被人邀请，都要等审批同意才能进群；关闭则直接进群。
            </p>

            <label className="menu-checkbox">
              <input
                type="checkbox"
                checked={policy.admin_can_approve}
                disabled={saving}
                onChange={(e) => save({ admin_can_approve: e.target.checked })}
              />
              <span>允许管理员参与审核</span>
            </label>
            <p className="menu-hint">关闭后，只有群主能同意或拒绝入群申请。</p>

            <p className="menu-hint">谁能分享群名片</p>
            {renderScope(
              '谁能分享群名片',
              MEMBER_SCOPE_ORDER,
              MEMBER_SCOPE_LABELS,
              policy.card_share_scope,
              (scope) => save({ card_share_scope: scope }),
            )}

            <p className="menu-hint">谁能展示群二维码</p>
            {renderScope(
              '谁能展示群二维码',
              MEMBER_SCOPE_ORDER,
              MEMBER_SCOPE_LABELS,
              policy.qr_show_scope,
              (scope) => save({ qr_show_scope: scope }),
            )}

            <p className="menu-hint">谁搜得到这个群</p>
            {renderScope(
              '谁搜得到这个群',
              SEARCH_SCOPE_ORDER,
              SEARCH_SCOPE_LABELS,
              policy.search_scope,
              (scope) => save({ search_scope: scope }),
            )}
            {/* 中文长句必须写成 {'…'} 表达式再折行：JSX 会把「两行纯文本」用一个空格拼起来，
                直接折行会在句子中间留出一个可见的空格（真机上肉眼可见）。 */}
            <p className="menu-hint">
              这一项管的是<strong>别人</strong>
              {'能不能在「发现搜索」里搜到本群；它不影响已经知道群号的人扫码或点群名片进来'}
              {'（要拦「进不进得来」请用上面的入群审核）。'}
            </p>
          </>
        )}
      </div>
    </>
  );
}
