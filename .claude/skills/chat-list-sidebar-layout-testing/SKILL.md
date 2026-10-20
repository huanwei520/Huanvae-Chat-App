---
name: chat-list-sidebar-layout-testing
description: 聊天列表固定卡移除 + 侧边栏双区布局（sidebarLayout 钉住区/更多区）改动的定向测试矩阵——防回弹双保险断言、空状态豁免删除类行为变更锁定、旧持久化布局升级迁移用例、Sidebar 组装层（moreItems→回调）与受控组件层（SidebarMorePanel）的分层缺口定位、VNC 真机截图流程要点（黑屏唤醒/右键 click 3/Enter 不发送需点按钮）。要对 UnifiedList / MobileChatList / Sidebar / sidebarLayout / MobileDrawer 做测试补全或评审其覆盖缺口时，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 聊天列表/侧边栏布局改动定向测试矩阵

> 来源：块 `1792465686977-647uggj7-1`（取消 AI 助手强置顶并迁入更多功能）testharness 层沉淀（2026-10-20）。
> 场景：从聊天列表删除「代码固定渲染卡」（AI 助手置顶卡），入口迁移至侧边栏「更多功能」面板。

## 一、固定卡移除类改动的测试矩阵（防回弹五件套）

1. **列表防回弹**：组件级 `container.querySelector('[data-conv-key="<fixed-key>"]')).toBeNull()`
   （UnifiedListPinned.test.tsx）+ e2e 层 `locator('[data-conv-key=…]').toHaveCount(0)`
   （e2e-real/real-flows.spec.ts）双层。仅一层会被单层重构悄悄绕过。
2. **文案级防回弹**：`screen.queryByText('<卡面文案>')).toBeNull()`——防「换 data-key 不换文案」
   的半回弹（MobileChatListNoPinnedAi.test.tsx）。
3. **空数据形态**：固定卡通常是「无数据也渲染」的分支 → 必须补 0 好友 0 群形态的用例
   （旧代码 `filteredCards.length === 0 && activeTab !== 'chat'` 豁免正是靠固定卡活着）。
4. **行为变更点穷举**：删固定卡常连带删豁免/特判（空状态豁免、navKeys 前置注入、openByKey
   短路、右键菜单豁免）。每删一处豁免，补一个「豁免不再存在」的正向锁定用例（如 chat Tab
   空列表必须出现「暂无会话」覆盖层——UnifiedListChatEmptyState.test.tsx）。
5. **迁移用例**：入口迁移到持久化布局（sidebarLayout 双区）时，补「旧版 key 集合的已保存
   布局升级后新 key 落 more 末尾」显式用例（旧 6-key 全量 more → normalize 后 ai 补尾），
   别只测泛化的「部分缺 key 补缺」。

## 二、sidebarLayout 双区纯函数矩阵扩展法

- 既有矩阵（勿重复造）：非法结构全返回 defaultLayout / 非法 key 过滤 / 跨区重复留 pinned /
  同区重复留首个 / 部分缺 key 补尾 / 完整往返不变 / 全 pinned 合法 / localStorage null 与
  损坏 JSON。
- 新增工具项时最小增量 = 2 条：新 key 的跨区重复（pinned wins）+ 旧 key 集合迁移。断言写
  **全量期望对象**（toEqual 整个 layout），禁逐字段 expect（防顺序回归漏网）。

## 三、组装层 vs 受控层分层缺口定位

- `SidebarMorePanel.test.tsx` 是受控 mock（onItemClick 收 action 引用），测不到真实 Sidebar
  的 `moreItems[key].onClick` 绑定；`SidebarPinned.test.tsx` 只测钉住区按钮。
- ⇒ 新增工具项必须补一条**组装层链路用例**：真实 `<Sidebar …/>` → 点 `getByTitle('更多功能')`
  → 点 `getByText('<label>')` → 断言对应回调恰 1 次 + 其余工具回调 0 次
  （SidebarAiMoreEntry.test.tsx）。renderSidebar 的 fns 对象里先把新回调加齐再写断言。
- 移动端同理：MobileDrawer 无既有测试时从零建最小组件回归（点击→回调+onClose 各恰一次、
  其余回调零调用），MobileChatList 补「点击路由 type 不再指向被移除入口」断言。

## 四、VNC 真机截图流程要点（winserver-hg，vncdo）

