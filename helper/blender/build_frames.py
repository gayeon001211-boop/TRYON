"""
Build the eyewear base meshes that the app fits to a photo.

Generating a frame from scratch in the browser can manage rims, a bridge and a bar for
a temple — it cannot manage a hinge, a nose pad, or an arm that tapers the way a real
one does. Those are modelled here, once, and exported as glTF; at run time the browser
only has to stretch the right base to the measured dimensions. No Blender is needed to
use the app.

Run:  blender --background --python helper/blender/build_frames.py
Out:  public/frames/{fullrim,wire,browline,rimless}.glb   (~1 unit wide, +Z forward)
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "public", "frames")

# Blender is Z-up and treats +Y as away from the viewer; the app (and glTF) are Y-up with
# -Z away. Build in Blender's terms and the exporter lands it correctly: everything below
# uses B(x, y_up, z_back) to translate from the app's convention.
def B(x, up, back):
    return (x, back, up)

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


def lens_curve(name, cx, rim, squarish=0.0):
    """A closed lens outline as a bezier circle, optionally squared off."""
    # stand the circle up in the XZ plane so it faces the viewer
    bpy.ops.curve.primitive_bezier_circle_add(
        radius=1.0, location=(cx, 0, 0), rotation=(math.pi / 2, 0, 0)
    )
    curve = bpy.context.object
    curve.name = name
    curve.scale = (LENS_W / 2 + rim, 1, LENS_H / 2 + rim)
    # bake rotation and scale into the curve data: leaving them on the object makes the
    # bevel section follow the object's axes, which distorted every lens
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for p in curve.data.splines[0].bezier_points:
        p.handle_left_type = p.handle_right_type = "AUTO"
        if squarish:
            p.co.x *= 1 + squarish * 0.12
    return curve


def rim_from_curve(curve, thickness, depth):
    """Give an outline a rectangular section: this is the rim itself."""
    prof = bpy.data.curves.new(curve.name + "_prof", "CURVE")
    prof.dimensions = "2D"
    spline = prof.splines.new("POLY")
    pts = [(-thickness, -depth), (thickness, -depth), (thickness, depth), (-thickness, depth)]  # section
    spline.points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts):
        spline.points[i].co = (x, y, 0, 1)
    spline.use_cyclic_u = True
    obj = bpy.data.objects.new(prof.name, prof)
    bpy.context.collection.objects.link(obj)
    curve.data.bevel_mode = "OBJECT"
    curve.data.bevel_object = obj
    curve.data.use_fill_caps = True
    return curve


def temple(sign, thickness, name):
    """Hinge to ear: straight run, a bend over the ear, a short hook behind it."""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 12
    spline = curve.splines.new("NURBS")
    x0 = sign * (HALF_GAP + LENS_W / 2)
    pts = [
        B(x0, 0.03, 0.02),
        B(x0 + sign * 0.02, 0.02, -0.10),
        B(x0 + sign * 0.02, 0.00, -TEMPLE_LEN * 0.6),
        B(x0 + sign * 0.015, -0.05, -TEMPLE_LEN * 0.88),
        B(x0 + sign * 0.008, -0.12, -TEMPLE_LEN * 1.0),
        B(x0 + sign * 0.004, -0.17, -TEMPLE_LEN * 0.95),
    ]
    spline.points.add(len(pts) - 1)
    for i, (x, y, z) in enumerate(pts):
        spline.points[i].co = (x, y, z, 1)
    spline.use_endpoint_u = True
    spline.order_u = 4
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    curve.bevel_depth = thickness
    curve.bevel_resolution = 4
    # a real arm narrows towards the tip
    taper = bpy.data.curves.new(name + "_taper", "CURVE")
    taper.dimensions = "2D"
    ts = taper.splines.new("POLY")
    ts.points.add(1)
    ts.points[0].co = (0, 1.0, 0, 1)
    ts.points[1].co = (1, 0.55, 0, 1)
    tobj = bpy.data.objects.new(taper.name, taper)
    bpy.context.collection.objects.link(tobj)
    curve.taper_object = tobj
    return obj


def bridge(thickness, depth):
    curve = bpy.data.curves.new("bridge", "CURVE")
    curve.dimensions = "3D"
    spline = curve.splines.new("NURBS")
    span = HALF_GAP - LENS_W / 2
    pts = [B(-span - 0.02, 0.03, 0.0), B(0, 0.075, 0.01), B(span + 0.02, 0.03, 0.0)]
    spline.points.add(len(pts) - 1)
    for i, (x, y, z) in enumerate(pts):
        spline.points[i].co = (x, y, z, 1)
    spline.use_endpoint_u = True
    spline.order_u = 3
    obj = bpy.data.objects.new("bridge", curve)
    bpy.context.collection.objects.link(obj)
    curve.bevel_depth = thickness
    curve.bevel_resolution = 4
    return obj


def nose_pads():
    """The little pads either side of the bridge — a detail the browser never had."""
    out = []
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.018, location=B(sign * 0.045, -0.03, 0.03))
        pad = bpy.context.object
        pad.scale = (0.6, 0.5, 1.4)
        pad.name = f"pad{sign}"
        out.append(pad)
    return out


def hinges(thickness):
    out = []
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=thickness * 1.1, depth=0.05,
            location=B(sign * (HALF_GAP + LENS_W / 2 + 0.005), 0.03, -0.01),
            rotation=(0, math.pi / 2, 0),
        )
        h = bpy.context.object
        h.name = f"hinge{sign}"
        out.append(h)
    return out


def build(kind):
    clear()
    parts = []
    if kind == "wire":
        rim_t, depth = 0.008, 0.008
    elif kind == "browline":
        rim_t, depth = 0.024, DEPTH * 0.8
    else:
        rim_t, depth = 0.022, DEPTH

    for sign in (-1, 1):
        cx = sign * HALF_GAP
        if kind == "rimless":
            continue
        c = lens_curve(f"rim{sign}", cx, 0.0, squarish=0.0)
        if kind == "browline":
            # keep the top arc heavy; the lower half becomes a fine wire
            c.data.bevel_depth = 0
        parts.append(rim_from_curve(c, rim_t, depth))

    parts.append(bridge(rim_t * 0.9, depth))
    parts += nose_pads()
    parts += hinges(rim_t)
    for sign in (-1, 1):
        parts.append(temple(sign, max(0.008, rim_t * 0.8), f"temple{sign}"))

    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    frame = bpy.context.object
    frame.name = f"frame_{kind}"

    bpy.ops.object.shade_smooth()
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT_DIR, f"{kind}.glb"))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False)
    print(f"[tryon] wrote {path}")


if __name__ == "__main__":
    for kind in ("fullrim", "wire", "browline", "rimless"):
        build(kind)
    print("[tryon] done")
