/**
 * AI 助手头像
 *
 * 白色圆形底，"AI" 文字使用蓝白淡色渐变
 * 颜色引用 variables.css 静态品牌 token（--ai-avatar-bg / --ai-avatar-ring / --ai-avatar-gradient）
 * 尺寸由外层容器控制
 */

import { memo } from 'react';

export const AIAvatar = memo(function AIAvatar() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '50%',
        background: 'var(--ai-avatar-bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1.5px solid var(--ai-avatar-ring)',
      }}
    >
      <span
        style={{
          fontSize: '0.85em',
          fontWeight: 800,
          letterSpacing: '0.5px',
          background: 'var(--ai-avatar-gradient)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          userSelect: 'none',
          lineHeight: 1,
        }}
      >
        AI
      </span>
    </div>
  );
});
