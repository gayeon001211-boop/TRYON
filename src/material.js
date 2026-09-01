// What kind of eyewear is this, and what is it made of?
//
// The pipeline used to reduce every upload to one outline plus one colour, so a metal
// wire frame, a tortoiseshell acetate and a pair of sunglasses all came out as the same
// slab of plastic. These two classifiers read the pixels inside the frame band and the
// shape of the rim itself, and let the model be built and shaded accordingly.
//
// Pure — no DOM. See test_material.mjs.

const luma = (r, g, b) => (r * 299 + g * 587 + b * 114) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Material of the frame, from the pixels the rim actually covers.
 *  metal        — narrow bright/dark spread with strong isolated highlights
 *  transparent  — the band is light and low-contrast, the face reads through it
 *  patterned    — a lot of colour variation across the band (tortoiseshell, two-tone)
 *  acetate      — everything else: a solid moulded colour
 */
export function classifyMaterial(img, mask, w, h, band) {
  const px = [];
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || (band && !band[p])) continue;
    const i = p * 4;
    px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
  }
  if (px.length < 40) return { kind: 'acetate', confidence: 0, samples: px.length };

  const lums = px.map(c => luma(...c)).sort((a, b) => a - b);
  const at = q => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))];
  const p05 = at(0.05), p50 = at(0.5), p95 = at(0.95);
  const spread = p95 - p05;
  // highlights are a thin tail — p95 sits below them on a wire frame, so look further out
  const peak = at(0.995) - p50;

  // saturation spread says "patterned"; a flat colour barely varies
  const sats = px.map(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b));
  const satMean = sats.reduce((a, b) => a + b, 0) / sats.length;
  const satVar = Math.sqrt(sats.reduce((a, s) => a + (s - satMean) ** 2, 0) / sats.length);

  // specular: a few very bright pixels far above the body colour = polished metal
  const hot = lums.filter(l => l > p50 + 60).length / lums.length;

  let kind = 'acetate', confidence = 0.5;
  // a wire frame is mostly edge: only a small share of its pixels catch the highlight,
  // so the bar for "specular" has to sit low — what marks metal is hot pixels *and* a
  // wide luminance spread, which a flat moulded colour never has
  if (hot > 0.012 && peak > 80) { kind = 'metal'; confidence = clamp(hot * 20, 0.4, 0.95); }
  else if (p50 > 165 && spread < 70) { kind = 'transparent'; confidence = 0.6; }
  else if (satVar > 26 || spread > 110) { kind = 'patterned'; confidence = clamp(satVar / 60, 0.4, 0.9); }

  return {
    kind, confidence: +confidence.toFixed(2), samples: px.length,
    bodyLuma: Math.round(p50), spread: Math.round(spread), peak: Math.round(peak), specular: +hot.toFixed(3),
    satVar: +satVar.toFixed(1),
  };
}

/** Three.js material parameters for a material kind, on top of the sampled colour. */
export function materialParams(kind) {
  switch (kind) {
    case 'metal':
      return { metalness: 0.92, roughness: 0.24, clearcoat: 0.3, clearcoatRoughness: 0.2,
               depthScale: 0.45, thin: true };
    case 'transparent':
      // three needs real thickness for transmission to bend anything, and the material
      // must stay non-`transparent` or it blends instead of refracting
      return { metalness: 0, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04,
               transmission: 0.9, ior: 1.5, thickness: 0.12, depthScale: 1, thin: false };
    case 'patterned':
      return { metalness: 0, roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.12,
               depthScale: 1, thin: false };
    default:
      return { metalness: 0, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.09,
               depthScale: 1, thin: false };
  }
}

/**
 * Construction of the frame, read off the per-angle rim thickness.
 *  wire     — a rim so thin it must be metal wire
 *  browline — material across the top, nothing under the lens
 *  rimless  — barely any rim anywhere: the lens is drilled straight to the bridge
 *  fullrim  — a rim all the way round
 * Angles: 0 = outward, PI/2 = up, 3PI/2 = down (the profile's own convention).
 */
export function classifyShape(rimProfile, lensW, n = rimProfile?.length ?? 0) {
  if (!n || !lensW) return { kind: 'fullrim', topRatio: 0, bottomRatio: 0 };
  const sector = (from, to) => {
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      if (a >= from && a <= to) { sum += rimProfile[i]; count++; }
    }
    return count ? sum / count / lensW : 0;
  };
  const top = sector(Math.PI * 0.25, Math.PI * 0.75);
  const bottom = sector(Math.PI * 1.25, Math.PI * 1.75);
  const all = [...rimProfile].reduce((a, b) => a + b, 0) / n / lensW;

  let kind = 'fullrim';
  if (all < 0.022) kind = 'rimless';
  else if (top > 0.05 && bottom < top * 0.32) kind = 'browline';
  else if (all < 0.045) kind = 'wire';
  return { kind, topRatio: +top.toFixed(3), bottomRatio: +bottom.toFixed(3), meanRatio: +all.toFixed(3) };
}
