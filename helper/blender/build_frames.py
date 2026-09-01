"""
Build the eyewear base meshes that the app fits to a photo.

Generating a frame from scratch in the browser can manage rims, a bridge and a bar for
a temple — it cannot manage a hinge, a nose pad, or an arm that tapers the way a real
one does. Those are modelled here, once, and exported as glTF; at run time the browser
only has to stretch the right base to the measured dimensions. No Blender is needed to
use the app.

Every part is built by writing vertex coordinates into a bmesh. Nothing here uses a
curve, a bevel object, or an object-level rotation or scale: the previous version did,
and Blender applies object scale in the *local* space that precedes the rotation, so a
lens circle stood up with rotation=(pi/2,0,0) and scaled (w, 1, h) kept radius 1.0 in
the axis that became vertical — a two-unit-tall hoop instead of a lens. Coordinates are
not ambiguous that way. Objects stay at identity from creation to export.

Run:  blender --background --python helper/blender/build_frames.py
Out:  public/frames/{fullrim,wire,browline,rimless}.glb   (~1 unit wide, +Z forward)
"""

import math
import os

import bpy
import bmesh
from mathutils import Matrix, Vector

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "public", "frames")

# Blender is Z-up and treats +Y as away from the viewer; the app (and glTF) are Y-up with
# -Z away. Build in Blender's terms and the exporter lands it correctly: everything below
# uses B(x, y_up, z_back) to translate from the app's convention.
def B(x, up, back):
    return Vector((x, back, up))

# a frame is normalised to 1.0 across the front, matching eyewearSpec in the app
LENS_W, LENS_H = 0.38, 0.21
HALF_GAP = 0.245
TEMPLE_LEN = 1.05
DEPTH = 0.045


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for item in list(block):
            block.remove(item)


# ---------------------------------------------------------------- sweeping

