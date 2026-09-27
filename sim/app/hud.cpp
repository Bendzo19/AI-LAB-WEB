#include "hud.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <sstream>

#include "mathx.hpp"

int f1sim_easy_font_print(float x, float y, const char* text, unsigned char color[4], void* buffer, int size);
int f1sim_easy_font_width(const char* text);

namespace app {
namespace {

const char* kVs = R"(#version 330 core
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
uniform mat4 uProj;
out vec4 vColor;
void main() { vColor = aColor; gl_Position = uProj * vec4(aPos, 0.0, 1.0); }
)";
const char* kFs = R"(#version 330 core
in vec4 vColor;
out vec4 frag;
void main() { frag = vColor; }
)";

const float kBg[4] = {0.05f, 0.05f, 0.08f, 0.72f};
const float kInk[4] = {0.05f, 0.05f, 0.08f, 1.0f};
const float kTitle[4] = {0.10f, 0.09f, 0.18f, 0.85f};
const float kWhiteC[4] = {0.95f, 0.95f, 0.97f, 1.0f};
const float kGrey[4] = {0.62f, 0.62f, 0.68f, 1.0f};
const float kDim[4] = {0.25f, 0.25f, 0.3f, 0.9f};
const float kGrid[4] = {0.35f, 0.35f, 0.42f, 0.5f};
const float kGreen[4] = {0.2f, 0.85f, 0.35f, 1.0f};
const float kRed[4] = {0.95f, 0.22f, 0.2f, 1.0f};
const float kYellow[4] = {0.98f, 0.82f, 0.2f, 1.0f};
const float kPurple[4] = {0.66f, 0.45f, 1.0f, 1.0f};
const float kBlue[4] = {0.3f, 0.6f, 1.0f, 1.0f};
const float kBrand[4] = {0.545f, 0.486f, 1.0f, 1.0f};
constexpr float kTitleH = 18.0f;

std::string fmtLap(double t) {
    if (t <= 0.0) return "--:--.---";
    const int m = static_cast<int>(t / 60.0);
    char b[32];
    std::snprintf(b, sizeof(b), "%d:%06.3f", m, t - 60.0 * m);
    return b;
}
std::string fmt(const char* f, double v) {
    char b[64];
    std::snprintf(b, sizeof(b), f, v);
    return b;
}
// Blue (cold) -> green (window) -> red (hot).
void tempColor(double t, double lo, double opt, double hi, float out[4]) {
    const float* a = t < opt ? kBlue : kGreen;
    const float* b = t < opt ? kGreen : kRed;
    const float k = float(t < opt ? f1sim::clamp((t - lo) / (opt - lo), 0.0, 1.0) : f1sim::clamp((t - opt) / (hi - opt), 0.0, 1.0));
    for (int i = 0; i < 3; ++i) out[i] = a[i] + (b[i] - a[i]) * k;
    out[3] = 1.0f;
}

struct AppDef { const char* id; const char* title; float w, h; bool defaultOn; };
const AppDef kApps[] = {
    {"timing", "TIMING", 330, 178, true},     {"dashboard", "DASHBOARD", 560, 150, true},
    {"tyres", "TYRES & BRAKES", 270, 180, true}, {"energy", "ERS & FUEL", 310, 104, true},
    {"inputs", "INPUTS & FFB", 330, 132, true}, {"delta", "DELTA", 420, 40, true},
    {"gmeter", "G-METER", 200, 214, false},    {"telemetry", "LIVE TELEMETRY", 480, 240, false},
    {"map", "TRACK MAP", 280, 280, false},     {"chassis", "CHASSIS & AERO", 300, 200, false},
    {"session", "SESSION", 270, 118, false},
};

}  // namespace

bool Hud::init(std::string* error) {
    auto compile = [&](GLenum type, const char* src) -> GLuint {
        const GLuint s = gl::CreateShader(type);
        gl::ShaderSource(s, 1, &src, nullptr);
        gl::CompileShader(s);
        GLint ok = 0;
        gl::GetShaderiv(s, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            char log[1024];
            gl::GetShaderInfoLog(s, sizeof(log), nullptr, log);
            if (error) *error = std::string("HUD shader: ") + log;
            return 0;
        }
        return s;
    };
    const GLuint v = compile(GL_VERTEX_SHADER, kVs), f = compile(GL_FRAGMENT_SHADER, kFs);
    if (!v || !f) return false;
    prog_ = gl::CreateProgram();
    gl::AttachShader(prog_, v);
    gl::AttachShader(prog_, f);
    gl::LinkProgram(prog_);
    gl::DeleteShader(v);
    gl::DeleteShader(f);
    uProj_ = gl::GetUniformLocation(prog_, "uProj");
    gl::GenVertexArrays(1, &vao_);
    gl::GenBuffers(1, &vbo_);
    gl::BindVertexArray(vao_);
    gl::BindBuffer(GL_ARRAY_BUFFER, vbo_);
    gl::EnableVertexAttribArray(0);
    gl::VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(V), nullptr);
    gl::EnableVertexAttribArray(1);
    gl::VertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, sizeof(V), reinterpret_cast<void*>(2 * sizeof(float)));
    gl::BindVertexArray(0);
    fontBuf_.resize(1 << 16);
    return true;
}

void Hud::shutdown() {
    if (vbo_) gl::DeleteBuffers(1, &vbo_);
    if (vao_) gl::DeleteVertexArrays(1, &vao_);
    if (prog_) gl::DeleteProgram(prog_);
    vbo_ = vao_ = prog_ = 0;
}

