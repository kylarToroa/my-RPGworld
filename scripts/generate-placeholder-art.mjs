// 生成占位像素美术（原创、程序绘制）。正式美术到位后，直接替换 public/assets 下的同名 PNG 即可。
// 用法：npm run gen:art
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname } from 'node:path';

// ---------- 最小 PNG 编码器 ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const { w, h, px } = img;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 画布工具 ----------
function canvas(w, h) {
  return { w, h, px: Buffer.alloc(w * h * 4) };
}
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
function set(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h || !color) return;
  const [r, g, b, a] = hex(color);
  const i = (y * img.w + x) * 4;
  img.px[i] = r;
  img.px[i + 1] = g;
  img.px[i + 2] = b;
  img.px[i + 3] = a;
}
function rect(img, x, y, w, h, color) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(img, x + i, y + j, color);
}
// 用字符图案绘制，palette 把字符映射到颜色，'.' 为透明
function pattern(img, ox, oy, rows, palette) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => set(img, ox + x, oy + y, palette[ch])));
}
// 确定性伪随机，保证每次生成结果一致
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

// ---------- 图块集 ----------
const T = 16;
const COLS = 8;
// 顺序即图块编号（Tiled 中 gid = 编号 + 1），generate-maps.mjs 依赖此顺序
export const TILE_NAMES = [
  'grass', 'flowers', 'path', 'water', 'tree', 'bush', 'wall_ext', 'roof',
  'door', 'window', 'floor', 'wall_int', 'bookshelf', 'mat', 'table', 'sign',
  'fence', 'counter', 'plant', 'roof_edge',
];

const C = {
  grass: '#5fa64a', grass2: '#6fb856', grassDark: '#4c8f3c',
  path: '#c9a66b', path2: '#b8955c',
  water: '#3f7fc4', water2: '#6aa4e0',
  trunk: '#6b4423', leaf: '#2f7a35', leaf2: '#3f9445', leafDark: '#24602a',
  wall: '#d9c7a3', wall2: '#bfa982', roof: '#a84a3c', roof2: '#8c3a2f', roofHi: '#c4604f',
  door: '#7a4a24', door2: '#5c3519', knob: '#f0c040',
  glass: '#9fd3f0', frame: '#5c3519',
  floor: '#b9824a', floor2: '#a6713d',
  wallInt: '#e8dcc0', wallInt2: '#cbbd9c',
  shelf: '#6b4423', shelf2: '#4f3018', books: ['#c0392b', '#2e86c1', '#27ae60', '#f1c40f', '#8e44ad'],
  mat: '#8c2f39', mat2: '#b84a55',
  table: '#8a5a2b', table2: '#6e4520',
  white: '#ffffff', black: '#1b1b1b',
};

function drawGrass(img, ox, oy, seed, flowers = false) {
  rect(img, ox, oy, T, T, C.grass);
  const r = rng(seed);
  for (let i = 0; i < 10; i++) set(img, ox + Math.floor(r() * T), oy + Math.floor(r() * T), r() > 0.5 ? C.grass2 : C.grassDark);
  if (flowers) {
    const fl = ['#ffffff', '#f4d03f', '#e74c8c'];
    for (let i = 0; i < 4; i++) {
      const x = ox + 2 + Math.floor(r() * 12), y = oy + 2 + Math.floor(r() * 12);
      set(img, x, y, fl[i % 3]);
      set(img, x + 1, y, C.grassDark);
    }
  }
}

