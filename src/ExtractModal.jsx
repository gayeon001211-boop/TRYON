import { useEffect, useRef, useState } from 'react';
import { detectInImage } from './extract.js';
import { buildAsset } from './glassesAsset.js';
import { drawAssetFront } from './assetRender.js';

const sam = () => import('./segment.js');
const model3d = () => import('./glassesModel.js');
const three = () => import('three');

/**
 * Upload → SAM masks the glasses → buildAsset traces the real outline + lens openings
 * → preview the asset (front / 3-4 / side, all from the asset, never the photo)
 * → ADD TO MY FRAMES. Shape/rim/colour are tuned afterwards on the main screen.
 * Bad mask? click the frame to add a point, alt-click to exclude.
 */
export default function ExtractModal({ file, onDone, onCancel }) {
  const imgRef = useRef(null);
  const ctxRef = useRef(null);
  const lmRef = useRef(null);
  const maskRef = useRef(null);         // { mask, width, height } last SAM result
  const [url] = useState(() => URL.createObjectURL(file));
  const [stage, setStage] = useState('model');   // model | encode | trace | idle | error
  const [error, setError] = useState('');
  const [pct, setPct] = useState(0);
  const [secs, setSecs] = useState(0);
  const [points, setPoints] = useState(null);
  const [backend, setBackend] = useState('');
  const [asset, setAsset] = useState(null);
  const [showDebug, setShowDebug] = useState(false);

  const frontRef = useRef(null);
  const tqRef = useRef(null);
  const sideRef = useRef(null);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    if (stage === 'idle' || stage === 'error') return;
    const t0 = performance.now();
    const id = setInterval(() => setSecs((performance.now() - t0) / 1000), 100);
    return () => clearInterval(id);
  }, [stage]);

  // 2D front preview
  useEffect(() => {
    const c = frontRef.current;
    if (!c || !asset) return;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.save();
    x.translate(c.width / 2, c.height / 2); x.scale(c.width * 0.82, c.width * 0.82);
    drawAssetFront(x, asset);
    x.restore();
  }, [asset]);

  // 3D 3/4 + side preview (lazy)
  useEffect(() => {
    if (!asset || !asset.ok) return;
    let cancelled = false;
    (async () => {
      const [{ buildGlassesFromAsset }, THREE] = await Promise.all([model3d(), three()]);
      if (cancelled) return;
      const grp = buildGlassesFromAsset(asset);
      const renderView = (canvas, rot) => {
        if (!canvas) return;
        const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        r.setSize(canvas.width, canvas.height, false);
        const sc = new THREE.Scene();
        sc.add(new THREE.AmbientLight(0xffffff, 1.5));
        const l = new THREE.DirectionalLight(0xffffff, 1.4); l.position.set(1, 1, 2); sc.add(l);
        const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100); cam.position.set(0, 0, 3.6);
        const m = grp.clone(true); m.rotation.set(...rot); m.scale.setScalar(2.1); sc.add(m);
        r.render(sc, cam); r.dispose();
      };
      renderView(tqRef.current, [-0.15, -0.6, 0]);
      renderView(sideRef.current, [0, -Math.PI / 2, 0]);
    })();
    return () => { cancelled = true; };
  }, [asset]);

  async function onLoad() {
    const img = imgRef.current;
    try {
      const { loadSam, embed, pickGlassesPoints } = await sam();
      setStage('model');
      const [, lm] = await Promise.all([
        loadSam(p => setPct(p)),
        detectInImage(img).catch(() => null),
      ]);
      setBackend((await sam()).backend);
      setStage('encode');
      ctxRef.current = await embed(file);
      lmRef.current = lm;
      setPoints(pickGlassesPoints(lm, img.naturalWidth, img.naturalHeight));
    } catch (e) {
      setError(String(e.message || e));
      setStage('error');
    }
  }

  useEffect(() => {
    if (!points || !ctxRef.current) return;
    let stale = false;
    (async () => {
      try {
        setStage('trace');
        const { segment } = await sam();
        const seg = await segment(ctxRef.current, points);
        if (stale) return;
        maskRef.current = seg;

        const c = document.createElement('canvas');
        c.width = seg.width; c.height = seg.height;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(imgRef.current, 0, 0, seg.width, seg.height);
        const imgData = cx.getImageData(0, 0, seg.width, seg.height);

        const a = buildAsset(imgData, seg.mask, seg.width, seg.height, lmRef.current || null);
        a.id = 'a' + Date.now();
        setAsset(a);
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

  const use = () => {
    if (!asset) return;
    const t = imgRef.current;
    const s = 120 / Math.max(t.naturalWidth, t.naturalHeight);
    const tc = document.createElement('canvas');
    tc.width = Math.round(t.naturalWidth * s); tc.height = Math.round(t.naturalHeight * s);
    tc.getContext('2d').drawImage(t, 0, 0, tc.width, tc.height);
    onDone({ asset, srcThumb: tc.toDataURL('image/jpeg', 0.72) });
  };

  const note = {
    model: `01. loading the model — ${Math.round(pct * 100)}% (first upload only)`,
    encode: `02. reading the photo — ${backend}`,
    trace: '03. tracing the frame outline',
    idle: asset
      ? (asset.ok
          ? `frame detected — ${asset.geometry.outline.length} outline points, ${asset.quality.hasHoles ? 'lens openings found' : 'lens openings estimated'}`
          : 'that did not read as glasses. add it anyway and adjust on the right, or click the frame to guide the mask.')
      : 'no result yet — click on the glasses.',
    error: 'it broke: ' + error,
  }[stage];

  return (
    <div className="overlay">
      <div className="panel">
        <h2>{stage === 'idle' ? 'extracted frame' : stage === 'error' ? 'that did not work' : 'extracting your frame'}</h2>
        <p className="hint">{note} {stage !== 'idle' && stage !== 'error' && <b>{secs.toFixed(1)}s</b>}</p>
        <div className="bar">
          <i className={stage === 'model' ? '' : stage === 'idle' || stage === 'error' ? 'done' : 'busy'}
             style={{ width: stage === 'model' ? `${pct * 100}%` : '100%' }} />
        </div>

        <div className="cropbox" onClick={addPoint}>
          <img ref={imgRef} src={url} alt="uploaded" onLoad={onLoad} />
          {dots()}
        </div>

        <div className="assetviews">
          <figure><canvas ref={frontRef} width={200} height={110} /><figcaption>front</figcaption></figure>
          <figure><canvas ref={tqRef} width={200} height={110} /><figcaption>3/4</figcaption></figure>
          <figure><canvas ref={sideRef} width={200} height={110} /><figcaption>side</figcaption></figure>
        </div>
        {asset && asset.ok && <p className="hint"><span className="ok">✓ frame detected</span>
          &nbsp;·&nbsp; colour <span style={{ color: asset.frameColor }}>■</span> {asset.frameColor}
          &nbsp;·&nbsp; rim {(asset.dimensions.rimRatio * 100 | 0)}%
        </p>}

        {asset && (
          <p className="hint">
            <button className="linkish" onClick={() => setShowDebug(v => !v)}>
              {showDebug ? '▾ hide' : '▸ show'} debug — segmentation / geometry stages
            </button>
          </p>
        )}
        {showDebug && asset && <DebugView asset={asset} img={imgRef.current} mask={maskRef.current} points={points} />}

        <div className="row">
          <button className="big" disabled={!asset || stage !== 'idle'} onClick={use}>add to my frames</button>
          <button className="big ghost" onClick={onCancel}>cancel</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- debug: the 9 stages ---------- */

function DebugView({ asset, img, mask, points }) {
  const refs = {
    orig: useRef(null), sam: useRef(null), clean: useRef(null),
    frame: useRef(null), lens: useRef(null), asset2d: useRef(null),
  };

  useEffect(() => {
    if (!img || !mask) return;
    const W = mask.width, H = mask.height, ar = H / W, cw = 200, ch = Math.round(cw * ar);

    const fit = c => { c.width = cw; c.height = ch; return c.getContext('2d'); };
    const drawImg = ctx => ctx.drawImage(img, 0, 0, cw, ch);
    const drawMask = (ctx, m, colour) => {
      const id = ctx.createImageData(cw, ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const mx = (x / cw * W) | 0, my = (y / ch * H) | 0;
        const on = m[my * W + mx];
        const i = (y * cw + x) * 4;
        id.data[i] = colour[0] * on; id.data[i + 1] = colour[1] * on; id.data[i + 2] = colour[2] * on;
        id.data[i + 3] = on ? 255 : 0;
      }
      ctx.putImageData(id, 0, 0);
    };
    const drawPoly = (ctx, polyPx, colour) => {
      ctx.strokeStyle = colour; ctx.lineWidth = 1.4; ctx.beginPath();
      polyPx.forEach(([x, y], i) => { const px = x / W * cw, py = y / H * ch; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.closePath(); ctx.stroke();
    };

    // 1 original
    drawImg(fit(refs.orig.current));
    // 2 raw SAM mask
    drawMask(fit(refs.sam.current), mask.mask, [232, 255, 69]);
    // 3 cleaned + hole-filled mask (what the outline is traced from)
    drawMask(fit(refs.clean.current), asset.stages.solidMask || asset.stages.cleanMask || mask.mask, [120, 200, 255]);
    // 4 frame contour over the photo
    { const ctx = fit(refs.frame.current); drawImg(ctx); ctx.globalAlpha = 0.9;
      if (asset.stages.outlinePx) drawPoly(ctx, asset.stages.outlinePx, '#e8ff45'); }
    // 5 lens contours over the photo
    { const ctx = fit(refs.lens.current); drawImg(ctx); ctx.globalAlpha = 0.9;
      if (asset.stages.lensLpx) drawPoly(ctx, asset.stages.lensLpx, '#4fd1c5');
      if (asset.stages.lensRpx) drawPoly(ctx, asset.stages.lensRpx, '#4fd1c5'); }
    // 6 the extracted 2D asset
    { const c = refs.asset2d.current; c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0b0b0c'; ctx.fillRect(0, 0, cw, ch);
      ctx.save(); ctx.translate(cw / 2, ch / 2); ctx.scale(cw * 0.8, cw * 0.8);
      drawAssetFront(ctx, asset); ctx.restore(); }
  }, [asset, img, mask, points]);

  const items = [
    ['1 · original', refs.orig], ['2 · SAM mask', refs.sam], ['3 · clean + filled', refs.clean],
    ['4 · frame contour', refs.frame], ['5 · lens contour', refs.lens], ['6 · 2D asset', refs.asset2d],
  ];
  return (
    <div className="debug">
      {items.map(([label, r]) => (
        <figure key={label}><canvas ref={r} /><figcaption>{label}</figcaption></figure>
      ))}
      <p className="hint">7–9 (3D front / side / try-on) — see the preview above and the live camera.</p>
    </div>
  );
}