void Hud::loadLayout(const Settings& s, int w, int h) {
    apps_.clear();
    for (const auto& d : kApps) {
        App a;
        a.id = d.id;
        a.title = d.title;
        a.w = d.w;
        a.h = d.h + kTitleH;
        a.visible = d.defaultOn;
        // Default layout (sim-racing style): timing top-left, tyres top-right,
        // dashboard bottom-centre, inputs bottom-left, delta top-centre.
        const std::string id = d.id;
        if (id == "timing") { a.x = 18; a.y = 18; }
        else if (id == "tyres") { a.x = w - a.w - 18; a.y = 18; }
        else if (id == "energy") { a.x = w - a.w - 18; a.y = 18 + 198 + 8; }
        else if (id == "dashboard") { a.x = (w - a.w) * 0.5f; a.y = h - a.h - 18; }
        else if (id == "inputs") { a.x = 18; a.y = h - a.h - 18; }
        else if (id == "delta") { a.x = (w - a.w) * 0.5f; a.y = 18; }
        else if (id == "gmeter") { a.x = w - a.w - 18; a.y = h - a.h - 18; }
        else if (id == "telemetry") { a.x = 18; a.y = 220; }
        else if (id == "map") { a.x = w - a.w - 18; a.y = 360; }
        else if (id == "chassis") { a.x = w - a.w - 300; a.y = 18; }
        else { a.x = 360; a.y = 18; }
        const auto it = s.apps.find(id);
        if (it != s.apps.end()) {
            std::stringstream ss(it->second);
            std::string vis, xs, ys;
            if (std::getline(ss, vis, ',') && std::getline(ss, xs, ',') && std::getline(ss, ys, ',')) {
                a.visible = vis == "1";
                const float px = std::strtof(xs.c_str(), nullptr), py = std::strtof(ys.c_str(), nullptr);
                if (px >= 0.0f && py >= 0.0f) {  // negative = keep the default position
                    a.x = px;
                    a.y = py;
                }
            }
        }
        apps_.push_back(a);
    }
}

void Hud::storeLayout(Settings* s) const {
    for (const auto& a : apps_) {
        char b[64];
        std::snprintf(b, sizeof(b), "%d,%.0f,%.0f", a.visible ? 1 : 0, a.x, a.y);
        s->apps[a.id] = b;
    }
}

// ---- primitives ---------------------------------------------------------------

void Hud::rect(float x, float y, float w, float h, const float c[4]) {
    const V a{x, y, c[0], c[1], c[2], c[3]}, b{x + w, y, c[0], c[1], c[2], c[3]}, d{x + w, y + h, c[0], c[1], c[2], c[3]},
            e{x, y + h, c[0], c[1], c[2], c[3]};
    verts_.insert(verts_.end(), {a, b, d, a, d, e});
}

void Hud::line(float x0, float y0, float x1, float y1, float t, const float c[4]) {
    const float dx = x1 - x0, dy = y1 - y0;
    const float len = std::sqrt(dx * dx + dy * dy);
    if (len < 1e-4f) return;
    const float nx = -dy / len * t * 0.5f, ny = dx / len * t * 0.5f;
    const V a{x0 + nx, y0 + ny, c[0], c[1], c[2], c[3]}, b{x1 + nx, y1 + ny, c[0], c[1], c[2], c[3]},
            d{x1 - nx, y1 - ny, c[0], c[1], c[2], c[3]}, e{x0 - nx, y0 - ny, c[0], c[1], c[2], c[3]};
    verts_.insert(verts_.end(), {a, b, d, a, d, e});
}

void Hud::text(float x, float y, const std::string& s, float scale, const float c[4]) {
    unsigned char col[4] = {255, 255, 255, 255};
    const int quads = f1sim_easy_font_print(0, 0, s.c_str(), col, fontBuf_.data(), static_cast<int>(fontBuf_.size()));
    struct FV { float x, y, z; unsigned char c[4]; };
    const auto* fv = reinterpret_cast<const FV*>(fontBuf_.data());
    for (int q = 0; q < quads; ++q) {
        V vv[4];
        for (int k = 0; k < 4; ++k) {
            const FV& p = fv[q * 4 + k];
            vv[k] = {x + p.x * scale, y + p.y * scale, c[0], c[1], c[2], c[3]};
        }
        verts_.insert(verts_.end(), {vv[0], vv[1], vv[2], vv[0], vv[2], vv[3]});
    }
}

float Hud::textWidth(const std::string& s, float scale) const {
    return static_cast<float>(f1sim_easy_font_width(s.c_str())) * scale;
}

bool Hud::button(float x, float y, float w, float h, const std::string& label, const MouseState& m, bool active) {
    const bool hover = m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
    const float bg[4] = {hover ? 0.32f : 0.14f, hover ? 0.28f : 0.13f, hover ? 0.6f : 0.22f, 0.92f};
    rect(x, y, w, h, bg);
    if (active) rect(x, y, 4, h, kBrand);
    text(x + 14, y + (h - 14) * 0.5f, label, 2.0f, active ? kWhiteC : kGrey);
    return hover && m.pressed;
}

void Hud::flush(int width, int height) {
    if (verts_.empty()) return;
    gl::UseProgram(prog_);
    const Mat4 proj = Mat4::ortho(0.0f, float(width), float(height), 0.0f, -1.0f, 1.0f);
    gl::UniformMatrix4fv(uProj_, 1, GL_FALSE, proj.m);
    gl::BindVertexArray(vao_);
    gl::BindBuffer(GL_ARRAY_BUFFER, vbo_);
    gl::BufferData(GL_ARRAY_BUFFER, static_cast<GLsizeiptr>(verts_.size() * sizeof(V)), verts_.data(), GL_STREAM_DRAW);
    gl::DrawArrays(GL_TRIANGLES, 0, static_cast<GLsizei>(verts_.size()));
    gl::BindVertexArray(0);
    verts_.clear();
}

void Hud::recordHistory(const Snapshot& s) {
    if (s.simTime < lastSampleTime_) history_.clear();  // session restarted
    if (s.simTime - lastSampleTime_ < 1.0 / 60.0) return;
    lastSampleTime_ = s.simTime;
    const auto g = s.car.gForce();
    history_.push_back({s.simTime, s.car.speed() * 3.6, s.car.throttle, s.car.brake,
                        s.car.steeringWheelAngle / f1sim::kPi, s.ffbCommand, g.y, g.x});
    while (!history_.empty() && s.simTime - history_.front().t > 12.0) history_.pop_front();
}

// ---- apps ------------------------------------------------------------------------------

