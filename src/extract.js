import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let imageLandmarker;
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
  const res = imageLandmarker.detect(img);
  return res?.faceLandmarks?.[0] ?? null;
}