const tileDrawers = {
  grass: (img, x, y) => drawGrass(img, x, y, 1),
  flowers: (img, x, y) => drawGrass(img, x, y, 2, true),
  path: (img, x, y) => {
    rect(img, x, y, T, T, C.path);
    const r = rng(3);
    for (let i = 0; i < 12; i++) set(img, x + Math.floor(r() * T), y + Math.floor(r() * T), C.path2);
  },
  water: (img, x, y) => {
    rect(img, x, y, T, T, C.water);
    for (const [wx, wy] of [[2, 4], [9, 9], [4, 13]]) rect(img, x + wx, y + wy, 4, 1, C.water2);
  },
  tree: (img, x, y) => {
    drawGrass(img, x, y, 4);
    pattern(img, x, y, [
      '.....bbbbbb.....',
      '...bbaaaaaabb...',
      '..baaaaacaaaab..',
      '.baacaaaaaaaaab.',
      '.baaaaaaaacaaab.',
      'baaaaaaaaaaaaaab',
      'baaacaaaaaaaaaab',
      'baaaaaaaaacaaaab',
      '.baaaaaaaaaaaab.',
      '.bbaaaacaaaaabb.',
      '..bbbaaaaaabbb..',
      '....bbbttbbb....',
      '.......tt.......',
      '.......tt.......',
      '......tttt......',
      '................',
    ], { a: C.leaf, b: C.leafDark, c: C.leaf2, t: C.trunk });
  },
  bush: (img, x, y) => {
    drawGrass(img, x, y, 5);
    pattern(img, x, y + 4, [
      '....bbbbbbbb....',
      '..bbaaaaaaaabb..',
      '.baaacaaaacaaab.',
      'baaaaaaaaaaaaaab',
      'baacaaaaaaacaaab',
      'baaaaaaaaaaaaaab',
      '.baaaaacaaaaaab.',
      '..bbbbbbbbbbbb..',
    ], { a: C.leaf2, b: C.leafDark, c: C.leaf });
  },
  wall_ext: (img, x, y) => {
    rect(img, x, y, T, T, C.wall);
    for (let j = 3; j < T; j += 4) rect(img, x, y + j, T, 1, C.wall2);
  },
  roof: (img, x, y) => {
    rect(img, x, y, T, T, C.roof);
    for (let j = 0; j < T; j += 4) {
      rect(img, x, y + j, T, 1, C.roof2);
      for (let i = (j / 4) % 2 ? 0 : 4; i < T; i += 8) set(img, x + i, y + j + 2, C.roof2);
    }
  },
  roof_edge: (img, x, y) => {
    rect(img, x, y, T, 10, C.roof);
    rect(img, x, y + 8, T, 2, C.roof2);
    rect(img, x, y + 10, T, 6, C.wall);
    rect(img, x, y + 1, T, 1, C.roofHi);
  },
  door: (img, x, y) => {
    rect(img, x, y, T, T, C.wall);
    rect(img, x + 3, y + 2, 10, 14, C.door2);
    rect(img, x + 4, y + 3, 8, 13, C.door);
    rect(img, x + 7, y + 3, 1, 13, C.door2);
    set(img, x + 10, y + 9, C.knob);
  },
  window: (img, x, y) => {
    tileDrawers.wall_ext(img, x, y);
    rect(img, x + 3, y + 4, 10, 8, C.frame);
    rect(img, x + 4, y + 5, 8, 6, C.glass);
    rect(img, x + 7, y + 5, 1, 6, C.frame);
    rect(img, x + 4, y + 7, 8, 1, C.frame);
  },
  floor: (img, x, y) => {
    rect(img, x, y, T, T, C.floor);
    for (let j = 0; j < T; j += 4) rect(img, x, y + j, T, 1, C.floor2);
    set(img, x + 5, y + 1, C.floor2);
    set(img, x + 12, y + 9, C.floor2);
  },
  wall_int: (img, x, y) => {
    rect(img, x, y, T, T, C.wallInt);
    rect(img, x, y + 12, T, 4, C.wallInt2);
    rect(img, x, y + 12, T, 1, C.shelf2);
  },
  bookshelf: (img, x, y) => {
    rect(img, x, y, T, T, C.shelf2);
    rect(img, x + 1, y + 1, 14, 14, C.shelf);
    const r = rng(7 + x);
    for (const sy of [2, 7, 12]) {
      rect(img, x + 1, y + sy + 3, 14, 1, C.shelf2);
      for (let i = 2; i < 14; i += 2) {
        const hgt = 2 + Math.floor(r() * 2);
        rect(img, x + i, y + sy + 3 - hgt, 1 + (r() > 0.6 ? 1 : 0), hgt, C.books[Math.floor(r() * C.books.length)]);
      }
    }
  },
  mat: (img, x, y) => {
    tileDrawers.floor(img, x, y);
    rect(img, x + 1, y + 3, 14, 10, C.mat);
    rect(img, x + 2, y + 4, 12, 8, C.mat2);
    rect(img, x + 3, y + 5, 10, 6, C.mat);
  },
  table: (img, x, y) => {
    tileDrawers.floor(img, x, y);
    rect(img, x + 1, y + 3, 14, 8, C.table);
    rect(img, x + 1, y + 10, 14, 2, C.table2);
    rect(img, x + 2, y + 12, 2, 3, C.table2);
    rect(img, x + 12, y + 12, 2, 3, C.table2);
    rect(img, x + 4, y + 4, 4, 3, C.white);
  },
  sign: (img, x, y) => {
    drawGrass(img, x, y, 9);
    rect(img, x + 7, y + 9, 2, 6, C.trunk);
    rect(img, x + 2, y + 2, 12, 8, C.trunk);
    rect(img, x + 3, y + 3, 10, 6, C.path);
    for (const ly of [4, 6]) rect(img, x + 4, y + ly, 8, 1, C.door2);
  },
  fence: (img, x, y) => {
    drawGrass(img, x, y, 11);
    rect(img, x, y + 6, T, 2, C.path2);
    rect(img, x, y + 11, T, 2, C.path2);
    for (const fx of [1, 13]) rect(img, x + fx, y + 3, 2, 12, C.trunk);
  },
  counter: (img, x, y) => {
    tileDrawers.floor(img, x, y);
    rect(img, x, y + 2, T, 12, C.table2);
    rect(img, x, y + 2, T, 4, C.table);
  },
  plant: (img, x, y) => {
    tileDrawers.floor(img, x, y);
    rect(img, x + 5, y + 10, 6, 5, C.roof);
    pattern(img, x + 3, y + 1, [
      '...aa.....',
      '.aaabaa...',
      'abaaaaaba.',
      '.aaabaaaa.',
      '..aabaaa..',
      '....aa....',
      '.....a....',
      '.....a....',
      '.....a....',
    ], { a: C.leaf2, b: C.leafDark });
  },
};

