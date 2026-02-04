# 测试框架说明

## 概述

Huanvae Chat App 使用 Vitest 作为测试框架，配合 Testing Library 进行 React 组件测试。

## 目录结构

```
tests/
├── setup.ts                     # 全局测试设置（Mock Tauri API）
├── checklist.ts                 # 功能检查清单定义
├── registry.ts                  # 组件注册表（142 个模块，含移动端组件、工具函数和共享组件）
├── README.md                    # 本文档
├── utils/
│   └── test-utils.tsx           # 测试工具函数
├── unit/                        # 单元测试
│   ├── update.test.ts           # 更新服务测试（含 Windows 安装类型检测）
│   ├── notification.test.ts     # 通知服务测试
│   ├── notificationSounds.test.ts # 提示音管理 Hook 测试
│   ├── settings.test.ts         # 设置状态管理测试（含大文件阈值）
│   ├── diagnosticService.test.ts # 诊断上报服务测试
│   ├── sessionLock.test.ts      # 会话锁服务测试（同账户单开，8 个用例）
│   ├── lanTransfer.test.ts      # 局域网传输测试（62 个用例，含多文件批量传输）
│   ├── devices.test.ts          # 设备管理 API 测试（8 个用例，含批量删除）
│   ├── format.test.ts           # 格式化工具函数测试（12 个用例）
│   └── lowcode.test.ts          # 低代码编辑器测试（40 个用例，含类型定义测试）
│   # 注：deviceInfo 服务测试需 Tauri 环境，在 registry.test.tsx 中验证导入
└── components/                  # 组件测试
    ├── LoadingSpinner.test.tsx  # 加载动画组件测试
    ├── SettingsPanel.test.tsx   # 设置面板组件测试（20 个测试用例）
    ├── SyncStatusBanner.test.tsx # 消息同步状态横幅测试（6 个测试用例）
    ├── UpdateToast.test.tsx     # 更新提示弹窗测试
    ├── LowcodePage.test.tsx     # 低代码编辑器页面测试（6 个测试用例）
    └── registry.test.tsx        # 组件注册表测试（149 个测试用例，含移动端组件）
```

## 测试命令

```bash
# 运行测试（监听模式）
pnpm test

# 运行测试（单次）
pnpm test:run

# 运行测试并生成覆盖率报告
pnpm test:coverage

# 使用 UI 界面运行测试
pnpm test:ui

# TypeScript 类型检查
pnpm typecheck

# 运行所有检查（类型 + lint + 测试）
pnpm check
```

## 编写测试

### 单元测试示例

```typescript
// tests/unit/example.test.ts
import { describe, it, expect, vi } from 'vitest';
import { myFunction } from '../../src/utils/example';

describe('myFunction', () => {
  it('应该返回正确结果', () => {
    expect(myFunction(1, 2)).toBe(3);
  });

  it('处理边界情况', () => {
    expect(myFunction(0, 0)).toBe(0);
  });
});
```

### 组件测试示例

```typescript
// tests/components/Example.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '../utils/test-utils';
import { MyComponent } from '../../src/components/MyComponent';

describe('MyComponent', () => {
  it('渲染正确的内容', () => {
    render(<MyComponent title="测试" />);
    expect(screen.getByText('测试')).toBeInTheDocument();
  });

  it('响应用户交互', async () => {
    const { user } = render(<MyComponent />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('已点击')).toBeInTheDocument();
  });
});
```

## Mock 说明

`tests/setup.ts` 已预配置以下 Mock：

### Tauri API Mock

| 模块 | Mock 行为 |
|------|----------|
| `@tauri-apps/plugin-updater` | `check()` 返回 `null` |
| `@tauri-apps/plugin-process` | `relaunch()` 为空函数 |
| `@tauri-apps/plugin-notification` | 权限默认授予 |
| `@tauri-apps/plugin-fs` | 文件操作返回空 |
| `@tauri-apps/plugin-http` | `fetch()` 为空函数 |
| `@tauri-apps/plugin-os` | `platform()` 返回 `"linux"` |
| `@tauri-apps/plugin-window-state` | `restoreStateCurrent()` 返回 Promise |
| `@tauri-apps/api/window` | `getCurrentWindow()` 返回 mock 窗口对象 |
| `@tauri-apps/api/core` | `invoke()` 返回空函数（可按需 mock） |

### 浏览器 API Mock

- `localStorage` - 完整 mock
- `matchMedia` - 返回不匹配
- `ResizeObserver` - 空实现
- `IntersectionObserver` - 空实现

## 功能检查清单

`tests/checklist.ts` 定义了应用的所有功能点，用于预发布检查。

主要功能分类：
- 认证模块：登录/登出/自动登录
- 好友/群聊模块：消息发送、文件传输
- 文件模块：本地缓存、在文件夹中显示、大文件直连、**阈值设置**、**媒体预览窗口后台下载**
- 设置模块：提示音、数据管理、设备管理、更新检查、**主题配置（独立窗口、毛玻璃效果、高级透明度层级、跨窗口同步）**
- 局域网传输模块：设备发现、文件发送/接收、大文件传输
- 会议/媒体模块
- **Linux 安装与更新**：deb 包安装、用户数据目录、APT 仓库配置、apt upgrade 更新
- **移动端 (Android)**：见下方移动端测试清单

## 📱 移动端测试清单

### 安装依赖

