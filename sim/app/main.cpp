// f1sim - playable time trial.
//
// Threads:
//   main    : window, keyboard events, rendering, HUD, settings UI
//   physics : fixed 1 kHz simulation, wheel/pedal polling, force feedback
//
// Command line:
//   --data <dir>          data directory (default: next to the executable)
//   --demo                start with the robot driver (autopilot)
//   --screenshot <png>    render, save a screenshot after --frames N frames, exit
//   --frames <n>          (default 240)
//   --camera <0|1|2>      cockpit / T-cam / chase
#include <SDL3/SDL.h>
#include <SDL3/SDL_main.h>

#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <mutex>
#include <thread>

#include "f1sim/ai_driver.hpp"
#include "f1sim/session.hpp"
#include "gl.hpp"
#include "hud.hpp"
#include "input.hpp"
#include "renderer.hpp"
#include "settings.hpp"
#include "snapshot.hpp"
#include "stb_image_write.h"

using namespace app;

namespace {

enum class Cmd { None, RestartPit, Recover, TogglePause, ToggleAutopilot, CycleErs, BiasFront, BiasRear, FfbTest, ReopenFfb };

struct Shared {
    std::atomic<bool> running{true};
    std::mutex snapMutex;
    Snapshot snap;

    std::mutex cmdMutex;
    std::vector<Cmd> cmds;

    // Keyboard (written by the main thread).
    std::atomic<bool> kUp{false}, kDown{false}, kLeft{false}, kRight{false};
    std::atomic<int> kShiftUp{0}, kShiftDown{0}, kAero{0};

    std::mutex settingsMutex;
    Settings settings;
    std::atomic<int> settingsVersion{0};

    std::string telemetryDir;
    bool saveTelemetry = true;

