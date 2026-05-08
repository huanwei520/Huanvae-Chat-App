# 通用规则（common）

跨模块、跨语言的工程实践规则。

## 文档阅读

### 角色名词易混淆 — 同一术语可能指不同实体

后端文档/PRD 里出现"前端"、"客户端"、"小程序"、"用户"等名词时，**先弄清这个名词具体指哪个执行实体**，不要把"小程序前端"和"Tauri 客户端"混为一谈。

**规则**：读到角色名词时主动问自己：
1. 这段话发生在哪个进程/上下文？（Tauri 主窗口 / 小程序 webview / 后端服务）
2. 同一文档里如果还有其他角色名词，它们的关系是什么？
3. 第一遍读完后，把推断的角色映射写下来，回头核对一次

**反例（2026-04-23）**：
- 后端文档「小程序前端可通过以下流程实现静默登录：1. 从父页面获取平台 JWT...」
- 初读把"小程序前端"理解为 Tauri 客户端，导致整个方案设计错（以为 Tauri 要代替小程序做 OAuth 4 步）
- 第二遍细读才识别"小程序前端 = 小程序自己的 JS（运行在 webview 内）"，"父页面 = Tauri 客户端"
- 错误方案如果落地，会浪费数小时实现一套 Tauri 端的 OAuth client_id/secret 管理代码

## 代码探索

### 查目录不要只用 Glob `**/...`

Glob 模式 `**/pattern` 在某些工具实现下**不会匹配仓库根目录的直接子目录**（当模式以 `**/` 开头时 `**` 代表 0+ 中间层，但目录名匹配算法可能跳过根层直接子目录）。

**规则**：查找仓库根下的子目录时：

1. 先用 `ls -d */`（bash）或 `Get-ChildItem -Directory -Depth 0`（PowerShell）列出顶层 dir
2. 再用 Glob 做深层搜索

**反例（2026-04-23）**：
- 用户说"源码在 `vscode-huanvae-sftp/`"
- 我用 Glob `vscode-huanvae-sftp/**` 和 `**/huanvae-sftp/**` 都返回空，误判目录不存在
- 实际 `ls -d */` 立刻可见该目录

## 全量重写（Write 工具）后的收尾

### 用 Write 覆盖既有文件 = 你是当前作者

即使保留了原有代码片段（如 `if (cancelled) return;` 这种单行写法），这些代码**从提交角度已归你所有**。任何由你的 Write 操作产生的 lint/typecheck/静态分析噪音都应主动修齐，不可挂"pre-existing"免责。

**规则**：Write 完成后立即在该文件上跑一次目标语言的 linter（`pnpm lint <file>` / `cargo clippy` / 等），对告警就地处理。

**反例（2026-04-23）**：
- Write 重写 EditorPage.tsx 保留了 3 处 `if (cancelled) return;` 原样
- 全量回归时 lint 报这 3 处 `curly` 规则违规
- 初始判断"原有模式，非我引入"，实际 Write 之后文件所有行均属当次修改范畴

## 环境差异与 Agent 报告

### 子 Agent 的环境限制 ≠ Plan 不通过

独立子 Agent（如 blind-reviewer、test-runner）可能遇到主对话没有的环境问题（文件锁、权限、端口占用）。这类"无法执行"的报告**不能直接当作"Plan 未通过"**。

**规则**：收到 Agent 汇报"因环境问题无法验证"时：
1. 判断是否真的环境问题（读错误信息，非代码 bug）
2. 主对话侧尝试解决环境（stop service / free port / 等）后自己补跑
3. 若环境确实无法解决，在 completion-summary 中明确标注"该项由主对话在时刻 X 通过本地运行验证过，Agent 侧未能复现"

**反例（2026-04-23）**：
- blind-reviewer 汇报 Step 2 的 `cargo test` 因 huanvaeguard-svc.exe 文件锁失败
- 若直接判 Plan 未通过会错失闭环；实际主对话侧 `hg-service.ps1 -Action stop` 后 4/4 测试全绿

## .gitignore 模式在 Windows 上是大小写不敏感的

