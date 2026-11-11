// M2 森林世界地图生成器：用 ASCII 草图生成标准 Tiled JSON（world/maps/*.json）。
// 图块全部为 48×48。生成后可直接用 Tiled 打开继续手工调整。
// 用法：npm run gen:m2maps
//
// 约定：
//   - 图层顺序固定为 ground / decor / decor2 / above / collision
//   - collision 图层任何非空格子都不可通行；游戏内不显示
//   - above 图层画在角色上方（树冠、屋檐），用于「玩家从下面走过」的遮挡
import { writeFileSync } from 'node:fs';

const T = 48;

// ---------- 图块集清单（firstgid 按顺序累加；改动顺序会让旧地图错位） ----------
const TILESETS = [
  { name: 'outside_a4', image: '../../public/assets/tilesets/outside_a4.png', w: 768, h: 720, columns: 16 },
  { name: 'outside_a5', image: '../../public/assets/tilesets/outside_a5.png', w: 384, h: 768, columns: 8 },
  { name: 'outside_b', image: '../../public/assets/tilesets/outside_b.png', w: 768, h: 768, columns: 16 },
  { name: 'inside_a4', image: '../../public/assets/tilesets/inside_a4.png', w: 768, h: 720, columns: 16 },
  { name: 'inside_a5', image: '../../public/assets/tilesets/inside_a5.png', w: 384, h: 768, columns: 8 },
  { name: 'inside_b', image: '../../public/assets/tilesets/inside_b.png', w: 768, h: 768, columns: 16 },
  { name: 'inside_c', image: '../../public/assets/tilesets/inside_c.png', w: 768, h: 768, columns: 16 },
  { name: 'roof_wood_a3', image: '../../public/assets/tilesets/roof_wood_a3.png', w: 96, h: 192, columns: 2 },
  { name: 'ground_grass', image: '../../public/assets/tilesets/ground_grass.png', w: 480, h: 48, columns: 10 },
];

let cursor = 1;
for (const ts of TILESETS) {
  ts.firstgid = cursor;
  ts.tilecount = (ts.w / T) * (ts.h / T);
  cursor += ts.tilecount;
}

/** 图块坐标 → 全局 GID（Tiled 的 gid 从 1 开始） */
function gid(name, col, row) {
  const ts = TILESETS.find((t) => t.name === name);
  if (!ts) throw new Error(`未知图块集 ${name}`);
  const cols = ts.columns;
  const rows = ts.h / T;
  if (col < 0 || row < 0 || col >= cols || row >= rows) {
    throw new Error(`${name} 越界：(${col},${row})，范围 ${cols}×${rows}`);
  }
  return ts.firstgid + row * cols + col;
}

// ---------- 常用图块速查 ----------
const TILE = {
  grass: gid('outside_a5', 4, 2),
  dirt: gid('outside_a5', 2, 2),
  stoneWall: gid('outside_a4', 1, 1),
  woodWall: gid('inside_a4', 1, 1),
  roofPlank: gid('roof_wood_a3', 0, 0),
  roofEave: gid('roof_wood_a3', 0, 2),
  door: gid('outside_b', 0, 14),
  window: gid('outside_b', 0, 12),
  bush: gid('outside_b', 8, 3),
  fern: gid('outside_b', 9, 3),
  conifer: gid('outside_b', 13, 3),
  flower: gid('outside_b', 8, 4),
  violet: gid('outside_b', 9, 4),
  stump: gid('outside_b', 12, 3),
  log: gid('outside_b', 12, 4),
  rock: gid('outside_b', 15, 3),
  inFloor: gid('inside_a5', 2, 2),
  inRug: gid('inside_a5', 3, 10),
  shelf: gid('inside_b', 12, 3),
  table: gid('inside_b', 4, 14),
  bed: gid('inside_b', 8, 6),
  inDoor: gid('outside_b', 2, 14),
  inWindow: gid('inside_b', 0, 6),
};

// 密林树冠 2×2 块：按格子奇偶取对应角，铺满即成连续树冠
const FOREST = { tileset: 'outside_b', col: 10, row: 6 };

