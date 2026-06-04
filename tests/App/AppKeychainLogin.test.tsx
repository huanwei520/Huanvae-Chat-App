/**
 * App.tsx 已保存账号登录的钥匙串访问契约测试（macOS 多次密码框修复）
 *
 * 背景：macOS 上 getPassword = 系统钥匙串读、saveAccount(set_password) = 钥匙串写，
 * 每次访问都可能弹系统密码框。修复前一次"已保存账号登录"会弹多达 5 次：
 *   - bio 重试循环(MAX_BIO_RETRIES=5)未 isMobile 门控、桌面照跑 → 读失败反复弹框
 *   - 登录后 + 头像后各 saveAccount 重写密码 → 多余的写弹框
 *
 * 验证（结构性，源码静态扫描）：
 *   1. bio 重试循环仅移动端运行（isMobile 门控在前）
 *   2. 桌面存在"读一次失败即转手动登录"的分支（不重试）
 *   3. 登录路径不再"头像后 saveAccount 重写密码"
 *
 * 测试形式：源码静态扫描。原因：handleLoginWithAccount 嵌在 App.tsx 顶层巨型依赖图中，
 * 且登录走 plugin-http 通道 e2e 不可达；结构性测试足以防止回归到多次弹框。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 与同目录 AppUpdateToast.test.tsx 一致用 __dirname（vitest 下 import.meta.url 非标准
// file:// scheme，fileURLToPath 会抛错）。
const APP_SOURCE = readFileSync(resolve(__dirname, '../../src/App.tsx'), 'utf-8');

describe('App.tsx 已保存账号登录钥匙串访问契约（macOS）', () => {
  it('bio 重试循环仅移动端运行（isMobile() 门控在 MAX_BIO_RETRIES 之前；桌面不跑 ×5 重试）', () => {
    // 若门控被移除，MAX_BIO_RETRIES 之前不再有 isMobile() 调用（其余 isMobile() 均在其后）→ 失败
    expect(APP_SOURCE).toMatch(/isMobile\(\)[\s\S]*?MAX_BIO_RETRIES/);
  });

  it('桌面存在"读密码失败即转手动登录"的不重试分支', () => {
    // 修复 A 引入的桌面分支专属错误文案（结构标记）
    expect(APP_SOURCE).toMatch(/读取保存的密码失败/);
  });

  it('登录路径不再在头像更新后 saveAccount 重写钥匙串密码', () => {
    // 修复 B：删除 updateAvatar(...).then(... saveAccount(...)) 的冗余钥匙串写。
    // 宽松匹配 updateAvatar(...) 之后任意回调形式里的 saveAccount（不限 `path =>` 一种箭头写法），
    // 防止回归者改写成 `(p) =>` / `() =>` / function 绕过断言。
    expect(APP_SOURCE).not.toMatch(/updateAvatar\([^)]*\)\s*\.then\([\s\S]*?saveAccount/);
  });
});
