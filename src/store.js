// Persist the user's collection + settings to localStorage.
// A frame is now plain JSON — { id, name, user, asset, srcThumb, overrides } — so no
// canvas juggling. Old v1 sprite frames (with `png`) are dropped on load.

const KEY = 'tryon.v2';
const OLD = 'tryon.v1';

/** Read the saved collection. Returns { frames, settings } or null. */
export function load() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { raw = null; }
  if (!raw) {
    // best-effort migration marker: just clear the old blob, nothing to carry over
    try { if (localStorage.getItem(OLD)) localStorage.removeItem(OLD); } catch { /* ignore */ }
    return null;
  }
  const frames = (raw.frames || []).filter(f => f && f.asset && f.asset.geometry);
  return { frames, settings: raw.settings || {} };
}

/** Write the collection + settings. Only user frames are stored (presets live in code). */
export function save(frames, settings) {
  const keep = frames.filter(f => f.user).map(f => {
    const { ...rest } = f;
    return rest;
  });
  try {
    localStorage.setItem(KEY, JSON.stringify({ frames: keep, settings, at: Date.now() }));
    return true;
  } catch {
    if (keep.length > 1) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ frames: keep.slice(-8), settings, at: Date.now() }));
        return true;
      } catch { /* give up quietly */ }
    }
    return false;
  }
}

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
