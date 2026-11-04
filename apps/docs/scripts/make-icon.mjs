#!/usr/bin/env node
/**
 * 从像素猫素材生成整套 icon（无依赖，纯整数倍/像素格，绝不糊掉像素块）：
 * 1) macOS 菜单栏状态图标（Template Icon：纯白/纯黑剪影 + 透明负空间镂空，64x64 @2x / 128x128 / 256x256）
 * 2) 应用与站点圆角图标（icon-512/256/192/180/128/64/32/16.png + favicon.ico）
 *
 * 用法：
 *   dwebp apps/docs/public/mascot/pip-idle.webp -o /tmp/pip-idle.png
 *   node apps/docs/scripts/make-icon.mjs --source /tmp/pip-idle.png --out /tmp/icon-out
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadPng,
  crop,
  placeOnCanvas,
  resizeBox,
  encodePng,
  encodeIco,
} from './lib/pixel-png.mjs';

/** 猫头 + 围巾；坐标基于 256x256 的 pip-idle 素材 */
const HEAD_CROP = { x: 45, y: 19, width: 145, height: 137 };
const TRAY_CROP = { x: 45, y: 19, width: 145, height: 146 };
/** 米色底，取自站点暖色系 */
const CREAM = [0xf3, 0xec, 0xe2, 255];
const CORNER_RADIUS = 112;

function parseArgs(argv) {
  const opts = {
    source: 'apps/docs/public/mascot/pip-idle.webp.png',
    out: 'icon-out',
    background: 'cream',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') opts.source = argv[++i];
    else if (arg === '--out') opts.out = argv[++i];
    else if (arg === '--background') opts.background = argv[++i];
    else throw new Error(`未知参数: ${arg}`);
  }
  return opts;
}

/**
 * 将 256x256 的黑猫像素图转换为 macOS Menu Bar Template 剪影母版（纯白前景 + 眼眶/耳窝/鼻须/围巾领口透明镂空）。
 */
function buildMacosTrayTemplate256(src) {
  // 0 = transparent, 1 = blackFur, 2 = grayDetail, 3 = creamEye, 4 = orangeScarf
  const cls = new Uint8Array(256 * 256);
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const i = (y * 256 + x) * 4;
      const r = src.data[i];
      const g = src.data[i + 1];
      const b = src.data[i + 2];
      const a = src.data[i + 3];
      // 修补原图 webp 在头部内部的透明针孔
      if (
        a < 110 &&
        x >= 78 &&
        x <= 162 &&
        y >= 48 &&
        y <= 118 &&
        !(x >= 96 && x <= 125 && y <= 62)
      ) {
        cls[y * 256 + x] = 1;
        continue;
      }
      if (a < 110 || x > 192) {
        cls[y * 256 + x] = 0;
        continue;
      }
      if (r > 190 && g > 160 && b > 110) cls[y * 256 + x] = 3;
      else if (r > 150 && g < 130 && b < 85) cls[y * 256 + x] = 4;
      else if (r < 42 && g < 42 && b < 42) cls[y * 256 + x] = 1;
      else cls[y * 256 + x] = 2;
    }
  }

  const out = { width: 256, height: 256, data: Buffer.alloc(256 * 256 * 4) };
  for (let y = 19; y <= 165; y += 1) {
    for (let x = 45; x <= 190; x += 1) {
      const c = cls[y * 256 + x];
      if (c === 0) continue;
      if (x < 68 && y > 134 && c !== 4) continue;

      let white = false;
      if (c === 3) {
        white = false;
      } else if (c === 4) {
        white = true;
      } else if (c === 2) {
        const isLeftInnerEar = x >= 80 && x <= 108 && y >= 40 && y <= 86;
        const isRightInnerEar = x >= 139 && x <= 153 && y >= 26 && y <= 57;
        const isNose = x >= 155 && x <= 165 && y >= 93 && y <= 102;
        const isCheekWhisker = x >= 92 && x <= 120 && y >= 103 && y <= 122;
        const isOuterWhisker = x >= 168 && y >= 78 && y <= 104;

        if (isOuterWhisker) white = true;
        else if (isLeftInnerEar || isRightInnerEar || isNose || isCheekWhisker) white = false;
        else if (y <= 122) white = true;
        else white = false;
      } else if (c === 1) {
        let nearScarfAbove = false;
        for (let dy = 1; dy <= 5; dy += 1) {
          for (let dx = -3; dx <= 3; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < 256 && ny >= 0 && ny < 256 && cls[ny * 256 + nx] === 4) {
              nearScarfAbove = true;
            }
          }
        }
        white = y <= 127 && !nearScarfAbove;
      }

      if (white) {
        const i = (y * 256 + x) * 4;
        out.data[i] = 255;
        out.data[i + 1] = 255;
        out.data[i + 2] = 255;
        out.data[i + 3] = 255;
      }
    }
  }
  return out;
}

