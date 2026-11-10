import { describe, expect, it } from 'vitest';
import { Grid } from '../src/game/grid';
import { findApproach, findPath, interactionSpots, nearestWalkable } from '../src/game/pathfinding';

const g = Grid.fromRows([
  '.....',
  '.###.',
  '.#...',
  '.#.#.',
  '.....',
]);

describe('findPath', () => {
  it('找到最短路径（不含起点、含终点）', () => {
    const path = findPath(g, { x: 0, y: 0 }, [{ x: 2, y: 2 }])!;
    expect(path.at(-1)).toEqual({ x: 2, y: 2 });
    expect(path).toHaveLength(8); // (0,0)→(4,0)→(4,2)→(2,2)
    for (const p of path) expect(g.isWalkable(p.x, p.y)).toBe(true);
  });

  it('路径每一步都只走一格', () => {
    const path = findPath(g, { x: 0, y: 4 }, [{ x: 4, y: 0 }])!;
    let prev = { x: 0, y: 4 };
    for (const p of path) {
      expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBe(1);
      prev = p;
    }
  });

  it('起点即终点时返回空路径', () => {
    expect(findPath(g, { x: 0, y: 0 }, [{ x: 0, y: 0 }])).toEqual([]);
  });

  it('目标是障碍或不可达时返回 null', () => {
    expect(findPath(g, { x: 0, y: 0 }, [{ x: 1, y: 1 }])).toBeNull();
    const walled = Grid.fromRows(['.#.', '.#.', '.#.']);
    expect(findPath(walled, { x: 0, y: 0 }, [{ x: 2, y: 0 }])).toBeNull();
  });

  it('多个目标时走到最近的一个', () => {
    const path = findPath(g, { x: 0, y: 0 }, [{ x: 4, y: 4 }, { x: 2, y: 0 }])!;
    expect(path.at(-1)).toEqual({ x: 2, y: 0 });
  });
});

describe('findApproach（自动靠近交互）', () => {
  it('走到目标旁边并面向目标', () => {
    // 目标是 (2,1) 处的障碍（例如 NPC），只能从下方 (2,2) 接近
    const a = findApproach(g, { x: 4, y: 4 }, { x: 2, y: 1, width: 1, height: 1 })!;
    expect(a.stand).toEqual({ x: 2, y: 2 });
    expect(a.facing).toBe('up');
  });

  it('多格宽的书架：可以站在任意一格前面', () => {
    const room = Grid.fromRows(['####', '....', '....']);
    const a = findApproach(room, { x: 3, y: 2 }, { x: 0, y: 0, width: 4, height: 1 })!;
    expect(a.stand.y).toBe(1);
    expect(a.facing).toBe('up');
    expect(a.path).toHaveLength(1);
  });

  it('已经站在交互位置时路径为空', () => {
    const a = findApproach(g, { x: 2, y: 2 }, { x: 2, y: 1, width: 1, height: 1 })!;
    expect(a.path).toEqual([]);
  });

  it('被完全围住时返回 null', () => {
    const boxed = Grid.fromRows(['.....', '.###.', '.#.#.', '.###.', '.....']);
    expect(findApproach(boxed, { x: 0, y: 0 }, { x: 2, y: 2, width: 1, height: 1 })).toBeNull();
  });

  it('交互距离 2 时可隔着一格交互', () => {
    const spots = interactionSpots({ x: 2, y: 2, width: 1, height: 1 }, 2);
    expect(spots).toContainEqual({ spot: { x: 2, y: 4 }, facing: 'up' });
    expect(spots).toHaveLength(8);
  });
});

describe('nearestWalkable', () => {
  it('障碍格返回最近的可行走格', () => {
    const p = nearestWalkable(g, { x: 2, y: 1 })!;
    expect(g.isWalkable(p.x, p.y)).toBe(true);
    expect(Math.abs(p.x - 2) + Math.abs(p.y - 1)).toBe(1);
  });
});
