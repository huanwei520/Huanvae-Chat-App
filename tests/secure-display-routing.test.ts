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
      // 会议邀请卡发起人头像（消息 JSON 派生字段，盲审发现的遗漏点）
      'src/chat/shared/MeetingInviteCard.tsx',
      /src=\{payload\.creator_avatar\}/,
      /resolveServerAvatarUrl\(payload\.creator_avatar\)/,
    ],
    // ---- profile 全面完善（0.8.0 新契约字段，resolve-at-render 显示点） ----
    [
      // 移动端「+」页待通过合并列表（req-24）：申请人/群头像经 resolveServerAvatarUrl(item.avatarPath) 收口
      // （旧的按 ID 加好友预览卡 / 好友申请卡 / 群邀请卡显示点已随 req-24 MobileAddPage 重写删除）
      'src/pages/mobile/MobileAddPage.tsx',
      /<img src=\{item\.avatarPath\}/,
      /resolveServerAvatarUrl\(item\.avatarPath\)/,
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
    // ---- req-23 群详情弹窗 + 待通过申请面板（resolve-at-render 显示点） ----
    [
      // 群详情弹窗：群头像（resolve-at-render into avatarUrl var）
      'src/chat/shared/GroupDetailPanel.tsx',
      /src=\{info\?\.group_avatar_url\}/,
      /resolveServerAvatarUrl\(info\?\.group_avatar_url\)/,
    ],
    [
      // 待通过申请面板：申请人/群头像经 RequestAvatar → resolveServerAvatarUrl
      'src/components/unified/PendingRequestsPanel.tsx',
      /<img src=\{path\}/,
      /resolveServerAvatarUrl\(path\)/,
    ],
  ];

  it.each(sites)('%s 走收口点而非裸 URL', (file, rawPattern, wrappedPattern) => {
    const src = read(file);
    expect(src).not.toMatch(rawPattern);
    expect(src).toMatch(wrappedPattern);
  });
});

describe('发现搜索头像：数据边界经 resolveServerAvatarUrl 解析，显示点消费已解析值', () => {
  // 模式同 useFriends/useGroups：在数据边界（useDiscoverySearch 构建视图模型处）把后端裸
  // avatar_url 经 resolveServerAvatarUrl 解析成可显示 URL；下游 GlobalMessageSearchResults
  // 发现区直接消费已解析的 avatarUrl，不碰后端 snake_case 字段。漏接反代会让发现头像被系统
  // 信任库验私有 CA 失败而不显示。
  const DISCOVERY_HOOK = read('src/hooks/useDiscoverySearch.ts');
  const SEARCH_RESULTS = read('src/components/search/GlobalMessageSearchResults.tsx');

  it('useDiscoverySearch 在数据边界对 people/groups/bots 头像调 resolveServerAvatarUrl（恰 3 处）', () => {
    const hits = DISCOVERY_HOOK.match(/resolveServerAvatarUrl\(card\.avatar_url\)/g) ?? [];
    expect(hits.length).toBe(3);
  });

  it('GlobalMessageSearchResults 发现区显示点消费已解析的 avatarUrl，不碰后端裸 avatar_url', () => {
    // 发现区 <img src={x.avatarUrl}>（已解析）；组件内不出现后端 snake_case avatar_url
    expect(SEARCH_RESULTS).toMatch(/src=\{[a-z]\.avatarUrl\}/);
    expect(SEARCH_RESULTS).not.toMatch(/\bavatar_url\b/);
  });
});

describe('会话内查找的媒体命中项：src 取自 fileCache 收口点，不碰消息行里的裸 file_url', () => {
  // 会话内查找列出图片/视频时要给缩略图 / 九宫格封面，点开还要喂全屏预览。消息行本身带后端
  // 裸地址字段，直接喂 <img/video src> 就会重演「certificate invalid → 真机静默裂图」那类
  // 回归；正确来源是 useFileCache（内部 getFileSource/getVideoSource 已经过 resolveDisplayUrl）。
  //
  // ⚠️ 判定必须在**剥掉注释的代码**上做：源码注释里正当地写着「不得把 file_url 裸喂给 img」
  // 这句话本身含该字段名，直接扫全文会把一条准确的文档判成违规，逼后来的人删注释才能过门禁。
  const SEARCH_MEDIA_RAW = read('src/components/search/ConversationSearchHit.tsx');

  /**
   * 剥掉 `//` 行注释与 `/* *\/` 块注释。
   * 行注释不能用朴素 `//.*$`：模板串里的 `http://` 会被当成注释起点，把后面的代码一起吃掉；
   * 故逐字符判断 `//` 是否落在字符串/模板串之外。
   */
  function stripComments(source: string): string {
    let out = '';
    let inBlock = false;
    let quote: string | null = null;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      if (inBlock) {
        if (ch === '*' && next === '/') { inBlock = false; i++; }
        continue;
      }
      if (quote) {
        out += ch;
        if (ch === '\\') { out += next ?? ''; i++; } else if (ch === quote) { quote = null; }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue; }
      if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
      if (ch === '/' && next === '/') {
        while (i < source.length && source[i] !== '\n') { i++; }
        out += '\n';
        continue;
      }
      out += ch;
    }
    return out;
  }

  const SEARCH_MEDIA = stripComments(SEARCH_MEDIA_RAW);

  it('剥注释器本身有效（正对照：注释里的字段名被剥掉，代码里的保留）', () => {
    expect(stripComments("// 不得用 file_url\nconst a = 'file_url';")).not.toMatch(/不得用/);
    expect(stripComments("// 不得用 file_url\nconst a = 'file_url';")).toMatch(/const a = 'file_url'/);
    // 模板串里的 `//` 不是注释，后面的代码不能被吃掉
    expect(stripComments('const u = `http://x`; const b = 1;')).toMatch(/const b = 1/);
  });

  it('媒体命中项经 useFileCache 取源', () => {
    expect(SEARCH_MEDIA).toMatch(/import \{ useFileCache \} from '\.\.\/\.\.\/hooks\/useFileCache'/);
    // 解构里除 src 外还要 localPath / presignedUrl（递给独立预览窗），故不写死整个解构串
    expect(SEARCH_MEDIA).toMatch(/const \{[^}]*\bsrc\b[^}]*\} = useFileCache\(\{/);
  });

  it('img / video / 全屏预览的 src 都绑到 useFileCache 的 src，代码里不出现后端裸地址字段', () => {
    const bound = SEARCH_MEDIA.match(/src=\{src\}/g) ?? [];
    // <video src={src}>（缩略图/封面）+ <img src={src}> + <MobileMediaPreview src={src}>
    // 回归守卫：任一处改回 message.file_url 即 FAIL（已 node 变异验证：3 → 2 且该字段名出现）
    expect(bound.length).toBe(3);
    expect(SEARCH_MEDIA).not.toMatch(/\bfile_url\b/);
  });

  it('递给独立预览窗的是**原始** presignedUrl 而不是反代 src（跨窗不烘回环端口）', () => {
    expect(SEARCH_MEDIA).toMatch(/presignedUrl: isLocal \? undefined : presignedUrl/);
  });
});
