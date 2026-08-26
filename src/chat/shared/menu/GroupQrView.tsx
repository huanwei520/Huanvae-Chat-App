/**
 * 群二维码（群设置面板的 `group-qr` 视图）
 *
 * @location src/chat/shared/menu/GroupQrView.tsx
 *
 * 契约真值源：`backend-docs/groups/群聊管理.md`「获取群二维码」
 * （`GET /api/groups/{group_id}/qr`，权限=本群活跃成员 **且** 角色满足该群 `qr_show_scope`）。
 *
 * ## 三条设计约束
 *
 * 1. 🔴 **payload 只能来自服务端，绝不本地拼串。**
 *    二维码内容本质就是 group_id，客户端确实能本地拼出 `huanvae://group/join?id=…` ——
 *    但「谁能展示群二维码」这个开关**只有做成服务端端点才拦得住**（契约原话）。
 *    本地拼串 = 把 `qr_show_scope` 整道门绕过去，改前端即可越权出码。
 * 2. 🔴 **不按 `qr_show_scope` 在客户端预判**。档位是服务端强制的策略，客户端复刻一份只会漂移；
 *    档位不够时由服务端返 403，本视图把它翻译成一句用户能据以行动的话。
 *    （与 `GroupDetailPanel` 对「分享该群」的处置同一条口径。）
 * 3. **只渲染，不缓存**：一个会话内进来几次就拉几次。payload 里没有签名也没有时效
 *    （群 ID 本来就不是秘密），但群可能在两次之间被解散 —— 缓存会把「群没了」显示成一张还能扫的码。
 *
 * 二维码由 `qrcode` 在本地画进 `<canvas>`（服务端有意不返回 PNG/Base64，理由见契约）。
 * 样式全部复用既有 class（`menu-form` / `menu-hint` / `menu-loading` / `menu-message`），
 * 仅新增两条布局用 class 在 `group-qr.css` 里 —— 无 `motion.*`、无 `transition`，不触发动画门禁。
 */

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { MenuHeader } from './MenuHeader';
import { useApi } from '../../../contexts/SessionContext';
import { apiErrorStatus } from '../../../api/client';
import { getGroupQr, type GroupQrResponse } from '../../../api/groups';
import './group-qr.css';

/**
 * `GET /{id}/qr` 的错误 → 一句话。
 *
 * 🔴 403 与 404 必须分档：前者是「群主把出码权限收窄了，你的角色不够」（你能做的是找群主），
 * 后者是「群没了」（你什么都做不了）。合成一句「获取失败」等于让用户对着两件事做同一种猜测。
 * `status` 为 null（网络层失败，拿不到状态码）时**回落到原始异常文案，不猜成两档里的任何一档**。
 */
export function describeGroupQrError(status: number | null, fallback: string): string {
  switch (status) {
    case 403:
      return '群主设置了只有特定成员才能展示群二维码，你的角色不够';
    case 404:
      return '该群聊不存在或已解散';
    default:
      return fallback;
  }
}

interface GroupQrViewProps {
  groupId: string;
  onBack: () => void;
}

export function GroupQrView({ groupId, onBack }: GroupQrViewProps) {
  const api = useApi();
  const [qr, setQr] = useState<GroupQrResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQr(null);
    getGroupQr(api, groupId)
      .then((res) => {
        if (!cancelled) { setQr(res); }
      })
      .catch((err: unknown) => {
        if (cancelled) { return; }
        setError(
          describeGroupQrError(
            apiErrorStatus(err),
            err instanceof Error && err.message ? err.message : '获取群二维码失败',
          ),
        );
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [api, groupId]);

  // 画码：payload 到位之后才画（canvas 也要先挂上）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!qr || !canvas) { return; }
    QRCode.toCanvas(canvas, qr.payload, { width: 200, margin: 1 }).catch(() => {
      setError('二维码绘制失败');
    });
  }, [qr]);

  const handleCopy = () => {
    if (!qr) { return; }
    navigator.clipboard
      ?.writeText(qr.payload)
      .then(() => { setCopied(true); })
      .catch(() => { /* 复制失败忽略：码本身已经画出来了，复制只是便利路径 */ });
  };

  return (
    <>
      <MenuHeader title="群二维码" onBack={onBack} />
      <div className="menu-form">
        {loading && <div className="menu-loading">加载中...</div>}

        {error && (
          <div className="menu-message error" role="status" aria-live="polite">
            {error}
          </div>
        )}

        {qr && (
          <div className="group-qr-body">
            {/* canvas 由 qrcode 在本地绘制；服务端有意不返回图片 */}
            <canvas ref={canvasRef} className="group-qr-canvas" aria-label="群二维码" />
            <p className="menu-hint">{`${qr.group_name} · ${qr.member_count} 位成员`}</p>
            <p className="menu-hint">
              {'扫这张码的人会落到本群的详情页，能不能进由「允许扫码加群」那个开关决定；'}
              {'要不要审核由「需要入群审核」决定。'}
            </p>
            <button type="button" className="subtle-btn" onClick={handleCopy}>
              {copied ? '已复制链接' : '复制群链接'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
