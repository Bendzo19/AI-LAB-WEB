#include "renderer.hpp"

#include <SDL3/SDL.h>

#include <algorithm>
#include <cmath>

#include "f1sim/ini.hpp"

namespace app {

const char* cameraName(CameraMode m) {
    switch (m) {
        case CameraMode::Cockpit: return "cockpit";
        case CameraMode::Helmet: return "helmet";
        case CameraMode::TCam: return "T-cam";
        case CameraMode::Nose: return "nose";
        case CameraMode::Side: return "sidepod";
        case CameraMode::Rear: return "rear-facing";
        case CameraMode::ChaseNear: return "chase";
        case CameraMode::ChaseFar: return "chase far";
        case CameraMode::TV: return "TV";
        default: return "?";
    }
}

namespace {

const char* kLitVs = R"(#version 330 core
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aColor;
layout(location=3) in vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vWorld;
out vec3 vNormal;
out vec4 vColor;
out vec2 vUV;
void main() {
    vec4 w = uModel * vec4(aPos, 1.0);
    vWorld = w.xyz;
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    vUV = aUV;
    gl_Position = uViewProj * w;
}
)";

const char* kLitFs = R"(#version 330 core
in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
in vec2 vUV;
uniform vec4 uTint;
uniform int uUseTex;
uniform sampler2D uTex;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform int uProcedural;
uniform float uSpec;
out vec4 frag;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
void main() {
    vec4 base = vColor * uTint;
    if (uUseTex == 1) base *= texture(uTex, vUV);
    if (base.a < 0.05) discard;
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    if (uProcedural == 1) {
        float g = noise(vWorld.xy * 4.0) * 0.07 + noise(vWorld.xy * 0.6) * 0.06 + noise(vWorld.xy * 0.05) * 0.08;
        base.rgb *= 0.88 + g;
    }
    float diff = max(dot(n, uSunDir), 0.0);
    float hemi = 0.5 + 0.5 * n.z;
    vec3 amb = mix(vec3(0.22, 0.21, 0.20), vec3(0.42, 0.47, 0.56), hemi);
    vec3 col = base.rgb * (amb + diff * vec3(1.0, 0.95, 0.86) * 0.9);
    vec3 v = normalize(uCamPos - vWorld);
    vec3 h = normalize(v + uSunDir);
    col += pow(max(dot(n, h), 0.0), 48.0) * uSpec * vec3(1.0, 0.97, 0.9);
    float d = length(vWorld - uCamPos);
    float fog = 1.0 - exp(-uFogDensity * d);
    col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
    frag = vec4(pow(col, vec3(1.0 / 1.1)), base.a);
}
)";

const char* kSkyVs = R"(#version 330 core
out vec2 vNdc;
void main() {
    vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
    vNdc = p;
    gl_Position = vec4(p, 0.999, 1.0);
}
)";

const char* kSkyFs = R"(#version 330 core
in vec2 vNdc;
uniform vec3 uCamRight, uCamUp, uCamFwd, uSunDir;
uniform float uTanHalf, uAspect;
out vec4 frag;
void main() {
    vec3 dir = normalize(uCamFwd + vNdc.x * uTanHalf * uAspect * uCamRight + vNdc.y * uTanHalf * uCamUp);
    float t = clamp(dir.z, -0.1, 1.0);
    vec3 horizon = vec3(0.78, 0.84, 0.90);
    vec3 zenith = vec3(0.30, 0.50, 0.80);
    vec3 col = mix(horizon, zenith, pow(max(t, 0.0), 0.6));
    float sun = max(dot(dir, uSunDir), 0.0);
    col += vec3(1.0, 0.9, 0.7) * (pow(sun, 600.0) * 4.0 + pow(sun, 12.0) * 0.12);
    frag = vec4(col, 1.0);
}
)";

GLuint compile(GLenum type, const char* src, std::string* error) {
    const GLuint s = gl::CreateShader(type);
    gl::ShaderSource(s, 1, &src, nullptr);
    gl::CompileShader(s);
    GLint ok = 0;
    gl::GetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[2048];
        gl::GetShaderInfoLog(s, sizeof(log), nullptr, log);
        if (error) *error = std::string("shader compile error: ") + log;
        gl::DeleteShader(s);
        return 0;
    }
    return s;
}

GLuint link(const char* vs, const char* fs, std::string* error) {
    const GLuint v = compile(GL_VERTEX_SHADER, vs, error);
    const GLuint f = compile(GL_FRAGMENT_SHADER, fs, error);
    if (!v || !f) return 0;
    const GLuint p = gl::CreateProgram();
    gl::AttachShader(p, v);
    gl::AttachShader(p, f);
    gl::LinkProgram(p);
    gl::DeleteShader(v);
    gl::DeleteShader(f);
    GLint ok = 0;
    gl::GetProgramiv(p, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[2048];
        gl::GetProgramInfoLog(p, sizeof(log), nullptr, log);
        if (error) *error = std::string("shader link error: ") + log;
        return 0;
    }
    return p;
}

struct Rgba {
    uint8_t c[4];
};
constexpr Rgba kAsphalt{{72, 74, 78, 255}};
constexpr Rgba kLine{{235, 235, 235, 255}};
constexpr Rgba kKerbRed{{200, 30, 35, 255}};
constexpr Rgba kKerbWhite{{235, 235, 235, 255}};
constexpr Rgba kGrass{{78, 128, 58, 255}};
constexpr Rgba kGrassFar{{68, 112, 52, 255}};
constexpr Rgba kBarrier{{35, 35, 38, 255}};
constexpr Rgba kBrandPurple{{109, 92, 230, 255}};   // AI LAB brand (gantry)
constexpr Rgba kCarbon{{28, 28, 32, 255}};
constexpr Rgba kWhite{{230, 230, 235, 255}};
constexpr Rgba kTyre{{22, 22, 24, 255}};
constexpr Rgba kRim{{150, 150, 158, 255}};

