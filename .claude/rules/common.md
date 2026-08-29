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

## 缓存与数据库 SSOT 协同：setState 必须用增量合并，不能覆盖

### 当 useState 初值来自缓存、useEffect 又调异步数据库刷新时，禁止直接 setState 覆盖

典型场景：React Hook 内 `useState(() => store.cache[key] ?? [])` 拿缓存的全量数据（如 200 条消息），然后 useEffect 调 `db.getX(50)` 拿最新 50 条 → `setX(dbResults)` 直接覆盖 → **缓存的 200 条全部丢失**。

如果上层依赖"全量"（例如滚动锚点 uuid 指向较老的第 50 条），覆盖后 DOM 中没有该 uuid → 降级到默认行为 → 用户体验崩坏。

**规则**：当 setState 来源是"全量缓存"且数据库刷新是"窗口（最近 N 条）"时，必须做三分支增量合并：

```ts
setState((prev) => {
  if (prev.length === 0) {
    return dbResults;  // 首次加载，无缓存
  }
  // 1) 用 db 版本替换 prev 中已存在的（同步 is_recalled / is_deleted / content 等
  //    离线期间变化的字段；db 是 SSOT）
  const dbByKey = new Map(dbResults.map((m) => [m.uuid, m]));
  const updated = prev.map((m) => dbByKey.get(m.uuid) ?? m);
  // 2) 找出 prev 中没有但 db 中新增的（追加；用户隐藏期间收到的新消息）
  const existing = new Set(prev.map((m) => m.uuid));
  const newOnes = dbResults.filter((m) => !existing.has(m.uuid));
  if (newOnes.length === 0) {
    return updated;
  }
  // 3) 合并并按业务排序键（如 send_time）排序
  return [...updated, ...newOnes].sort(/* by send_time */);
});
```

三个分支缺一不可：
- `prev=[]` → 用 db 全量
- `prev` 含 db 已存在的 uuid → **必须用 db 版本替换**（同步离线期间状态变化字段）
- `prev` 不含 db 新增 uuid → 追加 + 排序

**反例（2026-05-13）**：

- 用户在聊天 A 翻历史触发 loadMore（messages 200+ 条），切到 B 再切回 A
- 切回时新 hook 实例，`useState(() => cachedFriendMessages[friendId] ?? [])` 读 200 条
- `useMainPage` useEffect 立刻调 `loadFriendMessages` → `db.getMessages(50)` 返回最新 50 条
- **原实现** `setMessages(uiMessages)` 直接覆盖 → messages 变 50 条 → 用户翻到的 uuid=50 不在 DOM → 滚动锚点降级 scrollToBottom，用户回到最底
- **修复**：三分支增量合并；prev 中较老 uuid 保留，db 50 条窗口内若有撤回/删除 → 通过 dbByUuid 替换同步到 UI；db 新增 → 追加 sort

**与 keep-alive 类问题的关系**：当组件用 store 缓存做"unmount/mount 间数据保活"时，**数据库的窗口刷新永远是缓存的子集或交集**，绝不能用窗口数据替换全量缓存。

**同 hook 内的其它路径**：useLocalFriend/GroupMessages 内 syncMessagesInBackground 路径目前仍是"以 uiMessages 为骨架 + 保留 sendingMessages"模式，**在 prev 远大于 uiMessages 时仍有相同覆盖风险**（WS 重连/gap>2s 触发时若用户已翻 200+ 历史会再次丢失）。本次修复未覆盖该路径，作为已知遗留风险。

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

## 跨端复用 pure function 时检查源文件的依赖污染

### 移动端从桌面组件 import 函数会 transitive 拖入桌面 only 模块

桌面端组件（如 `MiniAppsModal.tsx`）顶层经常 `import { WebviewWindow } from '@tauri-apps/api/webviewWindow'` —— Tauri Android 不支持 WebviewWindow 多窗口（[MobileMediaPreview.tsx](src/chat/shared/MobileMediaPreview.tsx) 已注释）。

如果在桌面组件文件**内部**定义了一个 pure function（如 `buildMiniAppLaunchUrl`、`buildCredentialsFields`），移动端组件第一反应是 `import { fn } from '../components/desktop/Modal';`。这会让打包器把整个 Modal 模块（含 WebviewWindow、OAuthClientsPanel、SecretDisplay 等桌面 only 代码）transitive 拖进 Android bundle。

运行时 `import` 一个 symbol 不调用不会崩溃（Tauri Android 会有 stub 抛错只在调用时触发），但属于"间接耦合 desktop-only 模块"，违反 CLAUDE.md「零污染」原则，且白白增大移动端 bundle。

**规则**：plan 阶段识别"桌面端复用 X 函数到移动端"时：

1. 打开桌面组件 X 所在文件的 import 段
2. 是否含 `WebviewWindow` / 其他 Tauri desktop only API / 大型桌面 only 子组件？
3. 是 → 抽 X 到独立的纯函数模块（如 `src/components/miniapps/launch.ts`），桌面/移动两端共同 import；从原桌面组件文件删除 X 的定义并改 import from 新模块
4. 否 → 直接复用即可

**反例（2026-05-10）**：
- 移动端 MobileMiniAppsPage.tsx 第一版 `import { buildMiniAppLaunchUrl } from '../../components/miniapps/MiniAppsModal'`
- code-review 标 Major：MiniAppsModal.tsx 顶层 import `WebviewWindow` + `OAuthClientsPanel` + `SecretDisplay` 等数百行桌面代码会被打进 Android bundle
- 修复：抽到 `src/components/miniapps/launch.ts`（纯函数模块，零依赖），桌面 modal 和移动 page 都改 import from `./launch`，桌面 modal 内删除原函数定义
- 教训：plan 阶段写"复用 X 函数"时就该读一下 X 所在文件的 import 段，决定要不要先抽离

## 新基础设施必须在同一 PR 内有消费方真正使用

### 「先铺基础设施，将来再切」= 死设施 + 持续写入开销

数据库 schema（FTS 虚表 / 索引 / cache 表 / trigger）和缓存层属于"建了就有持续运行成本"的基础设施。如果在一个 PR 里建好但**实际查询/逻辑没切到该基础设施**，就属于死设施 — 比单纯的死代码更糟，因为：

- 每条 INSERT/UPDATE/DELETE 都触发 trigger 写 FTS 表（强制运行）
- 占额外存储空间
- 增加未来读者理解负担（"这个表是干嘛的？"）
- 收益为零，因为查询路径根本不读

违反 CLAUDE.md「功能迭代规则：完全采用新逻辑，不考虑向后兼容，不使用兜底策略。旧代码和旧文档必须清理干净，保证零污染」。

**规则**：plan 里每加一条新基础设施（FTS 表 / index / cache layer / trigger），必须在**同一 PR 内**有消费方真正使用它：

1. 加 schema/trigger 时，同时把对应查询/逻辑切到该 schema
2. 不切 = 不加；commit message 写"为将来 FTS 准备"是错的，将来再加成本一样
3. code-review 看到"加了表/trigger 但 grep 不到查询语句"立刻质疑

**反例（2026-05-11）**：
- 第一版 `messages.rs` 加了 SQLite FTS5 虚表 `messages_fts` + 3 个 trigger（INSERT/UPDATE/DELETE 同步）+ backfill 检测，但 `search_messages` 函数里仍是 `WHERE m.content LIKE ?`
- 每条消息写入都强制走 trigger 写 FTS 表，但查询从不读
- code-review 标 Major（违反零污染原则）
- 修复：把 `search_messages` SQL 切到 `FROM messages_fts JOIN messages m ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?` — trigger 真正派上用场
- 教训：plan 阶段写"基础设施先准备，业务后切"时必须警觉，建议同 PR 一并切完

### SQLite FTS5 external content 表的 backfill 必须用 'rebuild' 命令

给已有数据的 messages 表加 FTS5 external content 虚表 + 同步 trigger 时，**已有的历史消息不会自动入索引** — trigger 只对未来的 INSERT/UPDATE/DELETE 生效。必须做一次 backfill。

错误做法：手写 `INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages` 配合 `messages_fts COUNT=0` 检测条件。
- trigger 创建后任何新消息写入都会让 `messages_fts COUNT` 立即 > 0
- 检测条件失效 → backfill 跳过 → 历史消息永远不入索引
- 用户后续搜历史会零命中

正确做法（SQLite 官方推荐）：

```rust
// 1. 用 COUNT 对比检测同步性（不要只看 messages_fts 是否为空）
let messages_count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
let fts_count: i64 = conn.query_row("SELECT COUNT(*) FROM messages_fts", [], |r| r.get(0))?;

// 2. 不一致就用 'rebuild' 强制重建（幂等、原子，会从 external content 表重读所有 content）
if messages_count != fts_count {
    conn.execute("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')", [])?;
}
```

`'rebuild'` 是 FTS5 内置的特殊 INSERT 形式，对 external content 表有效，会 truncate FTS 索引 + 从 content='messages' 配置的源表全量重灌。

**反例（2026-05-11）**：
- 第一版用 `INSERT...SELECT` + `messages_fts COUNT=0` 检测
- 旧用户的 DB 中 messages 已有数据；新版启动时 trigger 创建完，几条新消息进来 → messages_fts COUNT > 0 → backfill 跳过
- 历史消息从未入 FTS → 搜历史零命中
- 修复后用 `'rebuild'` + COUNT 对比，FTS 与 messages 完全同步

## CSS 绝对定位浮层不能锚定到 overflow:auto 的父级

### 浮层会随父级滚动，导致用户滚动后浮层不可见

CSS 中 `position: absolute` 元素相对最近的 `position != static` 祖先定位。如果该祖先同时有 `overflow: auto`，浮层会跟随容器内容滚动 —— anchor 是 content-top 而非 viewport-top。

典型表现：用户先滚动列表到底部，再触发搜索 → 搜索浮层渲染在 content 顶部（用户视口外）→ 看不到浮层。

**规则**：要做覆盖滚动容器的浮层时，**父级必须拆成两层**：

```tsx
<div className="wrapper">       {/* overflow: hidden + position: relative — 定位锚点 */}
  <div className="scroll-list"> {/* overflow: auto — 真正的滚动容器 */}
    {items}
  </div>
  <div className="overlay" />   {/* position: absolute; inset: 0 — 锚到 wrapper */}
</div>
```

```css
.wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.scroll-list { overflow-y: auto; height: 100%; }
.overlay { position: absolute; inset: 0; }
```

**反面：不要图省事**

```css
.scroll-list {
  position: relative;
  overflow-y: auto;   /* ← 这一行让 overlay 跟随滚动 */
}
.scroll-list .overlay {
  position: absolute;
  inset: 0;
}
```

**反例（2026-05-11）**：
- 移动端 `.mobile-contacts` 是 `height:100%; overflow-y:auto` 滚动容器
- 给它直接加 `position: relative` + 内部 `.global-msg-search { position:absolute; inset:0 }` 浮层
- 列表滚动到底后触发搜索 → 浮层渲染在 content 顶部 → 视口看不到
- 修复：MobileChatList 外层包 `.mobile-chat-list-wrapper`（relative + overflow:hidden）+ `.mobile-contacts`（保持 overflow:auto）+ 浮层挂 wrapper 内

## Tauri plugin-http 不能用 playwright page.route 拦截

> 🔴 **2026-08-19 适用范围订正**：下面这一节的**机制**仍然成立，但它举的那个例子已经过期 ——
> `src/api/auth.ts` **早就不再用** `@tauri-apps/plugin-http`，登录路径走 `invoke('secure_http')`。
> 据此推出的「登录后页面 e2e 不可达」**已被证伪**，详见本文件
> 「审计结论『e2e 撞 `plugin:http` 502』已过期」一节。

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

## PowerShell `Set-Content` 写文件的两个陷阱

### 陷阱 1：`-NoNewline` + 数组参数会把所有行合并成一行

PowerShell 的 `Set-Content -NoNewline -Value @lines` 行为：**不在元素之间插换行**，把数组所有元素**首尾相接**写成单行。常被误用于"原样回写文件 + 不在末尾加多余换行"，结果整个文件被合并成一行，破坏代码。

```powershell
# ❌ 错误：lines = Get-Content -Encoding UTF8 的行数组，Set-Content -NoNewline 会合并所有元素
$lines = Get-Content $path -Encoding UTF8
$lines[549] = "  " + $lines[549]
Set-Content -Path $path -Value $lines -Encoding UTF8 -NoNewline
# 结果：文件 612 行变成 1 行

# ✅ 正确：用 \n join 后整体写入（保留换行），不加 -NoNewline
$content = ($lines -join "`n") + "`n"
[System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
```

### 陷阱 2：PowerShell 5.1 `Set-Content -Encoding utf8` 写 BOM

PS 5.1 的 `-Encoding utf8` 是 UTF-8 with BOM。给 TS/CSS 等会被其他工具解析的文件加 BOM 会导致 lint/build 报错（已在前述 "css-encoding" 规则中体现）。

正确做法：用 `[System.IO.File]::WriteAllText(path, content, [System.Text.UTF8Encoding]::new($false))` 显式无 BOM。

**规则**：

1. **不要用 PowerShell 批量改文件**。优先使用 Edit 工具（针对单个 occurrence）或 Write 工具（重写整个文件）。这两个工具按字符串处理，不会引入 NoNewline / BOM 问题。
2. 如果**必须**用 PowerShell（如批量处理多行），用 `[System.IO.File]::WriteAllText` + 显式 UTF8 no-BOM encoding，**不要**用 `Set-Content -NoNewline -Value $array`。
3. 修改文件后**必须立即**用 Read tool 抽几行验证内容完整（行数 / 缩进 / 内容），不要假设写入成功。

**反例（2026-05-12）**：
- 修复 UnifiedList.tsx 缩进时用 `Set-Content -NoNewline -Value $lines` 批量写入
- 文件从 605 行变成 1 行（全部内容合并），所有 JSX 被破坏
- 用 `git checkout HEAD --` 才恢复
- 之后所有缩进类修改改回 Edit tool（逐处替换）或单测后重写全文

## 摘要式确认 modal 必须给用户看够风险信息（不能仅 host）

### 把"打开 URL"等敏感操作摆到用户面前确认时，仅显示域名不足以让用户识别恶意端点

确认 modal 在展示外部 URL 时常见错误：只显示 `host` —— 例如：

```
POST 请求: api.legitsite.com   ← 仅 host
```

但攻击者控制的卡片可以是 `https://api.legitsite.com/admin/delete?id=42` —— 域名合法、路径致命。用户点"信任并执行"时根本不知道在调 admin/delete。

**规则**：

1. URL 摘要必须显示 `host + path 截断版`（path 截到 ~40 字符 + 省略号），让用户能识别敏感端点
2. query string 可不显示（含 token 等可能暴露）；如果路径中已含敏感信息，截断处理仍能让用户识别 `/admin/`、`/delete`、`/transfer` 等关键词
3. 不要因为"避免 modal 过宽"就把 path 完全去掉——这种 trade-off 是错的，因为安全 UX 优先于美观
4. 摘要文本由 **后端可控的 pure function 生成**，不可由卡片自带 `description` 字段填——否则攻击者可写无害描述骗用户信任

**反例（2026-05-14）**：
- 第一版 NFC 指令 `summarizeAction` 对 `http/request` 只显示 `${method} 请求: ${host}`
- code-review 指出："Card with `https://api.legitsite.com/admin/delete?id=42` displays "POST 请求: api.legitsite.com" — user can't see the destructive path"
- 修复后改为 `${method} 请求: ${host}${path 截断}`，并补一条测试 case 验证 `/admin/delete` 出现在摘要中

## 安全敏感的指令解析必须拒绝"规范矛盾"的组合

### 攻击者可利用解析器宽松接受、底层 API 拒绝的组合，把数据藏在 modal 看不到的地方

典型例子：HTTP fetch 规范禁止 `GET + body`（任何 fetch 实现都会抛错），但 URI 解析层经常没显式拒绝，让 `huanvae://http/request?url=...&method=GET&body=<base64>` 通过。结果：

- 实际执行时 fetch 报错 → 表面无害
- 但 modal 的 `summarizeAction` 只显示方法和 URL，**不显示 body** → 攻击者借此把恶意数据藏到 body 字段，用户在 modal 上完全看不到

**规则**：URI / 指令解析层遇到"会被底层拒绝但能藏数据"的组合时，**必须显式 return null/reject**，不要交给底层 fail。验证矩阵：

- `method` ∈ 白名单 ✓
- `body` 仅在允许携带 body 的 method 上接受（如 POST/PUT/PATCH）
- 任何"参数存在但根据其他参数应当被忽略"的字段 → 显式拒绝整条指令

**反例（2026-05-14）**：
- 第一版 NFC parser 接受 `parseAction('huanvae://http/request?url=...&method=GET&body=<base64>')` → 返回 `{ method: 'GET', body: {...} }`
- 执行时 fetch 抛错 → 但 body 字段对用户不可见
- 修复：parseAction 中加 `if (method === 'GET' && body64) { return null; }`，并补测试用例覆盖
- 教训：解析层"宽进严出"思维不适合安全敏感场景；必须"严进严出"

## tauri-plugin-nfc Android: 必须用 `scan({ type: 'tag' })` 而非 `{ type: 'ndef' }`

### plugin 源码注释自己承认 `ACTION_NDEF_DISCOVERED` "never triggers"

`tauri-plugin-nfc` v2.3.5 Android 端的 `NfcPlugin.kt:382` 注释明确写：

```kotlin
NfcAdapter.ACTION_NDEF_DISCOVERED -> {
    // For some reason this one never triggers.
    ...
}
NfcAdapter.ACTION_TECH_DISCOVERED -> {
    // For some reason this always triggers instead of NDEF_DISCOVERED even though we set ndef filters right now
    ...
}
```

根因有二：

1. **Android NDEF intent 匹配规则**：`ACTION_NDEF_DISCOVERED` IntentFilter 必须附带 data filter（mimeType 或 URI scheme/host/pathPrefix）才会被系统命中。空的 NDEF filter 永远不匹配任何卡片。
2. **plugin 的 `addDataFilters` 有嵌套 lambda bug**（[NfcPlugin.kt:100-115](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/nfc/android/src/main/java/NfcPlugin.kt)）：

   ```kotlin
   uri?.let { it -> {                   // ← 这里 `{ ... }` 是 lambda 字面量赋值，body 永不执行
       it.scheme?.let { intentFilter.addDataScheme(it) }
       it.host?.let { intentFilter.addDataAuthority(it, null) }
       it.pathPrefix?.let { intentFilter.addDataPath(it, PatternMatcher.PATTERN_PREFIX) }
   }}
   ```

   即便调用方在 `scan({ type: 'ndef', uri: { scheme: 'foo' } })` 传了 uri，scheme/host/pathPrefix 也**不会**被加到 IntentFilter。

### 症状：贴卡时弹系统 chooser（com.android.nfc/.TechListChooserActivity）而非命中 App

如果用 `scan({ type: 'ndef' })`：
- foreground dispatch 注册了空的 `ACTION_NDEF_DISCOVERED` filter
- 系统检测到 NFC 卡 → 没有任何前台 App 的 dispatch 匹配 → 系统弹 "选择应用打开" chooser
- App 进程对此**完全无感知**（logcat 内 plugin 无任何输出，oplus_nfc 系统层倒是有 ntf gid:15）

### 规则

**Tauri Android NFC 扫卡，前台扫任意卡的场景，必须用 `scan({ type: 'tag' })`**：

```ts
// ❌ 不工作（除非传完整 mimeType/uri 且 plugin 修了 addDataFilters bug）
const tag = await scan({ type: 'ndef' });

// ✅ 正确用法 — TAG_DISCOVERED 是 catch-all，任何 NFC 卡都命中
const tag = await scan({ type: 'tag' });
```

返回的 `Tag.records` 数组结构在 `tag` / `ndef` / `tech` 三个分支完全一致（plugin 内 `readTagInner` 走同一路径），仍能拿到 NDEF URI Record 等数据。

只有以下场景才用 `{ type: 'ndef' }`：
- 显式只想监听某个 mimeType（`scan({ type: 'ndef', mimeType: 'application/json' })`，mimeType 路径在 plugin 内正常工作）
- 配合显式 techLists（`scan({ type: 'ndef', techLists: [['android.nfc.tech.Ndef']] })`，强制走 ACTION_TECH_DISCOVERED）

### 反例（2026-05-14）

- 第一版 `MobileNfcScanPage.tsx`（v2 已移除，扫卡改由全局 hook `src/hooks/useNfcGlobalScan.ts` 承担，见下一节）用 `scan({ type: 'ndef' })`
- ColorOS Realme 真机贴卡：系统弹 chooser，App 完全无响应，logcat plugin 端无输出
- 排查耗时 6 轮（adb logcat / manifest 检查 / Cargo.toml 验证 / 全面文档调研）
- 根因定位后改 `scan({ type: 'tag' })` 立即生效
- 教训：Tauri 第三方 plugin 的官方文档示例可能跟实际可用的调用形式不一致，**遇到"系统弹 chooser"症状第一时间看 plugin 源码注释**（plugin-nfc 源码注释直接说了 NDEF_DISCOVERED 不工作）

## 单次 Promise plugin 做"全局后台监听"的标准模式

### 问题

某些 Tauri plugin 的 API 是"单次 Promise"形态（如 `scan()` 调用 → 等待事件 → 单次 resolve），但产品需求往往是"全局监听"（如 App 启动后任何页面都能响应贴卡）。需要 JS 侧自己包一层 while loop。

### 关键约束（按经验验证顺序）

1. **scan() Promise 后台行为**：plugin 通常在 Activity onPause 不 reject Promise，只 disableForegroundDispatch；onResume 用保存的 session 重新 enableForegroundDispatch。**JS 侧无需监听 visibilitychange**，Promise 在后台期间自然挂起，回前台后继续等贴卡。

2. **scan options 参数形态确认**：`scan(kind, options?)` 是两参形式（plugin-nfc）。不要把 `keepSessionAlive` 写进 kind 对象，typecheck 会失败。

3. **loop 错误分类**：
   - NFC 不可用（`'NFC unavailable' / 'NFC is disabled'`）→ break loop，不再恢复（plugin 不提供 onStateChange 事件）
   - 解析失败 / 不支持的指令 → 静默 `continue`（背包碰到地铁卡 / 银行卡是常态）
   - 业务执行失败 → 显示 error toast，loop 继续
   - 其他未知错误 → sleep 1s 再继续，避免 hot loop

