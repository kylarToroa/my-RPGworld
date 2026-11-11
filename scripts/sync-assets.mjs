#!/usr/bin/env node
// 从站长指定的本地素材库同步项目所需的美术资源。
//
// 设计原则：
// 1. 只复制 assets.manifest.json 白名单里列出的文件，不做整目录搬运。
// 2. 素材库原文件只读，绝不修改、移动或重命名。
// 3. 路径不写死：命令行参数 > 环境变量 > 本地配置 asset-library.local.json。
// 4. 先整体预检再落盘：任何一个源文件缺失都直接失败，不留半套资源。
//
// 用法：
//   npm run sync:assets                                     (读环境变量/本地配置)
//   npm run sync:assets -- --rtp="D:/.../img" --library="D:/美术素材库"
//   npm run sync:assets -- --check                          (只检查，不写文件)
import { existsSync, mkdirSync, readFileSync, copyFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cropImage, decodePng, encodePng, flipHorizontal, hstack, rollImage } from './lib/png.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'assets.manifest.json');
const assetsJsonPath = join(root, 'world', 'assets.json');
const outRoot = join(root, 'public', 'assets');
const localConfigPath = join(root, 'asset-library.local.json');

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const opts = { check: false, rtp: null, library: null };
const unknown = [];
for (const arg of argv) {
  if (arg === '--check') opts.check = true;
  else if (arg.startsWith('--rtp=')) opts.rtp = cleanPath(arg.slice('--rtp='.length));
  else if (arg.startsWith('--library=')) opts.library = cleanPath(arg.slice('--library='.length));
  else if (arg === '--help' || arg === '-h') {
    console.log('用法：npm run sync:assets [-- --rtp=<路径> --library=<路径> --check]');
    process.exit(0);
  } else unknown.push(arg);
}

function cleanPath(p) {
  return String(p).trim().replace(/^["']|["']$/g, '');
}

if (unknown.length) fail(`无法识别的参数：${unknown.join(' ')}`);

function fail(message, hints = []) {
  console.error(`\n✗ ${message}`);
  for (const h of hints) console.error(`  ${h}`);
  console.error('');
  process.exit(1);
}

// ---------- 解析素材库根目录 ----------
function loadLocalConfig() {
  if (!existsSync(localConfigPath)) return {};
  try {
    return JSON.parse(readFileSync(localConfigPath, 'utf8'));
  } catch (err) {
    fail(`本地配置 ${localConfigPath} 不是合法 JSON：${err.message}`, [
      '可以删掉该文件，改用环境变量或命令行参数。',
    ]);
  }
}

const local = loadLocalConfig();
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const roots = {};
for (const [name, def] of Object.entries(manifest.roots)) {
  const value = (name === 'rtp' ? opts.rtp : name === 'library' ? opts.library : null) ?? process.env[def.env] ?? local[name];
  if (value) roots[name] = resolve(value);
}

const missingRoots = Object.keys(manifest.roots).filter((name) => !roots[name]);
if (missingRoots.length) {
  const envNames = missingRoots.map((n) => manifest.roots[n].env);
  fail(`缺少素材库路径：${missingRoots.join(', ')}`, [
    ...missingRoots.map((n) => `  ${n}：${manifest.roots[n].desc}`),
    '',
    '三种设置方式（任选其一）：',
    `  1) 临时环境变量：${envNames.map((e) => `${e}="<路径>"`).join(' ')} npm run sync:assets`,
    `  2) 命令行参数：npm run sync:assets -- ${missingRoots.map((n) => `--${n}="<路径>"`).join(' ')}`,
    `  3) 复制 asset-library.example.json 为 asset-library.local.json 并填写路径（该文件已被 .gitignore 忽略）`,
  ]);
}

for (const [name, dir] of Object.entries(roots)) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`素材库路径不存在或不是目录：${name} = ${dir}`, ['请确认路径拼写，或先挂载/解压对应素材包。']);
  }
}
if (roots.rtp) {
  const need = ['tilesets', 'characters'].filter((sub) => !existsSync(join(roots.rtp, sub)));
  if (need.length) {
    fail(`rtp 根目录下缺少子目录：${need.join(', ')}`, [
      `当前 rtp = ${roots.rtp}`,
      '请指向 RPG Maker 素材的 img 目录（其下应有 tilesets/ 与 characters/）。',
    ]);
  }
}

