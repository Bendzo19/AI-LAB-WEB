// Vehicle parameter set. All members are SI units (m, kg, N, s, rad, K as
// degC offsets where noted). The car data file uses explicit unit suffixes
// (e.g. `_mm`, `_deg`, `_kw`) and is converted on load.
#pragma once

#include <string>
#include <vector>

namespace f1sim {

class IniFile;

struct TyreParams {
    double radius = 0.36;            // unloaded radius [m]
    double width = 0.3;              // [m], used for visuals/thermal area
    double wheelInertia = 1.0;       // wheel + tyre + brake disc spin inertia [kg m^2]
    double vertStiffness = 280000.0; // [N/m]
    double vertDamping = 400.0;      // [N s/m]

    // Grip: peak friction coefficient at nominal load fz0, linear load sensitivity.
    double fz0 = 4000.0;
    double muY = 1.75, muX = 1.80;
    double loadSensY = -0.12, loadSensX = -0.10;  // d(mu)/mu per d(Fz)/Fz0
    double peakSlipAngle = 0.087;    // [rad] at fz0
    double peakSlipRatio = 0.10;
    double peakSlipLoadGrowth = 0.10;  // relative growth of peak slip per d(Fz)/Fz0
    double shapeCy = 1.45, curvEy = -0.6;  // Magic Formula shape/curvature, lateral
    double shapeCx = 1.60, curvEx = -0.4;  // Magic Formula shape/curvature, longitudinal

    // Aligning moment: pneumatic trail falls to zero at trailZeroSlip * normalized slip.
    double pneumaticTrail = 0.035;   // [m] at zero slip
    double trailZeroSlip = 1.15;     // normalized combined slip where trail reaches 0
    double lateralCarcassStiffness = 220000.0;  // [N/m] for Fx-induced Mz

    double camberThrust = 0.35;      // Fy = k * Fz * camber[rad]
    double camberOptimal = -0.026;   // [rad] automotive convention, relative to road
    double camberSensitivity = 60.0; // grip loss per rad^2 away from optimum

    double relaxLengthX = 0.12, relaxLengthY = 0.22;  // [m]
    double rollingResistance = 0.012;

    // Thermal model (two nodes per tyre: tread surface, carcass). Temps in degC.
    double tempOptimal = 100.0;
    double tempWindow = 35.0;        // half-width where grip loss reaches coldLoss/hotLoss
    double coldGripLoss = 0.10, hotGripLoss = 0.08;
    double surfaceWeight = 0.6;      // weight of surface temp in effective grip temperature
    double surfaceHeatCapacity = 2500.0;   // [J/K]
    double carcassHeatCapacity = 16000.0;  // [J/K]
    double surfaceToCarcass = 260.0;       // [W/K]
    double surfaceToAirBase = 25.0, surfaceToAirPerSpeed = 3.2;  // [W/K], [W/K per m/s]
    double surfaceToTrack = 60.0;          // [W/K] while loaded
    double carcassToAir = 35.0;            // [W/K]
    double frictionHeatShare = 0.30;       // share of sliding power that heats the tread
    double hysteresisCoeff = 0.0025;       // carcass heat [W] = k * Fz * speed
    double coldPressureKpa = 150.0;        // absolute gauge at blanket temp (display only)
};

struct AxleParams {
    double x = 0.0;                  // longitudinal position from CoG [m] (+ forward)
    double track = 1.6;              // wheel centre to wheel centre [m]
    double unsprungMass = 25.0;      // per corner [kg]
    double springRate = 180000.0;    // corner wheel rate [N/m]
    double heaveRate = 250000.0;     // axle heave rate at wheel [N/m]
    double heaveGap = 0.012;         // heave travel before packer [m]
    double heavePackerRate = 1500000.0;
    double arbRate = 150000.0;       // wheel rate in roll [N/m]
    double bumpStopGap = 0.022;      // corner compression before bump stop [m]
    double bumpStopRate = 3000000.0;
    double droopTravel = 0.035;      // max extension from static [m]
    double damperBumpSlow = 9000.0, damperBumpFast = 3500.0;       // [N s/m]
    double damperReboundSlow = 12000.0, damperReboundFast = 5000.0;
    double damperKnee = 0.08;        // [m/s]
    double staticCamber = -0.057;    // [rad], automotive convention (negative = top in)
    double staticToe = 0.0;          // [rad], + = toe-in
    double camberGain = -0.5;        // [rad of camber per m of compression]
    double rollCentreHeight = 0.04;  // [m] above ground
    double antiTan = 0.1;            // tan of side-view anti angle (anti-dive / anti-squat)
    double rideHeight = 0.03;        // static floor height at this axle [m]
    TyreParams tyre;
};

struct AeroParams {
    double airDensity = 1.20;
    double claCorner = 3.4, cdaCorner = 1.05;      // Z-mode [m^2]
    double claStraight = 1.9, cdaStraight = 0.72;  // X-mode [m^2]
    double balanceFrontCorner = 0.44;              // front share of downforce
    double balanceFrontStraight = 0.40;
    double modeTransitionTime = 0.35;              // [s]
    double refRideHeight = 0.045;                  // mean floor height of the map reference [m]
    double rideHeightSensitivity = 4.0;            // relative dClA per m lower
    double stallRideHeight = 0.018;                // below this the floor stalls [m]
    double stallSlope = 30.0;                      // relative ClA loss per m below stall
    double rakeBalanceSensitivity = 1.5;           // front balance change per m of extra rake
    double yawSensitivity = 8.0;                   // relative ClA loss per rad^2 of sideslip
    double copHeight = 0.05;                       // drag application height above CoG [m]
    double frontFloorX = 1.2, rearFloorX = -1.4;   // ride-height sensor points [m]
};

struct PowertrainParams {
    std::vector<double> iceRpm;      // power curve sample points
    std::vector<double> icePowerW;   // full-load ICE crank power [W]
    double revLimit = 12500.0;
    double idleRpm = 4000.0;
    double stallRpm = 2800.0;
    double engineInertia = 0.06;     // crank + flywheel + MGU-K reflected [kg m^2]
    double engineBrakeTorque = 45.0; // [Nm] at idle, grows with rpm
    double engineBrakePerRpm = 0.006;
    std::vector<double> gearRatios;  // forward gears, engine/output
    double finalDrive = 4.0;
    double reverseRatio = 3.5;
    double drivelineEfficiency = 0.93;
    double shiftTime = 0.03;         // torque-interrupted window [s]
    double clutchMaxTorque = 900.0;  // [Nm] at the crank
    double gearboxInertia = 0.02;    // reflected to input shaft [kg m^2]
    double diffPreload = 100.0;      // [Nm]
    double diffPowerLock = 0.35;     // extra locking torque per Nm of input, on power
    double diffCoastLock = 0.25;     // same, off power

