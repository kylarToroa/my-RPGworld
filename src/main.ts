// 入口：加载配置 → 恢复存档 → 启动游戏。任何一步失败都要让访客还能看到内容入口。
import { loadWorld } from './data/world-browser';
import { createActionRunner } from './game/actions';
import { KeyboardState } from './game/input';
import { resolveSaveScene, safeStorage, SaveStore } from './game/save';
import type { WorldScene as WorldSceneType } from './game/WorldScene';
import { ContentClient } from './web/content-client';
import { GameUI } from './web/ui';

const stage = document.getElementById('stage')!;
const loading = document.getElementById('loading')!;
const gameEl = document.getElementById('game')!;

function showFailure(err: unknown): void {
  console.error(err);
  loading.hidden = false;
  loading.classList.add('failed');
  loading.innerHTML = `<p>游戏没能加载出来 😢</p>
    <p class="loading-alt">内容不受影响：<a href="library/">直接浏览全部内容 →</a></p>`;
}

async function boot(): Promise<void> {
  const world = loadWorld();
  const content = new ContentClient('./');
  const ui = new GameUI(stage, content);
  const saves = new SaveStore(safeStorage());
  const keys = new KeyboardState();
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let scene: WorldSceneType | undefined;

  const runner = createActionRunner({
    say: (r) => ui.say(r),
    endDialogue: () => ui.endDialogue(),
    openContent: (id) => ui.openContent(id),
    openCollection: (title, filter) => ui.openCollection(title, filter),
    openURL: (url) => void window.open(url, '_blank', 'noopener'),
    changeScene: async (s, spawn) => scene?.changeScene(s, spawn),
    getDialogue: (id) => world.dialogues.get(id),
    notify: (m) => ui.notify(m),
  });

  // 键盘：先给界面（对话/窗口），再给游戏；焦点在导航栏等网页元素上时游戏不抢按键
  const gameFocused = () => document.activeElement === document.body || document.activeElement === gameEl || !document.activeElement;
  window.addEventListener('keydown', (e) => {
    if (ui.handleKey(e)) return;
    if (gameFocused() && keys.keyDown(e)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.keyUp(e));
  window.addEventListener('blur', () => keys.reset());

  const { scene: startScene, requested } = resolveSaveScene(saves.load(), world);

  // Phaser 体积较大，单独分包按需加载，让页面先显示出来
  const [{ default: Phaser }, { WorldScene }] = await Promise.all([import('phaser'), import('./game/WorldScene')]);

  await new Promise<void>((resolve, reject) => {
    scene = new WorldScene({
      world, ui, runner, saves, keys, touch,
      onReady: (err) => (err ? reject(err) : resolve()),
    });
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: gameEl,
      pixelArt: true,
      roundPixels: true,
      backgroundColor: '#1d1b26',
      banner: false,
      input: { keyboard: false },
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    });
    game.scene.add('world', scene, true, { scene: startScene, placement: requested });
    (window as unknown as Record<string, unknown>).__rpgDebug = { game, scene, ui, runner };
  });

  loading.hidden = true;
  const focusGame = () => gameEl.focus({ preventScroll: true });
  focusGame();
  gameEl.addEventListener('pointerdown', focusGame);

  document.getElementById('btn-home')!.addEventListener('click', () => {
    focusGame();
    void scene?.goToStart();
  });
  document.getElementById('btn-reset')!.addEventListener('click', () => {
    focusGame();
    saves.clear();
    void scene?.goToStart().then(() => ui.notify('存档已清除，已回到起点'));
  });

  // 独立页面上的「在游戏世界中打开」：?open=<内容 ID>
  const params = new URLSearchParams(location.search);
  const openId = params.get('open');
  if (openId) {
    history.replaceState(null, '', location.pathname);
    void runner.run({ type: 'openContent', content: openId });
  }
}

boot().catch(showFailure);
