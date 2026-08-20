/**
 * 登录链路 E2E —— **真实断言**，不是截图。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 这个文件存在的理由（别删，也别把它退化成截图）
 *
 * 在它出现之前，本仓 33 条 e2e 里 **12 条是纯截图**、其余是「数一数有几个 input」
 * 和动画健康度指标 —— 没有任何一条**驱动过被测的功能本身**。实测后果：
 * 把 `Login.tsx` 的 `handleSubmit` 改成"填了账号密码就直接 return"（= 谁都登不进去，
 * App 彻底不可用），`pnpm typecheck` / `pnpm lint:strict` / `pnpm test:run`（3634 条）/
 * `pnpm test:e2e`（33 条）**四层全绿、退出码全 0**。
 *
 * 本文件的每一条都必须满足：**把登录改坏，它就必须红**。
 * 加新用例前先自问一句 —— 如果 handleSubmit 什么都不做，这条会不会失败？
 * 答案是"不会"，那它就不该加进来。
 *
 * **`@gate` 标记**：describe 标题里的 `@gate` 是 release.yml 质量门的选择器
 * （`npx playwright test --project=chromium --grep "@gate"`）。
 * 打了这个标记 = 这条会挡住发布。所以只给"真的驱动了被测功能、且能被真 bug 打红"的
 * 用例打；截图类一律不打（它们的红来自基线过期，不是代码回归）。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from './helpers/test-fixtures';
import { MOCK_BACKEND_IP } from './helpers/tauri-mock';

/** 从页面取假后端记录到的 secure_http 请求流水 */
async function httpLog(page: import('@playwright/test').Page) {
  return page.evaluate(
    () =>
      (window as unknown as {
        __E2E_HTTP__: { method: string; url: string; body: string | null }[];
      }).__E2E_HTTP__,
  );
}

async function gotoLoginPage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // 登录表单真的在（后面每条都建立在这上面）
  await expect(page.locator('#user-id')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();
}

test.describe('登录链路（真实断言） @gate', () => {
  test('桩注入本身没坏：__TAURI_INTERNALS__ 已建立', async ({ page }) => {
    // 这条看着琐碎，但它守的是一个真实踩过的坑：注入脚本一旦有语法错，
    // 整段 addInitScript 静默不执行 ⇒ 所有 Tauri 调用变成
    // "Cannot read properties of undefined (reading 'invoke')"，
    // 而截图类用例照样能过（登录页本身还是渲染得出来的）。
    await page.goto('/');
    const shape = await page.evaluate(() => ({
      internals: typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__,
      os: typeof (window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__,
      httpLog: Array.isArray(
        (window as unknown as { __E2E_HTTP__?: unknown }).__E2E_HTTP__,
      ),
    }));
    expect(shape).toEqual({ internals: 'object', os: 'object', httpLog: true });
  });

  test('点「登陆」会真的把凭据发到后端 /api/auth/login', async ({ page }) => {
    await gotoLoginPage(page);

    await page.locator('#user-id').fill('e2euser');
    await page.locator('#password').fill('e2epass');
    await page.getByRole('button', { name: '登陆' }).click();

    // 断言的是「请求真的离开了 App」，不是「屏幕上出现了什么」——
    // 后者可能被任意一层兜底文案糊过去，前者不能。
    await expect
      .poll(async () => (await httpLog(page)).some((r) => r.url.endsWith('/api/auth/login')), {
        timeout: 20_000,
      })
      .toBe(true);

    const log = await httpLog(page);

    // 整条链路都被走到了，不是只有最后一跳：
    //   ① 发现面拉配置 → ② 探活选 IP → ③ 打登录
    expect(log.some((r) => r.url === 'https://ca.huanvae.cn/endpoints')).toBe(true);
    expect(log.some((r) => r.url.endsWith('/health'))).toBe(true);

    const loginReq = log.find((r) => r.url.endsWith('/api/auth/login'));
    expect(loginReq?.method).toBe('POST');
    // 打到的是**发现服务选出来的那个 IP**：数据面请求在 secureFetch.secureHttp 里
    // 被 rewriteUrlHost(url, direct_ip, direct_port) 改写过主机（IP 字面量 = 不发 SNI）。
    // 断言 IP 而不是逻辑域名，正是为了把「发现 → 择优 → 改写」这一段一起钉住。
    expect(loginReq?.url).toContain(MOCK_BACKEND_IP);
    // 请求体里带着用户**真的输进去**的账号（而不是空串/写死值）
    const payload = JSON.parse(loginReq?.body ?? '{}') as {
      user_id?: string;
      password?: string;
    };
    expect(payload.user_id).toBe('e2euser');
    expect(payload.password).toBe('e2epass');
  });

  test('登录成功后离开登录页并进入主界面', async ({ page }) => {
    await gotoLoginPage(page);

    await page.locator('#user-id').fill('e2euser');
    await page.locator('#password').fill('e2epass');
    await page.getByRole('button', { name: '登陆' }).click();

    // 登录表单消失 = 真的换页了（不是"错误提示下的原地不动"）
    await expect(page.locator('#user-id')).toHaveCount(0, { timeout: 30_000 });
    // 主界面渲染出后端下发的昵称 —— 证明 profile 那一跳也真的走通了
    await expect(page.getByText('E2E 用户')).toBeVisible({ timeout: 30_000 });
  });

});

test.describe('登录链路（凭据错误场景） @gate', () => {
  test.use({ tauriScenario: 'bad-credentials' });

  // 这条守的是「登录失败必须让用户看得见原因」：后端回 401 + {error:"账号或密码错误"}，
  // UI 必须把这句**原文**显示出来，并且停留在登录页（不能被吞掉后跳进半初始化的主界面）。
  test('服务端拒绝凭据时，错误原文显示给用户且停留在登录页', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('#user-id').fill('e2euser');
    await page.locator('#password').fill('whatever');
    await page.getByRole('button', { name: '登陆' }).click();

    await expect(page.getByText('账号或密码错误')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#user-id')).toBeVisible();
  });
});
