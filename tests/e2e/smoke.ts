// 浏览器端到端冒烟测试：npm run build && npm run test:e2e
// 把 dist/ 放在 /my-RPGworld/ 子路径下提供（模拟 GitHub Pages），用真实 Chromium 操作游戏。
// 需要本机有 Chromium/Chrome：可用 CHROME_PATH 环境变量指定路径。
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4791;
const BASE = `http://127.0.0.1:${PORT}/my-RPGworld/`;
const results: { name: string; ok: boolean; error?: string }[] = [];

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean) as string[];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('找不到 Chromium/Chrome，请设置 CHROME_PATH');
  return found;
}

async function startServer() {
  if (!existsSync('dist/index.html')) throw new Error('请先运行 npm run build');
  const root = mkdtempSync(join(tmpdir(), 'rpgworld-e2e-'));
  mkdirSync(join(root, 'my-RPGworld'));
  cpSync('dist', join(root, 'my-RPGworld'), { recursive: true });
  const proc = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(BASE);
      return proc;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  proc.kill();
  throw new Error('静态服务器启动失败');
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err) });
    console.log(`  ✗ ${name}\n      ${String(err).split('\n')[0]}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type State = { scene?: string; x: number; y: number; facing: string; moving: boolean; locked: boolean };
const state = (page: Page) => page.evaluate(() => (window as any).__rpgDebug.scene.debugState() as State);

async function waitState(page: Page, pred: (s: State) => boolean, what: string, timeout = 8000) {
  const end = Date.now() + timeout;
  let s = await state(page);
  while (Date.now() < end) {
    s = await state(page);
    if (pred(s)) return s;
    await page.waitForTimeout(80);
  }
  throw new Error(`等待超时：${what}（当前 ${JSON.stringify(s)}）`);
}

async function openGame(page: Page, url = BASE) {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__rpgDebug && document.getElementById('loading')?.hidden, null, { timeout: 15000 });
}

async function teleport(page: Page, x: number, y: number) {
  const ok = await page.evaluate(([tx, ty]) => (window as any).__rpgDebug.scene.debugTeleport(tx, ty), [x, y]);
  if (!ok) throw new Error(`无法瞬移到 (${x},${y})`);
}

async function clickTile(page: Page, x: number, y: number, touch = false) {
  const p = await page.evaluate(([tx, ty]) => (window as any).__rpgDebug.scene.debugTileToClient(tx, ty), [x, y]);
  const vp = page.viewportSize()!;
  if (p.x < 0 || p.y < 0 || p.x >= vp.width || p.y >= vp.height) throw new Error(`格子 (${x},${y}) 不在屏幕内：${JSON.stringify(p)}`);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} ${m.location().url}`));
  return errors;
}

