// Force feedback post-processing: turns the physical steering torque of the
// car (Nm at the steering wheel, from the rack/kingpin model) into a
// normalized device command. Device I/O lives in the app layer.
//
// Philosophy: the signal is physics-first (tyre aligning moment, trail,
// scrub, weight jacking, road texture through Fz). The only additions are
// what a real steering column provides and a consumer wheel cannot:
// soft lock at the car's steering lock, and optional damping for stability.
#pragma once

#include "f1sim/math.hpp"

namespace f1sim {

struct FfbSettings {
    double gain = 1.0;             // overall multiplier
    double deviceMaxTorque = 8.0;  // wheel base peak torque [Nm]
    double carTorqueScale = 0.5;   // device Nm per car Nm before gain (1.0 = true scale)
    double filterHz = 120.0;       // low-pass on the physics signal (0 = off)
    double damping = 0.02;         // [Nm per rad/s] of steering wheel velocity (device Nm)
    double minForce = 0.0;         // 0..0.2, compensates dead zone of geared/belt wheels
    double softLockStiffness = 8.0;// device Nm per rad beyond the car's lock
    bool invert = false;
};

struct FfbOutput {
    double command = 0.0;          // -1..1 device command (+ = pushes wheel left)
    double deviceTorque = 0.0;     // requested device torque before clipping [Nm]
    bool clipping = false;
};

class FfbProcessor {
public:
    FfbOutput process(double carTorque, double wheelAngle, double wheelVelocity, double carLock, double dt,
                      const FfbSettings& s);
    // Fraction of recent samples that were clipped (exponential window ~2 s).
    double clippingRatio() const { return clipRatio_; }
    void reset() { filter_ = {}; clipRatio_ = 0.0; }

private:
    LowPass filter_;
    double clipRatio_ = 0.0;
};

}  // namespace f1sim
