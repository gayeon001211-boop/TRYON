import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { poseFromEyes, eulerFromLandmarks } from './frame.js';
import { drawAssetAtPose } from './assetRender.js';

const MAX_FACES = 4;    // everyone in front of the camera gets a pair

const load3d = () => import('./glasses3d.js');

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Owns the camera, the face landmarker and the render loop.
 * `paramsRef.current` = { frame, opts, fit, worn, mode:'2d'|'3d', compare:[{frame,opts},…]|null }
 * The GlassesAsset (frame.asset) is independent of tracking — this hook only places it.
 */
export function useTryOn(paramsRef) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const glCanvasRef = useRef(null);
  const [status, setStatus] = useState('off');
  const [faceFound, setFaceFound] = useState(false);
  const [faceCount, setFaceCount] = useState(0);
  const [facing, setFacing] = useState('user');
  const run = useRef({ pose: null, wear: 0, raf: 0, landmarker: null, layer: null, lm: null, faces: [], euler: { yaw: 0, pitch: 0 } });

  useEffect(() => () => stopAll(run.current, videoRef.current), []);

  async function openCamera(facingMode) {
    const video = videoRef.current;
    video.srcObject?.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode },
    });
    video.srcObject = stream;
    await video.play();
    const c = canvasRef.current, g = glCanvasRef.current;
    c.width = video.videoWidth; c.height = video.videoHeight;
    g.width = video.videoWidth; g.height = video.videoHeight;
    run.current.layer?.resize(c.width, c.height);
  }

  async function start(facingMode = 'user') {
    setStatus('starting');
    try {
      await openCamera(facingMode);
      setFacing(facingMode);
      if (!run.current.landmarker) {
        const files = await FilesetResolver.forVisionTasks(WASM);
        run.current.landmarker = await FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO', numFaces: MAX_FACES, outputFacialTransformationMatrixes: true,
        });
      }
      if (!run.current.layer) {
        const { Glasses3DLayer } = await load3d();
        run.current.layer = new Glasses3DLayer(glCanvasRef.current);
      }
      run.current.layer.resize(canvasRef.current.width, canvasRef.current.height);
      syncGlasses();
      setStatus('on');
      loop(0);
    } catch (e) {
      setStatus(e?.name === 'NotAllowedError' ? 'denied' : 'off');
    }
  }

  async function flip() {
    const next = facing === 'user' ? 'environment' : 'user';
    try { await openCamera(next); setFacing(next); } catch { /* one camera only */ }
  }

  const glassesKey = useRef('');
  function syncGlasses() {
    const p = paramsRef.current, layer = run.current.layer;
    if (!layer || !p?.frame?.asset) return;
    const f = p.frame, o = p.opts || {};
    // rebuild only when geometry-affecting things change
    const key = [f.id, f.asset.id, f.asset.geometry.outline.length,
      o.thickness ?? 1, o.templeLen ?? '', o.frameOpacity ?? 1].join('·');
    if (key !== glassesKey.current) {
      glassesKey.current = key;
      layer.setGlasses({ asset: f.asset, opts: o });
    } else {
      layer.setColors(o);
    }
  }

  function mirrorPt(q, on) { return on ? { x: 1 - q.x, y: q.y, z: q.z } : q; }

  function loop(t) {
    run.current.raf = requestAnimationFrame(loop);
    const video = videoRef.current, c = canvasRef.current;
    if (!video || video.readyState < 2) return;
    const r = run.current, p = paramsRef.current;
    const ctx = c.getContext('2d');
    const mir = p._mirror ?? (facing === 'user');

    ctx.save();
    if (mir) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, c.width, c.height);
    ctx.restore();

    const res = r.landmarker.detectForVideo(video, t);
    const faces = (res?.faceLandmarks || []).map((f, i) => {
      const m = f.map(q => mirrorPt(q, mir));
      const pose = poseFromEyes(m[33], m[263], c.width, c.height);
      pose.yaw = (m[1].x * c.width - pose.cx) / pose.eyeSpan;
      return { lm: m, pose, euler: eulerFromLandmarks(m),
               matrix: res?.facialTransformationMatrixes?.[i]?.data ?? null };
    // nearest first: the biggest face is the one being measured and the one that leads
    }).sort((a, b) => b.pose.eyeSpan - a.pose.eyeSpan);
    r.faces = faces;

    const lead = faces[0];
    if (lead) {
      r.lm = lead.lm;
      r.pose = lead.pose;
      r.matrix = lead.matrix;
      r.euler.yaw += (lead.euler.yaw - r.euler.yaw) * 0.4;
      r.euler.pitch += (lead.euler.pitch - r.euler.pitch) * 0.4;
    }
    setFaceFound(faces.length > 0);
    setFaceCount(faces.length);

    syncGlasses();
    const wt = p.worn ? 1 : 0;
    r.wear += (wt - r.wear) * 0.2;
    if (Math.abs(r.wear - wt) < 0.01) r.wear = wt;      // snap so the ease actually finishes

    const layer = r.layer;
    const use3d = p.mode === '3d' && !p.compare;

    if (p.compare && r.pose) {
      layer?.clear();
      drawSplit(ctx, c, r.pose, p, r.wear);
    } else if (use3d) {
      // everyone in shot, not just the nearest face
      if (r.faces.length) layer.updateAll(r.faces, p.fit, p.opts, r.wear);
      else layer.update(dummyPose(c), r.euler, p.fit, p.opts, r.wear, null);
      layer.render();
    } else {
      layer?.clear();
      if (r.wear > 0.01) {
        const k = r.wear;
        for (const f of r.faces) {           // one pair per face, not just the nearest
          // ease only the drop-in (y + scale + fade), never the horizontal anchor
          const pose = {
            cx: f.pose.cx,
            cy: f.pose.cy - (1 - k) * f.pose.eyeSpan * 0.6,
            angle: f.pose.angle * k,
            eyeSpan: f.pose.eyeSpan, yaw: f.pose.yaw,
          };
          drawAssetAtPose(ctx, p.frame.asset, pose, { ...p.fit, scale: (p.fit.scale ?? 1) * (0.85 + 0.15 * k) }, p.opts, k);
        }
      }
    }
  }

  function drawSplit(ctx, c, pose, p, wear) {
    const half = c.width / 2;
    p.compare.forEach(({ frame, opts }, i) => {
      const x0 = i === 0 ? 0 : half, x1 = i === 0 ? half : c.width;
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, c.height); ctx.clip();
      if (wear > 0.01) drawAssetAtPose(ctx, frame.asset, pose, p.fit, opts, wear);
      ctx.restore();
    });
    ctx.save();
    ctx.strokeStyle = '#e8ff45'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, c.height); ctx.stroke();
    ctx.restore();
  }

  function snapshot() {
    const c = canvasRef.current, g = glCanvasRef.current;
    if (!c) return null;
    const out = document.createElement('canvas');
    out.width = c.width; out.height = c.height;
    const x = out.getContext('2d');
    x.drawImage(c, 0, 0, out.width, out.height);
    if (paramsRef.current?.mode === '3d' && !paramsRef.current?.compare) x.drawImage(g, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function contactSheet() { return run.current.layer?.contactSheet?.() ?? null; }
  const sample = () => ({ lm: run.current.lm, pose: run.current.pose, matrix: run.current.matrix,
                          size: { w: canvasRef.current?.width || 0, h: canvasRef.current?.height || 0 } });

  return { videoRef, canvasRef, glCanvasRef, status, faceFound, faceCount, facing, start, flip, snapshot, contactSheet, sample };
}

function dummyPose(c) { return { cx: c.width / 2, cy: c.height / 2, eyeSpan: c.width * 0.12, angle: 0, yaw: 0 }; }

function stopAll(r, video) {
  cancelAnimationFrame(r.raf);
  video?.srcObject?.getTracks().forEach(t => t.stop());
  r.layer?.dispose?.();
}
