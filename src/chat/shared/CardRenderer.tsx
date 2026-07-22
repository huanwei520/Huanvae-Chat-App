/**
 * 可交互卡片(S2)渲染器。
 *
 * 安全不变量(红线,勿破坏):
 * - **声明式白名单**:卡片内容是数据不是代码。渲染 = `switch(node.type)` over 18 类封闭白名单,
 *   未知 type → 惰性占位。绝不做运行时代码求值、动态函数构造、或 React 原始 HTML 注入。
 * - **Markdown raw-HTML 关闭**:markdown 节点复用 MarkdownRenderer(react-markdown 无 rehype-raw)。
 * - **action_id 不透明**:按钮携带的是不透明 action_id(中继给发卡 bot),**不是**可取回/执行的 URL;
 *   交互仅 POST /api/messages/interact,不 fetch 卡片自带的任何地址。
 * - **图片必经收口**:image.url 一律经 `resolveDisplayUrl`(webview 私有 CA 反代收口)。
 * - **className 只取白名单常量**:heading level / button style 先收窄到白名单再映射到常量类名,
 *   绝不把卡片字段插值进 className。
 * - **双受众**:product 受众不渲染任何交互/日志/沙箱节点(布局/内容/chart 照常)。
 * - **sandbox 阀默认关闭**:sandbox 节点在逃逸阀关闭时一律惰性占位,绝不渲染卡片自带 url。
 * - CSP 宽松**不是**防线——真正的防线是这个白名单渲染器本身。
 *
 * live 刷新:已发卡片可被 bot 后续 patch(WS message_updated → cardLiveStore,单调 rev),
 * 本组件订阅 store,rev 不低于本地基线时采用 live 内容重渲。
 *
 * 表单态:input / select 写入本组件持有的 formValues(键=action_id),button 交互时一并回传。
 * renderNode 是组件内闭包,天然对任意深度子树可见 formValues / handleInteract,无需额外 context。
 */

import { useMemo, useState, type ReactNode } from 'react';
import { MarkdownRenderer } from '../../components/common/MarkdownRenderer';
import { resolveDisplayUrl } from '../../services/secureProxy';
import { useApi } from '../../contexts/SessionContext';
import { interactWithCard } from '../../api/messages';
import { useCardLiveStore } from '../../stores/cardLiveStore';
import { ActionButton } from './ActionButton';
import { CardChart } from './CardChart';
import { SANDBOX_ESCAPE_ENABLED, openSandboxEscapeWindow } from './sandboxEscape';
import {
  CARD_MAX_DEPTH,
  isCardSchema,
  type CardSchema,
  type CardNode,
  type CardContainerNode,
  type CardRowNode,
  type CardColumnNode,
  type CardTextNode,
  type CardMarkdownNode,
  type CardHeadingNode,
  type CardImageNode,
  type CardProgressNode,
  type CardStatNode,
  type CardTableNode,
  type CardChartNode,
  type CardLogTailNode,
  type CardButtonNode,
  type CardActionButtonItem,
  type CardActionButtonsNode,
  type CardSelectNode,
  type CardInputNode,
  type CardSandboxNode,
} from '../../types/card';
import './CardRenderer.css';

interface CardRendererProps {
  /** 原始消息内容(卡片 schema JSON 串) */
  messageContent: string;
  /** 消息 UUID(live 订阅键 + 交互回传目标) */
  messageUuid: string;
  /** 本地基线内容修订号(REST DTO 携带;非卡片/本地 DB-first 路径缺省=0) */
  messageRev?: number;
  /** 消息来源(好友/群) */
  sourceType: 'friend' | 'group';
  /** 受众:owner(默认,全量渲染) / product(产品演示视角,不渲染交互/日志/沙箱节点) */
  audience?: 'owner' | 'product';
}

/** heading level → 白名单类名(不插值卡片字段) */
const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'card-heading card-heading-1',
  2: 'card-heading card-heading-2',
  3: 'card-heading card-heading-3',
};

/** product 受众隐藏节点:一切交互 + 日志 + 沙箱(布局/内容/chart 照常渲染) */
const PRODUCT_HIDDEN_TYPES: ReadonlySet<string> = new Set([
  'button',
  'action-buttons',
  'select',
  'input',
  'log-tail',
  'sandbox',
]);

/** 日志尾屏组件侧最大行数(超出取末尾,并渲染截断提示行) */
export const CARD_LOG_TAIL_MAX_LINES = 200;

/** button style 收窄:非白名单值一律按 secondary */
function buttonStyleKey(style: unknown): 'primary' | 'secondary' | 'danger' {
  return style === 'primary' || style === 'danger' ? style : 'secondary';
}

