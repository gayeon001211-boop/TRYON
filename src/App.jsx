import { useEffect, useRef, useState } from 'react';
import { useTryOn } from './useTryOn.js';
import { smartFit } from './frame.js';
import ExtractModal from './ExtractModal.jsx';
import Thumb from './Thumb.jsx';
import { load, save } from './store.js';

const FRAME_COLORS = ['#111111', '#c98b2e', '#b9bcc0', '#a92b2b', '#2f4f9b', '#f0ece2'];
const LENS_COLORS = ['#ffffff10', '#3a3a3a80', '#6b4a2280', '#2b4d8c80', '#00000000'];
const PRESETS = [
  { id: 'round', name: 'round', shape: 'round', spanRatio: 1.55, yRatio: -0.09 },
  { id: 'square', name: 'square', shape: 'square', spanRatio: 1.55, yRatio: -0.09 },
  { id: 'cat', name: 'cat-eye', shape: 'cat', spanRatio: 1.55, yRatio: -0.09 },
];
const DEFAULT_FIT = { w: 1, h: 1, y: 0, r: 0 };
const download = (url, name) => {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
};

export default function App() {
  const [frames, setFrames] = useState(PRESETS);
  const [activeId, setActiveId] = useState('round');
  const [frameColor, setFrameColor] = useState(FRAME_COLORS[0]);
  const [lensColor, setLensColor] = useState(LENS_COLORS[0]);
  const [fit, setFit] = useState(DEFAULT_FIT);
  const [worn, setWorn] = useState(false);
  const [file, setFile] = useState(null);
  const [mode, setMode] = useState('3d');
  const [compareIds, setCompareIds] = useState([]);   // 0, 1 or 2 ids -> compare when 2
  const [shots, setShots] = useState([]);
  const [editing, setEditing] = useState(null);
  const [sheet, setSheet] = useState(null);
  const fileInput = useRef(null);
  const hydrated = useRef(false);

  const frame = frames.find(f => f.id === activeId) || frames[0];
  const comparing = compareIds.length === 2;
  const compareFrames = comparing ? compareIds.map(id => frames.find(f => f.id === id)).filter(Boolean) : null;

  const paramsRef = useRef(null);
  paramsRef.current = {
    frame, fit, frameColor, lensColor, worn, mode,
    compare: comparing && compareFrames?.length === 2 ? compareFrames : null,
  };

  const { videoRef, canvasRef, glCanvasRef, status, faceFound, facing, start, flip, snapshot, contactSheet, sample } = useTryOn(paramsRef);

  // load saved collection once
  useEffect(() => {
    load().then(saved => {
      hydrated.current = true;
      if (!saved) return;
      if (saved.frames?.length) setFrames([...PRESETS, ...saved.frames]);
      const s = saved.settings || {};
      if (s.frameColor) setFrameColor(s.frameColor);
      if (s.lensColor) setLensColor(s.lensColor);
      if (s.mode) setMode(s.mode);
    });
  }, []);

  // persist on change (after hydration)
  useEffect(() => {
    if (!hydrated.current) return;
    save(frames, { frameColor, lensColor, mode });
  }, [frames, frameColor, lensColor, mode]);

  // switch the active frame; a measured frame carries its own colours, so mirror them
  // onto the swatches (the user can still override afterwards)
  const pickFrame = id => {
    setActiveId(id);
    const f = frames.find(x => x.id === id);
    if (f?.frameColor) setFrameColor(f.frameColor);
    if (f?.lensColor) setLensColor(f.lensColor);
  };

  const addFrame = f => {
    const nf = { id: 'f' + Date.now(), name: 'frame ' + (frames.length - PRESETS.length + 1), user: true, ...f };
    setFrames([...frames, nf]);
    setActiveId(nf.id);
    if (f.frameColor) setFrameColor(f.frameColor);
    if (f.lensColor) setLensColor(f.lensColor);
    setFit(DEFAULT_FIT);
    setFile(null); setWorn(true);
  };

  const removeFrame = id => {
    setFrames(fs => fs.filter(f => f.id !== id));
    setCompareIds(ids => ids.filter(x => x !== id));
    if (activeId === id) pickFrame('round');
  };

  const rename = (id, name) => setFrames(fs => fs.map(f => f.id === id ? { ...f, name } : f));

  const toggleCompare = id => setCompareIds(ids =>
    ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id].slice(-2));

  const autoFit = () => {
    const { lm } = sample();
    if (!lm) return;
    setFit(smartFit(lm, frame, canvasRef.current.width, canvasRef.current.height));
  };

  const takeShot = () => {
    const url = snapshot();
    if (url) setShots(s => [{ id: Date.now(), url }, ...s].slice(0, 12));
  };

  const makeSheet = () => {
    const c = contactSheet();
    if (c) setSheet(c.toDataURL('image/png'));
  };

  // edit the active frame in place (shape / rim weight). Persists via the frames effect.
  const patchFrame = patch => setFrames(fs => fs.map(f => f.id === activeId ? { ...f, ...patch } : f));

  const slider = (key, label, min, max, step, fmt) => (
    <div key={key}>
      <label>{label} <b>{fmt(fit[key])}</b></label>
      <input type="range" min={min} max={max} step={step} value={fit[key]}
             onChange={e => setFit({ ...fit, [key]: +e.target.value })} />
    </div>
  );

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
          <h2>my frames</h2>
          <div className="frames">
            {frames.map(f => (
              <div key={f.id} className={'chip' + (f.id === activeId ? ' on' : '') + (compareIds.includes(f.id) ? ' cmp' : '')}>
                <button className="pick" onClick={() => pickFrame(f.id)}>
                  <Thumb frame={f} />
                  {editing === f.id ? (
                    <input autoFocus defaultValue={f.name}
                           onBlur={e => { rename(f.id, e.target.value.trim() || f.name); setEditing(null); }}
                           onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                  ) : (
                    <span onDoubleClick={() => f.user && setEditing(f.id)}>{f.name}</span>
                  )}
                </button>
                <div className="chipbtns">
                  <button title="compare" className={compareIds.includes(f.id) ? 'on' : ''}
                          onClick={() => toggleCompare(f.id)}>A/B</button>
                  {f.user && <>
                    {f.canvas && <button title="download PNG"
                          onClick={() => download(f.canvas.toDataURL('image/png'), f.name + '.png')}>↓</button>}
                    <button title="delete" onClick={() => removeFrame(f.id)}>✕</button>
                  </>}
                </div>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="big ghost" onClick={() => fileInput.current.click()}>+ upload image</button>
          </div>
          {comparing && <p className="hint">comparing 2 frames — split view. tap A/B to clear.</p>}
          <input ref={fileInput} type="file" accept="image/*" hidden
                 onChange={e => { setFile(e.target.files[0]); e.target.value = ''; }} />
        </aside>

        <div className="stage">
          <video ref={videoRef} playsInline muted hidden />
          <canvas ref={canvasRef} className="c2d" />
          <canvas ref={glCanvasRef} className={'cgl' + (mode === '3d' && !comparing ? '' : ' off')} />
          {status === 'on' ? <>
            {!faceFound && <span className="hint float">looking for a face…</span>}
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
          {frame?.user && !frame.canvas && (
            <>
              <h2>shape — from your photo</h2>
              <div className="seg wide">
                {['round', 'square', 'cat'].map(sh => (
                  <button key={sh} className={frame.shape === sh ? 'on' : ''}
                          onClick={() => patchFrame({ shape: sh })}>{sh}</button>
                ))}
              </div>
              <label>rim <b>{(frame.rim ?? 1).toFixed(1)}×</b></label>
              <input type="range" min={0.4} max={2.4} step={0.05} value={frame.rim ?? 1}
                     onChange={e => patchFrame({ rim: +e.target.value })} />
            </>
          )}

          <h2>frame color</h2>
          <div className="sw">
            {FRAME_COLORS.map(c => (
              <button key={c} className={'ch' + (c === frameColor ? ' on' : '')} style={{ background: c }}
                    onClick={() => setFrameColor(c)} aria-label={'frame ' + c} />
            ))}
          </div>
          <h2>lens</h2>
          <div className="sw">
            {LENS_COLORS.map(c => (
              <button key={c} className={'ch' + (c === lensColor ? ' on' : '')}
                    style={{ background: c === '#00000000' ? 'repeating-linear-gradient(45deg,#333 0 4px,#111 4px 8px)' : c }}
                    onClick={() => setLensColor(c)} aria-label={'lens ' + c} />
            ))}
          </div>
          <h2>fit</h2>
          {slider('w', 'width', 0.6, 1.6, 0.01, v => v.toFixed(2) + '×')}
          {slider('h', 'height', 0.6, 1.6, 0.01, v => v.toFixed(2) + '×')}
          {slider('y', 'position', -0.4, 0.4, 0.01, v => v.toFixed(2))}
          {slider('r', 'rotation', -15, 15, 0.5, v => v.toFixed(1) + '°')}
          <div className="row"><button className="tiny ghost" onClick={() => setFit(DEFAULT_FIT)}>reset fit</button></div>

          <h2>3D model</h2>
          <div className="row">
            <button className="big ghost" onClick={makeSheet} disabled={mode !== '3d'}>spec sheet ↧</button>
          </div>
          <p className="hint">front · 3/4 · side · top of the built model on one plate.</p>

          <div className="row">
            <button className="big" onClick={() => setWorn(!worn)}>
              {worn ? 'remove glasses' : 'try on'}
            </button>
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

      {file && <ExtractModal file={file} onDone={addFrame} onCancel={() => setFile(null)} />}
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