Vec3f toF(const f1sim::Vec3& v) { return Vec3f(v); }

// Unit box from (0,-0.5,-0.5) to (1,0.5,0.5): stretched between two points.
Mat4 beam(const Vec3f& a, const Vec3f& b, float thickness) {
    const Vec3f d = b - a;
    const float len = std::sqrt(dotf(d, d));
    const Vec3f x = normalizef(d);
    const Vec3f ref = std::fabs(x.z) < 0.9f ? Vec3f{0, 0, 1} : Vec3f{0, 1, 0};
    const Vec3f y = normalizef(crossf(ref, x));
    const Vec3f z = crossf(x, y);
    Mat4 m;
    m.at(0, 0) = x.x * len; m.at(1, 0) = x.y * len; m.at(2, 0) = x.z * len;
    m.at(0, 1) = y.x * thickness; m.at(1, 1) = y.y * thickness; m.at(2, 1) = y.z * thickness;
    m.at(0, 2) = z.x * thickness; m.at(1, 2) = z.y * thickness; m.at(2, 2) = z.z * thickness;
    m.at(0, 3) = a.x; m.at(1, 3) = a.y; m.at(2, 3) = a.z;
    return m;
}

}  // namespace

bool Renderer::buildShaders(std::string* error) {
    lit_ = link(kLitVs, kLitFs, error);
    sky_ = link(kSkyVs, kSkyFs, error);
    if (!lit_ || !sky_) return false;
    u_.viewProj = gl::GetUniformLocation(lit_, "uViewProj");
    u_.model = gl::GetUniformLocation(lit_, "uModel");
    u_.tint = gl::GetUniformLocation(lit_, "uTint");
    u_.useTex = gl::GetUniformLocation(lit_, "uUseTex");
    u_.tex = gl::GetUniformLocation(lit_, "uTex");
    u_.sunDir = gl::GetUniformLocation(lit_, "uSunDir");
    u_.camPos = gl::GetUniformLocation(lit_, "uCamPos");
    u_.fogColor = gl::GetUniformLocation(lit_, "uFogColor");
    u_.fogDensity = gl::GetUniformLocation(lit_, "uFogDensity");
    u_.procedural = gl::GetUniformLocation(lit_, "uProcedural");
    u_.spec = gl::GetUniformLocation(lit_, "uSpec");
    us_.camRight = gl::GetUniformLocation(sky_, "uCamRight");
    us_.camUp = gl::GetUniformLocation(sky_, "uCamUp");
    us_.camFwd = gl::GetUniformLocation(sky_, "uCamFwd");
    us_.tanHalf = gl::GetUniformLocation(sky_, "uTanHalf");
    us_.aspect = gl::GetUniformLocation(sky_, "uAspect");
    us_.sunDir = gl::GetUniformLocation(sky_, "uSunDir");
    gl::GenVertexArrays(1, &skyVao_);
    return true;
}

bool Renderer::init(const f1sim::Track& track, const f1sim::CarParams& car, const f1sim::RacingLine& line,
                    const std::string& dataDir, const std::string& modelConfig, std::string* error) {
    // The renderer is re-initialised when the car or track changes.
    tvCams_.clear();
    tvCurrent_ = -1;
    chaseInit_ = false;
    headOffset_ = {0, 0, 0};
    bodyIncludesWheels_ = false;
    mirrorRightWheels_ = true;
    modelStatus_ = "built-in primitive car";
    car_ = car;
    if (!buildShaders(error)) return false;
    buildTrack(track, line);
    buildCar(car, dataDir, modelConfig);
    return true;
}

