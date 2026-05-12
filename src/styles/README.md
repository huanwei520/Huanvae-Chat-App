# Huanvae Chat 样式架构文档

## 📁 目录结构

```
src/styles/
├── index.css              # 样式入口文件
├── variables.css          # 设计 Token（CSS 变量）
├── base.css               # 基础布局与动画
├── components/            # 可复用组件样式
│   ├── glass-card.css     # 毛玻璃卡片
│   ├── app-button.css     # 主按钮（玻璃渐变）— 配合 src/components/common/AppButton.tsx
│   ├── subtle-button.css  # 浅色底按钮（行内动作 / 设置项）
│   ├── glass-input.css    # 毛玻璃输入框
│   ├── wheel-selector.css # 轮盘选择器
│   ├── loading.css        # 加载状态
│   └── toast.css          # 提示消息
├── pages/                 # 页面特定样式
│   ├── auth.css           # 认证页面
│   └── main.css           # 主页面
│
# 独立窗口样式（位于各自模块目录）
../meeting/styles.css      # 会议页面（独立窗口）
../media/styles.css        # 媒体预览页面（独立窗口）
```

---

## 🏗️ 架构分层说明

### 第一层：设计 Token（`variables.css` + `theme/`）

**作用**：定义全局设计系统，确保视觉一致性

| Token 类型 | 说明 | 示例 |
|-----------|------|------|
| 颜色系统 | 主题色、文字色、功能色 | `--color-blue-500` |
| 透明度 | 白色/蓝色各级透明度 | `--white-alpha-50` |
| 圆角 | 统一的圆角尺寸 | `--radius-lg` |
| 间距 | 统一的间距尺寸 | `--space-4` |
| 毛玻璃 | 模糊和饱和度配置 | `--blur-lg` |
| 过渡 | 动画时间和缓动函数 | `--transition-smooth` |
| 字体 | 字体大小定义 | `--text-lg` |

**主题系统 (`src/theme/`)**：

| 模块 | 说明 |
|------|------|
| `types.ts` | 类型定义（ColorScale、ThemeConfig 等） |
| `utils.ts` | 颜色计算工具（OKLCH 色阶生成） |
| `presets.ts` | 预设主题配置（天蓝、深海、森林、日落） |
| `generator.ts` | 主题数据生成器 |
| `store.ts` | Zustand 状态管理 + localStorage 持久化 |
| `ThemeProvider.tsx` | 将主题数据应用到 CSS 变量 |
| `ThemeEditor.tsx` | 设置面板中的主题编辑器 |

**使用原则**：
- 所有颜色值应优先使用变量
- 新增颜色需先在此文件定义
- 通过 ThemeProvider 自动注入主题 CSS 变量
- 支持亮色/暗色/跟随系统模式
- 支持预设主题和用户自定义颜色

---

### 第二层：基础样式（`base.css`）

**作用**：定义全局布局容器和装饰元素

| 样式 | 说明 |
|------|------|
| `.login-container` | 全屏登录容器，多层渐变背景 |
| `.floating-orb` | 浮动装饰圆，增强视觉层次 |
| `@keyframes` | 浮动动画定义 |
| `@media` | 响应式断点 |

**设计理念**：
- 丰富的背景色彩让毛玻璃效果更明显
- 浮动装饰增加页面动感
- 所有背景元素不影响交互（pointer-events: none）

---

### 第三层：组件样式（`components/`）

可复用的 UI 组件，遵循单一职责原则。

#### `glass-card.css` - 毛玻璃卡片

| 类名 | 说明 |
|------|------|
| `.glass-card` | 基础毛玻璃卡片容器 |
| `.auth-card` | 认证页面专用卡片 |
| `.auth-form-content` | 表单内容容器 |
| `.account-selector-content` | 账号选择器容器 |

**毛玻璃效果实现**：
- `backdrop-filter: blur() saturate()` 模糊 + 饱和度
- 多层 `box-shadow` 模拟玻璃光泽
- `::before` / `::after` 伪元素增加高光

---

#### `app-button.css` - 主按钮（AppButton 组件）

配合 `src/components/common/AppButton.tsx` 使用，4 variant × 3 size 覆盖全应用主按钮场景。
原 `.glass-button` 单一类名样式已合并到此组件。

| 类名 | 说明 |
|------|------|
| `.app-btn` | 基础（必带） |
| `.app-btn--{variant}` | primary / danger / secondary / ghost |
| `.app-btn--{size}` | sm / md / lg |
| `.app-btn--block` | 撑满父宽度 |
| `.app-btn--icon-only` | 方形图标按钮 |
| `.app-btn--loading` | loading 状态 |

