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
  ];

  it.each(sites)('%s 走收口点而非裸 URL', (file, rawPattern, wrappedPattern) => {
    const src = read(file);
    expect(src).not.toMatch(rawPattern);
    expect(src).toMatch(wrappedPattern);
  });
});

describe('个人资料背景封面 CSS background 经反代（背景图相对路径必经 resolveDisplayUrl）', () => {
  // backgroundCoverStyle 只做 `url(${imageUrl})` 包装，故调用方必须传**已收口**的显示 URL；
  // 漏接 → 把裸后端相对路径喂 CSS backgroundImage → webview 验不过私有 CA → 破图。
  // [文件, 不允许的裸写法（删反代即复现）, 必须出现的收口写法]
  const coverSites: Array<[string, RegExp, RegExp]> = [
    [
      // 自己的 3 个载体（桌面弹窗 / 移动页 / 本人只读面板）共用此 coverStyle
      'src/hooks/useProfileEditor.ts',
      /backgroundCoverStyle\(bgKind, bgBackgroundUrl\b/,
      /backgroundCoverStyle\(bgKind, resolveDisplayUrl\(bgBackgroundUrl\), bgColor\)/,
    ],
    [
      // 他人资料页：公开资料的背景图相对路径
      'src/chat/shared/OtherProfilePanel.tsx',
      /backgroundCoverStyle\(\s*bgKind,\s*bgUrl\b/,
      /resolveDisplayUrl\(bgUrl\)/,
    ],
  ];

  it.each(coverSites)('%s 背景封面走收口点而非裸相对路径', (file, rawPattern, wrappedPattern) => {
    const src = read(file);
    expect(src).not.toMatch(rawPattern);
    expect(src).toMatch(wrappedPattern);
  });
});
