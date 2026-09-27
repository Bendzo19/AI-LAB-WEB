#include "f1sim/track.hpp"

#include <cmath>
#include <cstdint>
#include <fstream>
#include <sstream>

namespace f1sim {

const char* surfaceName(Surface s) {
    switch (s) {
        case Surface::Asphalt: return "asphalt";
        case Surface::Kerb: return "kerb";
        case Surface::Grass: return "grass";
        case Surface::Gravel: return "gravel";
        default: return "outside";
    }
}

namespace {

constexpr double kKerbHeight = 0.018;    // [m] top of kerb above asphalt
constexpr double kKerbRidge = 0.007;     // [m] ridge amplitude
constexpr double kKerbPitch = 0.9;       // [m] ridge spacing along the lap
constexpr double kGrassDrop = 0.03;      // [m] grass below track edge
constexpr double kWallMargin = 2.0;      // queries accepted this far beyond the wall

// Smooth deterministic value noise in 2D.
double hash2(int64_t x, int64_t y) {
    uint64_t h = static_cast<uint64_t>(x) * 0x9E3779B97F4A7C15ull ^ static_cast<uint64_t>(y) * 0xC2B2AE3D27D4EB4Full;
    h ^= h >> 31;
    h *= 0xBF58476D1CE4E5B9ull;
    h ^= h >> 27;
    return static_cast<double>(h & 0xFFFFFF) / static_cast<double>(0xFFFFFF) * 2.0 - 1.0;
}
double valueNoise(double x, double y) {
    const double fx = std::floor(x), fy = std::floor(y);
    const auto ix = static_cast<int64_t>(fx), iy = static_cast<int64_t>(fy);
    const double tx = x - fx, ty = y - fy;
    const double ux = tx * tx * (3.0 - 2.0 * tx), uy = ty * ty * (3.0 - 2.0 * ty);
    const double a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

std::string trim(const std::string& s) {
    const auto b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return {};
    const auto e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

// Centripetal Catmull-Rom between p1 and p2.
double catmull(double p0, double p1, double p2, double p3, double t0, double t1, double t2, double t3, double t) {
    auto safe = [](double a, double b) { return std::fabs(b - a) < 1e-9 ? 1e-9 : (b - a); };
    const double a1 = (t1 - t) / safe(t0, t1) * p0 + (t - t0) / safe(t0, t1) * p1;
    const double a2 = (t2 - t) / safe(t1, t2) * p1 + (t - t1) / safe(t1, t2) * p2;
    const double a3 = (t3 - t) / safe(t2, t3) * p2 + (t - t2) / safe(t2, t3) * p3;
    const double b1 = (t2 - t) / safe(t0, t2) * a1 + (t - t0) / safe(t0, t2) * a2;
    const double b2 = (t3 - t) / safe(t1, t3) * a2 + (t - t1) / safe(t1, t3) * a3;
    return (t2 - t) / safe(t1, t2) * b1 + (t - t1) / safe(t1, t2) * b2;
}

}  // namespace

bool Track::load(const std::string& path, Track* out, std::string* error) {
    const auto dot = path.find_last_of('.');
    const std::string ext = dot == std::string::npos ? "" : path.substr(dot + 1);
    if (ext == "trk") return loadTrk(path, out, error);
    if (ext == "csv") return loadCsv(path, out, error);
    if (error) *error = "unknown track format '" + path + "' (expected .trk or .csv)";
    return false;
}

bool Track::loadCsv(const std::string& path, Track* out, std::string* error) {
    std::ifstream in(path);
    if (!in) {
        if (error) *error = "cannot open '" + path + "'";
        return false;
    }
    std::vector<RawPoint> pts;
    std::vector<std::pair<double, double>> zones;
    std::string name;
    std::string line;
    int lineNo = 0;
    while (std::getline(in, line)) {
        ++lineNo;
        line = trim(line);
        if (line.empty()) continue;
        if (line[0] == '#') {
            // Optional directives in comments: "# name <text>", "# aero_zone <start_s> <end_s>".
            std::stringstream cs(line.substr(1));
            std::string key;
            cs >> key;
            if (key == "name") {
                std::getline(cs, name);
                name = trim(name);
            } else if (key == "aero_zone") {
                double a, b;
                if (cs >> a >> b) zones.push_back({a, b});
            }
            continue;
        }
        std::stringstream ss(line);
        std::string cell;
        std::vector<double> v;
        while (std::getline(ss, cell, ',')) {
            try {
                v.push_back(std::stod(trim(cell)));
            } catch (...) {
                if (error) *error = path + ":" + std::to_string(lineNo) + ": not a number";
                return false;
            }
        }
        if (v.size() < 4) {
            if (error) *error = path + ":" + std::to_string(lineNo) + ": expected x,y,w_right,w_left[,z]";
            return false;
        }
        // TUM order: x, y, w_tr_right, w_tr_left [, z]
        pts.push_back({v[0], v[1], v.size() > 4 ? v[4] : 0.0, v[3], v[2]});
    }
    Track t;
    const auto slash = path.find_last_of("/\\");
    t.name_ = name.empty() ? path.substr(slash == std::string::npos ? 0 : slash + 1) : name;
    if (!t.buildFromPolyline(pts, 0.0, error)) return false;
    if (!zones.empty()) t.aeroZones_ = zones;
    *out = std::move(t);
    return true;
}

bool Track::loadTrk(const std::string& path, Track* out, std::string* error) {
    std::ifstream in(path);
    if (!in) {
        if (error) *error = "cannot open '" + path + "'";
        return false;
    }
    struct Seg { bool arc; double len, radius, angle; bool free; };
    std::vector<Seg> segs;
    std::string name = "track";
    double width = 14.0, startOffset = 0.0, runoff = 25.0;
    std::vector<double> elev;  // amp1, phase1, amp2, phase2 (phases in cycles)
    std::vector<std::pair<double, double>> zones;
    std::string line;
    int lineNo = 0;
    auto fail = [&](const std::string& msg) {
        if (error) *error = path + ":" + std::to_string(lineNo) + ": " + msg;
        return false;
    };
    while (std::getline(in, line)) {
        ++lineNo;
        const auto c = line.find('#');
        if (c != std::string::npos) line = line.substr(0, c);
        line = trim(line);
        if (line.empty()) continue;
        std::stringstream ss(line);
        std::string cmd;
        ss >> cmd;
        if (cmd == "name") {
            std::getline(ss, name);
            name = trim(name);
        } else if (cmd == "width") {
            if (!(ss >> width) || width <= 4.0) return fail("width must be > 4 m");
        } else if (cmd == "runoff") {
            if (!(ss >> runoff) || runoff < 3.0) return fail("runoff must be >= 3 m");
        } else if (cmd == "start_offset") {
            if (!(ss >> startOffset)) return fail("start_offset needs a number");
        } else if (cmd == "aero_zone") {
            double a, b;
            if (!(ss >> a >> b)) return fail("aero_zone needs: start_s end_s (lap distance from the line)");
            zones.push_back({a, b});
        } else if (cmd == "elevation") {
            double v;
            while (ss >> v) elev.push_back(v);
            if (elev.size() != 4) return fail("elevation needs: amp1 phase1 amp2 phase2");
        } else if (cmd == "straight" || cmd == "straight_free") {
            double len;
            if (!(ss >> len) || len < 0.0) return fail("straight needs a length >= 0");
            segs.push_back({false, len, 0.0, 0.0, cmd == "straight_free"});
        } else if (cmd == "arc") {
            double r, a;
            if (!(ss >> r >> a) || r < 5.0) return fail("arc needs: radius(>=5) angle_deg(+left)");
            segs.push_back({true, 0.0, r, deg2rad(a), false});
        } else {
            return fail("unknown command '" + cmd + "'");
        }
    }
    int freeCount = 0;
    double totalAngle = 0.0;
    for (const auto& s : segs) {
        freeCount += s.free ? 1 : 0;
        totalAngle += s.arc ? s.angle : 0.0;
    }
    if (std::fabs(std::fabs(totalAngle) - 2.0 * kPi) > 1e-6) {
        if (error) *error = path + ": arc angles must sum to +-360 deg (got " + std::to_string(rad2deg(totalAngle)) + ")";
        return false;
    }
    if (freeCount != 2) {
        if (error) *error = path + ": exactly two 'straight_free' segments are required for closure";
        return false;
    }

    // Walk the turtle; free straights contribute len * direction.
    auto walk = [&](const std::vector<double>& freeLens, std::vector<Vec3>* pts) {
        double x = 0.0, y = 0.0, h = 0.0;
        int fi = 0;
        if (pts) pts->push_back({x, y, 0.0});
        for (const auto& s : segs) {
            if (!s.arc) {
                const double len = s.free ? freeLens[fi++] : s.len;
                if (pts) {
                    const int n = std::max(1, static_cast<int>(std::ceil(len / 0.5)));
                    for (int i = 1; i <= n; ++i) {
                        pts->push_back({x + std::cos(h) * len * i / n, y + std::sin(h) * len * i / n, 0.0});
                    }
                }
                x += std::cos(h) * len;
                y += std::sin(h) * len;
            } else {
                const double arcLen = s.radius * std::fabs(s.angle);
                const int n = std::max(2, static_cast<int>(std::ceil(arcLen / 0.5)));
                const double dir = sign(s.angle);
                const double cx = x - std::sin(h) * s.radius * dir;
                const double cy = y + std::cos(h) * s.radius * dir;
                for (int i = 1; i <= n; ++i) {
                    const double hh = h + s.angle * i / n;
                    const double px = cx + std::sin(hh) * s.radius * dir;
                    const double py = cy - std::cos(hh) * s.radius * dir;
                    if (pts) pts->push_back({px, py, 0.0});
                }
                h += s.angle;
                x = cx + std::sin(h) * s.radius * dir;
                y = cy - std::cos(h) * s.radius * dir;
            }
        }
        return Vec3{x, y, 0.0};
    };
    // End position is affine in the two free lengths: solve for closure.
    const Vec3 e00 = walk({0.0, 0.0}, nullptr);
    const Vec3 e10 = walk({1.0, 0.0}, nullptr);
    const Vec3 e01 = walk({0.0, 1.0}, nullptr);
    const double a11 = e10.x - e00.x, a21 = e10.y - e00.y, a12 = e01.x - e00.x, a22 = e01.y - e00.y;
    const double det = a11 * a22 - a12 * a21;
    if (std::fabs(det) < 1e-6) {
        if (error) *error = path + ": free straights are parallel, closure cannot be solved";
        return false;
    }
    const double l1 = (-e00.x * a22 + e00.y * a12) / det;
    const double l2 = (-e00.y * a11 + e00.x * a21) / det;
    double minLen[2] = {10.0, 10.0};
    {
        int fi = 0;
        for (const auto& sg : segs) if (sg.free) { minLen[fi] = std::max(minLen[fi], sg.len); ++fi; }
    }
    if (l1 < minLen[0] || l2 < minLen[1]) {
        if (error) {
            *error = path + ": closure needs free straights of " + std::to_string(l1) + " m and " +
                     std::to_string(l2) + " m, below the requested minimum - adjust the layout";
        }
        return false;
    }
    std::vector<Vec3> pts;
    walk({l1, l2}, &pts);
    pts.pop_back();  // last point coincides with the first

    // Thin to ~2 m spacing for the spline pass and add elevation.
    std::vector<RawPoint> raw;
    double acc = 0.0;
    double total = 0.0;
    for (size_t i = 1; i < pts.size(); ++i) total += f1sim::length(pts[i] - pts[i - 1]);
    total += f1sim::length(pts.front() - pts.back());
    double s = 0.0;
    for (size_t i = 0; i < pts.size(); ++i) {
        if (i > 0) {
            const double d = f1sim::length(pts[i] - pts[i - 1]);
            acc += d;
            s += d;
        }
        if (i == 0 || acc >= 2.0) {
            acc = 0.0;
            double z = 0.0;
            if (elev.size() == 4) {
                const double u = s / total;
                z = elev[0] * std::sin(2.0 * kPi * (u + elev[1])) + elev[2] * std::sin(4.0 * kPi * (u + elev[3]));
            }
            raw.push_back({pts[i].x, pts[i].y, z, width * 0.5, width * 0.5});
        }
    }
    Track t;
    t.name_ = name;
    if (!t.buildFromPolyline(raw, startOffset, error)) return false;
    for (auto& smp : t.samples_) {
        smp.runoffLeft = runoff;
        smp.runoffRight = runoff;
    }
    if (!zones.empty()) t.aeroZones_ = zones;
    t.buildGrid();
    *out = std::move(t);
    return true;
}

bool Track::buildFromPolyline(const std::vector<RawPoint>& in, double startS, std::string* error) {
    if (in.size() < 8) {
        if (error) *error = "track needs at least 8 points";
        return false;
    }
    // Drop a duplicated closing point if present.
    std::vector<RawPoint> pts = in;
    if (std::hypot(pts.front().x - pts.back().x, pts.front().y - pts.back().y) < 0.5) pts.pop_back();
    const size_t n = pts.size();

    // Centripetal parametrisation of the closed loop.
    std::vector<double> knot(n + 1, 0.0);
    for (size_t i = 0; i < n; ++i) {
        const auto& a = pts[i];
        const auto& b = pts[(i + 1) % n];
        knot[i + 1] = knot[i] + std::sqrt(std::max(std::hypot(b.x - a.x, b.y - a.y), 1e-6));
    }
    auto evalSeg = [&](size_t i, double u, RawPoint* out) {
        const auto& p0 = pts[(i + n - 1) % n];
        const auto& p1 = pts[i];
        const auto& p2 = pts[(i + 1) % n];
        const auto& p3 = pts[(i + 2) % n];
        const double t1 = 0.0;
        const double t0 = -std::sqrt(std::max(std::hypot(p1.x - p0.x, p1.y - p0.y), 1e-6));
        const double t2 = std::sqrt(std::max(std::hypot(p2.x - p1.x, p2.y - p1.y), 1e-6));
        const double t3 = t2 + std::sqrt(std::max(std::hypot(p3.x - p2.x, p3.y - p2.y), 1e-6));
        const double t = t1 + (t2 - t1) * u;
        out->x = catmull(p0.x, p1.x, p2.x, p3.x, t0, t1, t2, t3, t);
        out->y = catmull(p0.y, p1.y, p2.y, p3.y, t0, t1, t2, t3, t);
        out->z = catmull(p0.z, p1.z, p2.z, p3.z, t0, t1, t2, t3, t);
        out->wLeft = lerp(p1.wLeft, p2.wLeft, u);
        out->wRight = lerp(p1.wRight, p2.wRight, u);
    };
    // Dense evaluation, then arc-length resampling at `spacing_`.
    std::vector<RawPoint> dense;
    for (size_t i = 0; i < n; ++i) {
        const double segLen = std::hypot(pts[(i + 1) % n].x - pts[i].x, pts[(i + 1) % n].y - pts[i].y);
        const int m = std::max(2, static_cast<int>(std::ceil(segLen / 0.1)));
        for (int k = 0; k < m; ++k) {
            RawPoint rp;
            evalSeg(i, static_cast<double>(k) / m, &rp);
            dense.push_back(rp);
        }
    }
    std::vector<double> cum(dense.size() + 1, 0.0);
    for (size_t i = 0; i < dense.size(); ++i) {
        const auto& a = dense[i];
        const auto& b = dense[(i + 1) % dense.size()];
        cum[i + 1] = cum[i] + std::sqrt(sq(b.x - a.x) + sq(b.y - a.y) + sq(b.z - a.z));
    }
    const double total = cum.back();
    const int count = static_cast<int>(std::round(total / 1.0));
    spacing_ = total / count;
    length_ = total;
    startS = std::fmod(std::fmod(startS, total) + total, total);

    samples_.assign(count, TrackSample{});
    size_t j = 0;
    for (int k = 0; k < count; ++k) {
        double target = startS + k * spacing_;
        if (target >= total) target -= total;
        if (k == 0 || target < cum[j]) j = 0;
        while (j + 1 < cum.size() && cum[j + 1] < target) ++j;
        const auto& a = dense[j % dense.size()];
        const auto& b = dense[(j + 1) % dense.size()];
        const double u = (target - cum[j]) / std::max(cum[j + 1] - cum[j], 1e-9);
        auto& smp = samples_[k];
        smp.s = k * spacing_;
        smp.pos = {lerp(a.x, b.x, u), lerp(a.y, b.y, u), lerp(a.z, b.z, u)};
        smp.widthLeft = lerp(a.wLeft, b.wLeft, u);
        smp.widthRight = lerp(a.wRight, b.wRight, u);
    }
    // Headings and curvature from central differences.
    for (int k = 0; k < count; ++k) {
        const auto& p = samples_[(k + count - 1) % count].pos;
        const auto& q = samples_[(k + 1) % count].pos;
        samples_[k].heading = std::atan2(q.y - p.y, q.x - p.x);
    }
    for (int k = 0; k < count; ++k) {
        const double h0 = samples_[(k + count - 1) % count].heading;
        const double h1 = samples_[(k + 1) % count].heading;
        samples_[k].curvature = wrapAngle(h1 - h0) / (2.0 * spacing_);
    }
    // Light smoothing of curvature (used for kerbs, braking boards, AI).
    for (int pass = 0; pass < 3; ++pass) {
        std::vector<double> c(count);
        for (int k = 0; k < count; ++k) {
            c[k] = 0.25 * samples_[(k + count - 1) % count].curvature + 0.5 * samples_[k].curvature +
                   0.25 * samples_[(k + 1) % count].curvature;
        }
        for (int k = 0; k < count; ++k) samples_[k].curvature = c[k];
    }
    autoKerbs();
    autoAeroZones();
    buildGrid();
    return true;
}

void Track::autoKerbs() {
    const int n = static_cast<int>(samples_.size());
    std::vector<double> kl(n, 0.0), kr(n, 0.0);
    const int reach = static_cast<int>(20.0 / spacing_);
    for (int k = 0; k < n; ++k) {
        const double c = samples_[k].curvature;
        if (std::fabs(c) < 1.0 / 180.0) continue;
        // Inside kerb plus a wider exit kerb on the outside.
        for (int j = -reach; j <= reach; ++j) {
            const int idx = (k + j + n) % n;
            if (c > 0.0) kl[idx] = std::max(kl[idx], 1.2);
            else kr[idx] = std::max(kr[idx], 1.2);
        }
        for (int j = 0; j <= 2 * reach; ++j) {
            const int idx = (k + j) % n;
            if (c > 0.0) kr[idx] = std::max(kr[idx], 1.6);
            else kl[idx] = std::max(kl[idx], 1.6);
        }
    }
    for (int k = 0; k < n; ++k) {
        samples_[k].kerbLeft = kl[k];
        samples_[k].kerbRight = kr[k];
    }
}

void Track::buildGrid() {
    if (pad_ || samples_.empty()) return;
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18, maxExtent = 0.0;
    for (const auto& s : samples_) {
        minX = std::min(minX, s.pos.x);
        minY = std::min(minY, s.pos.y);
        maxX = std::max(maxX, s.pos.x);
        maxY = std::max(maxY, s.pos.y);
        maxExtent = std::max({maxExtent, s.widthLeft + s.runoffLeft, s.widthRight + s.runoffRight});
    }
    const double pad = maxExtent + kWallMargin + cell_;
    gridMinX_ = minX - pad;
    gridMinY_ = minY - pad;
    gridW_ = static_cast<int>(std::ceil((maxX - minX + 2 * pad) / cell_));
    gridH_ = static_cast<int>(std::ceil((maxY - minY + 2 * pad) / cell_));
    grid_.assign(static_cast<size_t>(gridW_) * gridH_, {});
    const int n = static_cast<int>(samples_.size());
    for (int i = 0; i < n; ++i) {
        const auto& a = samples_[i];
        const auto& b = samples_[(i + 1) % n];
        const double ext = std::max({a.widthLeft + a.runoffLeft, a.widthRight + a.runoffRight}) + kWallMargin;
        const int x0 = static_cast<int>((std::min(a.pos.x, b.pos.x) - ext - gridMinX_) / cell_);
        const int x1 = static_cast<int>((std::max(a.pos.x, b.pos.x) + ext - gridMinX_) / cell_);
        const int y0 = static_cast<int>((std::min(a.pos.y, b.pos.y) - ext - gridMinY_) / cell_);
        const int y1 = static_cast<int>((std::max(a.pos.y, b.pos.y) + ext - gridMinY_) / cell_);
        for (int gy = std::max(0, y0); gy <= std::min(gridH_ - 1, y1); ++gy) {
            for (int gx = std::max(0, x0); gx <= std::min(gridW_ - 1, x1); ++gx) {
                grid_[static_cast<size_t>(gy) * gridW_ + gx].push_back(i);
            }
        }
    }
    buildHeightGrid();
}

Track Track::flatPad() {
    Track t;
    t.pad_ = true;
    t.name_ = "flat pad";
    t.length_ = 1.0e9;
    return t;
}

double Track::wrapS(double s) const {
    if (pad_) return s;
    s = std::fmod(s, length_);
    return s < 0.0 ? s + length_ : s;
}

double Track::deltaS(double a, double b) const {
    if (pad_) return b - a;
    double d = std::fmod(b - a, length_);
    if (d > length_ * 0.5) d -= length_;
    if (d <= -length_ * 0.5) d += length_;
    return d;
}

bool Track::inAeroZone(double s) const {
    if (pad_) return true;
    s = wrapS(s);
    for (const auto& z : aeroZones_) {
        if (z.first <= z.second ? (s >= z.first && s < z.second) : (s >= z.first || s < z.second)) return true;
    }
    return false;
}

void Track::autoAeroZones(double minLength) {
    aeroZones_.clear();
    const int n = static_cast<int>(samples_.size());
    if (n == 0) return;
    // Start scanning from a curved sample so a straight across the lap line is one run.
    int start = 0;
    for (int i = 0; i < n; ++i) {
        if (std::fabs(samples_[i].curvature) > 1.0 / 600.0) { start = i; break; }
    }
    int runStart = -1;
    for (int k = 1; k <= n; ++k) {
        const int i = (start + k) % n;
        const bool straight = std::fabs(samples_[i].curvature) < 1.0 / 600.0 && k < n;
        if (straight && runStart < 0) runStart = i;
        if (!straight && runStart >= 0) {
            const double len = wrapS(samples_[i].s - samples_[runStart].s);
            // Activation begins a little after the corner exit, like real DRS lines.
            if (len >= minLength) aeroZones_.push_back({wrapS(samples_[runStart].s + 60.0), samples_[i].s});
            runStart = -1;
        }
    }
}

TrackSample Track::sampleAt(double s) const {
    if (pad_) {
        TrackSample t;
        t.s = s;
        t.pos = {s, 0.0, 0.0};
        t.widthLeft = t.widthRight = 1000.0;
        return t;
    }
    s = wrapS(s);
    const int n = static_cast<int>(samples_.size());
    const double f = s / spacing_;
    const int i = static_cast<int>(f) % n;
    const int j = (i + 1) % n;
    const double u = f - std::floor(f);
    const auto& a = samples_[i];
    const auto& b = samples_[j];
    TrackSample t = a;
    t.s = s;
    t.pos = a.pos + (b.pos - a.pos) * u;
    t.heading = a.heading + wrapAngle(b.heading - a.heading) * u;
    t.curvature = lerp(a.curvature, b.curvature, u);
    t.widthLeft = lerp(a.widthLeft, b.widthLeft, u);
    t.widthRight = lerp(a.widthRight, b.widthRight, u);
    t.bank = lerp(a.bank, b.bank, u);
    t.kerbLeft = u < 0.5 ? a.kerbLeft : b.kerbLeft;
    t.kerbRight = u < 0.5 ? a.kerbRight : b.kerbRight;
    t.runoffLeft = lerp(a.runoffLeft, b.runoffLeft, u);
    t.runoffRight = lerp(a.runoffRight, b.runoffRight, u);
    return t;
}

double Track::headingAt(double s) const { return pad_ ? 0.0 : sampleAt(s).heading; }

Vec3 Track::positionAt(double s, double d) const {
    if (pad_) return {s, d, 0.0};
    const TrackSample t = sampleAt(s);
    const Vec3 normal{-std::sin(t.heading), std::cos(t.heading), 0.0};
    Vec3 p = t.pos + normal * d;
    p.z = heightAt(s, d);
    return p;
}

double Track::bumps(double s, double d, Surface surf) const {
    if (bumpScale_ <= 0.0) return 0.0;
    // Long-wave undulation, medium bumps and fine texture. Amplitudes are in
    // the range measured on permanent circuits (a few mm).
    double z = 0.0030 * valueNoise(s / 14.0, d / 9.0) + 0.0012 * valueNoise(s / 3.1 + 17.0, d / 2.7) +
               0.0004 * valueNoise(s / 0.7 + 91.0, d / 0.9);
    if (surf == Surface::Grass || surf == Surface::Gravel) z += 0.008 * valueNoise(s / 1.3 + 5.0, d / 1.3);
    return z * bumpScale_;
}

double Track::surfaceOffset(double s, double d, Surface* surface) const {
    const TrackSample t = sampleAt(s);
    double z = std::tan(t.bank) * d;
    const double edge = d >= 0.0 ? t.widthLeft : t.widthRight;
    const double kerb = d >= 0.0 ? t.kerbLeft : t.kerbRight;
    const double ad = std::fabs(d);
    Surface surf = Surface::Asphalt;
    if (ad > edge) {
        const double out = ad - edge;
        if (kerb > 0.0 && out <= kerb) {
            surf = Surface::Kerb;
            const double ramp = smoothstep(0.0, 0.15, out);
            const double phase = std::fmod(s, kKerbPitch) / kKerbPitch;
            const double ridge = 1.0 - std::fabs(2.0 * phase - 1.0);  // triangle wave
            z += ramp * (kKerbHeight + kKerbRidge * ridge);
        } else {
            surf = Surface::Grass;
            const double from = kerb > 0.0 ? out - kerb : out;
            z -= kGrassDrop * smoothstep(0.0, 0.6, from);
        }
    }
    if (surface) *surface = surf;
    return z + bumps(s, d, surf);
}

void Track::buildHeightGrid() {
    hg_.clear();
    if (pad_ || samples_.empty()) return;
    // Gaussian splat of the centre-line heights: exact on straight grades,
    // smooth everywhere, and legs of a hairpin (>12 m apart) do not mix.
    constexpr double kSigma = 4.0, kReach = 45.0;
    double minX = 1e18, minY = 1e18, maxX = -1e18, maxY = -1e18;
    for (const auto& p : samples_) {
        minX = std::min(minX, p.pos.x); maxX = std::max(maxX, p.pos.x);
        minY = std::min(minY, p.pos.y); maxY = std::max(maxY, p.pos.y);
    }
    const double margin = kReach + 5.0;
    hgMinX_ = minX - margin;
    hgMinY_ = minY - margin;
    hgW_ = static_cast<int>(std::ceil((maxX - minX + 2 * margin) / hgCell_)) + 1;
    hgH_ = static_cast<int>(std::ceil((maxY - minY + 2 * margin) / hgCell_)) + 1;
    std::vector<double> wz(static_cast<size_t>(hgW_) * hgH_, 0.0), ww(wz.size(), 0.0);
    const int reach = static_cast<int>(std::ceil(kReach / hgCell_));
    for (const auto& p : samples_) {
        const int cx = static_cast<int>((p.pos.x - hgMinX_) / hgCell_);
        const int cy = static_cast<int>((p.pos.y - hgMinY_) / hgCell_);
        for (int gy = std::max(0, cy - reach); gy <= std::min(hgH_ - 1, cy + reach); ++gy) {
            for (int gx = std::max(0, cx - reach); gx <= std::min(hgW_ - 1, cx + reach); ++gx) {
                const double dx = hgMinX_ + gx * hgCell_ - p.pos.x, dy = hgMinY_ + gy * hgCell_ - p.pos.y;
                const double d2 = dx * dx + dy * dy;
                if (d2 > kReach * kReach) continue;
                // Far from the track a weak long-range term keeps the terrain continuous.
                const double w = std::exp(-d2 / (2.0 * kSigma * kSigma)) + 1e-9 * std::exp(-std::sqrt(d2) / 10.0);
                const size_t k = static_cast<size_t>(gy) * hgW_ + gx;
                wz[k] += w * p.pos.z;
                ww[k] += w;
            }
        }
    }
    hg_.resize(wz.size());
    std::vector<uint8_t> known(wz.size(), 0);
    for (size_t k = 0; k < wz.size(); ++k) {
        known[k] = ww[k] > 0.0 ? 1 : 0;
        hg_[k] = known[k] ? static_cast<float>(wz[k] / ww[k]) : 0.0f;
    }
    // Cells beyond the splat reach (only the scenery terrain uses them) are filled by
    // growing inwards from the known cells, so the terrain stays continuous.
    for (bool changed = true; changed;) {
        changed = false;
        std::vector<uint8_t> next = known;
        for (int gy = 0; gy < hgH_; ++gy) {
            for (int gx = 0; gx < hgW_; ++gx) {
                const size_t k = static_cast<size_t>(gy) * hgW_ + gx;
                if (known[k]) continue;
                double sum = 0.0;
                int cnt = 0;
                for (int oy = -1; oy <= 1; ++oy) {
                    for (int ox = -1; ox <= 1; ++ox) {
                        const int nx = gx + ox, ny = gy + oy;
                        if (nx < 0 || ny < 0 || nx >= hgW_ || ny >= hgH_) continue;
                        const size_t kk = static_cast<size_t>(ny) * hgW_ + nx;
                        if (known[kk]) { sum += hg_[kk]; ++cnt; }
                    }
                }
                if (cnt > 0) {
                    hg_[k] = static_cast<float>(sum / cnt);
                    next[k] = 1;
                    changed = true;
                }
            }
        }
        known.swap(next);
    }
}

double Track::terrainHeight(double x, double y) const { return baseHeight(x, y); }

void Track::terrainBounds(double* minX, double* minY, double* maxX, double* maxY) const {
    *minX = hgMinX_;
    *minY = hgMinY_;
    *maxX = hgMinX_ + (hgW_ - 1) * hgCell_;
    *maxY = hgMinY_ + (hgH_ - 1) * hgCell_;
}

double Track::baseHeight(double x, double y) const {
    if (hg_.empty()) return samples_.empty() ? 0.0 : samples_.front().pos.z;
    const double fx = clamp((x - hgMinX_) / hgCell_, 0.0, hgW_ - 1.001);
    const double fy = clamp((y - hgMinY_) / hgCell_, 0.0, hgH_ - 1.001);
    const int ix = static_cast<int>(fx), iy = static_cast<int>(fy);
    const double tx = fx - ix, ty = fy - iy;
    const size_t k = static_cast<size_t>(iy) * hgW_ + ix;
    const double a = hg_[k], b = hg_[k + 1], c = hg_[k + hgW_], d = hg_[k + hgW_ + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

double Track::heightAt(double s, double d, Surface* surface) const {
    if (pad_) {
        if (surface) *surface = Surface::Asphalt;
        return 0.0;
    }
    const TrackSample t = sampleAt(s);
    const double base = hg_.empty() ? t.pos.z
                                    : baseHeight(t.pos.x - std::sin(t.heading) * d, t.pos.y + std::cos(t.heading) * d);
    return base + surfaceOffset(s, d, surface);
}

GroundHit Track::query(const Vec3& p, int hint) const {
    GroundHit hit;
    if (pad_) {
        hit.height = 0.0;
        hit.s = p.x;
        hit.d = p.y;
        hit.wallLeft = 1e9;
        hit.wallRight = -1e9;
        return hit;
    }
    const int n = static_cast<int>(samples_.size());
    int best = -1;
    double bestScore = 1e18, bestT = 0.0, bestD = 0.0;
    auto consider = [&](int i) {
        const auto& a = samples_[i];
        const auto& b = samples_[(i + 1) % n];
        const double ex = b.pos.x - a.pos.x, ey = b.pos.y - a.pos.y;
        const double len2 = ex * ex + ey * ey;
        double t = ((p.x - a.pos.x) * ex + (p.y - a.pos.y) * ey) / len2;
        t = clamp(t, 0.0, 1.0);
        const double cx = a.pos.x + ex * t, cy = a.pos.y + ey * t;
        const double dx = p.x - cx, dy = p.y - cy;
        const double dist = std::hypot(dx, dy);
        const double inv = 1.0 / std::sqrt(len2);
        const double d = (-ey * dx + ex * dy) * inv;  // + = left of travel
        const double lim = d >= 0.0 ? lerp(a.widthLeft + a.runoffLeft, b.widthLeft + b.runoffLeft, t)
                                    : lerp(a.widthRight + a.runoffRight, b.widthRight + b.runoffRight, t);
        if (std::fabs(d) > lim + kWallMargin) return;
        // Closest segment wins. Height only matters where the lap crosses
        // itself (bridges): a small penalty here would bias the projection
        // along steep slopes and misplace the ground by centimetres.
        const double cz = lerp(a.pos.z, b.pos.z, t);
        const double dz = std::fabs(p.z - cz);
        const double score = dist + (dz > 3.0 ? 4.0 * (dz - 3.0) : 0.0);
        if (score < bestScore) {
            bestScore = score;
            best = i;
            bestT = t;
            bestD = d;
        }
    };
    if (hint >= 0 && hint < n) {
        for (int k = -3; k <= 3; ++k) consider((hint + k + n) % n);
    }
    // The local search around the hint is trusted only when the projection
    // falls strictly inside a segment; otherwise fall back to the grid.
    if (best < 0 || bestT <= 0.0 || bestT >= 1.0) {
        const int gx = static_cast<int>((p.x - gridMinX_) / cell_);
        const int gy = static_cast<int>((p.y - gridMinY_) / cell_);
        if (gx >= 0 && gy >= 0 && gx < gridW_ && gy < gridH_) {
            for (int i : grid_[static_cast<size_t>(gy) * gridW_ + gx]) consider(i);
        }
    }
    if (best < 0) {
        // Far outside the modelled area: flat grass at the nearest known height.
        hit.surface = Surface::Outside;
        hit.grip = 0.5;
        hit.rollingDrag = 0.08;
        hit.onTrack = false;
        hit.height = samples_.empty() ? 0.0 : samples_.front().pos.z;
        hit.wallLeft = 1e9;
        hit.wallRight = -1e9;
        return hit;
    }
    const double s = wrapS(samples_[best].s + bestT * spacing_);
    const double d = bestD;
    Surface surf;
    const double off = surfaceOffset(s, d, &surf);
    const double z = baseHeight(p.x, p.y) + off;
    // Gradient: smooth base field in x/y plus the surface detail in lap coordinates.
    const double eb = 0.5;
    const double bx = (baseHeight(p.x + eb, p.y) - baseHeight(p.x - eb, p.y)) / (2.0 * eb);
    const double by = (baseHeight(p.x, p.y + eb) - baseHeight(p.x, p.y - eb)) / (2.0 * eb);
    const double e = 0.05;
    const double dods = (surfaceOffset(s + e, d, nullptr) - surfaceOffset(s - e, d, nullptr)) / (2.0 * e);
    const double dodd = (surfaceOffset(s, d + e, nullptr) - surfaceOffset(s, d - e, nullptr)) / (2.0 * e);
    const double h = headingAt(s);
    const double gx = bx + dods * std::cos(h) - dodd * std::sin(h);
    const double gy = by + dods * std::sin(h) + dodd * std::cos(h);
    const TrackSample ts = sampleAt(s);

    hit.height = z;
    hit.normal = normalize(Vec3{-gx, -gy, 1.0});
    hit.surface = surf;
    hit.s = s;
    hit.d = d;
    hit.segment = best;
    hit.onTrack = d <= ts.widthLeft && d >= -ts.widthRight;
    hit.wallLeft = ts.widthLeft + ts.runoffLeft;
    hit.wallRight = -(ts.widthRight + ts.runoffRight);
    switch (surf) {
        case Surface::Asphalt: hit.grip = 1.0; hit.rollingDrag = 0.0; break;
        case Surface::Kerb: hit.grip = 0.92; hit.rollingDrag = 0.004; break;
        case Surface::Grass: hit.grip = 0.55; hit.rollingDrag = 0.05; break;
        case Surface::Gravel: hit.grip = 0.45; hit.rollingDrag = 0.25; break;
        default: hit.grip = 0.5; hit.rollingDrag = 0.08; break;
    }
    return hit;
}

}  // namespace f1sim