void Hud::appTiming(const HudContext& c, float x, float y) {
    const auto& s = *c.snap;
    text(x + 14, y + 8, c.trackName, 2.0f, kBrand);
    if (!s.timing) {
        text(x + 14, y + 34, "OUT LAP", 3.0f, kYellow);
    } else {
        text(x + 14, y + 34, "LAP " + std::to_string(s.lapCount + 1), 3.0f, kWhiteC);
        text(x + 130, y + 34, fmtLap(s.currentLap), 3.0f, s.lapValid ? kWhiteC : kRed);
        if (!s.lapValid) text(x + 14, y + 62, "INVALID - TRACK LIMITS", 2.0f, kRed);
    }
    text(x + 14, y + 86, "LAST", 2.0f, kGrey);
    text(x + 90, y + 84, fmtLap(s.lastLap), 2.5f, s.lastLapValid ? kWhiteC : kRed);
    text(x + 14, y + 114, "BEST", 2.0f, kGrey);
    text(x + 90, y + 112, fmtLap(s.bestLap), 2.5f, kPurple);
    for (int i = 0; i < 3; ++i) {
        const double cur = s.timing && i < s.sector ? s.currentSectors[i] : s.lastSectors[i];
        const float* col = kGrey;
        if (cur > 0.0 && s.bestSectors[i] > 0.0) col = cur <= s.bestSectors[i] + 1e-6 ? kPurple : kYellow;
        text(x + 14 + i * 104.0f, y + 148, "S" + std::to_string(i + 1), 2.0f, kGrey);
        text(x + 44 + i * 104.0f, y + 148, cur > 0.0 ? fmt("%.2f", cur) : "--", 2.0f, col);
    }
}

void Hud::appDashboard(const HudContext& c, float x, float y) {
    const auto& s = *c.snap;
    const auto& car = s.car;
    const float pw = 560.0f;
    const double limit = c.car->powertrain.revLimit;
    const double rpm = car.rpm();
    for (int i = 0; i < 15; ++i) {
        const double on = limit - 2600.0 + i * 170.0;
        const float* col = i < 5 ? kGreen : (i < 10 ? kRed : kPurple);
        const bool lit = rpm >= on || (car.pt.revLimiter && (static_cast<int>(s.simTime * 10) % 2 == 0));
        rect(x + 20 + i * 35.0f, y + 10, 28, 10, lit ? col : kDim);
    }
    const int g = car.pt.gear;
    const std::string gear = g < 0 ? "R" : (g == 0 ? "N" : std::to_string(g));
    text(x + pw * 0.5f - textWidth(gear, 7.0f) * 0.5f, y + 32, gear, 7.0f, car.pt.shiftRefused ? kRed : kWhiteC);
    text(x + 40, y + 42, fmt("%.0f", car.speed() * 3.6), 5.0f, kWhiteC);
    text(x + 40, y + 88, "KM/H", 2.0f, kGrey);
    text(x + 40, y + 112, fmt("%5.0f RPM", rpm), 2.0f, kGrey);
    const float dx = x + pw - 190;
    const auto& aero = c.car->aero;
    const bool xMode = car.aeroMode > 0.5;
    // Zone-limited systems (DRS) show when they may be opened.
    const bool available = !xMode && aero.straightModeZonesOnly && car.aeroZone;
    const std::string label = xMode ? aero.straightModeLabel : (available ? aero.straightModeLabel.substr(0, 3) + " AVAILABLE" : aero.cornerModeLabel);
    rect(dx, y + 36, 170, 44, xMode ? kGreen : (available ? kYellow : kDim));
    const float ls = textWidth(label, 3.0f) > 150 ? 2.0f : 3.0f;
    text(dx + 12, y + (ls > 2.5f ? 48 : 52), label, ls, xMode ? kWhiteC : (available ? kInk : kGrey));
    text(dx, y + 92, fmt("BIAS %.1f%%", car.brakeBias * 100.0), 2.0f, kGrey);
    text(dx, y + 112, std::string("ERS ") + f1sim::ersModeName(car.pt.ersMode), 2.0f, kBrand);
    text(dx, y + 130, s.autopilot ? "AUTOPILOT" : "", 2.0f, kYellow);
}

void Hud::appTyres(const HudContext& c, float x, float y) {
    const auto& car = c.snap->car;
    const auto& tp = c.car->front.tyre;
    text(x + 14, y + 6, "SURFACE/CARCASS C, BRAKE C", 1.6f, kGrey);
    const char* names[4] = {"FL", "FR", "RL", "RR"};
    for (int i = 0; i < 4; ++i) {
        const auto& wh = car.wheels[i];
        const float bx = x + 16 + (i % 2) * 128.0f, by = y + 26 + (i / 2) * 76.0f;
        float col[4], ccol[4], bcol[4];
        tempColor(wh.thermal.surface, tp.tempOptimal - 50, tp.tempOptimal, tp.tempOptimal + 40, col);
        tempColor(wh.thermal.carcass, tp.tempOptimal - 50, tp.tempOptimal, tp.tempOptimal + 40, ccol);
        tempColor(wh.brakeTemp, 150, 600, 1100, bcol);
        rect(bx, by, 36, 62, col);
        rect(bx + 38, by, 9, 62, ccol);
        rect(bx + 49, by, 5, 62, bcol);
        text(bx + 60, by + 2, names[i], 1.6f, kGrey);
        text(bx + 60, by + 18, fmt("%.0f", wh.thermal.surface) + "/" + fmt("%.0f", wh.thermal.carcass), 1.6f, kWhiteC);
        text(bx + 60, by + 34, fmt("%.0f KPA", wh.thermal.pressureKpa(i < 2 ? c.car->front.tyre : c.car->rear.tyre)), 1.4f, kGrey);
        text(bx + 60, by + 48, "B " + fmt("%.0f", wh.brakeTemp), 1.5f, bcol);
    }
}

void Hud::appEnergy(const HudContext& c, float x, float y) {
    const auto& car = c.snap->car;
    const auto& pp = c.car->powertrain;
    const double frac = car.pt.soc / pp.batteryWindow;
    text(x + 14, y + 8, fmt("SOC %.2f MJ", car.pt.soc / 1e6) + fmt("   MGU-K %+.0f KW", car.pt.mgukPower / 1000.0), 1.7f, kWhiteC);
    rect(x + 14, y + 28, 242, 14, kDim);
    rect(x + 14, y + 28, float(242 * f1sim::clamp(frac, 0.0, 1.0)), 14, car.pt.mgukPower < -1000 ? kGreen : kBrand);
    text(x + 14, y + 50, fmt("HARVESTED THIS LAP %.2f", car.pt.lapHarvest / 1e6) + fmt(" / %.1f MJ", pp.harvestPerLap / 1e6), 1.5f, kGrey);
    rect(x + 14, y + 66, 242, 6, kDim);
    rect(x + 14, y + 66, float(242 * f1sim::clamp(car.pt.lapHarvest / pp.harvestPerLap, 0.0, 1.0)), 6, kGreen);
    text(x + 14, y + 82, std::string("MODE ") + f1sim::ersModeName(car.pt.ersMode) + fmt("   FUEL %.2f KG", car.pt.fuelMass), 1.6f, kBrand);
}