    void push(Cmd c) {
        std::lock_guard<std::mutex> l(cmdMutex);
        cmds.push_back(c);
    }
};

std::string joinPath(const std::string& a, const std::string& b) {
    if (a.empty()) return b;
    const char last = a.back();
    return (last == '/' || last == '\\') ? a + b : a + "/" + b;
}

bool fileExists(const std::string& p) {
    SDL_PathInfo info;
    return SDL_GetPathInfo(p.c_str(), &info);
}

std::string findDataDir(const std::string& cli) {
    if (!cli.empty()) return cli;
    const char* base = SDL_GetBasePath();
    std::vector<std::string> candidates;
    if (base) {
        candidates.push_back(joinPath(base, "data"));
        candidates.push_back(joinPath(base, "../data"));
    }
    candidates.push_back("data");
    candidates.push_back(F1SIM_DATA_DIR);
    for (const auto& c : candidates) {
        if (fileExists(joinPath(c, "cars"))) return c;
    }
    return F1SIM_DATA_DIR;
}

std::string timestamp() {
    const std::time_t t = std::time(nullptr);
    std::tm tmv{};
#if defined(_WIN32)
    localtime_s(&tmv, &t);
#else
    localtime_r(&t, &tmv);
#endif
    char b[32];
    std::strftime(b, sizeof(b), "%Y%m%d_%H%M%S", &tmv);
    return b;
}

// ---------------------------------------------------------------------------
// Physics thread
// ---------------------------------------------------------------------------
void physicsMain(Shared& sh, f1sim::Session& session, InputSystem& input, bool startAutopilot) {
    const f1sim::CarParams& car = session.vehicle().params();
    Settings cfg;
    int cfgVersion = -1;
    f1sim::FfbProcessor ffb;
    f1sim::AIDriver ai(&session.racingLine(), car, 0.96);
    bool paused = false, autopilot = startAutopilot;
    double steerKb = 0.0, throttleKb = 0.0, brakeKb = 0.0;
    double prevWheelAngle = 0.0, wheelVel = 0.0;
    double ffbCmd = 0.0, ffbTestUntil = -1.0;
    std::string message;
    double messageTime = -100.0;
    int overruns = 0;
    const double dt = f1sim::Session::kDt;
    const Uint64 stepNs = 1000000;
    Uint64 start = SDL_GetTicksNS();
    Uint64 steps = 0;
    double hz = 0.0;
    Uint64 hzWindowStart = start, hzSteps = 0;
    double realTime = 0.0;
    ControlState lastCs;

    while (sh.running.load()) {
        const Uint64 now = SDL_GetTicksNS();
        Uint64 due = (now - start) / stepNs;
        if (due > steps + 25) {  // fell behind (debugger, window drag): drop time
            start += (due - steps - 25) * stepNs;
            due = steps + 25;
            ++overruns;
        }
        while (steps < due) {
            ++steps;
            realTime += dt;
            if (sh.settingsVersion.load() != cfgVersion) {
                std::lock_guard<std::mutex> l(sh.settingsMutex);
                const bool reopen = cfg.steer.device != sh.settings.steer.device || cfg.ffbEnabled != sh.settings.ffbEnabled ||
                                    cfgVersion < 0;
                cfg = sh.settings;
                cfgVersion = sh.settingsVersion.load();
                if (reopen) {
                    input.poll();
                    input.openFfbFor(cfg);
                }
            }
            input.poll();
            const ControlState cs = input.read(cfg);
            lastCs = cs;

            // Commands from the UI thread.
            std::vector<Cmd> cmds;
            {
                std::lock_guard<std::mutex> l(sh.cmdMutex);
                cmds.swap(sh.cmds);
            }
            if (cs.reset) cmds.push_back(Cmd::Recover);
            if (cs.ersMode) cmds.push_back(Cmd::CycleErs);
            for (Cmd c : cmds) {
                auto& v = session.vehicle();
                switch (c) {
                    case Cmd::RestartPit: session.resetToStart(); ffb.reset(); message = "RESTART"; messageTime = session.time(); break;
                    case Cmd::Recover: session.recoverToTrack(); ffb.reset(); message = "CAR RECOVERED - LAP INVALID"; messageTime = session.time(); break;
                    case Cmd::TogglePause: paused = !paused; break;
                    case Cmd::ToggleAutopilot: autopilot = !autopilot; break;
                    case Cmd::CycleErs: v.setErsMode(static_cast<f1sim::ErsMode>((static_cast<int>(v.state().pt.ersMode) + 1) % 3)); break;
                    case Cmd::BiasFront: v.setBrakeBias(v.state().brakeBias + 0.005); break;
                    case Cmd::BiasRear: v.setBrakeBias(v.state().brakeBias - 0.005); break;
                    case Cmd::FfbTest: ffbTestUntil = realTime + 1.0; break;
                    case Cmd::ReopenFfb: input.openFfbFor(cfg); break;
                    default: break;
                }
            }

            // FFB self-test works even while paused.
            if (ffbTestUntil > realTime) {
                input.setForce(cfg.ffb.invert ? -0.3 : 0.3);
                continue;
            }
            if (paused) {
                input.setForce(0.0);
                continue;
            }

            // ---- Build driver inputs ----
            f1sim::DriverInputs in;
            const double speed = session.vehicle().state().speed();
            const double lock = car.steering.lock;
            double physicalAngle = 0.0;
            if (cs.wheel) {
                // 1:1 with the real steering wheel; the car clamps at its lock and
                // the soft lock pushes the wheel back.
                physicalAngle = cs.steerNormalized * f1sim::deg2rad(cfg.wheelRotationDeg) * 0.5;
                in.steeringWheelAngle = physicalAngle;
            } else {
                // Keyboard/gamepad assist: less lock at speed, rate limited.
                const double assistLock = lock * f1sim::clamp(18.0 / (18.0 + speed), 0.15, 1.0);
                double target = 0.0;
                if (cs.gamepad && std::fabs(cs.steerNormalized) > 0.0) target = cs.steerNormalized * assistLock;
                if (sh.kLeft.load()) target = assistLock;
                if (sh.kRight.load()) target = -assistLock;
                if (sh.kLeft.load() && sh.kRight.load()) target = 0.0;
                const double rate = cfg.keyboardSteerSpeed * (std::fabs(target) < std::fabs(steerKb) ? 1.6 : 1.0);
                steerKb += f1sim::clamp(target - steerKb, -rate * dt, rate * dt);
                in.steeringWheelAngle = steerKb;
            }
            throttleKb = f1sim::clamp(throttleKb + (sh.kUp.load() ? 6.0 : -8.0) * dt, 0.0, 1.0);
            brakeKb = f1sim::clamp(brakeKb + (sh.kDown.load() ? 6.0 : -10.0) * dt, 0.0, 1.0);
            in.throttle = std::max(cs.throttle, throttleKb);
            in.brake = std::max(cs.brake, brakeKb);
            in.clutch = cs.clutch;
            in.shiftUp = cs.shiftUp || sh.kShiftUp.exchange(0) > 0;
            in.shiftDown = cs.shiftDown || sh.kShiftDown.exchange(0) > 0;
            in.aeroToggle = cs.aero || sh.kAero.exchange(0) > 0;
            if (autopilot) {
                in = ai.update(session.vehicle().state(), dt);
                steerKb = in.steeringWheelAngle;
            }

            const auto ev = session.step(in, ffbCmd);
            if (ev == f1sim::LapTimer::Event::LapCompleted) {
                const auto& t = session.timer();
                char b[96];
                std::snprintf(b, sizeof(b), "LAP %d  %.3f%s%s", t.lapCount(), t.lastLap(), t.lastLapValid() ? "" : "  (INVALID)",
                              t.newBestOnLastLap() ? "  PERSONAL BEST" : "");
                message = b;
                messageTime = session.time();
                if (sh.saveTelemetry && !sh.telemetryDir.empty()) {
                    char name[128];
                    std::snprintf(name, sizeof(name), "lap_%s_%02d_%.3f%s.csv", timestamp().c_str(), t.lapCount(), t.lastLap(),
                                  t.lastLapValid() ? "" : "_invalid");
                    std::string err;
                    if (!session.lastLapTelemetry().saveCsv(joinPath(sh.telemetryDir, name), &err)) SDL_Log("telemetry: %s", err.c_str());
                }
            }

            // ---- Force feedback ----
            const double rawVel = (physicalAngle - prevWheelAngle) / dt;
            prevWheelAngle = physicalAngle;
            wheelVel = f1sim::relaxTowards(wheelVel, rawVel, 2.0 * f1sim::kPi * 40.0, dt);
            const auto out = ffb.process(session.vehicle().state().steeringTorque, physicalAngle, wheelVel, lock, dt, cfg.ffb);
            ffbCmd = out.command;
            const int divider = std::max(1, 1000 / std::max(cfg.ffbRateHz, 50));
            if (cs.wheel && cfg.ffbEnabled && (steps % divider) == 0) input.setForce(autopilot ? 0.0 : ffbCmd);
        }

        // Physics rate measurement.
        const Uint64 t2 = SDL_GetTicksNS();
        if (t2 - hzWindowStart > 500000000ull) {
            hz = static_cast<double>(steps - hzSteps) / ((t2 - hzWindowStart) * 1e-9);
            hzWindowStart = t2;
            hzSteps = steps;
        }

        // Publish.
        {
            const auto& t = session.timer();
            std::lock_guard<std::mutex> l(sh.snapMutex);
            Snapshot& s = sh.snap;
            s.car = session.vehicle().state();
            s.simTime = session.time();
            s.carS = session.carS();
            s.timing = t.timing();
            s.currentLap = t.currentLapTime(session.time());
            s.lastLap = t.lastLap();
            s.bestLap = t.bestLap();
            s.delta = t.delta();
            s.deltaValid = !std::isnan(t.delta());
            s.lapValid = t.currentLapValid();
            s.lastLapValid = t.lastLapValid();
            s.lapCount = t.lapCount();
            s.sector = t.sector();
            s.lastSectors = t.lastSectors();
            s.bestSectors = t.bestSectors();
            s.currentSectors = t.currentSectors();
            s.ffbCommand = ffbCmd;
            s.ffbClipping = ffb.clippingRatio();
            s.ffbActive = !input.ffbDevice().empty() && cfg.ffbEnabled;
            s.paused = paused;
            s.autopilot = autopilot;
            s.physicsHz = hz;
            s.overruns = overruns;
            s.message = message;
            s.messageTime = messageTime;
            s.wheelActive = lastCs.wheel;
            s.gamepadActive = lastCs.gamepad;
        }

        const Uint64 next = start + (steps + 1) * stepNs;
        const Uint64 cur = SDL_GetTicksNS();
        if (next > cur) SDL_DelayPrecise(next - cur);
    }
    input.stopForce();
    input.shutdown();
}

}  // namespace

