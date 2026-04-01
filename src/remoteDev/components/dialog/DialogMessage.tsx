/**
 * 单条 Claude 对话事件渲染
 *
 * 根据事件类型分发到不同的展示样式：
 * - system: 初始化信息
 * - assistant + text: Markdown 渲染
 * - assistant + tool_use: ToolCallBlock
 * - user + tool_result: ToolResultBlock
 * - result: 完成摘要
 * - status/error: 系统消息
 */

import ReactMarkdown from 'react-markdown';
import type { ClaudeDialogEvent } from '../../types/remoteDev';
import { ToolCallBlock, ToolResultBlock } from './ToolCallBlock';

interface DialogMessageProps {
  event: ClaudeDialogEvent;
}

export function DialogMessage({ event }: DialogMessageProps) {
  switch (event.type) {
    case 'status':
      return (
        <div className="rd-msg rd-msg-system">
          {event.message}
        </div>
      );

    case 'error':
      return (
        <div className="rd-msg rd-msg-error">
          {event.message}
        </div>
      );

    case 'system': {
      return (
        <div className="rd-msg rd-msg-system">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>系统初始化</div>
          {event.cwd && <div>工作目录：{event.cwd}</div>}
          {event.model && <div>模型：{event.model}</div>}
          {event.tools && event.tools.length > 0 && (
            <div style={{ marginTop: 4 }}>
              可用工具：{event.tools.join(', ')}
            </div>
          )}
        </div>
      );
    }

    case 'assistant': {
      const blocks = event.message.content;
      return (
        <div className="rd-msg rd-msg-assistant">
          {blocks.map((block, i) => {
            if (block.type === 'text') {
              return (
                <div key={i} className="rd-markdown-content">
                  <ReactMarkdown>{block.text}</ReactMarkdown>
                </div>
              );
            }
            if (block.type === 'tool_use') {
              return (
                <ToolCallBlock
                  key={i}
                  name={block.name}
                  input={block.input}
                />
              );
            }
            return null;
          })}
        </div>
      );
    }

    case 'user': {
      const blocks = event.message.content;
      return (
        <div className="rd-msg rd-msg-user">
          {blocks.map((block, i) => {
            if (block.type === 'tool_result') {
              return <ToolResultBlock key={i} content={block.content} />;
            }
            if (block.type === 'text') {
              return <div key={i}>{block.text}</div>;
            }
            return null;
          })}
        </div>
      );
    }

    case 'result': {
      return (
        <div className="rd-msg rd-msg-result">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            会话完成 ({event.subtype})
          </div>
          <div>
            耗时 {(event.duration_ms / 1000).toFixed(1)}s · {event.num_turns} 轮
          </div>
          {event.result && (
            <div style={{ marginTop: 8 }}>
              <ReactMarkdown>{event.result}</ReactMarkdown>
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
