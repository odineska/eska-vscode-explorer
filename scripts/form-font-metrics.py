#!/usr/bin/env python3
"""Regenerate Linux glyph advances and kerning with the reference FreeType build.

Run manually in the Linux reference environment, not during a VSIX build.
Only standard-library modules and the system FreeType library are required.
"""

import ctypes as ct
import ctypes.util
import hashlib
import json
from pathlib import Path
import struct


def checked(error):
    if error:
        raise RuntimeError(f"FreeType error {error}")


def kerning_pairs(data, offset):
    if offset is None:
        return []
    version, count = struct.unpack_from(">HH", data, offset)
    if version != 0:
        raise RuntimeError("Expected a version-zero kern table in the pinned fonts")
    offset += 4
    result = []
    for _ in range(count):
        version, length, coverage, count = struct.unpack_from(">HHHH", data, offset)
        if version != 0 or coverage != 1 or length < 14 + count * 6:
            raise RuntimeError("Expected horizontal format-zero kerning in the pinned fonts")
        result.extend(struct.unpack_from(">HHh", data, offset + 14 + i * 6) for i in range(count))
        offset += length
    return result


def generate():
    folder = Path(__file__).resolve().parent.parent / "resources/forms/fonts"
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    ft = ct.CDLL(ctypes.util.find_library("freetype"))
    pointer = ct.c_void_p
    ft.FT_Init_FreeType.argtypes = [ct.POINTER(pointer)]
    ft.FT_New_Face.argtypes = [pointer, ct.c_char_p, ct.c_long, ct.POINTER(pointer)]
    ft.FT_Done_Face.argtypes = [pointer]
    ft.FT_Done_FreeType.argtypes = [pointer]
    ft.FT_Library_Version.argtypes = [pointer, *[ct.POINTER(ct.c_int)] * 3]
    ft.FT_Property_Set.argtypes = [pointer, ct.c_char_p, ct.c_char_p, pointer]
    ft.FT_Set_Pixel_Sizes.argtypes = [pointer, ct.c_uint, ct.c_uint]
    ft.FT_Get_Advances.argtypes = [pointer, ct.c_uint, ct.c_uint, ct.c_int32, ct.POINTER(ct.c_long)]
    ft.FT_Get_First_Char.argtypes = [pointer, ct.POINTER(ct.c_uint)]
    ft.FT_Get_First_Char.restype = ct.c_ulong
    ft.FT_Get_Next_Char.argtypes = [pointer, ct.c_ulong, ct.POINTER(ct.c_uint)]
    ft.FT_Get_Next_Char.restype = ct.c_ulong
    ft.FT_Get_Kerning.argtypes = [pointer, ct.c_uint, ct.c_uint, ct.c_uint, pointer]
    library = pointer()
    checked(ft.FT_Init_FreeType(ct.byref(library)))
    try:
        version = [ct.c_int() for _ in range(3)]
        ft.FT_Library_Version(library, *[ct.byref(part) for part in version])
        version = ".".join(str(part.value) for part in version)
        if version != "2.13.2":
            raise RuntimeError(f"Expected reference FreeType 2.13.2, found {version}")
        interpreter = ct.c_uint(40)
        checked(ft.FT_Property_Set(library, b"truetype", b"interpreter-version", ct.byref(interpreter)))
        result = {"freeType": version, "interpreterVersion": interpreter.value,
                  "loadFlags": 0, "kerningMode": "unfitted_round_pixels",
                  "minPixels": 1, "maxPixels": 128, "faces": {}}
        for item in manifest["files"]:
            file = folder / item["file"]
            data = file.read_bytes()
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise RuntimeError(f"Font checksum mismatch: {file.name}")
            tables = {}
            for i in range(struct.unpack_from(">H", data, 4)[0]):
                tag, _, offset, _ = struct.unpack_from(">4sIII", data, 12 + i * 16)
                tables[tag] = offset
            count = struct.unpack_from(">H", data, tables[b"maxp"] + 4)[0]
            units = struct.unpack_from(">H", data, tables[b"head"] + 18)[0]
            face = pointer()
            checked(ft.FT_New_Face(library, str(file).encode(), 0, ct.byref(face)))
            try:
                base = (ct.c_long * count)()
                # FT_LOAD_NO_SCALE returns font units rather than 16.16 pixels.
                checked(ft.FT_Get_Advances(face, 0, count, 1, base))
                records = [[base[i], {}] for i in range(count)]
                for pixels in range(result["minPixels"], result["maxPixels"] + 1):
                    checked(ft.FT_Set_Pixel_Sizes(face, 0, pixels))
                    advances = (ct.c_long * count)()
                    checked(ft.FT_Get_Advances(face, 0, count, 0, advances))
                    for i in range(count):
                        if advances[i] % 65536:
                            raise RuntimeError("Expected grid-fitted integer advance")
                        difference = advances[i] // 65536 - (base[i] * pixels + units // 2) // units
                        if difference:
                            records[i][1][pixels] = difference
                classes, indices, characters, glyph_characters = [], {}, {}, {}
                index = ct.c_uint()
                code = ft.FT_Get_First_Char(face, ct.byref(index))
                while index.value:
                    record = records[index.value]
                    key = json.dumps(record, separators=(",", ":"))
                    if key not in indices:
                        indices[key] = len(classes)
                        classes.append(record)
                    characters[chr(code)] = indices[key]
                    glyph_characters.setdefault(index.value, []).append(chr(code))
                    code = ft.FT_Get_Next_Char(face, code, ct.byref(index))
                kern_classes, kern_indices, kern_pairs = [], {}, {}
                for left, right, adjustment in kerning_pairs(data, tables.get(b"kern")):
                    if not adjustment or left not in glyph_characters or right not in glyph_characters:
                        continue
                    vector = (ct.c_long * 2)()
                    checked(ft.FT_Get_Kerning(face, left, right, 2, ct.byref(vector)))
                    if vector[0] != adjustment:
                        raise RuntimeError("Parsed kerning differs from FreeType")
                    if adjustment not in kern_indices:
                        differences = {}
                        for pixels in range(result["minPixels"], result["maxPixels"] + 1):
                            checked(ft.FT_Set_Pixel_Sizes(face, 0, pixels))
                            # UNFITTED keeps kerning at small sizes; DEFAULT attenuates it.
                            checked(ft.FT_Get_Kerning(face, left, right, 1, ct.byref(vector)))
                            actual = (vector[0] + 32) // 64
                            expected = (adjustment * pixels + units // 2) // units
                            if actual != expected:
                                differences[pixels] = actual - expected
                        kern_indices[adjustment] = len(kern_classes)
                        kern_classes.append([adjustment, differences])
                    for first in glyph_characters[left]:
                        for second in glyph_characters[right]:
                            kern_pairs[first + second] = kern_indices[adjustment]
                result["faces"][file.name] = {"sha256": item["sha256"], "units": units,
                                             "characters": characters, "classes": classes,
                                             "kerningPairs": kern_pairs, "kerningClasses": kern_classes}
            finally:
                checked(ft.FT_Done_Face(face))
    finally:
        checked(ft.FT_Done_FreeType(library))
    target = folder / "advances.json"
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {len(result['faces'])} faces, {target.stat().st_size} bytes")


if __name__ == "__main__":
    generate()
