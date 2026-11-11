// 唯一的 Phaser 场景：负责加载地图、绘制实体、移动玩家、触发交互。
// 切换“世界场景”（小镇 / 图书馆……）时只替换地图与实体，不重载页面。
import Phaser from 'phaser';
import type { Entity, Facing, SceneConfig } from '../data/schemas';
import { sceneGrid, type World } from '../data/world';
import { mapUrl } from '../data/world-browser';
import type { ActionRunner } from './actions';
import { COLLISION_LAYER, DIRS, facingBetween, Grid, TILE_SIZE, type Point } from './grid';
import type { KeyboardState } from './input';
import { findApproach, findPath, footprintTiles, inFootprint } from './pathfinding';
import { type Placement, resolvePlacement, type SaveStore } from './save';
import type { GameUI } from '../web/ui';

const STEP_MS = 170;
const FACING_ROW: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 };
const PLAYER_SPRITE = 'player';

export interface SceneServices {
  world: World;
  ui: GameUI;
  runner: ActionRunner;
  saves: SaveStore;
  keys: KeyboardState;
  touch: boolean;
  /** 初始场景就绪（或失败）时回调 */
  onReady(error?: unknown): void;
}

interface Move {
  from: Point;
  to: Point;
  elapsed: number;
}

export class WorldScene extends Phaser.Scene {
  private current?: SceneConfig;
  private tilemap?: Phaser.Tilemaps.Tilemap;
  private grid!: Grid; // 实体阻挡后的可行走网格（键盘移动用）
  private navGrid!: Grid; // 再把门/传送点当成障碍（自动寻路用，避免路过时误触发）
  private entities: Entity[] = [];
  private displayObjects: Phaser.GameObjects.GameObject[] = [];
  private npcSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private player!: Phaser.GameObjects.Sprite;
  private marker!: Phaser.GameObjects.Graphics;
  private tile: Point = { x: 0, y: 0 };
  private facing: Facing = 'down';
  private move: Move | null = null;
  private path: Point[] = [];
  private pendingInteract: { entity: Entity; facing: Facing } | null = null;
  private transitioning = false;
  private mapPixels = { w: 0, h: 0 };

  constructor(private readonly svc: SceneServices) {
    super('world');
  }

  preload(): void {
    const { assets } = this.svc.world;
    for (const [name, url] of Object.entries(assets.tilesets)) this.load.image(`tileset:${name}`, url);
    for (const [key, s] of Object.entries(assets.sprites)) {
      this.load.spritesheet(`sprite:${key}`, s.url, { frameWidth: s.frameWidth, frameHeight: s.frameHeight });
    }
  }

