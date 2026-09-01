import { useEffect, useRef, useState } from 'react';
import { useTryOn } from './useTryOn.js';
import { smartFit } from './frame.js';
import { measureFace, averageProfile, withPd, DEFAULT_PD_MM } from './faceProfile.js';
import { PRESETS } from './presets.js';
import ExtractModal from './ExtractModal.jsx';
import Thumb from './Thumb.jsx';
import { load, save } from './store.js';

const FRAME_COLORS = ['#111111', '#3c3c40', '#c98b2e', '#8a5a2b', '#b9bcc0', '#a92b2b', '#2f4f9b', '#f0ece2'];
const LENS_COLORS = ['#ffffff', '#3a3a3a', '#6b4a22', '#2b4d8c', '#1c1c1c'];
const DEFAULT_FIT = { w: 1, h: 1, x: 0, y: 0, scale: 1, r: 0 };
const download = (url, name) => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); };

// asset defaults overlaid with the user's per-frame tweaks
const renderOpts = f => ({
  frameColor: f.asset.frameColor, lensColor: f.asset.lensColor,
  lensOpacity: f.asset.lensOpacity, thickness: 1, frameOpacity: 1,
  ...(f.overrides || {}),
});

export default function App() {
  const presetFrames = PRESETS.map(p => ({ ...p }));
  const [frames, setFrames] = useState(presetFrames);
  const [activeId, setActiveId] = useState('round');
  const [fit, setFit] = useState(DEFAULT_FIT);
  const [worn, setWorn] = useState(false);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('3d');
  const [compareIds, setCompareIds] = useState([]);
  const [shots, setShots] = useState([]);
  const [editing, setEditing] = useState(null);
  const [sheet, setSheet] = useState(null);
  const fileInput = useRef(null);
  const hydrated = useRef(false);

  const frame = frames.find(f => f.id === activeId) || frames[0];
  const opts = renderOpts(frame);
  const comparing = compareIds.length === 2;
  const compareFrames = comparing ? compareIds.map(id => frames.find(f => f.id === id)).filter(Boolean) : null;

  const [profile, setProfile] = useState(null);      // the wearer, measured — the ruler
  const [measuring, setMeasuring] = useState(false);

  const paramsRef = useRef(null);
  paramsRef.current = {
    frame, opts, fit, worn, mode,
    compare: comparing && compareFrames?.length === 2
      ? compareFrames.map(f => ({ frame: f, opts: renderOpts(f) })) : null,
  };

  const { videoRef, canvasRef, glCanvasRef, status, faceFound, facing, start, flip, snapshot, contactSheet, sample } = useTryOn(paramsRef);

  useEffect(() => {
    const saved = load();
    hydrated.current = true;
    if (!saved) return;
    if (saved.frames?.length) setFrames([...presetFrames, ...saved.frames]);
    if (saved.settings?.mode) setMode(saved.settings.mode);
    if (saved.settings?.faceProfile) setProfile(saved.settings.faceProfile);
  }, []);   // eslint-disable-line

  useEffect(() => {
    if (!hydrated.current) return;
    save(frames, { mode, faceProfile: profile });
  }, [frames, mode, profile]);

  const pickFrame = id => { setActiveId(id); setFit(DEFAULT_FIT); };

  const addFrame = ({ asset, srcThumb }) => {
    const n = frames.filter(f => f.user).length + 1;
    const nf = { id: 'f' + Date.now(), name: 'frame ' + n, user: true, asset, srcThumb, overrides: {} };
    setFrames([...frames, nf]);
    setActiveId(nf.id); setFit(DEFAULT_FIT);
    setFile(null); setWorn(true);
  };

  const removeFrame = id => {
    setFrames(fs => fs.filter(f => f.id !== id));
    setCompareIds(ids => ids.filter(x => x !== id));
    if (activeId === id) pickFrame('round');
  };
  const rename = (id, name) => setFrames(fs => fs.map(f => f.id === id ? { ...f, name } : f));
  const toggleCompare = id => setCompareIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(-2));

  // patch the active frame's overrides / geometry
  const patch = p => setFrames(fs => fs.map(f => f.id === activeId ? { ...f, ...p } : f));
  const setOverride = o => patch({ overrides: { ...(frame.overrides || {}), ...o } });
  const applyPresetShape = id => {
    const pr = PRESETS.find(p => p.id === id);
    if (pr) patch({ asset: { ...frame.asset, geometry: pr.asset.geometry, dimensions: { ...frame.asset.dimensions, aspect: pr.asset.dimensions.aspect } } });
  };

  /** Watch the face for a moment and take the median — one frame jitters by millimetres. */
  const measureMe = async () => {
    setMeasuring(true);
    const shots = [];
    for (let i = 0; i < 30; i++) {
      const { lm, size } = sample();
      if (lm && size.w) shots.push(measureFace(lm, size.w, size.h, profile?.pdMm ?? DEFAULT_PD_MM));
      await new Promise(r => setTimeout(r, 40));
    }
    const p = averageProfile(shots);
    setMeasuring(false);
    if (p) setProfile(p);
  };

  const autoFit = () => {
    const { lm } = sample();
    if (!lm) return;
    const sf = smartFit(lm, { spanRatio: frame.asset.placement?.spanRatio, yRatio: frame.asset.placement?.yRatio },
      canvasRef.current.width, canvasRef.current.height);
    setFit({ ...DEFAULT_FIT, w: sf.w, y: sf.y });
  };

  const takeShot = () => { const url = snapshot(); if (url) setShots(s => [{ id: Date.now(), url }, ...s].slice(0, 12)); };
  const makeSheet = () => { const c = contactSheet(); if (c) setSheet(c.toDataURL('image/png')); };

  const slider = (key, label, min, max, step, fmt) => (
    <div key={key}>
      <label>{label} <b>{fmt(fit[key])}</b></label>
      <input type="range" min={min} max={max} step={step} value={fit[key]}
             onChange={e => setFit({ ...fit, [key]: +e.target.value })} />
    </div>
  );
  const ovSlider = (key, label, min, max, step, dflt, fmt) => {
    const v = frame.overrides?.[key] ?? dflt;
    return (
      <div key={key}>
        <label>{label} <b>{fmt(v)}</b></label>
        <input type="range" min={min} max={max} step={step} value={v}
               onChange={e => setOverride({ [key]: +e.target.value })} />
      </div>
    );
  };

  return (
    <>
      <header>
        <b>TRYON</b>
        <span className="hint tag">find it. try it on.</span>
        <span className="grow" />
        <div className="seg">
          <button className={mode === '2d' ? 'on' : ''} onClick={() => setMode('2d')}>2D</button>
          <button className={mode === '3d' ? 'on' : ''} onClick={() => setMode('3d')}>3D</button>
        </div>
        <span className="hint">
          {status === 'on' ? <><span className="dot">●</span> camera on</>
            : status === 'denied' ? '● camera blocked' : `● camera ${status}`}
        </span>
      </header>

      <main>
        <aside className="left">
          {/* the flow, in order, so a first-time screen is not twelve sliders at once */}
          <ol className="steps">
            {[
              { k: 'cam', n: 1, label: 'turn on the camera', done: status === 'on' },
              { k: 'face', n: 2, label: profile ? `face measured — ${profile.faceWidthMm}mm` : 'measure your face',
                done: Boolean(profile), skip: 'optional, but sizes everything' },
              { k: 'frame', n: 3, label: 'upload a pair of glasses', done: frames.some(f => f.user) },
            ].map((s, i, all) => {
              const active = !s.done && all.slice(0, i).every(p => p.done || p.skip);
              return (
                <li key={s.k} className={(s.done ? 'done' : '') + (active ? ' now' : '')}>
                  <b>{s.done ? '✓' : s.n}</b>
                  <span>{s.label}{!s.done && s.skip && <i> · {s.skip}</i>}</span>
                </li>
              );
            })}
          </ol>

          <h2>my frames</h2>
          <div className="frames">
            {frames.map(f => (
              <div key={f.id} className={'chip' + (f.id === activeId ? ' on' : '') + (compareIds.includes(f.id) ? ' cmp' : '')}>
                <button className="pick" onClick={() => pickFrame(f.id)}>
                  <Thumb frame={f} />
                  {editing === f.id
                    ? <input autoFocus defaultValue={f.name}
                        onBlur={e => { rename(f.id, e.target.value.trim() || f.name); setEditing(null); }}
                        onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                    : <span onDoubleClick={() => f.user && setEditing(f.id)}>{f.name}</span>}
                </button>
                <div className="chipbtns">
                  <button title="compare" className={compareIds.includes(f.id) ? 'on' : ''}
                          onClick={() => toggleCompare(f.id)}>A/B</button>
                  {f.user && <button title="delete" onClick={() => removeFrame(f.id)}>✕</button>}
                </div>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="big ghost" onClick={() => fileInput.current.click()}>+ upload image</button>
          </div>
          {comparing && <p className="hint">comparing 2 frames — split view. tap A/B to clear.</p>}
          <p className="hint guide">
            works best: a product shot on a plain background. a photo of someone wearing
            them works too. avoid busy backgrounds and heavy shadows.
          </p>
          <input ref={fileInput} type="file" accept="image/*" hidden
                 onChange={e => { setFile(e.target.files[0]); e.target.value = ''; }} />
        </aside>

        <div className="stage">
          <video ref={videoRef} playsInline muted hidden />
          <canvas ref={canvasRef} className="c2d" />
          <canvas ref={glCanvasRef} className={'cgl' + (mode === '3d' && !comparing ? '' : ' off')} />
          {status === 'on' ? <>
            {!faceFound && <span className="hint float">looking for a face…</span>}
            {/* the next step, offered where the user is actually looking */}
            {faceFound && !profile && (
              <div className="nudge">
                <b>measure your face</b>
                <span>look straight ahead — one second, and every frame gets sized to your head</span>
                <button className="tiny" onClick={measureMe} disabled={measuring}>
                  {measuring ? 'hold still…' : 'measure'}
                </button>
              </div>
            )}
            <div className="stagebar">
              <button onClick={flip} title="flip camera">⟲ {facing === 'user' ? 'front' : 'back'}</button>
              <button onClick={autoFit} disabled={!faceFound}>auto fit</button>
              <button onClick={takeShot}>snapshot</button>
            </div>
          </> : (
            <button className="big go" disabled={status === 'starting'} onClick={() => start('user')}>
              {status === 'starting' ? 'starting…' : status === 'denied' ? 'camera blocked — check permissions' : 'turn on camera'}
            </button>
          )}
        </div>

        <aside className="right">
          <h2>my face</h2>
          {profile ? (
            <div className="profile">
              <p>
                <b>{profile.faceWidthMm}mm</b> wide · temple <b>{profile.templeLenMm}mm</b>
              </p>
              <label>
                pd <input type="number" min="50" max="80" step="0.5" value={profile.pdMm}
                          onChange={e => setProfile(withPd(profile, +e.target.value || DEFAULT_PD_MM))} /> mm
              </label>
              <p className="hint">
                {profile.pdMm === DEFAULT_PD_MM ? 'pd is the adult average — put yours in for real sizes'
                                                : 'sized to your pd'}
              </p>
              <div className="row">
                <button className="tiny ghost" onClick={measureMe} disabled={!faceFound || measuring}>
                  measure again
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row">
                <button className="tiny" onClick={measureMe} disabled={!faceFound || measuring}>
                  {measuring ? 'hold still…' : 'measure my face'}
                </button>
              </div>
              <p className="hint">
                {faceFound ? 'measure once and uploaded frames get sized to your head'
                           : 'turn on the camera and look straight ahead'}
              </p>
            </>
          )}

          <h2>fit</h2>
          {slider('w', 'width', 0.6, 1.6, 0.01, v => v.toFixed(2) + '×')}
          {slider('h', 'height', 0.6, 1.6, 0.01, v => v.toFixed(2) + '×')}
          {slider('x', 'x position', -0.3, 0.3, 0.01, v => v.toFixed(2))}
          {slider('y', 'y position', -0.4, 0.4, 0.01, v => v.toFixed(2))}
          {slider('scale', 'scale', 0.7, 1.4, 0.01, v => v.toFixed(2) + '×')}
          {slider('r', 'rotation', -15, 15, 0.5, v => v.toFixed(1) + '°')}
          <div className="row"><button className="tiny ghost" onClick={() => setFit(DEFAULT_FIT)}>reset fit</button></div>

          <h2>frame</h2>
          {ovSlider('thickness', 'thickness', 0.4, 2.4, 0.05, 1, v => v.toFixed(2) + '×')}
          {ovSlider('frameOpacity', 'opacity', 0.3, 1, 0.05, 1, v => Math.round(v * 100) + '%')}
          <div className="sw">
            {FRAME_COLORS.map(c => (
              <button key={c} className={'ch' + (opts.frameColor === c ? ' on' : '')} style={{ background: c }}
                    onClick={() => setOverride({ frameColor: c })} aria-label={'frame ' + c} />
            ))}
          </div>

          <h2>lens</h2>
          {ovSlider('lensOpacity', 'tint strength', 0, 0.7, 0.02, frame.asset.lensOpacity, v => Math.round(v * 100) + '%')}
          <div className="sw">
            {LENS_COLORS.map(c => (
              <button key={c} className={'ch' + (opts.lensColor === c ? ' on' : '')} style={{ background: c }}
                    onClick={() => setOverride({ lensColor: c })} aria-label={'lens ' + c} />
            ))}
          </div>

          <h2>shape override</h2>
          <div className="seg wide">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => applyPresetShape(p.id)}>{p.name}</button>
            ))}
          </div>
          <p className="hint">replaces the traced outline with a preset — only if the extraction was off.</p>

          <h2>view</h2>
          <div className="row">
            <button className="big ghost" onClick={makeSheet} disabled={mode !== '3d'}>spec sheet ↧</button>
          </div>

          <div className="row">
            <button className="big" onClick={() => setWorn(!worn)}>{worn ? 'remove glasses' : 'try on'}</button>
          </div>
        </aside>
      </main>

      {shots.length > 0 && (
        <div className="tray">
          {shots.map(s => (
            <div key={s.id} className="shot">
              <img src={s.url} alt="snapshot" onClick={() => download(s.url, 'tryon-' + s.id + '.png')} />
              <button onClick={() => setShots(v => v.filter(x => x.id !== s.id))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {file && <ExtractModal file={file} profile={profile} onDone={addFrame} onCancel={() => setFile(null)} />}
      {sheet && (
        <div className="overlay" onClick={() => setSheet(null)}>
          <div className="panel" onClick={e => e.stopPropagation()}>
            <h2>spec sheet</h2>
            <img src={sheet} alt="spec sheet" style={{ maxWidth: '100%', border: '1px solid var(--line)' }} />
            <div className="row">
              <button className="big" onClick={() => download(sheet, frame.name + '-spec.png')}>download</button>
              <button className="big ghost" onClick={() => setSheet(null)}>close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
