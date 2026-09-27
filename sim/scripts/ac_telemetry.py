#!/usr/bin/env python3
"""Record Assetto Corsa telemetry to CSV laps in the f1sim telemetry format.

Assetto Corsa does not save telemetry files; it publishes live data through
Windows shared memory ("acpmf_physics", "acpmf_graphics", "acpmf_static").
This logger reads it while you drive (about 300 samples per second) and
writes one CSV per completed lap, with the same column names the simulator
uses, so both can be compared with compare_laps.py:

    python ac_telemetry.py                      # start before or during an AC session
    python compare_laps.py ac_laps/<lap>.csv ../telemetry/<lap>.csv --labels AC SIM --out rbr.png

Requirements: Windows, Python 3.8+, Assetto Corsa running (any car/track).
Nothing is installed or changed in AC. Stop with Ctrl+C.

Sign conventions follow f1sim: GLat + = to the left, GLong + = accelerating
(check the GLat sign on your first lap: a left corner must give positive values),
SteerDeg is AC's steering input converted with the car's steering lock
(--steer-lock-deg, default 360 = +-180 deg, typical for F1 cars in AC).
Columns AC does not publish (e.g. MGU-K power, tyre carcass/surface split)
are left empty.

    python ac_telemetry.py --selftest          # checks the memory layout and lap splitting (any OS)
"""
import argparse
import csv
import ctypes
import math
import os
import sys
import time

# ---------------------------------------------------------------------------
# Shared memory layout (Assetto Corsa SDK, #pragma pack(4); wchar_t = 2 bytes)
# Only the stable fields up to localVelocity (AC 1.14+) are read.
# ---------------------------------------------------------------------------
F4 = ctypes.c_float * 4
F3 = ctypes.c_float * 3


def wstr(n):
    return ctypes.c_uint16 * n  # portable 16-bit wchar_t


class Physics(ctypes.Structure):
    _pack_ = 4
    _fields_ = [
        ("packetId", ctypes.c_int32), ("gas", ctypes.c_float), ("brake", ctypes.c_float), ("fuel", ctypes.c_float),
        ("gear", ctypes.c_int32), ("rpms", ctypes.c_int32), ("steerAngle", ctypes.c_float), ("speedKmh", ctypes.c_float),
        ("velocity", F3), ("accG", F3),
        ("wheelSlip", F4), ("wheelLoad", F4), ("wheelsPressure", F4), ("wheelAngularSpeed", F4),
        ("tyreWear", F4), ("tyreDirtyLevel", F4), ("tyreCoreTemperature", F4), ("camberRAD", F4),
        ("suspensionTravel", F4), ("drs", ctypes.c_float), ("tc", ctypes.c_float), ("heading", ctypes.c_float),
        ("pitch", ctypes.c_float), ("roll", ctypes.c_float), ("cgHeight", ctypes.c_float),
        ("carDamage", ctypes.c_float * 5), ("numberOfTyresOut", ctypes.c_int32), ("pitLimiterOn", ctypes.c_int32),
        ("abs", ctypes.c_float), ("kersCharge", ctypes.c_float), ("kersInput", ctypes.c_float),
        ("autoShifterOn", ctypes.c_int32), ("rideHeight", ctypes.c_float * 2), ("turboBoost", ctypes.c_float),
        ("ballast", ctypes.c_float), ("airDensity", ctypes.c_float), ("airTemp", ctypes.c_float),
        ("roadTemp", ctypes.c_float), ("localAngularVel", F3), ("finalFF", ctypes.c_float),
        ("performanceMeter", ctypes.c_float), ("engineBrake", ctypes.c_int32), ("ersRecoveryLevel", ctypes.c_int32),
        ("ersPowerLevel", ctypes.c_int32), ("ersHeatCharging", ctypes.c_int32), ("ersIsCharging", ctypes.c_int32),
        ("kersCurrentKJ", ctypes.c_float), ("drsAvailable", ctypes.c_int32), ("drsEnabled", ctypes.c_int32),
        ("brakeTemp", F4), ("clutch", ctypes.c_float), ("tyreTempI", F4), ("tyreTempM", F4), ("tyreTempO", F4),
        ("isAIControlled", ctypes.c_int32), ("tyreContactPoint", F3 * 4), ("tyreContactNormal", F3 * 4),
        ("tyreContactHeading", F3 * 4), ("brakeBias", ctypes.c_float), ("localVelocity", F3),
    ]


