import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Grid } from '../src/game/grid';
import { memoryStorage, resolvePlacement, resolveSaveScene, SAVE_KEY, SaveStore, type KeyValueStorage } from '../src/game/save';
import { SAVE_VERSION } from '../src/data/schemas';
import { parseWorld } from '../src/data/world';
import { readWorldFromDisk } from '../src/data/world-fs';

const { raw, maps } = readWorldFromDisk(join(__dirname, '..'));
const world = parseWorld(raw);

describe('SaveStore', () => {
  it('保存后可以读回', () => {
    const s = new SaveStore(memoryStorage());
    s.save({ scene: 'library', x: 3, y: 4, facing: 'left' });
    expect(s.load()).toEqual({ scene: 'library', x: 3, y: 4, facing: 'left', version: SAVE_VERSION });
  });

  it('损坏或版本不认识的存档返回 null', () => {
    const storage = memoryStorage();
    const s = new SaveStore(storage);
    storage.setItem(SAVE_KEY, '{不是 JSON');
    expect(s.load()).toBeNull();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 0, scene: 'town' }));
    expect(s.load()).toBeNull();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99, scene: 'town', x: 1, y: 1, facing: 'up' }));
    expect(s.load()).toBeNull();
  });

  it('存储抛异常时安全降级', () => {
    const broken: KeyValueStorage = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    const s = new SaveStore(broken);
    expect(() => s.save({ scene: 'town', x: 1, y: 1, facing: 'up' })).not.toThrow();
    expect(s.load()).toBeNull();
    expect(() => s.clear()).not.toThrow();
  });
});

describe('存档恢复', () => {
  it('场景已被删除时回到起始场景', () => {
    const r = resolveSaveScene({ version: 1, scene: 'deleted-scene', x: 1, y: 1, facing: 'up' }, world);
    expect(r.scene.id).toBe(world.config.startScene);
    expect(r.requested).toBeNull();
  });

  it('没有存档时从起点开始', () => {
    expect(resolveSaveScene(null, world).scene.id).toBe(world.config.startScene);
  });

  it('v1 旧存档迁移为 v2：保留场景与朝向，位置交给场景出生点', () => {
    const storage = memoryStorage();
    const s = new SaveStore(storage);
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, scene: 'town', x: 14, y: 12, facing: 'down' }));
    const loaded = s.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(SAVE_VERSION);
    expect(loaded!.scene).toBe('town');
    expect(loaded!.facing).toBe('down');
    expect(s.lastMigration).toEqual({ from: 1, scene: 'town' });

    // 迁移后的坐标不是合法格子，最终站位应落到该场景出生点
    const scene = world.scenes.get('town')!;
    const p = resolvePlacement(maps.get('town')!, scene, loaded!);
    expect(p).toMatchObject(scene.spawns[scene.defaultSpawn]!);
  });

  it('迁移成功后立刻写回 v2，再次加载不会重复迁移', () => {
    const storage = memoryStorage();
    const s = new SaveStore(storage);
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, scene: 'library', x: 3, y: 4, facing: 'up' }));
    expect(s.load()).not.toBeNull();
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).version).toBe(SAVE_VERSION);

    const again = new SaveStore(storage);
    expect(again.load()).toMatchObject({ scene: 'library', version: SAVE_VERSION });
    expect(again.lastMigration).toBeNull();
  });

  it('已经是 v2 的存档不触发迁移', () => {
    const s = new SaveStore(memoryStorage());
    s.save({ scene: 'cabin', x: 7, y: 8, facing: 'left' });
    expect(s.load()).toEqual({ scene: 'cabin', x: 7, y: 8, facing: 'left', version: SAVE_VERSION });
    expect(s.lastMigration).toBeNull();
  });

  it('v1 存档的场景已被删除时，迁移后回到起始场景', () => {
    const storage = memoryStorage();
    const s = new SaveStore(storage);
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, scene: 'deleted-scene', x: 5, y: 5, facing: 'up' }));
    const loaded = s.load();
    expect(loaded!.scene).toBe('deleted-scene');
    const r = resolveSaveScene(loaded, world);
    expect(r.scene.id).toBe(world.config.startScene);
    expect(r.requested).toBeNull();
  });

  it('存档位置可站立时使用存档位置', () => {
    const scene = world.scenes.get('town')!;
    const p = resolvePlacement(maps.get('town')!, scene, { scene: 'town', x: 8, y: 13, facing: 'left' });
    expect(p).toMatchObject({ x: 8, y: 13, facing: 'left' });
  });

  it('存档位置变成墙（地图被修改）时回到场景出生点', () => {
    const scene = world.scenes.get('town')!;
    const p = resolvePlacement(maps.get('town')!, scene, { scene: 'town', x: 0, y: 0, facing: 'left' });
    expect(p).toMatchObject(scene.spawns[scene.defaultSpawn]!);
  });

  it('存档坐标超出地图范围时也能回到出生点', () => {
    const scene = world.scenes.get('library')!;
    const p = resolvePlacement(maps.get('library')!, scene, { scene: 'library', x: 999, y: -5, facing: 'up' });
    expect(p).toMatchObject({ x: 6, y: 7 });
  });

  it('出生点本身被堵住时找最近的空地', () => {
    const scene = world.scenes.get('library')!;
    const grid = maps.get('library')!.withBlocked([{ x: 6, y: 7 }]);
    const p = resolvePlacement(grid, scene, null);
    expect(grid.isWalkable(p.x, p.y)).toBe(true);
  });

  it('Grid 越界视为障碍', () => {
    expect(Grid.fromRows(['.']).isBlocked(-1, 0)).toBe(true);
  });
});
