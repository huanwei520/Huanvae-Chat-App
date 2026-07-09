/**
 * 契约测试：webview 远程媒体显示 src 必经唯一收口点 resolveDisplayUrl（或委托它的 resolveServerAvatarUrl）。
 *
 * 背景：no-SNI/私有 CA 架构下，webview 原生 `<img>/<video>` 用系统信任库校验私有 CA 自签 leaf 失败
 * （certificate invalid）。因此任何"要在 webview 显示的远程后端媒体地址"都必须先经 resolveDisplayUrl
 * 改写成回环反代 URL（后端资源）或原样放行（外部真 CA），不得把裸 presigned/后端 URL 直接喂 `<img src>`。
 *
 * 这是一条**架构不变量**：历史上"显示层补完/消灭剩余直连"是散文声明、靠人工枚举迁移，漏了聊天图片/视频
 * 显示路径且无人复查（门禁全绿但真机失败）。本测试把该不变量变成机器可强制：静态扫描各产出点/显示点，
 * 漏接反代即 FAIL。vitest jsdom + mock invoke 测不到真实 TLS，故用源码静态扫描守门（与 animation-conflict
 * /css-encoding 同套路；vitest 静态扫描读源码用 __dirname，见 .claude/rules/frontend-test.md）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

const FILE_CACHE = read('src/services/fileCache.ts');
const MEDIA_PREVIEW = read('src/media/MediaPreviewPage.tsx');
const SECURE_PROXY = read('src/services/secureProxy.ts');
const AVATAR = read('src/utils/avatar.ts');
const USE_GROUP_READ_RECEIPT = read('src/chat/group/useGroupReadReceipt.ts');
const READER_AVATAR_STACK = read('src/chat/shared/ReaderAvatarStack.tsx');
const GROUP_READ_LIST_MODAL = read('src/chat/group/GroupReadListModal.tsx');

describe('收口点 resolveDisplayUrl 存在且语义正确', () => {
  it('secureProxy 导出 resolveDisplayUrl', () => {
    expect(SECURE_PROXY).toMatch(/export function resolveDisplayUrl\(/);
  });

  it('resolveDisplayUrl 对外部 host（≠ 逻辑域名）原样放行，仅后端资源反代', () => {
    // 必须有"host !== proxyHostValue → 原样返回"的外部放行分支（否则会把外部真 CA URL 错转后端）
    expect(SECURE_PROXY).toMatch(/u\.hostname !== proxyHostValue/);
    // 后端资源（相对路径 / 逻辑域名 URL）落到 proxyResourceUrl
    expect(SECURE_PROXY).toMatch(/return proxyResourceUrl\(input\)/);
  });

  it('setProxyTarget 缓存逻辑域名供收口点判定', () => {
    expect(SECURE_PROXY).toMatch(/proxyHostValue = host/);
  });
});

describe('fileCache 两个产出点的显示 src 经反代、原始 presigned 单独保留', () => {
  it('import resolveDisplayUrl', () => {
    expect(FILE_CACHE).toMatch(/import \{ resolveDisplayUrl \} from '\.\/secureProxy'/);
  });

  it('getFileSource / getVideoSource 远程分支 src 经 resolveDisplayUrl（出现 2 次：图片源 + 视频源）', () => {
    const hits = FILE_CACHE.match(/src:\s*resolveDisplayUrl\(url\)\s*\?\?\s*url/g) ?? [];
    expect(hits.length).toBe(2);
  });

  it('远程分支保留原始 presigned URL（供 Rust directIpUrl 下载 + 跨窗 handoff）', () => {
    const hits = FILE_CACHE.match(/presignedUrl:\s*url/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it('不得把裸 url 直接当显示 src 返回（回归守卫：删反代即复现 bug）', () => {
    // `src: resolveDisplayUrl(url) ?? url` 不含 `src: url,`；若回退成裸 `src: url,` → FAIL
    expect(FILE_CACHE).not.toMatch(/src:\s*url\s*,/);
  });
});

describe('MediaPreviewPage 独立预览窗显示 src 经反代', () => {
  it('import resolveDisplayUrl', () => {
    expect(MEDIA_PREVIEW).toMatch(/import \{ resolveDisplayUrl \} from '\.\.\/services\/secureProxy'/);
  });

  it('两条远程显示分支（预传 presigned / 自取 presigned）均经 resolveDisplayUrl', () => {
    expect(MEDIA_PREVIEW).toMatch(/src:\s*resolveDisplayUrl\(state\.presignedUrl\)\s*\?\?\s*state\.presignedUrl/);
    expect(MEDIA_PREVIEW).toMatch(/src:\s*resolveDisplayUrl\(url\)\s*\?\?\s*url/);
  });

  it('不得把裸 state.presignedUrl / url 直接当显示 src（回归守卫）', () => {
    expect(MEDIA_PREVIEW).not.toMatch(/src:\s*state\.presignedUrl\s*,/);
    expect(MEDIA_PREVIEW).not.toMatch(/^\s*src:\s*url\s*,/m);
  });
});

describe('avatar 收口到 resolveDisplayUrl（统一出口）', () => {
  it('resolveServerAvatarUrl 委托 resolveDisplayUrl，不再裸调 proxyResourceUrl', () => {
    expect(AVATAR).toMatch(/return resolveDisplayUrl\(path\)/);
    expect(AVATAR).not.toMatch(/return proxyResourceUrl\(path\)/);
  });
});

describe('群已读者头像：数据边界解析 + 两个显示点消费已解析值', () => {
  // 模式同 useFriends/useGroups：在数据边界(快照构建 GroupReaderInfo 处)把后端裸 avatar_url
  // 经 resolveServerAvatarUrl 解析；下游 ReaderAvatarStack / GroupReadListModal 直接消费已解析的
  // reader.avatarUrl，不再碰后端字段。漏接反代会让群已读者头像被系统信任库验私有 CA 失败而不显示。
  //
  // 已读管线重构后（sync 快照消费 + 本地持久化）：进群独立首拉已删除，全部快照输入
  // （sync 转发 / 本地 db 校准 / WS 去抖补拉）收敛到**唯一** applySnapshot 收口——比原
  // "两处各自解析" 更强（单一 choke point，无第二处可漏）。故断言恰好 1 处 wrapped。

  it('useGroupReadReceipt 唯一头像收口 applySnapshot 把 avatar_url 经 resolveServerAvatarUrl 解析（恰 1 处）', () => {
    expect(USE_GROUP_READ_RECEIPT).toMatch(
      /import \{ resolveServerAvatarUrl \} from '\.\.\/\.\.\/utils\/avatar'/,
    );
    // 恰好 1 处 wrapped（applySnapshot 唯一收口）；删掉即从 1→0，回归守卫见下条负向断言。
    const wrappedHits = USE_GROUP_READ_RECEIPT.match(
      /avatarUrl:\s*resolveServerAvatarUrl\(p\.avatar_url\)/g,
    );
    expect(wrappedHits?.length).toBe(1);
  });

  it('不得把后端裸 avatar_url 直接当展示值（回归守卫：还原成裸 URL 即复现头像不显示 bug → FAIL）', () => {
    // 若 applySnapshot 回退成 `avatarUrl: p.avatar_url,`（裸后端字段）→ 此断言翻 FAIL。
    // 本地 db 持久化存的是原始 avatar_url（snapshot.avatar_url，非展示值），故裸 `avatar_url:`
    // 出现在 snapshotToRows 属正常（落库要原始值，端口跨重启会变）；此处只守 `avatarUrl:`（展示值）。
    expect(USE_GROUP_READ_RECEIPT).not.toMatch(/avatarUrl:\s*p\.avatar_url\s*,/);
  });

  it('ReaderAvatarStack 显示点消费已解析的 reader.avatarUrl，不直接拼后端字段', () => {
    expect(READER_AVATAR_STACK).toMatch(/<img src=\{reader\.avatarUrl\}/);
    expect(READER_AVATAR_STACK).not.toMatch(/avatar_url/); // 不出现任何后端 snake_case 裸字段
  });

  it('GroupReadListModal 显示点消费已解析的 reader.avatarUrl，不直接拼后端字段', () => {
    expect(GROUP_READ_LIST_MODAL).toMatch(/<img src=\{reader\.avatarUrl\}/);
    expect(GROUP_READ_LIST_MODAL).not.toMatch(/avatar_url/);
  });
});

describe('其余 webview 远程图显示点（小程序图标 / OAuth logo / 群头像）不得裸接 URL', () => {
  // [文件, 不允许出现的裸写法正则, 必须出现的收口写法正则]
  const sites: Array<[string, RegExp, RegExp]> = [
    [
      'src/components/miniapps/MiniAppsModal.tsx',
      /<img\s+src=\{app\.icon_url\}/,
      /resolveDisplayUrl\(app\.icon_url\)/,
    ],
    [
      'src/pages/mobile/MobileMiniAppsPage.tsx',
      /<img\s+src=\{app\.icon_url\}/,
      /resolveDisplayUrl\(app\.icon_url\)/,
    ],
    [
      'src/components/oauth/OAuthConsentModal.tsx',
      /<img\s+src=\{consentData\.app_logo_url\}/,
      /resolveDisplayUrl\(consentData\.app_logo_url\)/,
    ],
    [
      'src/components/settings/AuthorizedAppsPanel.tsx',
      /<img\s+src=\{grant\.app_logo_url\}/,
      /resolveDisplayUrl\(grant\.app_logo_url\)/,
    ],
    [
      'src/components/modals/groups/GroupListContent.tsx',
      /<img\s+src=\{group\.group_avatar_url\}/,
      /resolveServerAvatarUrl\(group\.group_avatar_url\)/,
    ],
    [
      // 会议邀请卡发起人头像（消息 JSON 派生字段，盲审发现的遗漏点）
      'src/chat/shared/MeetingInviteCard.tsx',
      /src=\{payload\.creator_avatar\}/,
      /resolveServerAvatarUrl\(payload\.creator_avatar\)/,
    ],
    // ---- profile 全面完善（0.8.0 新契约字段，resolve-at-render 显示点） ----
    [
      // 好友申请卡：申请人头像
      'src/components/modals/add/FriendRequestsTab.tsx',
      /src=\{request\.requester_avatar_url\}/,
      /resolveServerAvatarUrl\(request\.requester_avatar_url\)/,
    ],
    [
      // 加好友预览确认卡：对方头像
      'src/components/modals/add/AddFriendTab.tsx',
      /src=\{preview\?\.user_avatar_url\}/,
      /resolveServerAvatarUrl\(preview\?\.user_avatar_url\)/,
    ],
    [
      // 群邀请卡：邀请人头像
      'src/components/modals/add/GroupInvitesTab.tsx',
      /src=\{invite\.inviter_avatar_url\}/,
      /resolveServerAvatarUrl\(invite\.inviter_avatar_url\)/,
    ],
    [
      // 移动端好友申请卡：申请人头像
      'src/pages/mobile/MobileAddPage.tsx',
      /src=\{request\.requester_avatar_url\}/,
      /resolveServerAvatarUrl\(request\.requester_avatar_url\)/,
    ],
    [
      // 移动端群邀请卡：邀请人头像
      'src/pages/mobile/MobileAddPage.tsx',
      /src=\{invite\.inviter_avatar_url\}/,
      /resolveServerAvatarUrl\(invite\.inviter_avatar_url\)/,
    ],
    [
      // 移动端加好友预览确认卡：对方头像
      'src/pages/mobile/MobileAddPage.tsx',
      /src=\{f\.preview\?\.user_avatar_url\}/,
      /resolveServerAvatarUrl\(f\.preview\?\.user_avatar_url\)/,
    ],
    [
      // 他人资料页：对方头像
      'src/chat/shared/OtherProfilePanel.tsx',
      /src=\{profile\?\.user_avatar_url\}/,
      /resolveServerAvatarUrl\(profile\?\.user_avatar_url\)/,
    ],
    [
      // 他人资料页：资料背景封面（CSS background-image sink，禁止裸插值 ${...background_url}）
      'src/chat/shared/OtherProfilePanel.tsx',
      /\$\{[^}]*\.background_url\}/,
      /resolveServerAvatarUrl\(profile\?\.background_url\)/,
    ],
    [
      // 自己资料弹窗：背景封面
      'src/components/ProfileModal.tsx',
      /\$\{[^}]*\.background_url\}/,
      /resolveServerAvatarUrl\(session\.profile\.background_url\)/,
    ],
    [
      // 移动端自己资料页：背景封面
      'src/pages/mobile/MobileProfilePage.tsx',
      /\$\{[^}]*\.background_url\}/,
      /resolveServerAvatarUrl\(session\?\.profile\.background_url\)/,
    ],
  ];

  it.each(sites)('%s 走收口点而非裸 URL', (file, rawPattern, wrappedPattern) => {
    const src = read(file);
    expect(src).not.toMatch(rawPattern);
    expect(src).toMatch(wrappedPattern);
  });
});