class Graphics(ctypes.Structure):
    _pack_ = 4
    _fields_ = [
        ("packetId", ctypes.c_int32), ("status", ctypes.c_int32), ("session", ctypes.c_int32),
        ("currentTime", wstr(15)), ("lastTime", wstr(15)), ("bestTime", wstr(15)), ("split", wstr(15)),
        ("completedLaps", ctypes.c_int32), ("position", ctypes.c_int32), ("iCurrentTime", ctypes.c_int32),
        ("iLastTime", ctypes.c_int32), ("iBestTime", ctypes.c_int32), ("sessionTimeLeft", ctypes.c_float),
        ("distanceTraveled", ctypes.c_float), ("isInPit", ctypes.c_int32), ("currentSectorIndex", ctypes.c_int32),
        ("lastSectorTime", ctypes.c_int32), ("numberOfLaps", ctypes.c_int32), ("tyreCompound", wstr(33)),
        ("replayTimeMultiplier", ctypes.c_float), ("normalizedCarPosition", ctypes.c_float),
        ("carCoordinates", F3),
    ]


class Static(ctypes.Structure):
    _pack_ = 4
    _fields_ = [
        ("smVersion", wstr(15)), ("acVersion", wstr(15)), ("numberOfSessions", ctypes.c_int32),
        ("numCars", ctypes.c_int32), ("carModel", wstr(33)), ("track", wstr(33)),
    ]


AC_LIVE = 2  # graphics.status: 0 off, 1 replay, 2 live, 3 pause


def text(arr):
    chars = []
    for c in arr:
        if c == 0:
            break
        chars.append(chr(c))
    return "".join(chars)


# ---------------------------------------------------------------------------
# Lap recording (independent of where the frames come from, so it is testable)
# ---------------------------------------------------------------------------
COLUMNS = ["Time", "Distance", "X", "Y", "Z", "Speed", "Throttle", "Brake", "SteerDeg", "nGear", "RPM", "GLat", "GLong",
           "YawRateDeg", "SlipAngleFrontDeg", "SlipAngleRearDeg", "SlipRatioFL", "SlipRatioFR", "SlipRatioRL",
           "SlipRatioRR", "TyreSurfFL", "TyreSurfFR", "TyreSurfRL", "TyreSurfRR", "TyreCarcFL", "TyreCarcFR",
           "TyreCarcRL", "TyreCarcRR", "BrakeFL", "BrakeFR", "BrakeRL", "BrakeRR", "FzFL", "FzFR", "FzRL", "FzRR",
           "SocMJ", "MgukKW", "RideFrontMm", "RideRearMm", "AeroMode", "SteeringTorqueNm", "FfbCommand",
           # AC-only extras
           "WheelSlipFL", "WheelSlipFR", "WheelSlipRL", "WheelSlipRR", "BrakeBias", "Drs", "LapPos"]


