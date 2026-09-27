#include "content.hpp"

#include <SDL3/SDL.h>

#include <algorithm>

#include "f1sim/car_params.hpp"
#include "f1sim/track.hpp"

namespace app {
namespace {

std::vector<std::string> glob(const std::string& dir, const char* pattern) {
    std::vector<std::string> out;
    int count = 0;
    char** files = SDL_GlobDirectory(dir.c_str(), pattern, SDL_GLOB_CASEINSENSITIVE, &count);
    for (int i = 0; files && i < count; ++i) out.emplace_back(files[i]);
    SDL_free(files);
    std::sort(out.begin(), out.end());
    return out;
}

}  // namespace

int Catalog::findCar(const std::string& file) const {
    for (size_t i = 0; i < cars.size(); ++i) {
        if (cars[i].file == file) return static_cast<int>(i);
    }
    return -1;
}

int Catalog::findTrack(const std::string& file) const {
    for (size_t i = 0; i < tracks.size(); ++i) {
        if (tracks[i].file == file) return static_cast<int>(i);
    }
    return -1;
}

Catalog scanContent(const std::string& dataDir) {
    Catalog c;
    for (const auto& f : glob(dataDir + "/cars", "*.ini")) {
        CarEntry e;
        e.file = "cars/" + f;
        f1sim::CarParams p;
        std::vector<std::string> warnings;
        e.ok = f1sim::CarParams::load(dataDir + "/" + e.file, &p, &e.error, &warnings);
        e.name = e.ok ? p.name : f;
        e.description = p.description;
        for (int k = 0; k < 3; ++k) e.livery[k] = p.visual.livery[k];
        c.cars.push_back(std::move(e));
    }
    std::vector<std::string> trackFiles = glob(dataDir + "/tracks", "*.trk");
    for (const auto& f : glob(dataDir + "/tracks", "*.csv")) trackFiles.push_back(f);
    for (const auto& f : trackFiles) {
        TrackEntry e;
        e.file = "tracks/" + f;
        f1sim::Track t;
        e.ok = f1sim::Track::load(dataDir + "/" + e.file, &t, &e.error);
        e.name = e.ok && !t.name().empty() ? t.name() : f;
        if (e.ok) {
            e.length = t.length();
            double lo = 1e9, hi = -1e9;
            for (const auto& s : t.samples()) {
                lo = std::min(lo, s.pos.z);
                hi = std::max(hi, s.pos.z);
            }
            e.elevationRange = hi - lo;
            e.aeroZones = static_cast<int>(t.aeroZones().size());
        }
        c.tracks.push_back(std::move(e));
    }
    return c;
}

}  // namespace app
