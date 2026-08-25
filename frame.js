// Pure helpers for TRYON. No DOM, so they can be tested with node.

/** Face pose from the two outer eye-corner landmarks (already mirrored if the view is). */
export function poseFromEyes(a, b, w, h) {
  const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
  const dx = bx - ax, dy = by - ay;
  return {
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
    angle: Math.atan2(dy, dx),
    eyeSpan: Math.hypot(dx, dy),
  };
}

/** Average of the 4 corner pixels — the assumed background colour of a product shot. */
export function sampleCorners(data, w, h) {
  const at = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const c = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  return [0, 1, 2].map(k => Math.round(c.reduce((s, p) => s + p[k], 0) / 4));
}

/** Alpha-out every pixel within `tol` of `bg`. Returns how many pixels were cut. */
export function keyOut(data, bg, tol) {
  let cut = 0;
  const t2 = tol * tol * 3;
  for (let i = 0; i < data.length; i += 4) {
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    if (dr * dr + dg * dg + db * db <= t2) { data[i + 3] = 0; cut++; }
  }
  return cut;
}
