// State published by the physics thread for rendering and the HUD.
#pragma once

#include <array>
#include <string>

#include "f1sim/vehicle.hpp"

namespace app {

struct Snapshot {
    f1sim::VehicleState car;
    double simTime = 0.0;
    double carS = 0.0;

    // Timing
    bool timing = false;
    double currentLap = 0.0, lastLap = 0.0, bestLap = 0.0, delta = 0.0;
    bool deltaValid = false, lapValid = true, lastLapValid = false;
    int lapCount = 0, sector = 0;
    std::array<double, 3> lastSectors{}, bestSectors{}, currentSectors{};

    // Inputs as the car receives them
    bool wheelActive = false, gamepadActive = false;
    // Force feedback
    double ffbCommand = 0.0, ffbClipping = 0.0;
    bool ffbActive = false;

    bool paused = false;
    bool autopilot = false;
    double physicsHz = 0.0;       // measured step rate
    int overruns = 0;             // times the physics thread had to drop time
    std::string message;          // transient banner (e.g. "Lap saved")
    double messageTime = 0.0;
};

}  // namespace app
