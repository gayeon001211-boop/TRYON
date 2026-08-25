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
  const [url] = useState(() => URL.createObjectURL(file));
  const [note, setNote] = useState('loading the model…');
  const [busy, setBusy] = useState(true);
  const [points, setPoints] = useState(null);
  const [face, setFace] = useState(null);        // {eyeSpan, eyeY} in natural px
  const [cut, setCut] = useState(null);          // {canvas, spanRatio, yRatio}

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  async function onLoad() {
    const img = imgRef.current;
    (await sam()).loadSam(p => setNote(`loading the model… ${Math.round(p * 100)}%`));
    const lm = await detectInImage(img).catch(() => null);
    if (!lm) {
      setBusy(false);
      setNote('no face found — click on the glasses.');
      return;
    }
    const p = poseFromEyes(lm[33], lm[263], img.naturalWidth, img.naturalHeight);
    setFace({ eyeSpan: p.eyeSpan, eyeY: p.cy });
    setPoints((await sam()).pickPoints(lm, img.naturalWidth, img.naturalHeight));
  }

  // (re-)segment whenever the prompt points change
  useEffect(() => {
    if (!points?.length) return;
    let stale = false;
    (async () => {
      setBusy(true); setNote('cutting the glasses out…');
      const img = imgRef.current;
      const { mask, width, height } = await (await sam()).segment(img, points);
      if (stale) return;
      const t = trim(cutOut(img, mask, width, height));
      if (!t) { setCut(null); setNote('nothing found — click on the glasses.'); setBusy(false); return; }
      const span = face?.eyeSpan ?? t.canvas.width / 1.55;
      setCut({
        canvas: t.canvas,
        spanRatio: t.canvas.width / span,
        yRatio: face ? (t.y + t.canvas.height / 2 - face.eyeY) / span : -0.09,
      });
      setNote('wrong bit? click to add a point, alt-click to exclude.');
      setBusy(false);
    })();
    return () => { stale = true; };
  }, [points, face]);

  const addPoint = e => {
    if (busy) return;
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

  return (
    <div className="overlay">
      <div className="panel">
        <h2>{busy ? 'building your frame' : 'your frame'}</h2>
        <p className="hint">{note}</p>

        <div className="cropbox" onClick={addPoint}>
          <img ref={imgRef} src={url} alt="uploaded" onLoad={onLoad} />
          {dots()}
        </div>

        <div className="preview">
          {cut ? <img alt="extracted frame" src={cut.canvas.toDataURL()} />
               : <span className="hint">{busy ? 'working…' : 'no frame yet'}</span>}
        </div>

        <div className="row">
          <button className="big" disabled={!cut || busy} onClick={() => onDone(cut)}>use this frame</button>
          <button className="big ghost" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}