/** 草地：10 个由原图旋转得到的变体，按格子坐标散开，避免整屏重复的斑点 */
function grassAt(x, y) {
  return gid('ground_grass', (x * 73 + y * 151) % 10, 0);
}

// ---------- 图例：字符 → 地面 / 装饰（可两层）/ 是否阻挡 ----------
const LEGEND = {
  '.': { grass: true, free: true },
  '=': { ground: TILE.dirt, free: true },
  T: { ground: TILE.grass, forest: true, block: true },
  U: { ground: TILE.grass, bigTree: true, block: true },
  c: { ground: TILE.grass, decor: [TILE.conifer], block: true },
  b: { ground: TILE.grass, decor: [TILE.bush], block: true },
  e: { ground: TILE.grass, decor: [TILE.fern], free: true },
  f: { ground: TILE.grass, decor: [TILE.flower], free: true },
  p: { ground: TILE.grass, decor: [TILE.violet], free: true },
  k: { ground: TILE.grass, decor: [TILE.stump], block: true },
  g: { ground: TILE.grass, decor: [TILE.log], block: true },
  r: { ground: TILE.grass, decor: [TILE.rock], block: true },
  R: { ground: TILE.grass, decor: [TILE.roofPlank], block: true },
  E: { ground: TILE.grass, decor: [TILE.roofEave], block: true },
  W: { ground: TILE.grass, decor: [TILE.stoneWall], block: true },
  w: { ground: TILE.grass, decor: [TILE.stoneWall, TILE.window], block: true },
  D: { ground: TILE.grass, decor: [TILE.stoneWall, TILE.door], free: true },
  '#': { ground: TILE.inFloor, decor: [TILE.woodWall], block: true },
  _: { ground: TILE.inFloor, free: true },
  M: { ground: TILE.inRug, free: true },
  H: { ground: TILE.inFloor, decor: [TILE.shelf], block: true },
  t: { ground: TILE.inFloor, decor: [TILE.table], block: true },
  d: { ground: TILE.inFloor, decor: [TILE.bed], block: true },
  x: { ground: TILE.inFloor, decor: [TILE.inDoor], free: true },
};

// ---------- 地图定义 ----------
// stamps：多格贴片（大床、以后的树屋）。在 ASCII 铺完之后覆盖指定格子。
const MAPS = {
  // 第一张样板：小片密林 + 森林木屋（暂代巨型树屋）+ 通往室内的门
  forest: {
    rows: [
      'TTTTTTTTTTTTTTTTTTTTTTTTTT',
      'TTTTTTTTTTTTTTTTTTTTTTTTTT',
      'TT.......RRRRRRR........TT',
      'TT.......RRRRRRR........TT',
      'TT........WwWwW.........TT',
      'TT........WWDWW.........TT',
      'TT..........=...........TT',
      'TT..b.......=......r....TT',
      'TT..........=...........TT',
      'TT.....k....=...........TT',
      'TT..p...k...=....e......TT',
      'TT..c.......=......b....TT',
      'TTTTTTTTTTTTTTTTTTTTTTTTTT',
      'TTTTTTTTTTTTTTTTTTTTTTTTTT',
    ],
    stamps: [],
  },

  // 森林木屋室内
  cabin: {
    rows: [
      '################',
      '#______________#',
      '#_HHH_____HH___#',
      '#______________#',
      '#______tt______#',
      '#______________#',
      '#______________#',
      '#______________#',
      '#______________#',
      '#______________#',
      '#######xx#######',
    ],
    stamps: [
      // 1×2 的床（Inside_B 的床是竖着两格）
      { at: [1, 5], size: [1, 2], tileset: 'inside_b', col: 8, row: 5, block: true },
    ],
  },

  // M1 保留场景：小镇（布局照旧，换成 48px 美术）
  town: {
    rows: [
      'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
      'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
      'TT........................TT',
      'TT....RRRRRRRR............TT',
      'TT....RRRRRRRR............TT',
      'TT....WwWWDWwW............TT',
      'TT........=...............TT',
      'TT..c.....=...............TT',
      'TT........=...............TT',
      'TT..b.....=......f........TT',
      'TT........=...............TT',
      'TT........=...............TT',
      'TT....===============.....TT',
      'TT........=...............TT',
      'TT........=...............TT',
      'TT........=...............TT',
      'TT........=...............TT',
      'TT........=...............TT',
      'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
      'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
    ],
    stamps: [],
  },

  // M1 保留场景：图书馆
  library: {
    rows: [
      '##############',
      '#HHHH#__#HHHH#',
      '#____________#',
      '#____________#',
      '#____________#',
      '#___tt__tt___#',
      '#____________#',
      '#____________#',
      '######xx######',
    ],
    stamps: [],
  },
};

