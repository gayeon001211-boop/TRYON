import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let imageLandmarker;
let inFlight = Promise.resolve(null);
/**
 * Face landmarks of a still image, or null if there is no face in it.
 * The face_landmarker.task bundle returns 478 points incl. iris (468–477),
 * which glassesAsset uses as lens centres for SAM's negative prompts.
 */
export async function detectInImage(img) {
  if (!imageLandmarker) {
    const files = await FilesetResolver.forVisionTasks(WASM);
    imageLandmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
  }
  // MediaPipe aborts inside wasm if two detects overlap, and that abort never settles the
  // promise — the UI then sits on "looking for a face" forever. One at a time, and a
  // failure means "no face" rather than a hang.
  inFlight = inFlight.then(() => {
    try {
      const res = imageLandmarker.detect(img);
      const landmarks = res?.faceLandmarks?.[0] ?? null;
      return landmarks && { landmarks, matrix: res?.facialTransformationMatrixes?.[0]?.data ?? null };
    } catch { return null; }
  }, () => null);
  // and never let the UI wait on it forever: no face is a fine answer, a hang is not
  return Promise.race([
    inFlight,
    new Promise(r => setTimeout(() => r(null), 8000)),
  ]);
}
