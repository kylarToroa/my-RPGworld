// 由 ASCII 草图生成标准 Tiled JSON 地图（world/maps/*.json）。
// ⚠️ 本脚本产出的是 16px 占位地图，已被 48px 的 build-m2-maps.mjs 取代；
//    运行会覆盖正式地图，必须显式加 --force。
// 用法：npm run gen:maps -- --force
import { writeFileSync } from 'node:fs';
import { TILE_NAMES } from './generate-placeholder-art.mjs';

if (!process.argv.includes('--force')) {
  console.error('✗ world/maps 下现在是 48px 正式地图（scripts/build-m2-maps.mjs 生成）。');
  console.error('  重新生成占位地图请用：node scripts/build-m2-maps.mjs（不要用本脚本）');
  console.error('  确实要覆盖为 16px 占位地图，请显式加参数：npm run gen:maps -- --force');
  process.exit(1);
}

const gid = (name) => {
  const i = TILE_NAMES.indexOf(name);
  if (i < 0) throw new Error(`unknown tile ${name}`);
  return i + 1;
};

// 字符 → [底层图块, 装饰层图块 | null, 是否阻挡]
const LEGEND = {
  '.': ['grass', null, false],
  ',': ['flowers', null, false],
  '=': ['path', null, false],
  '~': ['water', null, true],
  T: ['grass', 'tree', true],
  B: ['grass', 'bush', true],
  R: ['grass', 'roof', true],
  E: ['grass', 'roof_edge', true],
  W: ['grass', 'wall_ext', true],
  w: ['grass', 'window', true],
  D: ['path', 'door', false],
  S: ['grass', 'sign', true],
  F: ['grass', 'fence', true],
  '_': ['floor', null, false],
  '#': ['floor', 'wall_int', true],
  H: ['floor', 'bookshelf', true],
  M: ['floor', 'mat', false],
  t: ['floor', 'table', true],
  p: ['floor', 'plant', true],
};

const MAPS = {
  town: [
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    'T..........,...............T',
    'T...,.....RRRRRRRR.....T...T',
    'T.........RRRRRRRR.........T',
    'T..TT.....EEEEEEEE....,....T',
    'T..T......WwWWDWwW.........T',
    'T.........,...=....B.......T',
    'T.............=............T',
    'T....S.=======.===.....~~~.T',
    'T......=......=..=....~~~~~T',
    'T..,...=......=..=....~~~~.T',
    'T......=......=..=.....~~..T',
    'T......===========.........T',
    'T.............=......,.....T',
    'T..B..........=............T',
    'T.............=.......TT...T',
    'T...,.........=........T...T',
    'T.............=............T',
    'T.......,.....=......,.....T',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  library: [
    '##############',
    '#HHHH#__#HHHH#',
    '#____________#',
    '#_p________p_#',
    '#____________#',
    '#___tt__tt___#',
    '#____________#',
    '#____________#',
    '######MM######',
  ],
};

function buildTiled(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const ground = [], decor = [], collision = [];
  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`row ${y} has width ${row.length}, expected ${width}`);
    for (const ch of row) {
      const entry = LEGEND[ch];
      if (!entry) throw new Error(`unknown map char "${ch}"`);
      const [g, d, blocked] = entry;
      ground.push(gid(g));
      decor.push(d ? gid(d) : 0);
      collision.push(blocked ? gid('roof') : 0);
    }
  });
  const layer = (id, name, data, visible = true) => ({
    id, name, type: 'tilelayer', width, height, x: 0, y: 0, opacity: 1, visible, data,
  });
  const columns = 8;
  return {
    type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
    infinite: false, width, height, tilewidth: 16, tileheight: 16, nextlayerid: 4, nextobjectid: 1,
    layers: [
      layer(1, 'ground', ground),
      layer(2, 'decor', decor),
      // collision 层：任何非空格子都不可通行，游戏中不显示
      layer(3, 'collision', collision, false),
    ],
    tilesets: [{
      firstgid: 1, name: 'placeholder', image: '../../public/assets/tilesets/placeholder.png',
      imagewidth: 128, imageheight: 48, columns, tilecount: TILE_NAMES.length,
      tilewidth: 16, tileheight: 16, margin: 0, spacing: 0,
    }],
  };
}

for (const [id, rows] of Object.entries(MAPS)) {
  const path = `world/maps/${id}.json`;
  writeFileSync(path, JSON.stringify(buildTiled(rows)) + '\n');
  console.log('wrote', path);
}
