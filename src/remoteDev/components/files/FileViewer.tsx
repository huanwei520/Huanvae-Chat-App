/**
 * 文件查看器（只读语法高亮）
 *
 * 使用 react-syntax-highlighter 替代 Monaco Editor
 * 避免 Monaco 从 CDN 加载被 Tauri WebView Tracking Prevention 阻止
 */

import { useMemo, useRef, useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

const EXT_LANG_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  html: 'markup',
  htm: 'markup',
  css: 'css',
  scss: 'scss',
  less: 'less',
  sql: 'sql',
  md: 'markdown',
  dockerfile: 'docker',
  makefile: 'makefile',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  vue: 'markup',
  svelte: 'markup',
  env: 'bash',
  cfg: 'ini',
  ini: 'ini',
  conf: 'nginx',
  nginx: 'nginx',
};

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return 'docker';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'makefile';
  if (lower.startsWith('.env')) return 'bash';

  const ext = lower.split('.').pop() || '';
  return EXT_LANG_MAP[ext] || 'text';
}

interface FileViewerProps {
  filename: string;
  content: string;
  truncated?: boolean;
}

export function FileViewer({ filename, content, truncated }: FileViewerProps) {
  const language = useMemo(() => detectLanguage(filename), [filename]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current?.parentElement;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const headerHeight = 34;
        setHeight(Math.max(200, entry.contentRect.height - headerHeight));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="rd-file-viewer-header">
        <span style={{ fontWeight: 600 }}>{filename}</span>
        <span className="rd-badge rd-badge-info">{language}</span>
        {truncated && (
          <span className="rd-badge rd-badge-warning">文件已截断（仅前 1MB）</span>
        )}
      </div>
      <div className="rd-file-viewer-code" style={{ height }}>
        <SyntaxHighlighter
          language={language}
          style={oneLight}
          showLineNumbers
          wrapLongLines
          customStyle={{
            margin: 0,
            padding: '12px 0',
            background: 'transparent',
            fontSize: 13,
            fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
            height: '100%',
            overflow: 'auto',
          }}
          lineNumberStyle={{
            minWidth: '3em',
            paddingRight: '1em',
            color: 'var(--text-light)',
            fontSize: 12,
            userSelect: 'none',
          }}
        >
          {content}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
