import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { poseFromEyes, drawFrame, eulerFromLandmarks } from './frame.js';

const load3d = () => import('./glasses3d.js');   // ~500 KB of three, only when the camera starts

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Owns the camera, the face landmarker and the render loop.
 * `paramsRef.current` carries the latest React state into the loop without restarting it:
 *   { frame, fit, frameColor, lensColor, worn, mode:'2d'|'3d', compare:[a,b]|null }
 */
export function useTryOn(paramsRef) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);       // 2D: video + (in 2d mode) the frame
  const glCanvasRef = useRef(null);     // WebGL: the 3D glasses, stacked on top
  const [status, setStatus] = useState('off');   // off | starting | on | denied
  const [faceFound, setFaceFound] = useState(false);
  const [facing, setFacing] = useState('user');
  const run = useRef({ pose: null, wear: 0, raf: 0, landmarker: null, layer: null, lm: null, euler: { yaw: 0, pitch: 0 } });

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
          runningMode: 'VIDEO', numFaces: 1,
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
    try { await openCamera(next); setFacing(next); } catch { /* device may have one camera */ }
  }

  // rebuild the 3D model when the active frame identity changes
  const glassesKey = useRef('');
  function syncGlasses() {
    const p = paramsRef.current, layer = run.current.layer;
    if (!layer || !p?.frame) return;
    const f = p.frame;
    const key = f.id + (f.canvas ? '·img' : '·' + f.shape);
    if (key === glassesKey.current) return;
    glassesKey.current = key;
    layer.setGlasses({
      shape: f.shape || 'round',
      silhouette: f.canvas || null,
      spanRatio: f.spanRatio, yRatio: f.yRatio,
      frameColor: p.frameColor, lensColor: p.lensColor,
    });
  }

  function mirrorPt(q, on) { return on ? { x: 1 - q.x, y: q.y, z: q.z } : q; }

  function loop(t) {
    run.current.raf = requestAnimationFrame(loop);
    const video = videoRef.current, c = canvasRef.current;
    if (!video || video.readyState < 2) return;
    const r = run.current, p = paramsRef.current;
    const ctx = c.getContext('2d');
    const mir = paramsRef.current._mirror ?? (facing === 'user');

    // video
    ctx.save();
    if (mir) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, c.width, c.height);
    ctx.restore();

    // detect
    const res = r.landmarker.detectForVideo(video, t);
    const lm = res?.faceLandmarks?.[0];
    if (lm) {
      const m = lm.map(q => mirrorPt(q, mir));
      r.lm = m;
      r.pose = poseFromEyes(m[33], m[263], c.width, c.height);
      const nose = m[1];
      r.pose.yaw = (nose.x * c.width - r.pose.cx) / r.pose.eyeSpan;
      const e = eulerFromLandmarks(m);
      // low-pass so it doesn't jitter
      r.euler.yaw += (e.yaw - r.euler.yaw) * 0.4;
      r.euler.pitch += (e.pitch - r.euler.pitch) * 0.4;
    }
    setFaceFound(Boolean(lm));

    syncGlasses();
    r.wear += ((p.worn ? 1 : 0) - r.wear) * 0.18;

    const layer = r.layer;
    const use3d = p.mode === '3d' && !p.compare;

    if (p.compare && r.pose) {
      // 2D split screen — one frame each side of a divider
      layer?.clear();
      drawSplit(ctx, c, r.pose, r.euler, p, r.wear);
    } else if (use3d) {
      layer.update(r.pose || dummyPose(c), r.euler, p.fit, p.frameColor, p.lensColor, r.wear, r.lm);
      layer.render();
    } else {
      layer?.clear();
      if (r.pose && r.wear > 0.01) {
        const k = r.wear, mix = (a, b) => a + (b - a) * k;
        drawFrame(ctx, p.frame, {
          cx: mix(-c.width * 0.1, r.pose.cx),
          cy: mix(c.height / 2, r.pose.cy),
          angle: mix(0, r.pose.angle),
          eyeSpan: r.pose.eyeSpan, yaw: r.pose.yaw,
        }, p.fit, p.frameColor, p.lensColor, k);
      }
    }
  }

  function drawSplit(ctx, c, pose, euler, p, wear) {
    const [a, b] = p.compare;
    const half = c.width / 2;
    for (const [frame, x0, x1] of [[a, 0, half], [b, half, c.width]]) {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, c.height); ctx.clip();
      if (wear > 0.01) drawFrame(ctx, frame, { ...pose, yaw: pose.yaw }, p.fit, p.frameColor, p.lensColor, wear);
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = '#e8ff45'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(half, 0); ctx.lineTo(half, c.height); ctx.stroke();
    ctx.restore();
  }

  /** Composite the visible stage (2D + WebGL) into one PNG data URL. */
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

  const sample = () => ({ lm: run.current.lm, pose: run.current.pose });

  return { videoRef, canvasRef, glCanvasRef, status, faceFound, facing, start, flip, snapshot, contactSheet, sample };
}

function dummyPose(c) { return { cx: c.width / 2, cy: c.height / 2, eyeSpan: c.width * 0.12, angle: 0, yaw: 0 }; }

function stopAll(r, video) {
  cancelAnimationFrame(r.raf);
  video?.srcObject?.getTracks().forEach(t => t.stop());
  r.layer?.dispose?.();
}
