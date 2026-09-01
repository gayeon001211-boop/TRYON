// Does the local helper's SAM 2 actually beat the browser's SlimSAM? Measure it.
//
// Both models get the SAME photo and the SAME prompt points — otherwise the comparison
// says nothing — and both masks go through the same buildAsset the app uses. There is no
// hand-painted ground truth, so the IoU printed here is AGREEMENT between the two, not
// accuracy: read it with the per-model scores and, more importantly, with whether
// buildAsset could make a pair of glasses out of the mask at all. That last column is
// the one that matters, because it is what the app does with the mask.
//
//   npm run helper                       # in another terminal
//   node bench_seg.mjs [photo-dir]       # default helper/bench/photos
//
// Not part of `npm test`: it downloads a model and takes seconds per photo.

import fs from 'node:fs';
import path from 'node:path';
import { RawImage } from '@huggingface/transformers';
import { embed, segment, pickGlassesPoints } from './src/segment.js';
import { buildAsset } from './src/glassesAsset.js';

const HELPER = 'http://127.0.0.1:8791';
const args = process.argv.slice(2);
const DUMP = args.includes('--dump');          // write the masks out so they can be looked at
const DIR = args.find(a => !a.startsWith('--')) || 'helper/bench/photos';

const iou = (a, b) => {
  let inter = 0, union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union ? inter / union : 0;
};
const area = m => m.reduce((n, v) => n + v, 0);

/** The helper, called the way the browser calls it but without a DOM to decode the PNG. */
async function viaHelper(dataUrl, points) {
  const r = await fetch(HELPER + '/segment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, points }),
  });
  if (!r.ok) throw new Error('helper ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  const png = await RawImage.fromBlob(new Blob([Buffer.from(j.mask.split(',')[1], 'base64')]));
  const grey = png.data;
  const stride = png.channels;
  const mask = new Uint8Array(j.width * j.height);
  for (let i = 0; i < mask.length; i++) mask[i] = grey[i * stride] > 127 ? 1 : 0;
  return { mask, width: j.width, height: j.height, score: j.score, via: j.model };
}

/** Same mask, same downstream: what the app would end up with. */
function asset(img, res) {
  try {
    const a = buildAsset(img, res.mask, res.width, res.height, null);
    return {
      ok: a.ok,
      score: a.quality?.score ?? 0,
      why: a.ok ? '' : (a.reason || [
        a.quality?.hasHoles === false && 'no lens holes',
        a.quality?.shapeLooksRight === false && 'shape',
      ].filter(Boolean).join('+') || 'low'),
    };
  } catch (e) {
    return { ok: false, score: 0, why: 'threw: ' + e.message.slice(0, 40) };
  }
}

const health = await fetch(HELPER + '/health').then(r => r.json()).catch(() => null);
if (!health) {
  console.error(`no helper on ${HELPER} — start it with \`npm run helper\` and try again`);
  process.exit(1);
}
console.log(`helper: ${health.model || '(not loaded yet)'} on ${health.device}`);

const photos = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f)).sort()
  : [];
if (!photos.length) {
  console.error(`no photos in ${DIR} — put some real glasses shots there (see its README)`);
  process.exit(1);
}

console.log('\nphoto                     slim   sam2    IoU  area×   asset slim → sam2');
console.log('─'.repeat(78));

const rows = [];
for (const file of photos) {
  const full = path.join(DIR, file);
  const raw = await RawImage.read(full);
  const rgba = raw.rgba();
  const img = { width: rgba.width, height: rgba.height, data: rgba.data };

  // one prompt, both models. A sidecar .points.json wins; otherwise the blind band the
  // app falls back to when it finds no face.
  const side = full.replace(/\.[^.]+$/, '.points.json');
  const sided = fs.existsSync(side);
  const points = sided
    ? JSON.parse(fs.readFileSync(side, 'utf8'))
    : pickGlassesPoints(null, img.width, img.height);

  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(full).toString('base64');
  const sam2 = await viaHelper(dataUrl, points).catch(e => ({ err: e.message }));
  const ctx = await embed(raw);                       // helper is up but raw is not a Blob,
  const slim = await segment(ctx, points);            // so this stays on the browser model

  if (sam2.err) { console.log(`${file.padEnd(24)} helper failed: ${sam2.err}`); continue; }
  if (sam2.width !== slim.width || sam2.height !== slim.height) {
    console.log(`${file.padEnd(24)} size mismatch ${slim.width}×${slim.height} vs ${sam2.width}×${sam2.height}`);
    continue;
  }

  if (DUMP) {
    const out = path.join(DIR, 'masks');
    fs.mkdirSync(out, { recursive: true });
    for (const [tag, r] of [['slim', slim], ['sam2', sam2]]) {
      // the mask over the photo, dimmed where it did not select — one look tells you more
      // than any number here does
      const px = new Uint8Array(img.data);
      for (let i = 0; i < r.mask.length; i++) {
        if (r.mask[i]) { px[i * 4] = 255; px[i * 4 + 1] = (px[i * 4 + 1] + 255) >> 1; }
        else { for (let k = 0; k < 3; k++) px[i * 4 + k] >>= 2; }
      }
      const png = new RawImage(px, img.width, img.height, 4);
      await png.save(path.join(out, `${file.replace(/\.[^.]+$/, '')}.${tag}.png`));
    }
  }

  const aSlim = asset(img, slim), aSam2 = asset(img, sam2);
  const row = {
    file, agree: iou(slim.mask, sam2.mask),
    slimScore: slim.score, sam2Score: sam2.score,
    areaRatio: area(sam2.mask) / (area(slim.mask) || 1),
    slim: aSlim, sam2: aSam2,
  };
  rows.push(row);
  const mark = a => (a.ok ? `${a.score.toFixed(2)}` : `✗ ${a.why}`);
  console.log(
    `${file.padEnd(24)} ${row.slimScore.toFixed(2)}   ${row.sam2Score.toFixed(2)}   ` +
    `${row.agree.toFixed(2)}  ${row.areaRatio.toFixed(2)}×   ${mark(aSlim)} → ${mark(aSam2)}` +
    (sided ? '' : '   [blind band prompt]')
  );
}

if (rows.length) {
  const mean = f => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const won = rows.filter(r => r.sam2.ok && !r.slim.ok).length;
  const lost = rows.filter(r => r.slim.ok && !r.sam2.ok).length;
  console.log('─'.repeat(78));
  console.log(`${rows.length} photos · mean agreement ${mean(r => r.agree).toFixed(2)} · ` +
              `mean score ${mean(r => r.slimScore).toFixed(2)} → ${mean(r => r.sam2Score).toFixed(2)}`);
  console.log(`usable asset: slimsam ${rows.filter(r => r.slim.ok).length}/${rows.length}, ` +
              `sam2 ${rows.filter(r => r.sam2.ok).length}/${rows.length}` +
              (won || lost ? `  (sam2 rescued ${won}, lost ${lost})` : ''));
}
