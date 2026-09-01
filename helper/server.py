"""
TRYON's local helper.

The browser does the camera, the tracking and the try-on. This process does the two
things a browser cannot do well: cut the glasses out of a photo with a full-size
segmentation model, and (later) drive Blender. It listens on the loopback interface
only — nothing here is reachable from outside this machine.

Run: npm run helper   (or helper/run.sh)
"""

import base64
import io
import time
from typing import List, Optional

import numpy as np
import torch
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pydantic import BaseModel

MODEL_ID = "facebook/sam2.1-hiera-large"
FALLBACK_ID = "facebook/sam-vit-huge"      # if sam2 is unavailable in this transformers build

app = FastAPI(title="TRYON helper")
# the browser page is served from vite (5173) or from the deployed site; both may talk to
# this loopback server, and nothing sensitive leaves the machine either way
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATE = {"model": None, "processor": None, "name": None, "device": None, "loaded_at": None}


def device() -> str:
    if torch.backends.mps.is_available():
        return "mps"          # Apple silicon
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load():
    """Load once, keep resident. Cold start is tens of seconds; after that it is instant."""
    if STATE["model"] is not None:
        return
    import transformers
    from transformers import AutoProcessor

    dev = device()
    # AutoModel picks the *video* variant for sam2, which wants an inference session per
    # call. We are segmenting stills, so name the image model explicitly.
    candidates = []
    if hasattr(transformers, "Sam2Model"):
        candidates.append((MODEL_ID, transformers.Sam2Model))
    if hasattr(transformers, "SamModel"):
        candidates.append((FALLBACK_ID, transformers.SamModel))

    last_err = None
    for name, cls in candidates:
        try:
            processor = AutoProcessor.from_pretrained(name)
            model = cls.from_pretrained(name).to(dev).eval()
            STATE.update(model=model, processor=processor, name=name, device=dev, loaded_at=time.time())
            return
        except Exception as e:          # noqa: BLE001 — try the next model, report the last failure
            last_err = e
    raise RuntimeError(f"no segmentation model could be loaded: {last_err}")


class Point(BaseModel):
    p: List[float]        # [x, y] in image pixels
    label: int            # 1 = part of the glasses, 0 = not


class SegmentRequest(BaseModel):
    image: str                       # data URL or bare base64
    points: List[Point]
    multimask: bool = True


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": STATE["name"],
        "device": STATE["device"] or device(),
        "loaded": STATE["model"] is not None,
    }


@app.post("/warmup")
def warmup():
    t0 = time.time()
    load()
    return {"ok": True, "model": STATE["name"], "device": STATE["device"], "seconds": round(time.time() - t0, 1)}


def decode_image(data: str) -> Image.Image:
    raw = data.split(",", 1)[1] if data.startswith("data:") else data
    return Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")


@app.post("/segment")
def segment(req: SegmentRequest):
    load()
    img = decode_image(req.image)
    w, h = img.size

    pts = [[list(map(float, p.p)) for p in req.points]]
    labels = [[int(p.label) for p in req.points]]

    inputs = STATE["processor"](
        images=img, input_points=[pts], input_labels=[labels], return_tensors="pt"
    ).to(STATE["device"])

    with torch.no_grad():
        out = STATE["model"](**inputs, multimask_output=req.multimask)

    # SAM and SAM 2 disagree on this signature; try the longer one, fall back to the short
    sizes = inputs["original_sizes"]
    sizes = sizes.cpu() if hasattr(sizes, "cpu") else sizes
    try:
        reshaped = inputs["reshaped_input_sizes"]
        masks = STATE["processor"].post_process_masks(
            out.pred_masks.cpu(), sizes, reshaped.cpu() if hasattr(reshaped, "cpu") else reshaped
        )
    except (KeyError, TypeError):
        masks = STATE["processor"].post_process_masks(out.pred_masks.cpu(), sizes)
    masks = masks[0]
    if masks.ndim == 4:                       # [batch, candidates, H, W]
        masks = masks[0]
    scores = out.iou_scores.cpu().numpy().reshape(-1)
    best = int(np.argmax(scores))
    mask = masks[best].numpy().astype(np.uint8)

    png = io.BytesIO()
    Image.fromarray(mask * 255, mode="L").save(png, format="PNG")
    return {
        "width": w,
        "height": h,
        "score": float(scores[best]),
        "model": STATE["name"],
        "mask": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode(),
    }