    // Energy recovery system (2026-style MGU-K only).
    double mgukMaxPower = 350000.0;  // [W]
    double mgukMaxTorque = 500.0;    // [Nm] at the crank
    double mgukTaperStartKph = 290.0;// deploy power tapers linearly above this speed
    double mgukTaperEndKph = 360.0;  // ... reaching zero here
    double batteryWindow = 4.0e6;    // usable state-of-charge window [J]
    double harvestPerLap = 8.5e6;    // [J]
    double mgukEfficiency = 0.95;
    double coastHarvestPower = 120000.0;  // off-throttle harvesting [W]

    double fuelMass = 10.0;          // [kg] at start
    double fuelLhv = 43.0e6;         // [J/kg]
    double iceThermalEfficiency = 0.50;
};

struct BrakeParams {
    double maxTorque = 16000.0;      // total at full pedal, all wheels [Nm]
    double biasFront = 0.56;
    double discHeatCapacity = 1500.0;  // per corner [J/K]
    double coolingBase = 2.0, coolingPerSpeed = 0.6;  // [W/K], [W/K per m/s]
    double tempOptimalLow = 350.0, tempOptimalHigh = 1000.0;
    double coldFactor = 0.60;        // friction factor at ambient
    double fadeFactor = 0.85;        // friction factor at +300 K beyond optimal window
};

struct SteeringParams {
    double ratio = 8.6;              // steering wheel angle / road wheel angle
    double lock = 3.1416;            // max steering wheel angle each side [rad]
    double ackermann = 0.0;          // 0 = parallel, 1 = full Ackermann
    double mechanicalTrail = 0.030;  // [m]
    double scrubRadius = 0.020;      // [m]
    double weightCentering = 0.012;  // [m] caster/KPI jacking lever
    double powerAssist = 0.80;       // share of rack load removed by the power steering
};

struct ChassisParams {
    double mass = 768.0;             // car + driver without fuel [kg]
    double cgHeight = 0.28;
    double weightFront = 0.455;      // static front weight fraction
    double wheelbase = 3.4;
    double ixx = 180.0, iyy = 950.0, izz = 1050.0;
    double length = 5.4, width = 1.9;  // bounding box for walls/visuals
};

struct CarParams {
    std::string name = "unnamed";
    ChassisParams chassis;
    AxleParams front, rear;
    AeroParams aero;
    PowertrainParams powertrain;
    BrakeParams brakes;
    SteeringParams steering;

    // Loads a car file. Missing keys are errors; unknown keys are reported
    // through `warnings` so typos in data files cannot go unnoticed.
    static bool load(const std::string& path, CarParams* out, std::string* error,
                     std::vector<std::string>* warnings);
    static bool fromIni(const IniFile& ini, CarParams* out, std::string* error,
                        std::vector<std::string>* warnings);

    double totalMass() const { return chassis.mass + powertrain.fuelMass; }
    int gearCount() const { return static_cast<int>(powertrain.gearRatios.size()); }
    // Full-load ICE crank power at a given engine speed, interpolated.
    double icePowerAt(double rpm) const;
};

}  // namespace f1sim
