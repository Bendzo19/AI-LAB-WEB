// Minimal INI reader/writer used for car data and user settings.
//
// Format:
//   # comment            ; comment
//   [section]
//   key = value          # trailing comments allowed
//   list = 1.0, 2.0, 3.5
//
// Keys are addressed as "section.key". Every key that is read is marked as
// used so callers can report typos (unknown keys) instead of silently
// ignoring them.
#pragma once

#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace f1sim {

class IniFile {
public:
    bool loadFile(const std::string& path, std::string* error);
    bool loadString(const std::string& text, std::string* error, const std::string& sourceName = "<string>");

    bool has(const std::string& key) const { return values_.count(key) != 0; }
    std::optional<std::string> getString(const std::string& key) const;
    std::optional<double> getDouble(const std::string& key) const;
    std::optional<std::vector<double>> getList(const std::string& key) const;

    std::string getString(const std::string& key, const std::string& fallback) const;
    double getDouble(const std::string& key, double fallback) const;
    bool getBool(const std::string& key, bool fallback) const;

    void set(const std::string& key, const std::string& value);
    void set(const std::string& key, double value);

    // Writes sections in key order. Comments from the source are not preserved.
    bool saveFile(const std::string& path, const std::string& header) const;

    std::vector<std::string> unusedKeys() const;
    const std::string& source() const { return source_; }

private:
    std::map<std::string, std::string> values_;
    std::map<std::string, int> lines_;
    mutable std::set<std::string> used_;
    std::string source_;
};

}  // namespace f1sim
