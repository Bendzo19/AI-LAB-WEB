// Reproducible validation manoeuvres run on the full vehicle model. Shared by
// the regression tests and `f1sim_bench`, so the numbers in the report are
// the same ones the tests assert on.
#pragma once

#include <string>
#include <vector>

#include "f1sim/car_params.hpp"

namespace f1sim {

struct SettleResult {
    double rideFrontMm = 0, rideRearMm = 0;
    double loadFrontN = 0, loadRearN = 0;  // per corner
    double residualSpeed = 0;              // [m/s] after settling
    double pitchDeg = 0, rollDeg = 0;
};
SettleResult runStaticSettle(const CarParams& car);

struct AccelResult {
    double t0to100 = -1, t0to200 = -1, t0to300 = -1;  // [s], -1 = not reached
    double topSpeedKph = 0;
    double distanceTo300 = -1;
    double maxYawDeg = 0;                             // heading drift, stability check
};
AccelResult runAcceleration(const CarParams& car, bool straightMode, double seconds = 45.0);

struct BrakeResult {
    double distance300to100 = -1, time300to100 = -1;
    double distance200to0 = -1;
    double peakDecelG = 0;
};
BrakeResult runBraking(const CarParams& car);

struct CorneringResult {
    double maxLatG = 0;          // highest sustained lateral acceleration
    double speedAtMaxKph = 0;
    double steeringTorqueAtMax = 0;
    double peakSteeringTorque = 0;       // max |torque| along the ramp
    double latGAtPeakTorque = 0;         // lateral g where the torque peaked
    bool spun = false;
    // (lateral g, steering torque) samples along the ramp, for plotting.
    std::vector<std::pair<double, double>> torqueCurve;
};
CorneringResult runSteadyStateCircle(const CarParams& car, double radius);

struct LapResult {
    std::vector<double> lapTimes;
    std::vector<bool> lapValid;
    double qssLapTime = 0;
    double maxSpeedKph = 0, minSpeedKph = 1e9;
    double maxLatG = 0, maxBrakeG = 0;
    double tyreSurfaceMax = 0, tyreCarcassEnd = 0, brakeTempMax = 0;
    double socEndMj = 0;
    bool completed = false;
    std::string failure;
};
// `telemetryCsv`: if not empty, the last completed lap is written there.
LapResult runAiLaps(const CarParams& car, const std::string& trackPath, int laps, double pace,
                    const std::string& telemetryCsv = "");

}  // namespace f1sim