function buildTileset() {
  const rows = Math.ceil(TILE_NAMES.length / COLS);
  const img = canvas(COLS * T, rows * T);
  TILE_NAMES.forEach((name, i) => tileDrawers[name](img, (i % COLS) * T, Math.floor(i / COLS) * T));
  return img;
}

// ---------- 角色精灵表：4 行（下、左、右、上）× 3 列（站立、迈步 A、迈步 B） ----------
function buildCharacter(pal) {
  const img = canvas(3 * T, 4 * T);
  const head = {
    down: ['....hhhhhh....', '...hhhhhhhh...', '...hssssssh...', '...sesssses...', '...ssssssss...', '....ssmmss....'],
    up: ['....hhhhhh....', '...hhhhhhhh...', '...hhhhhhhh...', '...hhhhhhhh...', '...hhhhhhhh...', '....hhhhhh....'],
    left: ['....hhhhhh....', '...hhhhhhhh...', '...hhhhhhhh...', '...sesssshh...', '...sssssshh...', '....sssshh....'],
    right: ['....hhhhhh....', '...hhhhhhhh...', '...hhhhhhhh...', '...hhssssse...', '...hhssssss...', '....hhssss....'],
  };
  const body = ['...cccccccc...', '..scccccccccs.', '..scccccccccs.', '...cccccccc...', '...pppppppp...'];
  const legs = [
    ['....pp..pp....', '....pp..pp....', '....bb..bb....'],
    ['...pp....pp...', '...pp.....pp..', '...bb.....bb..'],
    ['...pp....pp...', '..pp.....pp...', '..bb.....bb...'],
  ];
  ['down', 'left', 'right', 'up'].forEach((dir, row) => {
    for (let f = 0; f < 3; f++) {
      const ox = f * T + 1, oy = row * T + 1;
      const bob = f === 0 ? 0 : 1;
      pattern(img, ox, oy + bob, head[dir], pal);
      pattern(img, ox, oy + 6 + bob, body, pal);
      pattern(img, ox, oy + 11, legs[f], pal);
    }
  });
  return img;
}

function write(path, img) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img));
  console.log('wrote', path, `${img.w}x${img.h}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  write('public/assets/tilesets/placeholder.png', buildTileset());
  const base = { s: '#f2c9a0', e: '#1b1b1b', m: '#c46a5a', b: '#3b2a1e' };
  write('public/assets/sprites/player.png', buildCharacter({ ...base, h: '#3b2a1e', c: '#2e86c1', p: '#34495e' }));
  write('public/assets/sprites/librarian.png', buildCharacter({ ...base, h: '#9a9a9a', c: '#8e44ad', p: '#4a3060' }));
  const player = buildCharacter({ ...base, h: '#3b2a1e', c: '#2e86c1', p: '#34495e' });
  const icon = canvas(T, T);
  for (let y = 0; y < T; y++) player.px.copy(icon.px, y * T * 4, y * player.w * 4, y * player.w * 4 + T * 4);
  write('public/favicon.png', icon);
  write('public/assets/sprites/villager.png', buildCharacter({ ...base, h: '#d4a017', c: '#27ae60', p: '#6b4423' }));
}
