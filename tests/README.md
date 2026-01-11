# 测试框架说明

## 概述

Huanvae Chat App 使用 Vitest 作为测试框架，配合 Testing Library 进行 React 组件测试。

## 目录结构

```
tests/
├── setup.ts                     # 全局测试设置（Mock Tauri API）
├── checklist.ts                 # 功能检查清单定义
├── registry.ts                  # 组件注册表（103 个模块，含 windowSize 服务）
├── README.md                    # 本文档
├── utils/
│   └── test-utils.tsx           # 测试工具函数
├── unit/                        # 单元测试
│   ├── update.test.ts           # 更新服务测试
│   ├── notification.test.ts     # 通知服务测试
│   ├── notificationSounds.test.ts # 提示音管理 Hook 测试
│   ├── settings.test.ts         # 设置状态管理测试（含大文件阈值）
│   ├── diagnosticService.test.ts # 诊断上报服务测试
│   ├── sessionLock.test.ts      # 会话锁服务测试（同账户单开，8 个用例）
│   └── devices.test.ts          # 设备管理 API 测试（8 个用例，含批量删除）
│   # 注：deviceInfo 服务测试需 Tauri 环境，在 registry.test.tsx 中验证导入
└── components/                  # 组件测试
    ├── LoadingSpinner.test.tsx  # 加载动画组件测试
    ├── SettingsPanel.test.tsx   # 设置面板组件测试（20 个测试用例）
    ├── UpdateToast.test.tsx     # 更新提示弹窗测试
    └── registry.test.tsx        # 组件注册表测试（109 个测试用例）
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
| `@tauri-apps/plugin-window-state` | `restoreStateCurrent()` 返回 Promise |
| `@tauri-apps/api/window` | `getCurrentWindow()` 返回 mock 窗口对象 |

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
- 设置模块：提示音、数据管理、设备管理、更新检查
- 会议/媒体模块

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

