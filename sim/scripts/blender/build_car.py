"""Parametric F1 car model for f1sim (Blender 4.2+).

Builds a 2022-2025 ground-effect car (or the narrower 2026 variant) from
lofted cross-sections, airfoils and tubes, matched to the physics
dimensions in data/cars/*.ini (wheelbase, track, tyre sizes, cockpit and
onboard camera positions). Shape reference: modern ground-effect cars with
downwash sidepods, deep undercut, venturi floor with a plank, spoon rear
wing with a single pillar, beam wing and a strake diffuser. No real team
logos or sponsor marks are reproduced.

Exports:
    <out>/<name>_body.glb           body without wheels
    <out>/<name>_wheel_front.glb    front wheel (left side; right side is mirrored in game)
    <out>/<name>_wheel_rear.glb     rear wheel
    <out>/steering_wheel.glb        steering wheel (display, buttons, rotaries, paddles)
    <blend-dir>/<name>.blend        editable source scene (wheels placed at the corners)

Materials named "Livery*" are recoloured in game with the car's
[visual] livery_rgb (accents keep their colour), so one model serves any
paint scheme.

Run headless (pip install bpy==4.5.*):
    python build_car.py --car 2025 --out ../../data/models --blend-dir ../../art/blender
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

ARGS = ["--car", "2025", "--out", "//f1sim_models"]  # used from Blender's text editor ("//" = next to the .blend)

CARS = {
    # 2022-2025 regulations: 3.6 m wheelbase, 2.0 m wide, DRS rear wing, beam wing.
    "2025": dict(name="f1_2025", wheelbase=3.6, length=5.6, width=2.0, track_f=1.64, track_r=1.58,
                 tyre_r=0.36, tyre_w_f=0.305, tyre_w_r=0.405, beam_wing=True, rw_span=0.52),
    # 2026 regulations: shorter, narrower car, narrower tyres, no beam wing.
    "2026": dict(name="f1_2026", wheelbase=3.4, length=5.3, width=1.9, track_f=1.60, track_r=1.55,
                 tyre_r=0.36, tyre_w_f=0.280, tyre_w_r=0.375, beam_wing=False, rw_span=0.50),
}

# name: (base colour RGBA linear, metallic, roughness, emission RGB linear or None, texture or None)
MATERIALS = {
    "Livery": ((0.012, 0.018, 0.060, 1.0), 0.15, 0.30, None, None),        # recoloured in game
    "AccentYellow": ((0.95, 0.62, 0.02, 1.0), 0.05, 0.32, None, None),
    "AccentRed": ((0.75, 0.02, 0.03, 1.0), 0.05, 0.32, None, None),
    "Carbon": ((1.0, 1.0, 1.0, 1.0), 0.15, 0.28, None, "carbon"),          # woven carbon, clear coat
    "CarbonMatte": ((0.030, 0.030, 0.033, 1.0), 0.05, 0.60, None, None),
    "Halo": ((0.012, 0.018, 0.060, 1.0), 0.15, 0.30, None, None),
    "Inlet": ((0.004, 0.004, 0.005, 1.0), 0.0, 0.90, None, None),
    "Metal": ((0.60, 0.58, 0.55, 1.0), 1.0, 0.35, None, None),
    "Exhaust": ((0.55, 0.40, 0.28, 1.0), 1.0, 0.30, None, None),           # heat-tinted titanium
    "Plank": ((0.30, 0.18, 0.09, 1.0), 0.0, 0.75, None, None),
    "Skid": ((0.55, 0.55, 0.57, 1.0), 1.0, 0.45, None, None),
    "Helmet": ((0.90, 0.62, 0.03, 1.0), 0.1, 0.20, None, None),
    "Visor": ((0.01, 0.01, 0.015, 1.0), 0.9, 0.06, None, None),
    "Light": ((0.8, 0.02, 0.01, 1.0), 0.0, 0.30, (6.0, 0.15, 0.08), None),  # rain light LEDs
    "Tyre": ((0.022, 0.022, 0.022, 1.0), 0.0, 0.88, None, None),
    "TyreStripe": ((0.95, 0.70, 0.02, 1.0), 0.0, 0.55, None, None),        # yellow = medium compound
    "TyreText": ((0.85, 0.85, 0.85, 1.0), 0.0, 0.60, None, None),
    "Rim": ((0.015, 0.015, 0.017, 1.0), 0.15, 0.40, None, None),
    "RimGold": ((0.80, 0.55, 0.20, 1.0), 1.0, 0.25, None, None),
    "Brake": ((0.10, 0.10, 0.10, 1.0), 0.2, 0.70, None, None),
    "Rubber": ((0.015, 0.015, 0.015, 1.0), 0.0, 0.80, None, None),
    "Screen": ((0.01, 0.01, 0.012, 1.0), 0.0, 0.15, (0.04, 0.06, 0.07), None),
    "LedGreen": ((0.05, 0.8, 0.1, 1.0), 0.0, 0.3, (0.4, 3.0, 0.5), None),
    "LedRed": ((0.8, 0.05, 0.05, 1.0), 0.0, 0.3, (3.0, 0.2, 0.2), None),
    "LedBlue": ((0.05, 0.2, 0.9, 1.0), 0.0, 0.3, (0.3, 0.8, 3.0), None),
    "BtnGreen": ((0.05, 0.45, 0.10, 1.0), 0.0, 0.35, None, None),
    "BtnRed": ((0.60, 0.03, 0.03, 1.0), 0.0, 0.35, None, None),
    "BtnYellow": ((0.85, 0.65, 0.03, 1.0), 0.0, 0.35, None, None),
    "BtnBlue": ((0.03, 0.18, 0.65, 1.0), 0.0, 0.35, None, None),
    "BtnWhite": ((0.80, 0.80, 0.80, 1.0), 0.0, 0.35, None, None),
    "BtnOrange": ((0.85, 0.30, 0.03, 1.0), 0.0, 0.35, None, None),
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

    def add_multi(self, parts, mirrored=False):
        for mat, (v, f) in parts.items():
            (self.add_mirrored if mirrored else self.add)(mat, v, f)

    def bounds(self):
        pts = [v for vs, _ in self.parts.values() for v in vs]
        return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]


def loft_rings(rings, cap_start=True, cap_end=True, closed=True):
    """Connects rings (lists of 3D points of equal length) with quads; optional n-gon caps."""
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


def section_at(sections, x, steps=8):
    """Interpolated section parameters at position x (sections ordered front -> back)."""
    dense = densify(sections, steps)
    for a, b in zip(dense, dense[1:]):
        if a[0] >= x >= b[0]:
            t = (a[0] - x) / max(a[0] - b[0], 1e-9)
            return tuple(pa + (pb - pa) * t for pa, pb in zip(a, b))
    return dense[0] if x > dense[0][0] else dense[-1]


def superellipse_ring(x, yc, hw, zb, zt, n=2.6, count=32):
    """Ring of points; index 0 = outer side (+y), count/4 = top, count/2 = -y side, 3count/4 = bottom."""
    zc, hz = 0.5 * (zb + zt), 0.5 * (zt - zb)
    ring = []
    for i in range(count):
        a = 2.0 * math.pi * i / count
        c, s = math.cos(a), math.sin(a)
        y = yc + hw * math.copysign(abs(c) ** (2.0 / n), c)
        z = zc + hz * math.copysign(abs(s) ** (2.0 / n), s)
        ring.append((x, y, z))
    return ring


def body_loft(sections, base_mat, steps=5, count=32, paints=(), caps=True):
    """Lofted body; sections: (x, y_centre, half_width, z_bottom, z_top, exponent).
    paints: (material, x_front, x_back, angle_from_deg, angle_to_deg) zones; angle 0 = +y side,
    90 = top, 180 = -y side, 270 = bottom. Returns {material: (verts, faces)}."""
    dense = densify(sections, steps)
    rings = [superellipse_ring(x, yc, hw, zb, zt, n, count) for (x, yc, hw, zb, zt, n) in dense]
    verts, faces = loft_rings(rings, caps, caps)
    out = {}
    nq = (len(rings) - 1) * count
    for fi, f in enumerate(faces):
        mat = base_mat
        if fi < nq:
            k, i = divmod(fi, count)
            x = 0.5 * (dense[k][0] + dense[k + 1][0])
            ang = (i + 0.5) * 360.0 / count
            for (pm, x0, x1, a0, a1) in paints:
                inside_a = (a0 <= ang <= a1) if a0 <= a1 else (ang >= a0 or ang <= a1)
                if x0 >= x >= x1 and inside_a:
                    mat = pm
        out.setdefault(mat, []).append(f)
    return {m: (verts, fs) for m, fs in out.items()}


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


def wing(le_x, le_z, chord, y0, y1, aoa_deg, stations=12, rise=None, chord_fn=None, sweep=None, aoa_fn=None,
         camber=0.08, thickness=0.10):
    """Inverted wing element along y (downforce). rise(y): height offset, chord_fn(y): chord scale,
    sweep(y): leading edge moves back by this much, aoa_fn(y): extra angle of attack in degrees."""
    rings = []
    for k in range(stations + 1):
        y = y0 + (y1 - y0) * k / stations
        c = chord * (chord_fn(y) if chord_fn else 1.0)
        dz = rise(y) if rise else 0.0
        dx = sweep(y) if sweep else 0.0
        a = math.radians(aoa_deg + (aoa_fn(y) if aoa_fn else 0.0))
        ring = []
        for (u, v) in airfoil(c, thickness, camber):
            v = -v  # inverted
            ring.append((le_x - dx - u * math.cos(a), y, le_z + dz + u * math.sin(a) + v * math.cos(a)))
        rings.append(ring)
    return loft_rings(rings)


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
    """Flat plate in the x-y plane between heights z0 and z1."""
    n = len(outline_xy)
    verts = [(x, y, z1) for (x, y) in outline_xy] + [(x, y, z0) for (x, y) in outline_xy]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    return verts, faces


def plate_yz(outline_yz, x, thickness):
    """Flat plate in the y-z plane (facing forward/back) centred on x."""
    n = len(outline_yz)
    verts = [(x + thickness / 2, y, z) for (y, z) in outline_yz] + [(x - thickness / 2, y, z) for (y, z) in outline_yz]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, n + i, n + j, j))
    return verts, faces


def box(mn, mx):
    (x0, y0, z0), (x1, y1, z1) = mn, mx
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return verts, faces


def tube(path, radius, count=10, flatten=1.0, radii=None):
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
        r = radii[k] if radii else radius
        ring = []
        for i in range(count):
            ang = 2 * math.pi * i / count
            cu, sw = math.cos(ang) * r, math.sin(ang) * r * flatten
            ring.append(tuple(p[j] + u[j] * cu + w[j] * sw for j in range(3)))
        rings.append(ring)
    return loft_rings(rings)


def revolve(profile, segments=48, axis="y", centre=(0.0, 0.0, 0.0)):
    """Surface of revolution; profile = [(radius, position along the axis), ...]."""
    cx, cy, cz = centre
    rings = []
    for (r, t) in profile:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            c, s = r * math.cos(a), r * math.sin(a)
            if axis == "y":
                ring.append((cx + c, cy + t, cz + s))
            elif axis == "x":
                ring.append((cx + t, cy + c, cz + s))
            else:
                ring.append((cx + c, cy + s, cz + t))
        rings.append(ring)
    return loft_rings(rings, cap_start=False, cap_end=False)


def annulus_sector(r0, r1, y, a0, a1, steps=8):
    """Flat ring sector in the x-z plane at y (tyre lettering, wheel-cover slots)."""
    verts, faces = [], []
    for k in range(steps + 1):
        a = a0 + (a1 - a0) * k / steps
        verts.append((r0 * math.cos(a), y, r0 * math.sin(a)))
        verts.append((r1 * math.cos(a), y, r1 * math.sin(a)))
    for k in range(steps):
        i = 2 * k
        faces.append((i, i + 1, i + 3, i + 2))
    return verts, faces


def section_poly_loft(stations, profile_fn, count_y=24):
    """Loft of arbitrary cross-sections: profile_fn(x) -> (ys, z_bottom(y), z_top(y)) across the car."""
    rings = []
    for x in stations:
        ys, zb, zt = profile_fn(x)
        top = [(x, y, zt(y)) for y in ys]
        bot = [(x, y, zb(y)) for y in reversed(ys)]
        rings.append(top + bot)
    return loft_rings(rings)


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
    tail = rear - rear_oh

    # --- Survival cell, nose and engine cover (x, yc, half-width, z bottom, z top, exponent)
    mono = [
        (front_oh - 0.07, 0, 0.045, 0.150, 0.215, 2.2),   # nose tip sits on the 2nd wing element
        (front_oh - 0.30, 0, 0.075, 0.150, 0.265, 2.3),
        (0.50, 0, 0.115, 0.145, 0.360, 2.5),
        (0.05, 0, 0.165, 0.130, 0.470, 2.8),
        (X(-0.45), 0, 0.215, 0.100, 0.570, 3.0),
        (X(-0.95), 0, 0.270, 0.070, 0.640, 3.2),
        (X(-1.20), 0, 0.320, 0.060, 0.650, 3.4),
        (X(-1.60), 0, 0.360, 0.060, 0.625, 3.6),          # cockpit sides stay below the eye line
        (X(-1.98), 0, 0.370, 0.060, 0.640, 3.4),
        (X(-2.15), 0, 0.330, 0.080, 0.800, 3.0),          # behind the driver, up into the airbox
        (X(-2.55), 0, 0.270, 0.100, 0.820, 2.8),
        (X(-2.95), 0, 0.200, 0.130, 0.660, 2.6),
        (X(-3.30), 0, 0.140, 0.160, 0.540, 2.4),
        (rear - 0.10, 0, 0.100, 0.200, 0.470, 2.3),       # gearbox under the rear wing
        (rear - 0.42, 0, 0.075, 0.240, 0.420, 2.2),
    ]
    paints = [
        ("AccentYellow", front_oh, front_oh - 0.16, 0, 360),     # yellow nose tip
        ("AccentRed", 0.40, X(-0.90), 20, 40),                   # red pinstripe along the chassis
        ("AccentRed", 0.40, X(-0.90), 140, 160),
        ("AccentYellow", X(-2.10), X(-2.70), 45, 135),           # yellow engine-cover top behind the airbox
    ]
    g.add_multi(body_loft(mono, "Livery", steps=8, count=96, paints=paints))

    # Cockpit opening: dark tub, padded rim, seat back and headrest pads.
    ck0, ck1 = X(-1.12), X(-2.02)
    g.add_multi(body_loft([(ck0, 0, 0.21, 0.30, 0.640, 4.0), (ck0 - 0.15, 0, 0.25, 0.30, 0.635, 4.0),
                           (ck1, 0, 0.27, 0.30, 0.645, 4.0)], "Inlet", steps=2, count=36))
    rim = [(ck0 + (ck1 - ck0) * t, 0.215 + 0.06 * math.sin(math.pi * min(1.0, t * 1.4)) , 0.655) for t in [i / 16 for i in range(17)]]
    v, f = tube(rim, 0.016, 8)
    g.add_mirrored("CarbonMatte", v, f)
    v, f = box((ck1 - 0.02, -0.27, 0.58), (ck1 + 0.10, -0.15, 0.73))   # headrest side pads
    g.add("CarbonMatte", v, f)
    v, f = box((ck1 - 0.02, 0.15, 0.58), (ck1 + 0.10, 0.27, 0.73))
    g.add("CarbonMatte", v, f)
    v, f = plate_yz([(-0.20, 0.35), (0.20, 0.35), (0.19, 0.66), (-0.19, 0.66)], ck1 + 0.03, 0.02)  # seat back
    g.add("CarbonMatte", v, f)

    # Driver: helmet just behind the cockpit camera eye point (eye ~ x = -1.66 m, z = 0.79 m).
    hx, hz, hr = X(-1.66) - 0.17, 0.80, 0.135
    rings = []
    for k in range(1, 14):
        lat = -math.pi / 2 + math.pi * k / 14
        rings.append([(hx + hr * math.cos(lat) * math.cos(2 * math.pi * i / 28), hr * math.cos(lat) * math.sin(2 * math.pi * i / 28),
                       hz + hr * math.sin(lat)) for i in range(28)])
    v, f = loft_rings(rings)
    g.add("Helmet", v, f)
    g.add_multi(body_loft([(hx + hr * 0.95, 0, 0.09, 0.775, 0.84, 3.0), (hx + hr * 0.78, 0, 0.115, 0.76, 0.855, 3.0)],
                          "Visor", steps=1, count=24))

    # Halo (painted), rear legs, hoop just above the eye line, slim centre pillar with fairing.
    halo = []
    for k in range(21):
        t = k / 20
        x = X(-2.06) + (X(-1.18) - X(-2.06)) * t
        y = 0.305 * math.cos(t * math.pi / 2) ** 0.75
        z = 0.925 - 0.035 * t
        halo.append((x, y, z))
    legs = [(X(-2.14), 0.30, 0.70), (X(-2.10), 0.305, 0.85), halo[0]]
    v, f = tube(legs + halo[1:], 0.024, 12, flatten=0.8)
    g.add_mirrored("Halo", v, f)
    v, f = tube([(X(-1.18), 0.0, 0.890), (X(-1.07), 0.0, 0.790), (X(-0.97), 0.0, 0.655)], 0.028, 12, flatten=0.45)
    g.add("Halo", v, f)

    # Airbox above and behind the driver: rounded intake (dark) framed in yellow, roll hoop blade,
    # T-cam on a short stalk (just below the T-cam eye point, x ~ -2.51 m, z ~ 1.11 m).
    airbox = [(X(-2.07), 0, 0.125, 0.72, 0.985, 2.3), (X(-2.20), 0, 0.120, 0.72, 1.005, 2.3),
              (X(-2.50), 0, 0.090, 0.72, 0.900, 2.3), (X(-2.85), 0, 0.050, 0.66, 0.74, 2.3)]
    g.add_multi(body_loft(airbox, "AccentYellow", steps=4, count=28))
    g.add_multi(body_loft([(X(-2.065), 0, 0.085, 0.80, 0.955, 2.0), (X(-2.08), 0, 0.085, 0.80, 0.955, 2.0)], "Inlet",
                          steps=1, count=24))
    for sgn in (1, -1):  # side "ear" intakes of the airbox
        g.add_multi(body_loft([(X(-2.10), sgn * 0.13, 0.035, 0.80, 0.90, 2.2), (X(-2.30), sgn * 0.11, 0.030, 0.79, 0.88, 2.2)],
                              "Inlet", steps=1, count=16))
    v, f = tube([(X(-2.45), 0.0, 0.93), (X(-2.45), 0.0, 1.035)], 0.012, 8)
    g.add("CarbonMatte", v, f)
    v, f = box((X(-2.50), -0.10, 1.035), (X(-2.42), 0.10, 1.065))
    g.add("CarbonMatte", v, f)
    # Small shark fin (2025 cars run a short one).
    v, f = plate([(X(-2.70), 0.83), (X(-3.40), 0.62), (X(-3.40), 0.55), (X(-2.70), 0.75)], 0.0, 0.008)
    g.add("Livery", v, f)

    # Sidepods (left, mirrored): narrow high inlet, deep undercut, flat shoulder, downwash ramp.
    pod = [
        (X(-0.92), 0.55, 0.20, 0.36, 0.63, 3.4),
        (X(-1.15), 0.58, 0.22, 0.30, 0.64, 3.6),
        (X(-1.60), 0.57, 0.24, 0.20, 0.63, 3.6),
        (X(-2.15), 0.52, 0.24, 0.12, 0.55, 3.2),
        (X(-2.65), 0.43, 0.20, 0.10, 0.42, 3.0),
        (X(-3.05), 0.32, 0.13, 0.11, 0.31, 2.7),
        (X(-3.40), 0.21, 0.06, 0.14, 0.24, 2.4),
    ]
    pod_paint = [("AccentRed", X(-1.20), X(-2.40), 8, 22)]       # red flash along the sidepod shoulder
    g.add_multi(body_loft(pod, "Livery", steps=8, count=72, paints=pod_paint), mirrored=True)
    g.add_multi(body_loft([(X(-0.915), 0.55, 0.175, 0.44, 0.60, 3.2), (X(-0.94), 0.55, 0.175, 0.44, 0.60, 3.2)],
                          "Inlet", steps=1, count=24), mirrored=True)
    # Cooling louvres on the engine cover, behind the halo legs.
    for k in range(5):
        x = X(-2.30) - 0.09 * k
        _, _, hw, zb, zt, _ = section_at(mono, x)
        y = hw * 0.62
        zs = zb + (zt - zb) * 0.5 + (zt - zb) * 0.5 * (1 - (y / hw) ** 2.8) ** (1 / 2.8)
        v, f = box((x - 0.018, y - 0.07, zs - 0.004), (x + 0.018, y + 0.07, zs + 0.006))
        g.add_mirrored("Inlet", v, f)

    # Mirrors on twin stalks outboard of the cockpit.
    g.add_multi(body_loft([(X(-0.98), 0.58, 0.085, 0.665, 0.735, 3.2), (X(-1.10), 0.58, 0.085, 0.655, 0.745, 3.2)],
                          "Livery", steps=1, count=20), mirrored=True)
    v, f = plate_yz([(0.505, 0.67), (0.655, 0.67), (0.655, 0.73), (0.505, 0.73)], X(-1.105), 0.006)
    g.add_mirrored("Metal", v, f)
    for dy in (0.52, 0.64):
        v, f = tube([(X(-1.08), dy, 0.66), (X(-1.12), dy - 0.05, 0.61)], 0.008, 8)
        g.add_mirrored("CarbonMatte", v, f)

    # Floor: venturi tunnels under the car, central plank with skid blocks, edge wing on top.
    x_floor0, x_floor1 = X(-0.62), rear + 0.22

    def floor_profile(x):
        t = (x_floor0 - x) / (x_floor0 - x_floor1)           # 0 at the inlet, 1 at the diffuser throat
        half = min(W - 0.12, 0.22 + (W - 0.34) * min(1.0, (x_floor0 - x) / 0.55))
        if x < X(-2.90):                                    # narrows ahead of the rear tyres
            half = max(0.55, half - (X(-2.90) - x) * 1.1)
        depth = 0.13 * (1 - t) ** 2 + 0.035                 # tunnel roof height above the plank level
        ys = [-half + 2 * half * i / 30 for i in range(31)]

        def zb(y):
            a = abs(y)
            if a < 0.17:
                return 0.048                                 # keel above the plank
            u = min(1.0, (a - 0.17) / max(half - 0.20, 0.05))
            return 0.048 + depth * math.sin(math.pi * u) ** 0.8 + 0.01 * u

        def zt(y):
            a = abs(y)
            return max(zb(y) + 0.022, 0.07 + 0.08 * max(0.0, 1 - a / half) * (1 - t) * 0.5)
        return ys, zb, zt
    stations = [x_floor0 + (x_floor1 - x_floor0) * i / 24 for i in range(25)]
    v, f = section_poly_loft(stations, floor_profile)
    g.add("Carbon", v, f)
    v, f = box((X(-0.70), -0.15, 0.035), (X(-3.35), 0.15, 0.048))              # plank (bottom of the car)
    g.add("Plank", v, f)
    for xs in (X(-0.95), X(-1.9), X(-2.9)):
        v, f = box((xs - 0.08, -0.10, 0.0345), (xs + 0.08, 0.10, 0.036))     # titanium skids
        g.add("Skid", v, f)
    edge = [(X(-1.05), W - 0.08, 0.14), (X(-1.8), W - 0.07, 0.15), (X(-2.6), W - 0.08, 0.15), (X(-2.9), W - 0.14, 0.14)]
    v, f = tube(edge, 0.03, 10, flatten=0.3)
    g.add_mirrored("Carbon", v, f)
    for yf in (0.28, 0.40, 0.52, 0.64):                                         # inlet fences
        v, f = plate([(X(-0.55), 0.05), (X(-0.55), 0.24), (X(-1.30), 0.16), (X(-1.55), 0.06)], yf, 0.006)
        g.add_mirrored("Carbon", v, f)

    # Diffuser: arched roof from the throat to the tail, 4 strakes per side, side walls.
    d0, d1 = x_floor1, rear - 0.62
    ramp = []
    for k in range(10):
        t = k / 9
        x = d0 + (d1 - d0) * t
        zr = 0.07 + 0.34 * t ** 1.5
        ring = []
        for i in range(13):
            y = -0.52 + 1.04 * i / 12
            ring.append((x, y, zr + 0.05 * (1 - (y / 0.52) ** 2) * t))
        ring += [(x, y, z + 0.012) for (x, y, z) in reversed(ring)]
        ramp.append(ring)
    v, f = loft_rings(ramp)
    g.add("Carbon", v, f)
    for yf in (0.10, 0.23, 0.36, 0.48):
        v, f = plate([(d0, 0.07), (d1, 0.41), (d1, 0.10), (d0 + 0.2, 0.04)], yf, 0.006)
        g.add_mirrored("Carbon", v, f)
    v, f = plate([(d0 + 0.2, 0.06), (d1, 0.42), (d1, 0.50), (d0 + 0.2, 0.22)], 0.525, 0.010)
    g.add_mirrored("Carbon", v, f)

    # Rear: crash structure, rain light (LED matrix) and exhaust above it (the tail of the car).
    v, f = box((tail + 0.08, -0.07, 0.22), (rear - 0.40, 0.07, 0.36))
    g.add("Carbon", v, f)
    v, f = box((tail + 0.015, -0.055, 0.225), (tail + 0.08, 0.055, 0.355))
    g.add("CarbonMatte", v, f)
    for r_ in range(4):
        for c_ in range(3):
            yy, zz = -0.034 + 0.034 * c_, 0.245 + 0.030 * r_
            v, f = box((tail, yy - 0.012, zz - 0.010), (tail + 0.016, yy + 0.012, zz + 0.010))
            g.add("Light", v, f)
    ex = [(rear - 0.30, 0.0, 0.44), (tail + 0.10, 0.0, 0.43)]
    v, f = tube(ex, 0.055, 24)
    g.add("Exhaust", v, f)
    v, f = revolve([(0.055, 0.0), (0.045, -0.004), (0.045, 0.06)], 24, axis="x", centre=(tail + 0.10, 0.0, 0.43))
    g.add("Inlet", v, f)

    # Rear wing: spoon main plane + DRS flap, tips rolling down into curved endplates,
    # single swan-neck pillar with the DRS actuator pod, beam wing below.
    span = c["rw_span"]
    rw_le = rear - 0.16
    spoon = lambda y: -0.035 * (1 - (abs(y) / span) ** 2)  # noqa: E731  (deeper in the middle)
    tip = lambda y: -0.07 * max(0.0, (abs(y) - (span - 0.10)) / 0.10) ** 2  # noqa: E731
    v, f = wing(rw_le, 0.80, 0.34, -span, span, 10, stations=24, rise=lambda y: spoon(y) + tip(y), camber=0.10)
    g.add("Carbon", v, f)
    v, f = wing(rw_le - 0.31, 0.915, 0.21, -span + 0.01, span - 0.01, 30, stations=24,
                rise=lambda y: spoon(y) * 0.6 + tip(y), camber=0.06)
    g.add("Carbon", v, f)
    ep = [(rw_le + 0.05, 0.50), (rw_le + 0.07, 0.86), (rw_le + 0.01, 0.96), (rw_le - 0.12, 1.00), (rw_le - 0.46, 0.99),
          (rw_le - 0.52, 0.93), (rw_le - 0.52, 0.60), (rw_le - 0.34, 0.48)]
    v, f = plate(ep, span + 0.006, 0.012)
    g.add_mirrored("Livery", v, f)
    v, f = plate([(rw_le + 0.02, 0.90), (rw_le - 0.08, 0.99), (rw_le - 0.30, 0.99), (rw_le - 0.30, 0.93)], span + 0.013, 0.002)
    g.add_mirrored("AccentRed", v, f)                        # red flash on the endplate top
    v, f = tube([(rear - 0.10, 0.0, 0.45), (rear - 0.22, 0.0, 0.62), (rw_le - 0.10, 0.0, 0.78), (rw_le - 0.22, 0.0, 0.96)],
                0.022, 10, flatten=0.45)
    g.add("Carbon", v, f)
    v, f = tube([(rw_le - 0.14, 0.0, 0.975), (rw_le - 0.30, 0.0, 0.985)], 0.028, 12)   # DRS actuator pod
    g.add("Carbon", v, f)
    if c["beam_wing"]:
        v, f = wing(rear - 0.14, 0.40, 0.16, -span + 0.06, span - 0.06, 6, stations=12, camber=0.08)
        g.add("Carbon", v, f)
        v, f = wing(rear - 0.32, 0.465, 0.13, -span + 0.06, span - 0.06, 18, stations=12, camber=0.06)
        g.add("Carbon", v, f)

    # Front wing: four swept elements; the outer sections rise and sweep back into curved endplates;
    # the nose sits on element 2, the inboard (neutral) section stays low.
    fw_le = front_oh
    rise = lambda y: 0.09 * max(0.0, (abs(y) - 0.30) / (W - 0.30)) ** 1.6  # noqa: E731
    sweep = lambda y: 0.30 * max(0.0, (abs(y) - 0.18) / (W - 0.18)) ** 1.3  # noqa: E731
    elements = [(fw_le, 0.070, 0.30, 3, "Carbon"), (fw_le - 0.22, 0.110, 0.18, 12, "Carbon"),
                (fw_le - 0.35, 0.150, 0.15, 22, "Livery"), (fw_le - 0.46, 0.190, 0.13, 34, "Livery")]
    for i, (le, z, ch, aoa, mat) in enumerate(elements):
        v, f = wing(le, z, ch, -(W - 0.03), W - 0.03, aoa, stations=28,
                    rise=lambda y, k=i: rise(y) * (0.5 + 0.35 * k), sweep=sweep, camber=0.07,
                    aoa_fn=lambda y, k=i: 6.0 * k * max(0.0, (abs(y) - 0.3) / (W - 0.3)))
        g.add(mat, v, f)
    ep = [(fw_le - 0.30, 0.055), (fw_le - 0.30, 0.17), (fw_le - 0.42, 0.29), (fw_le - 0.66, 0.31), (fw_le - 0.74, 0.25),
          (fw_le - 0.74, 0.055)]
    v, f = plate(ep, W - 0.012, 0.012)
    g.add_mirrored("Livery", v, f)
    v, f = plate_xy([(fw_le - 0.30, W - 0.02), (fw_le - 0.74, W - 0.02), (fw_le - 0.74, W - 0.12), (fw_le - 0.42, W - 0.10)],
                    0.050, 0.058)                                    # footplate curling inward
    g.add_mirrored("Carbon", v, f)
    v, f = plate([(front_oh - 0.10, 0.19), (front_oh - 0.40, 0.20), (front_oh - 0.40, 0.11), (front_oh - 0.12, 0.10)], 0.055, 0.010)
    g.add_mirrored("Carbon", v, f)                                   # nose pylons

    # Suspension: wishbones and push/pull rods (aero-profiled), track rods, rear driveshafts.
    tr_f, tr_r, r = c["track_f"] / 2, c["track_r"] / 2, c["tyre_r"]
    wf, wr = c["tyre_w_f"], c["tyre_w_r"]
    for (ax, tr, w, inner_y, front) in ((0.0, tr_f, wf, 0.16, True), (rear, tr_r, wr, 0.20, False)):
        hub_y = tr - w / 2 - 0.06
        for dz, spread in ((0.13, 0.26), (-0.11, 0.30)):
            for sgn in (1, -1):
                v, f = tube([(ax + sgn * spread, inner_y, r + dz * 0.7 + 0.06), (ax, hub_y, r + dz)], 0.016, 10, flatten=0.35)
                g.add_mirrored("Carbon", v, f)
        rod = [(ax + (0.02 if front else -0.02), inner_y + 0.03, r + (0.28 if front else -0.06)), (ax, hub_y, r + (-0.09 if front else 0.10))]
        v, f = tube(rod, 0.012, 8)
        g.add_mirrored("Carbon", v, f)
        v, f = tube([(ax + (0.10 if front else -0.10), inner_y, r + 0.05), (ax + (0.09 if front else -0.09), hub_y, r + 0.05)],
                    0.010, 8)
        g.add_mirrored("Carbon", v, f)
        if not front:
            v, f = tube([(ax, 0.10, r), (ax, hub_y, r)], 0.025, 12)
            g.add_mirrored("Metal", v, f)
    return g


# ---------------------------------------------------------------------------
# Wheel (left side: outer face towards +y; centre at the origin, axle = y)
# ---------------------------------------------------------------------------
def build_wheel(c, width):
    g = Geo()
    R = c["tyre_r"]
    rim = 0.2286 + 0.008   # 18-inch rim + flange
    h = width / 2
    shoulder = 0.04
    prof = []
    for k in range(9):          # inner sidewall, bulging out from the bead
        a = math.pi / 2 * k / 8
        prof.append((rim + (R - shoulder - rim) * math.sin(a) ** 0.6, -h + 0.018 * (1 - math.sin(a)) - 0.004 * math.sin(2 * a)))
    for k in range(9):          # inner shoulder
        a = math.pi / 2 * k / 8
        prof.append((R - shoulder + shoulder * math.sin(a), -h + shoulder * (1 - math.cos(a)) + 0.01))
    for k in range(9):          # outer shoulder
        a = math.pi / 2 * k / 8
        prof.append((R - shoulder * (1 - math.cos(a)), h - shoulder - 0.01 + shoulder * math.sin(a)))
    for k in range(9):          # outer sidewall back to the bead
        a = math.pi / 2 * k / 8
        prof.append((R - shoulder - (R - shoulder - rim) * math.sin(a) ** 1.6, h - 0.018 * math.sin(a) + 0.004 * math.sin(2 * a)))
    v, f = revolve(prof, 72)
    g.add("Tyre", v, f)

    # Compound band and lettering blocks on the outer sidewall (they also show the rotation).
    ys = h + 0.0015
    v, f = revolve([(0.292, ys), (0.305, ys)], 72)
    g.add("TyreStripe", v, f)
    v, f = revolve([(0.268, ys - 0.001), (0.273, ys - 0.001)], 72)
    g.add("TyreStripe", v, f)
    for k in range(2):
        a0 = k * math.pi + 0.35
        v, f = annulus_sector(0.315, 0.338, ys - 0.004, a0, a0 + 1.1, steps=10)
        g.add("TyreStripe", v, f)
        v, f = annulus_sector(0.318, 0.335, ys - 0.004, a0 + 1.5, a0 + 2.3, steps=8)
        g.add("TyreText", v, f)

    # Rim barrel, solid outer cover (2022+), gold wheel nut, dark brake drum behind.
    v, f = revolve([(rim, -h + 0.02), (rim - 0.012, -h + 0.03), (rim - 0.012, h - 0.04), (rim, h - 0.02)], 64)
    g.add("Rim", v, f)
    v, f = revolve([(rim, h - 0.025), (0.20, h - 0.040), (0.10, h - 0.050), (0.06, h - 0.052)], 64)
    g.add("Rim", v, f)
    for k in range(6):
        a0 = k * 2 * math.pi / 6
        v, f = annulus_sector(0.115, 0.185, h - 0.046, a0, a0 + 0.45, steps=4)
        g.add("Inlet", v, f)
    v, f = revolve([(0.060, h - 0.055), (0.052, h - 0.025), (0.030, h - 0.012), (0.0, h - 0.010)], 24)
    g.add("RimGold", v, f)
    v, f = revolve([(0.0, -h + 0.02), (0.205, -h + 0.02), (0.205, h - 0.07), (0.0, h - 0.07)], 40)
    g.add("Brake", v, f)
    return g


# ---------------------------------------------------------------------------
# Steering wheel (own frame: x = column axis, display facing the driver = -x)
# ---------------------------------------------------------------------------
def build_steering_wheel():
    g = Geo()
    # Body outline (y, z) in metres: wide top, cut-outs for the grips.
    body = [(-0.105, 0.075), (-0.060, 0.090), (0.060, 0.090), (0.105, 0.075), (0.115, 0.030), (0.100, -0.030),
            (0.085, -0.075), (0.040, -0.085), (-0.040, -0.085), (-0.085, -0.075), (-0.100, -0.030), (-0.115, 0.030)]
    v, f = plate_yz(body, 0.0, 0.030)
    g.add("Carbon", v, f)
    for sgn in (1, -1):  # grips
        path = [(0.005, sgn * 0.118, 0.055), (0.0, sgn * 0.140, 0.010), (0.0, sgn * 0.138, -0.045), (0.005, sgn * 0.112, -0.080)]
        v, f = tube(path, 0.022, 14, radii=[0.018, 0.024, 0.024, 0.018])
        g.add("Rubber", v, f)
        v, f = plate_yz([(sgn * 0.07, 0.07), (sgn * 0.13, 0.03), (sgn * 0.12, -0.06), (sgn * 0.07, -0.02)], 0.030, 0.006)
        g.add("CarbonMatte", v, f)                            # shift paddles behind the wheel
    v, f = plate_yz([(-0.058, 0.004), (0.058, 0.004), (0.058, 0.058), (-0.058, 0.058)], -0.0165, 0.003)
    g.add("Screen", v, f)
    leds = ["LedGreen"] * 4 + ["LedRed"] * 4 + ["LedBlue"] * 4
    for i, m in enumerate(leds):
        y = -0.055 + 0.01 * i
        v, f = box((-0.020, y - 0.003, 0.066), (-0.015, y + 0.003, 0.072))
        g.add(m, v, f)
    buttons = [("BtnGreen", 0.085, 0.060), ("BtnRed", 0.085, 0.035), ("BtnYellow", 0.085, 0.010), ("BtnWhite", 0.083, -0.015),
               ("BtnOrange", 0.080, -0.040), ("BtnRed", -0.085, 0.060), ("BtnBlue", -0.085, 0.035), ("BtnYellow", -0.085, 0.010),
               ("BtnBlue", -0.083, -0.015), ("BtnWhite", -0.080, -0.040)]
    for m, y, z in buttons:
        v, f = revolve([(0.0095, -0.016), (0.0095, -0.022), (0.0, -0.022)], 16, axis="x", centre=(0.0, y, z))
        g.add(m, v, f)
    for y, m in ((-0.040, "BtnRed"), (0.0, "BtnYellow"), (0.040, "BtnBlue")):   # rotaries
        v, f = revolve([(0.014, -0.016), (0.014, -0.020)], 20, axis="x", centre=(0.0, y, -0.030))
        g.add(m, v, f)
        v, f = revolve([(0.010, -0.016), (0.010, -0.030), (0.0, -0.030)], 16, axis="x", centre=(0.0, y, -0.030))
        g.add("CarbonMatte", v, f)
    v, f = revolve([(0.030, 0.015), (0.030, 0.045), (0.020, 0.050)], 24, axis="x")   # quick release hub
    g.add("RimGold", v, f)
    return g


# ---------------------------------------------------------------------------
# Blender scene, materials, textures, export
# ---------------------------------------------------------------------------
def carbon_image():
    img = bpy.data.images.get("carbon_weave")
    if img:
        return img
    n = 128
    img = bpy.data.images.new("carbon_weave", n, n)
    px = [0.0] * (n * n * 4)
    tow = 16  # 2x2 twill, 8 tows per tile
    for yy in range(n):
        for xx in range(n):
            tx, ty = xx // tow, yy // tow
            u, v = (xx % tow) / tow, (yy % tow) / tow
            over = ((tx + ty) // 2) % 2 == 0
            ridge = math.sin(math.pi * (v if over else u))  # fibre bundle shading across the tow
            base = 0.030 + 0.030 * ridge ** 0.7 + (0.012 if over else 0.0)
            i = (yy * n + xx) * 4
            px[i:i + 4] = [base, base, base * 1.08, 1.0]
    img.pixels[:] = px
    img.pack()
    return img


def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, metal, rough, emit, tex = MATERIALS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        strength = max(emit)
        bsdf.inputs["Emission Color"].default_value = (emit[0] / strength, emit[1] / strength, emit[2] / strength, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    if tex == "carbon":
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = carbon_image()
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    m.diffuse_color = col
    return m


def to_objects(geo, name, collection, uv_scale=1.0 / 0.12):
    """One object per material; rotates sim axes -> Blender (car faces -Y); box-projected UVs."""
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
        uv = bm.loops.layers.uv.new("UVMap")
        for face in bm.faces:
            nx, ny, nz = (abs(c_) for c_ in face.normal)
            for loop in face.loops:
                co = loop.vert.co
                if nz >= nx and nz >= ny:
                    loop[uv].uv = (co.x * uv_scale, co.y * uv_scale)
                elif nx >= ny:
                    loop[uv].uv = (co.y * uv_scale, co.z * uv_scale)
                else:
                    loop[uv].uv = (co.x * uv_scale, co.z * uv_scale)
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
                              export_apply=True, export_materials="EXPORT", export_image_format="AUTO")


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
    ntri = sum(sum(len(f) - 2 for f in fs) for _, fs in body.parts.values())
    print(f"body triangles ~{ntri}")

    cols = {k: bpy.data.collections.new(k) for k in ("Body", "WheelFront", "WheelRear", "SteeringWheel")}
    for col in cols.values():
        scene.collection.children.link(col)
    body_objs = to_objects(body, "body", cols["Body"])
    wf_objs = to_objects(build_wheel(c, c["tyre_w_f"]), "wheel_front", cols["WheelFront"])
    wr_objs = to_objects(build_wheel(c, c["tyre_w_r"]), "wheel_rear", cols["WheelRear"])
    sw_objs = to_objects(build_steering_wheel(), "steering_wheel", cols["SteeringWheel"], uv_scale=1.0 / 0.04)

    name = c["name"]
    export(body_objs, os.path.join(out, f"{name}_body.glb"))
    export(wf_objs, os.path.join(out, f"{name}_wheel_front.glb"))
    export(wr_objs, os.path.join(out, f"{name}_wheel_rear.glb"))
    export(sw_objs, os.path.join(out, "steering_wheel.glb"))

    # Editable scene: wheels at their corners, steering wheel in the cockpit.
    for objs, ax, tr in ((wf_objs, 0.0, c["track_f"] / 2), (wr_objs, -c["wheelbase"], c["track_r"] / 2)):
        for sgn in (1, -1):
            for o in objs:
                inst = o.copy()
                cols["Body"].objects.link(inst)
                inst.location = (sgn * tr, -ax, c["tyre_r"])  # Blender: x = sim y, y = -sim x
                if sgn < 0:
                    inst.scale = (-1, 1, 1)
    for o in sw_objs:
        o.location = (0.0, 1.24 * c["wheelbase"] / 3.6, 0.65)
    blend_dir = os.path.abspath(a.blend_dir) if a.blend_dir else out
    os.makedirs(blend_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{name}.blend"), compress=True)
    print("exported", name, "to", out)


if __name__ == "__main__":
    if "--" in sys.argv:                                         # blender -b -P build_car.py -- ...
        main(sys.argv[sys.argv.index("--") + 1:])
    elif os.path.basename(sys.argv[0]).startswith("build_car"):  # python build_car.py ... (bpy module)
        main(sys.argv[1:])
    else:                                                        # Blender text editor: Run Script
        main(ARGS)
