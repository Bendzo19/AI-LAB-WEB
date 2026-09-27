// A time-trial session: one car on one track with lap timing, telemetry and
// the racing line. This is the unit the app (and any future engine
// integration, e.g. Unreal/Godot) drives at a fixed 1 kHz.
#pragma once

#include <memory>
#include <string>

#include "f1sim/lapsim.hpp"
#include "f1sim/telemetry.hpp"
#include "f1sim/timing.hpp"
#include "f1sim/vehicle.hpp"

namespace f1sim {

class Session {
public:
    static constexpr double kDt = 0.001;

    Session(const CarParams& car, Track track);

    // Stationary on the main straight, before the line (out lap).
    void resetToStart();
    // Rolling start at `speed` a given distance before the line, `offset`
    // metres left of the centre line.
    void resetRolling(double speed, double distanceBeforeLine, double offset = 0.0);
    // Puts the car back on the centre line near its current position.
    void recoverToTrack();

    // Advances one physics step. Returns the timing event of this step.
    LapTimer::Event step(const DriverInputs& in, double ffbCommand = 0.0);

    Vehicle& vehicle() { return *vehicle_; }
    const Vehicle& vehicle() const { return *vehicle_; }
    const Track& track() const { return track_; }
    const LapTimer& timer() const { return timer_; }
    const RacingLine& racingLine() const { return line_; }
    const TelemetryLogger& lastLapTelemetry() const { return lastLap_; }
    double time() const { return time_; }
    double carS() const { return carS_; }

private:
    CarParams car_;
    Track track_;
    std::unique_ptr<Vehicle> vehicle_;
    LapTimer timer_;
    RacingLine line_;
    TelemetryLogger logger_, lastLap_;
    double time_ = 0.0;
    double carS_ = 0.0;
    int carHint_ = -1;
};

}  // namespace f1sim
