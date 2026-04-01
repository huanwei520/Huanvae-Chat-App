/**
 * 工具调用折叠块
 *
 * 展示 Claude 的 tool_use / tool_result
 */

import { useState } from 'react';

interface ToolCallBlockProps {
  name: string;
  input: Record<string, unknown>;
}

export function ToolCallBlock({ name, input }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false);
  const inputStr = JSON.stringify(input, null, 2);

  return (
    <div className="rd-tool-block">
      <div
        className="rd-tool-header"
        onClick={() => setOpen((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((p) => !p);
          }
        }}
      >
        <span className={`rd-tool-chevron${open ? ' open' : ''}`}>▶</span>
        <span className="rd-tool-name">{name}</span>
      </div>
      {open && (
        <div className="rd-tool-body">{inputStr}</div>
      )}
    </div>
  );
}

interface ToolResultBlockProps {
  content: string;
}

export function ToolResultBlock({ content }: ToolResultBlockProps) {
  const [open, setOpen] = useState(false);
  const preview = content.length > 200 ? content.slice(0, 200) + '…' : content;

  return (
    <div className="rd-tool-block">
      <div
        className="rd-tool-header"
        onClick={() => setOpen((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((p) => !p);
          }
        }}
      >
        <span className={`rd-tool-chevron${open ? ' open' : ''}`}>▶</span>
        <span className="rd-tool-name" style={{ color: 'var(--status-success)' }}>tool_result</span>
      </div>
      {open ? (
        <div className="rd-tool-body">{content}</div>
      ) : (
        <div className="rd-tool-body" style={{ opacity: 0.6 }}>{preview}</div>
      )}
    </div>
  );
}
