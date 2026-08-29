import { useEffect, useRef, useState } from 'react';
import { detectInImage } from './extract.js';
import { measureFrame } from './measure.js';
import { drawVector } from './frame.js';

const sam = () => import('./segment.js');   // ~2 MB of runtime, only once someone uploads

/**
 * Upload → find the face → SAM masks the glasses → we *measure* it (shape, rim weight,
 * frame colour, lens tint, where it sat) and add it straight to My Frames.
 * Nothing from the photo is pasted, so a messy cut can't smear onto the face.
 * Shape / rim / colour are all tuned afterwards on the main screen.
 * Wrong mask? click the glasses to add a point, alt-click to exclude.
 */
export default function ExtractModal({ file, onDone, onCancel }) {
  const imgRef = useRef(null);
  const ctxRef = useRef(null);                    // encoded image, reused for every click
  const lmRef = useRef(null);                     // face landmarks of the photo
  const previewRef = useRef(null);
  const [url] = useState(() => URL.createObjectURL(file));
  const [stage, setStage] = useState('model');    // model | encode | read | idle | error
  const [error, setError] = useState('');
  const [pct, setPct] = useState(0);
  const [secs, setSecs] = useState(0);
  const [points, setPoints] = useState(null);
  const [backend, setBackend] = useState('');
  const [spec, setSpec] = useState(null);         // measured frame spec

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    if (stage === 'idle' || stage === 'error') return;
    const t0 = performance.now();
    const id = setInterval(() => setSecs((performance.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [stage]);

  // live preview of the modelled frame
  useEffect(() => {
    const c = previewRef.current;
    if (!c || !spec) return;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.save();
    x.translate(c.width / 2, c.height / 2); x.scale(c.width * 0.92, c.width * 0.92);
    drawVector(x, spec.shape, spec.frameColor, spec.lensColor, 0, spec.rim);
    x.restore();
  }, [spec]);

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
      lmRef.current = lm;
      if (lm) setPoints(pickPoints(lm, img.naturalWidth, img.naturalHeight));
      else setStage('idle');
    } catch (e) {
      setError(String(e.message || e));
      setStage('error');
    }
  }

  // (re-)segment + measure whenever the prompt points change
  useEffect(() => {
    if (!points?.length || !ctxRef.current) return;
    let stale = false;
    (async () => {
      try {
        setStage('read');
        const { segment } = await sam();
        const { mask, width, height } = await segment(ctxRef.current, points);
        if (stale) return;

        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(imgRef.current, 0, 0, width, height);
        const imgData = cx.getImageData(0, 0, width, height);

        const m = measureFrame(imgData, mask, width, height, lmRef.current || null);
        setSpec(m);
        setStage('idle');
      } catch (e) { setError(String(e.message || e)); setStage('error'); }
    })();
    return () => { stale = true; };
  }, [points]);

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

  // a small persistent thumbnail of the source photo (the object URL dies with the modal)
  function srcThumb() {
    const img = imgRef.current;
    const s = 96 / Math.max(img.naturalWidth, img.naturalHeight);
    const t = document.createElement('canvas');
    t.width = Math.round(img.naturalWidth * s); t.height = Math.round(img.naturalHeight * s);
    t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.7);
  }

  const use = () => spec && onDone({
    shape: spec.shape, rim: spec.rim, frameColor: spec.frameColor, lensColor: spec.lensColor,
    spanRatio: spec.spanRatio, yRatio: spec.yRatio, srcThumb: srcThumb(),
  });

  const note = {
    model: `01. loading the model — ${Math.round(pct * 100)}% (first upload only)`,
    encode: `02. reading the photo — ${backend}`,
    read: '03. measuring the frame',
    idle: spec
      ? (spec.ok ? 'measured — shape, rim and colour are all adjustable after you add it.'
                 : 'not sure that is glasses. add it anyway and fix the shape on the right, or click the frame to guide the mask.')
      : 'no face found — click on the glasses.',
    error: 'it broke: ' + error,
  }[stage];

  return (
    <div className="overlay">
      <div className="panel">
        <h2>{stage === 'idle' ? 'your frame' : stage === 'error' ? 'that did not work' : 'reading your frame'}</h2>
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
          <canvas ref={previewRef} width={260} height={130}
                  style={{ display: spec ? 'block' : 'none', maxWidth: '100%' }} />
          {!spec && <span className="hint">{stage === 'idle' || stage === 'error' ? 'nothing yet' : 'working…'}</span>}
        </div>
        {spec && <p className="hint">read as <b>{spec.shape}</b>, rim {spec.rim.toFixed(1)}×,
          colour <span style={{ color: spec.frameColor }}>■</span> {spec.frameColor}</p>}

        <div className="row">
          <button className="big" disabled={!spec || stage !== 'idle'} onClick={use}>add to my frames</button>
          <button className="big ghost" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}
