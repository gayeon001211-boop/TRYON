// Persist the user's collection + settings to localStorage.
// Presets live in code; only user-made frames (vector or extracted) are saved.
// An extracted frame's HTMLCanvasElement can't be JSON'd, so it rides as a PNG data URL.

const KEY = 'tryon.v1';

/** Rebuild an <img>-backed canvas from a data URL. Returns a Promise<HTMLCanvasElement>. */
function canvasFromDataURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Read the saved blob. Returns { frames, settings } or null. Async because canvases decode. */
export async function load() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  if (!raw) return null;

  const frames = await Promise.all((raw.frames || []).map(async f => {
    if (!f.png) return f;
    try {
      const canvas = await canvasFromDataURL(f.png);
      return { ...f, canvas };
    } catch { return null; }
  }));
  return { frames: frames.filter(Boolean), settings: raw.settings || {} };
}

/** Write the collection + settings. `frames` may include presets — they're filtered out here. */
export function save(frames, settings) {
  const keep = frames
    .filter(f => f.user)
    .map(f => {
      const { canvas, ...rest } = f;
      return canvas ? { ...rest, png: canvas.toDataURL('image/png') } : rest;
    });
  try {
    localStorage.setItem(KEY, JSON.stringify({ frames: keep, settings, at: Date.now() }));
    return true;
  } catch (e) {
    // quota blown by too many big PNGs — drop the oldest and retry once
    if (keep.length > 1) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ frames: keep.slice(-6), settings, at: Date.now() }));
        return true;
      } catch { /* give up quietly */ }
    }
    return false;
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
