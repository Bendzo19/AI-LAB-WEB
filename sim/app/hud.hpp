// 2D overlay in the style of sim-racing "apps": independent windows that
// can be toggled from a sidebar (right screen edge or F3) and dragged by
// their title bar. Layout is persisted in settings.ini [apps].
// Also draws the pause menu, help and the controller setup screen.
#pragma once

#include <deque>
#include <string>
#include <vector>

#include "f1sim/track.hpp"
#include "gl.hpp"
#include "input.hpp"
#include "settings.hpp"
#include "snapshot.hpp"

namespace app {

struct HudContext {
    const Snapshot* snap = nullptr;
    const Settings* settings = nullptr;
    const f1sim::CarParams* car = nullptr;
    const f1sim::Track* track = nullptr;
    std::string trackName, cameraName, modelStatus, ffbDevice;
    std::vector<DeviceSnapshot> devices;
    BindTarget binding = BindTarget::None;
    bool showHelp = false, showSetup = false, showSidebar = false;
    float fps = 0.0f;
};

struct MouseState {
    float x = -1, y = -1;
    bool down = false, pressed = false, released = false;
};

enum class MenuAction { None, Resume, Restart, Controls, Help, Quit };

struct HudResult {
    MenuAction action = MenuAction::None;
    bool layoutChanged = false;   // apps toggled or moved: save settings
    bool mouseOverUi = false;
};

class Hud {
public:
    bool init(std::string* error);
    // Updates the app layout from settings (call once and after loading).
    void loadLayout(const Settings& s, int width, int height);
    void storeLayout(Settings* s) const;
    HudResult draw(const HudContext& ctx, const MouseState& mouse, int width, int height);
    void shutdown();

private:
    struct App {
        std::string id, title;
        float x = 0, y = 0, w = 200, h = 100;
        bool visible = false;
    };
    void rect(float x, float y, float w, float h, const float c[4]);
    void line(float x0, float y0, float x1, float y1, float thickness, const float c[4]);
    void text(float x, float y, const std::string& s, float scale, const float c[4]);
    float textWidth(const std::string& s, float scale) const;
    bool button(float x, float y, float w, float h, const std::string& label, const MouseState& m, bool active = false);
    void flush(int width, int height);
    void recordHistory(const Snapshot& s);

    void appTiming(const HudContext& c, float x, float y);
    void appDashboard(const HudContext& c, float x, float y);
    void appTyres(const HudContext& c, float x, float y);
    void appEnergy(const HudContext& c, float x, float y);
    void appInputs(const HudContext& c, float x, float y);
    void appDelta(const HudContext& c, float x, float y);
    void appGMeter(const HudContext& c, float x, float y);
    void appTelemetry(const HudContext& c, float x, float y);
    void appMap(const HudContext& c, float x, float y);
    void appChassis(const HudContext& c, float x, float y);
    void appSession(const HudContext& c, float x, float y);
    void drawApp(App& a, const HudContext& c);

    void drawPauseMenu(const HudContext& c, const MouseState& m, int w, int h, HudResult* r);
    void drawSidebar(const MouseState& m, int w, int h, HudResult* r);
    void drawHelp(const HudContext& c, int w, int h);
    void drawSetup(const HudContext& c, int w, int h);

    struct V { float x, y; float r, g, b, a; };
    std::vector<V> verts_;
    GLuint prog_ = 0, vao_ = 0, vbo_ = 0;
    GLint uProj_ = -1;
    std::vector<char> fontBuf_;

    std::vector<App> apps_;
    int dragging_ = -1;
    float dragDx_ = 0, dragDy_ = 0;

    // Live history for the telemetry graph and g-meter (render-rate samples).
    struct Sample { double t, speed, throttle, brake, steer, ffb, gLat, gLong; };
    std::deque<Sample> history_;
    double lastSampleTime_ = -1.0;
};

}  // namespace app
