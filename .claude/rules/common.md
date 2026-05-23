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

- 第一版 [MobileNfcScanPage.tsx](src/pages/mobile/MobileNfcScanPage.tsx) 用 `scan({ type: 'ndef' })`
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
