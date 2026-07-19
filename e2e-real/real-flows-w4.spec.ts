/**
 * real-e2e(L2.5-web) 流程 4/5/6/7 —— 群消息跨实例 / 已读回执跨实例 / presence 跨实例 / 文件上传下载.
 * 真前端 + 真 HTTP/WS + 真双实例后端. 非 L3 真机.
 *
 * - 流程4：群消息跨实例（群主 API 发群消息，两成员 UI 实时收到）
 * - 流程5：已读回执跨实例（B 发消息 → A 打开聊天 → B 侧回执翻已读）
 * - 流程6：presence 跨实例（A 观察好友 B 上线后在线点亮）
 * - 流程7：文件上传下载（A 上传好友文件 → B 收到文档卡 + harness 字节一致校验）
 *
 * 运行：`pnpm e2e:real`（需本地集群在位）。账号随机生成，非真实凭据，不清理。
 */

import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import {
  ORIGIN_A,
  ORIGIN_B,
  PASSWORD,
  newAppPage,
  watchDataPlaneWs,
  loginViaUI,
  openFriendChat,
  sendMessageViaUI,
} from './helpers/ui';
import {
  INSTANCE_A,
  INSTANCE_B,
  registerUser,
  loginUser,
  sendFriendRequest,
  approveFriendRequest,
  createGroupWithMembers,
  sendGroupMessage,
  uploadFriendFile,
  getFriendFilePresignedUrl,
  downloadBytes,
} from './helpers/backend-api';

/** 每次运行随机的账号后缀（字母数字） */
const run = Date.now().toString(36);

/** 每条消息去重的随机短串 */
const rand = () => Math.random().toString(36).slice(2, 8);

test.describe.configure({ mode: 'serial' });

