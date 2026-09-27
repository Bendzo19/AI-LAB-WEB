// Validation report: runs the standard manoeuvres on the full vehicle model
// and compares the results with public reference ranges for F1 cars.
//
//   f1sim_bench [car.ini] [track] [--laps N] [--pace 0.95] [--curve ffb.csv] [--telemetry lap.csv]
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "f1sim/car_params.hpp"
#include "f1sim/lapsim.hpp"
#include "f1sim/track.hpp"
#include "f1sim/scenarios.hpp"

using namespace f1sim;

namespace {

void row(const char* name, double value, const char* unit, double lo, double hi, const char* note) {
    const bool ok = value >= lo && value <= hi;
    std::printf("  %-34s %9.2f %-5s  ref %7.1f..%-7.1f %s  %s\n", name, value, unit, lo, hi, ok ? "OK  " : "OUT ", note);
}

}  // namespace

int main(int argc, char** argv) {
    std::string carPath = std::string(F1SIM_DATA_DIR) + "/cars/f1_2026_generic.ini";
    std::string trackPath = std::string(F1SIM_DATA_DIR) + "/tracks/test_circuit.trk";
    std::string curvePath, telemetryPath;
    int laps = 2;
    double pace = 0.95;
    int positional = 0;
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "--laps") && i + 1 < argc) laps = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--pace") && i + 1 < argc) pace = std::atof(argv[++i]);
        else if (!std::strcmp(argv[i], "--curve") && i + 1 < argc) curvePath = argv[++i];
        else if (!std::strcmp(argv[i], "--telemetry") && i + 1 < argc) telemetryPath = argv[++i];
        else if (positional == 0) { carPath = argv[i]; ++positional; }
        else { trackPath = argv[i]; ++positional; }
    }

    // Development builds use the source data folder; portable builds (copied
    // elsewhere) fall back to a data folder next to the executable.
    bool sourceData = false;
    if (FILE* f = std::fopen(carPath.c_str(), "rb")) {
        std::fclose(f);
        sourceData = true;
    }
    if (positional == 0 && !sourceData) {
        std::string exe = argv[0];
        const auto slash = exe.find_last_of("/\\");
        const std::string dir = slash == std::string::npos ? "." : exe.substr(0, slash);
        if (FILE* f = std::fopen((dir + "/data/cars/f1_2026_generic.ini").c_str(), "rb")) {
            std::fclose(f);
            carPath = dir + "/data/cars/f1_2026_generic.ini";
            trackPath = dir + "/data/tracks/test_circuit.trk";
        }
    }

    CarParams car;
    std::string err;
    std::vector<std::string> warnings;
    if (!CarParams::load(carPath, &car, &err, &warnings)) {
        std::fprintf(stderr, "error: %s\n", err.c_str());
        return 1;
    }
    for (const auto& w : warnings) std::fprintf(stderr, "warning: %s\n", w.c_str());
    const auto t0 = std::chrono::steady_clock::now();
    std::printf("f1sim benchmark - %s (%.0f kg incl. fuel)\n", car.name.c_str(), car.totalMass());
    std::printf("Reference ranges are public ballpark figures for current F1 cars, not team data.\n\n");

    const auto st = runStaticSettle(car);
    std::printf("Static\n");
    std::printf("  ride height front/rear            %6.1f / %.1f mm\n", st.rideFrontMm, st.rideRearMm);
    std::printf("  corner load front/rear            %6.0f / %.0f N\n", st.loadFrontN, st.loadRearN);
    std::printf("  residual speed                    %9.5f m/s\n\n", st.residualSpeed);

    std::printf("Straight line (corner mode / straight mode)\n");
    const auto az = runAcceleration(car, false);
    const auto ax = runAcceleration(car, true);
    row("0-100 km/h", az.t0to100, "s", 2.4, 3.5, "no TC: depends on launch technique");
    row("0-200 km/h", az.t0to200, "s", 4.0, 6.0, "");
    row("0-300 km/h", ax.t0to300, "s", 8.5, 14.0, "straight mode");
    row("top speed, corner mode", az.topSpeedKph, "km/h", 300, 345, "");
    row("top speed, straight mode", ax.topSpeedKph, "km/h", 325, 365, "");
    row("heading drift", az.maxYawDeg, "deg", 0.0, 1.0, "stability");
    std::printf("\n");

    std::printf("Braking (threshold, no ABS)\n");
    const auto br = runBraking(car);
    row("300->100 km/h distance", br.distance300to100, "m", 70, 130, "");
    row("300->100 km/h time", br.time300to100, "s", 1.4, 2.4, "");
    row("200->0 km/h distance", br.distance200to0, "m", 45, 80, "");
    row("peak deceleration", br.peakDecelG, "g", 4.0, 7.0, "aero assisted (2022-25 cars ~6 g)");
    std::printf("\n");

    std::printf("Steady-state cornering (speed ramp on a circle)\n");
    const auto c50 = runSteadyStateCircle(car, 50.0);
    const auto c150 = runSteadyStateCircle(car, 150.0);
    row("R50 max lateral", c50.maxLatG, "g", 1.8, 2.8, "low speed, mostly mechanical grip");
    row("R50 speed at max", c50.speedAtMaxKph, "km/h", 80, 125, "");
    row("R150 max lateral", c150.maxLatG, "g", 3.0, 5.0, "aero grip");
    row("R150 speed at max", c150.speedAtMaxKph, "km/h", 230, 310, "");
    row("R150 steering torque at limit", std::fabs(c150.steeringTorqueAtMax), "Nm", 3, 40, "after power assist");
    row("R150 torque peak / max lat g", c150.latGAtPeakTorque / std::max(c150.maxLatG, 1e-3), "", 0.6, 1.0,
        "FFB goes light before the limit");
    std::printf("  spun: R50 %s, R150 %s\n\n", c50.spun ? "yes" : "no", c150.spun ? "yes" : "no");
    if (!curvePath.empty()) {
        if (FILE* f = std::fopen(curvePath.c_str(), "wb")) {
            std::fprintf(f, "radius,lat_g,steering_torque_nm\n");
            for (const auto& [g, t] : c50.torqueCurve) std::fprintf(f, "50,%.4f,%.4f\n", g, t);
            for (const auto& [g, t] : c150.torqueCurve) std::fprintf(f, "150,%.4f,%.4f\n", g, t);
            std::fclose(f);
        }
    }

    std::printf("Robot driver on %s (pace %.2f of the QSS profile)\n", trackPath.c_str(), pace);
    const auto lap = runAiLaps(car, trackPath, laps, pace, telemetryPath);
    {
        // Theoretical lap (full track width, full grip) for comparison with real lap times.
        Track t;
        std::string terr;
        if (Track::load(trackPath, &t, &terr)) {
            RacingLine line = computeRacingLine(t);
            computeSpeedProfile(line, car);
            std::printf("  QSS theoretical lap (ideal line)  %9.3f s   (%.0f m)\n", line.lapTime, t.length());
        }
    }
    std::printf("  QSS robot target lap              %9.3f s\n", lap.qssLapTime);
    for (size_t i = 0; i < lap.lapTimes.size(); ++i) {
        std::printf("  lap %zu                             %9.3f s %s\n", i + 1, lap.lapTimes[i],
                    lap.lapValid[i] ? "" : "(invalid: track limits)");
    }
    if (!lap.completed) std::printf("  FAILED: %s\n", lap.failure.c_str());
    std::printf("  speed min/max                     %6.1f / %.1f km/h\n", lap.minSpeedKph, lap.maxSpeedKph);
    std::printf("  max lateral / braking             %6.2f / %.2f g\n", lap.maxLatG, lap.maxBrakeG);
    std::printf("  tyre surface peak, carcass end    %6.1f / %.1f C\n", lap.tyreSurfaceMax, lap.tyreCarcassEnd);
    std::printf("  brake disc peak                   %6.0f C\n", lap.brakeTempMax);
    std::printf("  battery at end                    %6.2f MJ\n", lap.socEndMj);

    const double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
    std::printf("\n(benchmark ran in %.1f s wall time)\n", secs);
    return lap.completed ? 0 : 2;
}
