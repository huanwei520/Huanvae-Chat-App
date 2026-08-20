# CONTRIBUTING — Huanvae-Chat-App 贡献者指南

> 面向**协作开发者**:做前端(Tauri + React/TS)feature 开发 + 本地测试 + 提 PR。
> 打包 / 签名 / 发版 / 部署**不在你的范围**(owner 负责)。
>
> 本文件只补三件**仓内 `.claude/` 没覆盖**的事:① 跨仓契约链(前端视角);② 本地起步;③ 工作边界 + 公开仓红线。
> **完整的开发流程、前端规范、skills 以仓内 [`.claude/CLAUDE.md`](.claude/CLAUDE.md) + [`.claude/rules/`](.claude/rules/) 为准**(尤其 [`rules/frontend-test.md`](.claude/rules/frontend-test.md)),本文件不重复。

---

## ⚠️ 0. 公开仓红线(本仓是 PUBLIC)

**Huanvae-Chat-App 是公开仓库。私钥 / 密钥 / 凭据绝不可入仓。**
- 提交前自查:`git grep -nE 'BEGIN (RSA |EC )?PRIVATE KEY'` 必须 **0 命中**。
- 内置客户端证书:`src-tauri/resources/app-client.cert.pem`(公钥证书,可入)**可以**;对应的 `app-client.key.pem`(私钥)已 `.gitignore`,**永不提交**。
- 不要把任何 `.env`、token、服务器地址真值、密码写进代码或提交。

---

## 1. 必读:开发流程是硬性闸门

按仓内 [`.claude/CLAUDE.md`](.claude/CLAUDE.md):`需求对齐 → /audit → Plan → 实现 → /code-review → 测试 → /code-review → /blind-review →(/review-dispute)→ /skill-evolve → /completion-summary`。这些 `/xxx` 是 `.claude/skills/` 里的 skill,Claude Code 直接调用。**测试不过禁止提 PR。**

前端测试规范(vitest 单测 / playwright e2e / animation-health / 视觉回归)见 [`.claude/rules/frontend-test.md`](.claude/rules/frontend-test.md)。

---

## 2. 跨仓契约链(前端视角)⭐

后端(独立仓库,不在本仓)是 API **字段唯一真值源**;**App 的 TS 类型镜像后端 snake_case 字段名**。
当后端某 API 字段变了,App 对应文件必须同步(否则解包错/类型漂移)。当你**需要新后端字段**时,要回到后端走完整契约链(后端 struct + `backend-docs/` + 本仓文件三处同步)。

### App 文件 ↔ 路由 映射(按业务域,**别按名字猜**)

| App 消费端文件 | 路由 |
|---------------|------|
| `src/api/auth.ts` | `/api/auth` |
| `src/api/friends.ts` | `/api/friends` |
| `src/api/messages.ts` | `/api/messages` ⚠️ |
| `src/api/groups.ts` | `/api/groups` |
| `src/api/groupMessages.ts` | `/api/group_messages` |
| `src/api/profile.ts` | `/api/profile` |
| `src/api/storage.ts` + `src/api/upload.ts` | `/api/storage` |
| `src/services/syncService.ts` ⚠️ | merge(无前缀) |
| `src/meeting/api.ts` ⚠️ | `/api/webrtc` ⚠️ |
| `src/api/ai.ts` | `/api/ai` |
| `src/api/miniapps.ts` | `/api/miniapps` |
| `src/api/oauth.ts` | `/api/oauth` |
| `src/huanvaeGuard/` ⚠️(独立窗口) | `/api/hg` |

**⚠️ = 命名跨层不一致,最易找错文件。** 后端契约文档由后端仓(独立仓库,不在本仓)按业务域维护。

### 前端契约约定
- **响应解包**:后端响应统一被 `ApiResponse<T>` 包成 `{ success, code, data, ... }`;`src/api/client.ts` **自动解包 `data`**,业务代码拿到的是 `data` 内容。
- **不碰 `src-tauri/` 做后端交互**:所有后端 HTTP/WS/SSE 走 React 层(`src/`,经 `secure_net`/`ws_proxy` 自管 TLS 的 invoke);`src-tauri` 只做本地操作。
- 类型定义改了要与后端 struct 字段一一对应(snake_case)。

---

## 3. 本地起步

```bash
pnpm install
pnpm dev            # vite 开发服务器(前端)
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm test:run       # vitest 单测(run 一次)
pnpm test:e2e       # playwright e2e
pnpm check          # = typecheck + lint + test:run(提交前建议跑)
pnpm tauri dev      # 跑完整 Tauri 桌面端(需 Rust 工具链)
```
- 连后端:App 经发现(`ca.huanvae.cn`)+ mTLS 连生产源站。本地对接**本地/测试后端**的方式见仓内 `README.md` / `.claude/CLAUDE.md` 的开发配置(向 owner 索取本地 dev 指向)。纯前端 UI/逻辑改动可只跑 `pnpm dev` + vitest,不必连真后端。
- 提交前必跑:`pnpm check`(typecheck+lint+test)+ 相关 e2e/animation 测试(见 `frontend-test.md`)。

---

## 4. 工作边界 + 提 PR

**范围内**:`src/` 前端代码、契约链 App 侧同步、`src/**/*.test.ts(x)` / e2e 测试、本地 `pnpm` 自测、开 PR。
**不归你**:打包/签名/发版、`src-tauri` 的发布配置、生产后端/服务器、私钥/凭据。

```bash
git checkout -b feat/<你的任务>
# ...改代码 + 同步契约链 + 写/跑测试...
pnpm check                         # 全绿
git grep -nE 'BEGIN .*PRIVATE KEY' # 必须 0(公开仓红线)
git commit -m "<类型>: <简述>

<详细说明;若涉及后端字段,注明契约链同步情况>"
git push -u origin feat/<你的任务>
# 在 GitHub 对 main 开 Pull Request,等 owner review + 合并
```
- `main` 受分支保护,**必须 PR + review 才能合**,无法直推。
- **测试未通过 / 有密钥泄露 禁止 push。**
