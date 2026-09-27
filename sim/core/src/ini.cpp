#include "f1sim/ini.hpp"

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace f1sim {
namespace {

std::string trim(const std::string& s) {
    const auto b = s.find_first_not_of(" \t\r\n");
    if (b == std::string::npos) return {};
    const auto e = s.find_last_not_of(" \t\r\n");
    return s.substr(b, e - b + 1);
}

bool parseNumber(const std::string& text, double* out) {
    const std::string t = trim(text);
    if (t.empty()) return false;
    char* end = nullptr;
    errno = 0;
    const double v = std::strtod(t.c_str(), &end);
    if (errno != 0 || end == t.c_str() || trim(std::string(end)).size() != 0) return false;
    *out = v;
    return true;
}

}  // namespace

bool IniFile::loadFile(const std::string& path, std::string* error) {
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        if (error) *error = "cannot open '" + path + "'";
        return false;
    }
    std::stringstream ss;
    ss << in.rdbuf();
    return loadString(ss.str(), error, path);
}

bool IniFile::loadString(const std::string& text, std::string* error, const std::string& sourceName) {
    source_ = sourceName;
    std::istringstream in(text);
    std::string line, section;
    int lineNo = 0;
    while (std::getline(in, line)) {
        ++lineNo;
        // Strip comments; '#' and ';' both start one.
        const auto c = line.find_first_of("#;");
        if (c != std::string::npos) line = line.substr(0, c);
        line = trim(line);
        if (line.empty()) continue;
        if (line.front() == '[') {
            if (line.back() != ']') {
                if (error) *error = sourceName + ":" + std::to_string(lineNo) + ": malformed section header";
                return false;
            }
            section = trim(line.substr(1, line.size() - 2));
            continue;
        }
        const auto eq = line.find('=');
        if (eq == std::string::npos) {
            if (error) *error = sourceName + ":" + std::to_string(lineNo) + ": expected 'key = value'";
            return false;
        }
        const std::string key = trim(line.substr(0, eq));
        if (key.empty()) {
            if (error) *error = sourceName + ":" + std::to_string(lineNo) + ": empty key";
            return false;
        }
        const std::string full = section.empty() ? key : section + "." + key;
        if (values_.count(full)) {
            if (error) *error = sourceName + ":" + std::to_string(lineNo) + ": duplicate key '" + full + "'";
            return false;
        }
        values_[full] = trim(line.substr(eq + 1));
        lines_[full] = lineNo;
    }
    return true;
}

std::optional<std::string> IniFile::getString(const std::string& key) const {
    const auto it = values_.find(key);
    if (it == values_.end()) return std::nullopt;
    used_.insert(key);
    return it->second;
}

std::optional<double> IniFile::getDouble(const std::string& key) const {
    const auto s = getString(key);
    if (!s) return std::nullopt;
    double v = 0.0;
    if (!parseNumber(*s, &v)) return std::nullopt;
    return v;
}

std::optional<std::vector<double>> IniFile::getList(const std::string& key) const {
    const auto s = getString(key);
    if (!s) return std::nullopt;
    std::vector<double> out;
    std::stringstream ss(*s);
    std::string item;
    while (std::getline(ss, item, ',')) {
        double v = 0.0;
        if (!parseNumber(item, &v)) return std::nullopt;
        out.push_back(v);
    }
    return out;
}

std::string IniFile::getString(const std::string& key, const std::string& fallback) const {
    const auto v = getString(key);
    return v ? *v : fallback;
}

double IniFile::getDouble(const std::string& key, double fallback) const {
    const auto v = getDouble(key);
    return v ? *v : fallback;
}

bool IniFile::getBool(const std::string& key, bool fallback) const {
    const auto v = getString(key);
    if (!v) return fallback;
    if (*v == "1" || *v == "true" || *v == "yes" || *v == "on") return true;
    if (*v == "0" || *v == "false" || *v == "no" || *v == "off") return false;
    return fallback;
}

void IniFile::set(const std::string& key, const std::string& value) { values_[key] = value; }

void IniFile::set(const std::string& key, double value) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.6g", value);
    values_[key] = buf;
}

bool IniFile::saveFile(const std::string& path, const std::string& header) const {
    std::map<std::string, std::vector<std::pair<std::string, std::string>>> sections;
    for (const auto& [full, value] : values_) {
        const auto dot = full.find('.');
        if (dot == std::string::npos) sections[""].push_back({full, value});
        else sections[full.substr(0, dot)].push_back({full.substr(dot + 1), value});
    }
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out) return false;
    std::istringstream hs(header);
    std::string hl;
    while (std::getline(hs, hl)) out << "# " << hl << "\n";
    for (const auto& [section, entries] : sections) {
        out << "\n";
        if (!section.empty()) out << "[" << section << "]\n";
        for (const auto& [k, v] : entries) out << k << " = " << v << "\n";
    }
    return static_cast<bool>(out);
}

std::vector<std::string> IniFile::unusedKeys() const {
    std::vector<std::string> out;
    for (const auto& [k, v] : values_) {
        if (!used_.count(k)) out.push_back(source_ + ":" + std::to_string(lines_.count(k) ? lines_.at(k) : 0) + " '" + k + "'");
    }
    return out;
}

}  // namespace f1sim