async function desktop(browser: Browser) {
  console.log('\n电脑端（1280×720）');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = trackErrors(page);

  await test('首页加载，进入小镇起点', async () => {
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'town' && s.x === 14 && s.y === 12, `位置不对 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-town.png' });
  });

  await test('键盘移动（按住左方向键）', async () => {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
    const s = await waitState(page, (s) => !s.moving, '停止移动');
    assert(s.x < 14 && s.y === 12 && s.facing === 'left', `没有向左走 ${JSON.stringify(s)}`);
  });

  await test('碰撞：不能走进树里', async () => {
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(2500);
    await page.keyboard.up('ArrowLeft');
    const s = await waitState(page, (s) => !s.moving, '停止移动');
    assert(s.x >= 1, `穿墙了 ${JSON.stringify(s)}`);
  });

  await test('点击地面自动寻路', async () => {
    await clickTile(page, 10, 14);
    const s = await waitState(page, (s) => s.x === 10 && s.y === 14 && !s.moving, '走到 (10,14)');
    assert(s.scene === 'town', '场景不对');
  });

  await test('点击不可到达的地方有反馈', async () => {
    await teleport(page, 20, 10);
    await clickTile(page, 23, 10); // 池塘中间（四周都是水）
    await page.waitForSelector('.toast.show', { timeout: 2000 });
  });

  await test('点击村民：自动靠近并开始对话', async () => {
    await clickTile(page, 15, 13);
    await waitState(page, (s) => s.x === 15 && s.y === 13 && !s.moving, '走到村民附近');
    await clickTile(page, 20, 13);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    const s = await state(page);
    assert(Math.abs(s.x - 20) + Math.abs(s.y - 13) === 1, `没有站到村民旁边 ${JSON.stringify(s)}`);
    assert((await page.textContent('.dialogue .speaker')) === '村民小禾', '说话人不对');
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-dialogue.png' });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.dialogue', { state: 'hidden', timeout: 2000 });
  });

  await test('对话期间不能移动', async () => {
    await clickTile(page, 20, 13);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    const before = await state(page);
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowDown');
    const after = await state(page);
    assert(before.x === after.x && before.y === after.y, '对话时角色移动了');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.dialogue', { state: 'hidden', timeout: 2000 });
  });

  await test('点击图书馆门：进入室内场景', async () => {
    await teleport(page, 12, 9);
    await clickTile(page, 14, 5);
    const s = await waitState(page, (s) => s.scene === 'library' && !s.locked, '进入图书馆', 12000);
    assert(s.x === 6 && s.y === 7 && s.facing === 'up', `到达位置不对 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-library.png' });
  });

  await test('图书管理员 → 对话选项 → 研究笔记列表 → 文章弹窗', async () => {
    await clickTile(page, 7, 3);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter'); // 第一句
    await page.waitForSelector('.dialogue .choice', { timeout: 2000 });
    await page.click('.dialogue .choice >> text=查看研究笔记');
    await page.waitForSelector('.modal .item-button', { timeout: 5000 });
    const titles = await page.$$eval('.modal .item-button', (els) => els.map((e) => e.textContent));
    assert(titles.length === 2, `书架应有 2 篇已发布文章，实际 ${JSON.stringify(titles)}`);
    assert(!titles.some((t) => t?.includes('草稿')), '草稿出现在书架上');
    await page.click('.modal .item-button >> text=关于 AI Agent 的几点笔记');
    await page.waitForSelector('.modal .prose h2', { timeout: 5000 });
    const href = await page.getAttribute('.modal-link', 'href');
    assert(href === `${BASE}articles/ai-agent-notes/`, `独立页面链接不对：${href}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-article.png' });
  });

  await test('阅读时方向键滚动文章而不是移动角色', async () => {
    const before = await state(page);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    const after = await state(page);
    assert(before.x === after.x && before.y === after.y, '阅读时角色移动了');
  });

  await test('返回列表，Esc 关闭窗口后恢复探索、位置不变', async () => {
    await page.click('.modal-back');
    await page.waitForSelector('.modal .item-button', { timeout: 3000 });
    const before = await state(page);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal-backdrop', { state: 'hidden', timeout: 2000 });
    const s = await waitState(page, (s) => !s.locked, '解除锁定');
    assert(s.x === before.x && s.y === before.y, '位置变了');
  });

  await test('E 键与面前的书架互动', async () => {
    await clickTile(page, 2, 2);
    await waitState(page, (s) => s.x === 2 && s.y === 2 && !s.moving, '走到书架前');
    await page.keyboard.press('ArrowUp'); // 面向书架（被挡住，只转身）
    await page.waitForTimeout(250);
    await page.keyboard.press('e');
    await page.waitForSelector('.modal .item-button', { timeout: 5000 });
    assert((await page.textContent('#modal-title')) === 'AI 研究书架', '标题不对');
    await page.click('.modal-close');
    await waitState(page, (s) => !s.locked, '解除锁定');
  });

  await test('点击出口回到小镇门口', async () => {
    await clickTile(page, 7, 8);
    const s = await waitState(page, (s) => s.scene === 'town' && !s.locked, '回到小镇', 12000);
    assert(s.x === 14 && s.y === 6 && s.facing === 'down', `到达位置不对 ${JSON.stringify(s)}`);
  });

  await test('刷新后从存档位置继续', async () => {
    await page.keyboard.press('ArrowRight');
    const before = await waitState(page, (s) => !s.moving, '停止移动');
    await openGame(page);
    const s = await state(page);
    assert(s.scene === before.scene && s.x === before.x && s.y === before.y, `没有恢复 ${JSON.stringify(s)} vs ${JSON.stringify(before)}`);
  });

  await test('存档位置变成墙时回到出生点', async () => {
    await page.evaluate(() => localStorage.setItem('rpgworld:save', JSON.stringify({ version: 1, scene: 'town', x: 0, y: 0, facing: 'up' })));
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'town' && s.x === 14 && s.y === 12, `${JSON.stringify(s)}`);
  });

  await test('损坏的存档 / 不存在的场景：回到起点', async () => {
    await page.evaluate(() => localStorage.setItem('rpgworld:save', '{{{坏掉的'));
    await openGame(page);
    assert((await state(page)).scene === 'town', '损坏存档后没回到小镇');
    await page.evaluate(() => localStorage.setItem('rpgworld:save', JSON.stringify({ version: 1, scene: 'deleted', x: 3, y: 3, facing: 'up' })));
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'town' && s.x === 14 && s.y === 12, `${JSON.stringify(s)}`);
  });

  await test('导航栏「回到起点」与「清除存档」', async () => {
    await teleport(page, 14, 8);
    await clickTile(page, 14, 5);
    await waitState(page, (s) => s.scene === 'library' && !s.locked, '进入图书馆', 12000);
    await page.click('#btn-home');
    let s = await waitState(page, (s) => s.scene === 'town' && !s.locked, '回到起点');
    assert(s.x === 14 && s.y === 12, '起点位置不对');
    await page.click('#btn-reset');
    s = await waitState(page, (s) => s.scene === 'town' && !s.locked, '清除存档');
    await page.keyboard.press('ArrowDown');
    s = await waitState(page, (s) => !s.moving && s.y === 13, '清除存档后键盘仍可用');
  });

  await test('?open= 直接在游戏中打开内容', async () => {
    await openGame(page, `${BASE}?open=about`);
    await page.waitForSelector('.modal .prose', { timeout: 5000 });
    assert((await page.textContent('#modal-title')) === '关于站长', '标题不对');
    assert(!page.url().includes('open='), '参数没有清理');
  });

  await test('没有 JS 错误', async () => {
    assert(errors.length === 0, errors.join('\n'));
  });
  await ctx.close();
}

async function staticPages(browser: Browser) {
  console.log('\n独立页面（GitHub Pages 子路径 /my-RPGworld/）');
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();
  const errors = trackErrors(page);

  await test('文章页可直接访问，标题与样式正确', async () => {
    const res = await page.goto(`${BASE}articles/ai-agent-notes/`);
    assert(res?.status() === 200, `状态码 ${res?.status()}`);
    assert((await page.textContent('h1')) === '关于 AI Agent 的几点笔记', 'h1 不对');
    assert((await page.title()).startsWith('关于 AI Agent'), 'title 不对');
    const bg = await page.$eval('.reader', (e) => getComputedStyle(e).backgroundColor);
    assert(bg !== 'rgba(0, 0, 0, 0)', 'site.css 没有加载');
    await page.screenshot({ path: 'tests/e2e/screenshots/static-article.png', fullPage: true });
  });

  await test('不带结尾斜杠也能访问（刷新不 404）', async () => {
    const res = await page.goto(`${BASE}articles/ai-agent-notes`);
    assert(res?.status() === 200, `状态码 ${res?.status()}`);
    assert((await page.textContent('h1')) === '关于 AI Agent 的几点笔记', 'h1 不对');
  });

  await test('文章内站内链接指向内容库', async () => {
    await page.goto(`${BASE}articles/ai-agent-notes/`);
    await page.click('.prose a >> text=内容库');
    await page.waitForURL(`${BASE}library/`);
    const links = await page.$$eval('.item-list a', (els) => els.map((e) => (e as HTMLAnchorElement).href));
    assert(links.length === 3, `内容库应有 3 项，实际 ${links.length}`);
  });

  await test('浏览器前进后退', async () => {
    await page.goBack();
    await page.waitForURL(`${BASE}articles/ai-agent-notes/`);
    await page.goForward();
    await page.waitForURL(`${BASE}library/`);
  });

  await test('草稿没有独立页面', async () => {
    const before = errors.length;
    const res = await page.goto(`${BASE}articles/ai-draft-idea/`);
    assert(res?.status() === 404, `状态码 ${res?.status()}`);
    // 本地 python 服务器返回的是自带的 404 页面（没有图标），浏览器会再请求 /favicon.ico；这些 404 都是预期的
    await page.waitForTimeout(500);
    errors.splice(before);
  });

  await test('「在游戏世界中打开」链接可用', async () => {
    await page.goto(`${BASE}articles/ai-reading-list/`);
    await page.click('text=在游戏世界中打开');
    await page.waitForSelector('.modal .prose', { timeout: 15000 });
    assert((await page.textContent('#modal-title')) === 'AI 阅读清单（示例）', '标题不对');
  });

  await test('没有 JS 错误', async () => assert(errors.length === 0, errors.join('\n')));
  await ctx.close();
}

async function mobile(browser: Browser) {
  console.log('\n手机端（390×844 竖屏，触屏）');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const errors = trackErrors(page);

  await test('竖屏加载，显示触屏提示', async () => {
    await openGame(page);
    const hint = await page.textContent('.hint');
    assert(hint?.includes('点'), `提示不是触屏版：${hint}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-town.png' });
  });

  await test('点按地面移动', async () => {
    await clickTile(page, 14, 16, true);
    await waitState(page, (s) => s.x === 14 && s.y === 16 && !s.moving, '走到 (14,16)');
  });

  await test('点按告示牌：自动靠近 → 对话 → 打开自我介绍', async () => {
    await teleport(page, 7, 11);
    await clickTile(page, 5, 8, true);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(200);
    await page.tap('.dialogue');
    await page.waitForSelector('.dialogue .choice', { timeout: 2000 });
    await page.tap('.dialogue .choice >> text=读自我介绍');
    await page.waitForSelector('.modal .prose', { timeout: 5000 });
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-article.png' });
    const box = await page.$eval('.modal', (e) => e.getBoundingClientRect().width);
    assert(box >= 380, `窗口没有铺满手机屏幕：${box}`);
    await page.tap('.modal-close');
    await waitState(page, (s) => !s.locked, '关闭窗口');
  });

  await test('点按门进入图书馆', async () => {
    await teleport(page, 15, 9);
    await clickTile(page, 14, 5, true);
    await waitState(page, (s) => s.scene === 'library' && !s.locked, '进入图书馆', 15000);
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-library.png' });
  });

  await test('没有 JS 错误', async () => assert(errors.length === 0, errors.join('\n')));
  await ctx.close();
}

async function noStorage(browser: Browser) {
  console.log('\nlocalStorage 被禁用');
  const ctx: BrowserContext = await browser.newContext();
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  });
  const page = await ctx.newPage();
  const errors = trackErrors(page);
  await test('游戏仍能加载与移动', async () => {
    await openGame(page);
    await clickTile(page, 14, 14);
    await waitState(page, (s) => s.y === 14 && !s.moving, '移动');
    assert(errors.length === 0, errors.join('\n'));
  });
  await ctx.close();
}

async function main() {
  mkdirSync('tests/e2e/screenshots', { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    await desktop(browser);
    await staticPages(browser);
    await mobile(browser);
    await noStorage(browser);
  } finally {
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