### 非完整路径的目录模式会跨大小写匹配

Windows / macOS 默认 NTFS / APFS 是 case-insensitive，`git config core.ignorecase=true`。`.gitignore` 里写一个无路径前缀的目录名（如 `HuanvaeGuard/`）会同时匹配 `src-tauri/.../HuanvaeGuard/` **和** `src/huanvaeGuard/` 下**所有未追踪**的新文件（已 tracked 的不受影响）。

**规则**：项目特定路径模式必须**带完整路径前缀**：

```gitignore
# ❌ 危险：会跨大小写匹配 src/huanvaeGuard/ 下的新文件
HuanvaeGuard/

# ✅ 安全：限定到具体子树
src-tauri/resources/HuanvaeGuard/
src-tauri/target/*/HuanvaeGuard/
```

**排查命令**：`git check-ignore -v <suspect-path>` 直接显示哪条规则匹配。

**反例（2026-05-06）**：
- `.gitignore` 第 29 行 `HuanvaeGuard/` 用于忽略 svc 二进制目录
- 新增 `src/huanvaeGuard/format.ts` 在 `git status` 中默默不出现
- `git check-ignore` 显示该文件被 `HuanvaeGuard/` 规则匹配
- 修正为 `src-tauri/resources/HuanvaeGuard/` + `src-tauri/target/*/HuanvaeGuard/` 后正常追踪

## Cleanup 流程前置检查

### 非 git 仓库必须先 `git init` 建基线

cleanup skill 第 3 步「清理前提交」依赖 `git commit` 作为回滚安全网。项目不是 git 仓库时这步会静默失败，后续删除无保护——踩错一脚就是永久损失。

**规则**：cleanup 第一步必做：

```bash
ls .git 2>/dev/null || git init && git add -A && git commit -m "snapshot: before <scope> cleanup"
```

`.gitignore` 已有的项目会自动忽略大目录（node_modules/target/dist），snapshot commit 体积可控。

**反例（2026-04-23）**：
- 项目无 `.git`，环境信息已标 `Is a git repository: false`
- 若跳过基线直接 rm -rf 538 MB code-server + 145 MB 扩展源码 + 384 MB node binary，用户反悔无法恢复
- 实际补做 `git init + commit` 只耗 533 files / 170760 lines，事后 `git diff HEAD~1` 精确追溯

## 审计的"调用方真实形态"必须 100% 覆盖

### 不要从 1 推 N

审计阶段统计某个 className / API / 调用方"长什么样"时，必须**逐处打开看上下文**确认形态，**不能看 1-2 处就推断剩下的**。

**规则**：列出 N 处调用前必做：
1. grep 全部 N 处位置
2. 逐处 Read 看实际包装形态（是不是被 motion 包了、是不是有 className 拼接、是不是在条件分支里）
3. 在审计报告里如实给出"形态分布"而不是单一假设

**反例（2026-04-23）**：
- 审计 12 处 `.glass-button` 时只看了 Register.tsx 一处的 motion.button 形态，推断"3 处 motion + 9 处普通"
- 实际 12 处全是 motion.button
- Plan 因此分了"普通迁移"和"motion 迁移"两个分支，浪费一轮重新设计

## Agent 建议必须做反向验证

### 子 Agent 的"补充建议"也可能与代码 reality 不符

之前已有规则「子 Agent 的环境限制 ≠ Plan 不通过」处理 Agent 因环境限制无法执行的场景。**另一种 Agent 错误**是它给出了**积极的补救建议**，但建议本身基于错误的代码假设。

**规则**：收到 Agent 报告里的"建议补一个 X"或"建议改成 Y"时：
1. 不要立即采纳
2. 亲自打开它假设的前提文件验证（例如它说"这个 form 是 props-driven 无 context 依赖"，必须 grep 该文件 import 段确认）
3. 验证失败 → 当面驳回，记录原因

