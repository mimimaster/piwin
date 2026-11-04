#!/usr/bin/env node
/**
 * 像素画 icon 生成器（零依赖）：解码 PNG → 裁切/最近邻缩放/合成底色 → 编码 PNG / ICO。
 * 只做整数倍最近邻缩放，绝不插值，保证像素块锐利。
 */
import { inflateSync, deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`仅支持 8bit 非隔行 PNG (bit=${data[8]}, interlace=${data[12]})`);
      if (colorType !== 6) throw new Error(`仅支持 RGBA PNG (colorType=${colorType})`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const prev = y === 0 ? null : out.subarray((y - 1) * stride, y * stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = value & 0xff;
    }
  }
  return { width, height, data: out };
}

export function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const chunk = (type, payload) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(payload.length, 0);
    head.write(type, 4, 'ascii');
    const crcTable = encodePng.crcTable ?? (encodePng.crcTable = (() => {
      const table = new Int32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
      }
      return table;
    })());
    let crc = -1;
    for (const byte of Buffer.concat([Buffer.from(type, 'ascii'), payload])) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    const tail = Buffer.alloc(4);
    tail.writeInt32BE(crc ^ -1, 0);
    return Buffer.concat([head, payload, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 取 alpha>阈值 的包围盒，可限制只看某个矩形区域 */
export function alphaBBox(image, { xMin = 0, xMax = image.width, yMin = 0, yMax = image.height } = {}) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = yMin; y < Math.min(yMax, image.height); y += 1) {
    for (let x = xMin; x < Math.min(xMax, image.width); x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('区域内没有不透明像素');
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function crop(image, box) {
  const data = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const srcStart = ((box.y + y) * image.width + box.x) * 4;
    image.data.copy(data, y * box.width * 4, srcStart, srcStart + box.width * 4);
  }
  return { width: box.width, height: box.height, data };
}

/** 整数倍最近邻缩放，保持像素块 */
export function scaleNearest(image, factor) {
  if (!Number.isInteger(factor)) throw new Error('只支持整数倍缩放');
  const width = image.width * factor;
  const height = image.height * factor;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.floor(x / factor);
      const src = (sy * image.width + sx) * 4;
      const dst = (y * width + x) * 4;
      data[dst] = image.data[src];
      data[dst + 1] = image.data[src + 1];
      data[dst + 2] = image.data[src + 2];
      data[dst + 3] = image.data[src + 3];
    }
  }
  return { width, height, data };
}

/** 把图放到正方形画布中央，底色可填纯色或透明；radius 支持圆角 */
export function placeOnCanvas(image, size, { background = null, radius = 0, scale = 1 } = {}) {
  const scaled = scale === 1 ? image : scaleNearest(image, scale);
  const canvas = Buffer.alloc(size * size * 4);
  if (background) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const inCorner =
          radius > 0 &&
          ((x < radius && y < radius && (radius - x) ** 2 + (radius - y) ** 2 > radius ** 2) ||
            (x >= size - radius && y < radius && (x - (size - radius - 1)) ** 2 + (radius - y) ** 2 > radius ** 2) ||
            (x < radius && y >= size - radius && (radius - x) ** 2 + (y - (size - radius - 1)) ** 2 > radius ** 2) ||
            (x >= size - radius && y >= size - radius && (x - (size - radius - 1)) ** 2 + (y - (size - radius - 1)) ** 2 > radius ** 2));
        if (inCorner) continue;
        const dst = (y * size + x) * 4;
        canvas[dst] = background[0];
        canvas[dst + 1] = background[1];
        canvas[dst + 2] = background[2];
        canvas[dst + 3] = background[3] ?? 255;
      }
    }
  }
  const offsetX = Math.floor((size - scaled.width) / 2);
  const offsetY = Math.floor((size - scaled.height) / 2);
  for (let y = 0; y < scaled.height; y += 1) {
    for (let x = 0; x < scaled.width; x += 1) {
      const ty = y + offsetY;
      const tx = x + offsetX;
      if (ty < 0 || tx < 0 || ty >= size || tx >= size) continue;
      const src = (y * scaled.width + x) * 4;
      const alpha = scaled.data[src + 3] / 255;
      if (alpha === 0) continue;
      const dst = (ty * size + tx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        canvas[dst + channel] = Math.round(scaled.data[src + channel] * alpha + canvas[dst + channel] * (1 - alpha));
      }
      canvas[dst + 3] = Math.round((alpha + (canvas[dst + 3] / 255) * (1 - alpha)) * 255);
    }
  }
  return { width: size, height: size, data: canvas };
}

/** 生成多尺寸 ICO（内嵌 PNG，Vista+ 兼容） */
export function encodeIco(pngList) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngList.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngList.length;
  for (const { size, png } of pngList) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...pngList.map((p) => p.png)]);
}

export function loadPng(path) {
  return decodePng(readFileSync(path));
}

export function savePng(path, image) {
  writeFileSync(path, encodePng(image));
}

/** 面积平均降采样：给 16/32/48 这类非整数比尺寸用，避免最近邻锯齿 */
export function resizeBox(image, targetSize) {
  const ratio = image.width / targetSize;
  const data = Buffer.alloc(targetSize * targetSize * 4);
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      const y0 = Math.floor(y * ratio);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let sy = y0; sy < Math.min(y1, image.height); sy += 1) {
        for (let sx = x0; sx < Math.min(x1, image.width); sx += 1) {
          const src = (sy * image.width + sx) * 4;
          const alpha = image.data[src + 3] / 255;
          sum[0] += image.data[src] * alpha;
          sum[1] += image.data[src + 1] * alpha;
          sum[2] += image.data[src + 2] * alpha;
          sum[3] += image.data[src + 3];
          count += 1;
        }
      }
      const dst = (y * targetSize + x) * 4;
      if (count === 0) continue;
      const alphaSum = sum[3] / 255;
      data[dst] = alphaSum > 0 ? Math.round(sum[0] / alphaSum) : 0;
      data[dst + 1] = alphaSum > 0 ? Math.round(sum[1] / alphaSum) : 0;
      data[dst + 2] = alphaSum > 0 ? Math.round(sum[2] / alphaSum) : 0;
      data[dst + 3] = Math.round(sum[3] / count);
    }
  }
  return { width: targetSize, height: targetSize, data };
}
