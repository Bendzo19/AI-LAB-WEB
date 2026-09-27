// Robot driver that follows the racing line of the QSS speed profile.
// Used for automated regression tests, benchmarks and the demo mode. It is
// deliberately simple (pure pursuit + speed controller); it is not meant to
// be a competitive opponent AI.
#pragma once

#include "f1sim/lapsim.hpp"
#include "f1sim/vehicle.hpp"

namespace f1sim {

class AIDriver {
public:
    AIDriver(const RacingLine* line, const CarParams& car, double pace = 0.92);
    DriverInputs update(const VehicleState& s, double dt);
    void setPace(double p) { pace_ = p; }
    size_t lineIndex() const { return index_ < 0 ? 0 : static_cast<size_t>(index_); }

private:
    const RacingLine* line_;
    CarParams car_;
    double pace_;
    long index_ = -1;
    double steer_ = 0.0;
    double shiftCooldown_ = 0.0;
    double brakeCeiling_ = 1.0;
};

}  // namespace f1sim
