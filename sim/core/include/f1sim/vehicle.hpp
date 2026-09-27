// Vehicle dynamics model (14 DOF + driveline):
//   chassis 6 DOF rigid body, 4 unsprung vertical DOF, 4 wheel spin DOF,
//   engine speed DOF, differential with clutch-pack locking, brake-by-wire
//   with MGU-K harvesting, active aero modes, two-node tyre thermals.
//
// The model is engine-agnostic: no rendering, input devices or threads. Step
// it with a fixed dt (1 ms recommended) and read `state()`.
#pragma once

#include <array>

#include "f1sim/car_params.hpp"
#include "f1sim/math.hpp"
#include "f1sim/track.hpp"
#include "f1sim/tyre.hpp"

namespace f1sim {

enum Corner { FL = 0, FR = 1, RL = 2, RR = 3 };

struct DriverInputs {
    double steeringWheelAngle = 0.0;  // [rad], + = left (counter-clockwise)
    double throttle = 0.0;            // 0..1
    double brake = 0.0;               // 0..1 (pedal travel/force, already shaped)
    double clutch = 0.0;              // 0..1, 1 = fully disengaged
    bool shiftUp = false;             // edge: set for exactly one step
    bool shiftDown = false;
    bool aeroToggle = false;          // edge: request straight-line (X) mode on/off
};

struct WheelState {
    // Dynamic states.
    double compression = 0.0;     // [m], + = wheel moved up relative to the body
    double compressionVel = 0.0;
    double omega = 0.0;           // [rad/s]
    double spinAngle = 0.0;       // [rad], visuals only
    double kappaT = 0.0;          // relaxed slip ratio
    double tanAlphaT = 0.0;       // relaxed tan(slip angle)
    TyreThermal thermal;
    double brakeTemp = 350.0;     // [degC]
    int trackHint = -1;

    // Outputs of the last step.
    double steer = 0.0;           // road wheel angle [rad]
    double fz = 0.0, fx = 0.0, fy = 0.0, mz = 0.0;
    double slipAngle = 0.0, slipRatio = 0.0, normalizedSlip = 0.0;
    double camber = 0.0;          // automotive camber relative to the road [rad]
    double suspensionForce = 0.0;
    double effectiveRadius = 0.36;
    double brakeTorque = 0.0;     // applied friction torque [Nm]
    double gripFactor = 1.0;
    Vec3 wheelCentre;             // world
    Vec3 contactPoint;            // world
    Surface surface = Surface::Asphalt;
    bool onTrack = true;
    double groundS = 0.0, groundD = 0.0;
};

enum class ErsMode { Balanced = 0, Qualifying = 1, Harvest = 2 };
const char* ersModeName(ErsMode m);

struct PowertrainState {
    int gear = 1;                 // -1 = R, 0 = N, 1..n
    ErsMode ersMode = ErsMode::Balanced;
    double engineOmega = 0.0;     // [rad/s]
    double shiftTimer = 0.0;      // > 0 while a shift is in progress
    bool upshifting = false;
    bool shiftRefused = false;    // last downshift refused (over-rev protection)
    double clutchEngagement = 1.0;
    double iceTorque = 0.0;       // [Nm] at the crank
    double mgukTorque = 0.0;      // [Nm] at the crank, + = deploy
    double mgukPower = 0.0;       // [W] mechanical, + = deploy
    double soc = 4.0e6;           // [J] within the battery window
    double lapHarvest = 0.0;      // [J] harvested since the last lap line
    double fuelMass = 10.0;       // [kg]
    bool revLimiter = false;
};

struct VehicleState {
    Vec3 pos;                     // CoG, world
    Quat rot;                     // body -> world
    Vec3 vel;                     // world
    Vec3 angVel;                  // body
    Vec3 accWorld;                // last kinematic acceleration of the CoG (world)
    Vec3 angAcc;                  // body
    std::array<WheelState, 4> wheels;
    PowertrainState pt;

    double steeringWheelAngle = 0.0;
    double steeringTorque = 0.0;  // at the steering wheel after assist [Nm], + = pushes left
    double throttle = 0.0, brake = 0.0, clutch = 0.0;
    double brakeBias = 0.56;

    double aeroMode = 0.0;        // 0 = corner (Z), 1 = straight (X), continuous during transition
    bool aeroStraightRequested = false;
    double downforceFront = 0.0, downforceRear = 0.0, drag = 0.0;
    double rideHeightFront = 0.0, rideHeightRear = 0.0;
    bool floorContact = false;
    bool wallContact = false;
    double time = 0.0;

    double speed() const { return length(vel); }
    // What an accelerometer at the CoG reads, in g, body frame
    // (x = longitudinal, y = lateral, z = ~1 at rest).
    Vec3 gForce() const { return rot.inverseRotate(accWorld + Vec3{0.0, 0.0, kGravity}) / kGravity; }
    double rpm() const { return pt.engineOmega * 60.0 / (2.0 * kPi); }
};

class Vehicle {
public:
    Vehicle(const CarParams& params, const Track* track);

    // Places the car at lap coordinates with the suspension at static
    // equilibrium, rolling at `speed` [m/s] in the given gear.
    void resetAt(double s, double d, double speed, int gear = 1);
    void step(double dt, const DriverInputs& in);

    const VehicleState& state() const { return st_; }
    const CarParams& params() const { return p_; }
    const Track* track() const { return track_; }

    void setBrakeBias(double bias) { st_.brakeBias = clamp(bias, 0.45, 0.70); }
    void setErsMode(ErsMode m) { st_.pt.ersMode = m; }
    void setAmbient(double airC, double trackC) { airTemp_ = airC; trackTemp_ = trackC; }
    void setTyreTemperatures(double surfaceC, double carcassC);
    // Called by lap timing when crossing the line (per-lap harvest allowance).
    void onLapLine() { st_.pt.lapHarvest = 0.0; }

    // Body-frame position of each wheel centre at static ride height.
    Vec3 wheelBodyPosition(int i) const;
    double floorBodyZ(double x) const;  // floor underside in body frame at static attitude

private:
    struct AxleCache { double staticSpringForce; double zWheelStatic; };
    const AxleParams& axle(int i) const { return i < 2 ? p_.front : p_.rear; }
    static double side(int i) { return (i % 2 == 0) ? 1.0 : -1.0; }  // left = +1

    void updateAero(double dt, const DriverInputs& in);
    void solveDriveline(double dt, const std::array<double, 4>& tyreTorque);
    void updateShifting(double dt, const DriverInputs& in);
    double totalRatio(int gear) const;
    double damperForce(const AxleParams& a, double v) const;

    CarParams p_;
    const Track* track_;
    std::array<TyreModel, 4> tyres_;
    VehicleState st_;
    std::array<AxleCache, 4> cache_{};
    double airTemp_ = 25.0, trackTemp_ = 35.0;
    double unsprungTotal_ = 0.0;
    double hydraulicRearScale_ = 1.0;
};

}  // namespace f1sim
