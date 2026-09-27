"""Parametric F1 car model for f1sim (Blender 4.2+).

Builds a 2022-2025 ground-effect style car (or the narrower 2026 variant)
from lofted cross-sections, airfoils and tubes, matched to the physics
dimensions in data/cars/*.ini (wheelbase, track, tyre sizes, cockpit and
onboard camera positions), and exports:

    <out>/<name>_body.glb         body without wheels
    <out>/<name>_wheel_front.glb  front wheel (left side; right side is mirrored in game)
    <out>/<name>_wheel_rear.glb   rear wheel
    <blend-dir>/<name>.blend      editable source scene (wheels placed at the corners)

Materials named "Livery*" are recoloured in game with the car's
[visual] livery_rgb, so one model serves any livery.

Run headless (pip install bpy==4.5.*):
    python build_car.py --car 2025 --out ../../data/models
or inside Blender:
    blender -b -P build_car.py -- --car 2025 --out ../../data/models
or open it in Blender's Scripting tab and press Run Script (edit ARGS below).

Coordinates while building are the simulator's: x forward, y left, z up,
origin on the ground below the front axle. Before export everything is
rotated so the car faces -Y in Blender, which the glTF exporter turns into
the standard glTF convention (+Y up, car facing +Z).
"""

import argparse
import math
import os
import sys

import bpy  # must come first: the bpy module provides bmesh
import bmesh  # noqa: E402

ARGS = ["--car", "2025", "--out", "//f1sim_models"]  # used when run from Blender's text editor ("//" = next to the .blend)

CARS = {
    # 2022-2025 regulations: 3.6 m wheelbase, 2.0 m wide, DRS rear wing, beam wing.
    "2025": dict(name="f1_2025", wheelbase=3.6, length=5.6, width=2.0, track_f=1.64, track_r=1.58,
                 tyre_r=0.36, tyre_w_f=0.305, tyre_w_r=0.405, beam_wing=True, rw_span=0.50),
    # 2026 regulations: shorter, narrower car, narrower tyres, no beam wing.
    "2026": dict(name="f1_2026", wheelbase=3.4, length=5.3, width=1.9, track_f=1.60, track_r=1.55,
                 tyre_r=0.36, tyre_w_f=0.280, tyre_w_r=0.375, beam_wing=False, rw_span=0.48),
}

MATERIALS = {
    # name: (base colour RGBA, metallic, roughness)
    "Livery": ((0.10, 0.22, 0.60, 1.0), 0.3, 0.35),
    "LiveryAccent": ((0.95, 0.75, 0.10, 1.0), 0.2, 0.40),
    "Carbon": ((0.035, 0.035, 0.04, 1.0), 0.1, 0.45),
    "White": ((0.85, 0.85, 0.88, 1.0), 0.0, 0.40),
    "Halo": ((0.08, 0.08, 0.09, 1.0), 0.6, 0.35),
    "Inlet": ((0.005, 0.005, 0.006, 1.0), 0.0, 0.90),
    "Helmet": ((0.95, 0.80, 0.12, 1.0), 0.1, 0.25),
    "Visor": ((0.02, 0.02, 0.03, 1.0), 0.8, 0.10),
    "Light": ((1.0, 0.05, 0.03, 1.0), 0.0, 0.30),
    "Tyre": ((0.035, 0.035, 0.035, 1.0), 0.0, 0.85),
    "TyreStripe": ((0.90, 0.10, 0.10, 1.0), 0.0, 0.60),  # red = soft compound
    "TyreText": ((0.90, 0.90, 0.90, 1.0), 0.0, 0.60),
    "Rim": ((0.12, 0.12, 0.13, 1.0), 0.8, 0.30),
    "Brake": ((0.18, 0.17, 0.16, 1.0), 0.3, 0.70),
}