def sample_row(ph, gr, lap_time, distance, steer_lock_deg):
    """One CSV row from a physics + graphics snapshot (f1sim conventions)."""
    gear = ph.gear - 1  # AC: 0 = R, 1 = N, 2 = 1st
    row = {
        "Time": f"{lap_time:.3f}", "Distance": f"{distance:.2f}",
        # AC world: x, y up, z -> f1sim: x, y (ground plane), z up
        "X": f"{gr.carCoordinates[0]:.2f}", "Y": f"{gr.carCoordinates[2]:.2f}", "Z": f"{gr.carCoordinates[1]:.2f}",
        "Speed": f"{ph.speedKmh:.2f}", "Throttle": f"{ph.gas * 100:.1f}", "Brake": f"{ph.brake * 100:.1f}",
        "SteerDeg": f"{ph.steerAngle * steer_lock_deg / 2:.2f}", "nGear": str(gear), "RPM": str(ph.rpms),
        # accG: x lateral (+ right in AC), y vertical, z longitudinal (+ accelerating)
        "GLat": f"{-ph.accG[0]:.3f}", "GLong": f"{ph.accG[2]:.3f}",
        "YawRateDeg": f"{math.degrees(ph.localAngularVel[1]):.2f}",
        "SocMJ": f"{ph.kersCharge:.3f}",  # AC reports 0..1 of the battery, not MJ
        "RideFrontMm": f"{ph.rideHeight[0] * 1000:.1f}", "RideRearMm": f"{ph.rideHeight[1] * 1000:.1f}",
        "AeroMode": f"{ph.drs:.2f}", "FfbCommand": f"{ph.finalFF:.3f}",
        "BrakeBias": f"{ph.brakeBias:.3f}", "Drs": f"{ph.drs:.0f}", "LapPos": f"{gr.normalizedCarPosition:.5f}",
    }
    for i, w in enumerate(("FL", "FR", "RL", "RR")):
        row[f"TyreSurf{w}"] = f"{ph.tyreTempM[i]:.1f}"
        row[f"TyreCarc{w}"] = f"{ph.tyreCoreTemperature[i]:.1f}"
        row[f"Brake{w}"] = f"{ph.brakeTemp[i]:.0f}"
        row[f"Fz{w}"] = f"{ph.wheelLoad[i]:.0f}"
        row[f"WheelSlip{w}"] = f"{ph.wheelSlip[i]:.4f}"
    return row


