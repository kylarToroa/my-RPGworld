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

/**
 * 迁移哨兵坐标：表示"这个位置来自旧网格，无法换算"。
 * 它不是合法格子，resolvePlacement 会自然地回落到场景出生点。
 */
const UNKNOWN_POSITION = -1;

/**
 * 旧版本存档迁移：key 为旧版本号，返回升级一版后的数据。
 *
 * v1 → v2：网格从 16px 改为 48px，地图是重画的，旧坐标与新坐标没有稳定的对应关系，
 * 所以不按比例缩放（×3 会把人放到错误的地方），而是保留场景 ID 与朝向，位置交给出生点。
 * 场景本身若已被删除，由 resolveSaveScene 兜底回到起始场景。
 */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  1: (old) => ({ ...old, x: UNKNOWN_POSITION, y: UNKNOWN_POSITION }),
};

/** 存档迁移的记录，用于在加载完成后给访客一条提示 */
export interface MigrationInfo {
  /** 迁移前的版本号 */
  from: number;
  /** 迁移前记录的场景 ID（可能已被删除） */
  scene: string;
}

export class SaveStore {
  private migration: MigrationInfo | null = null;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly key = SAVE_KEY,
  ) {}

  /** 上一次 load() 是否发生了版本迁移（没有则为 null） */
  get lastMigration(): MigrationInfo | null {
    return this.migration;
  }

  load(): SaveData | null {
    this.migration = null;
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return null;
      let data = JSON.parse(raw) as Record<string, unknown>;
      const from = typeof data.version === 'number' ? data.version : 0;
      const originalScene = typeof data.scene === 'string' ? data.scene : '';
      let version = from;
      while (version < SAVE_VERSION) {
        const migrate = MIGRATIONS[version];
        if (!migrate) return null; // 无法迁移的旧存档：放弃，回到起点
        data = migrate(data);
        version++;
        data.version = version;
      }
      const parsed = SaveSchema.safeParse(data);
      if (!parsed.success || parsed.data.version !== SAVE_VERSION) return null;

      // 迁移成功：立刻写回新版本，保证提示只出现一次，也避免每次加载都重算
      if (from < SAVE_VERSION) {
        this.migration = { from, scene: originalScene };
        this.persist(parsed.data);
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  save(data: Omit<SaveData, 'version'>): void {
    this.persist({ ...data, version: SAVE_VERSION });
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // 同上
    }
  }

  private persist(data: SaveData): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
    } catch {
      // 存储满或被禁用：忽略，不影响游玩
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
