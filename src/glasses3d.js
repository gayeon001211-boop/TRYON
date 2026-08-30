// The tracked 3D layer: takes a GlassesAsset, builds the extruded model, and places
// it on the face. Placement is screen-anchored (eye-corner midpoint, eye span, roll)
// with yaw/pitch from the landmarks rotating the real geometry; a face-oval depth
// mask hides whatever swings behind the head.

import * as THREE from 'three';
import { FACE_OVAL, ovalFanIndex } from './faceMesh.js';
import { buildGlassesFromAsset } from './glassesModel.js';

export { eulerFromLandmarks } from './frame.js';

const CAM_FOV = 40;
const CAM_DIST = 6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class Glasses3DLayer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_DIST);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 1, 2);
    const rimL = new THREE.DirectionalLight(0x99bbff, 0.5); rimL.position.set(-1, 0.5, -1);
    this.scene.add(key, rimL);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.glasses = null;
    this._asset = null;
    this._opts = {};

    this.occluder = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ colorWrite: false }));
    this.occluder.renderOrder = -1;
    this.occ = new Float32Array(469 * 3);
    this.occluder.geometry.setAttribute('position', new THREE.BufferAttribute(this.occ, 3));
    this.occluder.geometry.setIndex(ovalFanIndex(468));
    this.scene.add(this.occluder);

    this.w = this.h = 1;
  }

  setGlasses({ asset, opts }) {
    if (this.glasses) { this.pivot.remove(this.glasses); disposeTree(this.glasses); }
    this._asset = asset;
    this._opts = { ...opts };
    this.glasses = buildGlassesFromAsset(asset, opts);
    this.pivot.add(this.glasses);
  }

  setColors(opts) {
    if (!this.glasses) return;
    const u = this.glasses.userData;
    if (opts.frameColor) u.frameMat.color.set(opts.frameColor);
    if (opts.lensColor) u.lensMat.color.set(opts.lensColor.slice(0, 7));
    if (opts.lensOpacity != null) u.lensMat.opacity = clamp(opts.lensOpacity, 0.02, 0.7);
    if (opts.frameOpacity != null) {
      u.frameMat.opacity = clamp(opts.frameOpacity, 0.2, 1);
      u.frameMat.transparent = opts.frameOpacity < 1;
      u.frameMat.needsUpdate = true;
    }
    this._opts = { ...this._opts, ...opts };
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _unitPerPx() {
    return (2 * CAM_DIST * Math.tan((CAM_FOV * Math.PI / 180) / 2)) / this.h;
  }

  /** pose px · euler rad · fit {w,h,x,y,scale,r} · opts · worn 0..1 · landmarks (mirrored) */
  update(pose, euler, fit, opts, worn, landmarks) {
    if (!this.glasses) return;

    const upp = this._unitPerPx();
    const spanRatio = this._asset?.placement?.spanRatio ?? 1.55;
    const targetW = pose.eyeSpan * spanRatio * (fit.w ?? 1) * (fit.scale ?? 1) * upp;
    const base = targetW / 1.0;                       // model built ~1 unit wide
    this.glasses.scale.set(base, base * (fit.h ?? 1), base);

    const wx = (pose.cx - this.w / 2) * upp + pose.eyeSpan * (fit.x ?? 0) * upp;
    const wy = -(pose.cy - this.h / 2) * upp;
    const yRatio = 0.02 + (fit.y ?? 0);              // procedural asset centres on the eye line
    const forward = pose.eyeSpan * upp * 0.16;
    this.pivot.position.set(wx, wy - yRatio * pose.eyeSpan * upp, forward);

    const ease = worn;
    this.pivot.rotation.set(
      (euler.pitch || 0) * ease,
      (euler.yaw || 0) * ease,
      -((pose.angle ?? 0) + (fit.r ?? 0) * Math.PI / 180) * ease,
    );
    this.glasses.visible = ease > 0.02;
    this.glasses.scale.multiplyScalar(0.6 + 0.4 * ease);
    this.glasses.position.z = (1 - ease) * 0.6;

    if (landmarks && landmarks.length >= 468) {
      const depth = pose.eyeSpan * upp * 2.2;
      const toW = q => [(q.x * this.w - this.w / 2) * upp, -(q.y * this.h - this.h / 2) * upp, -q.z * depth];
      for (let i = 0; i < 468; i++) {
        const [x, y, z] = toW(landmarks[i]);
        this.occ[i * 3] = x; this.occ[i * 3 + 1] = y; this.occ[i * 3 + 2] = z;
      }
      let cx = 0, cy = 0, cz = 0;
      for (const k of FACE_OVAL) { const [x, y, z] = toW(landmarks[k]); cx += x; cy += y; cz += z; }
      const n = FACE_OVAL.length;
      this.occ[468 * 3] = cx / n; this.occ[468 * 3 + 1] = cy / n; this.occ[468 * 3 + 2] = cz / n - 0.1;
      this.occluder.geometry.attributes.position.needsUpdate = true;
      this.occluder.geometry.computeVertexNormals();
      this.occluder.visible = true;
    } else {
      this.occluder.visible = false;
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }
  clear() { this.renderer.clear(); }

  /** front / 3-4 / side / top of the built model on one plate. */
  contactSheet(px = 320) {
    if (!this.glasses) return null;
    const views = [
      { label: 'FRONT', rot: [0, 0, 0] },
      { label: '3/4', rot: [-0.15, -0.6, 0] },
      { label: 'SIDE', rot: [0, -Math.PI / 2, 0] },
      { label: 'TOP', rot: [-Math.PI / 2, 0, 0] },
    ];
    const out = document.createElement('canvas');
    out.width = px * views.length; out.height = px + 28;
    const octx = out.getContext('2d');
    octx.fillStyle = '#0b0b0c'; octx.fillRect(0, 0, out.width, out.height);

    const rt = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    rt.setSize(px, px, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const l = new THREE.DirectionalLight(0xffffff, 1.5); l.position.set(1, 1, 2); scene.add(l);
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 100); cam.position.set(0, 0, 3.4);
    const model = this.glasses.clone(true);
    model.scale.setScalar(2.2); model.position.set(0, 0, 0);
    scene.add(model);

    views.forEach((v, i) => {
      model.rotation.set(...v.rot);
      rt.render(scene, cam);
      octx.drawImage(rt.domElement, i * px, 14, px, px);
      octx.fillStyle = '#e8ff45'; octx.font = '10px ui-monospace, monospace';
      octx.fillText(v.label, i * px + 10, out.height - 8);
    });
    rt.dispose();
    return out;
  }

  dispose() {
    if (this.glasses) disposeTree(this.glasses);
    this.occluder.geometry.dispose();
    this.renderer.dispose();
  }
}

function disposeTree(obj) {
  obj.traverse(o => {
    o.geometry?.dispose?.();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.map?.dispose?.(); m.dispose?.(); });
  });
}