def sweep(bm, path, section, closed=False, scale=None):
    """
    Push a 2D cross-section along a 3D path and join consecutive rings with quads.

    The section lives in the plane normal to the path, oriented by parallel transport:
    each ring reuses the previous ring's up vector rotated onto the new tangent, so the
    section never spins about the path (which is what an object-space bevel does wrong).
    `scale(i, t)` may narrow a ring — that is how a temple tapers. `closed` joins the
    last ring back to the first; an open sweep gets flat caps.
    """
    n = len(path)
    tangents = []
    for i in range(n):
        a = path[(i - 1) % n] if closed else path[max(0, i - 1)]
        b = path[(i + 1) % n] if closed else path[min(n - 1, i + 1)]
        t = (b - a)
        if t.length < 1e-9:
            t = Vector((0, 0, 1))
        tangents.append(t.normalized())

    # seed an up vector that is not parallel to the first tangent
    seed = Vector((0, 0, 1))
    if abs(seed.dot(tangents[0])) > 0.9:
        seed = Vector((1, 0, 0))
    up = (seed - tangents[0] * seed.dot(tangents[0])).normalized()

    rings = []
    for i in range(n):
        t = tangents[i]
        if i:
            prev = tangents[i - 1]
            axis = prev.cross(t)
            if axis.length > 1e-9:                      # rotate the frame onto the new tangent
                ang = math.atan2(axis.length, prev.dot(t))
                up = Matrix.Rotation(ang, 3, axis.normalized()) @ up
            up = (up - t * up.dot(t)).normalized()
        side = t.cross(up).normalized()
        s = scale(i, i / max(1, n - 1)) if scale else 1.0
        rings.append([bm.verts.new(path[i] + side * (u * s) + up * (v * s)) for u, v in section])

    m = len(section)
    span = n if closed else n - 1
    for i in range(span):
        a, b = rings[i], rings[(i + 1) % n]
        for j in range(m):
            k = (j + 1) % m
            bm.faces.new((a[j], a[k], b[k], b[j]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    return rings


def rect(half_w, half_h):
    return [(-half_w, -half_h), (half_w, -half_h), (half_w, half_h), (-half_w, half_h)]


def disc(r, n=8):
    return [(math.cos(2 * math.pi * i / n) * r, math.sin(2 * math.pi * i / n) * r) for i in range(n)]


def catmull(pts, per=6):
    """Resample control points into a smooth polyline — a temple bends, it does not kink."""
    ext = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(len(ext) - 3):
        p0, p1, p2, p3 = ext[i:i + 4]
        for k in range(per):
            t = k / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t
                              + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(ext[-1])
    return out


# ---------------------------------------------------------------- parts

def lens_outline(cx, w, h, squarish=0.0, n=64):
    """
    A lens outline as a superellipse, written out coordinate by coordinate. squarish=0
    is an ellipse; higher values square off the corners the way an acetate frame does.
    """
    p = 2.0 + squarish * 2.5
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        x = math.copysign(abs(ca) ** (2 / p), ca)
        y = math.copysign(abs(sa) ** (2 / p), sa)
        pts.append(B(cx + x * w / 2, y * h / 2, 0.0))
    return pts


def rim(bm, sign, rim_t, depth, brow=False):
    path = lens_outline(sign * HALF_GAP, LENS_W, LENS_H, squarish=0.25)
    if not brow:
        sweep(bm, path, rect(rim_t, depth), closed=True)
        return
    # browline: the top arc carries the frame, the lower half thins to a wire
    def thin(i, _t):
        return 1.0 if path[i].z >= 0 else 0.34
    sweep(bm, path, rect(rim_t, depth), closed=True, scale=thin)


def bridge(bm, rim_t, depth):
    span = HALF_GAP - LENS_W / 2
    ctrl = [B(-span - 0.03, 0.03, 0.0), B(0, 0.075, 0.012), B(span + 0.03, 0.03, 0.0)]
    sweep(bm, catmull(ctrl, per=8), rect(rim_t, depth * 0.8))


def temple(bm, sign, thickness):
    """Hinge to ear: straight run, a bend over the ear, a short hook behind it."""
    x0 = sign * (HALF_GAP + LENS_W / 2)
    ctrl = [
        B(x0, 0.03, 0.02),
        B(x0 + sign * 0.02, 0.02, -0.10),
        B(x0 + sign * 0.02, 0.00, -TEMPLE_LEN * 0.6),
        B(x0 + sign * 0.015, -0.05, -TEMPLE_LEN * 0.88),
        B(x0 + sign * 0.008, -0.12, -TEMPLE_LEN * 1.0),
        B(x0 + sign * 0.004, -0.17, -TEMPLE_LEN * 0.95),
    ]
    # a real arm narrows towards the tip; blades are flat, not round rods
    sweep(bm, catmull(ctrl, per=5), rect(thickness * 0.6, thickness * 1.4),
          scale=lambda _i, t: 1.0 - 0.45 * t)


def hinge(bm, sign, thickness):
    x = sign * (HALF_GAP + LENS_W / 2 + 0.005)
    sweep(bm, [B(x - sign * 0.02, 0.03, -0.01), B(x + sign * 0.02, 0.03, -0.01)], disc(thickness * 1.1))


def nose_pads(bm):
    """The little pads either side of the bridge — a detail the browser never had."""
    for sign in (-1, 1):
        at = B(sign * 0.045, -0.03, 0.03)
        # scale goes in the matrix handed to the op, not onto an object
        m = Matrix.Translation(at) @ Matrix.Diagonal((0.6, 1.4, 0.5, 1.0))
        bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=0.018, matrix=m)


# ---------------------------------------------------------------- build

def app_bbox(bm):
    """Bounding box in the app's axes: (width, height, depth)."""
    xs = [v.co.x for v in bm.verts]
    ups = [v.co.z for v in bm.verts]
    backs = [v.co.y for v in bm.verts]
    return max(xs) - min(xs), max(ups) - min(ups), max(backs) - min(backs)


def build(kind):
    clear()
    if kind == "wire":
        rim_t, depth = 0.008, 0.008
    elif kind == "browline":
        rim_t, depth = 0.024, DEPTH * 0.8
    else:
        rim_t, depth = 0.022, DEPTH

    bm = bmesh.new()
    if kind != "rimless":
        for sign in (-1, 1):
            rim(bm, sign, rim_t, depth, brow=(kind == "browline"))
    bridge(bm, rim_t * 0.9, depth)
    nose_pads(bm)
    for sign in (-1, 1):
        hinge(bm, sign, max(0.008, rim_t))
        temple(bm, sign, max(0.008, rim_t * 0.8))

    # the app refuses a base whose box does not measure like a frame (baseLooksSane in
    # glassesModel.js). Fail here instead, loudly, rather than exporting a hoop again.
    w, h, d = app_bbox(bm)
    print(f"[tryon] {kind}: {w:.3f} wide × {h:.3f} tall × {d:.3f} deep  (w/h {w / h:.2f})")
    assert 1.8 < w / h < 5, f"{kind}: w/h {w / h:.2f} is not a frame — the app would reject it"
    assert d < w * 1.6, f"{kind}: {d:.3f} deep against {w:.3f} wide — too deep"

    mesh = bpy.data.meshes.new(f"frame_{kind}")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(f"frame_{kind}", mesh)     # identity transform, always
    bpy.context.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT_DIR, f"{kind}.glb"))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False)
    print(f"[tryon] wrote {path}")


if __name__ == "__main__":
    for kind in ("fullrim", "wire", "browline", "rimless"):
        build(kind)
    print("[tryon] done")
