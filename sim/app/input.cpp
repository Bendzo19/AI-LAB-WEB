#include "input.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>

namespace app {

const char* bindTargetName(BindTarget t) {
    switch (t) {
        case BindTarget::Steer: return "STEERING (turn the wheel fully LEFT, then back to centre)";
        case BindTarget::Throttle: return "THROTTLE (press fully, then release)";
        case BindTarget::Brake: return "BRAKE (press fully, then release)";
        case BindTarget::Clutch: return "CLUTCH (press fully, then release)";
        case BindTarget::ShiftUp: return "SHIFT UP (press the button)";
        case BindTarget::ShiftDown: return "SHIFT DOWN (press the button)";
        case BindTarget::Aero: return "ACTIVE AERO (press the button)";
        case BindTarget::Reset: return "RESET CAR (press the button)";
        case BindTarget::ErsMode: return "ERS MODE (press the button)";
        default: return "";
    }
}

InputSystem::~InputSystem() { shutdown(); }

void InputSystem::shutdown() {
    stopForce();
    if (haptic_) {
        SDL_CloseHaptic(haptic_);
        haptic_ = nullptr;
    }
    for (auto& d : devices_) {
        if (d.pad) SDL_CloseGamepad(d.pad);
        else if (d.joy) SDL_CloseJoystick(d.joy);
    }
    devices_.clear();
}

InputSystem::Device* InputSystem::find(const std::string& guid) {
    if (guid.empty()) return nullptr;
    for (auto& d : devices_) {
        if (d.guid == guid) return &d;
    }
    return nullptr;
}

void InputSystem::refreshDevices() {
    // Drop disconnected devices.
    for (auto it = devices_.begin(); it != devices_.end();) {
        if (!SDL_JoystickConnected(it->joy)) {
            if (it->guid == ffbGuid_) {
                if (haptic_) SDL_CloseHaptic(haptic_);
                haptic_ = nullptr;
                effect_ = -1;
                ffbGuid_.clear();
            }
            if (it->pad) SDL_CloseGamepad(it->pad);
            else SDL_CloseJoystick(it->joy);
            it = devices_.erase(it);
        } else {
            ++it;
        }
    }
    int count = 0;
    SDL_JoystickID* ids = SDL_GetJoysticks(&count);
    for (int i = 0; ids && i < count; ++i) {
        const bool known = std::any_of(devices_.begin(), devices_.end(), [&](const Device& d) { return d.id == ids[i]; });
        if (known) continue;
        Device d;
        d.id = ids[i];
        if (SDL_IsGamepad(ids[i])) {
            d.pad = SDL_OpenGamepad(ids[i]);
            d.joy = d.pad ? SDL_GetGamepadJoystick(d.pad) : nullptr;
        } else {
            d.joy = SDL_OpenJoystick(ids[i]);
        }
        if (!d.joy) continue;
        char guid[64];
        SDL_GUIDToString(SDL_GetJoystickGUID(d.joy), guid, sizeof(guid));
        d.guid = guid;
        const char* name = SDL_GetJoystickName(d.joy);
        d.name = name ? name : "unknown device";
        // Several identical devices share a GUID; make the key unique.
        int dup = 0;
        for (const auto& o : devices_) dup += o.guid.rfind(d.guid, 0) == 0 ? 1 : 0;
        if (dup > 0) d.guid += "#" + std::to_string(dup);
        d.axes.assign(std::max(0, SDL_GetNumJoystickAxes(d.joy)), 0);
        d.buttons.assign(std::max(0, SDL_GetNumJoystickButtons(d.joy)), 0);
        d.prevButtons = d.buttons;
        SDL_Log("input: %s [%s] axes=%zu buttons=%zu%s", d.name.c_str(), d.guid.c_str(), d.axes.size(), d.buttons.size(),
                d.pad ? " (gamepad)" : "");
        devices_.push_back(std::move(d));
    }
    SDL_free(ids);
}

void InputSystem::poll() {
    SDL_UpdateJoysticks();
    const Uint64 now = SDL_GetTicks();
    if (now - lastScan_ > 1000 || lastScan_ == 0) {
        refreshDevices();
        lastScan_ = now;
    }
    for (auto& d : devices_) {
        d.prevButtons = d.buttons;
        for (size_t a = 0; a < d.axes.size(); ++a) d.axes[a] = SDL_GetJoystickAxis(d.joy, static_cast<int>(a));
        for (size_t b = 0; b < d.buttons.size(); ++b) d.buttons[b] = SDL_GetJoystickButton(d.joy, static_cast<int>(b)) ? 1 : 0;
    }
    runBinding();

    // Publish a snapshot for the setup screen at a modest rate.
    static Uint64 lastSnap = 0;
    if (now - lastSnap > 30) {
        lastSnap = now;
        std::vector<DeviceSnapshot> snap;
        for (const auto& d : devices_) {
            DeviceSnapshot s;
            s.guid = d.guid;
            s.name = d.name;
            s.axes = d.axes;
            s.buttons = d.buttons;
            s.gamepad = d.pad != nullptr;
            s.ffb = d.guid == ffbGuid_ && haptic_;
            snap.push_back(std::move(s));
        }
        std::lock_guard<std::mutex> lock(mutex_);
        snapshot_ = std::move(snap);
    }
}

void InputSystem::runBinding() {
    const int req = bindRequest_.exchange(0);
    if (req == -1) bindActive_.store(0);
    if (req > 0) {
        bindActive_.store(req);
        bindBaseline_.clear();
        bindExtreme_.clear();
        for (const auto& d : devices_) {
            bindBaseline_.push_back(d.axes);
            bindExtreme_.push_back(d.axes);
        }
        bindStart_ = SDL_GetTicks();
        bindDetect_ = 0;
        bindDev_ = bindAxis_ = -1;
    }
    const auto target = static_cast<BindTarget>(bindActive_.load());
    if (target == BindTarget::None) return;
    if (bindBaseline_.size() != devices_.size()) {  // device list changed mid-bind
        bindRequest_.store(static_cast<int>(target));
        return;
    }
    const Uint64 now = SDL_GetTicks();
    if (now - bindStart_ > 15000) {  // give up
        bindActive_.store(0);
        return;
    }
    const bool wantsButton = target == BindTarget::ShiftUp || target == BindTarget::ShiftDown ||
                             target == BindTarget::Aero || target == BindTarget::Reset || target == BindTarget::ErsMode;
    if (wantsButton) {
        for (auto& d : devices_) {
            for (size_t b = 0; b < d.buttons.size(); ++b) {
                if (d.buttons[b] && !d.prevButtons[b]) {
                    BindResult r;
                    r.target = target;
                    r.button = {d.guid, d.name, static_cast<int>(b)};
                    std::lock_guard<std::mutex> lock(mutex_);
                    result_ = r;
                    bindActive_.store(0);
                    return;
                }
            }
        }
        return;
    }
    // Axis: remember the extreme of every axis; the one that moved the most wins.
    int bestDev = -1, bestAxis = -1, bestDev2 = 0;
    for (size_t di = 0; di < devices_.size(); ++di) {
        const auto& d = devices_[di];
        for (size_t a = 0; a < d.axes.size(); ++a) {
            const int base = bindBaseline_[di][a];
            if (std::abs(d.axes[a] - base) > std::abs(bindExtreme_[di][a] - base)) bindExtreme_[di][a] = d.axes[a];
            const int dev = std::abs(bindExtreme_[di][a] - base);
            if (dev > bestDev2) {
                bestDev2 = dev;
                bestDev = static_cast<int>(di);
                bestAxis = static_cast<int>(a);
            }
        }
    }
    if (bindDetect_ == 0 && bestDev2 > 16000) {
        bindDetect_ = now;
        bindDev_ = bestDev;
        bindAxis_ = bestAxis;
    }
    if (bindDetect_ == 0) return;
    if (bestDev != bindDev_ || bestAxis != bindAxis_) {  // a different axis moved more: follow it
        bindDev_ = bestDev;
        bindAxis_ = bestAxis;
    }
    const auto& d = devices_[bindDev_];
    const int base = bindBaseline_[bindDev_][bindAxis_];
    const int cur = d.axes[bindAxis_];
    const bool released = std::abs(cur - base) < 3000;
    if (released || now - bindDetect_ > 5000) {
        BindResult r;
        r.target = target;
        r.axis.device = d.guid;
        r.axis.deviceName = d.name;
        r.axis.axis = bindAxis_;
        r.axis.rest = base;
        r.axis.full = bindExtreme_[bindDev_][bindAxis_];
        std::lock_guard<std::mutex> lock(mutex_);
        result_ = r;
        bindActive_.store(0);
    }
}

std::optional<BindResult> InputSystem::takeBindResult() {
    std::lock_guard<std::mutex> lock(mutex_);
    auto r = result_;
    result_.reset();
    return r;
}

std::vector<DeviceSnapshot> InputSystem::devices() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return snapshot_;
}