void Renderer::buildTrack(const f1sim::Track& track, const f1sim::RacingLine& line) {
    MeshBuilder tb, sb;
    const auto& samples = track.samples();
    const int n = static_cast<int>(samples.size());
    if (n < 4) return;
    const double spacing = track.length() / n;
    const int stride = std::max(1, static_cast<int>(std::round(2.0 / spacing)));

    struct Section { double s; f1sim::TrackSample t; };
    std::vector<Section> secs;
    for (int i = 0; i < n; i += stride) secs.push_back({samples[i].s, samples[i]});
    secs.push_back({track.length(), samples[0]});  // close the loop

    auto point = [&](const Section& sc, double d, double dz = 0.0) {
        const double h = sc.t.heading;
        const double z = track.heightAt(sc.s < track.length() ? sc.s : 0.0, d) + dz;
        return Vec3f{float(sc.t.pos.x - std::sin(h) * d), float(sc.t.pos.y + std::cos(h) * d), float(z)};
    };
    auto strip = [&](MeshBuilder& b, const Section& a, const Section& c, double da0, double da1, double dc0, double dc1,
                     const uint8_t* col) {
        const Vec3f p0 = point(a, da0), p1 = point(a, da1), p2 = point(c, dc1), p3 = point(c, dc0);
        const Vec3f nrm = normalizef(crossf(p1 - p0, p3 - p0));
        b.addQuad(p0, p3, p2, p1, nrm.z < 0 ? nrm * -1.0f : nrm, col);
    };

    for (size_t k = 0; k + 1 < secs.size(); ++k) {
        const auto& a = secs[k];
        const auto& c = secs[k + 1];
        const auto& A = a.t;
        const auto& C = c.t;
        const bool stripe = static_cast<int>(std::floor(a.s / 2.0)) % 2 == 0;
        // Asphalt and white lines.
        strip(tb, a, c, -A.widthRight + 0.2, A.widthLeft - 0.2, -C.widthRight + 0.2, C.widthLeft - 0.2, kAsphalt.c);
        strip(tb, a, c, A.widthLeft - 0.2, A.widthLeft, C.widthLeft - 0.2, C.widthLeft, kLine.c);
        strip(tb, a, c, -A.widthRight, -A.widthRight + 0.2, -C.widthRight, -C.widthRight + 0.2, kLine.c);
        // Kerbs (red/white every 2 m).
        const uint8_t* kerbCol = stripe ? kKerbRed.c : kKerbWhite.c;
        if (A.kerbLeft > 0 || C.kerbLeft > 0) {
            strip(tb, a, c, A.widthLeft, A.widthLeft + A.kerbLeft, C.widthLeft, C.widthLeft + C.kerbLeft, kerbCol);
        }
        if (A.kerbRight > 0 || C.kerbRight > 0) {
            strip(tb, a, c, -A.widthRight - A.kerbRight, -A.widthRight, -C.widthRight - C.kerbRight, -C.widthRight, kerbCol);
        }
        // Grass run-off up to the barriers, then terrain beyond.
        const double wl = A.widthLeft + A.runoffLeft, wlc = C.widthLeft + C.runoffLeft;
        const double wr = A.widthRight + A.runoffRight, wrc = C.widthRight + C.runoffRight;
        strip(tb, a, c, A.widthLeft + A.kerbLeft, wl, C.widthLeft + C.kerbLeft, wlc, kGrass.c);
        strip(tb, a, c, -wr, -A.widthRight - A.kerbRight, -wrc, -C.widthRight - C.kerbRight, kGrass.c);
        strip(sb, a, c, wl, wl + 120.0, wlc, wlc + 120.0, kGrassFar.c);
        strip(sb, a, c, -wr - 120.0, -wr, -wrc - 120.0, -wrc, kGrassFar.c);

        // Barriers: tyre wall with a striped top band (strong motion cue).
        for (int side = 0; side < 2; ++side) {
            const double da = side == 0 ? wl : -wr, dc = side == 0 ? wlc : -wrc;
            const Vec3f g0 = point(a, da), g1 = point(c, dc);
            const Vec3f t0 = g0 + Vec3f{0, 0, 0.9f}, t1 = g1 + Vec3f{0, 0, 0.9f};
            const Vec3f h0 = t0 + Vec3f{0, 0, 0.35f}, h1 = t1 + Vec3f{0, 0, 0.35f};
            const Vec3f nrm = normalizef(crossf(g1 - g0, Vec3f{0, 0, 1})) * (side == 0 ? -1.0f : 1.0f);
            sb.addQuad(g0, g1, t1, t0, nrm, kBarrier.c);
            sb.addQuad(t0, t1, h1, h0, nrm, stripe ? kKerbRed.c : kWhite.c);
        }
        // Marker posts every 50 m on both sides.
        if (static_cast<int>(a.s) / 50 != static_cast<int>(c.s) / 50) {
            for (double side : {1.0, -1.0}) {
                const double d = side > 0 ? wl + 1.5 : -wr - 1.5;
                const Vec3f p = point(a, d);
                sb.addBox(p + Vec3f{-0.15f, -0.15f, 0}, p + Vec3f{0.15f, 0.15f, 3.5f}, kWhite.c);
            }
        }
        // Simple trees for depth perception.
        const uint32_t hsh = static_cast<uint32_t>(k * 2654435761u);
        if ((hsh >> 7) % 5 == 0) {
            const double side = (hsh >> 3) % 2 ? 1.0 : -1.0;
            const double dist = 8.0 + static_cast<double>((hsh >> 11) % 60);
            const double d = side > 0 ? wl + dist : -wr - dist;
            const Vec3f p = point(a, d, -0.05);
            const float hgt = 6.0f + static_cast<float>((hsh >> 17) % 7);
            const uint8_t trunk[4] = {90, 70, 50, 255};
            const uint8_t leaf[4] = {40, uint8_t(85 + (hsh >> 20) % 30), 38, 255};
            sb.addBox(p + Vec3f{-0.3f, -0.3f, 0}, p + Vec3f{0.3f, 0.3f, hgt * 0.4f}, trunk);
            sb.addBox(p + Vec3f{-2.2f, -2.2f, hgt * 0.35f}, p + Vec3f{2.2f, 2.2f, hgt}, leaf);
        }
    }

    // Start/finish line (chequered) and a gantry.
    {
        const auto& t0 = samples[0];
        const Section a{0.0, t0};
        const double w = t0.widthLeft + t0.widthRight;
        const int cols = 14;
        for (int r = 0; r < 2; ++r) {
            const auto ta = track.sampleAt(r * 0.6), tc = track.sampleAt((r + 1) * 0.6);
            const Section sa{r * 0.6, ta}, sc{(r + 1) * 0.6, tc};
            for (int cix = 0; cix < cols; ++cix) {
                const double d0 = -t0.widthRight + w * cix / cols, d1 = -t0.widthRight + w * (cix + 1) / cols;
                const uint8_t* col = ((r + cix) % 2) ? kLine.c : kCarbon.c;
                const Vec3f p0 = point(sa, d0, 0.01), p1 = point(sa, d1, 0.01), p2 = point(sc, d1, 0.01),
                            p3 = point(sc, d0, 0.01);
                tb.addQuad(p0, p3, p2, p1, {0, 0, 1}, col);
            }
        }
        const Vec3f l = point(a, t0.widthLeft + 3.0), r = point(a, -t0.widthRight - 3.0);
        sb.addBox(l + Vec3f{-0.4f, -0.4f, 0}, l + Vec3f{0.4f, 0.4f, 8.0f}, kCarbon.c);
        sb.addBox(r + Vec3f{-0.4f, -0.4f, 0}, r + Vec3f{0.4f, 0.4f, 8.0f}, kCarbon.c);
        const float zTop = std::max(l.z, r.z) + 7.0f;
        const Vec3f mn{std::min(l.x, r.x) - 0.5f, std::min(l.y, r.y) - 0.5f, zTop};
        const Vec3f mx{std::max(l.x, r.x) + 0.5f, std::max(l.y, r.y) + 0.5f, zTop + 1.6f};
        sb.addBox(mn, mx, kBrandPurple.c);
    }

    // Straight-mode (DRS) activation points: a line across the track and a
    // green board on each side.
    const Rgba kDrsGreen{{40, 190, 90, 255}};
    for (const auto& z : track.aeroZones()) {
        const double s0 = track.wrapS(z.first);
        const auto ts = track.sampleAt(s0);
        const Section a{s0, ts}, c{track.wrapS(s0 + 0.4), track.sampleAt(track.wrapS(s0 + 0.4))};
        const Vec3f p0 = point(a, -ts.widthRight, 0.01), p1 = point(a, ts.widthLeft, 0.01),
                    p2 = point(c, c.t.widthLeft, 0.01), p3 = point(c, -c.t.widthRight, 0.01);
        tb.addQuad(p0, p3, p2, p1, {0, 0, 1}, kLine.c);
        const Vec3f fwd{float(std::cos(ts.heading)), float(std::sin(ts.heading)), 0};
        const Vec3f lat{-fwd.y, fwd.x, 0};
        for (double d : {ts.widthLeft + ts.kerbLeft + 2.0, -ts.widthRight - ts.kerbRight - 2.0}) {
            const Vec3f p = point(a, d);
            sb.addBox(p + Vec3f{-0.05f, -0.05f, 0}, p + Vec3f{0.05f, 0.05f, 1.2f}, kCarbon.c);
            const Vec3f c0 = p + Vec3f{0, 0, 1.2f};
            const Vec3f q0 = c0 - lat * 0.9f, q1 = c0 + lat * 0.9f, q2 = q1 + Vec3f{0, 0, 0.9f}, q3 = q0 + Vec3f{0, 0, 0.9f};
            sb.addQuad(q0 - fwd * 0.02f, q1 - fwd * 0.02f, q2 - fwd * 0.02f, q3 - fwd * 0.02f, fwd * -1.0f, kDrsGreen.c);
        }
    }

    // Braking boards (3/2/1 stripes = 300/200/100 m) before the big stops.
    if (line.size() > 10) {
        const int m = static_cast<int>(line.size());
        for (int i = 0; i < m; ++i) {
            const double v = line.speed[i];
            const double vPrev = line.speed[(i - 1 + m) % m], vNext = line.speed[(i + 1) % m];
            if (!(v <= vPrev && v < vNext)) continue;  // local speed minimum (corner)
            // Find where braking starts.
            int j = i;
            for (int k = 0; k < m / 2; ++k) {
                const int jj = (i - k - 1 + m) % m;
                if (line.speed[jj] <= line.speed[(jj + 1) % m] + 0.01) break;
                j = jj;
            }
            if ((line.speed[j] - v) * 3.6 < 90.0) continue;
            const double sCorner = line.trackS[j] + (line.distance[i] >= line.distance[j]
                                                          ? line.distance[i] - line.distance[j]
                                                          : line.length - line.distance[j] + line.distance[i]);
            const double side = line.curvature[i] > 0 ? -1.0 : 1.0;  // outside of the corner
            for (int b = 1; b <= 3; ++b) {
                const double sb0 = track.wrapS(sCorner - 100.0 * b);
                const auto ts = track.sampleAt(sb0);
                const Section sc{sb0, ts};
                const double d = side > 0 ? ts.widthLeft + ts.kerbLeft + 2.5 : -ts.widthRight - ts.kerbRight - 2.5;
                const Vec3f p = point(sc, d);
                const Vec3f fwd{float(std::cos(ts.heading)), float(std::sin(ts.heading)), 0};
                const Vec3f lat{-fwd.y, fwd.x, 0};
                sb.addBox(p + Vec3f{-0.05f, -0.05f, 0}, p + Vec3f{0.05f, 0.05f, 1.0f}, kCarbon.c);
                const Vec3f c0 = p + Vec3f{0, 0, 1.0f};
                const float hw = 0.7f, hh = 0.9f;
                const Vec3f q0 = c0 - lat * hw, q1 = c0 + lat * hw, q2 = q1 + Vec3f{0, 0, 2 * hh}, q3 = q0 + Vec3f{0, 0, 2 * hh};
                const Vec3f nrm = fwd * -1.0f;
                sb.addQuad(q0 - fwd * 0.02f, q1 - fwd * 0.02f, q2 - fwd * 0.02f, q3 - fwd * 0.02f, nrm, kWhite.c);
                for (int st = 0; st < b; ++st) {
                    const float z0 = 0.25f + st * 0.5f;
                    const Vec3f s0 = q0 + Vec3f{0, 0, z0} + lat * 0.1f, s1 = q1 + Vec3f{0, 0, z0 + 0.25f} - lat * 0.1f;
                    const Vec3f s2 = s1 + Vec3f{0, 0, 0.18f}, s3 = s0 + Vec3f{0, 0, 0.18f};
                    sb.addQuad(s0 - fwd * 0.05f, s1 - fwd * 0.05f, s2 - fwd * 0.05f, s3 - fwd * 0.05f, nrm, kCarbon.c);
                }
            }
        }
    }
    // Trackside TV camera positions: every ~180 m, alternating sides, raised.
    for (double sc = 30.0; sc < track.length(); sc += 180.0) {
        const auto ts = track.sampleAt(sc);
        const bool left = static_cast<int>(sc / 180.0) % 2 == 0;
        const double d = left ? ts.widthLeft + ts.runoffLeft + 6.0 : -(ts.widthRight + ts.runoffRight + 6.0);
        const f1sim::Vec3 p = track.positionAt(sc, d);
        tvCams_.push_back({float(p.x), float(p.y), float(p.z + 7.0)});
    }
    track_ = tb.upload();
    scenery_ = sb.upload();
}