**用法**：直接用 `<AppButton variant="primary" size="lg" block>登录</AppButton>` 组件，
不要手写 className。framer-motion 包装版可用 `<MotionAppButton>`（同文件导出）。

---

#### `subtle-button.css` - 浅色底按钮

与 `app-button.css` 互补的扁平风格按钮，用于行内动作 / 设置项 / 弱强调操作。
合并自原本分散在多模块的同风格按钮：`.settings-row-btn` / `.reset-confirm-btn` / `.lan-btn`。

| 类名 | 说明 |
|------|------|
| `.subtle-btn` | 基础（必带） |
| `.subtle-btn--{size}` | xs / sm / md |
| `.subtle-btn--{tone}` | primary / danger / neutral |

---

#### `glass-input.css` - 毛玻璃输入框

| 类名 | 说明 |
|------|------|
| `.form-group` | 表单组容器 |
| `.form-label` | 表单标签 |
| `.glass-input` | 毛玻璃输入框 |
| `.input-with-prefix` | 带前缀的输入框容器 |
| `.protocol-toggle` | 协议切换按钮（http/https） |
| `.optional-label` | 可选字段标签 |

---

#### `wheel-selector.css` - 堆叠卡片账号选择器

**技术方案**：Framer Motion + 自定义堆叠布局

| 类名 | 说明 |
|------|------|
| `.stack-selector` | 选择器主容器 |
| `.stack-container` | 卡片堆叠容器 |
| `.stack-card` | 卡片外层包装 |
| `.stack-card-prev` | 上一个卡片 |
| `.stack-card-current` | 当前卡片 |
| `.stack-card-next` | 下一个卡片 |
| `.stack-account-card` | 账户卡片内容 |
| `.stack-card-avatar` | 头像区域 |
| `.stack-card-info` | 信息区域 |
| `.stack-counter` | 计数器 |
| `.wheel-actions` | 操作按钮区域 |
| `.delete-*` | 删除相关样式 |

**堆叠效果说明**：
```
     ┌──────────────┐     ← 上一个卡片（缩小 88%，透明度 50%）
   ┌──────────────────┐
   │   当前选中卡片    │   ← 主卡片（原始大小，完全不透明）
   └──────────────────┘
     └──────────────┘     ← 下一个卡片（缩小 88%，透明度 50%）
```

**特性**：

| 特性 | 说明 |
|------|------|
| 堆叠显示 | 同时显示上、中、下三张卡片 |
| 无限循环 | 2个账户时上下显示同一张卡片 |
| 流畅动画 | 使用 Framer Motion spring 动画 |
| 零依赖 | 无需额外轮播库 |

**交互方式**：鼠标滚轮、点击上下卡片切换、点击当前卡片登录

---

#### `loading.css` - 加载状态

| 类名 | 说明 |
|------|------|
| `.loading-spinner` | 加载指示器容器 |
| `.spinner-icon` | 旋转图标 |
| `.loading-overlay` | 全屏加载遮罩 |

---

#### `toast.css` - 提示消息

| 类名 | 说明 |
|------|------|
| `.error-message` | 内联错误提示 |
| `.error-toast` | 浮动错误提示 |

---

### 第四层：页面样式（`pages/`）

页面特定的样式，不应被其他页面复用。

#### `auth.css` - 认证页面

| 类名 | 说明 |
|------|------|
| `.login-title` | 页面主标题 |
| `.login-subtitle` | 页面副标题 |
| `.icon-wrapper` | 顶部图标容器 |
| `.footer-text` | 底部版权文字 |
| `.back-button` | 返回按钮 |
| `.auth-link` | 登录/注册切换链接 |
| `.step-indicator` | 分步指示器 |
| `.step-dot` | 步骤圆点 |
| `.step-container` | 步骤内容容器 |

---

## 📐 设计规范

### 颜色使用

```css
/* ✅ 推荐 - 使用变量 */
color: var(--color-text-primary);
background: var(--color-blue-500);

/* ❌ 避免 - 硬编码颜色 */
color: #1e3a5f;
background: #3b82f6;
```

### 毛玻璃效果标准配置

```css
/* 标准毛玻璃 */
background: linear-gradient(135deg, 
  rgba(255, 255, 255, 0.35) 0%,
  rgba(255, 255, 255, 0.2) 100%
);
backdrop-filter: blur(24px) saturate(180%);
-webkit-backdrop-filter: blur(24px) saturate(180%);
border: 1.5px solid rgba(255, 255, 255, 0.6);
```

### 阴影层次

```css
/* 标准多层阴影 */
box-shadow: 
  0 0 60px rgba(255, 255, 255, 0.5),    /* 外发光 */
  0 8px 32px rgba(59, 130, 246, 0.1),   /* 主阴影 */
  inset 0 2px 2px rgba(255, 255, 255, 0.8); /* 内高光 */
```