std::string InputSystem::ffbDevice() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return ffbName_;
}

bool InputSystem::buttonEdge(const ButtonBinding& b) {
    if (!b.bound()) return false;
    Device* d = find(b.device);
    if (!d || b.button >= static_cast<int>(d->buttons.size())) return false;
    return d->buttons[b.button] && !d->prevButtons[b.button];
}

ControlState InputSystem::read(const Settings& s) {
    ControlState c;
    if (activeBind() != BindTarget::None) return c;  // do not drive while binding
    auto pedal = [&](const AxisBinding& b, bool* bound) {
        Device* d = find(b.device);
        if (!b.bound() || !d || b.axis >= static_cast<int>(d->axes.size()) || b.full == b.rest) return 0.0;
        *bound = true;
        double v = static_cast<double>(d->axes[b.axis] - b.rest) / static_cast<double>(b.full - b.rest);
        v = std::clamp(v, 0.0, 1.0);
        const double dz = s.pedalDeadzone;
        return std::clamp((v - dz) / (1.0 - 2.0 * dz), 0.0, 1.0);
    };
    if (Device* d = find(s.steer.device); d && s.steer.bound() && s.steer.axis < static_cast<int>(d->axes.size())) {
        c.wheel = true;
        const double dir = s.steer.full >= s.steer.rest ? 1.0 : -1.0;  // bound by turning LEFT
        c.steerNormalized = std::clamp(dir * (d->axes[s.steer.axis] - s.steer.rest) / 32767.0, -1.0, 1.0);
    }
    c.throttle = pedal(s.throttle, &c.throttleBound);
    c.brake = pedal(s.brake, &c.brakeBound);
    bool clutchBound = false;
    c.clutch = pedal(s.clutch, &clutchBound);
    if (s.brakeGamma > 0.0 && s.brakeGamma != 1.0) c.brake = std::pow(c.brake, s.brakeGamma);
    c.shiftUp = buttonEdge(s.shiftUp);
    c.shiftDown = buttonEdge(s.shiftDown);
    c.aero = buttonEdge(s.aero);
    c.reset = buttonEdge(s.reset);
    c.ersMode = buttonEdge(s.ersMode);

    // First gamepad: used when no wheel is bound (and for anything unbound).
    for (auto& d : devices_) {
        if (!d.pad) continue;
        c.gamepad = true;
        if (!c.wheel) {
            const double x = SDL_GetGamepadAxis(d.pad, SDL_GAMEPAD_AXIS_LEFTX) / 32767.0;
            const double dz = 0.08;
            const double m = std::fabs(x) < dz ? 0.0 : (std::fabs(x) - dz) / (1.0 - dz);
            c.steerNormalized = -std::copysign(m * m, x);  // stick left = steer left
        }
        if (!c.throttleBound) c.throttle = std::max(c.throttle, SDL_GetGamepadAxis(d.pad, SDL_GAMEPAD_AXIS_RIGHT_TRIGGER) / 32767.0);
        if (!c.brakeBound) c.brake = std::max(c.brake, SDL_GetGamepadAxis(d.pad, SDL_GAMEPAD_AXIS_LEFT_TRIGGER) / 32767.0);
        const bool now[6] = {SDL_GetGamepadButton(d.pad, SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER),
                             SDL_GetGamepadButton(d.pad, SDL_GAMEPAD_BUTTON_LEFT_SHOULDER),
                             SDL_GetGamepadButton(d.pad, SDL_GAMEPAD_BUTTON_NORTH),
                             SDL_GetGamepadButton(d.pad, SDL_GAMEPAD_BUTTON_BACK),
                             SDL_GetGamepadButton(d.pad, SDL_GAMEPAD_BUTTON_WEST), false};
        c.shiftUp |= now[0] && !padPrev_[0];
        c.shiftDown |= now[1] && !padPrev_[1];
        c.aero |= now[2] && !padPrev_[2];
        c.reset |= now[3] && !padPrev_[3];
        c.ersMode |= now[4] && !padPrev_[4];
        for (int i = 0; i < 6; ++i) padPrev_[i] = now[i];
        break;
    }
    return c;
}

