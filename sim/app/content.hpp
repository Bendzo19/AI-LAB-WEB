// Content catalog: cars (data/cars/*.ini) and tracks (data/tracks/*.trk,
// *.csv) found in the data directory, for the main menu.
#pragma once

#include <string>
#include <vector>

namespace app {

struct CarEntry {
    std::string file;         // relative to the data directory, e.g. "cars/f1_2025_generic.ini"
    std::string name, description;
    float livery[3] = {0.4f, 0.4f, 0.9f};
    bool ok = false;          // parsed without errors
    std::string error;
};

struct TrackEntry {
    std::string file;
    std::string name;
    double length = 0.0;      // [m]
    double elevationRange = 0.0;
    int aeroZones = 0;
    bool ok = false;
    std::string error;
};

struct Catalog {
    std::vector<CarEntry> cars;
    std::vector<TrackEntry> tracks;
    int findCar(const std::string& file) const;
    int findTrack(const std::string& file) const;
};

// Parses every file (tracks are fully built, a fraction of a second each).
Catalog scanContent(const std::string& dataDir);

}  // namespace app