---

## 🔧 维护指南

### 添加新组件

1. 在 `components/` 目录创建新文件
2. 添加详细的文件头注释
3. 在 `index.css` 中导入新文件
4. 更新本文档

### 添加新页面样式

1. 在 `pages/` 目录创建新文件
2. 仅包含该页面特有的样式
3. 通用样式应提取到 `components/`
4. 在 `index.css` 中导入

### 修改设计 Token

1. 修改 `variables.css` 中的变量值
2. 所有使用该变量的地方自动更新
3. 测试所有相关组件的显示效果

---

## 📊 文件统计

| 文件 | 行数 | 职责 |
|------|------|------|
| `variables.css` | ~150 | 设计 Token |
| `base.css` | ~190 | 基础布局 |
| `glass-card.css` | ~170 | 卡片组件 |
| `app-button.css` | ~360 | 主按钮组件（AppButton） |
| `subtle-button.css` | ~80 | 浅色底按钮 |
| `glass-input.css` | ~230 | 输入框组件 |
| `wheel-selector.css` | ~340 | Embla 选择器（含详细配置文档） |
| `loading.css` | ~90 | 加载状态 |
| `toast.css` | ~120 | 提示消息 |
| `auth.css` | ~250 | 认证页面 |

---

## 📦 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `embla-carousel-react` | v8+ | 账号选择器轮播核心 |
| `embla-carousel-wheel-gestures` | v8+ | 流畅的滚轮控制插件 |
| `framer-motion` | - | 页面过渡和微动画 |

---

## 🎨 设计理念

1. **毛玻璃美学**：通过 `backdrop-filter` 和多层阴影实现高质感玻璃效果
2. **蓝白主题**：清新、专业的配色方案
3. **流畅动画**：Embla Carousel 提供流畅的滚轮和拖拽体验
4. **无缝循环**：无限循环滚动，无需反向滚动即可继续
5. **轻量级**：Embla 仅 ~5KB，性能优秀
6. **响应式**：适配不同屏幕尺寸
7. **可维护性**：模块化拆分，单一职责原则

---

## 📱 移动端样式 (`mobile/`)

移动端专属样式，实现与桌面端分离的 UI 布局。

### 目录结构

```
src/styles/mobile/
├── index.css          # 移动端样式入口
├── main.css           # 主容器（使用 100dvh 动态视口）
├── header.css         # 顶部栏（含状态栏安全区域）
├── tab-bar.css        # 底部 Tab 栏
├── drawer.css         # 抽屉侧边栏
├── contacts.css       # 通讯录/消息列表卡片
└── chat-view.css      # 聊天页面
```

### 安全区域适配

移动端使用 `env(safe-area-inset-*)` 适配 Android/iOS 状态栏和底部手势条：

| 区域 | CSS 属性 | 应用位置 |
|------|----------|----------|
| 顶部状态栏 | `env(safe-area-inset-top)` | `.mobile-header`, `.mobile-chat-header` |
| 底部手势条 | `env(safe-area-inset-bottom)` | `.mobile-chat-input` |

### 聊天页面布局

```
┌─────────────────────────────┐
│  .mobile-chat-header        │ ← padding-top 包含状态栏
├─────────────────────────────┤
│                             │
│  .mobile-chat-messages      │ ← overflow: hidden，内部组件管理滚动
│    └── .chat-messages-container │ ← height: 100%，实际滚动容器
│                             │
├─────────────────────────────┤
│  .mobile-chat-input         │ ← padding-bottom 包含手势条
└─────────────────────────────┘
```

**关键设计**：
- `.mobile-chat-messages` 设置 `overflow: hidden`，不在此层滚动
- 内部 `.chat-messages-container` 设置 `height: 100%`，由 `ChatMessages` 组件管理滚动
- 避免嵌套滚动容器导致的 `scrollToBottom()` 失效问题

### 移动端媒体预览

由于移动端不支持 `WebviewWindow` 多窗口，图片和视频使用全屏模态框预览：

```
┌─────────────────────────────┐
│  ╳  文件名.jpg              │ ← .mobile-media-preview-header
├─────────────────────────────┤
│                             │
│        [图片/视频]           │ ← .mobile-media-preview-content
│                             │
└─────────────────────────────┘
```

| 类名 | 说明 |
|------|------|
| `.mobile-media-preview-overlay` | 全屏遮罩层 |
| `.mobile-media-preview-header` | 顶部栏（关闭按钮、文件名） |
| `.mobile-media-preview-content` | 媒体内容区域 |
| `.mobile-media-preview-image` | 图片（支持双指缩放） |
| `.mobile-media-preview-video` | 视频播放器 |