/** 纯解析:JSON.parse + schema 守卫,失败/非 schema → null */
function tryParseSchema(content: string): CardSchema | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isCardSchema(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function CardRenderer({ messageContent, messageUuid, messageRev, sourceType, audience = 'owner' }: CardRendererProps) {
  const api = useApi();
  // live 覆盖:仅当 patch 的 rev 不低于本地基线才采用(单调 store 已拒绝更旧的 rev)
  const live = useCardLiveStore((s) => s.cards[messageUuid]);
  const effectiveContent = live && live.rev >= (messageRev ?? 0) ? live.content : messageContent;

  const parsed = useMemo<CardSchema | null>(() => {
    const primary = tryParseSchema(effectiveContent);
    if (primary) {
      return primary;
    }
    // live 覆盖解析失败 → 回退到原始 messageContent 的解析
    if (effectiveContent !== messageContent) {
      return tryParseSchema(messageContent);
    }
    return null;
  }, [effectiveContent, messageContent]);

  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // 失败时 rethrow:ActionButton 据 rejected promise 进入 failed 态;
  // 卡片底部错误条(actionError)行为保持不变
  const handleInteract = async (actionId: string, ownValue?: unknown): Promise<void> => {
    setActionError(null);
    try {
      const payload: Record<string, unknown> = {
        ...(ownValue !== undefined ? { value: ownValue } : {}),
        ...(Object.keys(formValues).length > 0 ? { form: formValues } : {}),
      };
      await interactWithCard(api, {
        message_uuid: messageUuid,
        action_id: actionId,
        // value 为空对象时发 undefined(不携带空壳)
        value: Object.keys(payload).length > 0 ? payload : undefined,
        nonce: crypto.randomUUID(),
      });
    } catch (e) {
      setActionError('操作失败');
      console.warn('[CardRenderer] interact 失败', e);
      throw e;
    }
  };

  // 卡片按钮与按钮组共用的 ActionButton 渲染(规则一致:style 收窄 + confirm 声明 + 失败回执)
  const renderActionButton = (n: CardActionButtonItem, key: string): ReactNode => (
    <ActionButton
      key={key}
      actionId={n.action_id}
      label={n.text ?? ''}
      style={buttonStyleKey(n.style)}
      confirm={n.confirm === true}
      onExecute={(id) => handleInteract(id, n.value)}
      onError={() => setActionError('操作失败')}
    />
  );

  const renderNode = (node: CardNode, depth: number, key: string): ReactNode => {
    if (depth > CARD_MAX_DEPTH) {
      return <div key={key} className="card-node card-node-unknown">[不支持的组件]</div>;
    }
    // 双受众:product 视角不渲染任何交互/日志/沙箱节点
    if (audience === 'product' && PRODUCT_HIDDEN_TYPES.has(node.type)) {
      return null;
    }
    switch (node.type) {
      case 'container': {
        const n = node as CardContainerNode;
        return (
          <div key={key} className="card-container">
            {(n.children ?? []).map((child, i) => renderNode(child, depth + 1, `${key}-${i}`))}
          </div>
        );
      }
      case 'row': {
        const n = node as CardRowNode;
        return (
          <div key={key} className="card-row">
            {(n.children ?? []).map((child, i) => renderNode(child, depth + 1, `${key}-${i}`))}
          </div>
        );
      }
      case 'column': {
        const n = node as CardColumnNode;
        return (
          <div key={key} className="card-column">
            {(n.children ?? []).map((child, i) => renderNode(child, depth + 1, `${key}-${i}`))}
          </div>
        );
      }
      case 'divider':
        return <hr key={key} className="card-divider" />;
      case 'text': {
        const n = node as CardTextNode;
        return <div key={key} className="card-text">{n.text}</div>;
      }
      case 'markdown': {
        const n = node as CardMarkdownNode;
        return (
          <div key={key} className="card-markdown">
            <MarkdownRenderer content={n.text ?? ''} />
          </div>
        );
      }
      case 'heading': {
        const n = node as CardHeadingNode;
        const level = n.level === 1 || n.level === 2 || n.level === 3 ? n.level : 3;
        return <div key={key} className={HEADING_CLASS[level]}>{n.text}</div>;
      }
      case 'image': {
        const n = node as CardImageNode;
        const src = resolveDisplayUrl(n.url);
        return src ? <img key={key} className="card-image" src={src} alt={n.alt ?? ''} /> : null;
      }
      case 'progress': {
        const n = node as CardProgressNode;
        const value = typeof n.value === 'number' ? n.value : 0;
        const max = typeof n.max === 'number' && n.max > 0 ? n.max : 100;
        const pct = Math.max(0, Math.min(100, (value / max) * 100));
        return (
          <div key={key} className="card-progress">
            {n.label !== undefined && <div className="card-progress-label">{n.label}</div>}
            <div className="card-progress-bar">
              <div className="card-progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      }
      case 'stat': {
        const n = node as CardStatNode;
        return (
          <div key={key} className="card-stat">
            <span className="card-stat-label">{n.label}</span>
            <span className="card-stat-value">{n.value}</span>
          </div>
        );
      }
      case 'table': {
        const n = node as CardTableNode;
        const columns = Array.isArray(n.columns) ? n.columns : [];
        const rows = Array.isArray(n.rows) ? n.rows : [];
        return (
          <table key={key} className="card-table">
            {columns.length > 0 && (
              <thead>
                <tr>{columns.map((col, ci) => <th key={ci}>{col}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {(Array.isArray(row) ? row : []).map((cell, ci) => <td key={ci}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        );
      }
      case 'chart': {
        const n = node as CardChartNode;
        return <CardChart key={key} node={n} />;
      }
      case 'log-tail': {
        // 等宽只读日志尾屏:纯文本拼接为单个 React 文本子节点(自动转义),绝不做任何插值/eval
        const n = node as CardLogTailNode;
        const rawLines = Array.isArray(n.lines) ? n.lines.filter((l): l is string => typeof l === 'string') : [];
        const clipped = rawLines.length > CARD_LOG_TAIL_MAX_LINES;
        const lines = clipped ? rawLines.slice(-CARD_LOG_TAIL_MAX_LINES) : rawLines;
        let body = '';
        if (clipped) {
          body += `…(仅显示最近 ${CARD_LOG_TAIL_MAX_LINES} 行)\n`;
        } else if (n.truncated === true) {
          body += '…(更早日志已省略)\n';
        }
        body += lines.map((l) => `${l}\n`).join('');
        return (
          <div key={key} className="card-log-tail">
            {n.title !== undefined && <div className="card-log-tail-title">{n.title}</div>}
            <pre className="card-log-tail-body">{body}</pre>
          </div>
        );
      }
      case 'button': {
        const n = node as CardButtonNode;
        return renderActionButton(n, key);
      }
      case 'action-buttons': {
        const n = node as CardActionButtonsNode;
        const buttons = (Array.isArray(n.buttons) ? n.buttons : []).filter(
          (b): b is CardActionButtonItem => typeof b === 'object' && b !== null && typeof b.action_id === 'string',
        );
        return (
          <div key={key} className="card-action-buttons">
            {buttons.map((b, i) => renderActionButton(b, `${key}-${i}`))}
          </div>
        );
      }
      case 'sandbox': {
        const n = node as CardSandboxNode;
        if (SANDBOX_ESCAPE_ENABLED === false) {
          // 逃逸阀默认关闭:一律惰性占位,绝不渲染卡片自带 url
          return <div key={key} className="card-node card-node-unknown">[富交互卡片]</div>;
        }
        // 机制就位分支(开关开启才可达):鉴权 secret 由后续批次接入会话密钥,当前传空串
        return (
          <ActionButton
            key={key}
            actionId="sandbox-open"
            label={n.title ?? '打开'}
            onExecute={async () => {
              await openSandboxEscapeWindow({ url: n.url ?? '', title: n.title, secret: '' });
            }}
          />
        );
      }
      case 'select': {
        const n = node as CardSelectNode;
        const options = Array.isArray(n.options) ? n.options : [];
        const current = typeof formValues[n.action_id] === 'string' ? (formValues[n.action_id] as string) : '';
        return (
          <select
            key={key}
            className="card-select"
            value={current}
            onChange={(e) => setFormValues((prev) => ({ ...prev, [n.action_id]: e.target.value }))}
          >
            {n.placeholder !== undefined && <option value="">{n.placeholder}</option>}
            {options.map((opt, oi) => <option key={oi} value={opt.value}>{opt.label}</option>)}
          </select>
        );
      }
      case 'input': {
        const n = node as CardInputNode;
        const current = typeof formValues[n.action_id] === 'string' ? (formValues[n.action_id] as string) : '';
        return (
          <div key={key} className="card-input-wrap">
            {n.label !== undefined && <label className="card-input-label">{n.label}</label>}
            <input
              className="card-input"
              type="text"
              value={current}
              placeholder={n.placeholder ?? ''}
              onChange={(e) => setFormValues((prev) => ({ ...prev, [n.action_id]: e.target.value }))}
            />
          </div>
        );
      }
      default:
        // 白名单外类型 → 惰性占位(不渲染任何卡片提供的内容)
        return <div key={key} className="card-node card-node-unknown">[不支持的组件]</div>;
    }
  };

  if (!parsed) {
    return <div className="card-renderer card-invalid" data-source={sourceType}>[无法解析的卡片]</div>;
  }

  return (
    <div className="card-renderer" data-source={sourceType}>
      {parsed.nodes.map((node, i) => renderNode(node, 0, String(i)))}
      {actionError && <div className="card-action-error">{actionError}</div>}
    </div>
  );
}