**反例（2026-04-23）**：
- code-review Agent 建议补 PasswordForm / ProfileInfoForm 测试，理由"props-driven 无 context"
- 亲自 Read 两文件发现都用了 `useApi()` / `useSession()`，**有 context 依赖**
- 盲信会浪费时间写一堆不必要的 mock

## 文件头注释里的"未来计划/迁移清单"必须同步实际决策

### 文档化的承诺会污染未来读者的判断

很多组件在文件头注释里写"## 迁移映射"或"## 未来扩展"清单。重构落地时如果**实际决策与原清单不一致**（例如清单写"X → 归 A"但实际归到了 B），必须**同步改注释**。

**规则**：重构涉及"文件头里有迁移/扩展清单"的组件时：
1. 完成代码后必查该文件的注释段
2. 把不再准确的条目标记为"(已转 X 系统承担)"或重写
3. 不要靠 commit message 解释 — 后续读者只看代码 + 注释

**反例（2026-04-23）**：
- AppButton.tsx 文件头是 42 处旧按钮 → 新 props 的全景规划
- 本次 Step B 决定"浅色底按钮归 `.subtle-btn` 而不是 AppButton secondary"
- 盲审标灰色地带：注释不更新会让后续读者误判设计意图

## 大文件 grep 不能"看到第一个就停"

### 大 CSS / config 文件可能有同名定义重复

`grep <symbol>` 命中第一处后**不能立即停**。CSS 文件 / config 文件 / 长 SQL 文件常有同名规则的覆盖性重复定义（特别是 1000+ 行的样式表）。

**规则**：当 grep 一个 className / 配置 key 时：
1. 读全部命中位置（不管命中数）
2. 比对各处定义的差异（颜色、padding、值）
3. 如果有"前后不同"的定义，必须决定取哪份 + 把另一份明确删除

**反例（2026-04-23）**：
- `lanTransfer/styles.css` 是 1500+ 行
- `.lan-btn-danger` 在 932-940（浅色 subtle 风格）和 1455-1462（纯红实心风格）有两份定义，颜色完全不同
- audit 第一遍 grep 看到第一份就推断"已找全"，差点漏掉第二份覆盖
- 后来跑完整 grep 才发现重复，需要决定取哪份（取了浅色版，符合 subtle 分类）

## Cleanup 验证的噪音隔离

### 用 `git stash` 做清理前后基线对比

大 cleanup 后跑 typecheck/lint 出错时，先分辨「清理引入」vs「pre-existing」，否则会误判为 cleanup 破坏代码。

**规则**：对比基线：

```bash
# 当前清理后状态跑一遍，记录错误数
pnpm typecheck 2>&1 | tail -5; pnpm lint 2>&1 | tail -5

# git stash 切回清理前
git stash
pnpm typecheck 2>&1 | tail -5; pnpm lint 2>&1 | tail -5  # 基线

# 恢复清理状态
git stash pop
```

如果两次输出错误数量/内容**一致或清理后更少**，说明没引入新问题，可以安全 commit。

**反例（2026-04-23）**：
- 清理后 typecheck 2 errors，lint 119 problems，初看像是清理引入
- 基线对比：typecheck 2 errors（完全相同）、lint 155 problems（**比清理后多 36 条**）
- 结论：所有错误均为 pre-existing，清理反而减少了 36 条 lint 问题

## 重构后接口字段：`_前缀变量` 不是合法的"保留兼容"借口

### CLAUDE.md 明确禁止兜底，看到 `_xxx` 重命名要主动评估"是否真该删除整个字段"

重构组件时常见诱惑：删除某 prop 的内部使用后，把参数名加 `_` 前缀（如 `localPath: _localPath`、`contentType: _contentType`）让 TS 不告警，**并辩称"保留接口兼容性"**。这通常是死代码自欺：

- 如果调用方真依赖该 prop 的某个外部行为，那它不该在重构里被沉默化
- 如果调用方实际不依赖（用空字符串、占位值、根本不传），就该把字段从 props interface 里**完全删除**，调用方一并清理

CLAUDE.md「功能迭代规则」明确：
> 完全采用新逻辑，不考虑向后兼容，不使用兜底策略。旧代码和旧文档必须清理干净，保证零污染。