// ---------- 读资产清单（world/assets.json），用于双向对账 ----------
const assetsJson = JSON.parse(readFileSync(assetsJsonPath, 'utf8'));
const referenced = new Set([
  ...Object.values(assetsJson.tilesets).map(toAssetRel),
  ...Object.values(assetsJson.sprites ?? {}).map((s) => toAssetRel(s.url)),
]);

function toAssetRel(url) {
  return String(url).replace(/^assets\//, '');
}

// 清单与 assets.json 双向对账：清单漏项会导致构建时缺图，清单多项会复制无用文件。
const manifestOuts = new Set(manifest.files.map((f) => f.out));
const missingInManifest = [...referenced].filter((p) => !manifestOuts.has(p));
const unreferenced = [...manifestOuts].filter((p) => !referenced.has(p));
if (missingInManifest.length) {
  fail('world/assets.json 引用了清单里没有登记的文件：', missingInManifest.map((p) => `  - assets/${p}`));
}
if (unreferenced.length) {
  fail('清单里有文件没被 world/assets.json 引用（应删除或补登记）：', unreferenced.map((p) => `  - assets/${p}`));
}

// ---------- 预检所有源文件 ----------
const jobs = [];
const problems = [];
for (const entry of manifest.files) {
  const sep = entry.from.indexOf(':');
  const rootName = entry.from.slice(0, sep);
  const relPath = entry.from.slice(sep + 1);
  const base = roots[rootName];
  if (!base) {
    problems.push(`${entry.out}：未知来源前缀 "${rootName}"`);
    continue;
  }
  const src = join(base, ...relPath.split('/'));
  if (!existsSync(src)) {
    problems.push(`${entry.out} ← ${entry.from}\n      找不到：${src}`);
    continue;
  }
  jobs.push({ ...entry, src, srcLabel: `${rootName}:${relPath}` });
}

if (problems.length) {
  fail(`有 ${problems.length} 个源文件缺失，未写入任何文件：`, problems.map((p) => `  - ${p}`));
}

// ---------- 执行 ----------
const written = [];
for (const job of jobs) {
  const dest = join(outRoot, ...job.out.split('/'));
  let bytes = 0;
  if (job.mode === 'copy') {
    if (!opts.check) {
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(job.src, dest);
    }
    bytes = statSync(job.src).size;
  } else if (job.mode === 'crop') {
    const img = decodePng(readFileSync(job.src));
    const [x, y, w, h] = job.rect;
    const png = encodePng(cropImage(img, x, y, w, h));
    if (!opts.check) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, png);
    }
    bytes = png.length;
  } else if (job.mode === 'tile-variants') {
    const img = decodePng(readFileSync(job.src));
    const [col, row] = job.tile;
    const size = job.tileSize;
    const tile = cropImage(img, col * size, row * size, size, size);
    const pieces = job.variants.map(([dx, dy], i) => {
      const rolled = rollImage(tile, dx, dy);
      return job.flipOdd && i % 2 === 1 ? flipHorizontal(rolled) : rolled;
    });
    const png = encodePng(hstack(pieces));
    if (!opts.check) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, png);
    }
    bytes = png.length;
  } else {
    fail(`清单条目 ${job.out} 使用了未知 mode "${job.mode}"`);
  }
  written.push({ out: job.out, from: job.srcLabel, bytes, mode: job.mode });
}

// ---------- 输出 ----------
const action = opts.check ? '检查通过（未写入）' : '已同步';
console.log(`\n${action}：${written.length} 个文件 → public/assets\n`);
for (const w of written) {
  console.log(`  ${w.out.padEnd(30)} ${(w.bytes / 1024).toFixed(1).padStart(8)} KB  ${w.mode.padEnd(13)} ← ${w.from}`);
}
console.log('\n提示：这些 PNG 是第三方素材，已在 .gitignore 中排除，不会被提交或发布。');
console.log('      换一台机器时，设置好素材库路径后重新运行 npm run sync:assets 即可复现。\n');