- 连接：`vncdo -s 127.0.0.1::5900 …`（宿主已配端口转发；实例 IP 直连 5901 ping/blk 均 FAIL
  是常态，用转发口）。
- **黑屏唤醒**：长时间空闲后 capture 全黑（3KB 小文件）→ `move x y key esc sleep 3 capture`
  即唤醒，无需动电源。
- **右键** = `click 3`（VNC 按钮编号）；置顶菜单项点击坐标以当轮截图现量，禁抄历史值。
- **聊天输入框 Enter 可能不触发发送**（VNC keyevent 与 WebView 焦点组合问题）：输入后若
  文本滞留输入框，直接点发送按钮（输入框右侧圆形箭头，回车图标变蓝色即已就绪）。
- 证据纪律：每张 `file` 验 PNG 1280x800 + sha256 前 16 位落档；独立取景用 hover tooltip
  （如悬停「好友」出「好友」气泡）证明截的就是侧边栏本体。
- 测试后进程卫生：`ps aux | awk '$8 ~ /Z/'` 查僵尸、vitest/node 无残留。

## 五、本项目可复跑命令锚点

```
npx vitest run tests/components/UnifiedListPinned.test.tsx \
  tests/components/UnifiedListChatEmptyState.test.tsx \
  tests/components/SidebarAiMoreEntry.test.tsx \
  tests/components/SidebarMorePanel.test.tsx \
  tests/components/MobileDrawerAiEntry.test.tsx \
  tests/components/MobileChatListNoPinnedAi.test.tsx \
  tests/unit/sidebarLayout.test.ts --maxWorkers=3
```
全量回归：`npx vitest run --maxWorkers=3`（407 文件/4457 用例基线，~87s）。

## 六、update 层增量（第 6 类耦合面·残留归类·双端扩展边界·「走不通」双端查测）

> 来源：同块 update 层第 2 次执行沉淀（2026-10-20），判官反馈「三问/覆盖面上界/落点 file:line/mTLS 无查测」四缺项整改的领域增量。

- **固定卡耦合面第 6 类＝专用展示 prop 链，拆除必须扫到生产端**：基线 `git grep -n aiConversationTitle <基线commit> -- src` 命中 11 行跨 5 文件（UnifiedList.tsx :19/:112/:413/:877/:879、MobileChatList.tsx :46/:84/:252、useMainPage.ts:1130、Main.tsx:176、MobileMain.tsx:550）。本块只删了消费端（组件 props＋两处传参），生产端 useMainPage.ts:1130 成孤儿字段（HEAD 全仓唯一命中）——拆链以基线枚举起步、终态以 `git grep -c '<prop>' -- src`=0 收口，非 0 即孤儿（登记清理，勿静默）。
- **删完不是命中越少越好，残留按五类归类再判**：A 会话页已打开后的 key 派生/选中高亮（`chatTarget.type === 'ai' ? 'ai-assistant'`）、B 会话页顶栏标题、C AI 功能本体（API/头像/类型注释）、D 新入口（sidebarLayout/Sidebar/MobileDrawer）、E 整改说明注释；只有命中 §一 删除点模式（key 注入/固定分支/固定卡 JSX/豁免/权重）才算残留。
- **sidebarLayout 的移动端边界（双端扩展易漏点）**：SIDEBAR_ITEM_KEYS 消费端仅桌面系（sidebarLayout.ts 本体、SidebarMorePanel.tsx:27 及 3 个测试件；Sidebar.tsx 经多行 import + moreItems Record 间接消费、单行 `grep import` 会漏多行 import）；MobileDrawer.tsx 对 sidebarLayout 零依赖（grep rc=1）——移动抽屉工具面是平行 UI（无钉住区交互），新增工具项桌面三步扩展后**必须另在 MobileDrawer 菜单加同款项**，否则双端入口不同步。
- **「某路径走不通」结论的双端查测法（mTLS 实例）**：仓库侧实证＝`ls src-tauri/resources/ | grep client`（仅 app-client.cert.pem 1265B）＋`git show <HEAD>:src-tauri/resources/app-client.key.pem`（fatal: path does not exist＝私钥构建机注入、git 不跟踪）；服务端侧（生产 nginx ssl_verify_client）不在本仓且沙箱无路由 ⇒ 标注「未验证·转述」并引 RESCUE 存档 standardTries 原文（nginx 400『No required SSL certificate was sent』）。禁一句「mTLS 阻断」无锚结论。
