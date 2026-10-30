// Turns build/logo.png (the square QAgent logo) into every image the app needs:
//   build/icon.png          1024 px app icon: the emblem only (installers, taskbar, window)
//   src/ui/assets/logo.png  full logo for the start-up screen and About
//   src/ui/assets/mark.png  small emblem for the sidebar
//   docs/logo.png           full logo for the README
// Uses the installed Chrome (playwright-core) to crop and resize; no image library needed.
//   node scripts/make-icons.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(ROOT, 'build', 'logo.png');
if (!fs.existsSync(src)) throw new Error(`Save the logo as ${src} first`);

// The emblem (QA mark and app window) as a share of the logo's width and height. It is wider
// than tall and the word "QAgent" starts just below it, so it is centred on a square canvas.
const EMBLEM = { x: 0.075, y: 0.05, w: 0.86, h: 0.685 };

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' }));
const page = await browser.newPage();
const dataUrl = `data:image/png;base64,${fs.readFileSync(src).toString('base64')}`;

/** Draws the (cropped) logo on a size×size canvas and writes it as PNG. */
const render = async (out, size, crop) => {
  const b64 = await page.evaluate(
    async ({ dataUrl, size, crop }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const [sx, sy, sw, sh] = crop ? [crop.x * w, crop.y * h, crop.w * w, crop.h * h] : [0, 0, w, h];
      // Fit inside the square on the logo's own background colour (its top-left pixel)
      g.drawImage(img, 0, 0, 1, 1, 0, 0, size, size);
      const k = size / Math.max(sw, sh);
      g.drawImage(img, sx, sy, sw, sh, (size - sw * k) / 2, (size - sh * k) / 2, sw * k, sh * k);
      return c.toDataURL('image/png').split(',')[1];
    },
    { dataUrl, size, crop },
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(`${path.relative(ROOT, out)}  ${size}px`);
};

await render(path.join(ROOT, 'build', 'icon.png'), 1024, EMBLEM);
await render(path.join(ROOT, 'src', 'ui', 'assets', 'logo.png'), 640);
await render(path.join(ROOT, 'src', 'ui', 'assets', 'mark.png'), 128, EMBLEM);
await render(path.join(ROOT, 'docs', 'logo.png'), 512);
await browser.close();