移动端开发需要配置 Android SDK 和 NDK，参考 [Tauri 移动端文档](https://v2.tauri.app/guides/prerequisites/#android)。

### 运行移动端开发

```bash
# 连接 Android 设备后
unset CI && pnpm tauri android dev
```

### 测试项目

#### 认证模块

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 登录 | 输入账号密码，成功登录进入主界面 | ✅ |
| 密码保存 | 登录后弹出指纹验证，保存密码 | ✅ |
| 快速登录 | 杀后台重开，指纹验证后直接进入主界面 | ✅ |
| 登出 | 侧边栏登出，清除会话数据 | ✅ |

#### 界面布局

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 状态栏适配 | 顶部内容不被状态栏遮挡 | ✅ |
| 底部安全区域 | 输入栏有底部安全区域 padding | ✅ |
| 消息列表滚动 | 消息可上下滚动 | ✅ |
| 消息滚动到底部 | 进入聊天页面自动滚动到最新消息 | ✅ |

#### 手势导航

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 聊天页面返回 | 手势返回回到消息列表 | 待测试 |
| 模态框关闭 | 手势返回关闭设置/个人资料模态框 | 待测试 |
| 抽屉关闭 | 手势返回关闭侧边抽屉 | 待测试 |
| 主页面退出 | 主页面手势返回退出应用 | 待测试 |

#### 消息提示音

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 通知权限请求 | 启动时弹出权限请求 | 待测试 |
| 提示音试听 | 设置页面试听功能正常 | 待测试 |
| 新消息提示音 | 收到新消息时播放提示音 | 待测试 |

#### 会话持久化

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 登录后保存 | 登录成功后会话自动保存 | 待测试 |
| 后台被杀恢复 | 杀后台后重新打开自动恢复登录 | 待测试 |
| 无需生物验证 | 恢复过程无指纹/面容弹窗 | 待测试 |
| Token 过期处理 | Token 过期时跳转登录页 | 待测试 |
| 主动登出清除 | 登出后清除保存的会话 | 待测试 |

#### 启动速度

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 无白屏等待 | 启动后快速显示界面 | 待测试 |
| 跳过 window-state | 移动端不调用桌面端窗口插件 | 待测试 |
| 并行加载 | 数据库初始化和 Token 验证并行 | 待测试 |

#### 个人资料页面

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 页面打开 | 点击头像进入个人资料页面 | 待测试 |
| 毛玻璃效果 | 背景使用与抽屉一致的毛玻璃 | 待测试 |
| 头像上传 | 可上传新头像 | 待测试 |
| 昵称修改 | 可编辑昵称 | 待测试 |
| 返回手势 | 手势返回可关闭页面 | 待测试 |

#### 我的文件页面

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 页面打开 | 点击"我的文件"进入文件页面 | 待测试 |
| 文件列表 | 显示用户上传的文件 | 待测试 |
| 分类筛选 | 可切换总览/图片/视频/文件 | 待测试 |
| 文件搜索 | 可搜索文件名 | 待测试 |
| 媒体预览 | 点击图片/视频可预览 | 待测试 |
| 返回手势 | 手势返回可关闭页面 | 待测试 |

#### 局域网互传页面

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 页面打开 | 点击"局域网互传"进入页面 | 待测试 |
| 服务启动 | 进入页面后服务自动启动 | 待测试 |
| 设备发现 | 显示局域网内其他设备 | 待测试 |
| 文件发送 | 点击发送可选择文件（使用 tauri-plugin-android-fs） | 待测试 |
| content:// URI 处理 | Android 文件选择后能正确读取并发送 | 待测试 |
| 传输请求 | 收到请求时显示确认弹窗 | 待测试 |
| 传输进度 | 显示实时传输进度 | 待测试 |
| 返回手势 | 手势返回可关闭页面 | 待测试 |

#### 会话功能

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 好友消息列表 | 显示好友会话卡片 | ✅ |
| 群聊消息列表 | 显示群聊会话卡片 | ✅ |
| 发送消息 | 发送文字消息，自动滚动到底部 | ✅ |
| 接收消息 | 接收消息，在底部时自动滚动 | ✅ |
| 加载历史消息 | 上滑到顶部加载更多历史 | ✅ |

#### 聊天文件上传

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 好友聊天上传图片 | 点击附件按钮 → 选择图片 → 成功上传发送 | 待测试 |
| 好友聊天上传视频 | 点击附件按钮 → 选择视频 → 成功上传发送 | 待测试 |
| 好友聊天上传文件 | 点击附件按钮 → 选择文件 → 成功上传发送 | 待测试 |
| 群聊上传图片 | 点击附件按钮 → 选择图片 → 成功上传发送 | 待测试 |
| 群聊上传视频 | 点击附件按钮 → 选择视频 → 成功上传发送 | 待测试 |
| 群聊上传文件 | 点击附件按钮 → 选择文件 → 成功上传发送 | 待测试 |
| Android content:// 处理 | Android 文件选择返回 content:// URI 能正确处理 | 待测试 |
| 上传进度显示 | 上传过程中显示进度条 | 待测试 |
| 秒传功能 | 已上传过的文件秒传成功 | 待测试 |

#### 会话持久化

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 首次登录保存 | 登录成功后弹出一次指纹验证保存会话 | ✅ |
| 杀后台恢复 | 杀后台后重开，指纹验证恢复会话 | ✅ |
| Token 过期处理 | Token 过期时提示重新登录 | ✅ |

#### 媒体预览

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 图片点击预览 | 点击图片弹出全屏模态框预览 | 待测试 |
| 视频点击预览 | 点击视频弹出全屏模态框播放 | 待测试 |
| 预览关闭 | 点击关闭按钮或背景关闭预览 | 待测试 |
| 预览返回手势 | 预览打开时返回手势关闭预览，不退出聊天页面 | 待测试 |
| 视频缩略图 | 视频显示第一帧作为缩略图 | 待测试 |
| 本地视频播放 | 已缓存视频使用本地 HTTP 服务器播放 | 待测试 |
| 视频进度拖动 | 本地视频支持进度条拖动 | 待测试 |
| 在线视频播放 | 未缓存视频使用 presigned URL 在线播放 | 待测试 |
| 视频后台缓存 | 在线播放时后台下载到本地 | 待测试 |

#### 输入交互

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 进入聊天页面 | 不自动聚焦输入框，不弹出键盘 | 待测试 |
| 点击输入框 | 手动聚焦后弹出键盘 | 待测试 |
| 按 Enter 发送消息 | 发送后输入框保持聚焦，可继续输入 | 待测试 |
| 点击发送按钮 | 发送后焦点返回输入框，可继续输入 | 待测试 |

#### 群聊消息

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 自己发送的消息 | 显示在右侧，使用蓝色气泡 | 待测试 |
| 他人发送的消息 | 显示在左侧，使用灰色气泡 | 待测试 |

#### 视频会议入口页面

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 页面打开 | 点击"视频会议"进入入口页面 | 待测试 |
| 创建会议 | 填写信息后创建会议，显示房间信息 | 待测试 |
| 复制房间信息 | 点击复制按钮复制房间号和密码 | 待测试 |
| 进入创建的会议 | 点击"进入会议"进入会议页面 | 待测试 |
| 加入会议 | 输入房间号和密码加入会议 | 待测试 |
| 粘贴解析 | 粘贴包含房间信息的文本自动解析 | 待测试 |
| 返回手势 | 手势返回可关闭页面 | 待测试 |

#### 视频会议页面

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 权限请求 | 进入页面时请求摄像头和麦克风权限 | 待测试 |
| 本地视频 | 显示本地摄像头画面 | 待测试 |
| 摄像头开关 | 可开启/关闭摄像头 | 待测试 |
| 麦克风开关 | 可开启/关闭麦克风 | 待测试 |
| 参与者列表 | 显示会议中的参与者 | 待测试 |
| 离开会议 | 点击离开按钮退出会议 | 待测试 |
| 返回手势 | 手势返回可关闭页面 | 待测试 |
| 屏幕共享 | 移动端不支持屏幕共享，按钮隐藏 | 待测试 |

#### Android 自动更新

| 测试项 | 预期结果 | 状态 |
|--------|----------|------|
| 版本检测 | 启动后自动检查 android-latest.json | 待测试 |
| 代理切换 | 多个代理依次尝试，失败自动切换 | 待测试 |
| 更新弹窗 | 有新版本时显示灵动岛风格弹窗 | 待测试 |
| 下载进度 | 显示下载进度、已下载大小、代理信息 | 待测试 |
| APK 安装 | 下载完成后调用系统安装器 | 待测试 |
| 权限请求 | 首次安装时请求"安装未知应用"权限 | 待测试 |
| 稍后按钮 | 点击稍后关闭弹窗 | 待测试 |
| 重试功能 | 下载失败后可重试 | 待测试 |

### 已知限制

| 功能 | 限制说明 | 替代方案 |
|------|----------|----------|
| 视频会议屏幕共享 | Android WebView 不支持 getDisplayMedia | 隐藏屏幕共享按钮 |
| 主题编辑器 | 使用 WebviewWindow，移动端不可用 | 无 |
| 媒体预览窗口 | 使用 WebviewWindow，移动端不可用 | ✅ 使用全屏模态框替代 |
| 视频缩略图 | video 元素 preload 在移动端不可靠 | ✅ 使用本地服务器 + video 元素显示第一帧 |
| asset:// 视频 | Android WebView 不支持 asset:// 播放视频 | ✅ 使用本地 HTTP 服务器替代 |
| 桌面端更新器 | tauri-plugin-updater 不支持 Android | ✅ 使用自定义服务 + tauri-plugin-android-package-install |

### 更新日志

- 2026-02-04: 修复接收方点击取消无反应问题
  - **问题 1**: 接收方点击取消按钮没有反应
    - **原因**: `cancel_file_transfer` 只查找发送方会话，不检查接收方的上传会话
    - **解决方案**: 
      - 新增 `cancel_receiver_file` 公共函数处理接收方取消逻辑
      - `cancel_file_transfer` 现在同时检查发送方和接收方会话
    - **修改文件**: `src-tauri/src/lan_transfer/transfer.rs`, `src-tauri/src/lan_transfer/server.rs`
  - **问题 2**: 发送方取消两个文件，接收方只显示一个已跳过
    - **原因**: `handle_cancel` 没有持久化保存文件的取消状态，每次重新计算时丢失
    - **解决方案**: 
      - `UploadSession` 添加 `cancelled_files: HashSet<String>` 字段
      - 取消时将文件 ID 添加到 `cancelled_files`
      - 构建 `files_progress` 时优先检查 `cancelled_files`
    - **修改文件**: `src-tauri/src/lan_transfer/server.rs`

- 2026-02-04: 修复单文件取消后 UI 不消失问题
  - **问题 1**: 取消单个文件传输后，文件 UI 未消失
    - **原因**: `cancel_file_transfer` 只发送 `TransferFailed` 事件，未更新会话中的文件状态，也未发送 `BatchProgress` 事件
    - **解决方案**: 
      - 更新文件状态为 `Cancelled`
      - 发送 `BatchProgress` 事件包含更新后的文件列表
    - **修改文件**: `src-tauri/src/lan_transfer/transfer.rs`
  - **问题 2**: 发送方取消文件后，接收方 UI 不同步
    - **原因**: 发送方取消时不会通知接收方
    - **解决方案**: 
      - 发送方取消时向接收方发送 `/api/cancel` 请求
      - 接收方 `handle_cancel` 发送 `BatchProgress` 事件更新 UI
    - **修改文件**: `src-tauri/src/lan_transfer/transfer.rs`, `src-tauri/src/lan_transfer/server.rs`

- 2026-02-04: 修复多文件传输 UI 显示问题
  - **问题 1**: 手机端多文件传输只显示 "0/2"，无法单独取消文件
    - **解决方案**: 添加文件列表显示和单文件取消按钮
    - **修改文件**: `src/pages/mobile/MobileLanTransferPage.tsx`, `src/styles/mobile/lan-transfer-page.css`
  - **问题 2**: 桌面端拖动传输导致接收方显示约 3 倍 UI
    - **原因**: 多个 `InlineTransferPanel` 组件都设置了 Tauri 窗口级别的拖放监听器，导致同一个拖放事件触发多次
    - **解决方案**: 
      - 使用全局状态管理器 `globalDragDropState` 确保只注册一次 Tauri 拖放事件
      - 只有当前活跃的面板处理拖放事件
      - 使用自定义 DOM 事件 `lan-drag-enter`/`lan-drag-leave` 同步多个面板的拖放状态
    - **修改文件**: `src/lanTransfer/LanTransferPage.tsx`
  - **问题 3**: `handle_prepare_upload` 在会话已存在时仍发送初始进度事件
    - **解决方案**: 只在新建会话时发送初始进度事件
    - **修改文件**: `src-tauri/src/lan_transfer/server.rs`

- 2026-02-04: 修复多文件传输只接收一个文件的问题
  - **问题**: 选择多个文件传输时，接收端只收到最后一个文件
  - **原因**: `handle_prepare_upload` 每次创建新会话并覆盖旧会话，导致只有最后一个文件的会话存在
  - **解决方案**:
    - 新增 `/api/batch-prepare` 端点，发送端先通知接收端所有文件列表
    - 修改 `handle_prepare_upload` 检查会话是否存在，存在则添加文件而非覆盖
    - 修改发送端调用 `batch-prepare` 预创建会话
    - 修改进度事件包含完整文件列表和正确的 total_files
  - **新增类型**:
    - `BatchPrepareRequest`: 批量传输准备请求
    - `BatchPrepareResponse`: 批量传输准备响应
  - **修改文件**:
    - `src-tauri/src/lan_transfer/protocol.rs`: 新增批量准备类型
    - `src-tauri/src/lan_transfer/server.rs`: 新增 `/api/batch-prepare` 端点，修改会话管理逻辑
    - `src-tauri/src/lan_transfer/transfer.rs`: 发送端调用 batch-prepare
    - `tests/unit/lanTransfer.test.ts`: 新增 6 个多文件传输测试用例（总计 382 个用例）

- 2026-02-04: 修复桌面端发送文件时单文件进度不显示的问题
  - **问题**: 发送文件时，文件列表中单个文件显示 "0 B / xxx MB"，但总进度正常更新
  - **原因**: `emit_batch_progress` 读取 session 的 `FileTransferState.transferred_bytes`，但该值仅在文件传输完成时更新
  - **解决方案**: 在传输进度更新时同步更新 session 的文件状态
  - **修改文件**: `src-tauri/src/lan_transfer/transfer.rs` - 添加会话文件状态实时更新

- 2026-02-04: 桌面端已连接设备样式与移动端统一
  - **修改**: `.lan-device-card.connected` 只保留绿色边框，移除绿色背景填充
  - **修改**: `.lan-connected-badge` 改为透明绿色背景 + 绿色文字
  - **修改**: `.lan-inline-transfer-panel` 边框改为绿色与设备卡片一致
  - **修改文件**: `src/lanTransfer/styles.css`

- 2026-02-04: 移除旧版传输请求模式，统一使用点对点连接
  - **移除功能**: 旧版 transfer-request/transfer-response 传输机制
  - **统一模式**: 桌面端和移动端都需先建立点对点连接才能传输文件
  - **后端清理**:
    - 移除 `send_transfer_request`、`respond_to_transfer_request` 函数
    - 移除 `/api/transfer-request`、`/api/transfer-response` 端点
    - 移除 `TransferRequest`、`TransferRequestStatus` 类型
    - 移除 `PENDING_TRANSFER_REQUESTS` 存储
  - **前端清理**:
    - 移除 `sendTransferRequest`、`respondToTransferRequest` 函数
    - 移除 `TransferRequest` 类型和 `pendingTransferRequests` 状态
    - 移除 `TransferRequestCard` 组件
    - 移动端发送文件前必须先建立连接
  - **修改文件**:
    - `src-tauri/src/lan_transfer/transfer.rs`: 移除旧版传输逻辑
    - `src-tauri/src/lan_transfer/server.rs`: 移除旧版 API 端点
    - `src-tauri/src/lan_transfer/protocol.rs`: 移除旧版类型定义
    - `src-tauri/src/lan_transfer/mod.rs`: 移除旧版命令
    - `src/hooks/useLanTransfer.ts`: 移除旧版函数和状态
    - `src/lanTransfer/LanTransferPage.tsx`: 移除 TransferRequestCard
    - `src/pages/mobile/MobileLanTransferPage.tsx`: 移除旧版传输回退逻辑

- 2026-02-03: 桌面端局域网传输 UI 重构
  - **新 UI**: 传输面板从弹窗改为设备卡片内联展开
  - **文件列表**: 显示每个文件的传输进度和状态
  - **单文件取消**: 支持跳过单个文件而不影响其他文件
  - **移除组件**: PeerTransferWindow 弹窗、BatchProgressCard 顶部进度条
  - **新增组件**: InlineTransferPanel（内联传输面板）、DeviceCard 展开状态
  - **修改文件**:
    - `src/lanTransfer/LanTransferPage.tsx`: 重构 DeviceCard、添加 InlineTransferPanel
    - `src/lanTransfer/styles.css`: 添加内联面板和文件列表样式
    - `src/hooks/useLanTransfer.ts`: 添加 FileProgressInfo、TransferStatus 类型

- 2026-02-03: 修复发送端传输速度显示为 0 的问题
  - **问题**: emit_batch_progress() 中 speed 硬编码为 0
  - **原因**: ParallelProgress 结构体缺少 start_time 字段
  - **解决方案**: 添加 start_time，计算 speed = transferred_bytes / elapsed
  - **修改文件**:
    - `src-tauri/src/lan_transfer/transfer.rs`: 添加速度计算
    - `src-tauri/src/lan_transfer/protocol.rs`: 添加 FileProgressInfo 结构体
    - `src-tauri/src/lan_transfer/server.rs`: 更新 BatchTransferProgress 初始化

- 2026-01-22: 添加移动端会话持久化（生物识别 + keystore）
- 2026-01-22: 修复状态栏/底部安全区域适配
- 2026-01-22: 修复消息列表滚动到底部问题
- 2026-01-22: 添加移动端媒体全屏预览模态框
- 2026-01-22: 修复群聊消息气泡位置/颜色问题
- 2026-01-22: 禁用移动端输入框自动聚焦
- 2026-01-23: 添加移动端本地视频 HTTP 服务器（解决 asset:// 视频播放问题）
- 2026-01-23: 移动端视频缩略图改用 video 元素显示第一帧
- 2026-01-23: 添加移动端手势返回处理（tauri-plugin-mobile-onbackpressed-listener）
- 2026-01-23: 添加 Android 设备信息获取（使用 UUID 替代 MAC 地址）
- 2026-01-23: 移动端提示音播放改用本地 HTTP 服务器
- 2026-01-23: 移动端会话持久化改用 tauri-plugin-store（无需生物验证）
- 2026-01-23: 移动端启动速度优化
- 2026-01-23: 移动端个人资料和我的文件独立页面
- 2026-01-23: 移动端设置页面独立化、滑动切换、局域网互传页面
- 2026-01-23: 添加 tauri-plugin-android-fs 解决 Android content:// URI 文件读取问题
- 2026-01-23: 添加移动端视频会议入口页面和会议页面（使用 WebRTC，不支持屏幕共享）
- 2026-01-23: 添加 Android 自动更新功能（tauri-plugin-android-package-install）
  - 检测 android-latest.json 获取版本信息
- 2026-01-23: 修复 Android 聊天文件上传（好友/群聊）
  - FileAttachButton 添加 Android 平台检测
  - 使用 tauri-plugin-android-fs 处理 content:// URI
  - 与局域网传输共用 selectFilesForTransfer 函数
  - 多代理自动切换下载
  - 灵动岛风格更新弹窗（与桌面端 UI 一致）
  - APK 下载完成后调用系统安装器
- 2026-01-23: 优化聊天输入框聚焦行为
  - 点击发送按钮后焦点自动返回输入框，无需重新点击
- 2026-01-23: 移动端媒体预览返回手势优化
  - 预览打开时返回手势关闭预览，不退出聊天页面
  - 使用 useMobileBackHandler 拦截返回事件
- 2026-01-23: 优化更新弹窗防抖与多实例问题
  - 引入全局 Zustand Store 统一管理更新状态
  - App.tsx 统一渲染 UpdateToast，防止多实例
  - 自动检查和手动检查更新均通过全局 Store 进行，避免并发
- 2026-01-23: 移动端下载进度卡片嵌入消息列表
  - 下载状态时在消息列表顶部显示进度卡片
  - 与消息卡片同级，不遮挡操作，可被侧边栏遮挡
- 2026-01-23: 统一消息卡片毛玻璃样式
  - 桌面端和手机端消息卡片统一使用毛玻璃效果
  - 使用主题变量（--white-alpha-*、--blur-xs）接入设置颜色管理
  - 圆角、边框、阴影样式统一
- 2026-01-23: 桌面端选中边框改用蓝色线条
  - 移除选中背景渐变，使用透明背景 + 蓝色边框
  - 边框在卡片外围显示，圆角完美契合
- 2026-01-23: 消息右键菜单添加复制功能
  - 桌面端右键/移动端长按触发菜单
  - 文本消息显示"复制"选项
  - 私聊和群聊消息气泡统一支持
- 2026-01-23: 消息卡片透明度接入主题管理
  - 添加 --card-bg-* 系列变量
  - 透明度与更新弹窗一致（约 10-15%）
- 2026-01-23: 移动端双击全屏消息预览
  - 双击文本消息显示全屏预览
  - 毛玻璃背景，大字体易读
  - 底部复制按钮，返回手势关闭
  - 仅移动端生效，私聊和群聊统一支持
- 2026-01-23: 移动端会议悬浮图标功能
  - 会议进行中可最小化为圆形悬浮图标
  - 绿色脉冲指示器表示会议进行中
  - 可拖拽移动位置，点击恢复全屏
  - 长按显示操作菜单（返回会议/结束会议）
  - 最小化后可继续查看消息、聊天等页面
  - WebRTC 连接在 MobileMain 层级维护，最小化时保持连接
  - 悬浮图标显示参与者数量徽章
- 2026-01-24: 桌面端会议视频窗口布局修复
  - 使用 CSS Grid 替代 Flexbox 布局
  - 所有参与者视频窗口大小一致
  - 自适应列数，最大宽度 600px（单人时 900px）
- 2026-01-24: 移动端消息长按菜单优化
  - 菜单显示在气泡上方（微信风格）
  - 水平排列的菜单项
  - 新增"选取"选项（移动端专属）
  - 点击"选取"打开全屏预览页面，可自由选择文字复制
  - 触摸其他地方自动关闭菜单（菜单互斥）
- 2026-01-24: 移动端局域网链接按钮样式统一
  - 圆形蓝底白字样式与桌面端一致
- 2026-01-24: Windows NSIS 安装器更新流程优化
  - 精确终止 WebView2 子进程（使用 WMIC/PowerShell）
  - 更新前运行旧版卸载程序（静默模式）
  - 解决文件被占用导致更新失败的问题
  - 保持安装路径一致
- 2026-01-24: 局域网传输连接去重机制
  - 前端：requestPeerConnection 调用前检查 activeConnections
  - 后端：request_peer_connection 和 server 端都有去重检查
  - 已存在连接时返回现有 connectionId，防止重复连接
  - 已存在待处理请求时返回现有请求 ID，防止重复请求
- 2026-01-24: 局域网传输断开连接功能
  - 桌面端和移动端设备卡片添加断开连接按钮
  - 已连接设备显示：发送文件按钮 + 断开连接按钮
  - 应用退出/服务停止时自动断开所有活跃连接
  - 清空待处理的连接请求
- 2026-01-24: 局域网传输连接流程重构
  - 发起方不再预先保存连接（只在收到接受响应后才创建连接）
  - 拒绝后发送 PeerConnectionClosed 事件通知前端
  - 修复拒绝后无法重新申请连接的问题
  - 修复发起连接时对方没有收到请求提示的问题
  - 连接建立后自动清理来自该设备的待处理请求（解决互相请求时的重复显示问题）
- 2026-01-24: 桌面端局域网传输 UI 优化
  - 删除独立的"已建立的连接"模块
  - 已连接状态通过设备卡片上的绿色按钮+断开连接按钮显示
  - 与移动端逻辑保持一致
- 2026-01-24: mDNS 设备下线检测机制修复
  - 修复 fullname 格式不匹配问题：mDNS instance_name 限制为 15 字符，device_id 为 32 字符 UUID
  - 添加 fullname 到 device_id 的映射表，正确处理 ServiceRemoved 事件
  - 添加验证失败计数器，连续失败 3 次后主动移除设备
  - 验证任务使用正确的 fullname 进行 mDNS verify() 调用
  - 设备发现时保存映射，离线时清理映射和计数器
- 2026-01-24: 移动端消息气泡宽度优化（微信风格）
  - 移动端 max-width 从 70% 扩展到 calc(100% - 52px)
  - 消息可延伸到对侧，只保留一个头像位置的距离
  - 桌面端保持原有 70% 宽度不变
- 2026-01-24: Windows 安装类型检测（MSI/NSIS 更新包区分）
  - 后端添加 get_windows_installer_type 命令，通过注册表检测安装类型
  - 前端 checkForUpdates 根据安装类型自动选择正确的更新包
  - MSI 安装用户使用 target: "windows-x86_64-msi"
  - NSIS 安装用户使用默认 target
  - 参考文档: https://v2.tauri.app/plugin/updater/#custom-target
  - 解决 MSI 安装用户被更新成 EXE 包的问题
- 2026-01-24: 前端代码优化（重复代码提取）
  - 创建 `src/utils/format.ts` 统一格式化函数（formatSize/formatSpeed/formatEta）
  - 替换 LanTransferPage、MobileLanTransferPage、update/service 中的重复实现
  - 创建 `src/chat/shared/animations.ts` 统一消息动画配置
  - 创建 `src/chat/shared/SendStatusIndicator.tsx` 发送状态指示器组件
  - 减少约 200 行重复代码，提高可维护性
  - 参考文档: Vite tree-shaking、Atlassian barrel files 研究
- 2026-01-25: 局域网传输哈希算法从 SHA-256 迁移到 CRC32fast
  - 性能提升: ~7.3 GB/s（比 SHA-256 快约 14 倍）
  - TB 级文件传输预处理时间大幅缩短
  - 跨平台支持: Android AOSP 官方认证、Windows、macOS、Linux、iOS
  - 流式处理: 无需将整个文件读入内存
  - 协议字段名保持不变（sha256）以兼容现有版本
  - 参考文档: https://docs.rs/crc32fast/, https://android.googlesource.com/platform/external/rust/crates/crc32fast/
- 2026-01-25: 添加大文件哈希计算进度反馈
  - 新增 HashingProgress 事件类型（后端 + 前端）
  - 每处理 100MB 数据发送一次进度更新
  - UI 显示橙色脉冲进度条，区分于蓝色传输进度条
  - 显示当前文件名、处理进度、文件数量
- 2026-01-25: 重构批量传输为并行传输
  - 多文件同时传输（默认并行度 3）
  - 使用 Semaphore 限制并发数，避免带宽竞争
  - 每个文件独立的 CancellationToken，支持单文件取消
  - 一个文件失败不影响其他文件继续传输
  - 使用原子操作（AtomicU64/AtomicU32）更新全局进度
  - 新增 cancel_file_transfer 命令（后端 + 前端）
  - 移动端添加取消按钮（单文件取消 + 批量取消）
  - 新增依赖: tokio-util（CancellationToken）, futures（join_all）
- 2026-01-25: 修复局域网传输多项问题
  - 修复设备 IP 地址不更新问题：设备重新上线时发送 DeviceDiscovered 事件通知前端
  - 修复批量进度不更新问题：并行传输中同步发送 BatchProgress 事件
  - 修复会话取消不生效问题：取消时正确触发所有文件的 CancellationToken
- 2026-01-25: 连接请求失败自动重试机制
  - 如果连接请求 HTTP 失败（超时/拒绝），自动刷新设备信息
  - 等待 1.5 秒让 mDNS 事件处理后，使用最新 IP 重试一次
  - 解决设备重启服务后短时间内连接失败的问题
  - 新增 refresh_device() 函数支持按需刷新单个设备信息
  - 刷新机制改为重启 mDNS browse（verify 仅验证存在性，无法获取新 IP）
- 2026-01-25: 添加详细的局域网传输调试日志
  - mDNS 服务注册：输出服务类型、实例名称、主机名、端口、IP
  - 设备发现：输出 ServiceResolved 事件详情、属性、地址列表
  - 连接请求：输出本机/目标设备 IP、当前设备列表、HTTP 请求详情
  - 连接响应：输出待处理请求列表、响应发送详情、耗时统计
  - HTTP 服务器：输出收到的 TCP 连接来源地址
- 2026-01-25: 传输期间暂停设备验证
  - 后端添加 HAS_ACTIVE_TRANSFERS 标志位
  - 批量传输开始时设置标志，结束时清除
  - 设备验证任务检测到活跃传输时跳过验证
  - 避免高负载传输时 mDNS 响应慢导致误判设备离线
- 2026-01-25: 支持多个并行传输会话
  - 前端 batchProgressMap 替代单一 batchProgress
  - 移除旧的兼容代码，统一使用 batchProgressMap
  - 移动端和桌面端 UI 支持显示多个批量传输进度卡片
  - 每个传输会话卡片增加单独的取消按钮
  - 传输途中添加新文件会创建独立的传输会话并单独显示
- 2026-01-25: 修复取消传输后进度条仍然显示的问题
  - emit_batch_progress 函数在发送事件前检查会话状态
  - 如果会话已取消（SessionStatus::Cancelled），不发送进度事件
  - 避免取消后残留的进度事件覆盖 BatchTransferCompleted 事件
- 2026-01-25: 统一传输进度 UI
  - 移除单文件传输进度 UI（TransferProgressCard）
  - 统一使用批量传输进度 UI（BatchProgressCard/batchProgressMap）
  - 桌面端和移动端保持一致
- 2026-01-25: 修复拖放传输时出现重复批量传输 UI 的问题
  - 问题原因：useEffect 依赖项变化导致事件监听器未正确清理
  - 解决方案：使用 useRef 保存回调引用，空依赖数组确保只设置一次监听器
  - 使用 async/await 替代 then，确保清理时监听器已就绪
- 2026-01-25: Windows 安装包切换到 MSI perUser 模式
  - 移除 NSIS 安装包，只构建 MSI
  - MSI 使用 perUser 安装模式，无需管理员权限
  - 安装到 `%LocalAppData%\Programs\` 而非 `C:\Program Files`
  - 利用 Windows Restart Manager 处理运行中程序更新
  - 深度链接协议注册改用 HKCU（用户级）
  - 创建自定义 WiX 模板 `src-tauri/wix/main.wxs`
  - 解决 NSIS 更新时"文件无法写入"的问题
  - 参考文档: https://wixtoolset.org/docs/v3/xsd/wix/package (InstallScope)
  - 参考文档: https://learn.microsoft.com/en-us/windows/win32/msi/installation-context
- 2026-01-25: 登录后消息同步进度 UI
  - 新增 SyncStatusBanner 组件，显示消息同步进度
  - 桌面端：消息列表（UnifiedList）搜索框下方显示
  - 移动端：消息列表（MobileChatList）下载卡片下方显示
  - 同步中：显示旋转图标 + "正在同步消息... (X/Y)"
  - 同步完成：显示成功图标 + "已同步 X 条新消息"（1.5 秒后淡出）
  - 同步失败：显示错误图标 + "同步失败，点击重试"（可点击重试）
  - 6 个测试用例（tests/components/SyncStatusBanner.test.tsx）
  - 2 个功能检查项（tests/checklist.ts）
- 2026-01-27: 移动端 WebSocket 连接状态指示器
  - MobileHeader 头像右下角添加连接状态圆点
  - 🟢 绿色：已连接（WebSocket connected: true）
  - 🟡 黄色：连接中（WebSocket connecting: true，带脉冲动画）
  - 🔴 红色：断开连接（WebSocket disconnected）
  - 添加 MOBILE_COMPONENTS 分类到测试注册表
  - 测试用例增加至 129 个
- 2026-01-27: 桌面端 WebSocket 连接状态指示器
  - Sidebar 头像右下角添加连接状态圆点（与移动端一致）
  - 🟢 绿色：已连接，🟡 黄色：连接中（脉冲动画），🔴 红色：断开
  - 原静态绿点改为动态状态指示器
- 2026-01-27: 断开重连后自动消息增量同步
  - WebSocketContext 添加 onReconnected 事件回调
  - 首次连接不触发，断线重连成功后触发
  - useInitialSync 订阅 onReconnected 事件
  - 重连后执行与登录一致的全列表消息增量更新
  - 适用于桌面端和移动端
- 2026-01-28: 会话列表面板响应式布局修复
  - 添加 min-width: 84px 最小宽度约束，确保搜索框/头像可见
  - 使用 CSS Container Query 实现响应式布局
  - 极窄宽度（<120px）时隐藏会话信息，只显示头像
  - 搜索框和卡片在极窄宽度时自动居中对齐
  - 修复搜索按钮与下方头像对齐问题
- 2026-02-02: 低代码编辑器功能增强
  - **MathJax 公式支持**：节点和属性面板支持 LaTeX 公式渲染
    - 新增 `MathFormula` 组件（`src/lowcode/components/MathFormula.tsx`）
    - 使用 `better-react-mathjax` 库，支持行内和块级公式
    - 节点显示算子的 `latex_formula` 属性
    - 属性面板显示端口的 `latex_name` 和 `description`
  - **DAG 自动布局优化**：使用动态节点尺寸实现精确布局
    - 修改 `layout.ts`：支持 `nodeSizes` 参数接收实际测量的节点尺寸
    - 新增 `getNodeSizesFromInternals()` 工具函数
    - 添加 `align`（对齐方式）和 `ranker`（层级算法）配置项
    - `FlowCanvas` 组件：使用 `useNodesInitialized` 等待节点渲染完成
    - 通过 `getInternalNode` API 获取节点实际测量尺寸
    - 布局完成后自动执行 `fitView` 调整视口
    - 解决节点尺寸不匹配导致的对角线布局问题
    - **自动布局触发**：模板加载、工作流加载、版本回滚后自动执行布局
  - **多节点类型支持**：三种节点视觉样式
    - `operator`：运算符（圆角矩形）
    - `formula`：公式（矩形，默认）
    - `equation_network`：方程网络（菱形边框）
    - 节点根据 `operator_type` 自动选择样式
  - 新增依赖：`better-react-mathjax`、`dagre`、`@types/dagre`
  - 测试用例更新：注册表测试增加 8 个模块导入（总计 353 个用例）
- 2026-02-02: 低代码编辑器功能完善（第二阶段）
  - **论文引用显示**：属性面板支持显示端口的 `paper_ref` 论文引用说明
    - 更新 `OperatorInput` 类型定义添加 `paper_ref`、`latex_name`、`default_value` 字段
    - 更新 `Operator` 类型定义添加 `operator_type`、`latex_formula` 字段
    - 属性面板端口信息区域显示论文引用（带 📄 图标和左侧蓝色边框）
  - **配置文件导入**：支持从 JSON 文件导入流程配置
    - 新增 `ImportConfigDialog` 组件（`src/lowcode/components/ImportConfigDialog.tsx`）
    - 工具栏添加"导入"按钮
    - 支持选择文件、预览配置信息、验证配置、导入并自动布局
    - 导入后自动加载流程到画布
  - **分类验证结果完整显示**：CategoryConfigDialog 显示完整验证信息
    - 显示错误列表（红色）
    - 显示警告列表（黄色）
    - 显示缺失的算子列表
    - 显示重复的算子列表
  - **算子详情弹窗**：双击算子卡片查看完整信息
    - 新增 `OperatorDetailDialog` 组件（`src/lowcode/components/OperatorDetailDialog.tsx`）
    - 显示基本信息、LaTeX 公式、输入/输出端口详情
    - 端口详情包含 latex_name、paper_ref、default_value
  - **执行结果导出**：ExecuteDialog 支持导出执行结果为 JSON
    - 执行状态栏添加"导出"按钮
    - 导出内容包含执行 ID、状态、输出、追踪信息、导出时间
  - **流程配置导出**：工具栏"导出"按钮下载 JSON 配置文件
  - 测试用例更新：lowcode.test.ts 新增 5 个类型测试（总计 358 个用例）
- 2026-02-02: 低代码编辑器功能完善（第三阶段）
  - **临时执行功能**：工具栏添加"临时执行"按钮
    - 无需保存流程即可直接执行当前画布配置
    - 复用 ExecuteDialog 组件
    - 调用 `workflowService.executeConfig` API
  - **并行执行选项**：ExecuteDialog 添加执行选项配置
    - 新增"启用执行追踪"复选框
    - 新增"启用并行执行"复选框
    - 执行时传递 `ExecuteOptions` 参数
  - **迭代执行结果展示**：ExecutionResult 显示迭代信息
    - 新增 `IterationInfoView` 组件
    - 显示总迭代次数、终止原因、终止索引
    - 显示累加器最终值（以标签形式展示）
  - **控制流配置**：新增 `ControlFlowDialog` 组件
    - 执行模式选择（单次执行/迭代执行）
    - 时间序列输入配置
    - 累加器配置表格（名称、源节点、端口、操作类型、初始值）
    - 状态变量配置表格（名称、源节点、端口、初始值、滞后步数）
    - 终止条件配置（固定次数/累加器阈值/耗尽输入/自定义表达式）
    - 工具栏添加"控制流"按钮
  - **条件分支配置**：新增 `EdgeConditionEditor` 组件
    - 可视化条件表达式构建器
    - 值引用选择器（字面量/节点输出/累加器/状态变量/迭代索引/工作流输入）
    - 支持比较条件、AND/OR 逻辑、NOT 取反、常量值
    - 嵌套条件支持（可视化层级缩进）
  - **错误处理配置**：新增 `ErrorHandlingDialog` 组件
    - 全局重试策略配置（最大次数、延迟、退避乘数、最大延迟）
    - 失败时继续执行选项
    - 节点级错误处理配置表格（节点选择、忽略错误、启用重试、备用节点）
  - **Mermaid 预览**：新增 `MermaidPreview` 组件
    - 自动从画布节点和边生成 Mermaid 流程图代码
    - 使用 `mermaid` 库实时渲染 SVG
    - 支持全屏预览、刷新、复制代码
    - 可展开查看 Mermaid 源代码
    - 工具栏添加"预览"按钮
    - 新增依赖：`mermaid@11.12.2`
  - **类型定义增强**：新增 16 个类型
    - `ExecutionMode`、`AccumulatorOperation`、`AccumulatorConfig`
    - `StateVarConfig`、`TerminationConditionType`、`TerminationConditionExpr`、`TerminationCondition`
    - `IterationConfig`、`ValueRefType`、`ValueRef`
    - `ConditionExprType`、`ConditionExpr`、`ConditionalEdge`
    - `RetryConfig`、`NodeErrorHandler`、`ErrorHandlingConfig`
    - `ControlFlowConfig`、`VisualizationConfig`
    - `IterationInfo`、`ExecuteOptions`
  - **TerminationCondition 结构修正**：
    - 嵌套 `condition` 对象匹配后端格式
    - 使用 `name` 替代 `accumulator_name` 匹配后端字段名
  - **control_flow 配置保存/加载修复**：
    - `serializeToWorkflow` 新增 `SerializeOptions` 参数支持 `controlFlow`, `defaultInputs`, `visualization`
    - `handleSave` 保存时包含 `controlFlowConfig`
    - 加载流程/模板/回滚/导入时恢复 `control_flow` 配置
  - **迭代模式时间序列输入支持**：
    - 执行对话框自动包含 `control_flow.iteration.time_series_inputs` 中定义的输入
    - `InputDefinition` 类型更新为支持可选 `bind_to`（时间序列输入不绑定到特定节点）
  - **其他修复**：
    - `OutputBindFrom` 验证逻辑支持累加器绑定
    - 测试用例更新以匹配 `TerminationCondition` 嵌套结构

- **第五阶段：控制流状态管理重构**
  - **flowStore 集成 controlFlowConfig**：
    - `controlFlowConfig` 从 LowcodePage 本地状态移入 Zustand store
    - 新增 `setControlFlowConfig` action
    - `loadWorkflow` 增加 `controlFlow` 参数，一次性加载完整状态
    - `resetWorkflow` 和 `clearCanvas` 自动清除 controlFlowConfig
  - **ControlFlowDialog 状态同步**：
    - 添加 `useEffect` 监听 `config` prop 变化
    - 切换模板/流程时自动更新对话框内部状态
  - **ExecuteDialog 执行模式显示**：
    - 新增执行模式指示器（单次/迭代）
    - 显示时间序列输入列表
    - 新增 `executionMode` 和 `timeSeriesInputs` props

- **第六阶段：代码复用优化**
  - **统一图标组件** (`components/icons.tsx`)：
    - 集中管理 30+ 个 SVG 图标组件
    - 使用 `memo` 优化渲染性能
    - 消除 10+ 个文件中的重复图标定义
  - **通用表单工具** (`utils/formUtils.ts`)：
    - `getDefaultValue()` - 根据数据类型获取默认值
    - `parseValue()` - 解析字符串输入为目标类型
    - `formatValue()` - 格式化值为显示字符串
    - 类型判断函数：`isNumberType`, `isBooleanType`, `isArrayType`, `isObjectType`, `isJsonType`
  - **重构组件**：
    - `ExecuteDialog` - 使用公共图标和表单工具
    - `BatchExecuteDialog` - 复用 `InputDefinition` 类型和工具函数
    - `ControlFlowDialog` - 使用公共图标

- 2026-02-02: 低代码编辑器功能完善（第四阶段）
  - **类型定义增强**：匹配后端文档增强字段
    - `WorkflowInput` 新增：`type`, `required`, `description`, `default`, `latex_name`, `paper_ref`
    - `WorkflowOutput` 新增：`type`, `description`, `source_type`, `latex_name`
    - `WorkflowNode` 新增：`type`, `latex_formula`, `input_params`, `output_params`
    - 新增 `NodeInputParam` 和 `NodeOutputParam` 类型
    - 新增 `AccumulatorReference`、`OutputSourceType`、`OutputBindFrom` 类型
  - **WorkflowOutput 来源支持两种格式**：
    - 节点端口来源：`{ node, port }`
    - 累加器来源：`{ accumulator }`（迭代执行模式）
  - **序列化工具增强**：
    - `InputBinding` 和 `OutputBinding` 接口新增增强字段
    - `serializeInputBindings` 和 `deserializeInputBindings` 保留新字段
    - `serializeOutputBindings` 和 `deserializeOutputBindings` 保留所有增强字段
    - `serializeNode` 保留 `type` 和 `latex_formula`
    - 支持节点端口和累加器两种输出来源格式
  - **ExecuteDialog 增强**：
    - 支持使用 `latex_name` + MathFormula 渲染参数标签
    - 支持显示 `paper_ref` 论文引用提示
    - 更新 `InputDefinition` 接口
  - **PropertyPanel 增强**：
    - 端口信息区域显示 `default_value` 默认值
  - **LowcodePage 更新**：
    - `executeInputs` 构建时传递 `latex_name`, `paper_ref`, `default_value`
  - 测试用例更新：lowcode.test.ts 新增 9 个类型测试（总计 376 个用例）

- 2026-02-03: 修复 Android VPN 导致局域网传输设备发现失败
  - **问题**：当 Android 设备开启 VPN 时，mDNS 服务注册在 VPN 接口（tun0: 172.19.0.1）
    而非 WiFi 接口（wlan0: 192.168.110.206），导致其他设备无法发现移动端
  - **原因**：`local_ip_address::local_ip()` 默认返回第一个非回环 IP，可能选中 VPN 接口
  - **解决方案**：优化网络接口选择逻辑
    - 优先选择 WiFi 接口（wlan0, en0, Wi-Fi）
    - 排除 VPN/隧道接口（tun0, utun0, tap, ppp）
    - 排除移动数据接口（rmnet, r_rmnet）
    - 排除虚拟接口（ifb, dummy）
    - 排除链路本地地址（169.254.x.x）
  - **修改文件**：`src-tauri/src/lan_transfer/discovery.rs`
  - **官方文档参考**：
    - [Android NsdManager](https://developer.android.com/reference/android/net/nsd/NsdManager): mDNS 仅限本地多播网络
    - [WifiManager.MulticastLock](https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock): Android 默认过滤多播包

- 2026-02-03: Android 局域网传输文件准备动画
  - **功能**：Android 选择文件后显示"正在准备文件..."加载动画
  - **原因**：Android content:// URI 需要复制到缓存目录才能被 Rust 读取，大文件复制耗时长
  - **实现**：
    - `androidFileHandler.ts`: 添加 `FilePreparationStatus` 接口和 `onStatusChange` 回调
    - `MobileLanTransferPage.tsx`: 添加文件准备状态和遮罩层 UI
    - `lan-transfer-page.css`: 添加 `.file-preparation-overlay` 样式
  - **UI 效果**：毛玻璃遮罩 + 旋转加载图标 + 文件名 + 进度计数
  - **隔离性**：仅在 Android 平台且处于 preparing 阶段时显示

```typescript
import { FEATURE_CHECKLIST, getCriticalFeatures } from './checklist';

// 获取所有核心功能
const criticalFeatures = getCriticalFeatures();
console.log(`核心功能: ${criticalFeatures.length} 项`);
```

## 覆盖率目标

| 指标 | 最低要求 |
|------|---------|
| Statements | 30% |
| Branches | 30% |
| Functions | 30% |
| Lines | 30% |

随着测试完善，建议逐步提高覆盖率阈值。

## 预发布检查流程

1. 运行自动化检查：
   ```bash
   pnpm check
   ```

2. 运行预发布检查脚本（包含人工确认）：
   ```bash
   powershell -ExecutionPolicy Bypass -File .\scripts\pre-release.ps1
   ```

3. 确认所有检查通过后，执行发布：
   ```bash
   powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1
   ```