void Renderer::buildCar(const f1sim::CarParams& car, const std::string& dataDir, const std::string& modelConfig) {
    const float fx = float(car.front.x), rx = float(car.rear.x), cg = float(car.chassis.cgHeight);
    const float floorZ = -cg + 0.035f;
    // Livery colour from the car file ([visual] livery_rgb).
    Rgba livery{};
    for (int k = 0; k < 3; ++k) livery.c[k] = static_cast<uint8_t>(f1sim::clamp(car.visual.livery[k], 0.0f, 1.0f) * 255.0f + 0.5f);
    livery.c[3] = 255;
    const Rgba& kLivery = livery;
    // Front wing span follows the car width (2.0 m for 2022-25, 1.9 m for 2026).
    const float wing = 0.5f * float(car.chassis.width) - 0.05f;
    MeshBuilder b;
    // Floor and diffuser.
    b.addBox({rx - 0.55f, -0.8f, floorZ}, {fx - 0.45f, 0.8f, floorZ + 0.03f}, kCarbon.c);
    // Survival cell / monocoque.
    b.addBox({-0.95f, -0.40f, floorZ + 0.02f}, {1.2f, 0.40f, 0.25f}, kLivery.c);
    // Nose.
    b.addBox({1.2f, -0.17f, floorZ + 0.08f}, {fx + 0.95f, 0.17f, 0.12f}, kLivery.c);
    b.addBox({fx + 0.95f, -0.12f, floorZ + 0.08f}, {fx + 1.1f, 0.12f, 0.02f}, kWhite.c);
    // Front wing: main plane, flaps, endplates.
    b.addBox({fx + 0.55f, -wing, -cg + 0.07f}, {fx + 1.05f, wing, -cg + 0.10f}, kCarbon.c);
    b.addBox({fx + 0.50f, -wing, -cg + 0.12f}, {fx + 0.72f, wing, -cg + 0.15f}, kLivery.c);
    for (float s : {-1.0f, 1.0f}) b.addBox({fx + 0.5f, s * wing - 0.01f, -cg + 0.05f}, {fx + 1.05f, s * wing + 0.01f, -cg + 0.28f}, kWhite.c);
    // Sidepods.
    b.addBox({-0.95f, -0.78f, floorZ + 0.02f}, {0.65f, -0.40f, 0.10f}, kLivery.c);
    b.addBox({-0.95f, 0.40f, floorZ + 0.02f}, {0.65f, 0.78f, 0.10f}, kLivery.c);
    // Engine cover and airbox.
    b.addBox({rx - 0.05f, -0.30f, floorZ + 0.02f}, {-0.95f, 0.30f, 0.38f}, kCarbon.c);
    b.addBox({-0.95f, -0.22f, 0.25f}, {-0.05f, 0.22f, 0.58f}, kLivery.c);
    // Cockpit rim, headrest, driver helmet.
    b.addBox({0.05f, -0.28f, 0.25f}, {0.85f, -0.22f, 0.33f}, kCarbon.c);
    b.addBox({0.05f, 0.22f, 0.25f}, {0.85f, 0.28f, 0.33f}, kCarbon.c);
    const uint8_t helmet[4] = {240, 200, 40, 255};
    b.addBox({0.0f, -0.12f, 0.30f}, {0.24f, 0.12f, 0.55f}, helmet);
    // Halo: a hoop above the driver's eye line that converges onto a slim
    // centre pillar in front (as seen in real onboard footage).
    for (int k = 0; k < 8; ++k) {
        const float t0 = k / 8.0f, t1 = (k + 1) / 8.0f;
        const float x0 = 0.02f + 0.78f * t0, x1 = 0.02f + 0.78f * t1;
        const float y0 = 0.30f - 0.27f * t0 * t0, y1 = 0.30f - 0.27f * t1 * t1;
        for (float sd : {-1.0f, 1.0f}) {
            const float ya = sd * y0, yb = sd * y1;
            b.addBox({x0, std::min(ya, yb) - 0.01f, 0.655f}, {x1, std::max(ya, yb) + 0.01f, 0.675f}, kCarbon.c);
        }
    }
    b.addBox({0.00f, -0.31f, 0.25f}, {0.04f, -0.28f, 0.66f}, kCarbon.c);
    b.addBox({0.00f, 0.28f, 0.25f}, {0.04f, 0.31f, 0.66f}, kCarbon.c);
    b.addBox({0.80f, -0.014f, 0.25f}, {0.82f, 0.014f, 0.67f}, kCarbon.c);
    // Rear wing main plane, endplates and beam wing.
    b.addBox({rx - 0.62f, -0.5f, 0.55f}, {rx - 0.32f, 0.5f, 0.59f}, kCarbon.c);
    for (float s : {-1.0f, 1.0f}) b.addBox({rx - 0.65f, s * 0.5f - 0.012f, 0.05f}, {rx - 0.15f, s * 0.5f + 0.012f, 0.82f}, kLivery.c);
    b.addBox({rx - 0.40f, -0.35f, 0.15f}, {rx - 0.25f, 0.35f, 0.18f}, kCarbon.c);
    b.addBox({rx - 0.05f, -0.03f, 0.10f}, {rx + 0.05f, 0.03f, 0.55f}, kCarbon.c);
    body_ = b.upload();

    MeshBuilder f;
    f.addBox({-0.30f, -0.49f, -0.012f}, {0.0f, 0.49f, 0.012f}, kWhite.c);  // pivots at its leading edge
    flap_ = f.upload();

    MeshBuilder w;
    w.addCylinder(float(car.front.tyre.radius), float(car.front.tyre.width), 28, kTyre.c, kRim.c);
    wheelFront_ = w.upload();
    w.clear();
    w.addCylinder(float(car.rear.tyre.radius), float(car.rear.tyre.width), 28, kTyre.c, kRim.c);
    wheelRear_ = w.upload();

    MeshBuilder sw;  // steering wheel in its own frame: x = column axis
    sw.addBox({-0.02f, -0.14f, -0.07f}, {0.02f, 0.14f, 0.07f}, kCarbon.c);
    sw.addBox({-0.03f, -0.15f, -0.08f}, {0.0f, -0.10f, 0.08f}, kWhite.c);
    sw.addBox({-0.03f, 0.10f, -0.08f}, {0.0f, 0.15f, 0.08f}, kWhite.c);
    sw.addBox({-0.035f, -0.04f, 0.02f}, {-0.02f, 0.04f, 0.05f}, kLivery.c);
    steeringWheel_ = sw.upload();

    MeshBuilder ub;
    ub.addBox({0.0f, -0.5f, -0.5f}, {1.0f, 0.5f, 0.5f}, kCarbon.c);
    unitBox_ = ub.upload();

    // ---- External models (optional) ----
    f1sim::IniFile ini;
    std::string err;
    const std::string cfgPath = dataDir + "/" + modelConfig;
    if (!ini.loadFile(cfgPath, &err)) {
        SDL_Log("models: %s - using the built-in car", err.c_str());
        return;
    }
    auto placement = [&](const std::string& sec) {
        ModelPlacement p;
        p.file = ini.getString(sec + ".file", "");
        p.scale = float(ini.getDouble(sec + ".scale", 0.0));
        p.yawDeg = float(ini.getDouble(sec + ".yaw_deg", 0.0));
        p.offset = {float(ini.getDouble(sec + ".offset_x", 0.0)), float(ini.getDouble(sec + ".offset_y", 0.0)),
                    float(ini.getDouble(sec + ".offset_z", 0.0))};
        p.gltfAxes = ini.getString(sec + ".axes", "gltf") != "sim";
        return p;
    };
    const ModelPlacement body = placement("body");
    const ModelPlacement wheel = placement("wheel");
    bodyIncludesWheels_ = ini.getBool("body.includes_wheels", false);
    mirrorRightWheels_ = ini.getBool("wheel.mirror_right", true);
    std::string status;
    if (!body.file.empty()) {
        CpuModel cm;
        if (loadGltf(dataDir + "/" + body.file, body.gltfAxes, &cm, &err)) {
            const float nose = fx + 1.1f, tail = rx - 0.85f;
            const Vec3f anchor{(nose + tail) * 0.5f + body.offset.x, body.offset.y,
                               (bodyIncludesWheels_ ? -cg : floorZ) + body.offset.z};
            fitModel(&cm, 0, float(car.chassis.length), body.scale, body.yawDeg, anchor, true);
            bodyModel_ = uploadModel(cm);
            status = "body: " + body.file;
        } else {
            SDL_Log("models: %s", err.c_str());
            status = "body model failed (see log)";
        }
    }
    if (!wheel.file.empty() && !bodyIncludesWheels_) {
        for (int axle = 0; axle < 2; ++axle) {
            CpuModel cm;
            if (!loadGltf(dataDir + "/" + wheel.file, wheel.gltfAxes, &cm, &err)) {
                SDL_Log("models: %s", err.c_str());
                break;
            }
            const auto& tyre = axle == 0 ? car.front.tyre : car.rear.tyre;
            fitModel(&cm, 2, float(2.0 * tyre.radius), wheel.scale, wheel.yawDeg, wheel.offset, false);
            (axle == 0 ? wheelModelFront_ : wheelModelRear_) = uploadModel(cm);
        }
        if (wheelModelFront_.loaded()) status += (status.empty() ? "" : ", ") + std::string("wheel: ") + wheel.file;
    }
    if (!status.empty()) modelStatus_ = status;
}

