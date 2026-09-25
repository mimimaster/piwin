# Desktop app icon

The production master is `apps/desktop/src-tauri/icons/icon-source-1024.png`.
It is a 1024 × 1024 RGBA image. The dark tile reaches all four canvas edges at
their midpoints; only the rounded corners are transparent. Do not add an outer
transparent inset when regenerating platform assets.

The desktop bundle uses the PNG, ICNS, and ICO files in
`apps/desktop/src-tauri/icons/`. Windows uses a simplified, optically larger
vector master (`icon-windows-small.svg`) for 16–48 px frames. The larger frames
use the 1024 px artwork. Run `python3 scripts/dev/gen-windows-icon.py` to build
the 15-frame ICO for Windows 11 display scales; `--check-only` validates it.
The small frames are uncompressed; the 256 px frame is PNG-compressed. The
frame sizes cover the [Windows 11 icon scale table](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction).
The matching browser icons are in `apps/desktop/public/` and
`apps/docs/public/`. The NSIS sidebar art uses the same large master and is
regenerated with
`python3 scripts/dev/gen-nsis-art.py`.