void Hud::appInputs(const HudContext& c, float x, float y) {
    const auto& s = *c.snap;
    const auto& car = s.car;
    auto bar = [&](float bx, float value, const float* col, const char* label) {
        rect(bx, y + 12, 22, 86, kDim);
        const float hh = 86.0f * float(f1sim::clamp(value, 0.0, 1.0));
        rect(bx, y + 12 + 86 - hh, 22, hh, col);
        text(bx + 5, y + 104, label, 1.6f, kGrey);
    };
    bar(x + 14, float(car.clutch), kBlue, "C");
    bar(x + 44, float(car.brake), kRed, "B");
    bar(x + 74, float(car.throttle), kGreen, "T");
    const double lock = c.car->steering.lock;
    const float sx = x + 112, sw = 200;
    rect(sx, y + 20, sw, 8, kDim);
    const float pos = float(f1sim::clamp(-car.steeringWheelAngle / lock, -1.0, 1.0));
    rect(sx + sw * 0.5f + pos * sw * 0.5f - 3, y + 14, 6, 20, kWhiteC);
    text(sx, y + 38, fmt("STEER %+.0f DEG", f1sim::rad2deg(car.steeringWheelAngle)), 1.6f, kGrey);
    rect(sx, y + 62, sw, 10, kDim);
    const float f = float(f1sim::clamp(s.ffbCommand, -1.0, 1.0));
    const float* fc = std::fabs(f) > 0.98f ? kRed : kBrand;
    if (f >= 0) rect(sx + sw * 0.5f - f * sw * 0.5f, y + 62, f * sw * 0.5f, 10, fc);
    else rect(sx + sw * 0.5f, y + 62, -f * sw * 0.5f, 10, fc);
    const std::string ffb = s.ffbActive ? "FFB " + fmt("%.0f%%", std::fabs(f) * 100) + fmt("  CLIP %.0f%%", s.ffbClipping * 100)
                                        : "FFB OFF (bind a wheel in F2)";
    text(sx, y + 78, ffb, 1.5f, s.ffbClipping > 0.05 ? kRed : kGrey);
    text(sx, y + 94, fmt("RACK %+.1f NM", car.steeringTorque), 1.5f, kGrey);
    const std::string dev = s.wheelActive ? "WHEEL" : (s.gamepadActive ? "GAMEPAD" : "KEYBOARD");
    text(sx, y + 110, "INPUT " + dev, 1.5f, kGrey);
}

void Hud::appDelta(const HudContext& c, float x, float y) {
    const auto& s = *c.snap;
    const float w = 420, mid = x + w * 0.5f;
    rect(x + 10, y + 8, w - 20, 10, kDim);
    rect(mid - 1, y + 4, 2, 18, kWhiteC);
    if (s.deltaValid && s.timing) {
        const float k = float(f1sim::clamp(s.delta / 2.0, -1.0, 1.0));
        const float len = k * (w * 0.5f - 10);
        if (k < 0) rect(mid + len, y + 8, -len, 10, kGreen);
        else rect(mid, y + 8, len, 10, kRed);
        const std::string t = fmt("%+.3f", s.delta);
        text(mid - textWidth(t, 1.8f) * 0.5f, y + 24, t, 1.8f, k < 0 ? kGreen : kRed);
    } else {
        text(mid - textWidth("NO REFERENCE LAP", 1.6f) * 0.5f, y + 24, "NO REFERENCE LAP", 1.6f, kGrey);
    }
}

void Hud::appGMeter(const HudContext& /*c*/, float x, float y) {
    const float cx = x + 100, cy = y + 104, r = 88;  // 4 g at the rim
    for (int ring = 1; ring <= 4; ++ring) {
        const float rr = r * ring / 4.0f;
        for (int i = 0; i < 48; ++i) {
            const float a0 = i * 2 * float(f1sim::kPi) / 48, a1 = (i + 1) * 2 * float(f1sim::kPi) / 48;
            line(cx + std::cos(a0) * rr, cy + std::sin(a0) * rr, cx + std::cos(a1) * rr, cy + std::sin(a1) * rr, 1.0f, kGrid);
        }
    }
    line(cx - r, cy, cx + r, cy, 1.0f, kGrid);
    line(cx, cy - r, cx, cy + r, 1.0f, kGrid);
    const double now = history_.empty() ? 0 : history_.back().t;
    for (const auto& h : history_) {
        const float age = float(now - h.t);
        if (age > 2.0f) continue;
        const float px = cx - float(h.gLat) / 4.0f * r, py = cy - float(h.gLong) / 4.0f * r;
        const float a[4] = {kBrand[0], kBrand[1], kBrand[2], 1.0f - age / 2.0f};
        rect(px - 1.5f, py - 1.5f, 3, 3, a);
    }
    if (!history_.empty()) {
        const auto& h = history_.back();
        const float px = cx - float(h.gLat) / 4.0f * r, py = cy - float(h.gLong) / 4.0f * r;
        rect(px - 4, py - 4, 8, 8, kWhiteC);
        text(x + 8, y + 196, fmt("LAT %.2f", std::fabs(h.gLat)) + fmt("  LONG %+.2f G", h.gLong), 1.5f, kGrey);
    }
}

