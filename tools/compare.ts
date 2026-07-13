/**
 * Reference-delta comparison compositor. Places our shot LEFT and the
 * reference RIGHT at a common height with labels, for docs/DELTA.md review.
 *
 * Usage:
 *   npm run compare                     — full required set into shots/compare/
 *   npm run compare -- --a shots/x.png --b references/overhead.png --out shots/cmp.png
 *   npm run compare -- --sample shots/x.png --px "100,200;300,400"
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';

interface Args {
  [k: string]: string | boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function str(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

const GUTTER = 14;
const TARGET_H = 1080;
const LABEL_H = 44;

function labelSvg(text: string, width: number): Buffer {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return Buffer.from(
    `<svg width="${width}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#0c0e0a"/>` +
      `<text x="14" y="29" font-family="Consolas,monospace" font-size="20" fill="#d8d3c0">${safe}</text>` +
      `</svg>`,
  );
}

export async function sideBySide(aPath: string, bPath: string, outPath: string): Promise<void> {
  const a = sharp(aPath);
  const b = sharp(bPath);
  const [am, bm] = await Promise.all([a.metadata(), b.metadata()]);
  const aw = Math.round(((am.width ?? 1) * TARGET_H) / (am.height ?? 1));
  const bw = Math.round(((bm.width ?? 1) * TARGET_H) / (bm.height ?? 1));
  const [aBuf, bBuf] = await Promise.all([
    a.resize(aw, TARGET_H).png().toBuffer(),
    b.resize(bw, TARGET_H).png().toBuffer(),
  ]);
  const W = aw + GUTTER + bw;
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp({
    create: { width: W, height: TARGET_H + LABEL_H, channels: 3, background: { r: 10, g: 12, b: 11 } },
  })
    .composite([
      { input: labelSvg(`OURS — ${aPath}`, aw), left: 0, top: 0 },
      { input: labelSvg(`REFERENCE — ${bPath}`, bw), left: aw + GUTTER, top: 0 },
      { input: aBuf, left: 0, top: LABEL_H },
      { input: bBuf, left: aw + GUTTER, top: LABEL_H },
    ])
    .png()
    .toFile(outPath);
  console.log(`[compare] wrote ${outPath}`);
}

async function samplePixels(imgPath: string, px: string): Promise<void> {
  const img = sharp(imgPath);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const pairs = px.split(';').map((s) => s.split(',').map(Number) as [number, number]);
  for (const [x, y] of pairs) {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) {
      console.log(`(${x},${y}) out of bounds`);
      continue;
    }
    const idx = (y * info.width + x) * info.channels;
    const r = data[idx] ?? 0;
    const g = data[idx + 1] ?? 0;
    const b = data[idx + 2] ?? 0;
    const maxc = Math.max(r, g, b);
    const minc = Math.min(r, g, b);
    const sat = maxc === 0 ? 0 : (maxc - minc) / maxc;
    console.log(`(${x},${y}) rgb(${r},${g},${b}) value=${(maxc / 255).toFixed(2)} sat=${sat.toFixed(2)}`);
  }
}

/** The comparisons required by the project contract. */
const REQUIRED: { ours: string; ref: string; out: string }[] = [
  {
    ours: 'shots/tactical.png',
    ref: 'references/overhead.png',
    out: 'shots/compare/tactical_vs_references.png',
  },
  {
    ours: 'shots/tank.png',
    ref: 'references/third_person.png',
    out: 'shots/compare/tank_vs_references.png',
  },
  {
    ours: 'shots/tank.png',
    ref: 'references/scene1.png',
    out: 'shots/compare/laas_quality_vs_current.png',
  },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sample = str(args['sample']);
  if (sample) {
    await samplePixels(sample, str(args['px']) ?? '');
    return;
  }
  const a = str(args['a']);
  const b = str(args['b']);
  if (a && b) {
    await sideBySide(a, b, str(args['out']) ?? 'shots/cmp.png');
    return;
  }
  // default: full required set
  let produced = 0;
  for (const { ours, ref, out } of REQUIRED) {
    if (!existsSync(ours)) {
      console.warn(`[compare] SKIP ${out} — missing ${ours} (run npm run shoot first)`);
      continue;
    }
    if (!existsSync(ref)) {
      console.warn(`[compare] SKIP ${out} — missing reference ${ref}`);
      continue;
    }
    await sideBySide(ours, ref, out);
    produced++;
  }
  if (produced !== REQUIRED.length) {
    throw new Error(`Produced ${produced}/${REQUIRED.length} required comparisons — restore every source and reference.`);
  }
}

main().catch((e: unknown) => {
  console.error('[compare] FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