void Renderer::drawMesh(const Mesh& m, const Mat4& model, const float tint[4], bool procedural) {
    gl::UniformMatrix4fv(u_.model, 1, GL_FALSE, model.m);
    gl::Uniform4f(u_.tint, tint[0], tint[1], tint[2], tint[3]);
    gl::Uniform1i(u_.procedural, procedural ? 1 : 0);
    gl::Uniform1i(u_.useTex, m.texture ? 1 : 0);
    if (m.texture) {
        gl::ActiveTexture(GL_TEXTURE0);
        gl::BindTexture(GL_TEXTURE_2D, m.texture);
    }
    m.draw();
}

void Renderer::drawCar(const Snapshot& s, CameraMode cam) {
    const auto& st = s.car;
    const Mat4 carM = Mat4::translate(toF(st.pos)) * Mat4::fromQuat(st.rot);
    const float white[4] = {1, 1, 1, 1};
    gl::Uniform1f(u_.spec, 0.35f);

    // Body.
    if (bodyModel_.loaded()) {
        for (const auto& p : bodyModel_.parts) drawMesh(p, carM, p.color);
    } else {
        drawMesh(body_, carM, white);
        // Rear wing flap opens in straight-line mode.
        const float angle = float(0.35 - 0.95 * st.aeroMode);
        const Mat4 flapM = carM * Mat4::translate({float(car_.rear.x) - 0.30f, 0.0f, 0.64f}) *
                           Mat4::rotateAxis({0, 1, 0}, angle);
        drawMesh(flap_, flapM, white);
    }

    // Wheels and suspension.
    if (!bodyIncludesWheels_) {
        for (int i = 0; i < 4; ++i) {
            const auto& w = st.wheels[i];
            const bool front = i < 2;
            const bool right = (i % 2) == 1;
            const Mat4 wm = Mat4::translate(toF(w.wheelCentre)) * Mat4::fromQuat(st.rot) *
                            Mat4::rotateAxis({0, 0, 1}, float(w.steer)) * Mat4::rotateAxis({0, 1, 0}, float(w.spinAngle));
            const Model& ext = front ? wheelModelFront_ : wheelModelRear_;
            if (ext.loaded()) {
                const Mat4 mm = (right && mirrorRightWheels_) ? wm * Mat4::scale({1, -1, 1}) : wm;
                for (const auto& p : ext.parts) drawMesh(p, mm, p.color);
            } else {
                // Outer face (rim side) points away from the car.
                const Mat4 mm = right ? wm * Mat4::scale({1, -1, 1}) : wm;
                drawMesh(front ? wheelFront_ : wheelRear_, mm, white);
            }
            if (!bodyModel_.loaded()) {
                // Wishbones from the chassis to the upright (show suspension travel).
                const auto& a = front ? car_.front : car_.rear;
                const float sd = right ? -1.0f : 1.0f;
                const Vec3f hub = toF(w.wheelCentre);
                for (float dz : {-0.10f, 0.10f}) {
                    const Vec3f inner = carM.transformPoint({float(a.x) + 0.15f, sd * 0.30f, float(-car_.chassis.cgHeight) + 0.25f + dz});
                    const Vec3f inner2 = carM.transformPoint({float(a.x) - 0.15f, sd * 0.30f, float(-car_.chassis.cgHeight) + 0.25f + dz});
                    const Vec3f outer = hub + toF(st.rot.rotate({0, 0, dz * 0.9}));
                    drawMesh(unitBox_, beam(inner, outer, 0.03f), white);
                    drawMesh(unitBox_, beam(inner2, outer, 0.03f), white);
                }
            }
        }
    }

    // Steering wheel (visible from the cockpit).
    if (cam == CameraMode::Cockpit || cam == CameraMode::Helmet) {
        const Mat4 swM = carM * Mat4::translate({0.72f, 0.0f, 0.36f}) * Mat4::rotateAxis({0, 1, 0}, -0.35f) *
                         Mat4::rotateAxis({1, 0, 0}, float(-st.steeringWheelAngle));
        drawMesh(steeringWheel_, swM, white);
    }
}