void Hud::appTelemetry(const HudContext& /*c*/, float x, float y) {
    const float gx = x + 10, gy = y + 8, gw = 460, gh = 196;
    rect(gx, gy, gw, gh, kDim);
    for (int i = 1; i < 4; ++i) line(gx, gy + gh * i / 4.0f, gx + gw, gy + gh * i / 4.0f, 1.0f, kGrid);
    if (history_.size() < 2) return;
    const double now = history_.back().t, span = 10.0;
    auto plot = [&](auto value, double lo, double hi, const float* col) {
        float px = -1, py = 0;
        for (const auto& h : history_) {
            if (now - h.t > span) continue;
            const float xx = gx + gw * float(1.0 - (now - h.t) / span);
            const float yy = gy + gh * float(1.0 - f1sim::clamp((value(h) - lo) / (hi - lo), 0.0, 1.0));
            if (px >= 0) line(px, py, xx, yy, 1.6f, col);
            px = xx;
            py = yy;
        }
    };
    plot([](const Sample& h) { return h.speed; }, 0.0, 360.0, kWhiteC);
    plot([](const Sample& h) { return h.throttle; }, 0.0, 1.0, kGreen);
    plot([](const Sample& h) { return h.brake; }, 0.0, 1.0, kRed);
    plot([](const Sample& h) { return h.steer; }, -1.0, 1.0, kYellow);
    plot([](const Sample& h) { return h.ffb; }, -1.0, 1.0, kPurple);
    float lx = gx;
    const std::pair<const char*, const float*> legend[] = {{"SPEED", kWhiteC}, {"THROTTLE", kGreen}, {"BRAKE", kRed},
                                                           {"STEER", kYellow}, {"FFB", kPurple}};
    for (const auto& [name, col] : legend) {
        text(lx, gy + gh + 8, name, 1.5f, col);
        lx += textWidth(name, 1.5f) + 18;
    }
    text(gx + gw - 60, gy + gh + 8, "10 S", 1.5f, kGrey);
}

void Hud::appMap(const HudContext& c, float x, float y) {
    if (!c.track || c.track->samples().empty()) return;
    const auto& smp = c.track->samples();
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    for (const auto& p : smp) {
        minX = std::min(minX, p.pos.x); maxX = std::max(maxX, p.pos.x);
        minY = std::min(minY, p.pos.y); maxY = std::max(maxY, p.pos.y);
    }
    const float size = 256, ox = x + 12, oy = y + 10;
    const double scale = size / std::max(maxX - minX, maxY - minY);
    auto map = [&](double wx, double wy, float* px, float* py) {
        *px = ox + float((wx - minX) * scale);
        *py = oy + size - float((wy - minY) * scale);
    };
    const size_t step = std::max<size_t>(1, smp.size() / 400);
    for (size_t i = 0; i < smp.size(); i += step) {
        const auto& a = smp[i];
        const auto& b = smp[(i + step) % smp.size()];
        float x0, y0, x1, y1;
        map(a.pos.x, a.pos.y, &x0, &y0);
        map(b.pos.x, b.pos.y, &x1, &y1);
        line(x0, y0, x1, y1, 4.0f, kGrey);
    }
    float sx, sy;
    map(smp[0].pos.x, smp[0].pos.y, &sx, &sy);
    rect(sx - 2, sy - 6, 4, 12, kWhiteC);
    float cx, cy;
    map(c.snap->car.pos.x, c.snap->car.pos.y, &cx, &cy);
    rect(cx - 5, cy - 5, 10, 10, kBrand);
}

void Hud::appChassis(const HudContext& c, float x, float y) {
    const auto& car = c.snap->car;
    float yy = y + 8;
    auto row = [&](const std::string& k, const std::string& v) {
        text(x + 14, yy, k, 1.6f, kGrey);
        text(x + 150, yy, v, 1.6f, kWhiteC);
        yy += 20;
    };
    row("RIDE HEIGHT F/R", fmt("%.1f", car.rideHeightFront * 1000) + fmt(" / %.1f MM", car.rideHeightRear * 1000));
    row("DOWNFORCE F/R", fmt("%.0f", car.downforceFront) + fmt(" / %.0f N", car.downforceRear));
    row("DRAG", fmt("%.0f N", car.drag));
    const double df = car.downforceFront + car.downforceRear;
    row("AERO BALANCE", df > 100 ? fmt("%.1f%% FRONT", 100.0 * car.downforceFront / df) : std::string("-"));
    row("LOAD FL/FR", fmt("%.0f", car.wheels[0].fz) + fmt(" / %.0f N", car.wheels[1].fz));
    row("LOAD RL/RR", fmt("%.0f", car.wheels[2].fz) + fmt(" / %.0f N", car.wheels[3].fz));
    row("SLIP ANGLE F/R", fmt("%.1f", f1sim::rad2deg(0.5 * (car.wheels[0].slipAngle + car.wheels[1].slipAngle))) +
                              fmt(" / %.1f DEG", f1sim::rad2deg(0.5 * (car.wheels[2].slipAngle + car.wheels[3].slipAngle))));
    row("SLIP RATIO RL/RR", fmt("%.3f", car.wheels[2].slipRatio) + fmt(" / %.3f", car.wheels[3].slipRatio));
    row("FLOOR CONTACT", car.floorContact ? "YES" : "no");
}

void Hud::appSession(const HudContext& c, float x, float y) {
    const auto& s = *c.snap;
    text(x + 14, y + 8, fmt("%.0f FPS", c.fps) + fmt("   PHYSICS %.0f HZ", s.physicsHz), 1.6f, kWhiteC);
    text(x + 14, y + 28, fmt("AIR %.0f C", c.settings->airTempC) + fmt("   TRACK %.0f C", c.settings->trackTempC), 1.6f, kGrey);
    text(x + 14, y + 48, "CAMERA " + c.cameraName, 1.6f, kGrey);
    text(x + 14, y + 68, "CAR " + c.car->name, 1.6f, kGrey);
    text(x + 14, y + 88, "MODEL " + c.modelStatus, 1.4f, kGrey);
}

void Hud::drawApp(App& a, const HudContext& c) {
    rect(a.x, a.y, a.w, kTitleH, kTitle);
    text(a.x + 8, a.y + 3, a.title, 1.5f, kBrand);
    text(a.x + a.w - 16, a.y + 3, "x", 1.5f, kGrey);
    rect(a.x, a.y + kTitleH, a.w, a.h - kTitleH, kBg);
    const float x = a.x, y = a.y + kTitleH;
    if (a.id == "timing") appTiming(c, x, y);
    else if (a.id == "dashboard") appDashboard(c, x, y);
    else if (a.id == "tyres") appTyres(c, x, y);
    else if (a.id == "energy") appEnergy(c, x, y);
    else if (a.id == "inputs") appInputs(c, x, y);
    else if (a.id == "delta") appDelta(c, x, y);
    else if (a.id == "gmeter") appGMeter(c, x, y);
    else if (a.id == "telemetry") appTelemetry(c, x, y);
    else if (a.id == "map") appMap(c, x, y);
    else if (a.id == "chassis") appChassis(c, x, y);
    else if (a.id == "session") appSession(c, x, y);
}

