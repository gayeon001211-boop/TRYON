import { useEffect, useRef, useState } from 'react';
import { detectInImage, cutOut, trim } from './extract.js';
import { poseFromEyes } from './frame.js';

const sam = () => import('./segment.js');   // ~2 MB of runtime, only once someone uploads

/**
 * Upload → find the face → let SAM cut the glasses off it.
 * No knobs: if the cut is wrong, click the glasses to add a point
 * (alt-click to mark something that should be left out).
 */
export default function ExtractModal({ file, onDone, onCancel }) {
  const imgRef = useRef(null);
  const ctxRef = useRef(null);                   // encoded image, reused for every click
  const [url] = useState(() => URL.createObjectURL(file));
  const [stage, setStage] = useState('model');   // model | encode | cut | idle | error
  const [error, setError] = useState('');
  const [pct, setPct] = useState(0);
  const [secs, setSecs] = useState(0);
  const [points, setPoints] = useState(null);
  const [face, setFace] = useState(null);        // {eyeSpan, eyeY} in natural px
  const [backend, setBackend] = useState('');
  const [cut, setCut] = useState(null);          // {canvas, spanRatio, yRatio}

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // a ticking clock, so a slow step never looks like a frozen one
  useEffect(() => {
    if (stage === 'idle' || stage === 'error') return;
    const t0 = performance.now();
    const id = setInterval(() => setSecs((performance.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [stage]);

  async function onLoad() {
    const img = imgRef.current;
    try {
      const { loadSam, embed, pickPoints } = await sam();

      setStage('model');
      const [, lm] = await Promise.all([
        loadSam(p => setPct(p)),
        detectInImage(img).catch(() => null),
      ]);

      setBackend((await sam()).backend);
      setStage('encode');
      ctxRef.current = await embed(file);

      if (lm) {
        const p = poseFromEyes(lm[33], lm[263], img.naturalWidth, img.naturalHeight);
        setFace({ eyeSpan: p.eyeSpan, eyeY: p.cy });
        setPoints(pickPoints(lm, img.naturalWidth, img.naturalHeight));
      } else {
        setStage('idle');
      }
    } catch (e) {
      setError(String(e.message || e));
      setStage('error');
    }
  }

  // (re-)cut whenever the prompt points change — decoding is milliseconds
  useEffect(() => {
    if (!points?.length || !ctxRef.current) return;
    let stale = false;
    (async () => {
      try {
      setStage('cut');
      const { segment } = await sam();
      const img = imgRef.current;
      const { mask, width, height } = await segment(ctxRef.current, points);
      if (stale) return;
      const t = trim(cutOut(img, mask, width, height));
      const span = face?.eyeSpan ?? (t ? t.canvas.width / 1.55 : 1);
      setCut(t && {
        canvas: t.canvas,
        spanRatio: t.canvas.width / span,
        yRatio: face ? (t.y + t.canvas.height / 2 - face.eyeY) / span : -0.09,
      });
      setStage('idle');
      } catch (e) { setError(String(e.message || e)); setStage('error'); }
    })();
    return () => { stale = true; };
  }, [points, face]);

  const addPoint = e => {
    if (stage !== 'idle') return;
    const img = imgRef.current, r = img.getBoundingClientRect();
    const k = img.naturalWidth / r.width;
    const p = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    setPoints([...(points ?? []), { p, label: e.altKey ? 0 : 1 }]);
  };

  const dots = () => {
    const img = imgRef.current;
    if (!points || !img) return null;
    const k = img.getBoundingClientRect().width / img.naturalWidth;
    return points.map((q, i) => (
      <i key={i} className={'pt' + (q.label ? '' : ' out')} style={{ left: q.p[0] * k, top: q.p[1] * k }} />
    ));
  };

  const note = {
    model: `01. loading the model — ${Math.round(pct * 100)}% (first upload only)`,
    encode: `02. reading the photo — ${backend}`,
    cut: '03. cutting the glasses out',
    idle: points ? 'wrong bit? click to add a point, alt-click to exclude.'
                 : 'no face found — click on the glasses.',
    error: 'it broke: ' + error,
  }[stage];

  return (
    <div className="overlay">
      <div className="panel">
        <h2>{stage === 'idle' ? 'your frame' : stage === 'error' ? 'that did not work' : 'building your frame'}</h2>
        <p className="hint">{note} {stage !== 'idle' && stage !== 'error' && <b>{secs.toFixed(1)}s</b>}</p>
        <div className="bar">
          <i className={stage === 'model' ? '' : stage === 'idle' || stage === 'error' ? 'done' : 'busy'}
             style={{ width: stage === 'model' ? `${pct * 100}%` : '100%' }} />
        </div>

        <div className="cropbox" onClick={addPoint}>
          <img ref={imgRef} src={url} alt="uploaded" onLoad={onLoad} />
          {dots()}
        </div>

        <div className="preview">
          {cut ? <img alt="extracted frame" src={cut.canvas.toDataURL()} />
               : <span className="hint">{stage === 'idle' || stage === 'error' ? 'nothing found yet' : 'working…'}</span>}
        </div>

        <div className="row">
          <button className="big" disabled={!cut || stage !== 'idle'} onClick={() => onDone(cut)}>use this frame</button>
          <button className="big ghost" disabled={!cut} onClick={() => {
            const a = document.createElement('a');
            a.href = cut.canvas.toDataURL('image/png'); a.download = 'frame.png'; a.click();
          }}>png ↧</button>
          <button className="big ghost" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}
