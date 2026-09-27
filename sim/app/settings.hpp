// User settings (graphics, force feedback, controls), stored in
// config/settings.ini next to the executable. Created with defaults on the
// first run; controls are written by the in-game setup screen (F2).
#pragma once

#include <map>
#include <string>

#include "f1sim/ffb.hpp"

namespace app {

// One analogue axis binding on a specific device.
struct AxisBinding {
    std::string device;      // SDL GUID string, empty = unbound
    std::string deviceName;  // for display only
    int axis = -1;
    int rest = 0;            // raw value at rest (pedals) / centre (steering)
    int full = 32767;        // raw value at full travel (pedals) / full right (steering)
    bool bound() const { return !device.empty() && axis >= 0; }
};

struct ButtonBinding {
    std::string device;
    std::string deviceName;
    int button = -1;
    bool bound() const { return !device.empty() && button >= 0; }
};

// Ids of all HUD apps (see hud.cpp).
extern const char* const kAppIds[];
extern const int kAppCount;

struct Settings {
    // Content
    std::string carFile = "cars/f1_2025_generic.ini";
    std::string trackFile = "tracks/red_bull_ring.csv";
    std::string carModelFile;      // empty = the car's own [visual] model_config

    // Graphics
    int windowWidth = 1600, windowHeight = 900;
    bool fullscreen = false;
    bool vsync = true;
    int msaa = 4;
    double fovDeg = 58.0;          // vertical field of view in the cockpit
    int camera = 0;                // 0 cockpit, 1 T-cam, 2 chase

    // Force feedback
    f1sim::FfbSettings ffb;
    bool ffbEnabled = true;
    int ffbRateHz = 500;

    // Steering and pedals
    double wheelRotationDeg = 900.0; // must match the wheel driver's rotation setting
    std::string wheelPreset;         // label of the applied wheel preset, empty = generic defaults
    double brakeGamma = 1.0;         // brake pedal response curve (1 = linear)
    double pedalDeadzone = 0.02;
    AxisBinding steer, throttle, brake, clutch;
    ButtonBinding shiftUp, shiftDown, aero, reset, ersMode;

    // Keyboard
    double keyboardSteerSpeed = 2.5;  // steering wheel rad/s

    // HUD apps: id -> "visible,x,y" (pixels; empty = default layout)
    std::map<std::string, std::string> apps;

    // Session
    double airTempC = 25.0, trackTempC = 35.0;
    bool saveTelemetry = true;

    bool load(const std::string& path, std::string* error);
    bool save(const std::string& path) const;
};

}  // namespace app
