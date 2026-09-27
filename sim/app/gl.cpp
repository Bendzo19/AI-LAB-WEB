#include "gl.hpp"

#include <SDL3/SDL.h>

namespace gl {

#define F1SIM_GL_DEFINE(ret, name, ...) PFN_##name name = nullptr;
F1SIM_GL_FUNCS(F1SIM_GL_DEFINE)
#undef F1SIM_GL_DEFINE

bool load() {
    bool ok = true;
#define F1SIM_GL_LOAD(ret, name, ...)                                                  \
    name = reinterpret_cast<PFN_##name>(SDL_GL_GetProcAddress("gl" #name));            \
    if (!name) {                                                                       \
        SDL_Log("OpenGL function gl%s is missing", #name);                             \
        ok = false;                                                                    \
    }
    F1SIM_GL_FUNCS(F1SIM_GL_LOAD)
#undef F1SIM_GL_LOAD
    return ok;
}

}  // namespace gl
