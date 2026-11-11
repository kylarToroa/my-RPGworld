// 地图通行网格：由 Tiled 地图的 collision 图层生成，再叠加实体占位。
import { z } from 'zod';
import type { Facing } from '../data/schemas';

export interface Point {
  x: number;
  y: number;
}

/** 基础网格：48×48 像素一格（与美术素材的图块规格一致） */
export const TILE_SIZE = 48;
export const COLLISION_LAYER = 'collision';

const TiledMapSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.literal(TILE_SIZE),
  tileheight: z.literal(TILE_SIZE),
  layers: z.array(
    z.object({ name: z.string(), type: z.string(), data: z.array(z.number()).optional() }).loose(),
  ),
});

export class Grid {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly blocked: Uint8Array,
  ) {}

  static fromTiled(json: unknown): Grid {
    const map = TiledMapSchema.parse(json);
    const layer = map.layers.find((l) => l.name === COLLISION_LAYER && l.type === 'tilelayer');
    const blocked = new Uint8Array(map.width * map.height);
    layer?.data?.forEach((gid, i) => {
      if (gid !== 0) blocked[i] = 1;
    });
    return new Grid(map.width, map.height, blocked);
  }

  /** 用字符串快速构造网格（测试用），'#' 为障碍 */
  static fromRows(rows: string[]): Grid {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    const blocked = new Uint8Array(width * height);
    rows.forEach((row, y) => [...row].forEach((ch, x) => (blocked[y * width + x] = ch === '#' ? 1 : 0)));
    return new Grid(width, height, blocked);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  isBlocked(x: number, y: number): boolean {
    return !this.inBounds(x, y) || this.blocked[y * this.width + x] === 1;
  }

  isWalkable(x: number, y: number): boolean {
    return !this.isBlocked(x, y);
  }

  /** 返回叠加了额外障碍格的新网格（原网格不变） */
  withBlocked(points: Iterable<Point>): Grid {
    const copy = new Uint8Array(this.blocked);
    for (const p of points) if (this.inBounds(p.x, p.y)) copy[p.y * this.width + p.x] = 1;
    return new Grid(this.width, this.height, copy);
  }
}

export const DIRS: Record<Facing, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function facingBetween(from: Point, to: Point): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
