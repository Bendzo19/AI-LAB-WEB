#include "f1sim/ffb.hpp"

#include <cmath>

namespace f1sim {

FfbOutput FfbProcessor::process(double carTorque, double wheelAngle, double wheelVelocity, double carLock, double dt,
                                const FfbSettings& s) {
    FfbOutput out;
    const double physical = filter_.update(carTorque, s.filterHz, dt);
    double device = physical * s.carTorqueScale * s.gain;
    device -= s.damping * wheelVelocity;
    // Soft lock: a stiff spring once the wheel passes the car's steering lock.
    const double beyond = std::fabs(wheelAngle) - carLock;
    if (beyond > 0.0) device -= sign(wheelAngle) * s.softLockStiffness * beyond + 0.05 * wheelVelocity;
    out.deviceTorque = device;

    const double maxT = std::max(s.deviceMaxTorque, 0.1);
    double cmd = device / maxT;
    out.clipping = std::fabs(cmd) > 1.0;
    cmd = clamp(cmd, -1.0, 1.0);
    if (s.minForce > 0.0 && std::fabs(cmd) > 1e-4) cmd = sign(cmd) * (s.minForce + (1.0 - s.minForce) * std::fabs(cmd));
    if (s.invert) cmd = -cmd;
    out.command = cmd;
    clipRatio_ = relaxTowards(clipRatio_, out.clipping ? 1.0 : 0.0, 0.5, dt);
    return out;
}

}  // namespace f1sim