class LapRecorder:
    def __init__(self, out_dir, tag, steer_lock_deg=360.0):
        self.out_dir, self.tag, self.lock = out_dir, tag, steer_lock_deg
        self.rows, self.laps_seen, self.distance, self.last_t, self.lap_start = [], None, 0.0, None, None
        self.saved = []

    def feed(self, ph, gr, now):
        if gr.status != AC_LIVE:
            self.last_t = None  # paused/replay: do not integrate distance across the gap
            return
        if self.laps_seen is None:
            self.laps_seen = gr.completedLaps
        if gr.completedLaps != self.laps_seen:
            self._finish(gr)
            self.laps_seen = gr.completedLaps
        if self.lap_start is None:
            self.lap_start = now
        if self.last_t is not None:
            self.distance += ph.speedKmh / 3.6 * (now - self.last_t)
        self.last_t = now
        self.rows.append(sample_row(ph, gr, now - self.lap_start, self.distance, self.lock))

    def _finish(self, gr):
        # The first (out) lap starts mid-track: keep only laps recorded from the line.
        start_pos = float(self.rows[0]["LapPos"]) if self.rows else 0.5
        complete = start_pos < 0.02 or start_pos > 0.98
        if self.rows and complete and gr.iLastTime > 0:
            lap_s = gr.iLastTime / 1000.0
            name = f"ac_{self.tag}_lap{gr.completedLaps:02d}_{lap_s:.3f}.csv"
            path = os.path.join(self.out_dir, name)
            with open(path, "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=COLUMNS, restval="")
                w.writeheader()
                w.writerows(self.rows)
            self.saved.append(path)
            print(f"lap {gr.completedLaps}: {lap_s:.3f} s  ({len(self.rows)} samples) -> {path}")
        elif self.rows:
            print(f"lap {gr.completedLaps}: out lap / partial lap not saved")
        self.rows, self.distance, self.lap_start = [], 0.0, None


# ---------------------------------------------------------------------------
# Windows shared memory
# ---------------------------------------------------------------------------
def open_page(name, struct):
    import mmap
    return mmap.mmap(-1, ctypes.sizeof(struct), name, access=mmap.ACCESS_READ)


def read(page, struct):
    page.seek(0)
    return struct.from_buffer_copy(page.read(ctypes.sizeof(struct)))


def run(args):
    if os.name != "nt":
        print("The Assetto Corsa shared memory exists only on Windows (use --selftest here).", file=sys.stderr)
        return 1
    try:
        ctypes.windll.winmm.timeBeginPeriod(1)  # 1 ms sleep resolution
    except OSError:
        pass
    os.makedirs(args.out, exist_ok=True)
    print("Waiting for Assetto Corsa... (start a session; Ctrl+C to stop)")
    while True:
        try:
            p_page, g_page, s_page = (open_page("Local\\acpmf_physics", Physics), open_page("Local\\acpmf_graphics", Graphics),
                                      open_page("Local\\acpmf_static", Static))
            st = read(s_page, Static)
            if text(st.carModel):
                break
        except OSError:
            pass
        time.sleep(1.0)
    car, track = text(st.carModel), text(st.track)
    print(f"Connected: AC {text(st.acVersion)}, car {car}, track {track}. Drive full laps; each is saved when it ends.")
    rec = LapRecorder(args.out, f"{car}_{track}", args.steer_lock_deg)
    last_packet = -1
    try:
        while True:
            ph = read(p_page, Physics)
            if ph.packetId != last_packet:
                last_packet = ph.packetId
                rec.feed(ph, read(g_page, Graphics), time.perf_counter())
            time.sleep(0.002)
    except KeyboardInterrupt:
        print(f"\nStopped. {len(rec.saved)} lap(s) saved in {os.path.abspath(args.out)}")
    return 0


# ---------------------------------------------------------------------------
# Self test: layout offsets (from the AC SDK header) and lap splitting
# ---------------------------------------------------------------------------
def selftest():
    import tempfile
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        ok &= bool(cond)

    check(Physics.speedKmh.offset == 28, "physics.speedKmh at byte 28")
    check(Physics.accG.offset == 44, "physics.accG at byte 44")
    check(Physics.wheelLoad.offset == 72, "physics.wheelLoad at byte 72")
    check(Physics.tyreCoreTemperature.offset == 152, "physics.tyreCoreTemperature at byte 152")
    check(Physics.brakeTemp.offset == 348, "physics.brakeTemp at byte 348")
    check(Graphics.completedLaps.offset == 132, "graphics.completedLaps at byte 132")
    check(Graphics.carCoordinates.offset == 252, "graphics.carCoordinates at byte 252")
    check(Static.carModel.offset == 68, "static.carModel at byte 68")

    out = tempfile.mkdtemp()
    rec = LapRecorder(out, "test")
    ph, gr = Physics(), Graphics()
    gr.status, gr.completedLaps = AC_LIVE, 0
    ph.speedKmh, ph.gas, ph.gear = 180.0, 1.0, 5
    t = 0.0
    # Out lap from mid-track, then one full lap of 60 s starting at the line.
    for k in range(3000):
        gr.normalizedCarPosition = 0.5 + k / 6000.0
        rec.feed(ph, gr, t)
        t += 0.01
    gr.completedLaps, gr.iLastTime = 1, 30000
    for k in range(6000):
        gr.normalizedCarPosition = k / 6000.0
        rec.feed(ph, gr, t)
        t += 0.01
    gr.completedLaps, gr.iLastTime = 2, 60000
    rec.feed(ph, gr, t)
    check(len(rec.saved) == 1, "out lap skipped, full lap saved")
    if rec.saved:
        with open(rec.saved[0], newline="") as f:
            rows = list(csv.DictReader(f))
        check(abs(float(rows[-1]["Time"]) - 59.99) < 0.02, "lap time column runs 0..60 s")
        check(abs(float(rows[-1]["Distance"]) - 3000.0) < 1.0, "distance integrates speed (180 km/h x 60 s = 3000 m)")
        check(rows[0]["nGear"] == "4", "AC gear index converted (AC 5 = 4th gear)")
    print("selftest", "passed" if ok else "FAILED")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="ac_laps", help="output folder (default: ac_laps)")
    ap.add_argument("--steer-lock-deg", type=float, default=360.0,
                    help="car steering wheel lock-to-lock in degrees (AC car setting), for SteerDeg")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    return selftest() if args.selftest else run(args)


if __name__ == "__main__":
    sys.exit(main())
