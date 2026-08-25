import { useEffect, useRef, useState } from 'react';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { poseFromEyes, drawFrame } from './frame.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * Owns the camera, the face landmarker and the render loop.
 * `paramsRef` carries the latest React state into the loop without restarting it.
 */
export function useTryOn(paramsRef) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('off'); // off | starting | on
  const [faceFound, setFaceFound] = useState(false);
  const runRef = useRef({ pose: null, wear: 0, raf: 0, landmarker: null });

  useEffect(() => () => {                       // stop camera + loop on unmount
    cancelAnimationFrame(runRef.current.raf);
    videoRef.current?.srcObject?.getTracks().forEach(t => t.stop());
  }, []);

  async function start() {
    setStatus('starting');
    const video = videoRef.current, canvas = canvasRef.current;
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
    await video.play();
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;

    const files = await FilesetResolver.forVisionTasks(WASM);
    runRef.current.landmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
      runningMode: 'VIDEO', numFaces: 1,
    });
    setStatus('on');

    const ctx = canvas.getContext('2d');
    const loop = t => {
      runRef.current.raf = requestAnimationFrame(loop);
      if (video.readyState < 2) return;
      const r = runRef.current, p = paramsRef.current;

      ctx.save(); ctx.translate(canvas.width, 0); ctx.scale(-1, 1);   // selfie view
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height); ctx.restore();

      const lm = r.landmarker.detectForVideo(video, t)?.faceLandmarks?.[0];
      if (lm) {
        const mirror = q => ({ x: 1 - q.x, y: q.y });
        r.pose = poseFromEyes(mirror(lm[33]), mirror(lm[263]), canvas.width, canvas.height);
      }
      setFaceFound(Boolean(lm));

      r.wear += ((p.worn ? 1 : 0) - r.wear) * 0.18;   // ease between collection and face
      if (r.pose && r.wear > 0.01) {
        const k = r.wear, mix = (a, b) => a + (b - a) * k;
        drawFrame(ctx, p.frame, {
          cx: mix(-canvas.width * 0.1, r.pose.cx),
          cy: mix(canvas.height / 2, r.pose.cy),
          angle: mix(0, r.pose.angle),
          eyeSpan: r.pose.eyeSpan,
        }, p.fit, p.frameColor, p.lensColor, k);
      }
    };
    runRef.current.raf = requestAnimationFrame(loop);
  }

  return { videoRef, canvasRef, status, faceFound, start };
}
