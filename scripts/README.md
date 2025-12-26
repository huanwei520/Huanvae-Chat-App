# 脚本使用说明

## 概述

本目录包含 Huanvae Chat App 的自动化脚本工具。

## 文件说明

| 文件 | 说明 |
|------|------|
| `release.ps1` | 自动化发布脚本 |
| `release-config.txt` | 发布版本配置 |
| `pre-release.ps1` | 预发布检查脚本 |

---

## 预发布检查

在发布新版本前，运行预发布检查确保代码质量：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pre-release.ps1
```

**检查内容：**
1. TypeScript 类型检查
2. ESLint 代码规范检查
3. 单元测试
4. 前端构建测试
5. 人工功能检查清单

---

## 发布流程

### 第一步：编辑配置文件

编辑 `scripts/release-config.txt`，设置版本号和更新说明：

```txt
VERSION=1.0.3
MESSAGE=新增系统托盘功能，优化本地优先加载
```

**注意事项：**
- `VERSION` 使用语义化版本号（如 `1.0.3`、`1.1.0`、`2.0.0`）
- `MESSAGE` 简洁描述本次更新内容
- 每行一个配置项，格式为 `KEY=VALUE`
- 以 `#` 开头的行会被忽略（可用于注释）

### 第二步：运行发布脚本

在项目根目录打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1
```

### 第三步：等待构建完成

脚本执行后会输出 GitHub Actions 链接，点击查看构建状态：
- Actions: https://github.com/huanwei520/Huanvae-Chat-App/actions
- Release: https://github.com/huanwei520/Huanvae-Chat-App/releases

## 脚本自动执行的操作

1. **更新 `package.json`** - 修改 `version` 字段
2. **更新 `src-tauri/tauri.conf.json`** - 修改 `version` 字段
3. **更新 `src-tauri/Cargo.toml`** - 修改 `[package]` 下的 `version` 字段
4. **Git 提交** - 提交所有变更，提交信息格式：`v{VERSION}: {MESSAGE}`
5. **创建 Git 标签** - 创建 `v{VERSION}` 标签
6. **推送到 GitHub** - 推送代码和标签，触发 GitHub Actions 构建

## 技术细节

### UTF-8 无 BOM 编码

脚本使用 UTF-8 无 BOM 编码写入文件，避免 JSON 解析错误：

```powershell
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $content, $Utf8NoBom)
```

### Cargo.toml 版本替换

脚本使用精确的正则表达式，只替换 `[package]` 部分的 version，不影响依赖项版本：

```powershell
$content -replace '(\[package\][\s\S]*?name\s*=\s*"[^"]+"\s*\n)version\s*=\s*"[^"]+"', "`$1version = `"$Version`""
```

## 常见问题

### Q: 标签冲突怎么办？

脚本会自动删除本地同名标签后重新创建，并使用 `--force` 推送覆盖远程标签。

### Q: 构建失败 "is not valid JSON"？

检查 JSON 文件是否有 BOM 头，可手动修复：

```powershell
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$content = [System.IO.File]::ReadAllText("package.json", $Utf8NoBom)
[System.IO.File]::WriteAllText("package.json", $content, $Utf8NoBom)
```

### Q: 如何回退版本？

1. 删除远程标签：`git push origin :refs/tags/v{VERSION}`
2. 删除本地标签：`git tag -d v{VERSION}`
3. 回退提交：`git reset --hard HEAD~1`
4. 强制推送：`git push origin main --force`

