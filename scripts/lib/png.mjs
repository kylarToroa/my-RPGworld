// 最小 PNG 编解码器（零依赖）：只做资源同步需要的三种操作——解码、裁剪、重新编码。
// 支持范围：位深 8、非隔行；颜色类型 0/2/3/4/6（灰度 / RGB / 索引色 / 灰度+透明 / RGBA）。
// 遇到不支持的格式会抛出「明确说明原因」的错误，而不是产出损坏的文件。
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const COLOR_NAME = { 0: '灰度', 2: 'RGB', 3: '索引色', 4: '灰度+透明', 6: 'RGBA' };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * 解码 PNG 为 RGBA 像素。
 * @returns {{width:number,height:number,data:Uint8Array}}
 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是 PNG 文件（签名不符）');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];

  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height) throw new Error('PNG 头部损坏（缺少 IHDR）');
  if (bitDepth !== 8) throw new Error(`暂不支持位深 ${bitDepth} 的 PNG（只支持 8 位）`);
  if (interlace !== 0) throw new Error('暂不支持隔行扫描（Adam7）的 PNG');
  if (!(colorType in CHANNELS)) throw new Error(`未知颜色类型 ${colorType}`);

  const channels = CHANNELS[colorType];
  const rowBytes = width * channels;
  const bpp = channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (rowBytes + 1)) throw new Error('PNG 像素数据不完整');

  // 逐行反滤波
  const pixels = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = raw.subarray(y * (rowBytes + 1) + 1, y * (rowBytes + 1) + 1 + rowBytes);
    const dst = pixels.subarray(y * rowBytes, (y + 1) * rowBytes);
    const prev = y > 0 ? pixels.subarray((y - 1) * rowBytes, y * rowBytes) : null;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? dst[i - bpp] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`未知的行滤波类型 ${filter}`);
      dst[i] = v & 0xff;
    }
  }

  // 统一转 RGBA
  const out = new Uint8Array(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += channels) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 0) {
      r = g = b = pixels[p];
    } else if (colorType === 2) {
      r = pixels[p];
      g = pixels[p + 1];
      b = pixels[p + 2];
    } else if (colorType === 3) {
      const idx = pixels[p];
      if (!palette || idx * 3 + 2 >= palette.length) throw new Error('索引色 PNG 缺少调色板或索引越界');
      r = palette[idx * 3];
      g = palette[idx * 3 + 1];
      b = palette[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    } else if (colorType === 4) {
      r = g = b = pixels[p];
      a = pixels[p + 1];
    } else {
      r = pixels[p];
      g = pixels[p + 1];
      b = pixels[p + 2];
      a = pixels[p + 3];
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return { width, height, data: out, colorType: COLOR_NAME[colorType] ?? String(colorType) };
}

/** 把 RGBA 像素编码为 PNG（8 位 RGBA，无隔行，filter=0） */
export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 裁剪矩形区域，返回新的 {width,height,data} */
export function cropImage(img, x, y, w, h) {
  if (x < 0 || y < 0 || x + w > img.width || y + h > img.height) {
    throw new Error(`裁剪区域 (${x},${y},${w},${h}) 超出图片 ${img.width}×${img.height}`);
  }
  const out = new Uint8Array(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * img.width + x) * 4;
    out.set(img.data.subarray(srcStart, srcStart + w * 4), row * w * 4);
  }
  return { width: w, height: h, data: out };
}

/** 水平翻转 */
export function flipHorizontal(img) {
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = (y * img.width + (img.width - 1 - x)) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/** 环绕位移：把 (dx,dy) 之外的像素绕回另一侧，用于生成无缝变体 */
export function rollImage(img, dx, dy) {
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const sx = (((x + dx) % img.width) + img.width) % img.width;
      const sy = (((y + dy) % img.height) + img.height) % img.height;
      const s = (sy * img.width + sx) * 4;
      const d = (y * img.width + x) * 4;
      out[d] = img.data[s];
      out[d + 1] = img.data[s + 1];
      out[d + 2] = img.data[s + 2];
      out[d + 3] = img.data[s + 3];
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/** 横向拼接（等高） */
export function hstack(images) {
  const height = images[0].height;
  const width = images.reduce((sum, im) => sum + im.width, 0);
  const out = new Uint8Array(width * height * 4);
  let xoff = 0;
  for (const im of images) {
    if (im.height !== height) throw new Error('横向拼接要求所有图片等高');
    for (let y = 0; y < height; y++) {
      out.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), (y * width + xoff) * 4);
    }
    xoff += im.width;
  }
  return { width, height, data: out };
}
