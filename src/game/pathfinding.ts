// 四方向网格 A* 寻路，以及“走到目标旁边的合法站位”计算。
import type { Facing } from '../data/schemas';
import { facingBetween, type Grid, type Point } from './grid';

const NEIGHBORS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** 防止超大地图卡死的搜索上限 */
const MAX_EXPANDED = 20000;

/**
 * 从 start 走到 goals 中任意一个格子的最短路径。
 * 返回不含起点、含终点的格子序列；start 本身就是目标时返回 []；不可达返回 null。
 */
export function findPath(grid: Grid, start: Point, goals: Point[]): Point[] | null {
  const goalSet = new Set(goals.filter((g) => grid.isWalkable(g.x, g.y)).map((g) => key(g)));
  if (goalSet.size === 0) return null;
  if (goalSet.has(key(start))) return [];

  const goalList = [...goalSet].map(unkey);
  const h = (p: Point) => Math.min(...goalList.map((g) => Math.abs(g.x - p.x) + Math.abs(g.y - p.y)));

  const open = new MinHeap<{ p: Point; f: number }>((a, b) => a.f - b.f);
  const gScore = new Map<string, number>([[key(start), 0]]);
  const cameFrom = new Map<string, string>();
  open.push({ p: start, f: h(start) });
  let expanded = 0;

  while (open.size > 0 && expanded++ < MAX_EXPANDED) {
    const { p } = open.pop()!;
    const pk = key(p);
    if (goalSet.has(pk)) return reconstruct(cameFrom, pk);
    const g = gScore.get(pk)!;
    for (const d of NEIGHBORS) {
      const n = { x: p.x + d.x, y: p.y + d.y };
      if (grid.isBlocked(n.x, n.y)) continue;
      const nk = key(n);
      const ng = g + 1;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        cameFrom.set(nk, pk);
        open.push({ p: n, f: ng + h(n) });
      }
    }
  }
  return null;
}

export interface Footprint {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function footprintTiles(f: Footprint): Point[] {
  const tiles: Point[] = [];
  for (let y = f.y; y < f.y + f.height; y++) for (let x = f.x; x < f.x + f.width; x++) tiles.push({ x, y });
  return tiles;
}

export function inFootprint(f: Footprint, p: Point): boolean {
  return p.x >= f.x && p.x < f.x + f.width && p.y >= f.y && p.y < f.y + f.height;
}

/**
 * 可以与目标交互的站位：与目标某个格子同行或同列、距离 1..range、且不在目标内部。
 */
export function interactionSpots(f: Footprint, range: number): { spot: Point; facing: Facing }[] {
  const spots = new Map<string, { spot: Point; facing: Facing }>();
  for (const t of footprintTiles(f)) {
    for (const d of NEIGHBORS) {
      for (let r = 1; r <= range; r++) {
        const spot = { x: t.x + d.x * r, y: t.y + d.y * r };
        if (inFootprint(f, spot)) break;
        const k = key(spot);
        if (!spots.has(k)) spots.set(k, { spot, facing: facingBetween(spot, t) });
      }
    }
  }
  return [...spots.values()];
}

export interface Approach {
  path: Point[];
  stand: Point;
  facing: Facing;
}

/** 计算走到目标旁边可交互位置的路径；没有可到达的站位时返回 null */
export function findApproach(grid: Grid, start: Point, target: Footprint, range = 1): Approach | null {
  const spots = interactionSpots(target, range);
  const path = findPath(grid, start, spots.map((s) => s.spot));
  if (!path) return null;
  const stand = path.length ? path[path.length - 1]! : start;
  const facing = spots.find((s) => s.spot.x === stand.x && s.spot.y === stand.y)!.facing;
  return { path, stand, facing };
}

/** 离 target 最近的可行走格（广度优先，用于存档/出生点修正） */
export function nearestWalkable(grid: Grid, target: Point, maxRadius = 6): Point | null {
  if (grid.isWalkable(target.x, target.y)) return target;
  const seen = new Set([key(target)]);
  let frontier = [target];
  for (let r = 0; r < maxRadius; r++) {
    const next: Point[] = [];
    for (const p of frontier) {
      for (const d of NEIGHBORS) {
        const n = { x: p.x + d.x, y: p.y + d.y };
        const k = key(n);
        if (seen.has(k) || !grid.inBounds(n.x, n.y)) continue;
        if (grid.isWalkable(n.x, n.y)) return n;
        seen.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

function key(p: Point): string {
  return `${p.x},${p.y}`;
}
function unkey(k: string): Point {
  const [x, y] = k.split(',').map(Number);
  return { x: x!, y: y! };
}
function reconstruct(cameFrom: Map<string, string>, end: string): Point[] {
  const out: Point[] = [];
  let cur: string | undefined = end;
  while (cur !== undefined && cameFrom.has(cur)) {
    out.push(unkey(cur));
    cur = cameFrom.get(cur);
  }
  return out.reverse();
}

class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly cmp: (a: T, b: T) => number) {}
  get size() {
    return this.items.length;
  }
  push(item: T) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.cmp(a[i]!, a[parent]!) >= 0) break;
      [a[i], a[parent]] = [a[parent]!, a[i]!];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.cmp(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.cmp(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
