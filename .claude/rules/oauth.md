# OAuth 前端模块规则

## 文件结构

```
src/
├── api/
│   └── oauth.ts                              # API 封装（10 个函数 + 类型）
├── hooks/
│   ├── useOAuthGrants.ts                     # 已授权应用管理 Hook
│   └── useOAuthClients.ts                    # OAuth 客户端管理 Hook
├── styles/
│   └── oauth.css                             # OAuth UI 样式（含 SecretDisplay 弹窗样式）
└── components/
    ├── common/
    │   └── SecretDisplay.tsx                  # 通用凭据展示弹窗（OAuth + SSH 凭据共用）
    ├── oauth/
    │   ├── OAuthConsentModal.tsx              # 授权同意弹窗（Portal，当前无调用方，预留给外部授权页）
    │   └── OAuthClientsPanel.tsx              # 客户端管理面板（Portal, fixed 定位）
    └── settings/
        └── AuthorizedAppsPanel.tsx            # 已授权应用面板（设置子面板）
```

## 入口点

- **已授权应用**: `SettingsPanel.tsx` → 账户与安全 → 已授权应用 → `AuthorizedAppsPanel`
- **OAuth 客户端管理**: `MiniAppsModal.tsx` → 我的 Tab → OAuth 客户端按钮 → `OAuthClientsPanel`（通过 `createPortal` 渲染到 `document.body`）
- **授权同意**: `OAuthConsentModal` 由外部 OAuth 流程触发

## 后端 API 对应

所有端点前缀 `/api/oauth/`，详见后端 `.claude/rules/oauth.md`。

前端类型必须与后端 Rust 结构体字段一一对应：
- `OAuthClient` ↔ `ClientInfo`（`src/oauth/models/client.rs`）
- `OAuthGrant` ↔ `GrantInfo`（`src/oauth/models/grant.rs`）
- `TokenResponse` ↔ `OAuthTokenResponse`（`src/oauth/models/token.rs`）
- `AuthorizeResponse` ↔ `AuthorizeResponse`（`src/oauth/handlers/authorize.rs`，`#[serde(untagged)]` 联合类型）

## 小程序静默 OAuth 登录

后端 OAuth Provider 支持小程序"静默登录"（internal 客户端，无 consent 弹窗）。**Tauri 客户端的责任仅限：把平台 JWT 通过 URL query `?token=xxx` 注入 WebviewWindow**。完整 OAuth 4 步流程（authorize → token → userinfo）由小程序自己的 JS 在 webview 内完成。

**实现位置**：
- [MiniAppsModal.tsx](src/components/miniapps/MiniAppsModal.tsx) 的 export pure function `buildMiniAppLaunchUrl(serverUrl, accessUrl, token)`
  - access_url 已含 query 时用 `&token=`，否则 `?token=`
  - token 经 `encodeURIComponent` 编码
  - 字段名固定为 `token`（非 `platform_token`），与后端 ai-demo 约定一致
- `handleOpen` 失败不降级：session 为 null 或 access_url 为空时直接早返回，不打开 WebviewWindow（用户已确认"服务器断开小程序天然打不开"）

**不涉及**：Tauri 端不调用 `src/api/oauth.ts` 的任何函数，不管理 oauth_client_id/secret。那些字段由小程序自己在创建时保存并写入小程序代码。

## 开发者凭据展示

创建小程序的响应（[CreateMiniAppResponse](src/api/miniapps.ts)）可选返回 `oauth_client_id?` + `oauth_client_secret?`（OAuth 客户端注册成功时才有）。MiniAppsModal 的 `handleCreate` 成功后用 `SecretDisplay` 弹窗一次性展示：OAuth 凭据 + SSH 凭据。关闭弹窗后切到「我的」tab。

**凭据字段构建**：`buildCredentialsFields(r: CreateMiniAppResponse)` pure function，OAuth 字段缺失时自动省略对应行。

## 注意事项

- `OAuthClientsPanel` 从 MiniAppsModal 渲染时必须通过 `createPortal` 挂载到 `document.body`，使用 `position: fixed` 而非 `absolute`，因为 MiniAppsModal 本身已 portaled
- `AuthorizedAppsPanel` 从 SettingsPanel 渲染，使用 `position: absolute`（相对于设置面板容器），不需要 portal
- CSS class `oauth-back-btn` 独立于 `settings-back-btn`，避免跨组件样式依赖
- `ApiClient` 自动解包 `ApiResponse.data`，void 端点（delete/revoke）返回值可忽略
- `AuthorizeResponse` 是 untagged union，用 `isConsentRequired()` 类型守卫区分
- `SecretDisplay` 已抽到 `src/components/common/`，接口 `{title, warningText?, fields[], onClose, closeLabel?}`。OAuthClientsPanel 和 MiniAppsModal 都应复用此组件而非自己重写凭据弹窗
- `OAuthConsentModal` 当前无调用方（预留给未来的外部第三方授权页，需要新 `/oauth/authorize` 路由 + Tauri deep link 才能激活）
