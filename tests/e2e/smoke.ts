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
const SAVE_KEY = 'rpgworld:save';
const results: { name: string; ok: boolean; error?: string }[] = [];

function findChrome(): string {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
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

async function waitState(page: Page, pred: (s: State) => boolean, what: string, timeout = 12000) {
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
  await page.waitForFunction(
    () => {
      const loading = document.getElementById('loading');
      if (loading?.classList.contains('failed')) {
        throw new Error(`游戏加载失败：${(loading.textContent ?? '').replace(/\s+/g, ' ').slice(0, 120)}`);
      }
      return Boolean((window as any).__rpgDebug?.scene?.debugState().scene) && Boolean(loading?.hidden);
    },
    null,
    { timeout: 20000 },
  );
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

/** 用场景切换接口进入某个场景（等价于玩家走到门口） */
async function enterScene(page: Page, id: string, spawn: string) {
  await page.evaluate(([s, sp]) => (window as any).__rpgDebug.scene.changeScene(s, sp), [id, spawn]);
  return waitState(page, (s) => s.scene === id && !s.locked, `进入场景 ${id}`, 15000);
}

/** 读取渲染层级：用于验证树冠遮挡（玩家 depth 小于树 → 被树挡住） */
const depths = (page: Page) =>
  page.evaluate(() => {
    const sc = (window as any).__rpgDebug.scene;
    const tree = sc.npcSprites?.get('big-tree');
    return { player: sc.player.depth as number, tree: tree ? (tree.depth as number) : null, marker: sc.marker.depth as number };
  });

const dialogueSpeaker = (page: Page) => page.textContent('.dialogue .speaker');
const dialogueText = async (page: Page) => (await page.textContent('.dialogue')) ?? '';

async function closeDialogue(page: Page) {
  for (let i = 0; i < 8; i++) {
    if (await page.isHidden('.dialogue')) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // 浏览器找不到 favicon 之类不算游戏错误；这里只统计真正的脚本错误
  page.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} ${m.location().url}`));
  return errors;
}

async function desktop(browser: Browser) {
  console.log('\n电脑端（1280×720）· 森林样板');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = trackErrors(page);

  // ---------- 森林：出生、移动、碰撞、寻路 ----------

  await test('首页加载，进入森林出生点', async () => {
    // 新的 browser context 本身就是干净的 localStorage，不需要额外清理
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'forest' && s.x === 12 && s.y === 10 && s.facing === 'up', `出生点不对 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-forest.png' });
  });

  await test('键盘移动（按住左方向键）', async () => {
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
    const s = await waitState(page, (s) => !s.moving, '停止移动');
    assert(s.x < 12 && s.y === 10 && s.facing === 'left', `没有向左走 ${JSON.stringify(s)}`);
  });

  await test('碰撞：向下撞到林墙，正好停在最后可走格', async () => {
    await teleport(page, 12, 10);
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(260);
    }
    const s = await waitState(page, (s) => !s.moving, '停止移动');
    // forest 地图第 12 行是密林（不可走），所以最多到第 11 行
    assert(s.x === 12 && s.y === 11, `穿墙或提前停住 ${JSON.stringify(s)}`);
  });

  await test('点击地面自动寻路', async () => {
    await teleport(page, 12, 11);
    await clickTile(page, 12, 6);
    const s = await waitState(page, (s) => s.x === 12 && s.y === 6 && !s.moving, '走到 (12,6)');
    assert(s.scene === 'forest', '场景不对');
  });

  await test('点击走不到的地方有反馈（不再静默失败）', async () => {
    // 站在屋顶下方点屋顶：旁边就是自己，无路可走，应弹出提示
    await page.evaluate(() => document.querySelector('.toast')?.classList.remove('show'));
    await clickTile(page, 12, 2);
    await page.waitForSelector('.toast.show', { timeout: 3000 });
    const text = (await page.textContent('.toast')) ?? '';
    assert(text.includes('走不过去'), `提示文案不对：${text}`);
    const s = await state(page);
    assert(s.x === 12 && s.y === 6, `角色不该移动 ${JSON.stringify(s)}`);
  });

  // ---------- 森林：NPC 对话 ----------

  await test('与护林人对话（多选分支）', async () => {
    await teleport(page, 8, 8);
    await page.keyboard.press('ArrowDown'); // 面向护林人（被挡住，只转身）
    await page.waitForTimeout(200);
    await page.keyboard.press('e');
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    assert((await dialogueSpeaker(page)) === '护林人', '说话人不对');
    assert((await dialogueText(page)).includes('这片林子'), '第一句不对');
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-dialogue.png' });
    await page.keyboard.press('Enter'); // 第二句
    await page.waitForSelector('.dialogue .choice', { timeout: 3000 });
    await page.click('.dialogue .choice >> text=为什么要测试遮挡？');
    await page.waitForTimeout(300);
    assert((await dialogueText(page)).includes('树屋'), '分支内容不对');
    await closeDialogue(page);
    await waitState(page, (s) => !s.locked, '解除对话锁定');
  });

  await test('对话期间不能移动', async () => {
    await page.keyboard.press('e');
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    const before = await state(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowUp');
    const after = await state(page);
    assert(before.x === after.x && before.y === after.y, '对话时角色移动了');
    await closeDialogue(page);
    await waitState(page, (s) => !s.locked, '解除对话锁定');
  });

  // ---------- 森林：树冠遮挡 ----------

  await test('老树：站在树后被树冠遮挡，站在树前不被遮挡', async () => {
    await teleport(page, 17, 6); // 树的北侧 = 树后
    const behind = await depths(page);
    assert(behind.tree !== null, '找不到老树精灵');
    assert(behind.player < behind.tree!, `站在树后时玩家层级应低于树：${JSON.stringify(behind)}`);
    // 只为截图干净：隐藏上一条提示并等淡出动画结束，不影响任何断言
    await page.evaluate(() => document.querySelector('.toast')?.classList.remove('show'));
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-behind-tree.png' });

    await teleport(page, 17, 8); // 树的南侧 = 树前
    const front = await depths(page);
    assert(front.player > front.tree!, `站在树前时玩家层级应高于树：${JSON.stringify(front)}`);
  });

  await test('老树：被遮挡时仍可交互，且目标框不会被树冠盖住', async () => {
    await teleport(page, 17, 6); // 回到树后（被遮挡）
    await page.keyboard.press('ArrowDown'); // 面向树
    await page.waitForTimeout(200);
    await page.keyboard.press('e');
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    assert((await dialogueSpeaker(page)) === '老树', '老树对话没打开');
    assert((await dialogueText(page)).includes('年轮'), '对话内容不对');
    await closeDialogue(page);
    await waitState(page, (s) => !s.locked, '解除对话锁定');

    // 目标框 depth 必须高于树木精灵，否则玩家看不到自己点的位置
    const d = await depths(page);
    assert(d.marker > d.tree!, `目标框被树冠遮住了：marker=${d.marker} tree=${d.tree}`);
  });

  // ---------- 森林 ↔ 木屋 ----------

  await test('点击木屋大门：进入木屋室内', async () => {
    await teleport(page, 12, 6);
    await clickTile(page, 12, 5);
    const s = await waitState(page, (s) => s.scene === 'cabin' && !s.locked, '进入木屋', 15000);
    assert(s.x === 7 && s.y === 9 && s.facing === 'up', `木屋出生点不对 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-cabin.png' });
  });

  await test('木屋内部：书架可交互', async () => {
    await teleport(page, 3, 3); // 书架正下方
    await page.keyboard.press('ArrowUp'); // 面向书架（被挡住，只转身）
    await page.waitForTimeout(250);
    await page.keyboard.press('e');
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 8000 });
    assert((await dialogueSpeaker(page)) === '书架', `书架说话人不对：${await dialogueSpeaker(page)}`);
    await closeDialogue(page);
    await waitState(page, (s) => !s.locked, '解除对话锁定');
  });

  await test('走进门口：从木屋返回森林', async () => {
    await teleport(page, 7, 9);
    await page.keyboard.press('ArrowDown');
    const s = await waitState(page, (s) => s.scene === 'forest' && !s.locked, '回到森林', 15000);
    assert(s.x === 12 && s.y === 6 && s.facing === 'down', `返回落点不对 ${JSON.stringify(s)}`);
  });

  // ---------- 存档 ----------

  await test('刷新后从存档位置继续', async () => {
    await page.keyboard.press('ArrowRight');
    const before = await waitState(page, (s) => !s.moving, '停止移动');
    await openGame(page);
    const s = await state(page);
    assert(s.scene === before.scene && s.x === before.x && s.y === before.y, `没有恢复 ${JSON.stringify(s)} vs ${JSON.stringify(before)}`);
  });

  await test('存档位置变成墙时回到场景出生点', async () => {
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ version: 2, scene: 'forest', x: 0, y: 0, facing: 'up' })), SAVE_KEY);
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'forest' && s.x === 12 && s.y === 10, `没有回到森林出生点 ${JSON.stringify(s)}`);
  });

  await test('损坏的存档 / 不存在的场景：回到起点', async () => {
    await page.evaluate((k) => localStorage.setItem(k, '{{{坏掉的'), SAVE_KEY);
    await openGame(page);
    const broken = await state(page);
    assert(broken.scene === 'forest' && broken.x === 12 && broken.y === 10, `损坏存档后没回到起点 ${JSON.stringify(broken)}`);

    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ version: 2, scene: 'deleted', x: 3, y: 3, facing: 'up' })), SAVE_KEY);
    await openGame(page);
    const gone = await state(page);
    assert(gone.scene === 'forest' && gone.x === 12 && gone.y === 10, `场景不存在时没回到起点 ${JSON.stringify(gone)}`);
  });

  await test('v1 旧存档迁移：保留场景、落到该场景出生点、只提示一次', async () => {
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ version: 1, scene: 'town', x: 14, y: 12, facing: 'down' })), SAVE_KEY);
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'town', `场景没保留：${JSON.stringify(s)}`);
    assert(s.x === 10 && s.y === 8, `没有落到小镇出生点 ${JSON.stringify(s)}`);
    const toast = await page.textContent('.toast');
    assert((toast ?? '').includes('存档已升级'), `没有迁移提示：${toast}`);
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), SAVE_KEY);
    assert(stored.version === 2, `迁移后没有写回 v2：${JSON.stringify(stored)}`);

    // 再刷新一次：已经是 v2，不该重复提示
    await openGame(page);
    const again = await state(page);
    assert(again.scene === 'town' && again.x === 10 && again.y === 8, `第二次进入位置变了 ${JSON.stringify(again)}`);
    const stillShown = await page.evaluate(() => document.querySelector('.toast')?.classList.contains('show') ?? false);
    assert(!stillShown, '迁移提示重复出现了');
  });

  // ---------- M1 回归：小镇 / 图书馆 / 文章 ----------

  await test('小镇：点击村民，自动靠近并开始对话', async () => {
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await openGame(page);
    const s = await enterScene(page, 'town', 'start');
    assert(s.x === 10 && s.y === 8, `小镇出生点不对 ${JSON.stringify(s)}`);
    await teleport(page, 16, 13);
    await clickTile(page, 14, 13);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 10000 });
    const at = await state(page);
    assert(Math.abs(at.x - 14) + Math.abs(at.y - 13) === 1, `没有站到村民旁边 ${JSON.stringify(at)}`);
    assert((await dialogueSpeaker(page)) === '村民小禾', '说话人不对');
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-town.png' });
    await closeDialogue(page);
    await waitState(page, (s) => !s.locked, '解除对话锁定');
  });

  await test('小镇：点击图书馆门，进入室内场景', async () => {
    await teleport(page, 10, 8);
    await clickTile(page, 10, 5);
    const s = await waitState(page, (s) => s.scene === 'library' && !s.locked, '进入图书馆', 15000);
    assert(s.x === 6 && s.y === 7 && s.facing === 'up', `到达位置不对 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/desktop-library.png' });
  });

  await test('图书管理员 → 对话选项 → 研究笔记列表 → 文章弹窗', async () => {
    await clickTile(page, 7, 3);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 10000 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter'); // 第一句
    await page.waitForSelector('.dialogue .choice', { timeout: 3000 });
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
    await clickTile(page, 6, 8);
    const s = await waitState(page, (s) => s.scene === 'town' && !s.locked, '回到小镇', 15000);
    assert(s.x === 10 && s.y === 6 && s.facing === 'down', `到达位置不对 ${JSON.stringify(s)}`);
  });

  await test('导航栏「回到起点」与「清除存档」', async () => {
    await teleport(page, 10, 8);
    await clickTile(page, 10, 5);
    await waitState(page, (s) => s.scene === 'library' && !s.locked, '进入图书馆', 15000);
    await page.click('#btn-home');
    let s = await waitState(page, (s) => s.scene === 'forest' && !s.locked, '回到起点');
    assert(s.x === 12 && s.y === 10, `起点位置不对 ${JSON.stringify(s)}`);
    await page.click('#btn-reset');
    s = await waitState(page, (s) => s.scene === 'forest' && !s.locked, '清除存档');
    assert((await page.textContent('.toast'))?.includes('存档已清除'), '没有清除存档提示');
    await page.keyboard.press('ArrowDown');
    s = await waitState(page, (s) => !s.moving && s.y === 11, '清除存档后键盘仍可用');
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
    const s = await state(page);
    assert(s.scene === 'forest', `没有进入森林 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-forest.png' });
  });

  await test('点按地面移动', async () => {
    await clickTile(page, 12, 8, true);
    await waitState(page, (s) => s.x === 12 && s.y === 8 && !s.moving, '走到 (12,8)');
  });

  await test('点按木屋大门进入室内', async () => {
    await clickTile(page, 12, 5, true);
    const s = await waitState(page, (s) => s.scene === 'cabin' && !s.locked, '进入木屋', 15000);
    assert(s.x === 7 && s.y === 9, `木屋出生点不对 ${JSON.stringify(s)}`);
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-cabin.png' });
  });

  await test('点按告示牌：自动靠近 → 对话 → 打开自我介绍', async () => {
    await enterScene(page, 'town', 'start');
    await teleport(page, 11, 11);
    await clickTile(page, 9, 10, true);
    await page.waitForSelector('.dialogue:not([hidden])', { timeout: 12000 });
    await page.waitForTimeout(200);
    await page.tap('.dialogue');
    await page.waitForSelector('.dialogue .choice', { timeout: 3000 });
    await page.tap('.dialogue .choice >> text=读自我介绍');
    await page.waitForSelector('.modal .prose', { timeout: 5000 });
    await page.screenshot({ path: 'tests/e2e/screenshots/mobile-article.png' });
    const box = await page.$eval('.modal', (e) => e.getBoundingClientRect().width);
    assert(box >= 380, `窗口没有铺满手机屏幕：${box}`);
    await page.tap('.modal-close');
    await waitState(page, (s) => !s.locked, '关闭窗口');
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
  await test('游戏仍能加载与移动（不写存档也不报错）', async () => {
    await openGame(page);
    const s = await state(page);
    assert(s.scene === 'forest' && s.x === 12 && s.y === 10, `出生点不对 ${JSON.stringify(s)}`);
    await clickTile(page, 12, 9);
    await waitState(page, (s) => s.y === 9 && !s.moving, '移动');
    assert(errors.length === 0, errors.join('\n'));
  });
  await ctx.close();
}

async function main() {
  mkdirSync('tests/e2e/screenshots', { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
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
