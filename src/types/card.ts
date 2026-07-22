/**
 * 可交互卡片(S2)节点树类型定义。
 *
 * 卡片内容是**声明式数据**,不是代码——前端渲染器按 type 走封闭白名单 switch,
 * 未知 type 渲染成惰性占位。绝不做运行时代码求值、动态函数构造、或 React 原始 HTML 注入。
 *
 * 契约边界(S1):后端只校验 `type` 在白名单内 + 整体体积 ≤256KiB + 嵌套深度 ≤32;
 * **各节点内部字段形状由本文件(前端)定义**,后端不校验内部字段。因此渲染器对每个
 * 字段都当作"可能缺失/可能类型不符"处理(React children 自动转义,className 只取白名单常量)。
 *
 * 18 类封闭白名单:
 * - 布局:container / row / column(各含可选 children)、divider
 * - 内容:text{text} / markdown{text} / heading{text,level:1|2|3} / image{url,alt}
 *         / progress{value,max,label} / stat{label,value} / table{columns,rows}
 *         / chart{title,chart_type,data,height}(klinecharts 渲染,声明式 spec)
 *         / log-tail{title,lines,truncated}(等宽只读日志尾屏,纯文本)
 * - 交互:button{action_id,text,value,style,confirm} / select{action_id,options,placeholder}
 *         / input{action_id,placeholder,label}
 *         / action-buttons{buttons}(按钮组,各带不透明 action_id)
 * - 逃逸:sandbox{url,title}(声明式表达不了的富交互,独立窗口机制,默认关闭)
 */

// ============================================
// 布局节点
// ============================================

/** 容器:纵向堆叠子节点 */
export interface CardContainerNode {
  type: 'container';
  children?: CardNode[];
}

/** 行:横向排列子节点 */
export interface CardRowNode {
  type: 'row';
  children?: CardNode[];
}

/** 列:纵向排列子节点 */
export interface CardColumnNode {
  type: 'column';
  children?: CardNode[];
}

/** 分隔线(无子节点) */
export interface CardDividerNode {
  type: 'divider';
}

// ============================================
// 内容节点
// ============================================

/** 纯文本(React child 自动转义) */
export interface CardTextNode {
  type: 'text';
  text?: string;
}

/** Markdown 文本(经 MarkdownRenderer 渲染,raw-HTML 关闭) */
export interface CardMarkdownNode {
  type: 'markdown';
  text?: string;
}

/** 标题(level 仅 1|2|3,className 由白名单 map 取,不插值卡片字段) */
export interface CardHeadingNode {
  type: 'heading';
  text?: string;
  level?: 1 | 2 | 3;
}

/** 图片(url 必经 resolveDisplayUrl 收口) */
export interface CardImageNode {
  type: 'image';
  url?: string;
  alt?: string;
}

/** 进度条(value/max → 百分比 clamp 到 0..100) */
export interface CardProgressNode {
  type: 'progress';
  value?: number;
  max?: number;
  label?: string;
}

/** 指标(标签 + 值) */
export interface CardStatNode {
  type: 'stat';
  label?: string;
  value?: string;
}

/** 表格(表头列 + 行,单元格均为 React child) */
export interface CardTableNode {
  type: 'table';
  columns?: string[];
  rows?: string[][];
}

/** K 线数据点(数值字段渲染时逐一校验,非法行丢弃) */
export interface CardChartCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  turnover?: number;
}

/** 图表(S4):声明式 spec 驱动,klinecharts 渲染;不接任意代码 */
export interface CardChartNode {
  type: 'chart';
  title?: string;
  chart_type?: 'candlestick' | 'area';
  data?: CardChartCandle[];
  /** px,clamp 120..480,默认 240 */
  height?: number;
}

/** 日志尾屏:等宽只读,截断展示,纯文本(React child 自动转义,绝不插值 className) */
export interface CardLogTailNode {
  type: 'log-tail';
  title?: string;
  lines?: string[];
  /** 发卡方声明"更早日志已省略"时渲染省略提示行 */
  truncated?: boolean;
}

/** 沙箱逃逸阀占位(R3):声明式表达不了的富交互卡片,独立窗口机制,默认关闭 */
export interface CardSandboxNode {
  type: 'sandbox';
  url?: string;
  title?: string;
}

// ============================================
// 交互节点
// ============================================

/** 按钮:携带**不透明** action_id(非取回执行的 URL) + 可选 value */
export interface CardButtonNode {
  type: 'button';
  action_id: string;
  text?: string;
  value?: unknown;
  style?: 'primary' | 'secondary' | 'danger';
  /** 破坏性动作需二次确认,由卡片声明 */
  confirm?: boolean;
}

/** 动作按钮组中的单个按钮(与 CardButtonNode 同字段,不含 type) */
export interface CardActionButtonItem {
  action_id: string;
  text?: string;
  value?: unknown;
  style?: 'primary' | 'secondary' | 'danger';
  confirm?: boolean;
}

/** 动作按钮组:一行可操作按钮,各带不透明 action_id */
export interface CardActionButtonsNode {
  type: 'action-buttons';
  buttons?: CardActionButtonItem[];
}

/** 下拉选择:写入表单态(键=action_id) */
export interface CardSelectNode {
  type: 'select';
  action_id: string;
  options?: { label: string; value: string }[];
  placeholder?: string;
}

/** 文本输入:写入表单态(键=action_id) */
export interface CardInputNode {
  type: 'input';
  action_id: string;
  placeholder?: string;
  label?: string;
}

// ============================================
// 联合类型 + 常量
// ============================================

/** 18 类已知节点 */
export type KnownCardNode =
  | CardContainerNode
  | CardRowNode
  | CardColumnNode
  | CardDividerNode
  | CardTextNode
  | CardMarkdownNode
  | CardHeadingNode
  | CardImageNode
  | CardProgressNode
  | CardStatNode
  | CardTableNode
  | CardChartNode
  | CardLogTailNode
  | CardButtonNode
  | CardActionButtonsNode
  | CardSelectNode
  | CardInputNode
  | CardSandboxNode;

/**
 * 未知节点兜底形状——让任意 type 的节点在类型上"可表示",
 * 从而经解析后仍是合法 CardNode,渲染器 default 分支把它变惰性占位。
 */
export interface CardUnknownNode {
  type: string;
  [k: string]: unknown;
}

/** 卡片节点 = 18 类已知节点 + 未知兜底 */
export type CardNode = KnownCardNode | CardUnknownNode;

/** 卡片 schema(版本 + 节点数组) */
export interface CardSchema {
  version?: number;
  nodes: CardNode[];
}

/** 18 类白名单节点 type(渲染器 switch 的封闭集合) */
export const CARD_NODE_TYPES = [
  'container',
  'row',
  'column',
  'divider',
  'text',
  'markdown',
  'heading',
  'image',
  'progress',
  'stat',
  'table',
  'chart',
  'log-tail',
  'button',
  'action-buttons',
  'select',
  'input',
  'sandbox',
] as const;

/** 节点树最大嵌套深度(与后端 S1 校验一致);超出即渲染惰性占位 */
export const CARD_MAX_DEPTH = 32;

/** 运行时守卫:是否为合法卡片 schema(对象且含 nodes 数组) */
export function isCardSchema(v: unknown): v is CardSchema {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  return Array.isArray((v as { nodes?: unknown }).nodes);
}
