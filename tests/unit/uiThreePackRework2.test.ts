/**
 * #7/#6 本轮整改的三条静态契约（均为真机/源码实锤的缺口，防再犯）
 *
 * 1. spotlight（聚焦）形态必须有控制入口
 *    病历：ParticipantVideo 的胶囊渲染条件要求 `onControlPill` / `onClickControl`，
 *    而聚焦主画面与缩略图条都没传 ⇒ 聚焦态下 #7 入口完全不可达。
 *    修：桌面聚焦主画面补 onClickControl（桌面靠 :hover 驱动，零新手势）；
 *        移动聚焦主画面补 onControlPill + controlOpen（复用既有的单击 toggle
 *        控制栏语义：单击伸出 / 再单击收回，与网格态同语义）。
 *
 * 2. 控制申请弹窗里的申请人名不得是硬编码「我」
 *    病历：mainBridge 发 M1 时 from.display_name 写死 '我'，而服务端只重写
 *    user_id/device_id、不重写 display_name ⇒ 被申请方看到「我 申请控制你正在共享的屏幕」
 *    「正在被 我 控制」。修：取会话昵称（session.profile.user_nickname）作真值源。
 *
 * 3. Bot 卡 D2 的 46px 类型章
 *    D2 原案的章是「类型章」，不需要 schema 新字段：左栏=固定 bot 类型图标，
 *    右栏=卡内首个顶层 heading（升格为标题并从正文摘出，避免重复渲染）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const DESKTOP_MEETING = read('src/meeting/MeetingPage.tsx');
const MOBILE_MEETING = read('src/pages/mobile/MobileMeetingPage.tsx');
const MAIN_BRIDGE = read('src/remote-control/mainBridge.tsx');
const CARD_RENDERER = read('src/chat/shared/CardRenderer.tsx');
const CARD_CSS = read('src/chat/shared/CardRenderer.css');

describe('#7 spotlight 形态的控制入口', () => {
  it('桌面聚焦主画面传 onClickControl（否则胶囊不渲染）', () => {
    const at = DESKTOP_MEETING.indexOf('spotlight-${focused.id}');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = DESKTOP_MEETING.slice(at, at + 700);
    expect(block).toContain('onClickControl={() => requestControlFor({');
  });

  it('移动聚焦主画面传 onControlPill + controlOpen（伸出态接既有单击 toggle）', () => {
    // 聚焦分支里那个 participant 来自 participants.find(p => p.id === focusedId)
    const at = MOBILE_MEETING.indexOf('const focused = webrtc.participants.find((p) => p.id === focusedId)');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = MOBILE_MEETING.slice(at, at + 900);
    expect(block).toContain('controlOpen={controlsVisible}');
    expect(block).toContain('onControlPill={() => requestControlFor({');
  });

  it('两处入口都发到同一条 RC_REQUEST_CONTROL 落点（requestControlFor）', () => {
    const desktopCalls = DESKTOP_MEETING.match(/requestControlFor\(\{/g) ?? [];
    const mobileCalls = MOBILE_MEETING.match(/requestControlFor\(\{/g) ?? [];
    // 定义体本身不算调用
    expect((DESKTOP_MEETING.match(/const requestControlFor = useCallback/g) ?? []).length).toBe(1);
    expect((MOBILE_MEETING.match(/const requestControlFor = useCallback/g) ?? []).length).toBe(1);
    expect(desktopCalls.length).toBeGreaterThanOrEqual(3); // 网格 tile + 聚焦主画面 + 聚焦缩略图条
    expect(mobileCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('桌面聚焦态的右侧缩略图条也带控制入口（与「点击切换聚焦」零冲突）', () => {
    const at = DESKTOP_MEETING.indexOf('spotlight-thumbnails');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = DESKTOP_MEETING.slice(at, at + 1200);
    // 缩略图条里的远端参会人同时带 onClickControl（胶囊）与 onClick（切聚焦）
    expect(block).toContain('onClickControl={() => requestControlFor({');
    expect(block).toContain("onClick={() => setFocusedId(p.id)}");
    // 胶囊按钮自身 stopPropagation ⇒ 点胶囊不会冒泡成切聚焦
    const pill = DESKTOP_MEETING.indexOf('className="tile-control-pill"');
    expect(DESKTOP_MEETING.slice(pill, pill + 200)).toContain('e.stopPropagation()');
  });
});

describe('#7 授权弹窗的申请人展示名', () => {
  it('mainBridge 不再硬编码 display_name: 我', () => {
    expect(MAIN_BRIDGE).not.toMatch(/display_name:\s*'我'/);
    expect(MAIN_BRIDGE).toContain('display_name: selfNameRef.current');
  });

  it('真值源＝会话昵称，且用 ref 传值避免重新注册 listener', () => {
    expect(MAIN_BRIDGE).toMatch(/session\?\.profile\?\.user_nickname\?\.trim\(\) \|\| '我'/);
    expect(MAIN_BRIDGE).toContain('useRef(selfDisplayName)');
    // onRequestControl 的依赖数组必须保持空 —— 否则监听器会在昵称到货时重注册，
    // 在注销→重注之间丢事件（本文件历史上的双发教训见 cancelled 守卫注释）
    const at = MAIN_BRIDGE.indexOf('const onRequestControl = useCallback');
    const block = MAIN_BRIDGE.slice(at, MAIN_BRIDGE.indexOf('useEffect', at));
    expect(block.trimEnd().endsWith('}, []);')).toBe(true);
  });
});

describe('#6 Bot 卡 D2 的 46px 类型章', () => {
  it('渲染 46px 章（左栏）+ 升格的首个顶层 heading（右栏）', () => {
    expect(CARD_RENDERER).toContain('card-medallion-row');
    expect(CARD_RENDERER).toContain('card-medallion');
    expect(CARD_RENDERER).toMatch(/card-medallion-title/);
    expect(CARD_RENDERER).toMatch(/headNode\.type === 'heading'/);
    // 升格后正文必须从第二个节点起，否则标题会渲染两次
    expect(CARD_RENDERER).toMatch(/parsed\.nodes\.slice\(1\)/);
  });

  it('CSS：46px / 12px 圆角 / accent→primary 渐变（与另外两卡同一语言）', () => {
    const at = CARD_CSS.indexOf('.card-medallion {');
    expect(at).toBeGreaterThanOrEqual(0);
    const block = CARD_CSS.slice(at, CARD_CSS.indexOf('}', at));
    expect(block).toMatch(/width:\s*46px/);
    expect(block).toMatch(/height:\s*46px/);
    expect(block).toMatch(/border-radius:\s*12px/);
    expect(block).toContain('linear-gradient(135deg');
  });

  it('卡外不得出现 schema 之外的新数据依赖（只用卡自身 heading + 固定类型图标）', () => {
    const at = CARD_RENDERER.indexOf('card-medallion-row');
    const block = CARD_RENDERER.slice(at - 200, at + 900);
    // 章内只有固定 svg 图标与 heading 文本，不读任何新字段
    expect(block).not.toMatch(/avatar|icon_url|bot_avatar/);
  });
});