4. **modal 单深度同步用 Promise resolver**：

   ```ts
   // hook 内
   const modalResolverRef = useRef<(() => void) | null>(null);

   // loop 内（陌生卡需要确认时）
   setPendingConfirm(result);
   await new Promise<void>((resolve) => {
     modalResolverRef.current = resolve;
   });
   // ← loop 在此挂起，直到 onConfirm/onCancel 调 resolver()

   // 回调内
   const onConfirmTrust = useCallback(() => {
     setPendingConfirm(null);
     // ...业务...
     modalResolverRef.current?.();
     modalResolverRef.current = null;
   }, []);
   ```

   好处：modal 显示中**不发新 scan**（loop 阻塞），避免 modal stack；用户确认/取消后 loop 自动续上。

5. **React closure latest-ref 模式**：useEffect deps=[] 时 callback 闭包持有的是 mount 时的 props。用 `setMiniAppLaunchingRef.current = opts.setMiniAppLaunching`（每次 render 同步）让 loop 内 deref 拿到最新值。

6. **lint `no-await-in-loop`**：scan loop 本质就是 await + loop，要在文件级 `/* eslint-disable no-await-in-loop */`。`no-promise-executor-return` 在 `await new Promise(r => setTimeout(r, 1000))` 上也会误判，改成 `(resolve) => { setTimeout(resolve, 1000); }` 大括号写法绕过。

### 反例（2026-05-14）

- NFC v2 改造把扫卡从"用户进扫卡页才 scan"改为"App 启动即 scan，无限 loop"
- 第一版把 `keepSessionAlive: false` 误写进 ScanKind 对象 → typecheck FAIL
- modal 单深度同步用 React state 而非 Promise resolver → loop 不阻塞，会发新 scan 引起 modal stack；改 Promise resolver 模式后单深度天然保证
- 教训：plugin Promise + while loop 是可行模式，但必须：① 错误分类（break vs continue vs sleep）② modal 阻塞用 resolver 而非 state ③ disable no-await-in-loop ④ latest-ref 模式持有 callback

## Tauri 2 应用图标的平台规范陷阱

### macOS 与 iOS 的圆角逻辑根本不同 —— 一个要烘焙、一个禁止烘焙

| 平台 | 圆角来源 | PNG 是否含 alpha | 必须做什么 |
|------|---------|-----------------|-----------|
| **macOS** (Big Sur+) | **必须烘焙进 PNG** | 是（squircle 外为透明） | 设计师在 1024 画布中绘制 824 squircle 内容 + 100px 透明 padding 给 dock 阴影 |
| **iOS** | **系统自动遮罩**（强制） | **否**（含 alpha 会被 App Store 拒：ITMS-90717） | 必须提供方形不含透明的 PNG，iOS 系统在显示时自动加圆角 |
| Windows/Linux/Android | 跟随 PNG 本体形状 | 是（squircle 外为透明） | PNG 是 squircle 就显示 squircle |

**规则**：当任务是"所有平台统一 squircle"时，**iOS AppIcon 必然有平台特殊性**：
1. 给 `pnpm tauri icon` 喂入烘焙好的 squircle PNG（带 alpha）
2. Tauri 自动检测 iOS 平台并把 squircle 外的透明合成为白色 → 生成方形不含 alpha 的 AppIcon-*.png
3. iOS 设备上系统对 AppIcon 加圆角遮罩，最终显示仍是 squircle 形状

**这不是 bug，是 Apple 平台规范**。盲审看到 iOS AppIcon 四角是 `RGBA=(255,255,255,255)` 不要判 FAIL，要识别为正常合成。

### `pnpm tauri icon` 实际覆盖范围远超 `bundle.icon` 数组

`tauri.conf.json` 的 `bundle.icon` 数组只列了少数 key files（如 32x32 / 128x128 / .icns / .ico），但 `pnpm tauri icon` 命令实际会**覆盖更多文件**：

- ✓ `src-tauri/icons/{32x32,64x64,128x128,128x128@2x,icon}.png` (通用)
- ✓ `src-tauri/icons/icon.{icns,ico}` (macOS / Windows)
- ✓ `src-tauri/icons/Square{30,44,71,89,107,142,150,284,310}x*Logo.png` + `StoreLogo.png` (Windows Store / WinRT)
- ✓ `src-tauri/icons/ios/AppIcon-*.png` (18 个 iOS 尺寸，自动合成白底)
- ✓ `src-tauri/gen/android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round,_foreground}.png` (15 个 Android 文件)

**规则**：审计图标资源覆盖范围时，**不能**只看 `bundle.icon` 数组，必须实际跑一次 `pnpm tauri icon` 然后对比文件时间戳。否则审计报告会把 Square*Logo / iOS / Android mipmap 误判为"不会被覆盖、需要手动处理"。

### macOS squircle 数学：superellipse 不是普通圆角

Apple 自 Big Sur 用 **superellipse** `|x|^n + |y|^n = 1`（n=5 近似 Apple 连续曲率），不是 CSS `border-radius` 的圆弧。视觉差异：

- **圆角矩形**：直边 → 圆弧 → 直边（有明显切换点）
- **squircle**：曲率连续从中心扩散到角落，整体更"软"更"圆润"

实现踩坑（[scripts/icons/make-squircle.py](scripts/icons/make-squircle.py)）：

```python
# ❌ 错误：先 paste 内容到大画布再 multiply 大 squircle mask
# 内容方形完全落在大 squircle 内部 → 圆角对内容不可见
img.thumbnail((824, 824))
canvas.paste(img, (100, 100), img)   # 824 方形 alpha=255 落在 1024 画布
mask = make_squircle_mask(1024)
final = ImageChops.multiply(canvas.alpha, mask)   # squircle 半径 > 824 方形对角 → 无圆角效果

# ✅ 正确：先用与内容同尺寸的 squircle mask 剪源图，再放进 padded 画布
img.thumbnail((824, 824))
content_mask = make_squircle_mask(824)
img_squircle = apply_alpha(img, content_mask)   # 824 内容本身被剪成 squircle
canvas.paste(img_squircle, (100, 100), img_squircle)  # 居中到 1024
```

**关键判断**：squircle mask 的尺寸**必须等于**要被剪的内容尺寸，**不能等于**最终输出画布尺寸 —— 否则内容方形会完全包含在更大的 squircle 内部，圆角看不见。

### 一键流程

源图 → squircle → 全平台派生：

```bash
# 1. 准备方形 1024+ 源图（scripts/icons/make-squircle.py 拒绝非方形）
# 2. 生成 squircle padded PNG (1024×1024, alpha squircle)
python3 scripts/icons/make-squircle.py image/YourSource.PNG scripts/icons/app-icon-squircle.png

# 3. Tauri 派生全平台（macOS .icns + Windows .ico + iOS 自动合成白底 + Android mipmap）
pnpm tauri icon scripts/icons/app-icon-squircle.png
```

中间产物 `scripts/icons/app-icon-squircle.png` 入 `.gitignore`（可由脚本随时重生），`scripts/icons/make-squircle.py` 入仓。

## macOS 系统钥匙串(keyring)访问要省着用：每次 get/set 都可能弹系统密码框

### 一次登录弹 N 次密码框的两类根因

桌面端用 `keyring` crate(macOS `apple-native` = 登录钥匙串)存账号密码时，**每次 `get_password()`/`set_password()` 都是一次钥匙串访问**——当 App 未签名 / ad-hoc 签名(签名身份每次构建都变)时，item 的 ACL 不信任当前身份 → **每次访问都弹系统密码框**，且「始终允许」也压不住(身份不稳定)。所以登录路径上的钥匙串访问次数 = 弹框次数，必须压到最少。

两类把"1 次必要访问"放大成"N 次弹框"的反模式：

1. **移动端的重试循环被桌面也跑**：为移动端生物认证(指纹失败自动重试 `MAX_RETRIES=5`)写的 `while` 重试循环若**没用 `isMobile()` 门控**，桌面也会跑——而桌面 `getPassword` = 钥匙串读，读失败被当"生物认证失败"重试 → 每次重试再弹一次 → 一次登录弹满 5 次。**规则**：凡是"失败自动重试"的认证循环，必须 `if (isMobile())` 门控；桌面钥匙串读**失败即转手动输入**，不重试(系统钥匙串弹框不是可重试的生物认证)。

2. **保存账号时无条件重写密码**：`save_account` 若无条件 `set_password`(写钥匙串)，那么登录流程里每次"刷新昵称/头像"都调 `saveAccount(…password…)` → 每次都重写钥匙串 → 每次弹框。尤其"已保存账号登录"——密码**刚从钥匙串读出、根本没变**，再写回纯属多余；以及"头像下载后 `.then(saveAccount(…password…))`"也是冗余写。

3. **`set_password` 对【已存在】条目是 find+modify 两次操作 = 双弹框**(2026-06-05 实测查证)：keyring 3.6.3 `apple-native` 的 `set_password` 走 `security-framework` 的 `set_generic_password`(`os/macos/passwords.rs:269`)，它对**已存在**条目是 `find_generic_password`(读，ACL 弹框①) + `item.set_password`(改，ACL 弹框②)**两次**门控操作；只有条目**不存在**时才是单次 `SecKeychainAddGenericPassword`(ADD，应用自有不弹框)。所以"新登录 1 次写"这句**只对全新账号成立**；对**已存在账号重写密码**(再次登录/手动兜底)是 **2 次弹框**。**规则**：手动登录路径(`handleLogin`)必须 `isNewAccount ? saveAccount(…) : updateNickname(…)`——新账号才写钥匙串(ADD 单次)，已存在账号只更 JSON 元数据(0 写)。**代价**：已存在账号此处不再刷新本地密码 → 服务端改密后本地失效，需删账号重登(个人验证期可接受，须注释声明)。`get_password` 是单次 find(1 读 1 弹框)，无此问题。

### 规则：元数据写(JSON) 与 凭据写(钥匙串) 必须分开