# ---------------------------------------------------------------------------
# Geometry accumulation (one mesh per material keeps the draw calls low)
# ---------------------------------------------------------------------------
class Geo:
    def __init__(self):
        self.parts = {}  # material -> (verts, faces)

    def add(self, mat, verts, faces):
        vs, fs = self.parts.setdefault(mat, ([], []))
        base = len(vs)
        vs.extend(verts)
        fs.extend([tuple(i + base for i in f) for f in faces])

    def add_mirrored(self, mat, verts, faces):
        """Adds the part and its mirror image across the car centre plane (y = 0)."""
        self.add(mat, verts, faces)
        self.add(mat, [(x, -y, z) for (x, y, z) in verts], [tuple(reversed(f)) for f in faces])

    def bounds(self):
        pts = [v for vs, _ in self.parts.values() for v in vs]
        return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def loft_rings(rings, cap_start=True, cap_end=True, closed=True):
    """Connects rings (lists of 3D points of equal length) with quads; optional fan caps."""
    n = len(rings[0])
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    seg = n if closed else n - 1
    for k in range(len(rings) - 1):
        a, b = k * n, (k + 1) * n
        for i in range(seg):
            j = (i + 1) % n
            faces.append((a + i, a + j, b + j, b + i))
    if cap_start:
        faces.append(tuple(reversed(range(0, n))))
    if cap_end:
        last = (len(rings) - 1) * n
        faces.append(tuple(range(last, last + n)))
    return verts, faces


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def densify(sections, steps=5):
    """Smooth interpolation of section parameter tuples (Catmull-Rom per component)."""
    out = []
    m = len(sections)
    for k in range(m - 1):
        p0 = sections[max(k - 1, 0)]
        p1, p2 = sections[k], sections[k + 1]
        p3 = sections[min(k + 2, m - 1)]
        for s in range(steps):
            t = s / steps
            out.append(tuple(catmull(a, b, c, d, t) for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(sections[-1])
    return out


def superellipse_ring(x, yc, hw, zb, zt, n=2.6, count=32):
    zc, hz = 0.5 * (zb + zt), 0.5 * (zt - zb)
    ring = []
    for i in range(count):
        a = 2.0 * math.pi * i / count
        c, s = math.cos(a), math.sin(a)
        y = yc + hw * math.copysign(abs(c) ** (2.0 / n), c)
        z = zc + hz * math.copysign(abs(s) ** (2.0 / n), s)
        ring.append((x, y, z))
    return ring


def body_loft(sections, steps=5, count=32):
    """sections: (x, y_centre, half_width, z_bottom, z_top, exponent)."""
    dense = densify(sections, steps)
    rings = [superellipse_ring(x, yc, hw, zb, zt, n, count) for (x, yc, hw, zb, zt, n) in dense]
    return loft_rings(rings)


def airfoil(chord, thickness=0.12, camber=0.06, count=24):
    """NACA 4-digit style section in (u, v): u from 0 (leading edge) to chord, v up. Closed loop."""
    p = 0.4
    pts_u, pts_l = [], []
    for i in range(count // 2 + 1):
        beta = math.pi * i / (count // 2)
        xc = 0.5 * (1 - math.cos(beta))
        yt = 5 * thickness * (0.2969 * math.sqrt(xc) - 0.1260 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4)
        yc = camber / p ** 2 * (2 * p * xc - xc ** 2) if xc < p else camber / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * xc - xc ** 2)
        pts_u.append((xc * chord, (yc + yt) * chord))
        pts_l.append((xc * chord, (yc - yt) * chord))
    return pts_u + list(reversed(pts_l[1:-1]))


def wing(geo, mat, le_x, le_z, chord, y0, y1, aoa_deg, stations=10, rise=None, chord_fn=None, camber=0.08,
         thickness=0.10, mirrored=True):
    """Wing element along y. The section is inverted (downforce): camber points down.
    rise(y) adds height towards the tips, chord_fn(y) scales the chord."""
    rings = []
    for k in range(stations + 1):
        y = y0 + (y1 - y0) * k / stations
        c = chord * (chord_fn(y) if chord_fn else 1.0)
        dz = rise(y) if rise else 0.0
        a = math.radians(aoa_deg)
        ring = []
        for (u, v) in airfoil(c, thickness, camber):
            v = -v  # inverted wing
            # leading edge forward (+x), trailing edge back and up by the angle of attack
            x = le_x - (u * math.cos(a))
            z = le_z + dz + u * math.sin(a) + v * math.cos(a)
            ring.append((x, y, z))
        rings.append(ring)
    v, f = loft_rings(rings)
    (geo.add_mirrored if mirrored else geo.add)(mat, v, f)


def plate(outline_xz, y, thickness):
    """Flat plate in the x-z plane (e.g. an endplate) centred on y."""
    n = len(outline_xz)
    verts = [(x, y + thickness / 2, z) for (x, z) in outline_xz] + [(x, y - thickness / 2, z) for (x, z) in outline_xz]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, n + i, n + j, j))
    return verts, faces


def plate_xy(outline_xy, z0, z1):
    """Flat plate in the x-y plane between heights z0 and z1 (e.g. the floor)."""
    n = len(outline_xy)
    verts = [(x, y, z1) for (x, y) in outline_xy] + [(x, y, z0) for (x, y) in outline_xy]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return verts, faces


def box(mn, mx):
    (x0, y0, z0), (x1, y1, z1) = mn, mx
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return verts, faces


def tube(path, radius, count=10, flatten=1.0):
    """Tube along a polyline. flatten < 1 gives an aerofoil-like flat tube (wishbones)."""
    rings = []
    for k, p in enumerate(path):
        a = path[max(k - 1, 0)]
        b = path[min(k + 1, len(path) - 1)]
        t = [b[i] - a[i] for i in range(3)]
        L = math.sqrt(sum(c * c for c in t)) or 1.0
        t = [c / L for c in t]
        ref = (0.0, 0.0, 1.0) if abs(t[2]) < 0.9 else (1.0, 0.0, 0.0)
        u = [ref[1] * t[2] - ref[2] * t[1], ref[2] * t[0] - ref[0] * t[2], ref[0] * t[1] - ref[1] * t[0]]
        Lu = math.sqrt(sum(c * c for c in u)) or 1.0
        u = [c / Lu for c in u]
        w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]]
        ring = []
        for i in range(count):
            ang = 2 * math.pi * i / count
            cu, sw = math.cos(ang) * radius, math.sin(ang) * radius * flatten
            ring.append(tuple(p[j] + u[j] * cu + w[j] * sw for j in range(3)))
        rings.append(ring)
    return loft_rings(rings)


