import { useRef, useState } from 'react';
import { extractFrame } from './frame.js';

const STEPS = ['01. detecting shape', '02. analyzing color', '03. building model'];

/** Upload → drag a box round the glasses → key out the background → new frame. */
export default function ExtractModal({ file, onDone, onCancel }) {
  const imgRef = useRef(null);
  const drag = useRef(null);
  const [sel, setSel] = useState(null);      // in displayed pixels
  const [tol, setTol] = useState(60);
  const [built, setBuilt] = useState(null);  // canvas once extracted
  const [step, setStep] = useState(-1);
  const [url] = useState(() => URL.createObjectURL(file));

  const down = e => {
    const r = imgRef.current.getBoundingClientRect();
    drag.current = { x0: e.clientX - r.left, y0: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const { x0, y0 } = drag.current, x1 = e.clientX - r.left, y1 = e.clientY - r.top;
    setSel({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
  };
  const up = () => { drag.current = null; };

  async function build() {
    const img = imgRef.current;
    const k = img.naturalWidth / img.getBoundingClientRect().width;   // displayed → natural px
    const box = sel && sel.w > 8 && sel.h > 8
      ? { x: sel.x * k, y: sel.y * k, w: sel.w * k, h: sel.h * k }
      : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };

    const canvas = extractFrame(img, box, tol);
    setBuilt(canvas);
    for (let i = 0; i < STEPS.length; i++) {
      setStep(i);
      await new Promise(r => setTimeout(r, 400));
    }
    URL.revokeObjectURL(url);
    onDone(canvas);
  }

  return (
    <div className="overlay">
      <div className="panel">
        {built ? (
          <>
            <h2>building your frame</h2>
            {STEPS.map((s, i) => (
              <div key={s}>
                <p>{s}</p>
                <div className="bar"><i style={{ width: step >= i ? '100%' : '0' }} /></div>
              </div>
            ))}
            <img alt="" src={built.toDataURL()} style={{ maxWidth: '100%' }} />
          </>
        ) : (
          <>
            <h2>select your frame</h2>
            <p className="hint">drag a box around the glasses you want.</p>
            <div className="cropbox" onPointerDown={down} onPointerMove={move} onPointerUp={up}>
              <img ref={imgRef} src={url} alt="uploaded" />
              {sel && <div className="sel" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }} />}
            </div>
            <label>background cut <b>{tol}</b></label>
            <input type="range" min="10" max="140" value={tol} onChange={e => setTol(+e.target.value)} />
            <div className="row">
              <button className="big" onClick={build}>extract frame</button>
              <button className="big ghost" onClick={() => { URL.revokeObjectURL(url); onCancel(); }}>cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
