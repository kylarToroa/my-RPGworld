// 世界配置的解析与引用校验。浏览器和 Node 校验脚本共用这份逻辑。
import { z } from 'zod';
import {
  type Action,
  AssetManifestSchema,
  type AssetManifest,
  type ContentMeta,
  type Dialogue,
  DialogueSchema,
  type Entity,
  EntityFileSchema,
  type SceneConfig,
  SceneSchema,
  type WorldConfig,
  WorldConfigSchema,
} from './schemas';
import { Grid, type Point } from '../game/grid';
import { footprintTiles } from '../game/pathfinding';

/** 原始文件：路径 → JSON 内容 */
export type RawFiles = Record<string, unknown>;

export interface RawWorld {
  config: RawFiles;
  assets: RawFiles;
  scenes: RawFiles;
  entities: RawFiles;
  dialogues: RawFiles;
}

export interface World {
  config: WorldConfig;
  assets: AssetManifest;
  scenes: Map<string, SceneConfig>;
  entities: Entity[];
  dialogues: Map<string, Dialogue>;
}

export class WorldDataError extends Error {
  constructor(readonly problems: string[]) {
    super(`世界配置有 ${problems.length} 处问题：\n- ${problems.join('\n- ')}`);
  }
}

function parseEach<T>(files: RawFiles, schema: z.ZodType<T>, problems: string[]): T[] {
  const out: T[] = [];
  for (const [path, data] of Object.entries(files)) {
    const r = schema.safeParse(data);
    if (r.success) out.push(r.data);
    else for (const issue of r.error.issues) problems.push(`${path}: ${issue.path.join('.') || '(根)'} ${issue.message}`);
  }
  return out;
}

function single<T>(files: RawFiles, schema: z.ZodType<T>, name: string, problems: string[]): T | undefined {
  const parsed = parseEach(files, schema, problems);
  if (Object.keys(files).length !== 1) problems.push(`需要且只需要一个 ${name}`);
  return parsed[0];
}

/** 解析并做 Schema 校验；任何问题都会抛出 WorldDataError */
export function parseWorld(raw: RawWorld): World {
  const problems: string[] = [];
  const config = single(raw.config, WorldConfigSchema, 'world.json', problems);
  const assets = single(raw.assets, AssetManifestSchema, 'assets.json', problems);
  const scenes = parseEach(raw.scenes, SceneSchema, problems);
  const entities = parseEach(raw.entities, EntityFileSchema, problems).flat();
  const dialogues = parseEach(raw.dialogues, DialogueSchema, problems);

  const uniq = <T extends { id: string }>(items: T[], what: string) => {
    const map = new Map<string, T>();
    for (const it of items) {
      if (map.has(it.id)) problems.push(`${what} ID 重复：${it.id}`);
      map.set(it.id, it);
    }
    return map;
  };
  const sceneMap = uniq(scenes, '场景');
  uniq(entities, '实体');
  const dialogueMap = uniq(dialogues, '对话');

  if (problems.length || !config || !assets) throw new WorldDataError(problems);
  return { config, assets, scenes: sceneMap, entities, dialogues: dialogueMap };
}

export interface ValidationContext {
  /** 地图 ID → 通行网格（Node 校验时提供；浏览器端可省略） */
  maps?: Map<string, Grid>;
  /** 已发布的内容；提供时会检查内容引用 */
  content?: ContentMeta[];
}

