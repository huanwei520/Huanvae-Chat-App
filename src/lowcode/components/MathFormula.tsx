/**
 * LaTeX 公式渲染组件
 *
 * 使用 MathJax 3 渲染 LaTeX 数学公式
 *
 * ## 使用方式
 * ```tsx
 * import { MathFormula } from './MathFormula';
 *
 * // 行内公式
 * <MathFormula latex="x^2 + y^2 = r^2" inline />
 *
 * // 块级公式
 * <MathFormula latex="\int_0^1 f(x) dx" />
 *
 * // 自带 $ 分隔符也可正确处理
 * <MathFormula latex="$E = mc^2$" inline />
 * ```
 *
 * ## 注意事项
 * - 需要在父组件中包裹 MathJaxContext
 * - 支持 TeX/LaTeX 语法
 * - 自动剥离输入中已有的 $/$$ 分隔符，避免双层嵌套
 *
 * @module lowcode/components/MathFormula
 * @created 2026-01-26
 * @updated 2026-02-06 添加分隔符自动剥离，修复部分公式显示为原文的问题
 */

import { MathJax } from 'better-react-mathjax';

// ============================================================================
// 类型定义
// ============================================================================

export interface MathFormulaProps {
  /** LaTeX 公式字符串 */
  latex: string;
  /** 是否为行内公式（默认为块级公式） */
  inline?: boolean;
  /** 自定义类名 */
  className?: string;
}

// ============================================================================
// 组件实现
// ============================================================================

/**
 * 剥离公式中已有的 TeX 分隔符（$、$$）
 *
 * 后端返回的 latex_formula 可能自带 $...$ 或 $$...$$ 分隔符，
 * 组件内部会重新包裹分隔符，需要先去除避免双层嵌套导致 MathJax 解析失败
 */
function stripDelimiters(raw: string): string {
  let s = raw.trim();
  // 先处理 $$...$$
  if (s.startsWith('$$') && s.endsWith('$$')) {
    s = s.slice(2, -2).trim();
  } else if (s.startsWith('$') && s.endsWith('$') && s.length > 1) {
    // 处理 $...$
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * LaTeX 公式渲染组件
 *
 * @param props - 组件属性
 * @returns 渲染后的公式元素
 */
export function MathFormula({ latex, inline = false, className }: MathFormulaProps) {
  // 空公式不渲染
  if (!latex || latex.trim() === '') {
    return null;
  }

  // 剥离已有的 TeX 分隔符，避免双层嵌套
  const cleaned = stripDelimiters(latex);
  if (!cleaned) {
    return null;
  }

  // 使用 TeX 分隔符
  const delimiter = inline ? '$' : '$$';
  const formula = `${delimiter}${cleaned}${delimiter}`;

  return (
    <span className={className}>
      <MathJax dynamic>{formula}</MathJax>
    </span>
  );
}

/**
 * 行内公式快捷组件
 */
export function InlineMath({ latex, className }: Omit<MathFormulaProps, 'inline'>) {
  return <MathFormula latex={latex} inline className={className} />;
}

/**
 * 块级公式快捷组件
 */
export function BlockMath({ latex, className }: Omit<MathFormulaProps, 'inline'>) {
  return <MathFormula latex={latex} inline={false} className={className} />;
}