def revolve(profile, segments=48, y_axis=True):
    """Surface of revolution around the y axis; profile = [(radius, y), ...]."""
    rings = []
    for (r, y) in profile:
        rings.append([(r * math.cos(2 * math.pi * i / segments), y, r * math.sin(2 * math.pi * i / segments))
                      for i in range(segments)])
    return loft_rings(rings, cap_start=False, cap_end=False)


def annulus_sector(r0, r1, y, a0, a1, steps=8):
    """Flat ring sector facing +y (tyre lettering, wheel-cover slots)."""
    verts, faces = [], []
    for k in range(steps + 1):
        a = a0 + (a1 - a0) * k / steps
        verts.append((r0 * math.cos(a), y, r0 * math.sin(a)))
        verts.append((r1 * math.cos(a), y, r1 * math.sin(a)))
    for k in range(steps):
        i = 2 * k
        faces.append((i, i + 1, i + 3, i + 2))
    return verts, faces


def disc(r, y, segments=48, facing=1):
    verts = [(r * math.cos(2 * math.pi * i / segments), y, r * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
    face = tuple(range(segments)) if facing > 0 else tuple(reversed(range(segments)))
    return verts, [face]


# ---------------------------------------------------------------------------
# Car body
# ---------------------------------------------------------------------------
def build_body(c):
    g = Geo()
    wb = c["wheelbase"]
    sx = wb / 3.6                    # stretch positions between the axles
    W = c["width"] / 2.0             # half width
    X = lambda x: x * sx if x < 0 else x  # noqa: E731
    rear = -wb
    front_oh = 1.1 + (c["length"] - (wb + 1.95)) / 2.0  # matches the game's anchor (nose = front axle + 1.1)
    rear_oh = c["length"] - wb - front_oh

    # --- Survival cell and nose (x, yc, half-width, z bottom, z top, exponent)
    mono = [
        (front_oh - 0.005, 0, 0.05, 0.19, 0.27, 2.2),
        (front_oh - 0.20, 0, 0.09, 0.16, 0.33, 2.4),
        (0.45, 0, 0.13, 0.15, 0.42, 2.6),
        (0.0, 0, 0.18, 0.13, 0.52, 2.8),
        (X(-0.55), 0, 0.24, 0.09, 0.60, 3.0),
        (X(-1.00), 0, 0.30, 0.07, 0.65, 3.2),
        (X(-1.35), 0, 0.37, 0.06, 0.62, 3.4),   # cockpit opening: sides stay below the eye line
        (X(-1.95), 0, 0.40, 0.06, 0.62, 3.4),
        (X(-2.10), 0, 0.38, 0.07, 0.74, 3.0),   # behind the driver (fuel cell)
        (X(-2.55), 0, 0.33, 0.09, 0.78, 2.8),   # engine cover
        (X(-3.00), 0, 0.24, 0.12, 0.62, 2.6),
        (X(-3.40), 0, 0.15, 0.15, 0.50, 2.4),
        (rear - 0.30, 0, 0.10, 0.18, 0.42, 2.3),  # gearbox
        (rear - 0.55, 0, 0.07, 0.22, 0.36, 2.2),
    ]
    v, f = body_loft(mono, steps=4, count=36)
    g.add("Livery", v, f)

    # White nose tip / accent band.
    v, f = body_loft([(front_oh, 0, 0.045, 0.195, 0.265, 2.2), (front_oh - 0.12, 0, 0.075, 0.175, 0.30, 2.3)], steps=2, count=36)
    g.add("White", v, f)

    # Cockpit opening: dark tub interior seen from outside, padded rim, headrest.
    ck0, ck1 = X(-1.30), X(-2.02)
    v, f = body_loft([(ck0, 0, 0.23, 0.30, 0.625, 4.0), (ck1, 0, 0.26, 0.30, 0.625, 4.0)], steps=1, count=36)
    g.add("Inlet", v, f)
    rim = [(ck0 + (ck1 - ck0) * t, 0.265 - 0.02 * math.sin(math.pi * t), 0.64) for t in [i / 12 for i in range(13)]]
    v, f = tube(rim, 0.018, 8)
    g.add_mirrored("Carbon", v, f)
    v, f = box((ck1 - 0.02, -0.26, 0.60), (ck1 + 0.12, -0.14, 0.74))
    g.add("Carbon", v, f)
    v, f = box((ck1 - 0.02, 0.14, 0.60), (ck1 + 0.12, 0.26, 0.74))
    g.add("Carbon", v, f)

    # Driver: helmet sits just behind the cockpit camera eye point (eye ~ x = -1.66, z = 0.79).
    hx, hz, hr = X(-1.66) - 0.17, 0.80, 0.135
    rings = []
    for k in range(1, 12):
        lat = -math.pi / 2 + math.pi * k / 12
        rings.append([(hx + hr * math.cos(lat) * math.cos(2 * math.pi * i / 24), hr * math.cos(lat) * math.sin(2 * math.pi * i / 24),
                       hz + hr * math.sin(lat)) for i in range(24)])
    v, f = loft_rings(rings)
    g.add("Helmet", v, f)
    v, f = body_loft([(hx + hr * 0.93, 0, 0.09, 0.78, 0.84, 3.0), (hx + hr * 0.80, 0, 0.11, 0.765, 0.855, 3.0)], steps=1, count=24)
    g.add("Visor", v, f)

    # Halo: rear legs behind the driver, hoop above the eye line, slim centre pillar in front.
    halo = []
    for k in range(17):
        t = k / 16
        x = X(-2.05) + (X(-1.20) - X(-2.05)) * t
        y = 0.30 * math.cos(t * math.pi / 2) ** 0.8
        z = 0.93 - 0.04 * t
        halo.append((x, y, z))
    legs = [(X(-2.12), 0.30, 0.70), (X(-2.08), 0.30, 0.86), halo[0]]
    v, f = tube(legs + halo[1:], 0.022, 10)
    g.add_mirrored("Halo", v, f)
    v, f = tube([(X(-1.20), 0.0, 0.89), (X(-1.08), 0.0, 0.78), (X(-0.98), 0.0, 0.64)], 0.024, 10, flatten=0.6)
    g.add("Halo", v, f)

    # Airbox / roll hoop above and behind the driver, with T-cam pod.
    v, f = body_loft([(X(-2.08), 0, 0.14, 0.70, 0.97, 2.4), (X(-2.25), 0, 0.12, 0.70, 0.99, 2.4),
                      (X(-2.55), 0, 0.10, 0.70, 0.86, 2.4), (X(-2.85), 0, 0.06, 0.62, 0.70, 2.4)], steps=4, count=28)
    g.add("Livery", v, f)
    v, f = body_loft([(X(-2.075), 0, 0.10, 0.76, 0.93, 2.2), (X(-2.09), 0, 0.10, 0.76, 0.93, 2.2)], steps=1, count=24)
    g.add("Inlet", v, f)
    # T-cam pod directly under the onboard T-cam eye point (x ~ -2.51, z ~ 1.11), so it stays out of shot.
    v, f = box((X(-2.66), -0.05, 0.84), (X(-2.52), 0.05, 0.93))
    g.add("LiveryAccent", v, f)

    # Shark fin.
    v, f = plate([(X(-2.55), 0.84), (X(-3.55), 0.60), (X(-3.55), 0.46), (X(-2.55), 0.72)], 0.0, 0.008)
    g.add("Livery", v, f)

    # Sidepods (left, mirrored): inlet, downwash ramp, coke-bottle waist.
    pod = [
        (X(-1.05), 0.60, 0.20, 0.12, 0.56, 3.2),
        (X(-1.45), 0.62, 0.21, 0.10, 0.55, 3.4),
        (X(-2.05), 0.56, 0.23, 0.10, 0.50, 3.2),
        (X(-2.65), 0.44, 0.19, 0.10, 0.40, 3.0),
        (X(-3.15), 0.30, 0.11, 0.12, 0.30, 2.6),
        (X(-3.45), 0.20, 0.05, 0.15, 0.24, 2.4),
    ]
    v, f = body_loft(pod, steps=4, count=32)
    g.add_mirrored("Livery", v, f)
    v, f = body_loft([(X(-1.045), 0.60, 0.17, 0.26, 0.53, 3.0), (X(-1.06), 0.60, 0.17, 0.26, 0.53, 3.0)], steps=1, count=24)
    g.add_mirrored("Inlet", v, f)

    # Mirrors on the sidepod shoulders.
    v, f = body_loft([(X(-1.02), 0.57, 0.08, 0.64, 0.70, 3.0), (X(-1.12), 0.57, 0.08, 0.63, 0.71, 3.0)], steps=1, count=20)
    g.add_mirrored("Carbon", v, f)
    v, f = tube([(X(-1.12), 0.52, 0.66), (X(-1.20), 0.40, 0.60)], 0.012, 8)
    g.add_mirrored("Carbon", v, f)

    # Floor: leading edge behind the front wheels, full width, narrowing at the rear tyres.
    fl = [(X(-0.55), 0.18), (X(-0.85), 0.72), (X(-1.20), W - 0.12), (X(-2.95), W - 0.12), (X(-3.15), 0.66),
          (rear + 0.18, 0.55), (rear - 0.55, 0.50)]
    outline = fl + [(x, -y) for (x, y) in reversed(fl)]
    v, f = plate_xy(outline, 0.035, 0.060)
    g.add("Carbon", v, f)
    # Floor edge wing and venturi inlet fences.
    edge = [(X(-1.25), W - 0.10, 0.10), (X(-2.00), W - 0.10, 0.11), (X(-2.85), W - 0.10, 0.12)]
    v, f = tube(edge, 0.02, 8, flatten=0.35)
    g.add_mirrored("Carbon", v, f)
    for yf in (0.30, 0.45, 0.60):
        v, f = plate([(X(-0.60), 0.06), (X(-0.60), 0.20), (X(-1.40), 0.14), (X(-1.60), 0.06)], yf, 0.006)
        g.add_mirrored("Carbon", v, f)

    # Diffuser: upswept roof with strakes and side walls.
    d0, d1 = rear + 0.20, rear - 0.60
    ramp = []
    for k in range(9):
        t = k / 8
        x = d0 + (d1 - d0) * t
        z = 0.06 + 0.30 * t ** 1.6
        ramp.append([(x, 0.50, z), (x, -0.50, z), (x, -0.50, z + 0.012), (x, 0.50, z + 0.012)])
    v, f = loft_rings(ramp)
    g.add("Carbon", v, f)
    for yf in (0.18, 0.36):
        v, f = plate([(d0, 0.06), (d1, 0.36), (d1, 0.10)], yf, 0.006)
        g.add_mirrored("Carbon", v, f)
    v, f = plate([(d0, 0.06), (d1, 0.36), (d1, 0.48), (d0, 0.20)], 0.50, 0.008)
    g.add_mirrored("Carbon", v, f)

    # Rear crash structure with the rain light (defines the tail of the car).
    v, f = box((rear - rear_oh + 0.10, -0.06, 0.24), (rear - 0.45, 0.06, 0.36))
    g.add("Carbon", v, f)
    v, f = box((rear - rear_oh, -0.04, 0.26), (rear - rear_oh + 0.10, 0.04, 0.34))
    g.add("Light", v, f)

    # Rear wing: main plane + DRS flap between curved endplates, swan-neck pillar.
    span = c["rw_span"]
    tip = lambda y: 0.05 * max(0.0, (abs(y) - (span - 0.12)) / 0.12) ** 2  # noqa: E731
    rw_le = rear - 0.20
    wing(g, "Carbon", rw_le, 0.79, 0.34, 0.0, span, 8, stations=12, rise=lambda y: -tip(y), camber=0.10)
    wing(g, "Carbon", rw_le - 0.30, 0.90, 0.22, 0.0, span - 0.01, 28, stations=12, rise=lambda y: -tip(y), camber=0.06)
    ep = [(rw_le + 0.08, 0.40), (rw_le + 0.08, 0.92), (rw_le - 0.05, 1.00), (rw_le - 0.50, 1.00), (rw_le - 0.58, 0.90),
          (rw_le - 0.58, 0.55), (rw_le - 0.35, 0.40)]
    v, f = plate(ep, span + 0.004, 0.012)
    g.add_mirrored("Livery", v, f)
    v, f = plate([(rw_le - 0.05, 0.36), (rw_le - 0.05, 0.80), (rw_le - 0.20, 0.80), (rw_le - 0.25, 0.36)], 0.0, 0.02)
    g.add("Carbon", v, f)
    if c["beam_wing"]:
        wing(g, "Carbon", rear - 0.10, 0.40, 0.18, 0.0, span - 0.05, 6, stations=8, camber=0.08)
        wing(g, "Carbon", rear - 0.30, 0.46, 0.14, 0.0, span - 0.05, 18, stations=8, camber=0.06)

    # Front wing: four elements sweeping up to the endplates, nose on top of element 2.
    fw_le = front_oh - 0.03
    rise = lambda y: 0.10 * max(0.0, (abs(y) - 0.45) / (W - 0.45)) ** 1.6  # noqa: E731
    elements = [(fw_le, 0.075, 0.30, 4), (fw_le - 0.24, 0.115, 0.17, 12), (fw_le - 0.36, 0.155, 0.14, 22),
                (fw_le - 0.47, 0.195, 0.12, 32)]
    for i, (le, z, ch, aoa) in enumerate(elements):
        wing(g, "Carbon" if i < 2 else "Livery", le, z, ch, 0.0, W - 0.02, aoa, stations=14,
             rise=lambda y, k=i: rise(y) * (0.4 + 0.25 * k), camber=0.07)
    ep = [(fw_le + 0.02, 0.06), (fw_le + 0.02, 0.22), (fw_le - 0.25, 0.34), (fw_le - 0.62, 0.34), (fw_le - 0.66, 0.06)]
    v, f = plate(ep, W - 0.01, 0.012)
    g.add_mirrored("Carbon", v, f)
    # Nose pylons down to the main plane.
    v, f = plate([(front_oh - 0.10, 0.20), (front_oh - 0.35, 0.20), (front_oh - 0.35, 0.10), (front_oh - 0.10, 0.09)], 0.05, 0.01)
    g.add_mirrored("Carbon", v, f)

    # Suspension (static): wishbones and push/pull rods from the chassis to the wheel centres.
    tr_f, tr_r, r = c["track_f"] / 2, c["track_r"] / 2, c["tyre_r"]
    wf, wr = c["tyre_w_f"], c["tyre_w_r"]
    for (ax, tr, w, inner_y, zc) in ((0.0, tr_f, wf, 0.17, r), (rear, tr_r, wr, 0.22, r)):
        hub_y = tr - w / 2 - 0.05
        for dz, dx in ((0.12, 0.28), (-0.10, 0.30)):
            for sgn in (1, -1):
                v, f = tube([(ax + sgn * dx, inner_y, zc + dz * 0.8 + 0.05), (ax, hub_y, zc + dz)], 0.014, 8, flatten=0.45)
                g.add_mirrored("Carbon", v, f)
        v, f = tube([(ax - 0.05, inner_y + 0.02, zc + 0.30), (ax, hub_y, zc - 0.08)], 0.012, 8)
        g.add_mirrored("Carbon", v, f)
        # Track rod / toe link.
        v, f = tube([(ax + 0.12 if ax == 0.0 else ax - 0.12, inner_y, zc + 0.08), (ax + 0.10 if ax == 0.0 else ax - 0.10, hub_y, zc + 0.08)], 0.010, 8)
        g.add_mirrored("Carbon", v, f)

    # Front brake duct winglets on the uprights (static) are part of the wheel look; skipped.
    return g


# ---------------------------------------------------------------------------
# Wheel (left side: outer face towards +y; centre at the origin, axle = y)
# ---------------------------------------------------------------------------
def build_wheel(c, width):
    g = Geo()
    R = c["tyre_r"]
    rim = 0.2286 + 0.008   # 18-inch rim + flange
    h = width / 2
    shoulder = 0.035
    prof = []
    # Tyre cross-section from the inner bead over the tread to the outer bead.
    for k in range(7):
        a = math.pi / 2 * k / 6
        prof.append((rim + (R - shoulder - rim) * math.sin(a) ** 0.6, -h + 0.015 * (1 - math.sin(a))))
    for k in range(7):
        a = math.pi / 2 * k / 6
        prof.append((R - shoulder + shoulder * math.sin(a), -h + shoulder * (1 - math.cos(a)) + 0.01))
    for k in range(7):
        a = math.pi / 2 * k / 6
        prof.append((R - shoulder * (1 - math.cos(a)), h - shoulder - 0.01 + shoulder * math.sin(a)))
    for k in range(7):
        a = math.pi / 2 * k / 6
        prof.append((R - shoulder - (R - shoulder - rim) * math.sin(a) ** 1.6, h - 0.015 * math.sin(a)))
    v, f = revolve(prof, 64)
    g.add("Tyre", v, f)

    # Compound stripe and lettering blocks on the outer sidewall (show the rotation).
    ys = h - 0.004
    v, f = revolve([(0.300, ys + 0.0005), (0.312, ys + 0.0005)], 64)
    g.add("TyreStripe", v, f)
    for k in range(4):
        a0 = k * math.pi / 2 + 0.25
        v, f = annulus_sector(0.322, 0.340, ys - 0.004, a0, a0 + 0.9, steps=8)
        g.add("TyreText", v, f)

    # Rim barrel and outer wheel cover (2022+ cars run solid covers).
    v, f = revolve([(rim, -h + 0.02), (rim - 0.01, -h + 0.03), (rim - 0.01, h - 0.04), (rim, h - 0.02)], 48)
    g.add("Rim", v, f)
    v, f = revolve([(rim, h - 0.03), (0.16, h - 0.045), (0.07, h - 0.05)], 48)
    g.add("Rim", v, f)
    for k in range(5):
        a0 = k * 2 * math.pi / 5
        v, f = annulus_sector(0.10, 0.20, h - 0.043, a0, a0 + 0.55, steps=4)
        g.add("Inlet", v, f)
    # Wheel nut.
    v, f = revolve([(0.055, h - 0.05), (0.055, h - 0.02), (0.03, h - 0.012), (0.0, h - 0.012)], 24)
    g.add("LiveryAccent", v, f)
    # Brake drum / duct inside the rim.
    v, f = revolve([(0.0, -h + 0.02), (0.20, -h + 0.02), (0.20, h - 0.07), (0.0, h - 0.07)], 36)
    g.add("Brake", v, f)
    return g


# ---------------------------------------------------------------------------
# Blender scene, materials, export
# ---------------------------------------------------------------------------
def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough = MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    m.diffuse_color = col
    return m


def to_objects(geo, name, collection):
    """Creates one object per material; rotates sim axes -> Blender (car faces -Y)."""
    objs = []
    for mat, (verts, faces) in geo.parts.items():
        me = bpy.data.meshes.new(f"{name}_{mat}")
        bverts = [(y, -x, z) for (x, y, z) in verts]
        me.from_pydata(bverts, [], faces)
        me.validate(clean_customdata=False)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(material(mat))
        for p in me.polygons:
            p.use_smooth = True
        if hasattr(me, "set_sharp_from_angle"):
            me.set_sharp_from_angle(angle=math.radians(35))
        ob = bpy.data.objects.new(f"{name}_{mat}", me)
        collection.objects.link(ob)
        objs.append(ob)
    return objs


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_materials="EXPORT")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--car", default="2025", choices=sorted(CARS))
    ap.add_argument("--out", default=".", help="directory for the .glb files")
    ap.add_argument("--blend-dir", default=None, help="directory for the editable .blend (default: --out)")
    a = ap.parse_args(argv)
    c = CARS[a.car]
    out = bpy.path.abspath(a.out) if a.out.startswith("//") else os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    body = build_body(c)
    mn, mx = body.bounds()
    print(f"body bounds x {mn[0]:.3f}..{mx[0]:.3f} (length {mx[0] - mn[0]:.3f}, target {c['length']}), "
          f"y {mn[1]:.3f}..{mx[1]:.3f}, z {mn[2]:.3f}..{mx[2]:.3f}")

    col_body = bpy.data.collections.new("Body")
    col_wf = bpy.data.collections.new("WheelFront")
    col_wr = bpy.data.collections.new("WheelRear")
    for col in (col_body, col_wf, col_wr):
        scene.collection.children.link(col)
    body_objs = to_objects(body, "body", col_body)
    wf_objs = to_objects(build_wheel(c, c["tyre_w_f"]), "wheel_front", col_wf)
    wr_objs = to_objects(build_wheel(c, c["tyre_w_r"]), "wheel_rear", col_wr)

    name = c["name"]
    export(body_objs, os.path.join(out, f"{name}_body.glb"))
    export(wf_objs, os.path.join(out, f"{name}_wheel_front.glb"))
    export(wr_objs, os.path.join(out, f"{name}_wheel_rear.glb"))

    # Editable scene: wheels placed at their corners for a complete preview.
    for objs, ax, tr in ((wf_objs, 0.0, c["track_f"] / 2), (wr_objs, -c["wheelbase"], c["track_r"] / 2)):
        for sgn in (1, -1):
            for o in objs:
                inst = o.copy()
                col_body.objects.link(inst)
                inst.location = (sgn * tr, -ax, c["tyre_r"])  # Blender: x = sim y, y = -sim x
                if sgn < 0:
                    inst.scale = (-1, 1, 1)
    blend_dir = os.path.abspath(a.blend_dir) if a.blend_dir else out
    os.makedirs(blend_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{name}.blend"), compress=True)
    print("exported", name, "to", out)


if __name__ == "__main__":
    if "--" in sys.argv:                                     # blender -b -P build_car.py -- ...
        main(sys.argv[sys.argv.index("--") + 1:])
    elif os.path.basename(sys.argv[0]).startswith("build_car"):  # python build_car.py ... (bpy module)
        main(sys.argv[1:])
    else:                                                    # Blender text editor: Run Script
        main(ARGS)