/** 跨文件引用检查：场景、出生点、对话、内容、精灵是否都存在且合法 */
export function validateReferences(world: World, ctx: ValidationContext = {}): string[] {
  const problems: string[] = [];
  const { scenes, dialogues, entities, assets, config } = world;
  const contentIds = ctx.content ? new Set(ctx.content.map((c) => c.id)) : null;
  const categories = ctx.content ? new Set(ctx.content.map((c) => c.category)) : null;

  const checkSpawn = (sceneId: string, spawnId: string, where: string) => {
    const scene = scenes.get(sceneId);
    if (!scene) return problems.push(`${where}: 场景 "${sceneId}" 不存在`);
    if (!scene.spawns[spawnId]) problems.push(`${where}: 场景 "${sceneId}" 没有出生点 "${spawnId}"`);
  };

  checkSpawn(config.startScene, config.startSpawn, 'world.json');

  for (const scene of scenes.values()) {
    if (!scene.spawns[scene.defaultSpawn]) problems.push(`场景 ${scene.id}: defaultSpawn "${scene.defaultSpawn}" 不存在`);
    const grid = ctx.maps?.get(scene.map);
    if (ctx.maps && !grid) problems.push(`场景 ${scene.id}: 地图文件 world/maps/${scene.map}.json 不存在`);
    if (grid) {
      const blocked = sceneGrid(grid, entities.filter((e) => e.scene === scene.id));
      for (const [id, s] of Object.entries(scene.spawns)) {
        if (blocked.isBlocked(s.x, s.y)) problems.push(`场景 ${scene.id}: 出生点 "${id}" (${s.x},${s.y}) 不可站立`);
      }
    }
  }

  const checkAction = (a: Action, where: string): void => {
    switch (a.type) {
      case 'dialogue':
        if (!dialogues.has(a.dialogue)) problems.push(`${where}: 对话 "${a.dialogue}" 不存在`);
        break;
      case 'openContent':
        if (contentIds && !contentIds.has(a.content)) problems.push(`${where}: 内容 "${a.content}" 不存在或未发布`);
        break;
      case 'openCollection':
        if (!a.category && !a.tag) problems.push(`${where}: openCollection 需要 category 或 tag`);
        if (categories && a.category && !categories.has(a.category))
          problems.push(`${where}: 分类 "${a.category}" 目前没有已发布内容（书架会显示为空）`);
        break;
      case 'changeScene':
        checkSpawn(a.scene, a.spawn, where);
        break;
      case 'openURL':
        break;
      case 'openMenu':
        a.options.forEach((o, i) => checkAction(o.action, `${where} > 选项${i + 1}`));
        break;
      case 'sequence':
        a.actions.forEach((x, i) => checkAction(x, `${where} > 第${i + 1}步`));
        break;
    }
  };

  for (const e of entities) {
    const where = `实体 ${e.id}`;
    const scene = scenes.get(e.scene);
    if (!scene) problems.push(`${where}: 所属场景 "${e.scene}" 不存在`);
    if (e.sprite && !assets.sprites[e.sprite]) problems.push(`${where}: 精灵 "${e.sprite}" 未在 assets.json 中登记`);
    const grid = scene && ctx.maps?.get(scene.map);
    if (grid && !footprintTiles(e).every((t) => grid.inBounds(t.x, t.y))) problems.push(`${where}: 超出地图范围`);
    checkAction(e.action, where);
  }

  for (const d of dialogues.values()) {
    if (!d.nodes[d.start]) problems.push(`对话 ${d.id}: 起始节点 "${d.start}" 不存在`);
    for (const [nid, node] of Object.entries(d.nodes)) {
      const where = `对话 ${d.id}.${nid}`;
      if (node.next && !d.nodes[node.next]) problems.push(`${where}: next "${node.next}" 不存在`);
      node.choices?.forEach((c, i) => {
        if (c.next && !d.nodes[c.next]) problems.push(`${where} 选项${i + 1}: next "${c.next}" 不存在`);
        if (c.action) checkAction(c.action, `${where} 选项${i + 1}`);
      });
    }
  }
  return problems;
}

/** 地图网格叠加该场景中实体的阻挡格 */
export function sceneGrid(map: Grid, sceneEntities: Entity[]): Grid {
  const solid: Point[] = sceneEntities.filter((e) => e.solid).flatMap((e) => footprintTiles(e));
  return map.withBlocked(solid);
}
