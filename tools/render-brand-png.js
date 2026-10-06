#!/usr/bin/env node
// Render the raster brand assets from the outlined SVGs in brand/.
//
//   node tools/render-brand-png.js
//
// Run after tools/build-brand.py. Uses the Chromium the test harness uses. The
// SVGs are outlined (no live text), so no fonts are needed and the output is
// the same on any machine.
//
// Only what something actually embeds is rendered:
//   brand/png/cirrus-cc-lockup-horizontal-light.png  the product mark in the
//       Sunrise Alt and UDOT .docx letterheads (word/media/image3.png), 2100 px
//       wide like the Horizon COMPASS mark it replaces, transparent
//   brand/png/cirrus-cc-apple-touch-180.png  mobile home-screen icon. Square,
//       full-bleed Ink: iOS rounds the corners itself and paints transparent
//       pixels black, so the SVG's own rounded tile would get black corners.
const { chromium } = require('../test/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BRAND = path.join(__dirname, '..', 'brand');
const OUT = path.join(BRAND, 'png');

const JOBS = [
  { src: 'cirrus-cc-lockup-horizontal-light.svg', out: 'cirrus-cc-lockup-horizontal-light.png', width: 2100 },
  { src: 'cirrus-cc-app-icon.svg', out: 'cirrus-cc-apple-touch-180.png', width: 180, square: true },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const j of JOBS) {
    let svg = fs.readFileSync(path.join(BRAND, j.src), 'utf8');
    if (j.square) svg = svg.replace(/(<rect[^>]*?) rx="[^"]*"/, '$1');
    const [, vw, vh] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).map(Number);
    const w = j.width, h = Math.round(w * vh / vw);
    svg = svg.replace(/ width="[^"]*" height="[^"]*"/, '').replace('<svg ', `<svg width="${w}" height="${h}" `);
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(OUT, j.out), omitBackground: true });
    console.log(`${j.out}  ${w}×${h}`);
  }
  await browser.close();
})();
