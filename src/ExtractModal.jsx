import { useEffect, useRef, useState } from 'react';
import { detectInImage } from './extract.js';
import { buildAsset, foregroundFromBackground } from './glassesAsset.js';
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
  const [stage, setStage] = useState('model');   // model | sam | encode | trace | idle | error
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

  // a blob image can finish decoding before React attaches onLoad — then the event never
  // arrives. And a file the browser cannot decode fires error, not load: without this the
  // modal sat on "looking for a face" forever with nothing on screen to say why.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete) {
      if (img.naturalWidth > 0) onLoad();
      else { setError('the browser could not read that image file'); setStage('error'); }
    }
  }, []);

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

  // 3D 3/4 + side preview (lazy) — any real trace, confident or not
  useEffect(() => {
    if (!asset || asset.reason) return;
    let cancelled = false;
    (async () => {
      const [{ buildGlassesFromAsset, studioEnvironment }, THREE] = await Promise.all([model3d(), three()]);
      if (cancelled) return;
      const renderView = (canvas, rot) => {
        if (!canvas) return;
        const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        r.setSize(canvas.width, canvas.height, false);
        const sc = new THREE.Scene();
        sc.environment = studioEnvironment(r);
        sc.add(new THREE.AmbientLight(0xffffff, 0.6));
        const l = new THREE.DirectionalLight(0xffffff, 1.05); l.position.set(1, 1, 2); sc.add(l);
        const m = grp.clone(true); m.rotation.set(...rot); sc.add(m);
        // frame the whole thing — a fixed scale cropped the temples straight off the side view
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
        const aspect = canvas.width / canvas.height;
        const fov = 32 * Math.PI / 180;
        const dist = Math.max(size.y / 2 / Math.tan(fov / 2), size.x / 2 / Math.tan(fov / 2) / aspect);
        const cam = new THREE.PerspectiveCamera(32, aspect, 0.1, 100);
        cam.position.set(mid.x, mid.y, mid.z + dist * 1.12 + size.z);
        cam.lookAt(mid);
        r.render(sc, cam); r.dispose();
      };
      const draw = () => {
        if (cancelled) return;
        renderView(tqRef.current, [-0.15, -0.6, 0]);
        renderView(sideRef.current, [0, -Math.PI / 2, 0]);
      };
      const grp = buildGlassesFromAsset(asset, { onReady: draw });   // the texture loads async
      draw();
    })();
    return () => { cancelled = true; };
  }, [asset]);

  const srcRef = useRef('sam');    // 'sam' | 'bg'
  const poseRef = useRef(null);   // MediaPipe facial transform of the source photo

  function imgDataAt(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(imgRef.current, 0, 0, w, h);
    return cx.getImageData(0, 0, w, h);
  }

  function runBuild(imgData, mask, w, h, lm, matrix) {
    const a = buildAsset(imgData, mask, w, h, lm, matrix);
    a.id = 'a' + Date.now();
    a.source = srcRef.current;
    setAsset(a);
    setStage('idle');
  }

  const startedRef = useRef(false);

  async function onLoad() {
    const img = imgRef.current;
    if (!img || startedRef.current) return;      // <img onLoad> can fire more than once
    startedRef.current = true;
    try {
      setStage('model');
      const det = await detectInImage(img).catch(() => null);
      const lm = det?.landmarks ?? null;
      lmRef.current = lm;
      poseRef.current = det?.matrix ?? null;

      // background-key path for a plain-background product shot with no face — no SAM.
      const W = Math.min(img.naturalWidth, 720);
      const H = Math.round(img.naturalHeight * (W / img.naturalWidth));
      const workData = imgDataAt(W, H);
      const fg = foregroundFromBackground(workData, W, H);

      if (!lm && fg.plainBg) {
        srcRef.current = 'bg';
        setBackend('background key');
        setStage('trace');
        maskRef.current = { mask: fg.mask, width: W, height: H };
        runBuild(workData, fg.mask, W, H, null, null);
        return;
      }

      // otherwise: SAM. face landmarks guide the prompts; without a face we prompt a band.
      srcRef.current = 'sam';
      setStage('sam');
      const { loadSam, embed, pickGlassesPoints } = await sam();
      await loadSam(p => setPct(p));
      setBackend((await sam()).backend);
      setStage('encode');
      ctxRef.current = await embed(file);
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
        runBuild(imgDataAt(seg.width, seg.height), seg.mask, seg.width, seg.height, lmRef.current || null, poseRef.current);
      } catch (e) { setError(String(e.message || e)); setStage('error'); }
    })();
    return () => { stale = true; };
  }, [points]);

  const addPoint = async e => {
    if (stage !== 'idle') return;
    const img = imgRef.current, r = img.getBoundingClientRect();
    const k = img.naturalWidth / r.width;
    const p = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    const next = [...(points ?? []), { p, label: e.altKey ? 0 : 1 }];
    // first click on a background-key result switches to SAM refinement
    if (srcRef.current === 'bg' && !ctxRef.current) {
      srcRef.current = 'sam';
      setStage('encode');
      const { loadSam, embed } = await sam();
      await loadSam(pc => setPct(pc));
      ctxRef.current = await embed(file);
    }
    setPoints(next);
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
    // one label per real step: "looking for a face" used to stay up through the whole
    // segmenter download, which made a slow load look like a hang — twice
    model: '01. looking for a face',
    sam: `02. loading the segmenter — ${Math.round(pct * 100)}%`,
    encode: `03. reading the photo — ${backend}`,
    trace: srcRef.current === 'bg' ? '04. keying out the background' : '04. tracing the frame outline',
    idle: asset
      ? (asset.reason
          ? `couldn't trace a frame (${asset.reason}). click on the glasses to guide it.`
          : asset.ok
            ? `frame traced — ${asset.geometry.outline.length} outline points, lens openings ${asset.quality.hasHoles ? 'found' : 'estimated'}`
            : `traced, but low confidence (${!asset.quality.hasHoles ? 'lens openings estimated' : 'unusual outline'}). check the preview, adjust on the right, or click to guide the mask.`)
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
          <img ref={imgRef} src={url} alt="uploaded" onLoad={onLoad}
               onError={() => { setError('the browser could not read that image file'); setStage('error'); }} />
          {dots()}
        </div>

        <div className="assetviews">
          <figure><canvas ref={frontRef} width={200} height={110} /><figcaption>front</figcaption></figure>
          <figure><canvas ref={tqRef} width={200} height={110} /><figcaption>3/4</figcaption></figure>
          <figure><canvas ref={sideRef} width={200} height={110} /><figcaption>side</figcaption></figure>
        </div>
        {asset && !asset.reason && <p className="hint">
          {asset.ok ? <span className="ok">✓ frame detected</span> : <span>~ low confidence</span>}
          &nbsp;·&nbsp; colour <span style={{ color: asset.frameColor }}>■</span> {asset.frameColor}
          &nbsp;·&nbsp; lens <span style={{ color: asset.lensColor }}>■</span>
          &nbsp;·&nbsp; rim {(asset.dimensions.rimRatio * 100 | 0)}%
          {asset.quality?.iou != null && <>
            &nbsp;·&nbsp; match <b className={asset.quality.iou >= 0.85 ? 'ok' : ''}>
              {(asset.quality.iou * 100 | 0)}%</b>
          </>}
          {asset.quality?.poseWarn && <>&nbsp;·&nbsp; head turned far, size may be off</>}
          &nbsp;·&nbsp; {asset.source === 'bg' ? 'background key' : 'SAM'}
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
    ['1 · original', refs.orig], ['2 · ' + (asset.source === 'bg' ? 'bg-key mask' : 'SAM mask'), refs.sam],
    ['3 · clean + filled', refs.clean],
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