test('流程4：群消息跨实例 — 群主(实例A) API 发群消息，两成员(实例B) UI 实时收到', async ({
  browser,
}) => {
  const userO = `w4o${run}`;
  const userM1 = `w4m${run}`;
  const userM2 = `w4n${run}`;
  const groupName = `g4-${run}`;
  const MSG = `group-msg-${run}-${rand()}`;

  // API setup：群主 O 注册于实例A；成员 M1/M2 注册于实例B
  await registerUser(INSTANCE_A, userO, `昵称${userO}`, PASSWORD);
  await registerUser(INSTANCE_B, userM1, `昵称${userM1}`, PASSWORD);
  await registerUser(INSTANCE_B, userM2, `昵称${userM2}`, PASSWORD);
  const tokenO = await loginUser(INSTANCE_A, userO, PASSWORD);
  const tokenM1 = await loginUser(INSTANCE_B, userM1, PASSWORD);
  const tokenM2 = await loginUser(INSTANCE_B, userM2, PASSWORD);

  // 群主建群 + 邀请 M1/M2 + 二人各自接受自己的邀请，返回 group_id
  const gid = await createGroupWithMembers(INSTANCE_A, tokenO, groupName, [
    { base: INSTANCE_B, token: tokenM1 },
    { base: INSTANCE_B, token: tokenM2 },
  ]);

  // M1/M2 在 ORIGIN_B UI 登录，等 WS connected，各自切群聊 tab + 打开该群面板（等消息输入框出现）
  const appM1 = await newAppPage(browser, ORIGIN_B, 'flow4-M1');
  const appM2 = await newAppPage(browser, ORIGIN_B, 'flow4-M2');
  const wsM1 = watchDataPlaneWs(appM1.page);
  const wsM2 = watchDataPlaneWs(appM2.page);
  await loginViaUI(appM1.page, userM1, PASSWORD);
  await loginViaUI(appM2.page, userM2, PASSWORD);
  await wsM1.waitConnected();
  await wsM2.waitConnected();

  for (const app of [appM1, appM2]) {
    await app.page.locator(`.nav-btn[title="群聊"]`).click();
    const card = app.page.locator(`[data-conv-key="group-${gid}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.click();
    await expect(app.page.locator('textarea[placeholder^="输入消息"]')).toBeVisible({
      timeout: 15_000,
    });
  }

  // 群主经实例A API 发群消息 → Redis 总线 → 实例B → 两成员 WS
  await sendGroupMessage(INSTANCE_A, tokenO, gid, MSG);

  // 自证：若 sendGroupMessage 群/内容错，或 M 未入群，气泡不出现即 FAIL
  await expect(
    appM1.page.locator('.message-row.other .bubble-text', { hasText: MSG }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    appM2.page.locator('.message-row.other .bubble-text', { hasText: MSG }),
  ).toBeVisible({ timeout: 15_000 });

  await appM1.context.close();
  await appM2.context.close();
});

test('流程5：已读回执跨实例 — B(实例B)发消息，A(实例A)打开聊天后 B 侧回执翻已读', async ({
  browser,
}) => {
  const userA = `w5a${run}`;
  const userB = `w5b${run}`;
  const MSG = `read-receipt-${run}-${rand()}`;

  // API setup：A(实例A) / B(实例B) 注册并互为好友（A→B 请求，B 同意）
  await registerUser(INSTANCE_A, userA, `昵称${userA}`, PASSWORD);
  await registerUser(INSTANCE_B, userB, `昵称${userB}`, PASSWORD);
  const tokenA = await loginUser(INSTANCE_A, userA, PASSWORD);
  const tokenB = await loginUser(INSTANCE_B, userB, PASSWORD);
  await sendFriendRequest(INSTANCE_A, tokenA, userA, userB);
  await approveFriendRequest(INSTANCE_B, tokenB, userB, userA);

  // B 在 ORIGIN_B UI 登录 → 打开与 A 的聊天 → 发消息
  const appB = await newAppPage(browser, ORIGIN_B, 'flow5-B');
  const wsB = watchDataPlaneWs(appB.page);
  await loginViaUI(appB.page, userB, PASSWORD);
  await wsB.waitConnected();
  await openFriendChat(appB.page, userA);
  await sendMessageViaUI(appB.page, MSG);

  // B 自己的气泡可见且为「已送达/未读」双勾（A 尚未打开聊天）
  const bOwnBubble = appB.page.locator('.message-row.own', { hasText: MSG });
  await expect(
    bOwnBubble.locator('.read-receipt-icon.double-check.unread'),
  ).toBeVisible({ timeout: 15_000 });

  // A 在 ORIGIN_A UI 登录 → 打开与 B 的聊天（打开即自动发 mark_read）
  const appA = await newAppPage(browser, ORIGIN_A, 'flow5-A');
  const wsA = watchDataPlaneWs(appA.page);
  await loginViaUI(appA.page, userA, PASSWORD);
  await wsA.waitConnected();
  await openFriendChat(appA.page, userB);

  // 自证：A 不打开聊天(不读)则 read 永不出现 → FAIL
  await expect(
    bOwnBubble.locator('.read-receipt-icon.double-check.read'),
  ).toBeVisible({ timeout: 20_000 });

  await appA.context.close();
  await appB.context.close();
});

test('流程6：presence 跨实例 — A(实例A)观察好友 B(实例B) 上线后在线点亮', async ({ browser }) => {
  const userA = `w6a${run}`;
  const userB = `w6b${run}`;

  // API setup：A(实例A) / B(实例B) 注册并互为好友
  await registerUser(INSTANCE_A, userA, `昵称${userA}`, PASSWORD);
  await registerUser(INSTANCE_B, userB, `昵称${userB}`, PASSWORD);
  const tokenA = await loginUser(INSTANCE_A, userA, PASSWORD);
  const tokenB = await loginUser(INSTANCE_B, userB, PASSWORD);
  await sendFriendRequest(INSTANCE_A, tokenA, userA, userB);
  await approveFriendRequest(INSTANCE_B, tokenB, userB, userA);

  // A 先登录（此时 B 未上线）→ 切好友 tab
  const appA = await newAppPage(browser, ORIGIN_A, 'flow6-A');
  const wsA = watchDataPlaneWs(appA.page);
  await loginViaUI(appA.page, userA, PASSWORD);
  await wsA.waitConnected();
  await appA.page.locator(`.nav-btn[title="好友"]`).click();

  // B 的好友卡可见，但在线点缺席（B 离线 → 条件渲染不出 .conv-online-dot）
  const bCard = appA.page.locator(`[data-conv-key="friend-${userB}"]`);
  await expect(bCard).toBeVisible({ timeout: 15_000 });
  await expect(bCard.locator('.conv-online-dot')).toHaveCount(0);

  // B 上线（ORIGIN_B UI 登录 + WS connected）
  const appB = await newAppPage(browser, ORIGIN_B, 'flow6-B');
  const wsB = watchDataPlaneWs(appB.page);
  await loginViaUI(appB.page, userB, PASSWORD);
  await wsB.waitConnected();

  // 自证：B 不上线则 dot 永不出现; 初始 toHaveCount(0) 证明非恒有
  await expect(bCard.locator('.conv-online-dot')).toBeVisible({ timeout: 20_000 });

  await appA.context.close();
  await appB.context.close();
});

test('流程7：文件上传下载 — A(实例A)上传好友文件，B(实例B)收到文档卡且字节一致', async ({
  browser,
}) => {
  const userA = `w7a${run}`;
  const userB = `w7b${run}`;
  const filename = `f${run}.txt`;
  const bytes = new TextEncoder().encode(`file-e2e-${run}-` + 'z'.repeat(40));

  // API setup：A(实例A) / B(实例B) 注册并互为好友
  await registerUser(INSTANCE_A, userA, `昵称${userA}`, PASSWORD);
  await registerUser(INSTANCE_B, userB, `昵称${userB}`, PASSWORD);
  const tokenA = await loginUser(INSTANCE_A, userA, PASSWORD);
  const tokenB = await loginUser(INSTANCE_B, userB, PASSWORD);
  await sendFriendRequest(INSTANCE_A, tokenA, userA, userB);
  await approveFriendRequest(INSTANCE_B, tokenB, userB, userA);

  // A 经实例A 上传好友文件（storage_location=friend_messages → 自动发出好友文件消息）
  const up = await uploadFriendFile(INSTANCE_A, tokenA, userB, filename, bytes);

  // B 在 ORIGIN_B UI 登录 → 打开与 A 的聊天
  const appB = await newAppPage(browser, ORIGIN_B, 'flow7-B');
  const wsB = watchDataPlaneWs(appB.page);
  await loginViaUI(appB.page, userB, PASSWORD);
  await wsB.waitConnected();
  await openFriendChat(appB.page, userA);

  // 层级如实：文件卡渲染 = 浏览器页面(L2.5-web)；字节一致 = 测试 harness 经 nginx
  // presign→MinIO 的 node fetch 比对(L2.5-web HTTP 面)，非真机。
  // 文档卡显示文本 >20 字截断，title 恒为全名 —— 断言 title 属性（文件名也已控制在 <=20 字）。
  await expect(
    appB.page.locator(
      `.message-row.other .file-message.document-message .document-name[title="${filename}"]`,
    ),
  ).toBeVisible({ timeout: 15_000 });

  // 字节一致性：经实例B 取预签名 URL → 下载 → 与上传 sha256 比对。
  // 自证：改错 up.fileUuid 或篡改字节 → SHA 不等 → FAIL。
  const purl = await getFriendFilePresignedUrl(INSTANCE_B, tokenB, up.fileUuid);
  const dl = await downloadBytes(INSTANCE_B, purl);
  const dlSha = createHash('sha256').update(Buffer.from(dl)).digest('hex');
  expect(dlSha).toBe(up.sha256);

  await appB.context.close();
});
