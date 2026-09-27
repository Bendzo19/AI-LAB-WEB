// Per-lap telemetry logger (100 Hz) with CSV export. Channel names follow
// what FastF1 exposes for real cars where possible (Speed, Throttle, Brake,
// nGear, RPM, X/Y/Z, Distance) so sim and real laps can be overlaid.
#pragma once

#include <string>
#include <vector>

#include "f1sim/vehicle.hpp"

namespace f1sim {

struct TelemetrySample {
    float time, distance, x, y, z;
    float speedKph, throttle, brake, steerDeg;
    float gear, rpm;
    float gLat, gLong, yawRateDeg;
    float slipAngleFront, slipAngleRear;  // [deg], average per axle
    float slipRatio[4];
    float tyreSurface[4], tyreCarcass[4], brakeTemp[4];
    float fz[4];
    float socMj, mgukKw, rideFrontMm, rideRearMm, aeroMode, steeringTorque, ffbCommand;
};

class TelemetryLogger {
public:
    void beginLap() { samples_.clear(); accumulator_ = 0.0; }
    // Call every physics step; records at `rateHz`.
    void record(const VehicleState& s, double lapTime, double distance, double ffbCommand, double dt,
                double rateHz = 100.0);
    bool saveCsv(const std::string& path, std::string* error) const;
    const std::vector<TelemetrySample>& samples() const { return samples_; }

private:
    std::vector<TelemetrySample> samples_;
    double accumulator_ = 0.0;
};

}  // namespace f1sim