// ---- menus and overlays ----------------------------------------------------------------------

void Hud::drawSidebar(const MouseState& m, int w, int h, HudResult* r) {
    const float sw = 230, x = w - sw;
    const float bg[4] = {0.04f, 0.04f, 0.07f, 0.9f};
    rect(x, 0, sw, float(h), bg);
    text(x + 14, 16, "APPS", 2.5f, kBrand);
    text(x + 14, 42, "click to show / hide", 1.4f, kGrey);
    float yy = 66;
    for (auto& a : apps_) {
        if (button(x + 10, yy, sw - 20, 30, a.title, m, a.visible)) {
            a.visible = !a.visible;
            r->layoutChanged = true;
        }
        yy += 36;
    }
    r->mouseOverUi = r->mouseOverUi || m.x >= x;
}

void Hud::drawPauseMenu(const HudContext& /*c*/, const MouseState& m, int w, int h, HudResult* r) {
    const float pw = 360, ph = 378, x = (w - pw) * 0.5f, y = (h - ph) * 0.5f;
    const float bg[4] = {0.03f, 0.03f, 0.06f, 0.94f};
    rect(x, y, pw, ph, bg);
    rect(x, y, pw, 4, kBrand);
    text(x + 24, y + 20, "PAUSED", 3.0f, kWhiteC);
    const std::pair<const char*, MenuAction> items[] = {{"RESUME", MenuAction::Resume},
                                                        {"RESTART SESSION", MenuAction::Restart},
                                                        {"MAIN MENU (CAR / TRACK)", MenuAction::MainMenu},
                                                        {"CONTROLS & FORCE FEEDBACK", MenuAction::Controls},
                                                        {"HELP / KEYS", MenuAction::Help},
                                                        {"QUIT TO DESKTOP", MenuAction::Quit}};
    float yy = y + 70;
    for (const auto& [label, act] : items) {
        if (button(x + 20, yy, pw - 40, 40, label, m)) r->action = act;
        yy += 48;
    }
    r->mouseOverUi = true;
}

void Hud::drawHelp(const HudContext& c, int w, int h) {
    const float pw = 760, ph = 600, x = (w - pw) * 0.5f, y = (h - ph) * 0.5f;
    const float bg[4] = {0.03f, 0.03f, 0.06f, 0.94f};
    rect(x, y, pw, ph, bg);
    text(x + 24, y + 20, "F1SIM - TIME TRIAL", 3.0f, kBrand);
    const char* lines[] = {
        "KEYBOARD                        WHEEL / PEDALS: bind them in F2",
        "Up / Down        throttle / brake",
        "Left / Right     steer",
        "A / Z            shift up / down  (also L-Shift / L-Ctrl)",
        "Space            active aero (straight mode, closes on brake)",
        "E                ERS mode: balanced / quali / harvest",
        "[ / ]            brake bias rear / front",
        "C / V            next / previous camera (9 cameras)",
        "- / =            field of view",
        "F3 or mouse at the right edge: apps (telemetry, map, g-meter...)",
        "R                restart from the pit straight",
        "Backspace        put the car back on the track",
        "F5               autopilot (robot driver)",
        "F12              screenshot (saved to the screenshots folder)",
        "P / Esc          pause menu",
        "",
        "Track limits: all four wheels beyond the white line invalidate the lap.",
        "Every lap is saved as CSV telemetry in the telemetry folder.",
    };
    float yy = y + 70;
    for (const char* l : lines) {
        text(x + 24, yy, l, 2.0f, kWhiteC);
        yy += 26;
    }
    text(x + 24, y + ph - 60, "Car: " + std::string(c.car->name) + "   Model: " + c.modelStatus, 1.6f, kGrey);
    text(x + 24, y + ph - 36, "F1 closes this screen", 1.8f, kGrey);
}

