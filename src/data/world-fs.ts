// Node 端读取 world/ 目录（校验脚本与构建插件使用）
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Grid } from '../game/grid';
import type { RawFiles, RawWorld } from './world';

function readJsonDir(dir: string, rel: string): RawFiles {
  const out: RawFiles = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    out[`${rel}/${f}`] = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  }
  return out;
}

export function readWorldFromDisk(root: string): { raw: RawWorld; maps: Map<string, Grid> } {
  const w = join(root, 'world');
  const readOne = (file: string): RawFiles => ({ [`world/${file}`]: JSON.parse(readFileSync(join(w, file), 'utf8')) });
  const raw: RawWorld = {
    config: readOne('world.json'),
    assets: readOne('assets.json'),
    scenes: readJsonDir(join(w, 'scenes'), 'world/scenes'),
    entities: readJsonDir(join(w, 'entities'), 'world/entities'),
    dialogues: readJsonDir(join(w, 'dialogues'), 'world/dialogues'),
  };
  const maps = new Map<string, Grid>();
  for (const [path, json] of Object.entries(readJsonDir(join(w, 'maps'), 'world/maps'))) {
    maps.set(basename(path, '.json'), Grid.fromTiled(json));
  }
  return { raw, maps };
}