- 把账号信息(昵称/头像路径/server)存普通 JSON 文件，把**密码单独**存钥匙串。
- 提供**只改元数据、不碰钥匙串**的命令(本项目：`update_account_nickname` / `update_account_avatar`，均只 `write_accounts` 不调 keyring)，登录后刷新昵称/头像走它们。
- 钥匙串**写**只在"用户首次输入/修改密码"那一刻发生(本项目：手动登录/注册的 `saveAccount`)。已保存账号登录、信息刷新一律不写钥匙串。
- 目标：已保存账号登录 = **1 次钥匙串读(0 写)**；**全新账号**登录 = **1 次 ADD(不弹框)**；**已存在账号手动重登 = 0 写**(走 updateNickname，见上 #3，否则 find+modify 双弹框)。

### 彻底消除弹框 —— macOS 已改 App 私有 AES + Touch ID(2026-06-06 落地)

**根因复核(查证 Apple 官方 + Tauri 社区 + keyring crate 源码)**：未签名 / ad-hoc 签名 App 读系统钥匙串，`SecKeychainFindGenericPassword`(keyring `apple-native` 用的 legacy API)对"非本签名创建的条目"弹 ACL 框；Apple DTS(Quinn,论坛 thread 649081)证实可弹两个框("use confidential information" + "access key")。dev 每次 `cargo build` 签名变 → 每次都弹,点「允许」(非「始终允许」)下次还弹。**调试埋点实测确认：代码只读 1 次 keychain,2 个框全来自这一次调用 → 纯 OS/ACL 行为,代码层无解。**

**为什么 keyring 自带的"数据保护钥匙串"也不行**：`use_apple_protected_store()`(iOS 风格,支持 Touch ID)在 macOS 需 `keychain-access-groups` entitlement = **必须签名**,未签名报 `errSecMissingEntitlement(-34018)`。Touch ID 用在钥匙串条目同样要数据保护钥匙串(legacy 文件型钥匙串**结构上不支持生物识别**,只认账户密码)。

**落地方案(macOS only,仅 macOS 改,Win/Linux 保留 keyring)**：[macos_credential_store.rs](../../src-tauri/src/macos_credential_store.rs) —— 密码 AES-256-GCM 加密写 App 私有 `credentials.enc`(0600)；密钥 `SHA256(内置salt ‖ gethostuuid())`(换机不可解、不存盘)；读取前 `LAContext.evaluatePolicy(.biometrics)` Touch ID 门禁(objc2-local-authentication + block2 + mpsc 同步),失败/取消/无硬件 → 返回错误,前端 desktop 分支转手动登录(回退)。`storage.rs` 三套 cfg(macOS AES / Win-Linux keyring / mobile stub),`StorageError::Keyring`+`From<keyring::Error>` cfg 排除 macOS、`Crypto`/`Biometric` cfg macOS(否则 dead_code → clippy FAIL)。`Info.plist` 加 `NSFaceIDUsageDescription`。
- **安全取舍(已与用户确认)**：未签名拿不到 Secure Enclave,密钥必须 App 无提示可派生 → 本质"强混淆 + Touch ID 体验门禁",非强加密,比系统钥匙串安全性下降,换 0 弹框 + Touch ID。
- **Touch ID 未签名 dev 可行性需真机实测**(LAContext 不像钥匙串 ACL 依赖稳定签名,大概率可用;`tauri dev` 裸二进制无 .app Info.plist 时行为待验)。
  - 🔴 **「裸二进制无 .app Info.plist 时行为」已于 2026-08-13 验掉：窗口起得来但渲染白屏**，
    详见 [rust-dev.md](rust-dev.md)「macOS 真机载体必须是 `.app`」一节 —— 那不是 App 缺陷，是没有 bundle。
  - ✅ **「无硬件 → 转手动登录」已于 2026-08-13 真机验证成立**（此前记的「只是设计意图、未验证」
    与「两条通道零反馈」两句**均已作废**，作废依据见本文件末尾同名一节）。在 `hw.model=VirtualMac2,1`、
    `ioreg -c AppleBiometricSensor` 计数 0、`bioutil -r` 报错的机器上，用**真安装件**装的 **v1.1.22**
    （登录路径上还留着那道门禁的最后一版）实测：鼠标点「登陆」**约 2 秒内**红字给出
    「Touch ID 未通过，请手动输入密码登录」并切到手动登录表单（账号已预填）；键盘通道
    （Tab→↓→Enter）给出**逐字相同**的回退。⇒ 该分支**不是**静默失败。
  - ⚠️ 适用范围：这道门禁**只存在于 v1.1.23 及更早**。v1.1.24（`ee58f2d`）已把它从登录路径摘掉，
    所以**当前版本根本走不到这条回退**——选已保存账号直接解密登录。打开 VPN 前的生物识别是
    **另一条独立路径**（`biometric_authenticate` → `macos_biometric`），不受影响。
- **Developer ID 签名**仍是另一条路(签名稳定后系统钥匙串点一次「始终允许」永久生效)。

### 反例(2026-06-04)

- macOS 上一次"已保存账号登录"弹 5 次系统密码框。根因：`handleLoginWithAccount` 的 `MAX_BIO_RETRIES=5` 重试循环未 isMobile 门控(桌面照跑)+ 登录后 `saveAccount` 重写密码 + 头像后 `.then(saveAccount)` 再重写。
- 修复(纯前端)：重试循环 `if(isMobile())` 门控、桌面读失败转手动登录；已保存账号登录改 `updateNickname`(不碰钥匙串)、删两处头像后 `saveAccount` 冗余重写。降到 1 读 0 写。
- 教训：写"认证重试循环"先想清桌面/移动语义差异；`save_account` 这种"既写元数据又写凭据"的命令，在"只想更新元数据"的调用点会偷偷多写一次钥匙串。

## 三方 UI 库的浮层默认 z-index 必须对照项目 z-index 阶梯显式设置

### 库默认值撞上项目高 z-index 浮层 = 只有真机可见的遮挡 bug

三方 UI 库的浮层组件（拖拽 overlay / tooltip / dropdown）自带 z-index 默认值（如 dnd-kit `DragOverlay` 默认 **999**）。本项目既有浮层普遍在 **10000** 级（模态/面板）。默认值直接用 = 新浮层被既有面板遮挡。此类层叠 bug **vitest（jsdom 不渲染层叠）测不出**，只有真机/真浏览器可见。

**规则**：引入任何带浮层的三方组件时：
1. 查该组件的 z-index 默认值（文档或源码）
2. grep 项目内相关容器的 z-index（如 `grep -n 'z-index: 10' src/styles/`），确认阶梯
3. 显式传入高于共存浮层的值（如 `<DragOverlay zIndex={10001}>`），并注释说明相对哪个浮层

**反例（2026-07-14）**：侧边栏双区拖放的 DragOverlay 未显式设 zIndex，拖拽幽灵卡被 z-index 10000 的「更多」面板遮住——vitest/typecheck/lint 全绿，VM 真机截图才暴露；修复 `<DragOverlay zIndex={10001}>`（Sidebar.tsx，注释说明面板 10000）。

## 无 tty 环境的 git push 挂死：先怀疑凭据交互，不是网络

### 判据是进程链，不是网速

本机全局 `credential.helper` 是 **Git Credential Manager**（`git config --global --get credential.helper` → `/usr/local/share/gcm-core/git-credential-manager`）。当 keychain / `~/.git-credentials` / `~/.gcm` / `gh auth` 里都没有 GitHub 凭据时，GCM 会走**交互式 OAuth**；agent 环境无 tty，它既弹不出界面也等不到输入 → **永久挂起**。表现极像"网慢/被墙"：实测挂满 15 分钟、零字节传出、远端 ref 纹丝不动。

**判据**（别猜，看进程）：进程链是 `git push → git remote-https → git-credential-manager get`，且 `git-credential-manager get` 长期 **0% CPU 存活** = 卡在等输入，不是在传数据。

**解法**：从金库运行时取 token + **内联 credential helper**（一次性，不落盘）：

```bash
GIT_TERMINAL_PROMPT=0 git \
  -c credential.helper= \
  -c credential.helper='!f(){ echo username=<user>; echo "password=$GH_TOKEN"; };f' \
  push origin main
```

- 第一个 `-c credential.helper=`（**空值**）用来清掉继承的 GCM，**不可省** —— git 的 helper 是**列表**语义，只追加不覆盖；不先清空就仍会回落到 GCM，照样挂。
- `GIT_TERMINAL_PROMPT=0` 让任何残余的交互式提问直接失败而不是挂住。
- `gh` 同理：**`export GH_TOKEN=<token>` 即可，不需要 `gh auth login`**（后者本身就是交互式的）。
- 本仓是**公开仓**：token 只运行时取，不落盘、不写进提交物、不进交付文本（交付里写 `<REDACTED …>`）。

### 🔴 那个 token 从哪儿取 —— 金库路径与取用纪律（2026-08-13 补）

上面把**怎么用**写得极细（连"第一个空值 `credential.helper=` 不可省"都写了），
却从来没写**从哪儿取** ⇒ 每一个新来的执行方都在同一处卡住，**而卡住时这份文档看起来是完整的**。
这与本仓另一条教训同族：「给值不给坑」与「给用法不给出处」是同一个病。

- **金库**：`~/.claude/secrets/credentials.env`（权限 `0600`，**不在任何 git 仓内**，`KEY=value` 一行一条）。
- **键名一律现枚举，不许照抄任何文档里的例子** —— 键名会漂（上一节举例用的那个键名，
  在当前金库里已经不存在了）：

  ```bash
  /usr/bin/grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_]+=' ~/.claude/secrets/credentials.env
  ```

  字符类**必须含数字** —— 本文件「grep 字符类漏数字 ⇒『查不到』是假的」那条坑，
  栽的正是在金库里找 token 这件事。
  枚举出的 GitHub PAT **只有一把就直接用；有多把就停下上报**，别自己挑一把。
- **用之前先验最小权限**：拿它做一次只读调用（如查仓元信息）确认 scope 够。
  推一个改了 `.github/workflows/*` 的提交需要 `workflow` scope，缺了会被 GitHub 直接拒。
  🔴 **scope 不够就停下上报 —— 不许换别的 token、不许降级绕过、不许扩权。**
- 🔴 **取用纪律**：只在**运行时** source / 取值；**绝不落盘、绝不打印、绝不写进任何提交物、
  测试、注释或交付**，交付里一律写 `<REDACTED>`。**本仓是 PUBLIC 公开仓。**
  连"自证已遮蔽"的命令本身也不许带明文 —— 用不含明文的正则 / 长度 / 指纹比对。

### 给可能挂死的命令设时限：macOS 没有 `timeout`

macOS 自带 BSD 工具集**没有 `timeout`，也没有 `gtimeout`**（`command -v timeout` 空、rc=1，除非另装 coreutils）。而 `perl -e 'alarm N; exec …'` 对 `git` **无效** —— git 会 fork 出 `git-remote-https` / credential helper 等子进程，alarm 打不到真正挂住的那个。

可靠做法：用 python 起子进程并真杀：

```bash
python3 -c "
import subprocess
subprocess.run(['git','push','origin','main'], timeout=120, start_new_session=True)
"
```

超时抛 `TimeoutExpired` 并杀掉子进程；要连子孙进程一起收，配 `start_new_session=True` 后在超时分支 `os.killpg(p.pid, signal.SIGKILL)`。

## 修 bug 之前先取证：现场只有一次

### 修复动作本身往往就是覆盖证据的动作

遇到**机制上解释不通**的异常（断言明明过了结果却不对、ref 指向不该指的 commit、文件内容与刚写入的不符），第一动作是**把现场落盘**，不是修。

**要落的**：相关文件的**内容 + mtime**（macOS `stat -f "%Sm %N" <file>`；Linux `stat -c '%y %n'`）、`git reflog`、相关日志、进程快照（`ps -ef | grep …`）、命令的原始 rc 与 stderr 全文。

**反例（2026-08-06）**：发布后自核发现 tag 指向了错误的 commit，随手 `git tag -f` 改正 —— `.git/refs/tags/<tag>` 的**原始 mtime 被覆盖**，"这个 ref 究竟是什么时候、被哪一步写的"从此无法回答，真因永久失去定位机会（同一症状此前已发生过一次，仍未定位）。

⚠️ 这条纪律 [.claude/skills/release/SKILL.md](../skills/release/SKILL.md) 坑 4 里已针对 tag 单独写过一次（"别急着 `git tag -f` 覆盖掉证据"），**仍被违反** —— 说明它不能只挂在某条具体流程下，属于**通用纪律**：任何"先修一下看看"的冲动，都要先问"我这一下会不会抹掉唯一的现场"。

## grep 字符类漏数字 ⇒ "查不到"是假的

### `[A-Z_]` 不含数字，真实标识符里数字很常见

写环境变量名 / 标识符的正则时，`[A-Z_]` **不匹配数字**。而真实标识符里数字极常见，一个数字就让整条模式**恒不匹配**，于是得出"这东西不存在"的错误结论。

**实测**：

```bash
echo 'GITHUB_PAT_RELEASE2024=xxx' | grep -E '^[A-Z_]*(GITHUB|GH|GIT)[A-Z_]*='       # 无输出，rc=1
echo 'GITHUB_PAT_RELEASE2024=xxx' | grep -E '^[A-Za-z0-9_]*(GITHUB|GH|GIT)[A-Za-z0-9_]*='  # 命中，rc=0
```

**规则**：

1. 标识符字符类一律写 `[A-Za-z0-9_]`（或 `\w`），不要图省事写 `[A-Z_]`。
2. **"查不到"先怀疑自己的模式，再下"不存在"的结论。**
3. 想用一个模式证明"不存在"之前，先拿一个**已知存在**的样本喂给它，确认它真能命中 —— 没做这步的"没找到"不是证据。

**反例（2026-08-06）**：用 `^[A-Z_]*(GITHUB|GH|GIT)[A-Z_]*=` 在金库里找 GitHub token，因 `GITHUB_PAT_RELEASE2024` 里的 `2024` 恒不匹配 → 误判"金库里没有 token"，转头去折腾别的登录方式，白绕一大圈。

## ping 的 TTL 判读看【应答方】的初值，不是发起方

### 初值由回包那一端的 OS 决定

TTL 初值：**Windows 128**，**Linux / macOS 64**。判"中间有没有经过转发/隧道跳"，要拿收到的值跟**应答方**的初值比：

| 场景 | 收到 TTL | 含义 |
|------|---------|------|
| mac ping Windows | 128 | 直连，**未**经转发 |
| mac ping Windows | 127 | 经了 **1 跳**转发 |
| Windows ping mac/Linux | 64 | 直连 |
| Windows ping mac/Linux | 63 | 经了 1 跳 |

**规则**：判读时把"应答方是谁、它的初值是多少"**显式写出来再减**，不要把这张表压缩成"127 就是转发"之类的单行速记 —— 方向一换就错（本仓在 HuanvaeGuard 真机验证里因此写错过一次）。用途：HG 隧道 up/down、mesh 互联、LAN 传输这类"包到底走没走隧道"的判定，全靠它。

## 管道喂给 `bash -s` 的脚本里，`ssh` / `adb shell` 会吃掉 stdin（**内外两个方向都要管**）

### 症状：输出在第一条 ssh 之后整齐截断，且 stderr 全空、rc=0

把一段多命令脚本用 `subprocess.run(['ssh', host, 'bash -s'], input=script)` 喂过去时，输出**只到第一条 `ssh` 为止**，后面的命令一条都没跑 —— 而且 **stderr 全空、退出码 0**。看起来像"命令卡住了"或"远端没装那个工具"，极易误判成环境问题。同一现象连续骗了 3 次（分别被误判为"引号转义错"、"PowerShell 语法不兼容"、"远端命令超时"）。

### 根因：脚本正文和 ssh 的输入是同一个 stdin

`ssh` 默认**从 stdin 读数据并转发给远端**。而脚本本身正是通过 stdin 喂进 `bash -s` 的 —— 于是第一条 `ssh` 把**剩下的脚本正文**当成要转发的输入全部吞掉，后续命令根本不存在于 shell 的读取流里。不是引号问题，不是超时，也不是远端环境。

### 规则

1. 任何**脚本本身来自 stdin** 的场景（`bash -s`、`bash <<EOF`、`curl … | bash`），内层 `ssh` 一律加 **`-n`**（等价 `< /dev/null`）。`scp` 同理 —— 它也会读 stdin，写作 `scp … </dev/null`。

   ```bash
   # ❌ 第一条 ssh 吞掉后面所有脚本正文
   ssh <主机> 'uname -a'
   echo "这行永远不会执行"

   # ✅ -n 让 ssh 不碰 stdin，脚本正文完整留给 bash -s
   ssh -n <主机> 'uname -a'
   echo "这行会正常执行"
   ```

1-bis. 🔴 **外层那条 `ssh` 反过来：绝对不能加 `-n`。** 脚本正文是**经 stdin 喂给它**的，
   `-n` 等于把 stdin 换成 `/dev/null` ⇒ **脚本根本没送到远端**，远端 `bash -s` 读到 EOF 直接退出。
   表现是 **rc=0 + stdout 完全为空 + stderr 为空** —— 比"截断"更没线索，极易误判成"远端没输出"。

   ```python
   # ❌ 外层加 -n：脚本压根没送过去，rc=0、输出全空
   subprocess.run(['ssh','-n',host,'bash -s'], input=SCRIPT, capture_output=True, text=True)
   # ✅ 外层不加 -n（它要靠 stdin 收脚本）；内层每条 ssh/adb/scp 各自 </dev/null
   subprocess.run(['ssh',host,'bash -s'], input=SCRIPT, capture_output=True, text=True)
   ```

   ⇒ **一句话记法**：`-n` 是给**脚本里面**那些吃 stdin 的命令用的；**运载脚本的那一条**加了就等于没发。

1-ter. 🔴 **`adb shell` 与 `ssh` 同族，也吃 stdin**（`scp` 已在上条提过，同理）。
   `bash -s` 脚本里每条 `adb shell` 不加 `</dev/null`，就会把**后续脚本正文**当成要转发给设备的输入吞掉。

   ```bash
   echo ---BOOT---; adb shell getprop sys.boot_completed 2>&1             # ❌ 后面五段全没了
   echo ---BOOT---; adb shell getprop sys.boot_completed </dev/null 2>&1  # ✅
   ```

   **三点阶梯实测（2026-08-11，同一台构建宿主、同一段 7 行脚本，只改这两个开关）**：

   | 写法 | 输出 |
   |---|---|
   | 外层 `ssh -n` + 内层裸 `adb shell` | rc=0，**stdout 全空**（脚本没送到） |
   | 外层不加 `-n` + 内层裸 `adb shell` | rc=0，输出**停在第一条 `adb shell` 之后**，其余 5 段全丢，stderr 空 |
   | 外层不加 `-n` + 内层每条 `</dev/null` | rc=0，**6 段全部打印** |

2. **判据**：**"输出在某条命令后整齐截断 / 或整体为空 + stderr 为空 + rc=0"** = 先怀疑 stdin 被吞，别先怀疑引号 / 超时 / 远端环境。有报错信息的失败才是真失败；**无声截断**是被吃了输入。
3. 循环里跑 ssh（`for h in …; do ssh $h …; done`）是同一个坑的经典形态：第一次迭代就把循环的输入吃光，循环只转一圈。

**反例（2026-08-06，实测）**：跨机取证时连发 4 版脚本，每版都只打印出第一段就"没了"，stderr 空、rc=0；加 `-n` 后同一版脚本一次跑完全部 5 段。

## 用 grep 判「有没有发生」之前，先确认时间窗能覆盖该日志的产生时机

### 判据本身会坏：窗口选错时，`0 命中` 是盲区，不是结论

排查「某后台循环/消费者到底起没起来」时，常见做法是 `journalctl --since -6h | grep '<启动日志>'`。
但**启动类日志只在进程启动那一瞬间打印一次**——如果服务已经连续运行了好几天，
那么任何「最近 N 小时」的窗口里**必然是 0 命中**。此时把 0 读成「它没启动」，
就是**拿判据的盲区当结论**，而且这个错误会指着你去改一个根本没坏的东西。

**规则**：

1. 先问这条日志**多久打印一次**：启动时一次？每次事件？周期性？
   - **启动时一次** → 窗口必须放到 **`--since` = 服务本次启动时间**（`systemctl show -p ActiveEnterTimestamp`），不是「最近 N 小时」。
   - **每次事件** → 窗口才可以用相对时间。
2. **先跑正对照（sanity check）**：确认该窗口内 `journalctl` **真有输出**。
   否则 `0` 到底是「没有这个事件」还是「压根没日志」无法区分——两者结论完全相反。
3. 断言「没发生」之前，先拿一个**已知会命中**的模式验证管道是通的（同 grep 字符类那条的思路）。

```bash
# ❌ 服务自 08-04 起未重启，-6h 里必然 0；据此判「总线没启动」= 误判
journalctl -u <svc> --since -6h | grep -c '实时总线消费循环启动'

# ✅ 窗口对齐到本次启动 + 先验管道非空
START=$(systemctl show -p ActiveEnterTimestamp --value <svc>)
journalctl -u <svc> --since "$START" | wc -l                      # sanity: 必须 > 0
journalctl -u <svc> --since "$START" | grep -c '实时总线消费循环启动'
```

**反例（2026-08-07）**：排查 App WS 实时推送失效时，第一版探针用 `--since -6h` 找
「WS 跨实例实时总线消费循环启动」，三个后端实例自 `2026-08-04` 起从未重启 ⇒ 窗口内恒为 0。
若据此上报「总线未启动」，会把排查方向整个带偏。改为「服务启动以来」窗口 + sanity check 后判据才成立。
这条与本文件「grep 字符类漏数字 ⇒『查不到』是假的」同源：**「没找到」先怀疑自己的查法，再下不存在的结论**。

## 「本地面弱默认口令」先判暴露面，只报不改、且报一次

发现某服务在用弱默认口令时，**先判暴露面**再决定要不要提：绑 `127.0.0.1`（本地面）
还是 `0.0.0.0`／有无经反代对外暴露。**本地面的一律「只报不改」**——擅自改控制面口令
可能把持有者自己锁在外面，且它本来就不在攻击面上。**报一次即可**，别每单重复上报。

**反例（2026-08-07）**：Atlas 本地控制面（绑 `127.0.0.1:28085`）用弱默认口令，
按「只报不改」上报后由 huanwei 裁决**维持现状**（原话「atlas不动,其是本地的」）。
判断链正确，但若每单都重报一次就是噪音。

## 「命中了」不等于命中的是那一类行 —— 计数式判据必须先确认它数的是什么

已有两条讲**假阴性**（`grep` 字符类漏数字 ⇒「查不到」是假的；时间窗选错 ⇒「0 命中」是盲区）。
这一条讲**假阳性**：模式**命中了**，但命中的**根本不是你以为的那类行**，于是把结论推向反面。

**规则**：任何「在某段文本里数某类东西」的判据，落笔前先答两问：

1. **这类行长什么样？**（有没有唯一的行首标记？）—— 有就**锚定行首**，别只匹配关键词；
2. **同一份文本里还有谁会含这个关键词？**（头部 / 元数据 / 摘要 / 引用）—— 它们是**结构性**存在的，
   不是偶发噪声，光靠"看看命中数大不大"分辨不了。

**反例（2026-08-11，安卓 logcat 崩溃判读，差点把非业务崩溃判成业务崩溃）**：

想判「崩溃栈里有没有 App 自己的帧」，第一版判据是「在崩溃块里 `grep` 包名」⇒ 得 2 命中 ⇒ 险些定性成业务崩溃。
逐条打开才发现那 2 行是**崩溃报告头部**：`Cmdline: <包名>` 和 `pid: … name: hwuiTask1 >>> <包名> <<<` ——
崩溃报告本来就要标明**是哪个进程崩了**，出现包名是**必然**的，它们不是栈帧。

⇒ 正确判据只数**真正的栈帧行**（安卓栈帧固定以 `#NN pc ` 开头）：

```bash
grep -cE '#[0-9]{2} pc ' logcat-full.txt                                   # 22（总栈帧数）
grep -cE '#[0-9]{2} pc .*(<你的包名>|libapp|tauri|wry)' logcat-full.txt     # 0（App 库帧）
grep -c '<你的包名>' logcat-full.txt                                        # 2037（← 假阳性面有多大）
```

22 帧 = libc 14 + libhwui 6 + libc++ 2，**App 库 0 帧** ⇒ 进程销毁期平台渲染线程池 teardown 竞态，
非业务崩溃。**但仍不得声称「零崩溃」** —— 崩溃标记确实进了 logcat（`SIGABRT` 4 行 / `tombstone` 8 行，
每次崩溃各占 2 行 ⇒ 2 次），交付只能写「N 次**非业务**崩溃 + backtrace 依据」，不许四舍五入成 0。

## 设置项的**读数**不等于系统的**实际形态** —— 形态类判据要拿产物本身当证据

「我设过了 / 读数是对的」**不能**证明系统真的处于那个形态：写入的是**意图**，生效的是**另一条链路**。
形态类结论（导航模式、主题、语言、权限、DPI……）必须由**产物自身**（截图 / 真实响应）来证。

**反例（2026-08-11，安卓导航模式，判据与画面直接打架）**：

- `settings put secure navigation_mode 0` 之后 `settings get secure navigation_mode` **确实返回 0**，
  但**画面底部仍是手势药丸** —— 真正切换 3 键导航的是
  `cmd overlay enable com.android.internal.systemui.navbar.threebutton`。
  ⇒ 只信读数 ⇒ 会把一批**手势导航下拍的图**标成「3 键导航正对照」，对照组直接作废。
- 反过来，**截图自己带着形态证据**，零成本且不会过期：
  底部**一条居中横条（pill）** = 手势导航；底部**三角 / 圆 / 方三键** = 3 键导航。

⇒ **两条纪律**：

1. 验收「某形态下的行为」时，**每张图都要看得见该形态的特征**；看不见 = 那张图不是在验收形态下取的，
   不能拿来当证据（本 run 就是靠这一眼认出：一批「返回成功」的旧图是 3 键导航下拍的，
   证不了手势导航——也就是真机默认形态——下同样成立）。
2. 需要**正对照**时，切换完**先拍一张确认形态真的变了**，再开始跑用例；跑完切回来也要拍一张留痕。

## 上游描述与实测冲突时，以实测为准 —— 先解矛盾，再动手

### 描述来自谁都一样：需求方本人、上级、任务卡，都可能与证据打架

收到「X 坏了，去修」时，若**手头证据与该描述冲突**，**不许照描述直接动手**。
必须先判定**哪个判据是坏的**，再决定做什么。照描述硬修的代价不是"白做一遍"——
而是**去改一个没坏的东西**，浪费一条线，还可能把好的改坏。

**规则**：

1. 描述与证据冲突 ⇒ **先解矛盾**：那个与描述不符的读数**因何而来**？两边各自的判据是什么？
2. 解不了就**回问需求方**，而不是挑一个顺手的判据往下推。
3. 只有矛盾消解后才进入实现。**证伪也是产出** —— 「这个功能本来就是好的」是完全合格的结论。

**反例与正例（2026-08-07，同一天两次，同族）**：

- **需求「群组里其它用户设备在线状态不显示」**：派单时发现描述与**需求方自己的截图**对不上 ——
  他说"只显示自己在线"，截图里三台设备却有**两台在线**。没有照描述派修，而是要求
  「先解释这个矛盾读数」并回问 ⇒ 需求方复核后撤销：「看错了，**功能本来就是正常的**」。
  **若当时直接照描述派，就会去修一个没坏的东西。**
- **需求「HG 页面统计恒 0，根因是守护进程改成了绝对 Unix 时间戳」**：派单前先抓守护进程真实响应，
  实测 `{"last_handshake":71,"rx_bytes":1768,...}` —— 字段名与 App 侧**完全一致**，
  取值是**距今秒数**不是绝对时间戳 ⇒ **任务卡给的两条根因假设在 macOS 侧双双证伪**。
  真正要抓的是**另一个平台的**守护进程响应（不同二进制、契约可能不同）。
  **若照卡直接改 `formatHandshake` 的语义，就会把 macOS 上本来正确的解析改坏。**

### 配套：这条与「判据本身会坏」是一体两面

上一节讲的是**自己的判据**可能坏（时间窗、正则、路由没装上）；本节讲的是**别人给的描述**可能坏。
两者的解法是同一个：**先跑正对照，让证据自己说话**，不要让任何一方的叙述直接变成行动。

## 先读官方一手文档，再动手 —— 不许先盲试

「这个平台/框架到底要求什么格式/字段/前置条件」这类问题，**答案在官方文档里，不在试错里**。
先盲试再回头补文档，代价是数量级的差别：官方一页写清的事，盲试可能烧掉几小时还得不到确定结论。

**规则**：

1. 凡问题形如「X 平台/框架**要求**什么」——产物格式、清单字段、端点约束、签名方式、系统策略——
   **第一步是找官方一手文档**，不是起构建、不是排除法。
2. 结论必须能**指到具体页面/章节 + URL**；只写「我查到」不算。
3. **文档与实测冲突时，两个都写出来**，并说明自己的环境特殊在哪（版本、签名形态、非常规配置）。
4. 文档里没写的，如实标「**官方未述，以下为实测**」——不要把实测冒充成规范。
5. ⚠️ **注意区分「官方原话」与「坊间转述」**：很多广为流传的说法（如某操作能绕过某限制）
   是**旧版本的行为**或**社区转述**，平台可能早已改掉。**引用前回到官方原文核对发布时间与适用版本。**

**反例（2026-08-08）**：修 macOS 内置更新时，先花几小时排空白屏、跟一个 release 构建
根本不接受的本地 http 假源较劲、起了 25 分钟未完的 debug 构建；事后读 Tauri v2 官方 updater 文档，
**Building 章节一段就写死了**：macOS 更新产物是 `.app.tar.gz` + `.sig`，而 Linux 用 `AppImage`、
Windows 用 `-setup.exe`/`.msi`（复用安装包本身）——**唯独 macOS 需要额外 tar.gz**，
这正好解释了「为什么只有 macOS 这条更新通道坏了」，也说明 `.dmg.sig` 从来不存在是**设计如此**而非疏漏。

**同批的两次「转述当原话」**（督办侧犯的）：
- 「右键→打开应当给出放行入口」—— **Apple 已在 macOS 15 Sequoia 正式移除该绕过**
  （官方公告 `developer.apple.com/news/?id=saqachfa`），这是**已作废的旧说法**；
- 「Finder 拖拽会清掉 translocation 倾向」—— 核完 Apple 原文后确认：**与原话不冲突，冲突的是坊间转述**。

### 这条与另两条纪律是同一族

| 纪律 | 防的是 |
|------|--------|
| 判据本身会坏，先跑正对照 | **自己的测量**可能坏 |
| 上游描述与实测冲突，先解矛盾 | **别人的描述**可能坏 |
| **先读官方一手文档，不许先盲试** | **自己的假设**在无权威锚点时会打转 |

共同点：**别在自己的假设里打转，先去拿权威 / 正对照 / 一手证据。**

## 多线共用一台 mac 做真机实验：`open` 不是可靠的启动方式

`open <app>` 会因 **bundle identifier 相同**而**激活已在运行的那个实例**，而不是启动你指定的那份。
多条线在同一台机器上各自构建 app 做实验时，这会导致「我明明 open 的是自己的产物，起来的却是别人的」。

**规则**：要启动**你自己构建的那份** app，**直接执行 bundle 内的可执行文件**绕过 LaunchServices：

```bash
# ❌ 可能激活别人的实例
open /path/to/MyBuild.app
# ✅ 确定启动这一份
/path/to/MyBuild.app/Contents/MacOS/<executable>
```

并且：**别的线放在 `/Applications` 下的 app 是它的实验载体，不要碰、不要退出、不要删除。**

**反例（2026-08-07）**：updater 线 `open` 自己的测试 app，系统直接激活了 `/Applications` 下
另一条线正在观测的实例；它发现后改为直接执行 bundle 内可执行文件，并全程未动那个进程。

## 阳性样本不可再生 —— 取证优先于下一步实验

复现类排查里，**能复现出故障的那个现场（阳性样本）往往只有一个**，而它常常在你「为了做下一步实验」时被销毁
（重启进程、换装另一版本、清理环境）。一旦销毁，**所有悬而未决的候选解释就永远失去了直接取证的机会**。

**规则**：遇到阳性现场，**先把能取的全取完再动别的** —— 进程与 socket 元数据（`ps`/`lsof` 全量）、
流量读数（`nettop`）、服务端同刻日志、相关配置与文件哈希。取证是分钟级的，样本是不可再生的。

**反例（2026-08-07）**：WS 排查中唯一观测到「僵尸连接」的那条 socket，
为了安装另一形态的 App 而随进程退出消失；此后「那份心跳流量究竟由谁应答」的三个候选解释
**再也无法直接取证**，只能永远留在未达成项里。

⚠️ 这与本文件「修 bug 之前先取证」是同一条纪律的两个场景（一个是修复前、一个是下一步实验前），
本 run 内**两次违反**（`git tag -f` 覆盖 mtime、销毁僵尸样本）。

## 向 tmux worker 注入指令后，必须回看 pane 确认它真的开始处理

`tmux send-keys … C-m` 有时**只注入了文本、没有提交**——消息静静躺在输入框里，worker 一直空等。
从发送侧看「命令返回 0」，从接收侧看「什么都没发生」，**双方都不会报错**，
直到有人回头查 pane 才发现已经空转了几十分钟。

**规则**：

1. 注入后**必须回看**：`tmux capture-pane -t <session> -p | tail`。
   - 看到 **spinner / 工具调用 / 新输出** ⇒ 真的在处理；
   - 看到**你发的文本原样躺在 `❯` 提示符后** ⇒ **没提交**，补一次 `tmux send-keys -t <session> Enter`。
2. 更稳的写法是**分两步**：先 `send-keys '<文本>'`，再单独 `send-keys Enter`，中间 `sleep 1`。
3. 🔴 **不要凭「命令 rc=0」就宣称「已下发」** —— 那只证明 tmux 收到了按键，不证明 worker 收到了任务。

**反例（2026-08-07 / 08，同一晚两次）**：
- 第一次：给 WS 线发指令后未回看，worker 空等，直到巡查才发现文本卡在输入框；
- 第二次：给 HG 线发「你的判断我背书 + 主线继续」的长指令，同样未提交，
  **worker 空等约一小时**，期间它本该在做 mac 侧真机验收。
两次都是「发送侧以为已送达」，而**回看 pane 一眼就能发现**。

## 报「环境级不可跑」之前，先查同环境的历史成功记录

把某项检查判成「本机环境跑不了」是一个**很重的结论** —— 它会让人绕过门禁、改用替代验证、
甚至把「本机发不出版本」写进决策依据。下这个结论前，**必须先找同一环境下的历史成功记录**：
现成的反证往往就躺在自己的证据目录里。

**规则**：

1. 先问「**这台机器、这个盘、这条命令，以前跑成功过吗**」——查历史日志、上一次发布记录、CI 记录；
2. 找到成功记录 ⇒ 结论只能是「**这次没跑通**」，不能是「**这个环境跑不了**」，
   两者对决策的含义完全不同；
3. 🔴 **判进程死活不能只看瞬时指标**。`%CPU = 0` 不等于卡死 —— 写盘、等 I/O、单线程收尾阶段
   都会长时间 0% CPU。**判据是退出码与日志末行**，不是 `ps` 的某一帧。
4. 中间产物「还没更新」同理不能当死亡证据：构建会在最后统一写产物，
   **写出来之前目录里当然还是旧文件**。

```bash
# ❌ 拿瞬时快照判死活
ps -o %cpu -p $PID     # 0.0 → 判「卡死」  ← 它可能正在写几十个 chunk
ls -la dist/index.html # 还是旧的 → 当作佐证  ← 产物本就最后才写

# ✅ 等它结束，看退出码与日志末行
wait $PID; echo "rc=$?"
tail -3 build.log      # → "✓ built in 26m 9s"
```

**反例（2026-08-08，同一件事错两次）**：
- 判「前端构建卡死」并标 SKIP，依据是 `0% CPU / 38min / 只剩 esbuild 心跳`；
  **实际它成功了** —— 日志末行 `✓ built in 26m 9s`，产物 mtime 与之吻合、主 chunk 2.97 MB；
- 由此推出「AppleVirtIOFS 导致跑不了」，**而反证就在自己的证据目录里**：
  上一次发布日志（**同机同盘**）实录 前端构建 PASS · Cargo test 69 个 PASS ·
  VPN 连通性 5/5 真跑通过 · 门禁 12/13 —— **同样的环境昨天全跑过**，
  而且那份日志**几轮前刚被自己引用过**，却没被当成反证。

⇒ 正确结论是「**共享盘慢约 50 倍（26m9s vs 31s）但能跑通**」，
本地盘 clone 是**提速手段**，不是**可行性前提**。差之毫厘的措辞，决策含义天差地别。

⚠️ 这条与「判据本身会坏，先跑正对照」是同一族：
**正对照不只是「再跑一次」，也包括「这台机器以前跑成功过吗」。**

## 推翻一个前提之后，必须回头扫全文找所有建立在它之上的论断

发现自己某个结论错了、改掉被指出的那一处，**不等于改完了**。错误结论在写下之后往往已经
**顺着文档扩散**：被别的段落引用、被推出下一层结论、被写进汇总表、被当成另一件事的判据。
只改「别人指出的那一行」，会留下一份**自相矛盾**的文档 —— 更正与旧论断并存，读者不知道信哪个。

**规则**：

1. 推翻前提后，**立刻全文检索该前提的关键词**（结论词、现象词、归因词都要搜），逐处判定：
   - 直接复述该结论的 ⇒ 改；
   - **建立在它之上的推论** ⇒ 整段作废或重写，不要只改措辞；
   - 引用它作为判据的 ⇒ 换判据或撤下该判断。
2. **作废时留痕，不要静默删除** —— 写明「原论证作废、依据是什么」，
   但**不要保留一段与更正互相打架的旧文字**。
3. ⚠️ 特别注意**被自己后续实验"确认"过的结论**：错误前提常会让人设计出一个必然自证的实验
   （见下反例），那次实验的结论要一并作废。

**反例（2026-08-08，同一个误判污染四处）**：
误判「前端构建卡死」（实际它 `✓ built in 26m 9s` 成功了）之后：

| 扩散处 | 形态 |
|--------|------|
| 前置全检表「前端构建」行 | 直接复述 → 标成 SKIP |
| 独立整节的归因分析 | **推出**「virtiofs 跑不了」→ 再推出「29 个会话拖垮机器」，**三层逐层建立在上一层未验证的结论上** |
| 前置全检表「Vitest」行 | 用**同一套错误判据**（超时窗）标成 SKIP |
| 「VPN 连通性」行 | 写成「本机不具备」，而同机日志实录 5/5 真跑通过 |

🔴 **最隐蔽的一处**：为「验证」卡死而做的低负载重试实验，给的超时是 **420s**，
而共享盘上构建本就需 **26 分钟** ⇒ **它必然超时**。
**用一个太短的窗口去验证「卡死」，等于自证预言** —— 那次实验非但没验证什么，
反而让我更确信了错误结论。

⇒ 被指出错误后我只改了第一处，其余三处是**后续两轮自查**才逐一挖出来的。
**主动扫一遍的成本，远低于让矛盾文档流出去。**

## 改系统级网络状态（pf/dummynet）：安全网必须活得比"清场命令"久

给本机注入受控劣化（`dnctl` + `pfctl`）做实验时，规则残留会波及整台机器上所有在跑的线。
除了 `trap` 恢复，还要有**独立看门狗**兜底。但看门狗本身有两个反复踩到的坑：

**① 看门狗不能用定时触发，必须用"主进程消失"触发。**
`( sleep N; 恢复 ) &` 会在**长实验中途**把规则清掉 —— 后面几档就在「以为有损伤、其实没有」的状态下跑，
产出一份**看着正常、实则归因全错**的数据。正确写法是轮询主进程存活：

```bash
MAIN=$$
( while kill -0 "$MAIN" 2>/dev/null; do sleep 10; done; <恢复命令> ) &
```

**② 🔴 看门狗的 argv 必须与主脚本可区分，否则 `pkill -f` 会连安全网一起杀。**
看门狗常写成主脚本的子 shell ⇒ `ps` 里 argv 与主脚本**完全相同** ⇒
`pkill -f '<脚本名>'` 中止实验时**同时命中看门狗**，规则就此残留（实测残留 11 秒才被发现）。
对策：看门狗用独立可执行/独立 argv 起（如 `bash -c '<恢复逻辑>' hv-watchdog`），
或中止实验时**按 PID 精确杀主进程**，不要用 `pkill -f`。

**③ 影响面收窄到单个目标**，不要对全局 443 施加规则 —— 同一台机器上通常还有别的线在跑。
**④ 结束后实证恢复**：`pfctl -s info` 回到基线态、`pfctl -sr` 与基线**逐字一致**、`dnctl list` 为空、
无残留进程、外网连通正常。四条都要，缺一条都可能漏掉残留。

## Cargo feature 会跨 dependent 统一 —— 你写的 `default-features = false` 可能根本没生效

`Cargo.toml` 里对某个包写 `default-features = false` + 精简 features，**不代表最终二进制里它就是精简的**：
只要**另一个依赖**也依赖同一包的同一版本且未关默认 features，Cargo 会把两边的 feature 集**取并集**，
你关掉的那些会被**重新打开**。

**判据：不要读 `Cargo.toml` 就下结论，要读实际解析结果。**

```bash
cargo tree -e features -i -p <crate>@<version> --target <triple>
```

**反例（2026-08-10，本仓）**：`src-tauri/Cargo.toml:53` 写
`reqwest = { default-features = false, features = ["json","rustls-tls","stream"] }`，
据此推断「App 只能走 HTTP/1.1、且不读系统代理」，并准备按这个前提去补 `http2`。
实测 `cargo tree -e features -i -p reqwest@0.12.28` 发现：同文件 `:39` 的 `tauri-plugin-http = "2.5.9"`
**未关默认 features**、依赖同一个 reqwest ⇒ `http2` / `system-proxy` / `charset` / `cookies` **全部被重新打开**，
下载器**本来就在跟对端谈 HTTP/2**。⇒「补 http2」这个动作根本不存在。
旁证：同仓 `secure_net.rs` 专门写了 `pinned_http1_client` 去**强制** h1 —— 正因为 h2 一直可用。

## 数据要穿过几段才到用户面前，就得验几段 —— 只验自己改的那段必然报早

### 判据：症状相同 ⇒ 无法从现象反推是哪一段在丢

一个字段从后端到屏幕，常常要穿过**多段互相独立**的搬运代码。任何一段漏写，
**用户看到的现象完全一样**，而且往往是**静默的**（不报错、不告警、只是东西没了）。
于是「我改的那段好了」＝「功能好了」这个推断**恒不成立**。

本仓「消息字段」这条链实测有 **4 段**，每段都是独立的一处赋值：

| # | 段 | 漏写时的症状 |
|---|---|---|
| ① | 后端下发（DTO / WS 帧） | 前端拿不到，怎么改前端都没用 |
| ② | 本地 SQLite 落库（建表列 + INSERT + SELECT + row 映射） | **重启 / 切会话 / 离线加载后消失** |
| ③ | `LocalMessage` → UI `Message` 转换函数 | 存进去了但读不出来 |
| ④ | WS 实时推送直接构造 UI 对象（**绕过 DB**） | **当场就不显示** |

②③④ 是三处**不同文件里的不同赋值**；③④ 尤其容易漏，因为它们不在"存储"关键词附近。

### 规则

1. **加/改一个跨层字段前，先把这条链的所有段列出来**（grep 该类型的所有构造点：
   `const x: <Type> = {`、`Omit<LocalMessage, ...>`、各转换函数），逐段确认，再动手。
2. **验证要端到端**：「我改的文件的测试过了」不算；要么真机走一遍完整链路，
   要么写**沿链的契约测试**（见 [tests/unit/localMessageFieldRoundTrip.test.ts](../../tests/unit/localMessageFieldRoundTrip.test.ts)）。
3. **让类型系统替你找段**：给 `LocalMessage` 这类中枢类型加**必填**字段（不要 `?:`），
   `tsc` 会把所有构造点一次性列出来 —— 本仓实测一次点出 **10 处**写入路径，
   比任何人工 grep 都全。这是加必填字段最大的好处，别为了少改几行就写成可选。
4. **反向断言**：某处原本是写死 `null` 的，正向断言（`toMatch(/x: msg\.x/)`）会被
   「两行并存」蒙混过去 —— 必须同时断言 `not.toMatch(/x:\s*null/)`。
5. **报「打通」之前问一句**：这条链我**每一段**都看过了吗？没有就说「第 N 段已修，
   其余段未核」，不要说「打通」。

### 反例（2026-08-10，同一 run 内连踩三次）

做「相册（media_group）+ 私聊引用回复」时，连续三次报「已打通」，三次都报早了：

- 报「相册接收侧打通」 ⇒ 实际**②没做**：本地 messages 表根本没有 media_group 三列
- 修完落库报「修好了」 ⇒ 实际**③还在丢**：`localMessageToMessage` 连 `reply_to` 都没带
- 修完转换报「修好了」 ⇒ 实际**④还在丢**：两处 WS 直推构造里，群聊那处 `reply_to: null` 写死

三次根因相同：**只验证了自己刚改的那一段**。而四段中任意一段在丢，
现象都是「静默消失」，无法从现象区分。

顺带暴露一个**既有**缺陷：群聊引用回复自 v1.1.25 就有，但 ②③④ 全在丢
⇒ **别人回复你时引用块从来不出现**，且此前无人发现 —— 正因为它静默。

## 🔴 说「本机没有 X 所以跳过」之前，先问「远程构建宿主能不能跑」

「本机不具备」**不等于**「跑不了」。本工作区常年有可用的远程宿主（Android/Windows 构建机、
mesh 里的 Linux 节点），**它们能提供的是"编译类能力"**。把"本机缺工具链"直接翻译成"这项没法跑"，
等于把**没跑**伪装成**环境不具备** —— 这是最难被发现的一种降门槛，因为它每一步都"合理"。

**可执行判断动作**（看到 `record_skip` / `Record-Skip` / `SKIP` / `-Skip*` 分支就走一遍）：

1. **先分类**，三选一：
   - **① 操作者显式选择**（`--skip-*` / `-Skip*` 参数）—— 是人主动降门槛，与环境无关；
   - **② 环境缺失**（缺 NDK / 缺 target / 缺编译器 / 缺 SDK）—— **一律先问远程宿主**；
   - **③ 需要真实对端 / 运行时链路**（要另一台机器握手、要被系统服务管理器拉起、要真机传感器）
     —— 只有这一类是远程也解决不了的。
2. **② 一律先问远程宿主**：远程有没有这套工具链？先探一次再下结论，探测成本是分钟级，
   而误判的代价是"一个版本的门禁项从此长期不跑"。
3. **结论写成双条件**：真要跳，理由必须写「本机无 X **且** 未配置远程宿主」，
   **不许只写"本机没有 X"** —— 后者是半真话，会把下一个人也带进同一条沟。

**本仓的真实结论表**（2026-08-12 全量盘点两个门禁脚本共 17 处跳过登记点）：

| 类别 | 条数 | 明细 |
|---|---|---|
| ① 操作者显式选择 | 13 | `--skip-rust` / `--skip-android` / `--skip-e2e` / `--skip-vpn`（sh 7 处）+ `-SkipRust` / `-SkipAndroid` / `-SkipVpn`（ps1 6 处） |
| ② 环境缺失 | 2 | `clippy-android` —— **已改造成远程真跑**（`ANDROID_CLIPPY_HOST`，sh/ps1 各一处） |
| ③ 运行时链路 | 2 | `vpn-connectivity` —— 要真握手 + 两向真收发包 + 端到端 ping，需要**另一台真实对端** + 已被系统服务管理器拉起的守护进程；远程宿主给不了**编译以外**的能力，sh/ps1 各一处 |

⇒ **整套门禁里因"环境缺失"而跳的只有 `clippy-android` 一类，且它已经不该再跳了。**

> 这三个数字是 2026-08-12 的**快照**，会随脚本长。**现查命令**（别引用过期数）：
> ① `grep -c '参数显式跳过' <脚本>`（⚠️ ps1 里有 2 行注释也含该词，只数
> `$script:skipped += [PSCustomObject]@{ Id` 那种登记行，且排除 `Record-Skip` 函数体本身那一行）；
> ②③ `grep -n 'record_skip\|Record-Skip -Id' <脚本>` 后逐条打开看触发条件。
> **载荷不在总数上，而在"② 只有一类、且已改造"这个结论** —— 总数怎么长都不影响它。

**反例（2026-08-12，同一条原则一天内被违反两次）**：

- 上午：以「本机起不了模拟器」为由缺手机端截图 —— 而本仓早有既定的远程路径
  （远程 x86_64 Linux 构建宿主 + `/dev/kvm` headless 模拟器 + `adb screencap`）。
- 当天早些时候发的 v1.1.30：`clippy-android` 被 `ALLOW_SKIP` 放行，理由写「本机无 Android NDK」，
  代价写「要等 CI 或真机才暴露」。当场被质问：**安卓相关的不是全都用远程构建宿主来跑吗，
  什么叫"只能等 CI/CD"？** **实测该宿主 NDK / 四个 android target / clippy 全部现成，一个字节都不用装**，
  远程真跑 `rc=0`、0 warnings —— 那次"跳过"从头到尾都是不必要的。

## 🔴 `OUT=$(cmd) || true` 紧跟 `EXIT=$?` ⇒ rc 恒为 0，FAIL 分支结构上永不可达

`||` 是**整条命令列表**的一部分：`OUT=$(cmd) || true` 作为一个整体**总是成功**，
所以紧随其后的 `$?` 取到的是**那个整体**的退出码（恒 0），而不是 `cmd` 的。
于是 `if [[ $EXIT -ne 0 ]]; then FAIL; fi` 这类判断**结构上永远进不去**。

**正对照（三行，自己跑一遍再信）**：

```bash
OUT=$(false 2>&1) || true; EXIT=$?     # → EXIT=0   ← 命令真失败了也报 0
OUT=$(true  2>&1) || true; EXIT=$?     # → EXIT=0
OUT=$(false 2>&1) || VAR=$?            # → VAR=1    ← 正确写法：把 rc 直接捕进变量
```

正确写法固定为「**先预置 `XXX_EXIT=0`，再 `OUT=$(cmd 2>&1) || XXX_EXIT=$?`**」。
预置那一行不能省 —— 否则会继承上一步残留的值。

**危害分级（决定这条有多要命）**：看 `then` 分支内**还有没有别的 FAIL 出口**：

- **`then` 内没有别的 FAIL 出口 ⇒ 该步骤结构上恒 PASS，从未真正把关。**
  本仓实测属此类的有 4 步：**Vitest / Playwright E2E / clippy 桌面 / clippy Android**。
- `then` 内另有出口（如再 `grep` 一次输出里的 error/warning）⇒ 只是**部分漏判**。
  本仓属此类：ESLint（只在"有 error 无 warning"时漏）、前端构建。

🔴 **推论必须写出来**：在修复之前，**那 4 项历史上的"绿"不构成"真跑通过"的证据**。
拿旧版本的门禁全绿去论证"当时代码是干净的"是无效论证。

**自查命令**（改门禁脚本、或接手一个不熟的 shell 门禁时先跑）：

```bash
grep -n '|| true' <脚本>        # 逐条打开看：后面有没有紧跟 XXX_EXIT=$?
```

⚠️ **别误伤正当用法**：`X=$(cmd || true)`（`|| true` 在**命令替换内部**）且**不与 `$?` 配对**，
是"允许命令无输出/无命中而不中断 `set -e`"的正常写法（如 `grep` 无命中返回 1）。
判据是「**有没有紧跟着读 `$?`**」，不是「有没有出现 `|| true`」。

### 同族的第三态：`⚠ WARN` 与"恒假的 if" —— 看着在把关，其实没把

同一条脚本里还有两种**同族**的"假把关"，判据都是「这条分支实际进得去吗、它的结论进汇总了吗」：

- **`⚠ WARN` 分支既不 FAIL 也不登记进跳过表**（`test-all.sh:155` / `:162`，
  `test-all.ps1:131` / `:137`）：只打一行黄字就过去了，末尾汇总里**看不见**，
  等于门禁里的**第三态：隐形跳过**。
- **恒假的死分支**：前端构建那条查 Vite 警告的 `if`，管道里 `grep -q` 不产出任何输出，
  其下游同管道的 `grep -v` 拿到空输入必返回 1 ⇒ **整条 `if` 恒假**（2026-08-12 实测，
  构造了确实含目标警告的输入，条件仍为假；正对照证明单跑 `grep -q` 能命中）。

⇒ 审 shell 门禁时，除了 rc 捕获，还要问两句：**这个分支进得去吗？它的结论有没有进最终汇总？**
（以上三处为 2026-08-12 盘点所得，**只报未改**，改动需另立单走复核。）

## 把门禁项交给远程构建宿主真跑：本仓的固定惯例

本仓已有**两条**这类通路，写法应当一致，第三条照抄即可：

| 通路 | 主机变量 | 用在哪 |
|---|---|---|
| Windows VPN 二进制构建 | `HG_WIN_BUILD_HOST` | `scripts/build-hg-binaries.sh` |
| Android clippy | `ANDROID_CLIPPY_HOST` | `scripts/linux/test-all.sh` 第 11 项 / `scripts/test-all.ps1` 第 9 项 |

**惯例逐条（缺一条就会退化成"看着跑了其实没跑"）**：

1. **主机经 env 注入、无默认值**；公开仓内**零内网地址 / 主机名 / 账号**，示例一律 `user@host`；
   值不落盘、不入日志，日志里打成 `<变量名>` 占位。
2. **rc 与完整输出必须取回本机判定**。「ssh 返回 0」只证明连上了，不证明远端那条命令成功 ——
   远端要以约定退出码表达结果，并额外打一行**结束哨兵**（`__DONE__ rc=N`）；
   **rc=0 但没有哨兵 ⇒ 判为"中途断连"，按 FAIL 处理**，否则连接中断会被读成通过。
3. **各类失败分类编码、全部 FAIL、无一退回 skip**（本仓用：缺工具链 / 同步失败 / 检查真失败 /
   连不上 / 拿不到哨兵）。文案必须能让人一眼分清「网络 / 凭据问题」与「代码问题」。
   🔴 **自动退回 skip = 把"没跑"重新伪装成"环境不具备"**，是这套设计要根治的病本身。
4. **同步载荷用白名单，不用黑名单**（见下一节，这条是硬红线）。
5. **未配置该 env 时才允许 skip**，且文案必须承认「**且**未配置远程宿主」。
6. **非交互 shell 不读 `~/.cargo/env`**：`ssh host bash -s` 的默认 PATH 里没有 rustup 装的 `cargo`。
   远程 runner 里必须显式 `. "$HOME/.cargo/env"`，否则会得到一个假结论「远程没有 cargo」。
   （这正是本仓踩过的坏判据：先得到 `cargo: command not found` 就以为"远程没装"，
   补跑正对照 `ls -l "$HOME/.cargo/bin/"` 直接列出 `cargo` / `cargo-clippy`，证明它一直在盘上。
   ——「报『远程没有 X』之前，先确认查法在已知存在的东西上能命中」。）
7. **远程缓存目录跨次保留**能大幅提速（实测冷编 31.9s → 增量 15.1s），但会在远程留下 GB 级 target 缓存
   ——用完要有人清；`rm -rf "$REMOTE_DIR"` 这类收尾动作的目录**来自用户可设的 env**，
   误设成别的线在用的目录就会把它删掉，**默认值要安全、且别让人随手改**。

### 🔴 往外传源码时用**白名单**，黑名单会把用户数据 scp 出本机

本仓根目录有 `data/` —— App portable 模式的**本地运行数据落点**，含**聊天数据库与用户文件**。
按"排除 `node_modules` / `target` / `.git`"的黑名单口径打包，实测 **164 MB**，最大条目是
两个 ~49 MB 用户文档 zip 与 6.7 MB `chat_data.db`。改成白名单（只带 `src-tauri` +
`Notification-Sounds`）后载荷 4.9 MB / 124 个条目。

**两种口径的失效模式不对称，这才是判据**：

- **黑名单漏一条** = 静默把用户隐私数据传出本机，**没有任何地方会报错**；
- **白名单漏一条** = 远端编译报错，**当场可见、当场能补**。

⇒ 凡「把仓内容传到本机之外」的动作（scp / rsync / 上传 / 打包给第三方），**一律白名单**。
配套自证：用 shipped 脚本里那条打包命令**逐字重跑一遍**，清点载荷里 `data/` / `chat_data.db` /
`node_modules` / `.git` 的命中数是否为 0，并对**真实仓内路径样本**跑同一套 grep 做正对照
（证明那些 0 是真 0、不是判据盲区）。

### macOS 自带的是 **openrsync**，不是 GNU rsync

实测 `rsync --version` → `openrsync: protocol version 29 / rsync version 2.6.9 compatible`。
GNU 特有选项（如 `--info=stats2`）**直接被拒**（rc=1 + usage）。Windows 侧通常**连 rsync 都没有**，
但自带 `ssh.exe` / `scp.exe` / `tar.exe`。

⇒ 要「同一套语义在 macOS / Linux / Windows 三边都成立」，**用 `tar` + `scp`，别用 rsync**。
这不是偷懒，是唯一能三边都成立的选择。

⚠️ 配套的 stdin 纪律（与本文件「管道喂给 `bash -s` 的脚本里，`ssh` 会吃掉 stdin」那节合看）：
Linux 侧 `ssh host 'bash -s' < "$runner"` 靠 stdin 送脚本，**外层那条 ssh 绝不能加 `-n`**；
而 PowerShell 的管道/重定向会对送进原生命令的字节做文本处理，**同样写法在 Windows 上不可靠**
⇒ Windows 侧改成「`scp` runner 上去 + `ssh -n` 执行」，完全绕开 stdin。
两边行为等价、实现不同，**这种不对称要在代码注释里写明原因**，否则后人会"顺手改成一致"。

## 改动一个被文档按行号引用的脚本/源文件后，必须回头重锚所有 `文件:行`

行号锚点是**静默失效**的：脚本里插进 400 行，所有引用它的文档瞬间全指错，
而**没有任何工具会报错** —— 读者按锚点翻过去看到的是另一段代码，比没有锚点更糟。

**判据（改完脚本立刻跑）**：

```bash
grep -rn "<被改文件名>:[0-9]" <文档目录>     # 例：grep -rn "test-all\.\(sh\|ps1\):[0-9]" .claude scripts
```

逐条打开核对「该行现在到底是什么」。⚠️ **别只扫带文件名前缀的那种** —— 同一份文档里往往还有
大量**裸 `:NNN`**（上下文默认指某个脚本），它们同样会失效，且 grep 不到；
按小节读一遍，把裸锚点一并重锚。

**写锚点时的自保写法**：每个行号后面**跟一小段该行的原文**（如 `test-all.sh:765` `CANONICAL_TOTAL=13`）。
这样即使行号漂了，读者也能 `grep` 那段原文自己找回来 —— 只写数字的锚点一旦漂移就彻底失联。
对整块引用优先锚**块头注释**（`# 11. Android Cargo Clippy`），它能被 `grep -n '^# [0-9]\+\.'` 一次列全。

**本仓实例（2026-08-12）**：commit `2f3e4dd` 只改了两个脚本，却让 **4 份文档**
（`.claude/CLAUDE.md`、`.claude/skills/release/SKILL.md`、`scripts/README.md`、`scripts/linux/README.md`）
里指向它们的行号锚点**集体失效**：VPN 那两处指到了 `exit 20`、`ALLOW_SKIP` 可用 id 那处指到了远程用法示例、
`record_skip vpn-connectivity` 那处指到了 `CLIPPY_RC=0`。
**code 与 leader 两道都没发现，是 review 环独立扫出来的** —— 这正说明它必须是一个**机械动作**，
不能指望谁"顺便注意到"。

## 🔴 「不复现」有三种假法：位置错、样本少、判据形态错 —— 都与「真没问题」同形

2026-08-12 一天之内，同一族错误以**三种不同形态**各栽一次。共同点是：
**得到的输出（"没复现" / "0 命中" / "通过"）与"真的没问题"在屏幕上完全一样**，
不主动去证伪就永远发现不了。

| # | 形态 | 实例 | 代价 / 识破方式 |
|---|---|---|---|
| 1 | **测错了位置** | 报障人说「**查找聊天记录 → 视频**分类里没封面」，worker 测的是**聊天气泡**（那里本来就是好的）⇒ 得出「模拟器不复现」 | 结论作废、白跑一轮。**识破 = 逐字复述报障人给的路径**（几级菜单、点哪个分类），在**那个确切位置**取证；换了位置取的证据一律不算 |
| 2 | **样本量不足** | 查找记录网格重叠：**12 条样本零重叠**，差点判「报障不成立」；**加到 60 条才炸出 210 对重叠** | 差点回复用户「查了，没问题」。**识破 = 先问「这个 bug 的发作条件里有没有『量』这一维」**（超过一屏、超过窗口、超过阈值），有就把样本推过那条线 |
| 3 | **判据形态错** | 查「有没有强制滚到底」，裸 `grep` 得 **4 处命中** ⇒ 以为有实现；逐条打开发现**全是块注释**，零可执行语句 | 差点把「没实现」判成「已实现」。**识破 = 命中之后必须逐条打开看它是不是你以为的那类行**（见本文件「『命中了』不等于命中的是那一类行」） |

**固定动作（三条都要，缺一条就会以另一种形态复发）**：
1. **位置**：按报障人原话逐字复述路径，在那个确切界面取证。
2. **规模**：先答「发作条件里有没有『量』这一维」，有就把样本推过阈值再下结论。
3. **形态**：任何计数式判据，命中后逐条打开核对；「查不到」先拿已知存在的样本验判据能命中。

## 🔴 间歇性失败（flaky）不等于「可以忽略」—— 但要先把「是不是我引入的」钉死

门禁里出现 flaky 时有两个相反的错误，都会付代价：
**当成回归去乱改**（浪费一轮，还可能改坏），或**当成噪声直接忽略**（放过真缺陷）。

**先做归属判定，再谈处置。判定要靠「物理上够不够得着」，不是靠感觉**：

1. **同码连跑 N 次**，看结果是否稳定、失败细节（节点号/计数/位置）是否每次不同 ⇒ 不同即非确定性。
2. **列出本批改动文件**，逐一问「它能不能影响到出问题的那条路径」。
   实例（2026-08-12）：认证页表单切换的并发动画告警，47 个改动文件里唯一沾边的是
   `src/styles/index.css`，而它的改动**只有一行 `@import`**，被导入的文件里
   **无 `animation`/`transition`/`@keyframes`**、选择器全在某个类作用域下、**而认证页不用那个类**
   ⇒ **物理上够不着**，归属判定完成：既有 flaky，非本批引入。
3. **量化失败率**（连跑 10 次记 PASS/FAIL），1/3 与 1/20 的处置优先级完全不同。

🔴 **判定为「既有」之后，措辞必须写成「此前一直存在、无人发现；本批未引入、也未修复」** ——
不许简写成「flaky，忽略」。前者是记账，后者是掩盖。

🔴 **绝不允许为了让门禁变绿而调阈值、加重试、或跳过该项** —— 那与「假实现」是同一类病：
把「没通过」伪装成「通过了」。`ALLOW_SKIP` 只覆盖 SKIP、**覆盖不了 FAIL**，
所以遇到 FAIL 时合规路径只有两条：**修掉它**，或**由授权方明确拍板带着它发**（并如实记账）。

## 🔴 正对照必须与被测对象**同类** —— 类别不同的正对照，验不到那一类失效

本文件已有三条同族纪律：「grep 字符类漏数字 ⇒『查不到』是假的」（先拿**已知存在**的样本验判据）、
「用 grep 判有没有发生前先确认时间窗」、「『不复现』有三种假法」。它们都停在**要跑正对照**这一步。
这一条再进一层：**正对照跑了、也命中了，判据仍然可能是废的 —— 因为正对照和被测对象不是同一类东西。**

**判据**：写下正对照之前，先答一句「**我的被测对象属于哪一类？我的正对照属于哪一类？**」
两者必须落在**同一条会失效的通道**上。类别对不上 ⇒ 那条正对照只证明了「工具能跑」，
证明不了「这条查询对那一类对象有效」。

**判决性实例（2026-08-13 本仓实测，两个执行单都没拦住，leader 跑 5×3 跨类矩阵才定性）**：

要判「某段新代码在不在 `dist/` 构建产物里」，用的是
`grep -c readMediaDimensions dist/` —— 被测对象是**函数标识符**。
正对照用的是 `grep -c video-play-overlay dist/` = 2 ⇒ 看着"判据有区分力"。
**但 `vite build` 的 minify 只改标识符、不改字符串字面量**：正对照是**字面量**、被测是**标识符**，
两者根本不在同一条失效通道上 ⇒ 那条正对照**结构上不可能**验到 minify 改名这一类失效。

**反证一步到位**：`calculateDisplaySize` 是项目里早就存在、必然被打进包的老函数，
同一条 `grep dist/` 同样 **0 命中** ⇒ 「0 命中」与「代码不在包里」毫无关系，判据本身是废的。

⇒ **同类正对照的选法**：挑一个**与被测对象同类、且已知必然成立**的样本。
上例的正确正对照不是任何字面量，而是**另一个已知在包里的函数标识符**——
而它同样 0 命中，正好当场判死这条判据（见 `frontend-test.md`「`dist/` 是 minified 产物」一节的替代判据）。

**这条与「命中了不等于命中的是那一类行」是镜像**：那条防**假阳**（命中的不是你以为的那类行），
这条防**假阴被正对照背书**（没命中，而你的正对照让你以为没命中是真的）。

## 🔴 GUI 注入的**特殊键**可能整类不到达 webview —— 而「没反应」与「功能坏了」完全同形

**这是一条判据陷阱，不是产品缺陷。** 2026-08-13 定性一条「已保存账号点登陆零反馈」的报障时，
最初把**键盘通道**判成坏的，实际是**注入机制**坏的：

| 注入机制 | 普通字符（`t:`/keystroke） | **特殊键**（Tab / ↑↓ / Enter） |
|---|---|---|
| `cliclick kp:<key>` | —— | ❌ **整类不到达本仓 Tauri webview** |
| `cliclick t:<text>` | ✅ 到达 | —— |
| `osascript`（System Events `key code`） | ✅ 到达 | ✅ **到达并生效** |

**为什么骗人**：`cliclick c:` 点击是好的、`cliclick t:` 打字是好的，于是「`cliclick kp:` 也应该是好的」
这个假设不会被任何输出证伪 —— 按了没反应，**与「这个功能真的坏了」在屏幕上一模一样**。

**必做的同机制正对照**（花 30 秒，能省掉一整轮误判）：找一个**该机制下有可观测效果**的场景，
本仓用的是「文本框里按 ← 两次再打一个字符」：

```bash
# 基线：三击选中输入框 → 打 AAAAA（光标在末尾）
cliclick tc:<x>,<y>; cliclick t:AAAAA
# 机制 A：cliclick kp: —— 实测得 AAAAAX（光标没动）⇒ 特殊键没到达
cliclick kp:arrow-left; cliclick kp:arrow-left; cliclick t:X
# 机制 B：System Events —— 实测光标真的移动了 ⇒ 该机制可用
osascript -e 'tell application "System Events" to key code 123'
```

🔴 **判据**：正对照选的必须是**同一个注入机制 + 同一个 webview + 已知可观测**的效果
（对齐本文件「正对照必须与被测对象**同类**」一节）。用"点击能用"去背书"按键能用"属于**跨类背书**，
验不到「特殊键整类丢失」这一类失效。

⇒ **在拿到同机制正对照之前，不许把「按了没反应」写成产品缺陷。**

## 已定性 · macOS 无 Touch ID 硬件时「登陆」按钮的行为（原「两条通道均零反馈」结论已作废）

**结论（2026-08-13 真机实测，两个版本 × 两条通道共 4 组）**：**不存在「零反馈」这回事** ——
无论哪一版、哪条通道，点「登陆」都有明确且及时的反馈：

| 载体（均为**真安装件**装出的 `.app`） | 鼠标通道 | 键盘通道（Tab→↓→Enter） |
|---|---|---|
| **v1.1.22**（登录路径上还有 Touch ID 门禁的最后一版） | ≈2s 内红字「Touch ID 未通过，请手动输入密码登录」+ 切手动登录表单 | **逐字相同**的回退 |
| **v1.1.33**（当前版） | **直接登录成功**进入聊天 | ↓ 真的切换了账号（1/6→2/6），Enter **登录成功** |

**原结论错在哪（两个独立成因，缺一都还原不出来）**：

1. **键盘那半句 = 判据坏了**，见上一节：`cliclick kp:` 的特殊键整类不到达 webview。
   换 System Events 后，**v1.1.22 与 v1.1.33 的键盘通道都正常**。
2. **鼠标那半句 = 载体不对**（推断，非实证）：同日 [rust-dev.md](rust-dev.md)「macOS 真机载体必须是
   `.app`」记载过用 `cargo build --release` 的**裸二进制**跑出**白屏**。白屏上点任何位置都没有反馈,
   与"按钮坏了"同形。本次全部改用**真 DMG 装出的 `.app`**，4 组全部有反馈。

**判决性证据链**（同一台机器、同一份 `accounts.json`）：

- 机器确实无生物识别：`hw.model=VirtualMac2,1`、`ioreg -c AppleBiometricSensor` 计数 **0**、`bioutil -r` 报错；
- 旧包**有**那道门禁：`biometric_unavailable` 在 v1.1.22 二进制里命中 **1**；
- 新包**没有**：同串在 v1.1.33 二进制里命中 **0**，而**同类**正对照（`biometric_failed` /
  `biometric_timeout`，同为 Rust 字符串字面量片段、且 VPN 路径仍在用）在**两个**二进制里都是 **1**
  ⇒ 判据对新二进制**仍有区分力**，0 是真 0；
- 登录是否**真的成功**不靠看画面：`last_login_at` 只由 `touchLoginTime()` 写、只在登录完整走完时调用。
  两次成功登录分别把 `accounts.json` 的 sha256 与对应账号的 `last_login_at` 推进了。

⚠️ **别再把「无硬件 → 转手动登录」当成待验证**：它已验证成立（见上面「彻底消除弹框」节的 ✅ 那条），
但**只对 v1.1.23 及更早**有意义 —— v1.1.24 起登录路径上已无该门禁。

## 🔴 转述一个「真机现象」之前，先问「那台机器上装的是哪一版」

**同一形态两天内栽了两次**（gen-18 项③「视频封面只有 Windows 生效」、gen-19「已保存账号点登陆零反馈」），
两次的报障现象都来自一个**比修复更早的旧包**。这类误判特别贵：它会派人去修一个**没坏的东西**，
而且「旧包上的真实现象」与「新包上的真缺陷」在描述里**完全同形** —— 光听现象永远分不开。

**动手排查前先跑这三条，缺一条都不算查过**（三条互相独立，一条坏了另两条还在）：

| # | 判据 | 命令 | 说明 |
|---|---|---|---|
| ① | **装机版本** | `defaults read <app>/Contents/Info.plist CFBundleShortVersionString` | 裸二进制没有 Info.plist ⇒ 载体本身就不对，见 `rust-dev.md`「macOS 真机载体必须是 `.app`」 |
| ② | **该功能哪一版落地** | `git log -S'<功能里的唯一串>' --oneline` | 得到引入/摘除该功能的 commit 与版本 |
| ③ | **装着的字节里到底有没有它** | 见下一节（二进制指纹，**必须配同类正对照**） | ①是元数据、③是字节，两者可能不一致（覆盖安装/手搓 .app） |

**gen-19 实测**：`/Applications` 里装的是 **v1.1.22**，而登录路径上的那道门禁是 **v1.1.24（`ee58f2d`）摘掉的**；
门禁指纹在 1.1.22 二进制命中 1、在 1.1.33 命中 0（同类正对照两版恒 1）⇒ 报障测的是**早两版的包**。
换真 DMG 装出的 v1.1.33 重测：4 组（两版 × 鼠标/键盘）**全部有反馈**，原结论证伪。
（一手来源：单 1 交付 §1/§4/§5；`SUPERVISOR-RULING-gen19.md:63-64` 把这条记成了总管自己的教训。）

⚠️ **证伪也是产出** —— 正确处置不是「据此宣布报障不成立」，而是「装上正确版本 → 同机重测 →
复现就修、不复现就带证据证伪并订正文档」。本仓 `common.md` 的「已定性 · macOS 无 Touch ID 硬件时
「登陆」按钮的行为」一节就是这么被推翻重写的。

## 🔴 给二进制做指纹：两个真坑（locale 吃掉中文 + 正对照跨类），中文字面量其实**可用**

先说结论，因为它推翻了一个流传过的说法：**「Mach-O 只能用 ASCII 字面量做指纹」是错的**。
中文 Rust 字面量完全可用 —— 那次失败是**两个独立错误叠加**，各自都足以让判据静默失效。

### 坑 A：`grep -a` 在 UTF-8 locale 下匹不到中文，`LC_ALL=C` 才能

**两个二进制上各跑一遍（2026-08-14 独立复核，非转述）**，被测串是同一条 Rust 中文字面量：

| 载体 | `LANG=en_US.UTF-8 grep -ac` | `LC_ALL=C grep -ac` | python 原始字节 count |
|---|---|---|---|
| v1.1.22 可执行文件 | **0** | **1** | **1** |
| v1.1.33 可执行文件 | **0** | **1** | **1** |

**判据自证**：同两个文件上，ASCII 串 `biometric_failed` 在 UTF-8 locale 下就命中 **1**
⇒ `grep -ac` 本身在这两个文件上是会响的，那两个 0 是**多字节匹配失效**，不是串不存在；
负对照（一条确定不存在的中文串）两种 locale 都是 0 ⇒ 不是恒 1。

⇒ **纪律**：对二进制搜任何非 ASCII 串，一律 `LC_ALL=C /usr/bin/grep -ac`，或直接用
`python3 -c "print(open(p,'rb').read().count('串'.encode()))"` 数原始字节。
（同族：工作区根 `../.claude/CLAUDE.md:242`「`grep` 是 shell-snapshot 里的 ugrep 包装函数」——
都是**工具层**把结论改了。⚠️ 原文这里写的是「`common.md` 顶部」，**指错了文件**：那条表行不在本仓，
本仓只在本文件「`grep -r` 与 `git grep` **不等价**」一节记它、不改它。）

### 坑 B（更要命）：正对照与被测**存储形态不同**，那条正对照结构上验不到这一类

那次选的正对照串在 Rust 侧**只出现在文档注释里**（`///`，**编译进不了二进制**），其余出现全是
**TS 字面量**（走 vite 打包 + 资源嵌入，**不可原始字节命中**）；而被测串是 **Rust 字符串字面量**
（进 Mach-O rodata）。**两者不同类** ⇒ 正对照跟着一起 0，于是「被测 0」看起来被背书了，实则毫无区分力。

⇒ **纪律**：给二进制做指纹，正对照必须是「**同一语言、同一存储形态**」的串 ——
Rust 字面量对 Rust 字面量、标识符对标识符，且**已知在被查的那一份二进制里非零**。
换同类正对照（`Touch ID 验证未通过`，Rust 字面量）后判据立刻成立：新旧两版都 =1，
而被测串 1 → 0 ⇒ 那个 0 是真 0。（一手来源：单 1 交付 §1「卡里那条坏判据：我把它拆成了两个独立成因」+ §9 判据表第 3/4 行。）

📌 **本条是新增，不是订正**：现查 `.claude/` 全树，**并不存在**「`strings` 提取不出中文 ⇒ 改用 `grep -a`」
这句话（`strings` 在 `.claude/` 命中 6 个文件，逐个打开全是 release 脱敏扫与 GSAP 文档，无一条讲中文提取；
正对照 `grep` 一词命中 11 个文件 ⇒ 查法会响）。所以**全仓不存在与本条打架的第二条**。

## 🔴 CI 门禁的 `paths` 前缀写错 = 该 workflow 结构上永不触发；「配置看起来对了」不算修好

`on.push.paths` / `on.pull_request.paths` 由 **GitHub 服务端**在 push / PR 事件上求值。
前缀写错（例如按「工作区根仓」写成 `Huanvae-Chat-App/src/**`，而该仓**本身就是** App 仓）⇒
**任何改动都匹不上** ⇒ 该 workflow **一次也不会跑**，而仓库页面上**看不出任何异常**：
没有红叉、没有告警、没有跳过记录 —— **「从没跑过」与「跑了都绿」在 UI 上完全同形**。

**同一份 workflow 里错前缀往往不止一处**（gen-19 实测 **8 处**，卡里只列了 6 处）：
`paths` · `defaults.run.working-directory` · `cache-dependency-path`（两个 job 各一）·
`upload-artifact.path`（coverage / playwright-report / visual-diff 三处）。
⇒ **改的时候按「路径字面量」整份扫一遍**，别只改 `paths`。判据：`grep -c '<错前缀>' <workflow>` 应为 0，
**正对照**同文件一个已知存在的路径串（如 `pnpm-lock.yaml`）必须非 0。

### 验收：必须有**两条真触发记录**，正负异形

**「配置看起来对了」不是验收** —— 修一个门禁却不证明它会触发，等于没修。两条记录缺一不可：

1. **该触发的触发**：改一个在白名单里的文件 → 该 workflow 有 run；
2. **不该触发的不触发**：改一个不在白名单里的文件 → 同一条查询返回**空**。

**判据形状要不同**（这是它有区分力的证明）：`?head_sha=<正向>` → `total_count=1` + `workflow_runs` 非空；
`?head_sha=<负向>` → `total_count=0` + `workflow_runs: []`。
~~负对照（假 sha / 假 run id）应给 **422 / 404**，与 200 形状不同 ⇒ 那些 200 是真 200。~~
🔴 **划掉这半句：2026-08-14 实测证伪 ——「假 sha」返回的是 200 + 空，与真负向逐字同形、零判别力。
见下面「坑 ④」与本文件末尾「负对照必须自证会产生不同形状的输出」一节。**
（一手来源：单 2 交付 §5.2 两条真记录 + §5.3；`SUPERVISOR-RULING-gen19.md:22-23`「修一个门禁却不证明它会红，等于没修」。）

⚠️ 两条配套事实，落笔时别漏：
- **`workflow_dispatch` 绕过 `paths`、本地 `act` 不实现服务端过滤** ⇒ **除 push/PR 外没有别的路子**能产出真触发记录；
- 推一个改了 `.github/workflows/*` 的提交需要 token 带 `workflow` scope（本文件「那个 token 从哪儿取」一节已记）。

🔴 **门禁复活之后照出的存量红，不许靠"摘掉那条腿"变绿** ——
`SUPERVISOR-RULING-gen19-cired.md:26` 的原话：**一条永远红的测试，训练所有人忽略红色**。
落 main 的前置条件是「先把红处理掉、确认能绿」，不是「先落地再说」。

### ✅ 已修（2026-08-14，gen-22 单①）—— 连同修的时候踩到的三个坑

`.github/workflows/test.yml` 的 **8 处**错前缀已一次扫全改成**仓相对**路径
（`paths` ×2 · `defaults.run.working-directory` · `cache-dependency-path` ×2 · `upload-artifact.path` ×3）。
`defaults:` **整块删除**——仓根即默认工作目录，留 `.` 属误导性残留（CLAUDE.md 零污染）。

**`paths` 白名单的两条硬性质**（设计白名单时先答这两问，缺一条整个验收就做不成）：

- **性质 A —— 每条模式在仓内必须非空**：逐条 `git ls-files -- '<模式>' | wc -l` 必须 ≥ 1。
  否则你只是把「一条静默失效的死规则」换成了「另一条静默失效的死规则」。
- **性质 B —— 必须留出「白名单外」的面**：否则「不该触发的不触发」那条**负向记录物理上造不出来**，
  验收无法完成。本仓落在白名单外的现成面：`.claude/**` · `scripts/**` · `src-tauri/**` ·
  `README.md` · `image/**` · `Notification-Sounds/**` · `e2e-real/**` · `e2e-album/**`。

**两条必须写进白名单/黑名单的具体项**（都不是口味问题，各有硬理由）：

- ✅ **`.github/workflows/test.yml` 自己必须在白名单里**：① 语义上「改测试 workflow 就该重跑测试」；
  ② **它让修复 commit 自己成为正向记录**，不必为取证造垃圾 commit。
- 🔴 **`e2e-real/**` 必须排除**：`pnpm test:e2e` 走主 `playwright.config.ts`（`testDir ./e2e`），
  而 real-e2e 要本地双实例集群，公开仓 runner 够不到 ⇒ 放进来 = **让 CI 恒红**
  （与 `frontend-test.md`「与存量 GitHub CI 的隔离」是同一条红线的两半）。

**坑 ①：`grep -c '<错前缀>' <workflow>` 必须 = 0 这条验收口径，会跟「在注释里解释这个坑」直接打架。**
本次给该 workflow 写文件头注释时，注释里原样写出了那个错前缀字符串 ⇒ 计数 1 ≠ 0 ⇒ 自检当场翻红。
这与 `frontend-test.md`「不变量口径写"禁裸写死"，不是"禁出现该数字"」是**同一个病的两次发作**。
⇒ 两条出路二选一，**别默默把注释删了了事**：把口径收紧成「路径**字面量**位置不得出现该前缀」，
或注释改成不含该字面量的说法（本次选后者，注释改指向本节，信息量不减）。

**坑 ②：本机 `python3` 没有 PyYAML**（`ModuleNotFoundError: No module named 'yaml'`），
任务卡给的 `python3 -c "import yaml..."` 那条验收命令**在本机跑不了**。
现成替代是 **ruby/psych**（`ruby -ryaml -e 'YAML.safe_load(File.read(f))'`，rbenv 版可用）。
⚠️ 用它时别被一个良性现象吓到：Psych 按 YAML 1.1 把 `on:` 解析成**布尔键 `true`**
（`d.keys` = `["name", true, "env", "jobs"]`），要取 `d[true]` 而不是 `d["on"]` ——
这是 Ruby 侧的字面量规则，**不是** GitHub 的行为，GitHub 侧照常识别 `on`。
**负对照别省**：喂一段坏 YAML 必须 rc≠0，否则这条判据恒真、等于没验。

**坑 ③：两个 commit 必须【分两次 push】。** GitHub 判 `paths` 用的是**本次 push 前后的整体 diff** ——
两个 commit 一起推，负向那个会被正向那个带着一起触发 ⇒ 你会拿到**两条正向记录**，
而它**看起来跟"负向探针失败"完全同形**。同理 `SHA_NEG` 的 `0` 必须是「**等够了之后仍然是 0**」：
先量正向从 push 到查得非空用了多久（记 T），负向至少等 `max(T, 120s)` 再查，**把等待时长写进证据** ——
查得太早，「还没登记」与「真的没触发」输出一模一样（同族：本文件「用 grep 判有没有发生之前，先确认时间窗能覆盖」）。

> 本次实测：正向 push 完成 → run 被创建**仅 2 秒**，首次查询（+15s）即 `total_count=1`（`event=push`）；
> 负向按红线等满 **147s** 后仍为 `0` / `workflow_runs: []`。两条记录的原始 JSON 落在 gen-22 证据目录。

**坑 ④（本节此前记错了，现更正）：「编造一个假 sha 当负对照」这条【没有判别力】。**
本文件上面写过「负对照（假 sha / 假 run id）应给 **422 / 404**」——**实测不成立**：
对同一端点喂一个**格式合法但不存在**的 40 位 sha（`deadbeef…`），GitHub 返回的是
**`HTTP 200` + `total_count: 0` + `workflow_runs: []`** —— **与真正的 `SHA_NEG` 逐字同形**；
再喂一个**畸形** sha（`zzzznotasha`）**同样是 200 + 空**（该端点根本不校验 `head_sha` 形状）。
⇒ 它证明不了「那个 0 是真 0」，正属本文件「正对照与负对照输出**同形** ⇒ 该判据没有判别力」那一条。

**真正有判别力的两件，缺一不可**：

- **同类正对照**＝**同一条查询、只换 sha**：`head_sha=<SHA_POS>` → `total_count=1`，
  `head_sha=<SHA_NEG>` → `total_count=0`。**同端点同参数、只变一个值 ⇒ 这才是单变量对照**
  （对齐本文件「正对照必须与被测对象**同类**」）。
- **URL 解析活性对照**（证明那些 200 不是"打错地方也照样 200"）：把 **workflow 文件名**或**仓名**
  换成不存在的 → **`HTTP 404` + `{"message":"Not Found"}`**，与 200 形状不同。

**存量红的实跑结论（run `31826376381`，本单实测，不是预设）**：整体 `conclusion=failure`，但两个 job 一红一绿——

| job | 结论 | 明细 |
|---|---|---|
| `Vitest Unit & Component Tests` | ✅ **success** | `pnpm install` / `test:run` / `test:coverage` 全绿 ⇒ 前缀修对了、CI 上跑得起来 |
| `Playwright E2E & Visual Regression` | ❌ **failure** | `pnpm test:e2e`：**22 passed / 9 failed / 2 skipped**；**9 条全部**是 `toHaveScreenshot` 像素比对（9/9），差异比 **0.04–0.09** 对阈值 `maxDiffPixelRatio: 0.01` |

根因**不是**平台后缀错配（基线文件名本就是 `-chromium-linux.png`，正是 ubuntu runner 该用的那套），
而是**基线过期**：`e2e/snapshots/` 最后一次更新是 **2026-05-11（v1.1.7 `7fcf340`）**，
其后**改过 `src/` 的 commit 有 160 个**，认证页自身最近一次改动是 2026-08-12（`32e4ca2`）。
⇒ **UI 漂了三个月没人比对过** —— 这恰恰是「门禁死着」的代价本身，也是本次修它的意义。

🔴 修红是**另一单**：要么重出基线（确认漂移全是有意的 UI 变更），要么修 UI。
**不许**用「删掉 e2e job / 加 `continue-on-error` / 把 `maxDiffPixelRatio` 调大」变绿 —— 见上一段红线。

## 🔴 转述「上一轮观测到 X」之前，第 0 步是复核**上一轮的观测机制**

本文件已有「上游描述与实测冲突时，以实测为准」，但它缺了半条：
**上游用的那个工具本身也要先跑正对照。** 少了这半条，会出现最难缠的一种情况 ——
上游描述与你的实测**不冲突**（两边都看到"没反应"），可两边**都是**同一个坏工具的产物。

**gen-19 的真根因就落在这个盲区里**：报障说「点登陆零反馈」，排查面里列了 App 的各种可能，
**唯独没有「上一轮那次点击/按键到底有没有送进去」** —— 而真相是注入机制的特殊键整类没到达
（见本文件「GUI 注入的**特殊键**可能整类不到达 webview」）。**排查面里没有的东西，永远撞不上。**

⇒ **可执行动作**：接手任何「上一轮观测到 X」的结论时，先答三问，答不出就先补正对照再谈成因：
1. 上一轮**用什么工具**观测的？（注入器 / 抓包 / 日志 / 截图 / API）
2. 那个工具在**同机制、同场景、已知可观测**的对照上响过吗？
3. 观测**载体**对吗？（`.app` 还是裸二进制、真安装件还是手搓、哪一版 —— 见本文件上面那条）

## 🔴 GitHub `refs/pull/N/head` 在 PR 关闭 + 源分支删除后**依然保留**，且公开仓**匿名**可读

「用完即删」的探针分支类取证（推一个一次性分支 → 取记录 → 关 PR + 删分支），常被认为
**证据随分支一起消失、只剩转述**。**不对** —— 只要留下 PR 号，就等于留下了一个 git 锚点：

```bash
# 不需要任何 token；按本文件「无 tty 环境的 git push 挂死」那条，用空 helper + 关掉交互
GIT_TERMINAL_PROMPT=0 git -c credential.helper= ls-remote <公开仓 URL> 'refs/pull/<N>/head'
```

**2026-08-14 实测（三个公开仓，全部匿名）**：本仓 `refs/pull/22/head` = `b9131cbb…4086`、
`refs/pull/23/head` = `8e5bd9e8…7ead`（**与交付里的负向/正向探针 head sha 逐字节相同**），
而 `refs/heads/ci-paths-probe*` = **0 条**（分支确已删）、`refs/heads/main` 仍是 `39b1636`（未动）；
另两个公开仓同样能取到 `refs/pull/*/head`（一个 2323 条、一个 6843 条）⇒ **不是本仓特例**。

🔴 **判据陷阱：`ls-remote` 对不存在的 ref 返回 `rc=0` + 空输出** ——
**rc 不是信号，输出行才是**。负对照 `refs/pull/99999/head` 正是 rc=0 且零行。
另：PR 号在某些仓可能没有 head ref（如仓库合并前的老 PR）⇒ **先跑一次 `refs/pull/*/head` 看清单非空**再下结论。

⇒ **两条纪律**：
1. 取证前先问一句「**这个对象在远端有没有 ref**」—— 很多"查不到"其实只是查错了地方；
2. **这条改写了 gen-19 一段历史的理由**：判官 4 轮 REJECT 要求「探针 commit 可 git 核验」，
   而总管授权边界要求「用完即删」，当时被判为**直接冲突、无路可走**。
   实测存在第三条路：**既删分支、又留 git 原生可复算的锚点**。
   ⇒ 准确说法是「**三方都没找到那条路**」，不是「物理/授权上无路」。
   （一手来源：review 交付 §10-F5；`SUPERVISOR-RULING-gen19-u2-override.md:29-31` 是当时那个不完整前提的原文。）

## 🔴 负对照必须自证「会产生不同形状的输出」——`200 + 空` 背书不了另一个 `200 + 空`

本节由 2026-08-14 立，起因是上面「坑 ④」那条坏判据**已经传播出去**：它先写进本文件，
再被抄进任务卡，任务卡又要求执行方照抄进交付。**改掉那一行不算完**，因为它代表**一整类**形态。

### 判据形态：拿「编造一个格式合法但不存在的 ID / sha / name / uuid / 路径」当负对照

**为什么这是一整类**：很多 API / 查询对「格式对但不存在」返回的就是 **`200 + 空结果`**，
与「真的零命中」**逐字同形**。此时那条负对照**没有任何判别力**，它背书的所有「0」都作废。

**实测表**（2026-08-14 **匿名、无 token** 独立复核；端点
`/repos/<owner>/<repo>/actions/workflows/test.yml/runs?head_sha=<X>`，同一条查询只换 `head_sha`）：

| 负对照候选 | 实测 | 判别力 |
|---|---|---|
| 格式合法但**不存在**的 40 位 sha（`deadbeef…`） | **200** + `total_count:0` + `workflow_runs:[]` | ❌ 与真负向**逐字同形** |
| **畸形** sha（`zzzznotasha`） | **200** + 空（该端点根本不校验 `head_sha` 形状） | ❌ 同上 |
| 把 **workflow 文件名**换成不存在的 | **404** + `{"message":"Not Found"}` | ✅ 形状不同 |
| 把**仓名**换成不存在的 | **404** + `{"message":"Not Found"}` | ✅ 形状不同 |

同刻的**同类正对照**：真实且在白名单内的 sha → `200` + `total_count:1` + `workflow_runs` 非空
⇒ 与真负向（`200` + `0` + `[]`）形状不同 —— **判别力来自它，不来自任何编造的 sha。**

### 🔴 判定口径：先问「这条负对照要证的是哪一件事」

负对照**不是**只有一种用法。它不是天然无效，是**用错场合**才失效：

| 你的结论形态 | 需要的对照 | 「编造一个不存在的对象」够不够 |
|---|---|---|
| 结论是**非零 / 命中**（「X 存在」「判据会响」） | 需要负对照证明判据**不恒真** | ✅ 够 —— 它的「不命中」与你的「命中」形状不同 |
| 结论是**零 / 不命中**（「X 不存在」「没触发」） | 需要**同类正对照**证明判据**会响** | ❌ 不够 —— 它与你要背书的那个 0 同形 |

⇒ 一句话：**编造出来的不存在对象只能用来反「恒真」，不能用来背书一个「0」。**
背书 0 的唯一合法方式，是拿一个**同类且确知存在**的样本喂给**同一条判据**，它必须命中
（对齐本文件「正对照必须与被测对象**同类**」一节）。

### 可用替代：把「不存在」上移一级，落到**上级资源**

`200 + 空` 的语义通常是「查询合法、结果为空」。要拿到**不同形状**，就得让请求在**更早一层**失败 ——
把 **workflow 文件名** / **仓名** / **域名下的路径段** 换成不存在的，那一层通常才 404。

本 run 实跑过、形状确认不同的两条替代：

- GitHub：`.../actions/workflows/<不存在的文件名>/runs` → **404**；`/repos/<owner>/<不存在的仓>/…` → **404**。
- 对象存储 / CDN：`https://store.huanvae.cn/update/huanvae-chat/latest.json` → **200**，
  同域**当场编造的 key** → **404**（两条同刻跑，形状不同）。`hg-cli` 那一路同测：**200 / 404**。

### 三条同族陷阱（本 run 现场撞到的，病根都是「对照没在已知真值上标定过」）

1. **`git ls-remote` 对不存在的 ref 是 `rc=0` + 零行** —— 与「真的已删」逐字同形。
   同一个公开仓实测：编造的 `refs/pull/99999/head` → rc=0 / **0 行**；
   真负向 `refs/heads/<已删的探针分支>` → rc=0 / **0 行**（同形）；
   **同类正对照 `refs/heads/main` → rc=0 / 1 行**，`refs/pull/*/head` → **23 行**。
   ⇒ 判别力全部来自正对照那一侧。**rc 不是信号，输出行才是。**
2. **`pgrep -x launchd` 在 macOS 上是一条【坏的正对照】** —— `ps -o pid=,comm= -p 1` 明写
   `1 /sbin/launchd`（它当然在跑），而同一时刻 `pgrep -x launchd` 给的是 **rc=1 / 0 行**，
   与「真的没在跑」逐字同形（成因：`-x` 精确匹配的是含路径的 `comm`）。
   可用的同机制正对照实测：`loginwindow` / `WindowServer` / `node` 均 **rc=0 且行数 ≥1**。
   ⇒ **正对照本身也要先在已知真值上标定**，别假设「这东西肯定在跑，所以它一定会命中」。
3. **「绝不存在」的示范串会因为被到处抄而【变成存在】。** 本工作区那个以 `zzq-` 开头、
   长期被当负对照用的示范串，现查已在 `/tmp/fw-delivery.*.md` **11 个文件**、工作区根 `CLAUDE.md`
   **1 行**、任务卡 **1 个文件** 里出现 ⇒ 拿它当「必为 0」的负对照**已恒失效**。
   ⇒ **负对照串必须当场现编，不许沿用任何文档里的示范串**（也因此本节不再原样写出那个串）。

### 反面之外：一条设计正确的负对照长什么样

`scripts/assert-outbound-payload.sh --selftest` 是本仓现成的正确范式，实跑四态**形状互不相同**：
含违禁项的包 → **rc=1**（拦下）· 干净包 → **rc=0**（放行）· 只含私钥的包 → **rc=1** ·
**空包 → rc=2**（专门堵「0 命中在空包上恒真」）。
它的负样本是**构造出来的真实例**，不是「编造一个不存在的名字」，所以两侧形状天然不同 ——
**能构造真实例时，就别用「编造一个不存在的 ID」这种弱形态。**

## 🔴 审计结论「e2e 撞 `plugin:http` 502」已过期 —— 实测证伪，引用前先核

**旧说法**（写在 `e2e/settings.spec.ts` 的头部注释里、又被审计原样照抄）：
e2e 进不去登录态，是因为 `e2e/helpers/tauri-mock.ts` 把 `plugin:http` 硬编码成 502。
**证伪。登录路径根本不经过 `plugin:http`。**

| 事实 | 判据 |
|---|---|
| 数据面走 `invoke('secure_http')` | `src/services/secureFetch.ts:129` / `:140` |
| 旧 mock 对 `secure_http` **零分支** | 改前 `grep -c secure_http e2e/helpers/tauri-mock.ts` = **0**；同文件 `plugin:http` = 1（同类正对照 ⇒ grep 会响） |
| `plugin:http` 在 `src/` 只剩 3 处，登录一处都不经过 | `huanvaeGuard/localApi.ts:24`（回环）· `nfc/executor.ts:40`（NFC 任意外链）· `secureFetch.ts:5`（**只是一句注释**） |

**真因链（运行时抓到，不是读码推的）**：`secure_http` 未列出 → mock 返回 `null` →
`secureFetch` 读 `.status` 抛 `Cannot read properties of null (reading 'status')` →
`discovery.configOrFallback` 在 DEV 构建 fail-loud ⇒ **数据面从发现面第一跳就断**。
补上 `secure_http` 分支后 e2e 能真的登录进主界面。

**三条可复用的教训**：

1. **上游描述与实测冲突，以实测为准**（本文件已有同名纪律）—— 这次冲突的双方是
   「审计结论」与「运行时报文」，而审计结论的来源是**一句写在测试文件头部的旧注释**。
   ⇒ **注释不是证据**；引用任何「根因是 X」之前，先跑一次拿到真实报错原文。
2. **一句错注释会长期挡住排查**：它让后续所有人都去看 `plugin:http`，
   而真正断掉的那一跳无人过问。按 CLAUDE.md「零污染 / 无误导性残留」，
   这类**结论已错的注释必须删**，不是留着"以防万一"。
3. **mock 未建模的命令要返回显式错误，不要返回 `null`**：`null` 会在下游变成
   `Cannot read properties of null` 这种**看不出是桩缺口**的报错。现行 `tauri-mock.ts`
   对未建模端点返回**显式 404**、未列出的 invoke 返回 `null` + `console.debug`。

## 穷举 workflow 不能只 `find .github` —— GitHub 有「仓内无文件」的动态 workflow

`find .github -type f \( -name '*.yml' -o -name '*.yaml' \)` 在本仓得 **3** 个
（`release.yml` / `test.yml` / `apt-repo.yml`），而 `GET /repos/<owner>/<repo>/actions/workflows`
返回 **4** 条 —— 多出来的 `pages-build-deployment` 是 GitHub 内建的动态 workflow，
它的 `path` 前缀是 `dynamic/`，**盘上和 `git ls-files` 里都没有对应文件**。

⇒ **「本仓一共有几个 workflow」这类穷举必须跨判据**：文件系统（`find` + `git ls-files`，
两者互证盘上/库里一致）**与** API 侧各查一次，数字不一致时逐条对出差在哪。
只用其中一种 ⇒ 得到的"全部"是不完整的，而它**看起来跟真的全部一模一样**。

同一次穷举里还要顺手查两件（它们同样不在 `find` 结果里、却能让流水线串起来）：
`workflow_run`（本仓 1 处：`apt-repo.yml` 由 Release 完成触发）、
`workflow_call`（本仓 0）、本地复合 action `uses: ./`（本仓 0，`.github/actions` 目录不存在）。

⚠️ 配套：`workflow_run` 那条链是**软约束**——它靠
`if: … workflow_run.conclusion == 'success'` 挡住，而**人手 `workflow_dispatch` 可以绕过**。
穷举分发面时要把这个绕过口写出来，别只写"上游红了它就 skip"。

## `--grep` / `--project` / 位置过滤器 也是一种**结构性跳过**

本文件与 `frontend-test.md` 已经记过 `testIgnore` / `testMatch` / vitest `exclude`
这类"不出现在 `grep skip` 里、却同样让测试不跑"的形态。**命令行过滤器是同一类**，
而且更隐蔽 —— 它不在任何配置文件里，只在 CI 的一行 `run:` 里。

**判据**：任何一条门禁命令，先问「它跑的是全集还是子集？」
子集就必须能说出**收窄掉了什么**。自证方法是**同一条命令的两侧计数**：
本仓 `--grep "@gate" --list` = `Total: 5 tests in 2 files`，
不带 `--grep` 的同一 project = `20 tests in 4 files` ⇒ 两侧形状不同，收窄幅度是可量的。

**用它时同处必须写清三件**（缺一条就退化成静默降门槛）：
① **收窄了什么**（被排除的具体是哪些用例）；
② **为什么**（必须是"这一类检查不管代码回归"这种结构性理由，
不能是"它现在红"—— 那叫为了变绿而收窄）；
③ **BACKLOG 在哪**（写在同一处注释里，含解除条件）。

并且要主动检查**收窄到空集时会不会静默通过**：playwright 的 `--grep` 空集是
`Error: No tests found` / rc=1（会响亮失败），但别的工具未必 —— **各自实测一次**。

## 🔴 VirtioFS 幽灵文件：`ls`/`stat`/`test -f` 全为真，`cat`/`open()` 却报「文件不存在」

**这条比它看起来贵**：它能让**一个没人改过的仓**门禁直接全红，而报文指着「文件不存在」——
于是每个人的第一反应都是「是不是谁删了它 / 改了 tsconfig / include 写错了」，
**去查一个根本没坏的东西**。本工作区在共享盘（VirtioFS）上实撞过。

**症状（同一个文件、同一时刻，两类系统调用给出相反答案）**【实测 2026-08-20，`src/utils/mediaDimensions.ts`】：

| 探针 | 结果 |
|---|---|
| `ls -la <file>` | 成功（`-rw-r--r-- 6455`） |
| `stat <file>` | 成功（`inode=4341382 size=6455`，与 `git cat-file -s HEAD:<file>` 逐字相符） |
| `test -f` / `test -r` | **都为真** |
| **`cat <file>`** | **失败，`No such file or directory`，rc=1** |
| 同目录其余 19 个 `.ts` 逐个 `cat` | **全部 rc=0**（同类正对照 ⇒ 不是"整个目录坏了"，判据有区分力） |

**代价**：`HEAD` 干净工作树下 `pnpm typecheck` 与 `pnpm lint:strict` **双双 rc=2** ——
`error TS6053: File '…/src/utils/mediaDimensions.ts' not found` / eslint `ENOENT … open '…'`。

**判据（一行就能判，别猜）**：

```bash
ls -la <file> >/dev/null 2>&1; echo "ls_rc=$?"      # 0
cat <file> >/dev/null 2>&1;    echo "cat_rc=$?"      # 非 0 ⇒ 幽灵文件
```

`ls_rc=0` 而 `cat_rc≠0` ⇒ **幽灵文件**。别去改代码、别去查 tsconfig。

**修法**【实测有效】：

```bash
rm -f <file>
git checkout HEAD -- <file>
cat <file> >/dev/null; echo $?        # 0
```

🔴 **两条护栏，缺一条就会把「修幽灵」变成「悄悄改代码」**：

1. **只对【已跟踪且工作树干净】的文件成立** —— 未跟踪文件这么干会**真的丢内容**。
   动手前先 `git status --porcelain -- <file>` 判归属，非空就停手。
2. **修完必须复验「工作树仍 0 行改动」**：`git status --porcelain -- <file>` 为空
   且 `git diff --stat HEAD -- <file>` 无输出。
   否则「我修好了幽灵」与「我悄悄改了一个文件」在交付里**完全同形**。

⚠️ **回溯效力**：本工作区此前把某次 vitest 红定性成「共享盘间歇 ENOENT」——
那多半就是这一条。⇒ **在这台机器上，任何一次「门禁红了」都先跑一遍上面那两行**，
再谈是不是代码的问题。

⚠️ 它与两类邻居**不是同一件事**，别混：`.claude/rules/rust-dev.md` 记的
「`tauri build` 在共享盘上 `Inappropriate ioctl for device`」是**写入语义**不支持；
本文件 2026-08-08 那条记的是**慢**（26 分钟）。这一条是**读取路径给出自相矛盾的答案**。

## 🔴 `grep -r` 与 `git grep` **不等价** —— 一个会漏读不到的文件，一个默认漏未跟踪文件

工作区根 `.claude/CLAUDE.md` 的判据陷阱表里那条「一律 `/usr/bin/grep` 或 `git grep`」，
把两者写成了**可互换的选项**。**它们不可互换**，各自有一个独立盲区，且**两个盲区的输出都与「真零命中」同形**。

### 盲区 A：`/usr/bin/grep -r` 遇到读不到的文件会**跳过它**，命中集合因此不完整

**唯一残留的信号是 `rc=2`，而 stdout 看起来跟正常一样**【实测，可复算，见下】：

| 情形 | stdout | rc |
|---|---|---|
| 目录里有一个读不到的文件（它**含**目标串） | **只列出读得到的那个** | **2** |
| 同上但 `2>/dev/null`（脚本里最常见的写法） | 同上，**stderr 那句唯一的线索也没了** | **2** |
| 恢复可读后同一条（同类正对照） | **两个文件都列出** | **0** |
| 现编串（负对照） | 空 | **1** |

⇒ **三态 rc 就是判据**：`0` = 有命中 · `1` = 真的零命中 · **`2` = 结果不完整，别下结论**。
`grep -r` 的 rc **绝不能只判 `-eq 0`**，也不能笼统写成「非 0 = 没找到」。

**在共享盘上，「读不到」不需要权限问题也会发生** —— 上一节的幽灵文件就是一例
（`open()` 直接 ENOENT）。本工作区实测：同一条 `/usr/bin/grep -rln <串> src` 连跑两次，
**有效命中集合相同、报错文件集合不同**（一个是稳定幽灵、一个是瞬时竞态）。

⇒ **仓内穷举一律 `git grep`**（走索引、不 readdir，结构上不会漏文件）；
`/usr/bin/grep` 只用于**单文件**或**管道下游**，**不用 `-r`**。

### 盲区 B：`git grep` 默认**只搜已跟踪文件** ⇒ 判「删干净了」必须带 `--untracked`

任何会**新建文件**的任务（搬家、抽公共件、加测试）都结构性地踩这个 ——
新文件还没进索引，`git grep` **看不见它**，零命中与「真删干净」完全同形。

**A/B 自证**【实测，本仓 2026-08-20】：新建 `src/components/common/ConfirmDialog.tsx` 后，

- (A) `git grep -c 'delete-confirm-overlay' -- src` → **rc=1，零输出**（而该串就写在新文件第 2 行）
- (B) 同一条加 `--untracked` → `ConfirmDialog.tsx:2` / `confirm-dialog.css:2`，**rc=0**
- (C) `ls -l` 证明两个文件在盘上

⇒ 两侧形状不同 ⇒ 判据有区分力。**凡是要下「零命中 ⇒ 删干净了」结论的 `git grep`，一律加 `--untracked`。**

### 判据速查

| 目的 | 写法 |
|---|---|
| 仓内穷举 / 判「有没有残留」 | `git grep --untracked -n <pat> -- <path>` |
| 判「某 commit 的树里有没有」 | `git grep -n <pat> <commit> -- <path>` 或 `git ls-tree -r <commit>` |
| 单文件 / 管道下游 | `/usr/bin/grep`（**不加 `-r`**） |
| 非得递归遍历盘上文件 | `find … -type f -exec /usr/bin/grep …` 或 `/usr/bin/grep -r` **并显式判 `rc==2`** |

🔴 **待 leader 收口**：工作区根 `../.claude/CLAUDE.md:242` 那条表行的处方
（「一律 `/usr/bin/grep` 或 `git grep`」）需按本节订正 —— 该文件不在本仓上界内，**本仓只记不改**。

## 🔴 删除类改动的引文纪律：引 `HEAD:<路径>`，并把引文**冻进证据文件**

删除类改动会**打穿自己的引文**：你引用的是**被你删掉的内容**，而复核方核的是**当前工作树** ——
删一行、后文整体上移，那条 `file:line` 必然 MISMATCH。**这不是复核方苛刻，是引法选错了。**

**判据（写引文前先问一句）**：我引的这一行，**在我改完之后还存不存在、还在不在那个行号上**？

- **会消失 / 会位移** ⇒ 引 `HEAD:<路径>:<行>`（或 `<commit>:<路径>:<行>`），
  并把 `git show HEAD:<文件> | sed -n '<行>p'` 的输出**落进一个新建的证据文件**，
  `verify:` 只 `cat` 那个证据文件。证据文件生成后**不许再改**。
- **仍然存在且不位移** ⇒ 才可以引活工作树的 `file:line`。

**第二条，同样吃过打回**：**引文片段必须逐字节复制，不许凭记忆重打。**
本工作区实测的一次 MISMATCH：把 `new Set(['/meeting', '/media', …])` 重打成了**无空格版** ——
语义相同、**字节不同即判不符**。⇒ 一律 `sed -n '<行>p'` 抠出来再粘，别手敲。

**正负对照**：同一条 `git show <commit>:<文件> | sed -n '<行>p'` 对**确知存在**的行有输出（会响）、
对超出文件行数的行号**零输出**（不恒真）⇒ 两侧形状不同。

## 🔴 `diff` 报「整文件替换」先看行尾：CRLF↔LF 会让「只改了注释」与「整个重写」输出同形

搬家 / 复制文件时，行尾可能被工具静默归一（本仓实测：`CRLF` → `LF`）。
此时 `diff` 给出 `1,332c1,339` 这种**全文替换**，与「这文件被重写了」**逐字同形**，
而真实差异可能只有文件头几行注释。

**判据（两步，顺序不能反）**【实测 2026-08-20】：

```bash
file - < <(git show <commit>:<旧路径>)    # 看有没有 "CRLF line terminators"
diff <(git show <commit>:<旧路径> | tr -d '\r') <(tr -d '\r' < <新路径>)   # 归一后再比
```

⇒ **跨行尾比对必须先 `tr -d '\r'` 归一**。归一前后两侧形状不同（全文替换 vs 只差几行）即证判据有效。
配套：`git diff -M` 的相似度（如 `R088`）会被行尾差异拉低 —— 别拿相似度低直接推「改动很大」。

## 🔴 `grep` 命中一个组件名，可能命中的是**同名不同源**的另一个组件

本文件已有一对镜像纪律（「『命中了』不等于命中的是那一类行」防假阳、「正对照必须与被测对象**同类**」防假阴）。
**同名不同源**是假阳的一个新形态，且特别能骗人：命中的**确实是**一个 JSX 组件用法，只是**不是你那个**。

**实测**【2026-08-20】：`git grep '<ConfirmDialog'` 在 `src/chat/shared/ChatMenu.tsx` 命中 **5 处**，
而交付通篇说「只有三个调用点」⇒ 第一反应是「交付漏了」。
打开 `src/chat/shared/ChatMenu.tsx:51` 才看清它 import 自 `./menu`
（`src/chat/shared/menu/ConfirmDialog.tsx`，类名 `menu-confirm` / `danger-btn`，与被查那个毫无关系）。

⇒ **纪律**：按**组件名 / 函数名**做的命中，**必须回溯到该文件的 import 段**确认来源，
再决定它算不算你的调用点。判据是「import 自哪个模块」，不是「名字一样」。

## 🔴 gen-34 追加（2026-08-21 · run-1787345934）：判「这是设计还是疏漏」的五问 —— **本节只追加在 EOF，不改上文任何一行**

> 起因是一次归属调查：App 在 `src/huanvaeGuard/HuanvaeGuardPage.tsx:619` 把 `windowData.serverUrl`
> 原样塞进交给 VPN 守护进程的 `control.master_url`，而那个值按本仓书面口径是**逻辑域名**、
> 且本仓另一处书面口径写着逻辑域名「**不用于连接**」。两条独立调查线各自到达同一结论（**是疏漏**）。
> 下面五条是那次调查里**可复用的形态**，不是那个结论本身 —— 结论会过期，形态不会。
> **本节只追加在 EOF**：本文件被多处 `file:line` 型 pin 钉着，中间插一行会把下面所有行号推移。

### 一、🔴 「当前代码的行为」在被证明是疏漏之前，首先是**别人的设计**

**机制成立 ≠ 谁错了。** 上游已经证到「传 X 会导致 Y 失败」，那只证明了**机制**；
「这是谁的疏漏 / 还是有人故意这么定的」是**另一个问题**，要另外证。
带着「这是个 bug，去修」开工，会把**归属判定**整个跳过 —— 而归属判错的代价不是白做一遍，
是**去改一个别人有意为之的东西**。

**可执行三栏归档（写结论前必须填完，缺一栏不许下判定）**：

| 栏 | 收什么 | 🔴 不许收什么 |
|---|---|---|
| **一致（支持"这是设计"）** | **有人写下过**「这里就该是 X」的原文 | 两可的占位符（`<host>` 这类两种形态都套得进去的）、测试里的镜像实现、占位夹具 |
| **不一致（支持"是疏漏"）** | **有人写下过**、方向相反的书面口径；穷举可复算的结构证据 | 同上 |
| **无关（缺席证据）** | 「我没找到任何说明」「那份文档一个字没提」 | —— |

🔴 **缺席只能进「无关」栏。** 「查不到有人讨论过 X」既不支持"是设计"也不支持"是疏漏" ——
它只说明**档案里没有书面痕迹**。把它写进「不一致」栏 = 拿判据的盲区当结论
（同族：本文件「用 grep 判『有没有发生』之前，先确认时间窗能覆盖」）。

🔴 **那正面证据从哪来？—— 找【兄弟件】，看它在同一情形下做了什么。**
这是把「缺席论证」升级成「正面论证」的最短路，且**可穷举**：

- 同一个仓 / 同一条流程里，**有没有别的组件面对同一个情形**？它做了什么？
- 若惯例存在且被执行过 N 次、而被查的这一处是唯一例外 ⇒ 这是**正面证据**，
  强度远高于「我没找到有人说过要这么做」。

**本次的三个实例（形态可照抄）**：
① App 里「把逻辑域名 URL 交给钉 CA 的连接器之前先改写主机」这套动作**存在且被执行过 2 次**
（`src/services/fileCache.ts` 与 `src/hooks/useAccounts.ts` 各一处调用 `directIpUrl`），被查的那一跳没走它；
② 同一个上游仓里的**命令行客户端**（做的是"客户端流程的命令行版"）**自己做一遍发现**、
产出 `https://<ip>:<port>` 形态的 IP 字面量地址 —— 而桌面守护进程**零发现能力**，也没人喂它 IP；
③ 引入这处接线的上游文档把它自述成「手边四个值全有 ⇒ 十行以内的**接线遗漏**」。

### 二、🔴 第四问：**不变量有【辖区】** —— 跨出辖区的值天然不受它保护

一条不变量（「所有 X 必经 Y」「连接前一律改写主机」）几乎总是**只在某一层内成立**，
而**那个辖区往往被原文写死了，只是没人读到那一句**。

**本仓的实证**：`src/services/discovery.ts:9` 把这条不变量的辖区**逐字写成「JS 层」**并点名了三个改写点；
工作区根 `ARCHITECTURE.md` 与 `设计文档/` 下那份设计文档**各自独立地写了同一句**
（`ARCHITECTURE.md` = 「**主机改写在 JS 层完成**」；设计文档 = 「**JS 层** rewriteUrlHost(url,ip,port)」）。
⇒ 三份文档口径一致：**改写发生在连接边界 / JS 层，不是发生在值本身**。
⇒ **任何跨出进程边界的地址值都天然逃出这条不变量**，而三份文档**都没有为非 JS 消费方指派任何人**。

**可执行做法（查同族缺陷时固定第四问）**：

> **这个值有没有跨出进程边界（或跨出那条不变量被写死的辖区）？**

- 先把不变量的**辖区原文**找出来（多半就在模块头注释 / 架构文档里，形如「在 X 层完成」）；
- 再穷举**改写工具的全部调用点**：`git grep --untracked '<工具名>(' -- src` 后
  **剥掉注释行**再数（本仓实测 `directIpUrl`：全集十几条命中且**该数会随代码长而漂、不适合当锚点**，剥注释后只剩 **3** 条可执行、其中 1 条是定义 ⇒ **真实调用点只有 2 个**）；
- **跨出辖区那一跳，两侧都要问一次**：发送方改写了吗？接收方改写吗？**两边都不改 = 不变量在这一跳整条断掉**。

⚠️ 判据坑：`git grep -c` 的输出 `文件:N` 是「文件名**:计数**」不是「文件:行号」；
剥注释要剥掉行首 `//` `*` `/*` 三种形态，别只剥 `//`。

### 三、🔴 第五问：**这条不变量有没有机器在守？** —— 它解释「为什么能活到第 N 代」

第四问定位**缺陷在哪**；第五问回答**它为什么活得下来**，而后者才是能复用的探针。

**判据（可当场跑，两侧形状不同即有区分力）**：

```bash
# 被测：这条"不变量"在测试面里有没有可执行语句（不是注释）
git grep -n --untracked '<不变量的关键串>' -- tests e2e | grep -vE '^[^:]*:[0-9]+:[[:space:]]*(//|\*|/\*)'
# 同类正对照：同一片测试面里，已知存在的静态契约手艺
git grep -l --untracked 'readFileSync' -- tests | wc -l
```

**本仓实测**：某跨仓类型契约的注释自称「字段**逐字镜像**」对侧结构体，
而 `tests` + `e2e` 里与它相关的命中**剥注释后为 0 条可执行** ⇒ **零机器守卫**；
同一时刻同一片测试面里 `readFileSync` 静态契约测试有 **63 个文件** ⇒ **手艺在，只是没用在这条上**。
⇒ 于是镜像时把对侧唯一一处形态信息（一个 IP 字面量示例）换成 `<host>` 占位符，
**结构上不会有任何东西翻红** —— 这就是它能活下来的直接原因。

🔴 **「自称逐字镜像」是一个高危信号**：它是**散文声明**，而散文声明是一次性断言、写错后没有任何东西复查
（同族：[frontend-test.md](frontend-test.md)「"所有 X 必经 Y" 类不变量：单一收口点 + 静态契约测试强制，不靠散文声明」）。
守卫要怎么写、以及**只 grep 字段名的守卫结构上不可能翻红**这个坑，见
[rust-dev.md](rust-dev.md)「只 grep 字段名的守卫，结构上不可能翻红」。**本条只负责让你问出这一问。**

### 四、🔴 脏树下的零命中结论，**被测侧也要在 HEAD 上复跑一遍**

工作树不干净时，很多人会给**正对照**做一句脏树免疫论证（「那几个脏文件不在我查的路径下」），
然后就下结论 —— **漏掉的恰恰是被测侧**。而「零命中」正是脏树最可能改变的那一类结论：
工作树里多一个未提交的文件、或某个文件被改过一行，都足以让一个真零命中变成假零命中（或反过来）。

**可执行做法**：

```bash
# 被测侧同一条判据，在 HEAD 上再跑一次（git grep 支持直接指定 commit）
git grep -n '<被测串>' HEAD -- <pathspec>
# 并把两次的 rc 与命中数并列写进交付；不一致就以 HEAD 侧为准并说明差在哪
```

⚠️ `git grep <commit>` **不接受 `--untracked`**（HEAD 里本就没有未跟踪文件）——
所以「工作树侧」与「HEAD 侧」两条命令**天生不同形**，两个数字要**分别标注来源**，别混着念。
🔴 别忘了本文件已有的另一半：`git grep` 默认只搜已跟踪文件，**判「删干净了」必须加 `--untracked`**。

### 五、🔴 一份文档自称「以 X 为准」，X 就进了**必读面** —— 不许因为它在范围外就跳过

调查里读到的文档常带一句「**当前权威现状以 [X] 为准**」。这句话把 X 变成了**决定性材料**：
它可能直接推翻你正在写的结论。**而范围划定通常是在读到这句话之前做的**，
于是"范围外"会把一份能翻盘的材料静默挡在门外。

**三条处置，按可行性取第一条能做的**：

1. **能读就读**（哪怕它在别的目录 / 别的仓）—— 成本通常只有几条 grep；
2. **读不了**（授权 / 上界 / 物理够不到）⇒ 在交付里**单列一条**「**决定性材料未读**：<路径>，
   若它写了 <会推翻什么>，本判定会翻」 —— 明写风险 ≠ 掩盖风险；
3. 🔴 **绝不许**因为"卡没让我读"就当它不存在。**卡的范围是上界，不是免责声明。**

**本次的实证**：设计文档 `:4` 自己指认工作区根 `ARCHITECTURE.md` 为当前权威，
上一张卡把它划在范围外 ⇒ 那份文档**确实**在同一粒度上写了主机形态口径
（`逻辑域名` / `rewriteUrlHost` / `directIpUrl` / `IP 字面量` 各有命中）。
补读之后结论未翻（它写的是同一条「JS 层」辖区，够不着跨进程那一跳），
**但"够不着"这件事本身是读完才知道的，读之前它是一个真实的翻盘风险。**

⚠️ 配套判据（仓外文件）：`ARCHITECTURE.md` 在工作区根、**不在任何项目仓内**
⇒ 那里**不能用 `git grep`**，只能用 `/usr/bin/grep` 且**必须显式判 `rc==2`**
（本共享盘会静默跳过读不到的文件，见本文件「`grep -r` 与 `git grep` **不等价**」一节）。

🔴 **「文档里有没有写形态口径」这类结论的正对照要选【同粒度】的串**：
本次的同类正对照不是「这文件有没有内容」，而是「**这文件写不写到这个粒度**」——
用 `逻辑域名` / `rewriteUrlHost` / `IP 字面量` 去打，全部命中（2 / 1 / 3）⇒ 证明它**确实写这一粒度**，
所以 `master_url` 那个 0 是**真 0**，不是"这文档根本不谈实现细节"。
负对照用**当场现编**的串（0 / rc=1）⇒ 不恒真。**两侧形状不同 ⇒ 判据有区分力。**

## 🔴 gen-43 追加（2026-08-27 · run-1787861591）：两条 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：单1 code `ce67b197` §1.3 / §10.2 与单2 review `89be8adc` §0 / §1-3 / §2-3。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 `file:line` 钉着）。

### 一、🔴 「我扫过了，没有」被一句人话推翻的完整实例 —— 错的不是任何一个 face，是**没写出来的隐含前提**

**事实链**：gen-42 用**两个** face 得出「生产上没有 ≥1GB 对象」：
(A) 9 个账号的 `/api/storage/files`，最大 **2,393,101**；(B) 本机 14 个 `chat_data.db` 的 `messages.file_size`，最大 **94,371,840**。
gen-43 一句口述线索（「HuanWei 发过一个 GB 级视频」）就把它推翻了：真对象 **4,466,203,264 B**，比第二名大 47 倍。

🔴 **两个 face 各自都跑对了、数字都能复现**（gen-43 原样复跑 face A 拿到同一个 `total=1` / 2,393,101）。
错的是「**这两个合起来 = 服务端全部文件**」这个**从来没被写出来、因而也从来没被检验过的前提**：

- `/api/storage/files` 列的是**个人文件库**；聊天附件在 bucket 前缀 `friends-file/conv-…/` 下，**结构上不进这个列表**；
- 那 14 个本地 `chat_data.db` 里 `conversation_id like '%shiqi77a%'` = **0 行**（同类正对照：库里另一个确知存在的 file_uuid 查出 2 行 ⇒ 查法会响；负对照现编 uuid = 0 行）——
  **这条会话从来没同步进任何一个本地库**。

⇒ **正确的全覆盖 face 是「逐好友 + 逐群翻 REST 消息分页到 `has_more=false`」**
（`GET /api/friends` → 逐好友 `GET /api/messages`；`GET /api/groups/my` → 逐群 `GET /api/group_messages`），
成本约 6200 条消息 / 约 70 次分页请求 —— **不贵，贵的是用错 face 得出的那个「没有」。**

🔴 **而这个正确 face 也有三个结构盲区（单2 补出，必须一并写，否则下一个人又会把它当"全覆盖"）**：

1. **scanner 若只在 `file_size` 非空时纳入统计**，「有 `file_uuid` / `file_size` 为 null」这一类**永不进 `max()`** ——
   而契约上它是**合法可空**的（`src/types/chat.ts:40` 的 `file_size: number | null;`）。
   🔴 gen-43 只堵了**反方向**那个洞（size 有 / uuid 无 = 0）并写成「洞已堵」——
   **两个对称的洞，只堵一个等于没堵。**（单2 实测另一侧在 5755 条样本上也是 0 ⇒ 结论不翻，
   但那个 0 是**测出来的**，不是**论证出来的** —— 两者在交付里长得一样，价值差很远。）
2. **覆盖面是「当前好友 + 当前已加入的群」**：`/api/friends` 与 `/api/groups/my` 不列已解除关系的好友、已退出的群
   ⇒ 那些历史会话**结构上不可达**，必须进「不覆盖」清单。
3. **分页游标若是 `before_time`**，同刻时间戳跨页边界可能被跳过；
   🔴 而**用同一游标做的 dump 探针探不到它自己造成的跳过**（同机制探针，见本文件「正对照必须与被测对象**同类**」）——
   真正独立地验它需要服务端侧计数口径，客户端做不到。**做不到就写做不到，别用同机制探针冒充。**

⇒ **可复用的动作**：任何「我扫了一遍，没有 X」的结论，落笔前多写一句
「**我这几个 face 合起来等于全集吗？这句话本身有什么证据？**」——
本例里那句话一旦被写出来，`/api/storage/files` 不含聊天附件这件事**一查就破**。

### 二、🔴 dump 类取证落盘前必须把消息正文脱敏 —— 「凭据安全」自查只覆盖自己那半边会**结构性漏掉**这一维

**本 run 实撞**：一次会话 dump 落进证据文件后，其中 **6 行 `content=`** 里有 **3 行**命中「密码 / password / 口令」字样，
是**真实第三方的聊天正文**，已随证据目录归档。
（本单只读复核确认该计数：`content=` 6 / 三关键词 3 / 现编负对照 0 ⇒ 判据会响也会静，**未改动他人证据文件**。）

🔴 **为什么它躲得过自查**：那份交付里有一整节讲安全，但口径是「**我自己账号的口令不打印、不落盘**」——
这个口径**结构上覆盖不到**「把**别人的**聊天正文 dump 进证据文件」这一维。
两者都叫「凭据安全」，而**一条自查通过、另一条根本没被问到**。

**做法（零代价，照抄）**：保留结构字段（`send_time` / `type` / `sender` / `file_uuid` / `file_size`），
**只把 `content` 整列替换成占位符**。所有结构类统计（计数、max、四象限、时间戳分布）**仍可原样复算** ——
脱敏不损失任何一个承重读数。单2 这么做了，两份 dump 里含「密码」字样的 2 行 / 29 行全部落地为占位符，且脱敏后计数自查 + 正对照照跑。

⇒ **纪律**：交付里的「凭据安全」自查必须写成**两问**——
① 我自己的凭据有没有泄进产物？② **我有没有把别人的内容搬进产物？**
只答第一问 = 漏掉一整维，而漏掉的那一维**不会有任何东西报错**。

## 🔴 gen-45 追加（2026-08-28 · run-1787875481）：八条判据 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-45 三份 PASS 交付（单1 `fw-code-1787875990` / 单2 `fw-code-1787879662` / 单3 `fw-review-1787883106`）。
> 本节全是**判据形态**，结论部分在 [downloader-decision.md](downloader-decision.md) §9。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 `file:line` 钉着）。

### 一、🔴 预分配文件的 `st_size` 是零判别力的代理量 —— 「文件在长」类判据先问它是不是被预分配了

分片下载引擎在开工那一刻就 `set_len(total)` 把 `.hvpart` **预分配**成全长
（`src-tauri/src/unified_download.rs:528` 原文：`        f.set_len(total)`）
⇒ **从第 1 秒起 `st_size` 就恒等于总长**。拿它当「落盘进度」：
**断网时它不动、没断网时它同样不动 —— 正负两侧同形、零判别力。**

**真正的被测量是 `st_blocks × 512`**（稀疏文件已分配块）。实测同一份时间线两列并排：
`st_size` 取值集合**只有 1 个**；`st_blocks × 512` 有 **688** 个不同取值 ⇒ **判别力全在后者**。

⇒ **一般化**：凡「某文件在不在长 / 长了多少」类判据，落笔前先问一句
「**这个文件是不是被预分配 / 稀疏 / 预留了？**」。是 ⇒ 改用 `stat -f '%b'`（macOS）/ `stat -c '%b'`（Linux）
乘块大小，或用 `du` 一类看实际占用的口径，**别用 `ls -l` / `%z` 的字节数**。
⚠️ 措辞上留一句公道：任务卡写的是「`.hvpart` 落盘字节」，字面可读成「已落盘的块」——
属**歧义**而非纯写错；但**照最直白的读法（文件字节数）执行必然中招**。

### 二、🔴 `rc=137` 只在等**自己的**子进程时拿得到 —— 判进程被杀死用 `ps -p` 从有到无

`kill -9 <pid>` 之后的 `$?` 是 **`kill` 自己的退出码**，本来就不会是 `128+9`；
而目标进程若 `ppid=1`（例如上一棒交接过来、已脱离本 shell 的 App），它**不是你的子进程**，
`wait <pid>` 直接报 `pid <N> is not a child of this shell` ⇒ **137 结构上拿不到**。

⇒ 判据改成**两侧形状不同**的那一条：

```bash
ps -p "$PID" >/dev/null; echo "before_rc=$?"   # 0（有输出）
kill -9 "$PID"
ps -p "$PID" >/dev/null; echo "after_rc=$?"    # 1（空输出）
```

🔴 **不许为了凑上游要求的 `137` 编一个出来** —— 拿不到就换判据并写明为什么拿不到。

### 三、🔴 复核截图类结论的通用问法：「原图有几张？入证据的 OCR 有几张？差额那些为什么不 OCR？」

**判官结构上不查「交付表里那一行有没有对应的原始 OCR」** —— 它只核 `verify:` 指向的文件能不能复算。
于是「拍了 11 张、只 OCR 了 3 张，表里其余几行按**拍摄计划的标签**回填读数」这种事**没有任何东西会报错**，
而它与「每一行都真读过图」在交付里**完全同形**。

**gen-45 实例**：单2 拍了 11 张、只 OCR 了 3 张入证据；单3 把剩下 8 张补 OCR，
当场证伪了单2 两处头条读数（其中一处的读数与图上所见**相反**）。

⇒ **复核方固定动作**：先数**原图张数**与**入证据 OCR 张数**，差额逐张问「为什么不 OCR」；
**出图方固定动作**：表里每一行都要能指到一份原始 OCR，指不到就标「按计划标签，未读图」。

### 四、🔴 探针把待查串写进自己的 argv ⇒ 方括号技巧失效、全部假命中

工作区根 `CLAUDE.md` 判据陷阱表里那条「`ps -Ao pid,command | grep '[x]xx'` 挡不住外层 shell 自身的命令行文本」
**又被撞了一次**，形态是新的：探针脚本自己 `echo -n "sampler.py 计数="` ——
**那句 `echo` 的文本进了外层 shell 的 cmdline** ⇒ `ps -Ao command | grep '[s]ampler.py'`
把它自己数了进去 ⇒ 实测 **5 个后台件全部假命中 1**，而「残留 1 个」与「真有 1 个在跑」完全同形。

⇒ **修法（两条一起用）**：① **先把探针脚本落成文件再执行**（别把待查串留在一行 `bash -c` 的 argv 里）；
② **按 pid / ppid 显式排除自身**（`ps -eo pid,ppid,command | awk -v me=$$ '$1!=me && $2!=me'`）。
并且**正对照必须选一个确知在跑的同类进程**（gen-45 用 `huanvae-chat-app` = 1），
负对照用**当场现编**的串（= 0）⇒ 两侧形状不同才算判据成立。

### 五、🔴 非特权跑 `pfctl` 会让正负对照**双双为 0** —— 两侧同形 = 零判别力

`pfctl` 不带 `sudo` 时报 `/dev/pf: Permission denied`、输出为空 ⇒
「我的锚有没有残留」与「pf 里有没有任何锚」**都得 0**。
gen-45 实测：非特权下 `hvgen45` 锚计数 = 0、**正对照 `com.apple` 也 = 0**；
改 `sudo -n` 后正对照才变 1、被测仍为 0 ⇒ **那个 0 这时才是真 0**。

⇒ **纪律**：凡「清场干净了吗 / 残留为 0 吗」类结论，**正对照必须先在已知真值上标定**
（macOS 上 `com.apple` 锚必然存在，是现成的锚点）。标定不成功 ⇒ 判据坏了，别下结论。

### 六、macOS 上做 OCR 的现成工具与几何（下一棒照抄能省一轮）

- 工具：`/private/tmp/hv-gen45/croc`（Vision 框架小工具，源码 `croc.swift` 同目录），
  用法 `croc <in.png> <out.png> <x> <y> <w> <h>`，**`x<0` = 不裁剪、整屏 OCR**。
  **2026-08-28T02:47Z 现查它仍在**（`ls -l` 有输出）；`/private/tmp` 会被清空，**用之前自己 `ls` 一次**，
  不在就按 `croc.swift` 重建（同目录）。
- 🔴 本机**没有** `tesseract` / `magick` / `ffmpeg` / PIL / numpy —— 别按常规套路找它们。
- 配套几何（gen-45 那台机的 App 窗口）：主窗 @448,100 时缩略图区 = 像素 `2300,1200,640,400`；
  主窗 @896,100 时 = `3196,1200,680,440`。
- ⚠️ **点视频缩略图会同时弹一个独立预览窗（1280x720 @ 320,150），它会盖住主窗里的缩略图** ——
  先把主窗移到 `x=896`，让缩略图落在 `x≈1758 >` 预览窗右边界 1600，否则连拍拍到的是播放器自己的 UI。
- ⚠️ **隐私处置口径**：复算截图必然会看到第三方消息内容。gen-45 的处置是
  **只把 `^[0-9]+%$` 这类控件读数放行进证据文件，原始与裁剪 PNG 全部留在证据目录之外**（`chmod 700`），
  正文只描述控件形态、不转述任何消息内容。**照抄这条，别各自发明一套。**

### 七、定向断网的可复用形状（比「关网卡」安全 —— 机上常有别的线在跑）

1. **源站 IP 现查**，别写死别猜：下载进行中跑
   `lsof -nP -a -p <pid> -i TCP -sTCP:ESTABLISHED`，按对端 IP 计数取第一名。
   🔴 **少写一个 `-a` 就退化成 OR** ⇒ 把**全机**连接都列出来，而「我的进程连了 N 条」
   与「全机连了 N 条」在输出里长得一模一样。
2. **只封那一个 IP**，规则写进匿名锚（macOS 主规则集有 `anchor "com.apple/*" all` 会评估它），
   **未关整机网卡、未加全局 443 规则**。
3. **看门狗以「主进程消失」为触发，不是定时**；脚本落成独立文件、argv 与主脚本可区分
   （否则 `pkill -f` 会把安全网一起杀掉）；另加一个远大于实验时长的硬顶。
4. **收尾四证，缺一条都可能漏掉残留**：主规则集与基线**逐字一致**（`diff` rc=0，配负对照改 1 字节 ⇒ rc=1）
   · `pfctl -s info` 回基线 · 无残留进程（配正/负对照）· 对刚被封的那个 IP 连通正常。
5. ⚠️ **封那个 IP 会波及别的线**：gen-45 现查同一 IP 上另有 3 个 node 进程各 1 条连接
   ⇒ **窗口要短、要登记**，别默认「只封一个 IP 就没有外部影响」。

### 八、UI 进度与真实字节**两个序列必须并列取** —— 只采一侧，另一侧到写交付时才发现是空的

「界面显示的进度」与「盘上真实字节」是**两个独立序列**：只采字节拿不到界面序列，只采界面拿不到真实进度，
而「UI 有没有骗人」这个问题**必须两列并排才回答得了**。

gen-45 的卡只写了「每秒采样 `.hvpart` 字节」，**没要求采界面数字**，却在另一处断言「界面序列已在采」——
执行方到写交付时才发现界面侧只有零星几个截图点、**没有 GB 级覆盖**，只好**自行加做一次不中断的完整对照 run**
才补上 84 帧的并列序列。⇒ **派单侧**：要 UI 对照就把两条采样各写一行；
**执行侧**：开跑前先问「我这两列都在采吗？」，缺一列当场补，别等到写交付。

## 🔴 gen-47 追加（2026-08-29 · run-1787970946）：一条判据标定范式 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-47 单2（review，交付 `fw-review-1787977119-15a6f59c.md`）§2-①，
> 它补的是单1（`fw-code-1787971463-0cb18b20.md`）§4 里缺的那一半。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 `file:line` 钉着）。

### 🔴 结论形如「这个小数字说明**没发生** X」时，必须**合成一个已知发生了 X 的样本**喂给**同一个指标**

本文件已有一族纪律讲「正对照必须与被测对象**同类**」「负对照必须自证会产生不同形状的输出」。
这一条补的是**另一半**：当结论是「**读数很小 ⇒ 那件事没发生**」时，
「静止两帧读数为 0」这种**不带噪自证**是**不够**的 —— 它只证明工具不乱响，
**证不出「真发生了 X 的时候它会响多大」**。
差的那一半只能靠**合成**：**自己造一个确定发生了 X 的样本，用同一个指标量同一个对象。**

**判决性实例**（结论：整个界面**没有**被轻微缩放；被测的是同一个标题盒、同一个 `cmp_region` 指标）：

| 情形 | diff_px | **max_channel_delta** |
|---|---|---|
| **真实读数**（同一手势前后 · 标题盒） | 2749 | **3** |
| 合成整页缩放 1.001x（绕屏幕中心） | 7069 | **228** |
| 合成整页缩放 1.002x | 8869 | 229 |
| 合成**整数 1px 平移** | 5684 | 228 |
| **最不利情形**：缩放中心恰好落在该盒自己身上，1.001x | 5708 | **65** |
| 同上 1.002x | 6294 | 129 |

⇒ **哪怕只有 0.1% 的整页缩放、哪怕把缩放中心挪到最有利于藏的位置，maxΔ 也在 65~228，而实测是 3**
—— 差两个数量级 ⇒ 那个「3」**真的**只是合成层重绘的舍入噪声，不是位移。

🔴 **顺带一条挑列的纪律**：上表 `diff_px` 那一列**几乎没有判别力**（真实 2749 与最不利合成 5708 同量级），
承重的是 `maxΔ`。**「有多少个像素变了」是弱量，「单个像素最多变了多少」才是强量** ——
挑错列会让整条论证垮掉，而**输出看起来一模一样**。

**成本只有几分钟，换来的是把一句文字论证变成两个数量级的差。** 凡「小数字 ⇒ 没发生」，一律照做。

**配套：多条判据并用时，必须标出哪条承重、哪条偏弱在哪。**
同一 run 的第二条判据（标题文字 ink 质心位移：真实 −0.080 px；
**负对照**人为把该区域下移 1 px 得 +0.985 px ⇒ 质心判据不瞎）**成立**，
但它**对「缩放中心恰在该盒上」这一情形偏弱**（那时质心本身几乎不动）。
⇒ **两条判据合起来才完整；只留一条、或留了两条却不说哪条弱在哪，都是把论证报强。**

## 🔴 gen-48 追加（2026-08-29 · run-1787982711）：macOS 多载体 GUI 取证的五条 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-48 单3（review，`fw-review-1788007591`）与单4（code，`fw-code-1788010332`）。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 file:line 钉着）。
> 背景：本机常年有**多条线各跑一份同一个 App 的不同构建**，下面五条全部是在这个前提下实撞的。
> 🔴 单3 用它们**推翻了单2 的整段真机结论**（三组 A/B 读数全部作废）—— 代价是一整轮真机取证。

### 一、🔴 `osascript` 的 `first process whose unix id is <PID>` 在两个进程同名时会**指错进程**

**现象（与真结论同形的那一面）**：osascript **返回成功**、`name of proc` 自报的进程名也**正好是你要的那个**，
但它动的是**另一个**同名进程的窗口。⇒ 你请求「把窗口挪到 A」，结果 A 纹丝不动、B 被挪走了 ——
这与「命令没生效 / 窗口不支持移动」**完全同形**，而且**没有任何报错**。
本机 `.app` 的可执行文件同名（多份构建都是同一个可执行名）⇒ **同名进程是常态，不是巧合**。

**可执行判据（单变量实证，只换一个值）**：对**你自己的 pid** 请求一个**新的、与现状不同的**几何值，
然后**同时读两个进程的窗口 bounds**：

- 判「指错了」的形状：目标 pid 的窗口 bounds **前后逐字不变**，而**另一个** pid 的窗口 bounds **变成了你请求的值**；
- 判「指对了」的形状：正好相反。

**正/负对照**：
· **负对照**（证明这条计数不恒真）：请求一个荒谬几何（如 `set position of w to {4242, 4242}`），
  在命令流水里查该串 ⇒ 命中 0；
· **正对照 = 换一种驱动方式重跑同一条请求**：按 pid 构造 AX 句柄（`AXUIElementCreateApplication(pid)`）后
  再请求同一个移动 ⇒ 单4 实测形状**正好相反**（目标窗口 `244,57,1024,820` → `400,100,1024,820` 并升到最前，
  另一条线的窗口 `80,60,1100,860` **逐字不变**）。

**可用替代（两件，配套用）**：
1. **驱动**：按 pid 构造 AX 句柄（`AXUIElementCreateApplication(pid)`），**结构上不可能指错进程**；
2. **辨认**：`kCGWindowOwnerName` 取的是 **CFBundleName**、**不是可执行文件名**
   ⇒ 只要三份构建的 `CFBundleName` 各不相同（单4 用的是 `HVgen45-…` / `HV-gen48c2-before` / `HV-gen48c2-after`），
   **窗口清单里天然可分**。⇒ 做多载体实验时，**开工第一件事就是给每份载体一个可分辨的 CFBundleName**。

**一手来源**：单3 §2.3（单变量实证：请求动 A 的 pid，实际动了 B 的窗口；且这解释了「另一条线的窗口
**恰好**停在段二脚本请求的那个几何」）· 单4 §1.1（换 AX 句柄后单变量实证形状相反）。

### 二、🔴 GUI 自动化里「点击/截图**落在谁身上**」必须**每次现证**，不许假设

**现象（同形面）**：多个窗口重叠时，你算好的坐标可能整个落在**别人的窗口**里 ——
点下去别人的界面动了、你的没动，而截图（如果用屏幕区域抓）拍到的**仍然是一张"看起来对"的图**
⇒ 「我点了但 App 没反应」与「我根本没点到这个 App」**完全同形**。
单4 实测：它要点的两个关键点 `(912,688)` 与 `(600,649)` **都在另一条线那个窗口的 bounds 内**（`80,60,1100,860`）。

**可执行判据**：`CGWindowListCopyWindowInfo(onScreenOnly)` 的 **front-to-back 次序**里，
**第一个 `layer=0` 且 bounds 包含该点**的窗口，就是点击真正会落到的那个。**每次点击前跑一次**。

**🔴 截图一律 `screencapture -l <CGWindowID>`（抓窗口自身表面），不许 `-R <屏幕区域>`** ——
区域截图**分不出是谁的窗口**，而这正是单2 翻车的直接原因（它整段读数拍的是另一条线的窗口）。
录像同理：`screencapture -x -v -V<秒> -l<窗口号>`。

**正/负对照（三种点必须给出三种不同形状，缺一条判据就不算成立）**：
· 正对照 = 你要点的那个点 ⇒ 报出**你自己的** winid/pid/owner；
· 负对照① = 一个**只落在别人窗口里**的点 ⇒ 报出**别人的** winid（单4：`(150,880)` → 另一条线的 winid 2415）；
· 负对照② = 一个**两个窗口都不覆盖**的点 ⇒ 报 **NONE**（单4：`(1450,950)`）。

**一手来源**：单4 §1.2 / §1.3 · 单3 §5「该重派什么」第 1 条（它把这两条写成了重派的硬门）。

### 三、🔴 「像素读数是**稳态值** ⇒ 被测对象确实在做那件事」是**代理量**，换个窗口一样成立

**现象（同形面）**：你量到某区域亮度是个漂亮的稳态值，于是判「它确实在显示那个东西」——
但**另一条线的窗口在同一块屏幕区域上也给出几乎同一个数**。
**判决性数字（单3 三方对照）**：单2 那个「稳态 `mean_luma=61.34`」与**另一条线窗口**同区域差 **0.17**，
与**它自己的载体**差 **171.16** ⇒ 那个读数拍的是别人。

**可执行判据（要证「被测进程真的在跑那件事」，必须给【正面读数】，不能只给像素）**，两条任选其一、最好都给：
1. **它自己的 stdout 里只有该动作才会打的行**。单4 用的是 `[Command] db_init 被调用` +
   `[DB] 初始化数据库: <它自己 .app 里的库路径>` —— **路径本身就是归属证据**（打印的是它自己 bundle 内的路径）；
2. **它自己的数据文件 mtime 在测试窗口内被它自己推进**。
   🔴 **必须排除你自己跑写命令的那些时刻** —— 单3 抓到的正是这个：单2 两个载体的库 mtime
   （`12:01:13` / `10:48:03`）**正好是单2 自己跑 `sqlite3 UPDATE` 的时刻**，不是 App 写的。
   单4 那次则落在「我一条 `sqlite3` 写都没跑过」的窗口里（`12:01:13` → `13:43:24`，第一条写是 13:45）。

**正/负对照**：
· 正对照 = 一个**确实登录了的同族载体**：单3 用另一条线的常驻 App ⇒ `db_init` 8 / `[DB]` 21 / `[Command]` 16；
  单4 自己的载体 ⇒ `db_init` **2** / `[DB]` **5** / `[Command]` **4**；
· 被测（单2 那两个载体）⇒ 三项**全 0**；
· 负对照 = 当场现编串（如 `w4k9-nosuchline-2210` / `q7v3-no-such-line-8821`）在**同一份日志**里命中 **0**
  ⇒ 这条 grep **会响也会静**。

**一手来源**：单3 §2.2（四条独立证据链 + 三方亮度对照）· 单4 §2（三条正面读数）。

### 四、被测系统**会自己改前置条件** ⇒ 「设成 X 再测」必须**跑前设、跑后复核**

**现象（同形面）**：你把一格设成「无 X」，跑完读数很干净 ——
但**被测系统在你跑的那几分钟里自己把 X 造出来了**，于是那格其实是「有 X」，读数指向反向结论。
**实例（单4 作废格 A）**：一格标称「**无封面**」的对照，跑之前 App **自己截帧成功并写了一张封面**
（它自己的 stdout 里有 `[VideoPoster] 已保存封面 … (40218 字节)`）⇒ 那格报「0 近黑帧」是假的；
按「跑前设 + **跑后再核一次**」重做，同一格测到 **494 ms** 黑窗。

**可执行判据**：每一格的前置状态，**跑前设一次、跑后再读一次**，两次都写进证据；
两次不一致 ⇒ **该格作废重做**，不许拿跑前那次的设值当结论。

**一手来源**：单4 §7 作废格 A。

### 五、`screencapture` **逐帧**抓的上限约 **130 ms/帧** ⇒ 几百毫秒量级的瞬态要用录像

**现象（同形面）**：用 `screencapture -l` 循环逐帧抓，采样间隔比被测瞬态还长
⇒ 「没拍到那一帧」与「那一帧不存在」**完全同形**。
单2 那次的采样间隔约 **110 ms**，导致黑窗只能给出「≥295 ms、上界 ~446 ms」这种带大误差的区间。

**可执行判据 / 做法**：改用**录像**（`screencapture -x -v -V<秒> -l<窗口号>`，仍是窗口号形态）
→ 再按**固定步长**抽帧（单4 用 33 ms），并**把步长写进结论**：**比步长短的闪烁本方法看不见**。
单4 因此把同一现象量到了 33 ms 分辨率的整数帧数（494 / 758 / 1748 ms 各对应 15 / 23 / 53 帧）。

**正/负对照**：抽帧链本身要标定 ——
· 正对照（证明压缩没把真黑抬亮）：**稳态视频帧**里一块确知近黑的子区 ⇒ `dark_ratio = 1.000000`；
· 负对照：**同一张帧**里一块确知亮的子区 ⇒ `dark_ratio = 0.000000`。两侧形状不同才算标定成立。
🔴 单4 第一版把正对照取在录像的 `v00000` 帧上 —— 那一刻画面还停在**上一个会话**、该子区根本不黑
⇒ 给出的 `0.000000` 对「压缩会不会抬亮真黑」**零判别力**，已换成稳态帧重做。

**一手来源**：单4 §3.1 · §7 第 3 条（那条被换掉的坏正对照）。
