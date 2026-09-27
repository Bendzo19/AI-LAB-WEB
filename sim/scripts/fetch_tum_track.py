#!/usr/bin/env python3
"""Download a track centre line + widths from the TUM racetrack-database.

Source: https://github.com/TUMFTM/racetrack-database (LGPL-3.0). The centre
lines come from OpenStreetMap and the widths from satellite imagery; there is
no elevation. Good for flat-ish tracks and lap-time sanity checks.

    python fetch_tum_track.py Monza                # -> ../data/tracks/Monza.csv
    python fetch_tum_track.py --list
"""
import argparse
import os
import sys
import urllib.request

TRACKS = ["Austin", "BrandsHatch", "Budapest", "Catalunya", "Hockenheim", "IMS", "Melbourne", "MexicoCity",
          "Montreal", "Monza", "MoscowRaceway", "Norisring", "Nuerburgring", "Oschersleben", "Sakhir", "SaoPaulo",
          "Sepang", "Shanghai", "Silverstone", "Sochi", "Spa", "Spielberg", "Suzuka", "YasMarina", "Zandvoort"]
BASE = "https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--out-dir", default=os.path.join(os.path.dirname(__file__), "..", "data", "tracks"))
    args = ap.parse_args()
    if args.list or not args.name:
        print("\n".join(TRACKS))
        return 0
    if args.name not in TRACKS:
        print(f"unknown track '{args.name}', use --list", file=sys.stderr)
        return 1
    data = urllib.request.urlopen(BASE + args.name + ".csv", timeout=30).read().decode("utf-8")
    os.makedirs(args.out_dir, exist_ok=True)
    out = os.path.join(args.out_dir, args.name + ".csv")
    with open(out, "w") as f:
        f.write("# TUM racetrack-database (LGPL-3.0): https://github.com/TUMFTM/racetrack-database\n")
        f.write(data)
    print(f"saved {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