  create(data: { placement: Placement | null; scene: SceneConfig }): void {
    for (const key of Object.keys(this.svc.world.assets.sprites)) {
      // 单帧道具图（整棵树、整栋屋）不注册行走动画：它没有 3×4 帧
      if (this.textures.get(`sprite:${key}`).frameTotal < 13) continue;
      for (const [dir, row] of Object.entries(FACING_ROW)) {
        this.anims.create({
          key: `${key}:walk:${dir}`,
          frames: this.anims.generateFrameNumbers(`sprite:${key}`, { frames: [row * 3 + 1, row * 3, row * 3 + 2, row * 3] }),
          frameRate: 1000 / (STEP_MS / 2),
          repeat: -1,
        });
      }
    }
    this.player = this.add.sprite(0, 0, `sprite:${PLAYER_SPRITE}`, 0).setOrigin(0.5, 1);
    this.marker = this.add.graphics().setDepth(5000);
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => this.onPointer(p));
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.updateZoom());
    this.updateZoom();

    this.enter(data.scene, data.placement, false).then(
      () => this.svc.onReady(),
      (err) => this.svc.onReady(err),
    );
  }

  // ---------- 场景切换 ----------

  /** 行为 changeScene 的实现 */
  async changeScene(sceneId: string, spawnId: string): Promise<void> {
    const scene = this.svc.world.scenes.get(sceneId);
    const spawn = scene?.spawns[spawnId];
    if (!scene || !spawn) {
      this.svc.ui.notify('这扇门好像打不开');
      return;
    }
    await this.enter(scene, { scene: scene.id, ...spawn }, true);
  }

  /** 回到世界起点（导航栏按钮） */
  async goToStart(): Promise<void> {
    if (this.transitioning) return;
    const { startScene, startSpawn } = this.svc.world.config;
    this.svc.ui.closeModal();
    this.svc.ui.endDialogue();
    await this.changeScene(startScene, startSpawn);
  }

  private async enter(scene: SceneConfig, requested: Placement | null, fade: boolean): Promise<void> {
    this.transitioning = true;
    this.clearPath();
    try {
      if (fade) await this.fade(false);
      const json = await this.loadMap(scene.map);
      this.buildScene(scene, json, requested);
      if (fade) await this.fade(true);
    } catch (err) {
      if (fade) this.cameras.main.resetFX();
      throw err;
    } finally {
      this.transitioning = false;
    }
  }

  private fade(fadeIn: boolean): Promise<void> {
    return new Promise((resolve) => {
      const cam = this.cameras.main;
      const evt = fadeIn ? Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE : Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE;
      cam.once(evt, () => resolve());
      if (fadeIn) cam.fadeIn(180, 0, 0, 0);
      else cam.fadeOut(180, 0, 0, 0);
    });
  }

  private loadMap(mapId: string): Promise<unknown> {
    const key = `map:${mapId}`;
    if (this.cache.tilemap.exists(key)) return Promise.resolve(this.cache.tilemap.get(key).data);
    const url = mapUrl(mapId);
    if (!url) return Promise.reject(new Error(`地图 ${mapId} 不存在`));
    return new Promise((resolve, reject) => {
      const onError = (file: Phaser.Loader.File) => {
        if (file.key === key) {
          this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
          reject(new Error(`地图 ${mapId} 加载失败`));
        }
      };
      const onComplete = () => {
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        if (this.cache.tilemap.exists(key)) resolve(this.cache.tilemap.get(key).data);
        else reject(new Error(`地图 ${mapId} 加载失败`));
      };
      this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      this.load.tilemapTiledJSON(key, url);
      this.load.start();
    });
  }

  private buildScene(scene: SceneConfig, json: unknown, requested: Placement | null): void {
    for (const obj of this.displayObjects) obj.destroy();
    this.displayObjects = [];
    this.npcSprites.clear();
    this.tilemap?.destroy();

    const map = (this.tilemap = this.make.tilemap({ key: `map:${scene.map}` }));
    const tilesets = map.tilesets.map((ts) => map.addTilesetImage(ts.name, `tileset:${ts.name}`)).filter((t) => t !== null);
    map.layers.forEach((layerData, i) => {
      if (layerData.name === COLLISION_LAYER) return;
      const layer = map.createLayer(layerData.name, tilesets, 0, 0);
      if (!layer) return;
      // 名字以 above 开头的图层画在角色上方（如树冠、屋檐）
      layer.setDepth(layerData.name.startsWith('above') ? 100000 : -1000 + i);
      this.displayObjects.push(layer);
    });

    this.current = scene;
    this.entities = this.svc.world.entities.filter((e) => e.scene === scene.id);
    const base = Grid.fromTiled(json);
    this.grid = sceneGrid(base, this.entities);
    this.navGrid = this.grid.withBlocked(this.entities.filter((e) => e.trigger === 'step').flatMap((e) => footprintTiles(e)));
    this.mapPixels = { w: base.width * TILE_SIZE, h: base.height * TILE_SIZE };

    for (const e of this.entities) {
      if (!e.sprite) continue;
      const s = this.add
        .sprite((e.x + e.width / 2) * TILE_SIZE, (e.y + e.height) * TILE_SIZE, `sprite:${e.sprite}`, FACING_ROW[e.facing] * 3)
        .setOrigin(0.5, 1)
        .setDepth((e.y + e.height) * TILE_SIZE);
      this.npcSprites.set(e.id, s);
      this.displayObjects.push(s);
    }

    const place = resolvePlacement(this.grid, scene, requested);
    this.tile = { x: place.x, y: place.y };
    this.facing = place.facing;
    this.move = null;
    this.syncPlayer();
    this.idle();
    this.persist();
    this.updateCamera();
    this.updateHint();
  }

  // ---------- 每帧更新 ----------

  override update(_time: number, delta: number): void {
    if (!this.current) return;
    if (this.move) {
      this.move.elapsed += delta;
      if (this.move.elapsed >= STEP_MS) {
        this.tile = this.move.to;
        this.move = null;
        this.syncPlayer();
        this.onArrive();
      } else {
        this.syncPlayer();
      }
    }
    if (!this.move) this.decideNext();
    this.updateCamera();
  }

  private get locked(): boolean {
    return this.transitioning || this.svc.ui.blocking || this.svc.runner.busy;
  }

  private decideNext(): void {
    const { keys } = this.svc;
    if (this.locked) {
      keys.direction();
      keys.consumeInteract();
      if (this.path.length || this.pendingInteract) this.clearPath();
      this.idle();
      return;
    }
    const dir = keys.direction();
    if (dir) {
      // 手动操作会打断自动寻路
      this.clearPath();
      this.tryStep(dir, this.grid);
      return;
    }
    const next = this.path.shift();
    if (next) {
      const d = facingBetween(this.tile, next);
      if (!this.tryStep(d, this.path.length === 0 ? this.grid : this.navGrid)) this.clearPath();
      return;
    }
    if (this.pendingInteract) {
      const { entity, facing } = this.pendingInteract;
      this.pendingInteract = null;
      this.marker.clear();
      this.setFacing(facing);
      this.interact(entity);
      return;
    }
    if (keys.consumeInteract()) {
      const target = this.entityInFront();
      if (target) this.interact(target);
    }
    this.idle();
  }

  private tryStep(dir: Facing, grid: Grid): boolean {
    this.setFacing(dir);
    const to = { x: this.tile.x + DIRS[dir].x, y: this.tile.y + DIRS[dir].y };
    if (grid.isBlocked(to.x, to.y)) {
      this.idle();
      return false;
    }
    this.move = { from: this.tile, to, elapsed: 0 };
    this.player.anims.play(`${PLAYER_SPRITE}:walk:${dir}`, true);
    return true;
  }

  private onArrive(): void {
    this.persist();
    if (!this.path.length) this.marker.clear();
    const trigger = this.entities.find((e) => e.trigger === 'step' && inFootprint(e, this.tile));
    if (trigger) {
      this.clearPath();
      this.idle();
      void this.svc.runner.run(trigger.action);
    }
    this.updateHint();
  }

  // ---------- 交互 ----------

  private interact(entity: Entity): void {
    const npc = this.npcSprites.get(entity.id);
    // 单帧道具图没有朝向帧，不做转身
    const animated = npc !== undefined && npc.texture.frameTotal >= 13;
    if (npc && animated) {
      // NPC 转身面向玩家
      const toPlayer = facingBetween({ x: entity.x, y: entity.y }, this.tile);
      npc.setFrame(FACING_ROW[toPlayer] * 3);
      void this.svc.runner.run(entity.action).finally(() => npc.active && npc.setFrame(FACING_ROW[entity.facing] * 3));
    } else {
      void this.svc.runner.run(entity.action);
    }
  }

  /** 面前（交互距离内）的可交互实体 */
  private entityInFront(): Entity | undefined {
    const d = DIRS[this.facing];
    for (let r = 1; r <= 3; r++) {
      const p = { x: this.tile.x + d.x * r, y: this.tile.y + d.y * r };
      const hit = this.entities.find((e) => e.trigger === 'interact' && e.range >= r && inFootprint(e, p));
      if (hit) return hit;
      if (this.grid.isBlocked(p.x, p.y) && !this.entities.some((e) => inFootprint(e, p))) return undefined;
    }
    return undefined;
  }

  private onPointer(p: Phaser.Input.Pointer): void {
    if (!this.current || this.locked) return;
    if (p.getDistance() > 12) return; // 拖动不算点击
    const target = { x: Math.floor(p.worldX / TILE_SIZE), y: Math.floor(p.worldY / TILE_SIZE) };
    if (!this.grid.inBounds(target.x, target.y)) return;
    const start = this.move ? this.move.to : this.tile;
    this.svc.keys.reset();
    this.clearPath();

    const entity = this.entities.find((e) => inFootprint(e, target));
    if (entity) {
      const approach = findApproach(this.navGrid, start, entity, entity.trigger === 'interact' ? entity.range : 1);
      if (!approach) return this.fail(target, `走不到${entity.name}那里`);
      this.path = approach.path;
      if (entity.trigger === 'step') {
        // 先走到门前，最后一步踩上门
        const d = DIRS[approach.facing];
        this.path.push({ x: approach.stand.x + d.x, y: approach.stand.y + d.y });
      } else {
        this.pendingInteract = { entity, facing: approach.facing };
      }
      this.showMarker(entity.trigger === 'step' ? target : approach.stand, 0xffe066);
      return;
    }

    if (this.navGrid.isWalkable(target.x, target.y)) {
      const path = findPath(this.navGrid, start, [target]);
      if (!path) return this.fail(target, '那里走不过去');
      this.path = path;
      this.showMarker(target, 0xffffff);
      return;
    }

    // 点在障碍物上：走到它旁边最近的位置
    const approach = findApproach(this.navGrid, start, { ...target, width: 1, height: 1 });
    if (!approach || approach.path.length === 0) return this.fail(target, '那里走不过去');
    this.path = approach.path;
    this.showMarker(approach.stand, 0xffffff);
  }

  private fail(at: Point, message: string): void {
    this.marker.clear();
    this.marker.lineStyle(2, 0xff5050, 1);
    const x = at.x * TILE_SIZE, y = at.y * TILE_SIZE;
    this.marker.lineBetween(x + 3, y + 3, x + 13, y + 13).lineBetween(x + 13, y + 3, x + 3, y + 13);
    this.time.delayedCall(600, () => this.marker.clear());
    this.svc.ui.notify(message);
  }

  private showMarker(at: Point, color: number): void {
    this.marker.clear();
    this.marker.lineStyle(1, color, 0.9);
    this.marker.strokeRect(at.x * TILE_SIZE + 1.5, at.y * TILE_SIZE + 1.5, TILE_SIZE - 3, TILE_SIZE - 3);
  }

  private clearPath(): void {
    this.path = [];
    this.pendingInteract = null;
    this.marker?.clear();
  }

  // ---------- 显示 ----------

  private setFacing(f: Facing): void {
    if (this.facing === f) return;
    this.facing = f;
    this.persist();
    this.updateHint();
  }

  private idle(): void {
    this.player.anims.stop();
    this.player.setFrame(FACING_ROW[this.facing] * 3);
  }

  private syncPlayer(): void {
    let { x, y } = this.tile;
    if (this.move) {
      const t = Math.min(1, this.move.elapsed / STEP_MS);
      x = this.move.from.x + (this.move.to.x - this.move.from.x) * t;
      y = this.move.from.y + (this.move.to.y - this.move.from.y) * t;
    }
    this.player.setPosition(Math.round((x + 0.5) * TILE_SIZE), Math.round((y + 1) * TILE_SIZE));
    this.player.setDepth(this.player.y + 0.5);
  }

  private updateZoom(): void {
    const { width, height } = this.scale.gameSize;
    // 屏幕短边约显示 12 格；手机等窄屏放大到约 8 格，方便手指点按
    // 图块已是 48px，缩放保持整数倍（1~3），避免像素被拉花
    const short = Math.min(width, height);
    const zoom = Phaser.Math.Clamp(Math.floor(short / (TILE_SIZE * (short < 600 ? 8 : 12))), 1, 3);
    this.cameras.main.setZoom(zoom);
    this.updateCamera();
  }

  /** 镜头跟随玩家；地图比屏幕小时居中显示 */
  private updateCamera(): void {
    if (!this.player) return;
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom, viewH = cam.height / cam.zoom;
    const axis = (pos: number, map: number, view: number) =>
      map <= view ? map / 2 : Phaser.Math.Clamp(pos, view / 2, map - view / 2);
    cam.centerOn(
      Math.round(axis(this.player.x, this.mapPixels.w, viewW)),
      Math.round(axis(this.player.y - TILE_SIZE / 2, this.mapPixels.h, viewH)),
    );
  }

  private updateHint(): void {
    const e = this.entityInFront();
    const { ui, touch } = this.svc;
    if (e) ui.setHint(touch ? `面前：${e.name}（点它互动）` : `面前：${e.name} — 按 E / 空格 互动`);
    else if (touch) ui.setHint('点地面移动 · 点人物/物品互动');
    else ui.setHint('方向键 / WASD 移动 · 点地面自动走 · E / 空格 互动 · Esc 关闭');
  }

  private persist(): void {
    if (!this.current) return;
    this.svc.saves.save({ scene: this.current.id, x: this.tile.x, y: this.tile.y, facing: this.facing });
  }

  /** 供自动化测试读取的状态 */
  debugState() {
    return { scene: this.current?.id, x: this.tile.x, y: this.tile.y, facing: this.facing, moving: !!this.move, locked: this.locked };
  }

  /** 供自动化测试：瞬移到某个可站立的格子（用于测试前摆好位置） */
  debugTeleport(x: number, y: number): boolean {
    if (this.locked || !this.grid.isWalkable(x, y)) return false;
    this.clearPath();
    this.move = null;
    this.tile = { x, y };
    this.syncPlayer();
    this.updateCamera();
    this.cameras.main.preRender();
    return true;
  }

  /** 供自动化测试：某个格子中心在页面上的坐标 */
  debugTileToClient(x: number, y: number) {
    const cam = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    const sx = rect.width / this.scale.width, sy = rect.height / this.scale.height;
    return {
      x: rect.left + ((x + 0.5) * TILE_SIZE - cam.worldView.x) * cam.zoom * sx,
      y: rect.top + ((y + 0.5) * TILE_SIZE - cam.worldView.y) * cam.zoom * sy,
    };
  }
}