int main(int argc, char** argv) {
    std::string dataArg, screenshotPath;
    int screenshotFrames = 240;
    int cameraArg = -1;
    bool demo = false, allApps = false;
    for (int i = 1; i < argc; ++i) {
        if (!std::strcmp(argv[i], "--data") && i + 1 < argc) dataArg = argv[++i];
        else if (!std::strcmp(argv[i], "--demo")) demo = true;
        else if (!std::strcmp(argv[i], "--screenshot") && i + 1 < argc) screenshotPath = argv[++i];
        else if (!std::strcmp(argv[i], "--frames") && i + 1 < argc) screenshotFrames = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--camera") && i + 1 < argc) cameraArg = std::atoi(argv[++i]);
        else if (!std::strcmp(argv[i], "--all-apps")) allApps = true;
    }

    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_JOYSTICK | SDL_INIT_HAPTIC | SDL_INIT_GAMEPAD)) {
        std::fprintf(stderr, "SDL_Init failed: %s\n", SDL_GetError());
        return 1;
    }
    // Joysticks are polled by the physics thread only.
    SDL_SetJoystickEventsEnabled(false);
    SDL_SetGamepadEventsEnabled(false);

    Shared sh;
    const std::string dataDir = findDataDir(dataArg);
    const char* base = SDL_GetBasePath();
    const std::string userDir = base ? base : "./";
    const std::string configDir = joinPath(userDir, "config");
    SDL_CreateDirectory(configDir.c_str());
    sh.telemetryDir = joinPath(userDir, "telemetry");
    SDL_CreateDirectory(sh.telemetryDir.c_str());
    const std::string settingsPath = joinPath(configDir, "settings.ini");
    {
        std::string err;
        if (!fileExists(settingsPath) || !sh.settings.load(settingsPath, &err)) {
            if (!err.empty()) SDL_Log("settings: %s (using defaults)", err.c_str());
            sh.settings.save(settingsPath);
        }
    }
    if (cameraArg >= 0) sh.settings.camera = cameraArg;
    if (allApps) {
        for (auto& [id, v] : sh.settings.apps) v[0] = '1';
        for (int i = 0; i < kAppCount; ++i) {
            if (!sh.settings.apps.count(kAppIds[i])) sh.settings.apps[kAppIds[i]] = "1,-1,-1";
        }
    }
    sh.saveTelemetry = sh.settings.saveTelemetry;

    const bool interactive = screenshotPath.empty();
    auto fatal = [interactive](const std::string& msg) {
        SDL_Log("%s", msg.c_str());
        // A dialog would block automated runs (screenshots, CI).
        if (interactive) SDL_ShowSimpleMessageBox(SDL_MESSAGEBOX_ERROR, "f1sim", msg.c_str(), nullptr);
        return 1;
    };

    f1sim::CarParams car;
    std::string err;
    std::vector<std::string> warnings;
    if (!f1sim::CarParams::load(joinPath(dataDir, sh.settings.carFile), &car, &err, &warnings)) return fatal("Car data: " + err);
    for (const auto& w : warnings) SDL_Log("car data warning: %s", w.c_str());
    f1sim::Track track;
    if (!f1sim::Track::load(joinPath(dataDir, sh.settings.trackFile), &track, &err)) return fatal("Track data: " + err);

    // ---- Window and OpenGL ----
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    if (sh.settings.msaa > 1) {
        SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 1);
        SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, sh.settings.msaa);
    }
    SDL_WindowFlags flags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY;
    if (sh.settings.fullscreen) flags |= SDL_WINDOW_FULLSCREEN;
    SDL_Window* window = SDL_CreateWindow("f1sim - AI LAB", sh.settings.windowWidth, sh.settings.windowHeight, flags);
    if (!window && sh.settings.msaa > 1) {  // retry without MSAA
        SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 0);
        SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 0);
        window = SDL_CreateWindow("f1sim - AI LAB", sh.settings.windowWidth, sh.settings.windowHeight, flags);
    }
    if (!window) return fatal(std::string("Cannot create window: ") + SDL_GetError());
    SDL_GLContext ctx = SDL_GL_CreateContext(window);
    if (!ctx) return fatal(std::string("OpenGL 3.3 is required: ") + SDL_GetError());
    SDL_GL_MakeCurrent(window, ctx);
    if (!gl::load()) return fatal("Your graphics driver does not provide OpenGL 3.3.");
    SDL_GL_SetSwapInterval(sh.settings.vsync && screenshotPath.empty() ? 1 : 0);
    if (sh.settings.msaa > 1) gl::Enable(0x809D /* GL_MULTISAMPLE */);
    SDL_Log("OpenGL: %s / %s", reinterpret_cast<const char*>(gl::GetString(GL_RENDERER)),
            reinterpret_cast<const char*>(gl::GetString(GL_VERSION)));

    f1sim::Session session(car, std::move(track));
    session.vehicle().setAmbient(sh.settings.airTempC, sh.settings.trackTempC);
    if (demo || !screenshotPath.empty()) {
        // Rolling start on the racing line so the demo is immediately at speed.
        const auto& line = session.racingLine();
        const size_t idx = line.nearest(session.track().positionAt(session.track().wrapS(-200.0), 0.0));
        session.resetRolling(line.speed[idx] * 0.9, 200.0, line.offset[idx]);
    }

    Renderer renderer;
    if (!renderer.init(session.track(), car, session.racingLine(), dataDir, sh.settings.carModelFile, &err)) return fatal(err);
    Hud hud;
    if (!hud.init(&err)) return fatal(err);

    InputSystem input;
    std::thread physics(physicsMain, std::ref(sh), std::ref(session), std::ref(input), demo || !screenshotPath.empty());

    bool showHelp = false, showSetup = false, sidebarPinned = false, sidebarOpen = false;
    MouseState mouse;
    Uint64 lastMouseMove = 0;
    Uint64 last = SDL_GetTicksNS();
    float fps = 0.0f;
    int frame = 0;
    bool quit = false;
    auto changeSettings = [&](auto&& fn) {
        std::lock_guard<std::mutex> l(sh.settingsMutex);
        fn(sh.settings);
        sh.settings.save(settingsPath);
        sh.settingsVersion.fetch_add(1);
    };

    while (!quit) {
        SDL_Event e;
        mouse.pressed = mouse.released = false;
        while (SDL_PollEvent(&e)) {
            if (e.type == SDL_EVENT_QUIT) quit = true;
            if (e.type == SDL_EVENT_MOUSE_MOTION) {
                float scale = SDL_GetWindowPixelDensity(window);
                mouse.x = e.motion.x * scale;
                mouse.y = e.motion.y * scale;
                lastMouseMove = SDL_GetTicks();
            }
            if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN && e.button.button == SDL_BUTTON_LEFT) {
                mouse.down = true;
                mouse.pressed = true;
            }
            if (e.type == SDL_EVENT_MOUSE_BUTTON_UP && e.button.button == SDL_BUTTON_LEFT) {
                mouse.down = false;
                mouse.released = true;
            }
            if (e.type == SDL_EVENT_KEY_DOWN || e.type == SDL_EVENT_KEY_UP) {
                const bool down = e.type == SDL_EVENT_KEY_DOWN;
                const SDL_Keycode k = e.key.key;
                if (k == SDLK_UP) sh.kUp = down;
                if (k == SDLK_DOWN) sh.kDown = down;
                if (k == SDLK_LEFT) sh.kLeft = down;
                if (k == SDLK_RIGHT) sh.kRight = down;
                if (!down || e.key.repeat) continue;
                bool paused;
                {
                    std::lock_guard<std::mutex> l(sh.snapMutex);
                    paused = sh.snap.paused;
                }
                if (showSetup) {
                    // Controller setup screen.
                    const BindTarget targets[] = {BindTarget::Steer, BindTarget::Throttle, BindTarget::Brake,
                                                  BindTarget::Clutch, BindTarget::ShiftUp, BindTarget::ShiftDown,
                                                  BindTarget::Aero, BindTarget::Reset, BindTarget::ErsMode};
                    if (k >= SDLK_1 && k <= SDLK_9) input.requestBind(targets[k - SDLK_1]);
                    else if (k == SDLK_ESCAPE && input.activeBind() != BindTarget::None) input.cancelBind();
                    else if (k == SDLK_F2 || k == SDLK_ESCAPE) showSetup = false;
                    else if (k == SDLK_COMMA) changeSettings([](Settings& s) { s.wheelRotationDeg = std::max(180.0, s.wheelRotationDeg - 30.0); });
                    else if (k == SDLK_PERIOD) changeSettings([](Settings& s) { s.wheelRotationDeg = std::min(2520.0, s.wheelRotationDeg + 30.0); });
                    else if (k == SDLK_B) changeSettings([](Settings& s) { s.brakeGamma = s.brakeGamma >= 2.4 ? 1.0 : s.brakeGamma + 0.2; });
                    else if (k == SDLK_G) changeSettings([](Settings& s) { s.ffb.gain = std::max(0.0, s.ffb.gain - 0.05); });
                    else if (k == SDLK_H) changeSettings([](Settings& s) { s.ffb.gain = std::min(3.0, s.ffb.gain + 0.05); });
                    else if (k == SDLK_M) changeSettings([](Settings& s) { s.ffb.deviceMaxTorque = std::max(1.0, s.ffb.deviceMaxTorque - 0.5); });
                    else if (k == SDLK_N) changeSettings([](Settings& s) { s.ffb.deviceMaxTorque = std::min(40.0, s.ffb.deviceMaxTorque + 0.5); });
                    else if (k == SDLK_K) changeSettings([](Settings& s) { s.ffb.carTorqueScale = std::max(0.05, s.ffb.carTorqueScale - 0.05); });
                    else if (k == SDLK_L) changeSettings([](Settings& s) { s.ffb.carTorqueScale = std::min(2.0, s.ffb.carTorqueScale + 0.05); });
                    else if (k == SDLK_D) changeSettings([](Settings& s) { s.ffb.damping = s.ffb.damping >= 0.1 ? 0.0 : s.ffb.damping + 0.01; });
                    else if (k == SDLK_F) changeSettings([](Settings& s) { s.ffb.filterHz = s.ffb.filterHz >= 240 ? 0.0 : s.ffb.filterHz + 40.0; });
                    else if (k == SDLK_I) changeSettings([](Settings& s) { s.ffb.invert = !s.ffb.invert; });
                    else if (k == SDLK_O) changeSettings([](Settings& s) { s.ffbEnabled = !s.ffbEnabled; });
                    else if (k == SDLK_T) sh.push(Cmd::FfbTest);
                    continue;
                }
                if (paused && k == SDLK_Q) quit = true;
                else if ((k == SDLK_ESCAPE && !showHelp) || k == SDLK_P) sh.push(Cmd::TogglePause);
                else if (k == SDLK_F1) showHelp = !showHelp;
                else if (k == SDLK_ESCAPE && showHelp) showHelp = false;
                else if (k == SDLK_F2) {
                    showSetup = true;
                    if (!paused) sh.push(Cmd::TogglePause);  // do not drive while configuring
                }
                else if (k == SDLK_F3) sidebarPinned = !sidebarPinned;
                else if (k == SDLK_V) changeSettings([](Settings& s) {
                    const int n = static_cast<int>(CameraMode::Count);
                    s.camera = (s.camera + n - 1) % n;
                });
                else if (k == SDLK_F5) sh.push(Cmd::ToggleAutopilot);
                else if (k == SDLK_A || k == SDLK_LSHIFT) sh.kShiftUp.fetch_add(1);
                else if (k == SDLK_Z || k == SDLK_LCTRL || k == SDLK_Y) sh.kShiftDown.fetch_add(1);
                else if (k == SDLK_SPACE) sh.kAero.fetch_add(1);
                else if (k == SDLK_E) sh.push(Cmd::CycleErs);
                else if (k == SDLK_LEFTBRACKET) sh.push(Cmd::BiasRear);
                else if (k == SDLK_RIGHTBRACKET) sh.push(Cmd::BiasFront);
                else if (k == SDLK_R) sh.push(Cmd::RestartPit);
                else if (k == SDLK_BACKSPACE) sh.push(Cmd::Recover);
                else if (k == SDLK_C) changeSettings([](Settings& s) { s.camera = (s.camera + 1) % static_cast<int>(CameraMode::Count); });
                else if (k == SDLK_MINUS) changeSettings([](Settings& s) { s.fovDeg = std::max(25.0, s.fovDeg - 2.0); });
                else if (k == SDLK_EQUALS) changeSettings([](Settings& s) { s.fovDeg = std::min(110.0, s.fovDeg + 2.0); });
            }
        }

        // Apply finished controller bindings.
        if (auto r = input.takeBindResult()) {
            changeSettings([&](Settings& s) {
                switch (r->target) {
                    case BindTarget::Steer: s.steer = r->axis; s.steer.full = r->axis.full; break;
                    case BindTarget::Throttle: s.throttle = r->axis; break;
                    case BindTarget::Brake: s.brake = r->axis; break;
                    case BindTarget::Clutch: s.clutch = r->axis; break;
                    case BindTarget::ShiftUp: s.shiftUp = r->button; break;
                    case BindTarget::ShiftDown: s.shiftDown = r->button; break;
                    case BindTarget::Aero: s.aero = r->button; break;
                    case BindTarget::Reset: s.reset = r->button; break;
                    case BindTarget::ErsMode: s.ersMode = r->button; break;
                    default: break;
                }
            });
            if (r->target == BindTarget::Steer) sh.push(Cmd::ReopenFfb);
        }

        const Uint64 now = SDL_GetTicksNS();
        const float dt = static_cast<float>((now - last) * 1e-9);
        last = now;
        fps = fps * 0.95f + (dt > 0 ? 1.0f / dt : 0.0f) * 0.05f;

        Snapshot snap;
        {
            std::lock_guard<std::mutex> l(sh.snapMutex);
            snap = sh.snap;
        }
        Settings settingsCopy;
        {
            std::lock_guard<std::mutex> l(sh.settingsMutex);
            settingsCopy = sh.settings;
        }
        int w = 0, h = 0;
        SDL_GetWindowSizeInPixels(window, &w, &h);
        const auto cam = static_cast<CameraMode>(settingsCopy.camera % static_cast<int>(CameraMode::Count));
        renderer.render(snap, w, h, cam, static_cast<float>(settingsCopy.fovDeg), dt);

        // Apps sidebar: pinned with F3, or while the mouse rests at the right edge.
        if (mouse.x >= w - 6 && SDL_GetTicks() - lastMouseMove < 3000) sidebarOpen = true;
        if (sidebarOpen && mouse.x < w - 250) sidebarOpen = false;

        HudContext hc;
        hc.snap = &snap;
        hc.settings = &settingsCopy;
        hc.car = &car;
        hc.track = &session.track();
        hc.trackName = session.track().name();
        hc.cameraName = cameraName(cam);
        hc.modelStatus = renderer.modelStatus();
        hc.ffbDevice = input.ffbDevice();
        hc.showHelp = showHelp;
        hc.showSetup = showSetup;
        hc.showSidebar = sidebarPinned || sidebarOpen;
        hc.binding = input.activeBind();
        if (showSetup) hc.devices = input.devices();
        hc.fps = fps;
        const HudResult hr = hud.draw(hc, mouse, w, h);
        if (hr.layoutChanged) changeSettings([&](Settings& s) { hud.storeLayout(&s); });
        switch (hr.action) {
            case MenuAction::Resume: sh.push(Cmd::TogglePause); break;
            case MenuAction::Restart: sh.push(Cmd::RestartPit); sh.push(Cmd::TogglePause); break;
            case MenuAction::Controls: showSetup = true; break;
            case MenuAction::Help: showHelp = true; break;
            case MenuAction::Quit: quit = true; break;
            default: break;
        }
        // Hide the cursor while driving; show it when the mouse is used.
        if (SDL_GetTicks() - lastMouseMove > 3000 && !snap.paused && !showSetup && !hc.showSidebar) SDL_HideCursor();
        else SDL_ShowCursor();

        ++frame;
        if (!screenshotPath.empty() && frame >= screenshotFrames) {
            std::vector<unsigned char> px(static_cast<size_t>(w) * h * 3);
            gl::PixelStorei(GL_PACK_ALIGNMENT, 1);
            gl::ReadPixels(0, 0, w, h, GL_RGB, GL_UNSIGNED_BYTE, px.data());
            stbi_flip_vertically_on_write(1);
            if (!stbi_write_png(screenshotPath.c_str(), w, h, 3, px.data(), w * 3)) SDL_Log("screenshot failed");
            else SDL_Log("screenshot saved: %s", screenshotPath.c_str());
            quit = true;
        }
        SDL_GL_SwapWindow(window);
        if (!screenshotPath.empty()) SDL_Delay(1);
    }

    sh.running = false;
    physics.join();
    {
        std::lock_guard<std::mutex> l(sh.settingsMutex);
        sh.settings.save(settingsPath);
    }
    hud.shutdown();
    renderer.shutdown();
    SDL_GL_DestroyContext(ctx);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
