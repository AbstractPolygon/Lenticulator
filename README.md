# Lenticulator

Create interlaced images for **lenticular prints**: 3D, flip and animation effects. Lenticulator runs in any modern browser and as a desktop app for Windows, macOS and Linux (Electron).

## Features

- **Import frames** with the button or by dragging **images or whole folders** (subfolders included) anywhere onto the window. Files are sorted by name, numerically (`frame2` before `frame10`). Supported formats: JPEG, PNG, WebP, GIF (first frame), BMP, AVIF, SVG and ICO, plus **MPO** files from 3D cameras (split automatically). HEIC and TIFF open only where the browser engine can decode them, which Chromium and the desktop app cannot. Drag to reorder, exclude frames, and pick the alignment reference (★).
- **Auto-align**
  - *Whole image: shift + rotate + scale.* Phase correlation followed by a robust Gauss–Newton similarity fit on an image pyramid, accurate to sub-pixel level. Use it for hand-held shots and scans.
  - *Whole image: shift only.* Use it for tripod flip and animation frames.
  - *Key subject point (3D).* Click the subject that should sit at the print surface, and every frame is shifted so that point lines up. Foreground and background keep their parallax.
  - Manual fine-tuning: drag in the Align view, use the arrow keys, or type X/Y/rotation/scale. The view has onion-skin, difference, flicker and anaglyph overlays.
- **Lens setup:** any LPI (fractional values for calibrated pitch), print DPI, vertical (L/R, 3D) or horizontal (up/down flip) lenses, reverse frame order, strip phase, and anti-aliased *blend* or crisp *nearest* sampling.
- **Print size presets** (4×6, 5×7, 8×10, Letter, A-sizes …) in inches or mm, fill or fit framing, zoom and pan, and margins with **lens alignment bars** and **crop marks**.
- **Test patterns**
  - *Pitch test:* bands at slightly different LPIs. The one that flips cleanly between solid black and white is your true (visual) pitch.
  - *Lens ruler:* inch and cm scales plus a line for every lens, to check printer scaling and line up the sheet.
  - *Frame order & phase test:* numbered colour frames that show tilt direction and which frame faces you head-on.
- **Live preview:** move the mouse across the preview (or press Play) to simulate tilting the print.
- **Export** as PNG or uncompressed TIFF, both tagged with the print DPI, or **Print** directly at exact physical size.
- **Projects:** save and reopen everything (frames, alignment, settings) as a single `.lenti.json` file.

- **Settings menu** (top bar) → **Themes:** System (follows your OS light/dark setting), Light, Dark and High contrast, remembered per device.

All processing happens locally. Images never leave your computer.

## Getting started

```bash
npm install
npm run dev            # web app at http://localhost:5173
npm test               # unit tests for interlacing, alignment, file formats
npm run electron:dev   # build and open the desktop app
```

### Desktop installers

```bash
npm run dist:win     # NSIS installer + portable .exe
npm run dist:mac     # .dmg + .zip
npm run dist:linux   # AppImage + .deb
```

Installers are written to `release/`. Push a tag such as `v0.1.0` and the **Release desktop apps** workflow builds all three platforms on GitHub Actions and attaches them to a draft release. macOS builds are unsigned unless you add signing certificates.

### Web version

`npm run build` produces a static site in `dist/` that you can host anywhere. The **Deploy web app** workflow publishes it to GitHub Pages: in the repo settings, set Pages → Source to *GitHub Actions*.

## Workflow tips

1. **Calibrate first.** Set your lens's nominal LPI and your printer's DPI, print a **pitch test** at 100% scale, and enter the LPI of the band that looks solid. The visual pitch at viewing distance usually differs a little from the nominal pitch.
2. **Frames vs. resolution.** Dots per lens = DPI ÷ LPI. Keep the frame count at or below this number (the info box warns you). Common native printer resolutions are 600/1200 (Canon/HP) and 720/1440 (Epson).
3. **Print at actual size**, with scaling, "fit to page" and borderless expansion turned off.
4. **Align the lens** using the alignment bars in the margin: rotate the sheet until each bar turns a uniform colour across its whole length, then fix it in place.
5. If the image flips the wrong way, tick **Reverse frame order**. Use **Strip phase** to choose which frame you see head-on.

## Project layout

```
src/core/      pure, tested logic: interlace, align (FFT + Gauss–Newton), geometry,
               test patterns, PNG pHYs / TIFF writers
src/worker.ts  background rendering and alignment
src/ui/        browser UI helpers (state, import, export/print)
src/main.ts    app controller
electron/      desktop wrapper (serves dist/ over a secure app:// scheme)
```

## License

MIT