void Hud::drawSetup(const HudContext& c, int w, int h) {
    const float pw = std::min(1100.0f, w - 40.0f), ph = std::min(760.0f, h - 40.0f);
    const float x = (w - pw) * 0.5f, y = (h - ph) * 0.5f;
    const float bg[4] = {0.03f, 0.03f, 0.06f, 0.95f};
    rect(x, y, pw, ph, bg);
    text(x + 24, y + 18, "CONTROLS AND FORCE FEEDBACK", 3.0f, kBrand);
    const auto& st = *c.settings;
    float yy = y + 60;
    if (c.binding != BindTarget::None) {
        rect(x + 20, yy - 6, pw - 40, 34, kDim);
        const std::string hint = c.guidedStep.empty() ? "   (Esc cancels)" : "   (step " + c.guidedStep + ", Space skips, Esc stops)";
        text(x + 30, yy, std::string("BINDING: ") + bindTargetName(c.binding) + hint, 2.0f, kYellow);
        yy += 40;
    } else {
        text(x + 24, yy, "ENTER: guided setup (steering, pedals, paddles) - or press 1-9 to bind a single control", 1.8f, kYellow);
        yy += 28;
    }
    auto row = [&](const std::string& key, const std::string& what, const std::string& value) {
        text(x + 24, yy, key, 1.8f, kBrand);
        text(x + 90, yy, what, 1.8f, kWhiteC);
        text(x + 440, yy, value, 1.8f, kGrey);
        yy += 22;
    };
    auto axisStr = [](const AxisBinding& b) {
        return b.bound() ? b.deviceName + "  axis " + std::to_string(b.axis) : std::string("not bound");
    };
    auto btnStr = [](const ButtonBinding& b) {
        return b.bound() ? b.deviceName + "  button " + std::to_string(b.button) : std::string("not bound");
    };
    row("1", "Steering axis", axisStr(st.steer));
    row("2", "Throttle", axisStr(st.throttle));
    row("3", "Brake", axisStr(st.brake));
    row("4", "Clutch (optional)", axisStr(st.clutch));
    row("5", "Shift up", btnStr(st.shiftUp));
    row("6", "Shift down", btnStr(st.shiftDown));
    row("7", "Active aero", btnStr(st.aero));
    row("8", "Reset car", btnStr(st.reset));
    row("9", "ERS mode", btnStr(st.ersMode));
    yy += 8;
    row("W", "Apply wheel preset", st.wheelPreset.empty() ? (c.wheelName.empty() ? std::string("generic (no known wheel)") : "available: " + c.wheelName)
                                                             : "applied: " + st.wheelPreset);
    if (!c.presetHint.empty()) row("", "Vendor driver", c.presetHint);
    row(", .", "Wheel rotation (match your driver!)", fmt("%.0f deg", st.wheelRotationDeg));
    row("B", "Brake curve (gamma)", fmt("%.2f", st.brakeGamma));
    row("G H", "FFB gain", fmt("%.2f", st.ffb.gain));
    row("M N", "Wheel base peak torque", fmt("%.1f Nm", st.ffb.deviceMaxTorque));
    row("K L", "Car torque scale", fmt("%.2f  (1.0 = real F1 steering torque)", st.ffb.carTorqueScale));
    row("D", "FFB damping", fmt("%.3f", st.ffb.damping));
    row("F", "FFB filter", st.ffb.filterHz > 0 ? fmt("%.0f Hz", st.ffb.filterHz) : std::string("off"));
    row("I", "Invert FFB direction", st.ffb.invert ? "yes" : "no");
    row("T", "FFB test (should push the wheel LEFT)", c.ffbDevice.empty() ? "no FFB device" : c.ffbDevice);
    row("O", "FFB on/off", st.ffbEnabled ? "on" : "off");
    yy += 10;
    text(x + 24, yy, "DEVICES (live raw values)", 2.0f, kBrand);
    yy += 26;
    for (const auto& d : c.devices) {
        if (yy > y + ph - 60) break;
        text(x + 24, yy, d.name + (d.gamepad ? "  (gamepad)" : "") + (d.ffb ? "  [FFB]" : ""), 1.7f, kWhiteC);
        yy += 20;
        float ax = x + 24;
        for (size_t a = 0; a < d.axes.size() && a < 8; ++a) {
            rect(ax, yy, 120, 10, kDim);
            const float v = (d.axes[a] + 32768.0f) / 65535.0f;
            rect(ax + v * 116, yy - 2, 4, 14, kWhiteC);
            text(ax, yy + 13, "axis " + std::to_string(a), 1.3f, kGrey);
            ax += 132;
        }
        yy += 32;
        std::string pressed;
        for (size_t b = 0; b < d.buttons.size(); ++b) if (d.buttons[b]) pressed += std::to_string(b) + " ";
        text(x + 24, yy, "buttons pressed: " + (pressed.empty() ? std::string("-") : pressed), 1.4f, kGrey);
        yy += 22;
    }
    if (c.devices.empty()) text(x + 24, yy, "No controllers detected. Plug in the wheel and wait a second.", 1.8f, kYellow);
    text(x + 24, y + ph - 30, "Settings are saved automatically.  F2 / Esc closes this screen.", 1.8f, kGrey);
}

std::string Hud::fitText(const std::string& s, float scale, float maxWidth) const {
    if (textWidth(s, scale) <= maxWidth) return s;
    std::string t = s;
    while (!t.empty() && textWidth(t + "...", scale) > maxWidth) t.pop_back();
    return t + "...";
}

void Hud::drawMainMenu(const HudContext& c, const MouseState& m, int w, int h, HudResult* r) {
    r->mouseOverUi = true;
    const float shade[4] = {0.02f, 0.02f, 0.05f, 0.80f};
    rect(0, 0, float(w), float(h), shade);
    const float margin = std::max(24.0f, w * 0.05f);
    float y = std::max(24.0f, h * 0.06f);
    text(margin, y, "F1SIM", 6.0f, kBrand);
    text(margin + textWidth("F1SIM", 6.0f) + 18, y + 22, "TIME TRIAL   " + c.version, 2.2f, kGrey);
    y += 70;

    const Catalog* cat = c.catalog;
    const float colGap = 28.0f;
    const float colW = std::min(560.0f, (w - 2 * margin - colGap) * 0.5f);
    const float listTop = y + 34, rowH = 70.0f;
    const float listBottom = h - 150.0f;
    const float focusBar[4] = {kBrand[0], kBrand[1], kBrand[2], 1.0f};
    auto header = [&](float x, const char* title, bool focused) {
        text(x, y, title, 2.6f, focused ? kWhiteC : kGrey);
        if (focused) rect(x, y + 26, textWidth(title, 2.6f), 3, focusBar);
    };
    const float xCars = margin, xTracks = margin + colW + colGap;
    header(xCars, "CAR", c.menuFocus == 0);
    header(xTracks, "TRACK", c.menuFocus == 1);

    auto card = [&](float x, float yy, bool selected, const MouseState& ms) {
        const bool hover = ms.x >= x && ms.x <= x + colW && ms.y >= yy && ms.y <= yy + rowH - 8;
        const float bg[4] = {selected ? 0.20f : (hover ? 0.14f : 0.08f), selected ? 0.18f : (hover ? 0.13f : 0.08f),
                             selected ? 0.42f : (hover ? 0.26f : 0.13f), 0.95f};
        rect(x, yy, colW, rowH - 8, bg);
        if (selected) rect(x, yy, 5, rowH - 8, kBrand);
        return hover && ms.pressed;
    };

    if (cat) {
        float yy = listTop;
        for (size_t i = 0; i < cat->cars.size() && yy + rowH < listBottom; ++i, yy += rowH) {
            const auto& e = cat->cars[i];
            if (card(xCars, yy, int(i) == c.menuCar, m)) r->pickCar = int(i);
            const float sw[4] = {e.livery[0], e.livery[1], e.livery[2], 1.0f};
            rect(xCars + 16, yy + 14, 28, 28, sw);
            text(xCars + 58, yy + 10, fitText(e.name, 2.4f, colW - 70), 2.4f, e.ok ? kWhiteC : kRed);
            text(xCars + 58, yy + 38, fitText(e.ok ? e.description : e.error, 1.5f, colW - 70), 1.5f, kGrey);
        }
        yy = listTop;
        for (size_t i = 0; i < cat->tracks.size() && yy + rowH < listBottom; ++i, yy += rowH) {
            const auto& e = cat->tracks[i];
            if (card(xTracks, yy, int(i) == c.menuTrack, m)) r->pickTrack = int(i);
            text(xTracks + 20, yy + 10, fitText(e.name, 2.4f, colW - 40), 2.4f, e.ok ? kWhiteC : kRed);
            std::string info;
            if (e.ok) {
                char b[160];
                std::snprintf(b, sizeof(b), "%.3f km   elevation %.0f m   %d %s", e.length / 1000.0, e.elevationRange, e.aeroZones,
                              e.aeroZones == 1 ? "straight-mode zone" : "straight-mode zones");
                info = b;
            } else {
                info = e.error;
            }
            text(xTracks + 20, yy + 38, fitText(info, 1.5f, colW - 40), 1.5f, kGrey);
        }
        if (cat->cars.empty()) text(xCars, listTop, "No cars in data/cars", 2.0f, kRed);
        if (cat->tracks.empty()) text(xTracks, listTop, "No tracks in data/tracks", 2.0f, kRed);
    }

    // Status line: controller state.
    float sy = h - 128.0f;
    std::string ctl;
    const float* ctlCol = kGrey;
    if (c.settings->steer.bound()) {
        ctl = "Wheel: " + c.settings->steer.deviceName + (c.settings->wheelPreset.empty() ? "" : "  (preset " + c.settings->wheelPreset + ")");
        ctlCol = kGreen;
    } else if (!c.wheelName.empty()) {
        ctl = c.wheelName + " detected but not set up - open CONTROLS (F2) and press Enter";
        ctlCol = kYellow;
    } else {
        ctl = "No wheel set up - keyboard: arrows, A/Z shift, Space DRS/aero.  Wheel: CONTROLS (F2)";
    }
    text(margin, sy, fitText(ctl, 1.8f, w - 2 * margin), 1.8f, ctlCol);
    if (!c.menuError.empty()) text(margin, sy - 26, fitText(c.menuError, 1.8f, w - 2 * margin), 1.8f, kRed);
    if (!c.menuStatus.empty()) text(margin, sy - 26, fitText(c.menuStatus, 1.8f, w - 2 * margin), 1.8f, kYellow);

    // Buttons.
    const float by = h - 90.0f, bh = 52.0f;
    const bool hoverDrive = m.x >= margin && m.x <= margin + 260 && m.y >= by && m.y <= by + bh;
    const float driveBg[4] = {hoverDrive ? 0.62f : 0.50f, hoverDrive ? 0.56f : 0.44f, 1.0f, 1.0f};
    rect(margin, by, 260, bh, driveBg);
    text(margin + 24, by + 14, "DRIVE", 3.2f, kWhiteC);
    text(margin + 150, by + 22, "Enter", 1.6f, kWhiteC);
    if (hoverDrive && m.pressed) r->action = MenuAction::Drive;
    if (button(margin + 280, by, 220, bh, "CONTROLS (F2)", m)) r->action = MenuAction::Controls;
    if (button(margin + 520, by, 150, bh, "HELP (F1)", m)) r->action = MenuAction::Help;
    if (button(margin + 690, by, 130, bh, "QUIT", m)) r->action = MenuAction::Quit;
    text(margin, h - 26.0f, "Mouse or Tab / arrows to choose, Enter to drive.  In the car: Esc = pause menu (back to this screen).", 1.5f, kGrey);
}