### 移动端视频播放

由于 Android WebView 无法通过 Tauri 的 `asset://` 协议播放本地视频（已知问题 [#12019](https://github.com/tauri-apps/tauri/issues/12019)），
采用 Rust 端本地 HTTP 服务器方案：

```
┌─────────────────────────────────────────────────────────┐
│                   视频播放流程                           │
├─────────────────────────────────────────────────────────┤
│  前端请求视频 → 检查本地缓存                              │
│       ├── 有缓存 → 使用 http://127.0.0.1:9527/video/{hash} │
│       └── 无缓存 → 使用 Presigned URL + 后台下载          │
└─────────────────────────────────────────────────────────┘
```

| 模块 | 说明 |
|------|------|
| `mobile_media_server.rs` | Rust 本地 HTTP 服务器，支持 Range 请求 |
| `get_local_video_url` | Tauri 命令，获取本地视频的 HTTP URL |
| `getVideoSource()` | 前端函数，移动端视频专用 |

**优势**：
- 支持视频进度条拖动（HTTP 206 Partial Content）
- 流式传输，低内存占用
- 本地缓存后零流量消耗

### 更新日志

- 2026-01-22: 添加安全区域适配（状态栏、底部手势条）
- 2026-01-22: 修复聊天页面消息滚动问题（移除嵌套滚动）
- 2026-01-22: 添加移动端媒体预览模态框（替代 WebviewWindow）
- 2026-01-22: 修复移动端群聊消息气泡位置/颜色显示问题
- 2026-01-22: 修复移动端输入框自动聚焦问题
- 2026-01-23: 添加移动端本地视频服务器（解决 asset:// 视频播放问题）
- 2026-01-23: 移动端视频缩略图改用 video 元素显示第一帧（替代紫色占位符）
- 2026-01-23: 添加移动端手势返回处理（tauri-plugin-mobile-onbackpressed-listener）
- 2026-01-23: 添加 Android 设备信息获取（使用 UUID 替代 MAC 地址）
- 2026-01-23: 移动端抽屉侧边栏改用统一毛玻璃效果变量
- 2026-01-23: 移动端提示音播放改用本地 HTTP 服务器（解决 asset:// 音频播放问题）
- 2026-01-23: 移动端会话持久化改用 tauri-plugin-store（与 QQ/微信 体验一致）
- 2026-01-23: 移动端启动速度优化（跳过 window-state、Store 静态导入、并行加载、先显示 UI 后验证 Token）
- 2026-01-23: 移动端个人资料和我的文件改为独立全屏页面（使用与抽屉一致的毛玻璃效果）
- 2026-01-23: 移动端设置页面独立化，修复状态栏安全区域
- 2026-01-23: 移动端消息/通讯录左右滑动切换
- 2026-01-23: 移动端聊天页面进入/退出滑动过渡
- 2026-01-23: 移动端局域网互传页面
- 2026-01-23: 添加 tauri-plugin-android-fs 解决 content:// URI 文件读取问题

---

## 🪟 独立窗口样式

独立窗口样式位于各自模块目录，通过 `index.css` 统一导入。

### `../meeting/styles.css` - 会议页面

视频会议独立窗口样式，使用 Tauri WebviewWindow API 打开。

| 类名 | 说明 |
|------|------|
| `.meeting-page` | 会议页面主容器 |
| `.meeting-header` | 顶部控制栏 |
| `.meeting-main` | 视频网格区域 |
| `.meeting-controls` | 底部操作按钮 |
| `.participant-video` | 参与者视频框 |
| `.participant-video.speaking` | 说话中状态（绿色边框） |

### `../media/styles.css` - 媒体预览页面

图片和视频独立窗口预览样式，使用 Tauri WebviewWindow API 打开。

| 类名 | 说明 |
|------|------|
| `.media-page` | 媒体预览页面主容器 |
| `.media-header` | 顶部工具栏（文件名、大小、关闭按钮） |
| `.media-content` | 内容区域 |
| `.media-toolbar-extra` | 扩展工具栏（下载按钮、本地标识） |
| `.media-image-container` | 图片容器（支持缩放和拖拽） |
| `.media-video-container` | 视频容器 |
| `.media-loading` | 加载状态 |
| `.media-error` | 错误状态 |
| `.media-zoom-indicator` | 缩放比例指示器 |

**功能特性**：
- 图片支持滚轮缩放（0.1x - 10x）
- 图片放大后支持拖拽移动
- 双击重置缩放
- 视频边播边缓存
- ESC 键关闭窗口
- 本地文件优先加载

