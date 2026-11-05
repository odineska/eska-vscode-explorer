/* ESKA Linux Taxi caption rasterizer. See resources/forms/native-text/README.md. */
#include <stdint.h>
#include <stdlib.h>
#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_MODULE_H
#include FT_LCD_FILTER_H

/* Only 32-bit offsets cross the WebAssembly boundary. */
uint32_t eska_ft_alloc(uint32_t length) {
    if (!length || length > 4 * 1024 * 1024) return 0;
    return (uint32_t)(uintptr_t)malloc(length);
}

void eska_ft_free(uint32_t pointer) {
    free((void *)(uintptr_t)pointer);
}

uint32_t eska_ft_init(void) {
    FT_Library library = NULL;
    FT_UInt interpreter = 40;
    if (FT_Init_FreeType(&library)) return 0;
    if (FT_Property_Set(library, "truetype", "interpreter-version", &interpreter)
        || FT_Library_SetLcdFilter(library, FT_LCD_FILTER_DEFAULT)) {
        FT_Done_FreeType(library);
        return 0;
    }
    return (uint32_t)(uintptr_t)library;
}

uint32_t eska_ft_version(uint32_t handle) {
    FT_Int major, minor, patch;
    if (!handle) return 0;
    FT_Library_Version((FT_Library)(uintptr_t)handle, &major, &minor, &patch);
    return ((uint32_t)major << 16) | ((uint32_t)minor << 8) | (uint32_t)patch;
}

uint32_t eska_ft_open(uint32_t library, uint32_t address, uint32_t length) {
    const uint8_t *bytes = (const uint8_t *)(uintptr_t)address;
    FT_Face face = NULL;
    if (!library || !bytes || !length || length > 4 * 1024 * 1024) return 0;
    if (FT_New_Memory_Face((FT_Library)(uintptr_t)library, bytes, (FT_Long)length, 0, &face)) return 0;
    if (FT_Select_Charmap(face, FT_ENCODING_UNICODE)) {
        FT_Done_Face(face);
        return 0;
    }
    return (uint32_t)(uintptr_t)face;
}

int eska_ft_size(uint32_t handle, uint32_t pixels) {
    if (!handle || pixels < 1 || pixels > 2048) return FT_Err_Invalid_Argument;
    return FT_Set_Pixel_Sizes((FT_Face)(uintptr_t)handle, 0, pixels);
}

static int write_glyph(FT_GlyphSlot glyph, int32_t *out) {
    FT_Bitmap *bitmap = &glyph->bitmap;
    if (bitmap->pixel_mode != FT_PIXEL_MODE_LCD || bitmap->width % 3 || bitmap->pitch < 0
        || bitmap->width > 12288 || bitmap->rows > 4096) return FT_Err_Cannot_Render_Glyph;
    out[0] = (int32_t)glyph->advance.x;
    out[1] = (int32_t)glyph->metrics.horiBearingX;
    out[2] = (int32_t)glyph->metrics.horiBearingY;
    out[3] = (int32_t)glyph->metrics.width;
    out[4] = (int32_t)glyph->metrics.height;
    out[5] = glyph->bitmap_left;
    out[6] = glyph->bitmap_top;
    out[7] = (int32_t)(bitmap->width / 3);
    out[8] = (int32_t)bitmap->rows;
    out[9] = bitmap->pitch;
    out[10] = (int32_t)(uintptr_t)bitmap->buffer;
    out[11] = bitmap->pixel_mode;
    return 0;
}

int eska_ft_glyph(uint32_t handle, uint32_t codepoint, uint32_t address) {
    int32_t *out = (int32_t *)(uintptr_t)address;
    if (!handle || !out || codepoint > 0x10ffff) return FT_Err_Invalid_Argument;
    FT_Face face = (FT_Face)(uintptr_t)handle;
    FT_UInt index = FT_Get_Char_Index(face, codepoint);
    if (!index) return FT_Err_Invalid_Glyph_Index;
    FT_Int32 flags = FT_LOAD_TARGET_LCD | FT_LOAD_COLOR | FT_LOAD_IGNORE_GLOBAL_ADVANCE_WIDTH | FT_LOAD_RENDER;
    FT_Error error = FT_Load_Glyph(face, index, flags);
    return error ? error : write_glyph(face->glyph, out);
}

int eska_ft_rotated_glyph(uint32_t handle, uint32_t codepoint, uint32_t address) {
    int32_t *out = (int32_t *)(uintptr_t)address;
    if (!handle || !out || codepoint > 0x10ffff) return FT_Err_Invalid_Argument;
    FT_Face face = (FT_Face)(uintptr_t)handle;
    FT_UInt index = FT_Get_Char_Index(face, codepoint);
    if (!index) return FT_Err_Invalid_Glyph_Index;
    /* Native chart labels truncate the 45-degree matrix to 16.16 precision. */
    FT_Matrix matrix = { 46340, -46340, 46340, 46340 };
    FT_Set_Transform(face, &matrix, NULL);
    FT_Error error = FT_Load_Glyph(face, index,
        FT_LOAD_TARGET_LCD | FT_LOAD_COLOR | FT_LOAD_IGNORE_GLOBAL_ADVANCE_WIDTH);
    /* The shared face must remain usable by every ordinary caption after errors, too. */
    FT_Set_Transform(face, NULL, NULL);
    if (error) return error;
    error = FT_Render_Glyph(face->glyph, FT_RENDER_MODE_LCD);
    if (error) return error;
    error = write_glyph(face->glyph, out);
    if (!error) out[1] = (int32_t)face->glyph->advance.y;
    return error;
}

void eska_ft_close(uint32_t face) {
    if (face) FT_Done_Face((FT_Face)(uintptr_t)face);
}

int32_t eska_ft_kerning(uint32_t handle, uint32_t left, uint32_t right) {
    if (!handle || left > 0x10ffff || right > 0x10ffff) return 0;
    FT_Face face = (FT_Face)(uintptr_t)handle;
    FT_Vector value = { 0, 0 };
    if (FT_Get_Kerning(face, FT_Get_Char_Index(face, left), FT_Get_Char_Index(face, right),
                       FT_KERNING_UNFITTED, &value)) return 0;
    /* Pixel rounding follows the design preview; DEFAULT attenuates small sizes. */
    int32_t rounded = (int32_t)value.x + 32;
    return rounded >= 0 ? rounded / 64 : -((63 - rounded) / 64);
}

void eska_ft_done(uint32_t library) {
    if (library) FT_Done_FreeType((FT_Library)(uintptr_t)library);
}