void InputSystem::openFfbFor(const Settings& s) {
    if (haptic_) {
        stopForce();
        SDL_CloseHaptic(haptic_);
        haptic_ = nullptr;
        effect_ = -1;
    }
    ffbGuid_.clear();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        ffbName_.clear();
    }
    if (!s.ffbEnabled) return;
    Device* d = find(s.steer.device);
    if (!d) return;
    SDL_Haptic* h = SDL_OpenHapticFromJoystick(d->joy);
    if (!h) {
        SDL_Log("ffb: %s has no force feedback (%s)", d->name.c_str(), SDL_GetError());
        return;
    }
    if (!(SDL_GetHapticFeatures(h) & SDL_HAPTIC_CONSTANT)) {
        SDL_Log("ffb: %s does not support constant force", d->name.c_str());
        SDL_CloseHaptic(h);
        return;
    }
    if (SDL_GetHapticFeatures(h) & SDL_HAPTIC_AUTOCENTER) SDL_SetHapticAutocenter(h, 0);
    if (SDL_GetHapticFeatures(h) & SDL_HAPTIC_GAIN) SDL_SetHapticGain(h, 100);
    SDL_HapticEffect e;
    SDL_zero(e);
    e.type = SDL_HAPTIC_CONSTANT;
    e.constant.type = SDL_HAPTIC_CONSTANT;
    e.constant.direction.type = SDL_HAPTIC_STEERING_AXIS;
    e.constant.direction.dir[0] = 1;
    e.constant.length = SDL_HAPTIC_INFINITY;
    e.constant.level = 0;
    const int id = SDL_CreateHapticEffect(h, &e);
    if (id < 0 || !SDL_RunHapticEffect(h, id, 1)) {
        SDL_Log("ffb: cannot start constant force on %s (%s)", d->name.c_str(), SDL_GetError());
        SDL_CloseHaptic(h);
        return;
    }
    haptic_ = h;
    effect_ = id;
    effectDesc_ = e;
    lastLevel_ = 0;
    ffbGuid_ = d->guid;
    std::lock_guard<std::mutex> lock(mutex_);
    ffbName_ = d->name;
    SDL_Log("ffb: constant force running on %s", d->name.c_str());
}

void InputSystem::setForce(double command) {
    if (!haptic_ || effect_ < 0) return;
    const auto level = static_cast<Sint16>(std::lround(std::clamp(command, -1.0, 1.0) * 32767.0));
    if (level == lastLevel_) return;
    lastLevel_ = level;
    effectDesc_.constant.level = level;
    SDL_UpdateHapticEffect(haptic_, effect_, &effectDesc_);
}

void InputSystem::stopForce() {
    if (!haptic_ || effect_ < 0) return;
    effectDesc_.constant.level = 0;
    SDL_UpdateHapticEffect(haptic_, effect_, &effectDesc_);
    SDL_StopHapticEffect(haptic_, effect_);
    lastLevel_ = 0;
}

}  // namespace app
