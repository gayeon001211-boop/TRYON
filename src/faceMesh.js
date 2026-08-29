// The 36 landmark indices MediaPipe walks around the face outline (FACE_OVAL),
// ordered so consecutive entries are neighbours. Used to build a cheap depth-only
// "head shield": a triangle fan from the face centroid to each edge of the oval,
// enough to hide a temple arm once it swings behind the head.

export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

/** Fan triangles [centroidVertex, oval[i], oval[i+1]]. `centroidIndex` is the extra vertex. */
export function ovalFanIndex(centroidIndex) {
  const idx = [];
  for (let i = 0; i < FACE_OVAL.length; i++) {
    const a = FACE_OVAL[i], b = FACE_OVAL[(i + 1) % FACE_OVAL.length];
    idx.push(centroidIndex, a, b);
  }
  return idx;
}