void Renderer::render(const Snapshot& s, int width, int height, CameraMode cam, float fovDeg, float dt) {
    const auto& st = s.car;
    const Mat4 carM = Mat4::translate(toF(st.pos)) * Mat4::fromQuat(st.rot);
    Vec3f eye, target, up{0, 0, 1};
    float fov = fovDeg * float(f1sim::kPi) / 180.0f;
    const float fx = float(car_.front.x), rx = float(car_.rear.x);
    auto onboard = [&](const Vec3f& e, const Vec3f& t) {
        eye = carM.transformPoint(e);
        target = carM.transformPoint(t);
        up = carM.transformDir({0, 0, 1});
    };
    auto chase = [&](float back, float rise, float stiffness) {
        // Follow rigidly in position; only the viewing direction is smoothed,
        // so the camera never lags behind at 300+ km/h.
        const f1sim::Vec3 fwdW = st.rot.rotate({1, 0, 0});
        const Vec3f dir = normalizef({float(fwdW.x), float(fwdW.y), 0.0f});
        if (!chaseInit_) { chaseEye_ = dir; chaseInit_ = true; }
        const float k = 1.0f - std::exp(-dt * stiffness);
        chaseEye_ = normalizef(chaseEye_ + (dir - chaseEye_) * k);  // smoothed heading
        eye = toF(st.pos) - chaseEye_ * back + Vec3f{0, 0, rise};
        target = toF(st.pos) + chaseEye_ * 2.0f + Vec3f{0, 0, 0.6f};
        fov = std::min(fov, 60.0f * float(f1sim::kPi) / 180.0f);
    };
    switch (cam) {
        case CameraMode::Cockpit: onboard({0.30f, 0.0f, 0.50f}, {10.0f, 0.0f, 0.38f}); break;
        case CameraMode::Helmet: {
            // The head moves against the g-forces (neck compliance), smoothed.
            const f1sim::Vec3 g = st.gForce();
            const Vec3f want{float(-g.x) * 0.010f, float(-g.y) * 0.012f, float(1.0 - g.z) * 0.008f};
            const float k = 1.0f - std::exp(-dt * 8.0f);
            headOffset_ = headOffset_ + (want - headOffset_) * k;
            const Vec3f e = Vec3f{0.24f, 0.0f, 0.49f} + headOffset_;
            onboard(e, e + Vec3f{10.0f, headOffset_.y * 4.0f, -0.12f});
            break;
        }
        case CameraMode::TCam: onboard({-0.55f, 0.0f, 0.82f}, {10.0f, 0.0f, 0.3f}); break;
        case CameraMode::Nose: onboard({fx + 1.16f, 0.0f, 0.03f}, {fx + 11.0f, 0.0f, -0.05f}); break;
        case CameraMode::Side: onboard({-0.2f, 0.62f, 0.14f}, {fx + 1.5f, 0.55f, -0.12f}); break;
        case CameraMode::Rear: onboard({rx - 0.4f, 0.0f, 0.95f}, {rx - 12.0f, 0.0f, 0.2f}); break;
        case CameraMode::ChaseNear: chase(6.0f, 1.9f, 7.0f); break;
        case CameraMode::ChaseFar: chase(11.0f, 3.2f, 4.0f); break;
        case CameraMode::TV: {
            // Nearest trackside camera with hysteresis; zoom keeps the car a similar size.
            const Vec3f carP = toF(st.pos);
            int best = tvCurrent_;
            float bestD = best >= 0 ? std::sqrt(dotf(tvCams_[best] - carP, tvCams_[best] - carP)) : 1e9f;
            for (size_t i = 0; i < tvCams_.size(); ++i) {
                const float d = std::sqrt(dotf(tvCams_[i] - carP, tvCams_[i] - carP));
                if (d < bestD * 0.7f) { bestD = d; best = static_cast<int>(i); }
            }
            tvCurrent_ = best;
            if (best >= 0) {
                eye = tvCams_[best];
                target = carP;
                fov = std::clamp(2.0f * std::atan(7.0f / std::max(bestD, 1.0f)), 0.06f, 1.0f);
            } else {
                chase(8.0f, 2.5f, 5.0f);
            }
            break;
        }
        default: onboard({0.30f, 0.0f, 0.50f}, {10.0f, 0.0f, 0.38f}); break;
    }
    if (cam != CameraMode::ChaseNear && cam != CameraMode::ChaseFar && cam != CameraMode::TV) chaseInit_ = false;
    camPos_ = eye;
    const float aspect = float(width) / float(std::max(height, 1));
    const bool onboardCam = cam == CameraMode::Cockpit || cam == CameraMode::Helmet || cam == CameraMode::Nose ||
                            cam == CameraMode::Side || cam == CameraMode::TCam || cam == CameraMode::Rear;
    const float nearZ = onboardCam ? 0.03f : 0.3f;
    const Mat4 view = Mat4::lookAt(eye, target, up);
    viewProj_ = Mat4::perspective(fov, aspect, nearZ, 4000.0f) * view;

    gl::Viewport(0, 0, width, height);
    gl::ClearColor(0.78f, 0.84f, 0.9f, 1.0f);
    gl::Clear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    // Sky.
    gl::Disable(GL_DEPTH_TEST);
    gl::UseProgram(sky_);
    const Vec3f fwd = normalizef(target - eye);
    const Vec3f right = normalizef(crossf(fwd, up));
    const Vec3f camUp = crossf(right, fwd);
    gl::Uniform3f(us_.camRight, right.x, right.y, right.z);
    gl::Uniform3f(us_.camUp, camUp.x, camUp.y, camUp.z);
    gl::Uniform3f(us_.camFwd, fwd.x, fwd.y, fwd.z);
    gl::Uniform1f(us_.tanHalf, std::tan(fov * 0.5f));
    gl::Uniform1f(us_.aspect, aspect);
    gl::Uniform3f(us_.sunDir, sunDir_.x, sunDir_.y, sunDir_.z);
    gl::BindVertexArray(skyVao_);
    gl::DrawArrays(GL_TRIANGLES, 0, 3);

    // World.
    gl::Enable(GL_DEPTH_TEST);
    gl::DepthFunc(GL_LEQUAL);
    gl::Disable(GL_CULL_FACE);  // external models are often not consistently wound
    gl::UseProgram(lit_);
    gl::UniformMatrix4fv(u_.viewProj, 1, GL_FALSE, viewProj_.m);
    gl::Uniform3f(u_.sunDir, sunDir_.x, sunDir_.y, sunDir_.z);
    gl::Uniform3f(u_.camPos, camPos_.x, camPos_.y, camPos_.z);
    gl::Uniform3f(u_.fogColor, 0.78f, 0.84f, 0.9f);
    gl::Uniform1f(u_.fogDensity, 0.0011f);
    gl::Uniform1i(u_.tex, 0);
    const float white[4] = {1, 1, 1, 1};
    gl::Uniform1f(u_.spec, 0.05f);
    drawMesh(track_, Mat4::identity(), white, true);
    drawMesh(scenery_, Mat4::identity(), white);
    drawCar(s, cam);
    gl::BindVertexArray(0);
}

void Renderer::shutdown() {
    track_.destroy();
    scenery_.destroy();
    body_.destroy();
    flap_.destroy();
    wheelFront_.destroy();
    wheelRear_.destroy();
    steeringWheel_.destroy();
    unitBox_.destroy();
    bodyModel_.destroy();
    wheelModelFront_.destroy();
    wheelModelRear_.destroy();
    if (skyVao_) gl::DeleteVertexArrays(1, &skyVao_);
    if (lit_) gl::DeleteProgram(lit_);
    if (sky_) gl::DeleteProgram(sky_);
    skyVao_ = lit_ = sky_ = 0;
}

}  // namespace app
