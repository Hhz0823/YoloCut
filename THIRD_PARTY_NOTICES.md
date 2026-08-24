# Third-party notices

## FFmpeg / ffmpeg-static / @derhuerst/ffprobe-static

- Wrappers: https://github.com/eugeneware/ffmpeg-static
- Package versions: `ffmpeg-static@5.3.0` and `@derhuerst/ffprobe-static@5.3.0`
- Project: https://ffmpeg.org/
- License: GPL-3.0-or-later for the distributed build

YoloCut uses these matched, statically linked FFmpeg 6.1.1 executables for media
probing, normalization, proxy generation, hardware acceleration and software
decoder fallback. Each executable's complete license is distributed beside it
as `ffmpeg.exe.LICENSE` / `ffprobe.exe.LICENSE` (or the equivalent platform
binary license).

The bundled FFmpeg includes, among other libraries, libaom and libvpx. Operators
may point `YOLOCUT_FFMPEG` and `YOLOCUT_FFPROBE` at another compatible
open-source build; they are responsible for distributing that build's
corresponding notices and source offer.

## Alliance for Open Media libaom

- Project: https://aomedia.googlesource.com/aom/
- License: BSD 2-Clause plus AOM patent license
- Use: optional AV1 software decoder fallback when exposed by FFmpeg

## WebM Project libvpx

- Project: https://chromium.googlesource.com/webm/libvpx/
- License: BSD 3-Clause
- Use: optional VP8/VP9 software decoder fallback when exposed by FFmpeg

## VideoLAN dav1d compatibility

- Project: https://code.videolan.org/videolan/dav1d
- License: BSD 2-Clause
- Use: preferred AV1 fallback when an operator-supplied FFmpeg build exposes
  `libdav1d`; it is not present in the current bundled Windows executable.

## liquid-glass-react

- Project: https://github.com/rdev/liquid-glass-react
- Version: 1.1.1
- License: MIT

Copyright 2025 MAX ROVENSKY

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
