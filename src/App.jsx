import { useRef, useState } from 'react';
import { useTryOn } from './useTryOn.js';
import ExtractModal from './ExtractModal.jsx';
import Thumb from './Thumb.jsx';

const FRAME_COLORS = ['#111111', '#c98b2e', '#b9bcc0', '#a92b2b', '#2f4f9b', '#f0ece2'];
const LENS_COLORS = ['#ffffff10', '#3a3a3a80', '#6b4a2280', '#2b4d8c80', '#00000000'];
const PRESETS = [
  { id: 'round', name: 'round', shape: 'round' },
  { id: 'square', name: 'square', shape: 'square' },
  { id: 'cat', name: 'cat-eye', shape: 'cat' },
];
// eyeSpan → frame width. Real faces and cameras vary; the fit sliders are the calibration.
const DEFAULT_FIT = { w: 1.55, h: 1, y: -0.06, r: 0 };

export default function App() {
  const [frames, setFrames] = useState(PRESETS);
  const [activeId, setActiveId] = useState('round');
  const [frameColor, setFrameColor] = useState(FRAME_COLORS[0]);
  const [lensColor, setLensColor] = useState(LENS_COLORS[0]);
  const [fit, setFit] = useState(DEFAULT_FIT);
  const [worn, setWorn] = useState(false);
  const [file, setFile] = useState(null);
  const fileInput = useRef(null);

  const frame = frames.find(f => f.id === activeId);
  const paramsRef = useRef(null);
  paramsRef.current = { frame, fit, frameColor, lensColor, worn };  // latest state for the render loop

  const { videoRef, canvasRef, status, faceFound, start } = useTryOn(paramsRef);

  const addFrame = canvas => {
    const f = { id: 'f' + Date.now(), name: 'frame ' + (frames.length + 1), canvas };
    setFrames([...frames, f]); setActiveId(f.id); setFile(null);
  };

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
        <span className="hint">find it. try it on.</span>
        <span className="hint">
          {status === 'on' ? <><span className="dot">●</span> camera on</> : `● camera ${status}`}
        </span>
      </header>

      <main>
        <aside>
          <h2>my frames</h2>
          <div className="frames">
            {frames.map(f => (
              <button key={f.id} className={'chip' + (f.id === activeId ? ' on' : '')}
                      onClick={() => setActiveId(f.id)}>
                <Thumb frame={f} />{f.name}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="big ghost" onClick={() => fileInput.current.click()}>+ upload image</button>
          </div>
          <input ref={fileInput} type="file" accept="image/*" hidden
                 onChange={e => { setFile(e.target.files[0]); e.target.value = ''; }} />
        </aside>

        <div className="stage">
          <video ref={videoRef} playsInline muted hidden />
          <canvas ref={canvasRef} />
          {status === 'on'
            ? !faceFound && <span className="hint" style={{ position: 'absolute', top: 20 }}>looking for a face…</span>
            : <button className="big" style={{ position: 'absolute', width: 'auto' }}
                      disabled={status === 'starting'} onClick={start}>
                {status === 'starting' ? 'starting…' : 'turn on camera'}
              </button>}
        </div>

        <aside>
          <h2>frame color</h2>
          <div className="sw">
            {FRAME_COLORS.map(c => (
              <span key={c} className={c === frameColor ? 'on' : ''} style={{ background: c }}
                    onClick={() => setFrameColor(c)} />
            ))}
          </div>
          <h2>lens</h2>
          <div className="sw">
            {LENS_COLORS.map(c => (
              <span key={c} className={c === lensColor ? 'on' : ''}
                    style={{ background: c === '#00000000' ? 'repeating-linear-gradient(45deg,#333 0 4px,#111 4px 8px)' : c }}
                    onClick={() => setLensColor(c)} />
            ))}
          </div>
          <h2>fit</h2>
          {slider('w', 'width', 1.1, 2.2, 0.01, v => v.toFixed(2) + '×')}
          {slider('h', 'height', 0.6, 1.6, 0.01, v => v.toFixed(2) + '×')}
          {slider('y', 'position', -0.5, 0.5, 0.01, v => v.toFixed(2))}
          {slider('r', 'rotation', -15, 15, 0.5, v => v.toFixed(1) + '°')}
          <div className="row">
            <button className="big" onClick={() => setWorn(!worn)}>
              {worn ? 'remove glasses' : 'try on'}
            </button>
          </div>
        </aside>
      </main>

      {file && <ExtractModal file={file} onDone={addFrame} onCancel={() => setFile(null)} />}
    </>
  );
}
