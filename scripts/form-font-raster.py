#!/usr/bin/env python3
"""Rebuild the bundled Linux caption rasterizer; never invoked by VSIX builds."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile


SOURCE_SHA = "12991c4e55c506dd7f9b765933e62fd2be2e06d421505d7950a132e4f1bb484d"
SDK_VERSION = "6.0.13"
FLAGS = ["-O2", "-DFT_CONFIG_OPTION_SUBPIXEL_RENDERING", "-DESKA_FT_NATIVE_RASTER",
         "-sSUPPORT_LONGJMP=wasm", "-fwasm-exceptions", "-sWASM_LEGACY_EXCEPTIONS=1"]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--emsdk", type=Path, required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    sdk = args.emsdk.resolve()
    toolchain = sdk / "upstream/emscripten"
    environment = dict(os.environ, EM_CONFIG=str(sdk / ".emscripten"), EMSDK=str(sdk),
                       PATH=str(toolchain) + os.pathsep + str(sdk / "upstream/bin") + os.pathsep + os.environ["PATH"])
    version = subprocess.check_output([str(toolchain / "emcc"), "-dumpversion"], env=environment, text=True).strip()
    if version != SDK_VERSION or digest(args.source_archive) != SOURCE_SHA:
        raise ValueError("The pinned Emscripten SDK or FreeType archive does not match")
    playground = (repo.parent / "eska" / ".." / "eska-playground").resolve()
    playground.mkdir(exist_ok=True)
    target = repo / "resources/forms/native-text"
    bridge = repo / "scripts/form-font-raster.c"
    with tempfile.TemporaryDirectory(prefix="form-font-raster-", dir=playground) as directory:
        scratch = Path(directory)
        with tarfile.open(args.source_archive) as archive:
            archive.extractall(scratch, filter="data")
        source, build = scratch / "freetype-2.13.2", scratch / "build"
        (source / "include/freetype/config/ftmodule.h").write_text("\n".join([
            "FT_USE_MODULE( FT_Driver_ClassRec, tt_driver_class )",
            "FT_USE_MODULE( FT_Module_Class, sfnt_module_class )",
            "FT_USE_MODULE( FT_Module_Class, psnames_module_class )",
            "FT_USE_MODULE( FT_Renderer_Class, ft_smooth_renderer_class )", ""]))
        options = source / "include/freetype/config/ftoption.h"
        options.write_text(options.read_text().replace("#define FT_CONFIG_OPTION_ENVIRONMENT_PROPERTIES",
                                                      "#undef FT_CONFIG_OPTION_ENVIRONMENT_PROPERTIES"))
        curves = source / "src/smooth/ftgrays.c"
        lines = curves.read_text().splitlines()
        index = next(i for i, line in enumerate(lines) if line.startswith("#if FT_SSE2 "))
        # The AArch64 reference uses DDA curve stepping; the upstream WASM gate
        # otherwise selects binary splitting and changes coverage by 1–4 levels.
        lines.insert(index + 1, "    defined( ESKA_FT_NATIVE_RASTER ) || " + chr(92))
        curves.write_text("\n".join(lines) + "\n")
        configure = [str(toolchain / "emcmake"), "cmake", "-S", str(source), "-B", str(build), "-G", "Ninja",
                     "-DCMAKE_POLICY_VERSION_MINIMUM=3.5", "-DCMAKE_BUILD_TYPE=Release",
                     "-DCMAKE_C_FLAGS=" + " ".join(FLAGS), "-DBUILD_SHARED_LIBS=OFF"]
        configure += ["-DFT_DISABLE_" + name + "=ON" for name in ["ZLIB", "BZIP2", "PNG", "HARFBUZZ", "BROTLI"]]
        subprocess.run(configure, env=environment, check=True)
        subprocess.run(["cmake", "--build", str(build), "--parallel", "4"], env=environment, check=True)
        exports = ["_eska_ft_" + name for name in ["init", "version", "open", "size", "glyph", "kerning", "close", "done", "alloc", "free"]]
        binary = scratch / "font-raster.wasm"
        subprocess.run([str(toolchain / "emcc"), "-std=c11", "-Wall", "-Wextra", "-Werror", *FLAGS,
                        "-I" + str(build / "include"), "-I" + str(source / "include"), str(bridge), str(build / "libfreetype.a"),
                        "-sSTANDALONE_WASM=1", "-sFILESYSTEM=0", "-sMALLOC=emmalloc", "-sALLOW_MEMORY_GROWTH=1",
                        "-sINITIAL_MEMORY=16777216", "-sMAXIMUM_MEMORY=134217728", "-sABORTING_MALLOC=0",
                        "-sEXPORTED_FUNCTIONS=" + json.dumps(exports), "--no-entry", "-o", str(binary)],
                       env=environment, check=True)
        (target / "font-raster.wasm").write_bytes(binary.read_bytes())
        manifest = {"freeType": "2.13.2", "emscripten": SDK_VERSION, "sourceSha256": SOURCE_SHA,
                    "bridgeSha256": digest(bridge), "wasmSha256": digest(binary),
                    "interpreterVersion": 40, "lcdFilter": "default", "curveRasterizer": "native-dda"}
        (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
