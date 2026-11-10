// 浏览器端：通过 Vite 在构建时打包 world/ 下的配置（配置很小，直接内联）；地图按需加载
import { parseWorld, type World } from './world';

export function loadWorld(): World {
  return parseWorld({
    config: import.meta.glob('/world/world.json', { eager: true, import: 'default' }),
    assets: import.meta.glob('/world/assets.json', { eager: true, import: 'default' }),
    scenes: import.meta.glob('/world/scenes/*.json', { eager: true, import: 'default' }),
    entities: import.meta.glob('/world/entities/*.json', { eager: true, import: 'default' }),
    dialogues: import.meta.glob('/world/dialogues/*.json', { eager: true, import: 'default' }),
  });
}

/** 地图 ID → 地图 JSON 的网址（进入场景时才下载） */
const mapUrls = import.meta.glob('/world/maps/*.json', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

export function mapUrl(mapId: string): string | undefined {
  return mapUrls[`/world/maps/${mapId}.json`];
}
