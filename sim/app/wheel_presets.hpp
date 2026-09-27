// Force-feedback presets for common wheel bases, matched by the device name
// SDL reports. Applied automatically when the steering axis is bound to a
// recognised wheel; every value stays editable in the setup screen (F2).
#pragma once

#include <string>

#include "settings.hpp"

namespace app {

struct WheelPreset {
    const char* match;           // case-insensitive substring of the device name
    const char* label;           // shown in the UI
    double maxTorqueNm;          // peak torque of the base
    double rotationDeg;          // recommended rotation (set the same in the vendor driver)
    double carTorqueScale;       // device Nm per car Nm (weak wheels need a lower scale to avoid clipping)
    double minForce;             // dead-zone compensation (gear/belt wheels)
    double filterHz;             // low-pass on the physics signal (gear rattle on weak wheels)
    double damping;
    const char* driverHint;      // what to set in the vendor software
};

// Returns nullptr when the device is not a known wheel (the generic defaults stay).
const WheelPreset* findWheelPreset(const std::string& deviceName);
// Copies the preset into the FFB and rotation settings.
void applyWheelPreset(const WheelPreset& p, Settings* s);

}  // namespace app