HudResult Hud::draw(const HudContext& c, const MouseState& m, int w, int h) {
    HudResult r;
    if (apps_.empty()) loadLayout(*c.settings, w, h);
    recordHistory(*c.snap);
    gl::Disable(GL_DEPTH_TEST);
    gl::Enable(GL_BLEND);
    gl::BlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

    // Dragging by the title bar; "x" closes the app.
    if (m.pressed && !c.showSetup && !c.showHelp && !c.showMainMenu) {
        for (int i = static_cast<int>(apps_.size()) - 1; i >= 0; --i) {
            auto& a = apps_[i];
            if (!a.visible) continue;
            if (m.x >= a.x && m.x <= a.x + a.w && m.y >= a.y && m.y <= a.y + kTitleH) {
                if (m.x >= a.x + a.w - 20) {
                    a.visible = false;
                    r.layoutChanged = true;
                } else {
                    dragging_ = i;
                    dragDx_ = m.x - a.x;
                    dragDy_ = m.y - a.y;
                }
                break;
            }
        }
    }
    if (dragging_ >= 0) {
        if (m.down) {
            apps_[dragging_].x = m.x - dragDx_;
            apps_[dragging_].y = m.y - dragDy_;
        } else {
            dragging_ = -1;
            r.layoutChanged = true;
        }
    }
    for (auto& a : apps_) {
        a.x = f1sim::clamp(a.x, 0.0f, std::max(0.0f, w - a.w));
        a.y = f1sim::clamp(a.y, 0.0f, std::max(0.0f, h - a.h));
        if (c.showMainMenu) continue;
        if (a.visible) drawApp(a, c);
        if (a.visible && m.x >= a.x && m.x <= a.x + a.w && m.y >= a.y && m.y <= a.y + a.h) r.mouseOverUi = true;
    }

    const auto& s = *c.snap;
    if (!s.message.empty() && s.simTime - s.messageTime < 4.0) {
        const float tw = textWidth(s.message, 3.0f);
        rect((w - tw) * 0.5f - 16, 80, tw + 32, 44, kBg);
        text((w - tw) * 0.5f, 90, s.message, 3.0f, kYellow);
    }
    if (c.showMainMenu) {
        if (!c.showSetup && !c.showHelp) drawMainMenu(c, m, w, h, &r);
    } else {
        if (c.showSidebar) drawSidebar(m, w, h, &r);
        if (s.paused && !c.showSetup && !c.showHelp) drawPauseMenu(c, m, w, h, &r);
        // A wheel is connected but not configured yet.
        if (!c.wheelName.empty() && !c.settings->steer.bound() && !c.showSetup) {
            const std::string msg = c.wheelName + " detected - press F2 to set it up (about 30 s)";
            const float tw = textWidth(msg, 2.0f);
            rect((w - tw) * 0.5f - 14, h - 64.0f, tw + 28, 34, kYellow);
            text((w - tw) * 0.5f, h - 55.0f, msg, 2.0f, kInk);
        }
    }
    if (c.showHelp) drawHelp(c, w, h);
    if (c.showSetup) drawSetup(c, w, h);
    flush(w, h);
    gl::Disable(GL_BLEND);
    return r;
}

}  // namespace app
