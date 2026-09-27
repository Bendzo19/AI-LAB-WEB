// Single-header library implementations (public domain / MIT, see headers).
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#pragma GCC diagnostic ignored "-Wshadow"
#pragma GCC diagnostic ignored "-Wsign-compare"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wpedantic"
#elif defined(_MSC_VER)
#pragma warning(push, 0)
#endif

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_GIF
#define STBI_NO_PSD
#define STBI_NO_PIC
#define STBI_NO_PNM
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

#define CGLTF_IMPLEMENTATION
#include "cgltf.h"

#include "stb_easy_font.h"

// stb_easy_font is header-only with static functions; expose one wrapper.
int f1sim_easy_font_print(float x, float y, const char* text, unsigned char color[4], void* buffer, int size) {
    return stb_easy_font_print(x, y, const_cast<char*>(text), color, buffer, size);
}
int f1sim_easy_font_width(const char* text) { return stb_easy_font_width(const_cast<char*>(text)); }

#if defined(__GNUC__)
#pragma GCC diagnostic pop
#elif defined(_MSC_VER)
#pragma warning(pop)
#endif