// ---------- 生成 ----------
function buildMap(id, def) {
  const rows = def.rows;
  const height = rows.length;
  const width = rows[0].length;
  const ground = [];
  const decor = [];
  const decor2 = [];
  const collision = [];

  rows.forEach((row, y) => {
    if (row.length !== width) throw new Error(`${id} 第 ${y} 行宽度 ${row.length}，应为 ${width}`);
    for (let x = 0; x < width; x++) {
      const entry = LEGEND[row[x]];
      if (!entry) throw new Error(`${id} (${x},${y}) 出现未知字符 "${row[x]}"`);
      ground.push(entry.grass || entry.ground === TILE.grass ? grassAt(x, y) : entry.ground);
      if (entry.forest) {
        decor.push(gid(FOREST.tileset, FOREST.col + (x % 2), FOREST.row + (y % 2)));
        decor2.push(0);
      } else if (entry.bigTree) {
        decor.push(gid('outside_b', 8 + (x % 2), 6 + (y % 2)));
        decor2.push(0);
      } else {
        decor.push(entry.decor?.[0] ?? 0);
        decor2.push(entry.decor?.[1] ?? 0);
      }
      collision.push(entry.block ? TILE.stoneWall : 0);
    }
  });

  // 多格贴片覆盖（大床等）：贴片内每格独立取图，并按需设为阻挡
  for (const stamp of def.stamps ?? []) {
    const [sx, sy] = stamp.at;
    const size = stamp.size ?? [2, 2];
    for (let dy = 0; dy < size[1]; dy++) {
      for (let dx = 0; dx < size[0]; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x >= width || y >= height) throw new Error(`${id} 贴片越界：(${x},${y})`);
        const i = y * width + x;
        decor[i] = gid(stamp.tileset, stamp.col + dx, stamp.row + dy);
        decor2[i] = 0;
        collision[i] = stamp.block ? TILE.stoneWall : 0;
      }
    }
  }

  const layer = (lid, name, data, visible = true) => ({
    id: lid, name, type: 'tilelayer', width, height, x: 0, y: 0, opacity: 1, visible, data,
  });

  return {
    type: 'map', version: '1.10', tiledversion: '1.11.0', orientation: 'orthogonal', renderorder: 'right-down',
    infinite: false, width, height, tilewidth: T, tileheight: T, nextlayerid: 6, nextobjectid: 1,
    layers: [
      layer(1, 'ground', ground),
      layer(2, 'decor', decor),
      layer(3, 'decor2', decor2),
      layer(4, 'above', new Array(width * height).fill(0)),
      layer(5, 'collision', collision, false),
    ],
    tilesets: TILESETS.map((ts) => ({
      firstgid: ts.firstgid, name: ts.name, image: ts.image,
      imagewidth: ts.w, imageheight: ts.h, columns: ts.columns, tilecount: ts.tilecount,
      tilewidth: T, tileheight: T, margin: 0, spacing: 0,
    })),
  };
}

for (const [id, def] of Object.entries(MAPS)) {
  const path = `world/maps/${id}.json`;
  writeFileSync(path, `${JSON.stringify(buildMap(id, def))}\n`);
  console.log(`wrote ${path} (${def.rows[0].length}×${def.rows.length})`);
}
