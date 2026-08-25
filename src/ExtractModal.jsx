import { useEffect, useRef, useState } from 'react';
import { detectInImage, glassesBox, maskGlasses, trim } from './extract.js';
import { poseFromEyes } from './frame.js';

/**
 * Upload → find the face → cut the glasses off it → new frame.
 * No face in the photo (a product shot): the user drags the box instead.
 */
export default function ExtractModal({ file, onDone, onCancel }) {
  const imgRef = useRef(null);
  const drag = useRef(null);
  const [url] = useState(() => URL.createObjectURL(file));
  const [phase, setPhase] = useState('loading');   // loading | ready | building
  const [face, setFace] = useState(null);          // {box, eyeSpan, eyeY} in natural px
  const [manual, setManual] = useState(null);      // box in displayed px
  const [sens, setSens] = useState(1);
  const [cut, setCut] = useState(null);            // {canvas, spanRatio, yRatio}

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  async function onLoad() {
    const img = imgRef.current;
    const lm = await detectInImage(img).catch(() => null);
    if (lm) {
      const p = poseFromEyes(lm[33], lm[263], img.naturalWidth, img.naturalHeight);
      setFace({ box: glassesBox(lm, img.naturalWidth, img.naturalHeight), eyeSpan: p.eyeSpan, eyeY: p.cy });
    }
    setPhase('ready');
  }

  // re-cut whenever the box or the sensitivity changes
  useEffect(() => {
    if (phase !== 'ready') return;
    const img = imgRef.current;
    const k = img.naturalWidth / img.getBoundingClientRect().width;
    const box = manual && manual.w > 8
      ? { x: manual.x * k, y: manual.y * k, w: manual.w * k, h: manual.h * k }
      : face?.box;
    if (!box) { setCut(null); return; }

    const c = document.createElement('canvas');
    c.width = Math.round(box.w); c.height = Math.round(box.h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
    x.putImageData(maskGlasses(x.getImageData(0, 0, c.width, c.height), sens), 0, 0);
    const t = trim(c);
    if (!t) { setCut(null); return; }
    // how wide the frame was on that face, and how high it sat above the eyes
    const span = face?.eyeSpan ?? t.width / 1.55;
    const yMid = box.y + (t.height / 2);
    setCut({ canvas: t, spanRatio: t.width / span, yRatio: face ? (yMid - face.eyeY) / span : -0.09 });
  }, [phase, sens, manual, face]);

  const down = e => {
    const r = imgRef.current.getBoundingClientRect();
    drag.current = { x0: e.clientX - r.left, y0: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const { x0, y0 } = drag.current, x1 = e.clientX - r.left, y1 = e.clientY - r.top;
    setManual({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
  };

  const boxOnScreen = () => {
    if (manual) return manual;
    const img = imgRef.current;
    if (!face || !img) return null;
    const k = img.getBoundingClientRect().width / img.naturalWidth;
    return { x: face.box.x * k, y: face.box.y * k, w: face.box.w * k, h: face.box.h * k };
  };
  const b = phase === 'ready' ? boxOnScreen() : null;

  return (
    <div className="overlay">
      <div className="panel">
        <h2>{phase === 'building' ? 'building your frame' : 'select your frame'}</h2>
        <p className="hint">
          {phase === 'loading' ? 'looking for glasses…'
            : face ? 'found the glasses. not right? drag your own box.'
            : 'no face here — drag a box around the glasses.'}
        </p>

        <div className="cropbox" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)}>
          <img ref={imgRef} src={url} alt="uploaded" onLoad={onLoad} />
          {b && <div className="sel" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />}
        </div>

        <div className="preview">
          {cut ? <img alt="extracted frame" src={cut.canvas.toDataURL()} />
               : <span className="hint">nothing found — move the slider</span>}
        </div>

        <label>detail <b>{sens.toFixed(2)}</b></label>
        <input type="range" min="0.6" max="1.5" step="0.01" value={sens}
               onChange={e => setSens(+e.target.value)} />

        <div className="row">
          <button className="big" disabled={!cut} onClick={() => onDone(cut)}>use this frame</button>
          <button className="big ghost" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}