function renderTrayTemplate(img256, box, size, pad, rgb = [255, 255, 255]) {
  const cropped = crop(img256, box);
  const avail = size - pad * 2;
  const scale = Math.min(avail / cropped.width, avail / cropped.height);
  const w = Math.round(cropped.width * scale);
  const h = Math.round(cropped.height * scale);
  const offX = Math.floor((size - w) / 2);
  const offY = Math.floor((size - h) / 2);

  const out = { width: size, height: size, data: Buffer.alloc(size * size * 4) };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx0 = (x / w) * cropped.width;
      const sx1 = ((x + 1) / w) * cropped.width;
      const sy0 = (y / h) * cropped.height;
      const sy1 = ((y + 1) / h) * cropped.height;
      let sum = 0;
      let cnt = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy += 1) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx += 1) {
          if (sx >= 0 && sx < cropped.width && sy >= 0 && sy < cropped.height) {
            sum += cropped.data[(sy * cropped.width + sx) * 4 + 3];
            cnt += 1;
          }
        }
      }
      const a = cnt > 0 && sum / cnt >= 128 ? 255 : 0;
      if (a > 0) {
        const dst = ((offY + y) * size + (offX + x)) * 4;
        out.data[dst] = rgb[0];
        out.data[dst + 1] = rgb[1];
        out.data[dst + 2] = rgb[2];
        out.data[dst + 3] = a;
      }
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const source = loadPng(opts.source);
  if (source.width !== 256 || source.height !== 256) {
    console.warn(`⚠️ 素材是 ${source.width}x${source.height}，但裁切坐标按 256x256 标定，结果可能偏`);
  }

  mkdirSync(opts.out, { recursive: true });

  // 1) macOS 菜单栏状态图标（Template Icon）
  const trayMaster = buildMacosTrayTemplate256(source);
  const trayWhite64 = renderTrayTemplate(trayMaster, TRAY_CROP, 64, 3, [255, 255, 255]);
  const trayBlack64 = renderTrayTemplate(trayMaster, TRAY_CROP, 64, 3, [0, 0, 0]);
  const trayWhite128 = renderTrayTemplate(trayMaster, TRAY_CROP, 128, 6, [255, 255, 255]);
  const trayWhite256 = renderTrayTemplate(trayMaster, TRAY_CROP, 256, 12, [255, 255, 255]);
  writeFileSync(join(opts.out, 'macos-tray-white-64.png'), encodePng(trayWhite64));
  writeFileSync(join(opts.out, 'macos-tray-black-64.png'), encodePng(trayBlack64));
  writeFileSync(join(opts.out, 'macos-tray-white-128.png'), encodePng(trayWhite128));
  writeFileSync(join(opts.out, 'macos-tray-white-256.png'), encodePng(trayWhite256));
  console.log('  macos-tray-white-64.png / macos-tray-black-64.png / 128 / 256');

  // 2) 圆角图标 + favicon.ico
  const background = opts.background === 'none' ? null : CREAM;
  const head = crop(source, HEAD_CROP);
  const master = placeOnCanvas(head, 512, {
    background,
    radius: background ? CORNER_RADIUS : 0,
    scale: 3,
  });

  for (const size of [512, 256, 192, 180, 128, 64, 32, 16]) {
    const image = size === 512 ? master : resizeBox(master, size);
    const png = encodePng(image);
    writeFileSync(join(opts.out, `icon-${size}.png`), png);
    console.log(`  icon-${size}.png`);
  }

  const icoSizes = [16, 32, 48, 64];
  const ico = encodeIco(
    icoSizes.map((size) => ({ size, png: encodePng(resizeBox(master, size)) })),
  );
  writeFileSync(join(opts.out, 'favicon.ico'), ico);
  console.log(`  favicon.ico (${icoSizes.join('/')})`);
  console.log(`\n完成 -> ${opts.out}`);
}

main();
