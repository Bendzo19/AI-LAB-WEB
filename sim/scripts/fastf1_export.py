#!/usr/bin/env python3
"""Export a real F1 lap (telemetry + position) from FastF1 to CSV.

The columns match the simulator's telemetry export so both can be compared
with compare_laps.py:

    Time, Distance, X, Y, Z, Speed, Throttle, Brake, nGear, RPM, DRS

Requirements (run on your own PC - the F1 live-timing API must be reachable):
    pip install fastf1

Examples:
    python fastf1_export.py --year 2025 --event Monza --session Q --out monza_pole.csv
    python fastf1_export.py --year 2026 --event Austria --session Q --driver NOR --out rbr_nor.csv

Notes on the data (so nobody over-interprets it):
  * Car data (speed, rpm, gear, throttle, brake) is sampled at ~4 Hz, position
    at ~4 Hz; FastF1 merges and interpolates them.
  * Brake is a boolean (on/off), not pedal pressure.
  * X/Y/Z come in 1/10 m from the timing feed and are converted to metres here.
"""
import argparse
import csv
import sys


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--event", required=True, help="event name or round number, e.g. Monza or 16")
    ap.add_argument("--session", default="Q", help="FP1, FP2, FP3, Q, SQ, S, R (default Q)")
    ap.add_argument("--driver", default=None, help="three-letter code; default = fastest lap overall")
    ap.add_argument("--out", required=True, help="output CSV path")
    ap.add_argument("--cache", default="fastf1_cache", help="FastF1 cache directory")
    args = ap.parse_args()

    try:
        import fastf1
    except ImportError:
        print("FastF1 is not installed: pip install fastf1", file=sys.stderr)
        return 1

    import os

    os.makedirs(args.cache, exist_ok=True)
    fastf1.Cache.enable_cache(args.cache)
    event = int(args.event) if args.event.isdigit() else args.event
    session = fastf1.get_session(args.year, event, args.session)
    session.load(laps=True, telemetry=True, weather=False, messages=False)
    try:
        session.laps  # raises if the timing data could not be downloaded
    except Exception:
        print("Could not load timing data. FastF1 needs internet access to livetiming.formula1.com "
              "(and the session must have taken place).", file=sys.stderr)
        return 2

    laps = session.laps.pick_drivers(args.driver) if args.driver else session.laps
    lap = laps.pick_fastest()
    if lap is None or (hasattr(lap, "empty") and lap.empty):
        print("no timed lap found for that selection", file=sys.stderr)
        return 1

    tel = lap.get_telemetry()
    if "Distance" not in tel.columns:
        tel = tel.add_distance()
    t0 = tel["Time"].iloc[0]
    rows = 0
    with open(args.out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Time", "Distance", "X", "Y", "Z", "Speed", "Throttle", "Brake", "nGear", "RPM", "DRS"])
        for _, r in tel.iterrows():
            w.writerow([
                f"{(r['Time'] - t0).total_seconds():.3f}",
                f"{r['Distance']:.2f}",
                f"{r['X'] / 10.0:.2f}", f"{r['Y'] / 10.0:.2f}", f"{r['Z'] / 10.0:.2f}",
                f"{r['Speed']:.1f}",
                f"{r['Throttle']:.1f}",
                "100" if bool(r["Brake"]) else "0",
                int(r["nGear"]), int(r["RPM"]), int(r["DRS"]),
            ])
            rows += 1
    print(f"{lap['Driver']} lap {lap['LapTime']} -> {args.out} ({rows} samples)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
