// 本地存档：只保存“在哪个场景、哪个格子、朝哪边”。
// 原则：任何坏存档/旧存档/地图改动都不能让访客卡住——最坏情况回到起点。
import { type Facing, SAVE_VERSION, type SaveData, SaveSchema, type SceneConfig } from '../data/schemas';
import type { World } from '../data/world';
import type { Grid, Point } from './grid';
import { nearestWalkable } from './pathfinding';

export const SAVE_KEY = 'rpgworld:save';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 可用则用 localStorage；隐私模式、禁用存储等情况退回内存存储（刷新后丢失，但不报错） */
export function safeStorage(): KeyValueStorage {
  try {
    const ls = window.localStorage;
    const probe = '__rpgworld_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryStorage();
  }
}

export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** 旧版本存档迁移：key 为旧版本号，返回升级一版后的数据。暂时没有旧版本。 */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {};

export class SaveStore {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = SAVE_KEY,
  ) {}

  load(): SaveData | null {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      let data = JSON.parse(raw) as Record<string, unknown>;
      let version = typeof data.version === 'number' ? data.version : 0;
      while (version < SAVE_VERSION) {
        const migrate = MIGRATIONS[version];
        if (!migrate) return null; // 无法迁移的旧存档：放弃，回到起点
        data = migrate(data);
        version++;
        data.version = version;
      }
      const parsed = SaveSchema.safeParse(data);
      return parsed.success && parsed.data.version === SAVE_VERSION ? parsed.data : null;
    } catch {
      return null;
    }
  }

  save(data: Omit<SaveData, 'version'>): void {
    try {
      this.storage.setItem(this.key, JSON.stringify({ ...data, version: SAVE_VERSION }));
    } catch {
      // 存储满或被禁用：忽略，不影响游玩
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // 同上
    }
  }
}

export interface Placement {
  scene: string;
  x: number;
  y: number;
  facing: Facing;
}

/** 根据存档选择要进入的场景；场景已被删除时回到起始场景 */
export function resolveSaveScene(save: SaveData | null, world: World): { scene: SceneConfig; requested: Placement | null } {
  if (save) {
    const scene = world.scenes.get(save.scene);
    if (scene) return { scene, requested: save };
  }
  return { scene: world.scenes.get(world.config.startScene)!, requested: null };
}

/**
 * 在地图加载后确定最终站位：
 * 存档位置可站立 → 用存档；否则 → 场景默认出生点；仍不行 → 最近的可行走格。
 */
export function resolvePlacement(grid: Grid, scene: SceneConfig, requested: Placement | null): Point & { facing: Facing } {
  if (requested && grid.isWalkable(requested.x, requested.y)) return requested;
  const spawn = scene.spawns[scene.defaultSpawn]!;
  const p = nearestWalkable(grid, spawn, 12) ?? spawn;
  return { x: p.x, y: p.y, facing: spawn.facing };
}
