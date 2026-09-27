#include "f1sim/ai_driver.hpp"

#include <cmath>

namespace f1sim {

AIDriver::AIDriver(const RacingLine* line, const CarParams& car, double pace)
    : line_(line), car_(car), pace_(pace) {}

DriverInputs AIDriver::update(const VehicleState& s, double dt) {
    DriverInputs in;
    const auto& L = *line_;
    const long n = static_cast<long>(L.size());
    if (n == 0) return in;
    index_ = static_cast<long>(L.nearest(s.pos, index_));
    const double v = s.speed();

    // ---- Lateral: Stanley-style controller on the racing line ----
    // Feed-forward from the line curvature slightly ahead (actuation delay),
    // plus heading and cross-track corrections, plus yaw-rate damping.
    const long ahead = static_cast<long>(std::max(1.0, v * 0.12 / 2.0));
    const long ia = (index_ + ahead) % n;
    const long i0 = index_, i1 = (index_ + 1) % n;
    const Vec3 dir = normalize(L.points[i1] - L.points[i0]);
    const Vec3 rel = s.pos - L.points[i0];
    const double crossTrack = dir.x * rel.y - dir.y * rel.x;  // + = car left of the line
    const double lineHeading = std::atan2(dir.y, dir.x);
    const double velHeading = v > 1.0 ? std::atan2(s.vel.y, s.vel.x) : s.rot.yaw();
    const double headingErr = wrapAngle(lineHeading - velHeading);
    const double kappaFF = L.curvature[ia];
    const double wb = car_.chassis.wheelbase;
    double road = std::atan(wb * kappaFF) + 0.9 * headingErr - std::atan(0.9 * crossTrack / (v + 4.0));
    road -= 0.03 * (s.angVel.z - v * kappaFF);
    // Never ask for more steering than the front tyres can use at this speed.
    const double downforceG = 0.5 * car_.aero.airDensity * car_.aero.claCorner * v * v / (car_.totalMass() * kGravity);
    const double latMax = 1.0 * car_.front.tyre.muY * (1.0 + downforceG) * kGravity;
    const double maxRoad = std::atan(wb * latMax / std::max(v * v, 1.0)) + 0.6 * car_.front.tyre.peakSlipAngle;
    road = clamp(road, -maxRoad, maxRoad);
    const double wanted = clamp(road * car_.steering.ratio, -car_.steering.lock, car_.steering.lock);
    const double maxRate = 8.0;  // steering wheel [rad/s]
    steer_ += clamp(wanted - steer_, -maxRate * dt, maxRate * dt);
    in.steeringWheelAngle = steer_;

    // ---- Longitudinal: follow the QSS profile with a preview ----
    const long preview = static_cast<long>(std::max(1.0, v * 0.25 / 2.0));
    double vt = 1e9;
    for (long k = 0; k <= preview; ++k) vt = std::min(vt, L.speed[(index_ + k) % n]);
    vt *= pace_;
    const double err = vt - v;
    double throttle = 0.0, brake = 0.0;
    if (err > -0.3) {
        throttle = clamp(0.35 + 0.2 * err, 0.0, 1.0);
    } else {
        brake = clamp(-0.18 * err, 0.0, 1.0);
    }
    // Driver-level traction/lock-up management (the car has no aids).
    const double rearSlip = std::max(s.wheels[RL].slipRatio, s.wheels[RR].slipRatio);
    if (rearSlip > 0.08) throttle *= clamp(1.0 - (rearSlip - 0.08) * 8.0, 0.2, 1.0);
    // Threshold braking: the pedal ceiling drops quickly while any tyre
    // locks and recovers otherwise, like a driver modulating at the limit.
    double lock = 0.0;
    // A lifted or barely loaded wheel (inside front in a hairpin) stops and
    // spins freely; it carries no braking force, so it does not count.
    for (const auto& w : s.wheels) {
        if (w.fz > 800.0) lock = std::min(lock, w.slipRatio);
    }
    if (lock < -0.12) brakeCeiling_ = std::min(brakeCeiling_, brake) - 4.0 * dt;
    else brakeCeiling_ += 3.0 * dt;
    brakeCeiling_ = clamp(brakeCeiling_, 0.2, 1.0);
    brake = std::min(brake, brakeCeiling_);
    in.throttle = throttle;
    in.brake = brake;

    // ---- Gears ----
    shiftCooldown_ = std::max(0.0, shiftCooldown_ - dt);
    const auto& pp = car_.powertrain;
    const int gear = s.pt.gear;
    if (shiftCooldown_ <= 0.0 && gear >= 1) {
        const double rpm = s.rpm();
        if (rpm > pp.revLimit - 200.0 && gear < car_.gearCount()) {
            in.shiftUp = true;
            shiftCooldown_ = 0.15;
        } else if (gear > 1) {
            const double wheelOmega = 0.5 * (s.wheels[RL].omega + s.wheels[RR].omega);
            const double lower = pp.gearRatios[gear - 2] * pp.finalDrive;
            const double rpmLower = wheelOmega * lower * 60.0 / (2.0 * kPi);
            if (rpmLower < pp.revLimit - 1300.0 && (brake > 0.0 || rpm < pp.revLimit * 0.62)) {
                in.shiftDown = true;
                shiftCooldown_ = 0.12;
            }
        }
    }
    if (gear == 0) in.shiftUp = true;

    // ---- Active aero: straight mode when the next ~200 m are straight ----
    bool straight = throttle > 0.95 && v > 40.0;
    for (long k = 0; k < 100 && straight; ++k) {
        if (std::fabs(L.curvature[(index_ + k) % n]) > 1.0 / 700.0) straight = false;
    }
    in.aeroToggle = straight != s.aeroStraightRequested;
    return in;
}

}  // namespace f1sim
