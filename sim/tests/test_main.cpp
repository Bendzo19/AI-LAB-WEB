#include <cstring>

#include "harness.hpp"

int main(int argc, char** argv) {
    const char* filter = argc > 1 ? argv[1] : nullptr;
    int run = 0;
    for (const auto& c : th::registry()) {
        if (filter && !std::strstr(c.name, filter)) continue;
        const int before = th::failures();
        std::printf("[ RUN  ] %s\n", c.name);
        c.fn();
        std::printf("[ %s ] %s\n", th::failures() == before ? " OK " : "FAIL", c.name);
        ++run;
    }
    std::printf("\n%d test(s), %d failure(s)\n", run, th::failures());
    return th::failures() == 0 ? 0 : 1;
}