**规则**：重构中产生 `_xxx` 形式重命名的参数时：

1. grep 全部调用方，看每处实际传入的值
2. 若所有调用方都传死值/占位/不传 → 字段是死的，从 interface 删除 + 调用方清理
3. 若有真实数据传入但内部不再用 → 内部确实不需要时同样删除；如有持续需要再恢复用途
4. 不可以"我先标 `_` 等下次再清"——这是把 cleanup 推给未来读者

**触发体感**：code-review 会标 Major（违反 cleanup 规则）。

**反例（2026-05-07）**：
- 重构 FilePreviewModal 时把 `localPath` / `contentType` 改成 `_localPath` / `_contentType` 并注释"保留接口兼容性"
- 实际 4 处调用方 (FilesModal / MobileFilesPage / FileMessageContent.DocumentMessage / FilePreviewModal 自身) 全部要么传死值要么不依赖
- code-review 第一轮标 Major，要求删除字段；删除后 4 处调用方各精简 1-3 行，无任何回归（801/801 测试仍全绿）
- 教训：看到 `_xxx` 第一反应是"哪个调用方真依赖它"，而不是"留着以防万一"

## Plan 描述与代码 reality 必须 100% 对齐

### 写 Plan 时凭印象会错——必须 grep 验证每个文件的引用

写 Plan 时常凭印象描述某文件"还未使用 X"或"已删除 Y"，但实际通过 import/调用情况完全相反。盲审 Agent 会精确指出这种偏差。

**规则**：Plan 中每写一处涉及"现有代码中是否使用 X"的判断，必须先 `grep` 该 symbol 在目标文件中的实际出现，不可凭记忆。

**反例（2026-05-07）**：
- 重构「我的文件」时 Plan 写："MobileFilesPage 删除局部 LocalBadge 改为 import 自 chat/shared/DocumentDownloadAction（即使本文件还未实际使用 LocalBadge，仍保留 import）"
- 盲审 Agent 实际 grep 发现 ImageThumbnail / VideoThumbnail 都在用 `<LocalBadge />`，import 是必需的而非冗余
- Plan 的注释"还未实际使用"是凭印象错误；写完 Plan 该 grep 一遍引用情况

## Tauri plugin-http 不能用 playwright page.route 拦截

### 所有 `@tauri-apps/plugin-http` 的 fetch 请求都走 Tauri invoke 通道

`@tauri-apps/plugin-http` 不调用浏览器原生 fetch，而是通过 `window.__TAURI_INTERNALS__.invoke('plugin:http|fetch', ...)` 走 Tauri Rust 层。这意味着：

- e2e 测试中 `page.route('**/api/login', ...)` **不会拦截**这些请求
- 必须在 `__TAURI_INTERNALS__.invoke` 的 mock 内处理 `plugin:http|fetch` / `plugin:http|fetch_send` 等命令

**规则**：评估 Tauri 应用 e2e 完整登录流可行性时：
1. 先 grep `from '@tauri-apps/plugin-http'` 看哪些 API 调用走此通道
2. 走 plugin-http 的 API 不能用 page.route 拦截，需要在 tauri-mock invoke 处理
3. 完整模拟 plugin-http login response 需要二阶段（fetch 返回 rid → fetch_send 返回 body），工作量大
4. 如果只是为了进入登录后页面，权衡用 vitest 组件测试覆盖动画/渲染契约可能更划算

**反例（2026-05-07）**：
- 任务"对所有适配检测进行全覆盖"初评估时尝试给 e2e 加完整 auth fixture
- 探索发现 [`src/api/auth.ts`](src/api/auth.ts) 使用 `import { fetch } from '@tauri-apps/plugin-http'`，page.route 无法拦截
- 改为分两层覆盖：e2e 覆盖登录前所有可达场景（form toggle / multi-viewport / dark theme），登录后场景由 vitest 组件测试覆盖动画属性（exit prop / body overflow / disabled 守卫）
- 节省 1-2 天 mock 调试时间，覆盖深度仍达预期
