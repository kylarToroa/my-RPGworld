// 校验全部世界配置与内容：npm run validate
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '../src/data/content-build';
import { parseWorld, validateReferences, WorldDataError } from '../src/data/world';
import { readWorldFromDisk } from '../src/data/world-fs';

const root = process.cwd();
const problems: string[] = [];

const content = loadContent(join(root, 'content'));
problems.push(...content.problems);

try {
  const { raw, maps } = readWorldFromDisk(root);
  const world = parseWorld(raw);
  problems.push(...validateReferences(world, { maps, content: content.published }));
  for (const [key, url] of Object.entries(world.assets.tilesets)) {
    if (!existsSync(join(root, 'public', url))) problems.push(`assets.json: 图块集 ${key} 文件 public/${url} 不存在`);
  }
  for (const [key, s] of Object.entries(world.assets.sprites)) {
    if (!existsSync(join(root, 'public', s.url))) problems.push(`assets.json: 精灵 ${key} 文件 public/${s.url} 不存在`);
  }
  console.log(`场景 ${world.scenes.size} 个，实体 ${world.entities.length} 个，对话 ${world.dialogues.size} 个，地图 ${maps.size} 张`);
} catch (err) {
  if (err instanceof WorldDataError) problems.push(...err.problems);
  else problems.push(err instanceof Error ? err.message : String(err));
}
console.log(`内容 ${content.all.length} 篇（已发布 ${content.published.length} 篇）`);

if (problems.length) {
  console.error(`\n✗ 发现 ${problems.length} 处问题：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('✓ 配置与内容校验通过');
