import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadContent } from '../src/data/content-build';
import { parseWorld, validateReferences, WorldDataError, type RawWorld } from '../src/data/world';
import { readWorldFromDisk } from '../src/data/world-fs';

const root = join(__dirname, '..');

function fixture(): RawWorld {
  return structuredClone(readWorldFromDisk(root).raw);
}

describe('仓库中的世界配置', () => {
  it('通过 Schema 与引用校验', () => {
    const { raw, maps } = readWorldFromDisk(root);
    const world = parseWorld(raw);
    const content = loadContent(join(root, 'content'));
    expect(validateReferences(world, { maps, content: content.published })).toEqual([]);
  });

  it('门是双向的：小镇 ↔ 图书馆', () => {
    const world = parseWorld(fixture());
    const targets = world.entities
      .filter((e) => e.action.type === 'changeScene')
      .map((e) => `${e.scene}->${(e.action as { scene: string }).scene}`);
    expect(targets).toContain('town->library');
    expect(targets).toContain('library->town');
  });
});

describe('配置错误能被发现', () => {
  it('未知行为类型被 Schema 拒绝（不能从配置执行任意代码）', () => {
    const raw = fixture();
    (raw.entities['world/entities/town.json'] as { action: unknown }[])[0]!.action = { type: 'eval', code: 'alert(1)' };
    expect(() => parseWorld(raw)).toThrow(WorldDataError);
  });

  it('引用不存在的场景/出生点/对话/内容', () => {
    const raw = fixture();
    const town = raw.entities['world/entities/town.json'] as { action: unknown }[];
    town[0]!.action = { type: 'changeScene', scene: 'nowhere', spawn: 'x' };
    town[1]!.action = { type: 'dialogue', dialogue: 'missing' };
    town[2]!.action = { type: 'openContent', content: 'ghost' };
    const { maps } = readWorldFromDisk(root);
    const problems = validateReferences(parseWorld(raw), { maps, content: loadContent(join(root, 'content')).published });
    expect(problems.join('\n')).toMatch(/nowhere/);
    expect(problems.join('\n')).toMatch(/missing/);
    expect(problems.join('\n')).toMatch(/ghost/);
  });

  it('出生点放在墙里会被发现', () => {
    const raw = fixture();
    (raw.scenes['world/scenes/town.json'] as { spawns: Record<string, unknown> }).spawns.start = { x: 0, y: 0, facing: 'down' };
    const { maps } = readWorldFromDisk(root);
    expect(validateReferences(parseWorld(raw), { maps }).join('\n')).toMatch(/不可站立/);
  });

  it('重复的实体 ID 被发现', () => {
    const raw = fixture();
    const town = raw.entities['world/entities/town.json'] as { id: string }[];
    town[1]!.id = town[0]!.id;
    expect(() => parseWorld(raw)).toThrow(/重复/);
  });
});
