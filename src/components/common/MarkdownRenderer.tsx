/**
 * Markdown 渲染组件
 *
 * 基于 react-markdown，支持 GFM 扩展（表格、任务列表、删除线）
 * 和 highlight.js 代码语法高亮。
 *
 * 用于聊天气泡中的消息内容渲染（AI 助手、好友、群聊）。
 * 代码块带语言标签和复制按钮。
 */

import { memo, useCallback, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

interface MarkdownRendererProps {
  content: string;
}

function CodeBlock({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const isBlock = match || (typeof children === 'string' && children.includes('\n'));

  const handleCopy = useCallback(() => {
    const text = String(children).replace(/\n$/, '');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);

  if (!isBlock) {
    return <code className={className} {...props}>{children}</code>;
  }

  const language = match?.[1] ?? '';

  return (
    <div>
      <div className="code-block-header">
        <span>{language || 'code'}</span>
        <button className="code-copy-btn" onClick={handleCopy} type="button">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <code className={className} {...props}>{children}</code>
    </div>
  );
}

const components = {
  code: CodeBlock,
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
}: MarkdownRendererProps) {
  if (!content) {
    return null;
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
