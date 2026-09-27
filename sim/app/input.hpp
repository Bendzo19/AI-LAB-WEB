// Wheel / pedal / gamepad input and force feedback output (SDL3).
//
// Threading: every SDL joystick and haptic call is made from the physics
// thread only (the owner of this object). The UI thread talks to it through
// the thread-safe accessors at the bottom (snapshots, bind requests).
#pragma once

#include <SDL3/SDL.h>

#include <atomic>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "settings.hpp"

namespace app {

enum class BindTarget { None, Steer, Throttle, Brake, Clutch, ShiftUp, ShiftDown, Aero, Reset, ErsMode };
const char* bindTargetName(BindTarget t);

struct DeviceSnapshot {
    std::string guid, name;
    std::vector<int> axes;
    std::vector<uint8_t> buttons;
    bool gamepad = false;
    bool ffb = false;
};

struct BindResult {
    BindTarget target = BindTarget::None;
    AxisBinding axis;
    ButtonBinding button;
};

// Controls after mapping, in physical units.
struct ControlState {
    bool wheel = false;           // a bound steering axis is connected
    bool gamepad = false;
    double steerNormalized = 0.0; // -1..1 of the physical wheel rotation (+ = left)
    double throttle = 0.0, brake = 0.0, clutch = 0.0;
    bool throttleBound = false, brakeBound = false;
    bool shiftUp = false, shiftDown = false, aero = false, reset = false, ersMode = false;  // edges
};

class InputSystem {
public:
    ~InputSystem();
    // Physics thread.
    void poll();
    ControlState read(const Settings& s);
    void setForce(double command);  // -1..1, + = pushes the wheel left
    void stopForce();
    void openFfbFor(const Settings& s);
    void shutdown();

    // Any thread.
    void requestBind(BindTarget t) { bindRequest_.store(static_cast<int>(t)); }
    void cancelBind() { bindRequest_.store(-1); }
    BindTarget activeBind() const { return static_cast<BindTarget>(bindActive_.load()); }
    std::optional<BindResult> takeBindResult();
    std::vector<DeviceSnapshot> devices() const;
    std::string ffbDevice() const;

private:
    struct Device {
        SDL_JoystickID id = 0;
        SDL_Joystick* joy = nullptr;
        SDL_Gamepad* pad = nullptr;
        std::string guid, name;
        std::vector<int> axes;
        std::vector<uint8_t> buttons, prevButtons;
    };
    Device* find(const std::string& guid);
    void refreshDevices();
    void runBinding();
    bool buttonEdge(const ButtonBinding& b);

    std::vector<Device> devices_;
    Uint64 lastScan_ = 0;

    // FFB
    SDL_Haptic* haptic_ = nullptr;
    int effect_ = -1;
    SDL_HapticEffect effectDesc_{};
    Sint16 lastLevel_ = 0;
    std::string ffbGuid_;

    // Binding state machine.
    std::atomic<int> bindRequest_{0};
    std::atomic<int> bindActive_{0};
    std::vector<std::vector<int>> bindBaseline_;
    std::vector<std::vector<int>> bindExtreme_;
    Uint64 bindStart_ = 0, bindDetect_ = 0;
    int bindDev_ = -1, bindAxis_ = -1;

    // Gamepad edge tracking.
    bool padPrev_[6] = {};

    mutable std::mutex mutex_;
    std::optional<BindResult> result_;
    std::vector<DeviceSnapshot> snapshot_;
    std::string ffbName_;
};

}  // namespace app
