# Lenticulator

**Website:** https://abstractpolygon.github.io/Lenticulator/ · **Try it in your browser:** https://abstractpolygon.github.io/Lenticulator/app/ · **Docs:** [wiki](https://github.com/AbstractPolygon/Lenticulator/wiki)

Create interlaced images for **lenticular prints**: 3D, flip and animation effects. Lenticulator runs in any modern browser and as a desktop app for Windows, macOS and Linux (Electron).

## Features

- **3D depth or animation/flip.** Choose the effect at the top of the lens panel. 3D uses vertical lenses, so each eye sees a different view, and key-point alignment, and adds a red/cyan anaglyph preview. Animation uses horizontal lenses, so both eyes see the same frame, and shift-only alignment.
- **Import frames** with the button or by dragging **images or whole folders** (subfolders included) anywhere onto the window. Files are sorted by name, numerically (`frame2` before `frame10`). Supported formats: JPEG, PNG, WebP, GIF (first frame), BMP, AVIF, SVG, ICO, **HEIC/HEIF** (iPhone photos), **TIFF** (8/16-bit; every page of a multi-page TIFF becomes a frame), **Photoshop PSD/PSB** (the flattened image, or each layer as a frame; set this in Settings → Import), and **MPO/JPS** from 3D cameras (split automatically). Scans from multi-lens film cameras (Nimslo, Nishika, Reto3D) split into frames with **Split scan**. The HEIC, TIFF and PSD decoders load only when they're needed.
- **Auto-align**
  - *Whole image: shift + rotate + scale.* Phase correlation followed by a robust Gauss–Newton similarity fit on an image pyramid, accurate to sub-pixel level. Use it for hand-held shots and scans.
  - *Whole image: shift only.* Use it for tripod flip and animation frames.
  - *Key subject point (3D).* Click the subject that should sit at the print surface, and every frame is shifted so that point lines up. Foreground and background keep their parallax.
  - *Crop to overlap* (automatic after auto-align): frames the print on the area every frame covers, so no blank edges show.
  - Manual fine-tuning: drag in the Align view, use the arrow keys, or type X/Y/rotation/scale. The view has onion-skin, difference, flicker and anaglyph overlays.
- **Depth from a single photo** (3D mode → Depth panel): click **Estimate depth** to compute a depth map
  on your device with [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small)
  (Apache-2.0, about 27 MB, bundled with the app in `public/models/`; it works offline), or **Load depth map** to use your own
  (white = near; tick Invert for maps where white = far). Set **Depth** (total parallax as a % of the width) and
  **Focus** (which depth sits at the print surface; it shows as a yellow line on the depth preview), then
  **Generate frames**. With **Match LPI** ticked, the number of frames follows DPI ÷ LPI, one view per printed
  dot under each lens.
- **Lens setup:** any LPI (fractional values for calibrated pitch), print DPI, vertical (L/R, 3D) or horizontal (up/down flip) lenses, reverse frame order, strip phase, and anti-aliased *blend* or crisp *nearest* sampling.
- **Size presets:** print sizes (4×6, 5×7, 8×10, Letter, A-sizes …) in inches or mm, and social sizes (Instagram, Story/Reel/TikTok, YouTube, X, Facebook/LinkedIn, Pinterest) in exact pixels, fill or fit framing, zoom and pan, and margins with **lens alignment bars** and **crop marks**.
- **Test patterns**
  - *Pitch test:* bands at slightly different LPIs. The one that flips cleanly between solid black and white is your true (visual) pitch.
  - *Lens ruler:* inch and cm scales plus a line for every lens, to check printer scaling and line up the sheet.
  - *Frame order & phase test:* numbered colour frames that show tilt direction and which frame faces you head-on.
- **Live preview:** drag across the preview (or press Play) to simulate tilting the print.
- **Zoom & pan** in Preview, Align and Output: use the −/+/Fit/100% buttons, the mouse wheel or a trackpad pinch (zooms around the cursor), or the keys `+` `-` `0` (fit) `1` (100%). To pan, drag when zoomed in, middle-drag, or hold Space and drag. Output goes up to 3200% so you can inspect individual print dots.
- **Export** the print as PNG, JPG or TIFF, all tagged with the print DPI, or **Print** directly at exact physical size. Export an animated **GIF** of the aligned frames (one GIF frame per frame, at a speed you set, with optional dithering), or a **video** (MP4, or WebM where MP4 isn't available) of the tilt preview with a loop count you set, to share. Inside the claude.ai artifact, TIFF downloads as a .zip.
- **Projects:** save and reopen everything (frames, alignment, settings) as a single `.lenti.json` file.

- **About** (top bar): version, source link, and licenses for the app, the depth model, libraries and samples.
- **GPU or CPU rendering** (Settings → Rendering): Auto uses the graphics card through WebGL2 when available and falls back to all CPU cores.
- **Update check** (desktop): on launch, a popup offers the newest release, with a direct link to the installer for your system.
- **Settings menu** (top bar): **Panel location** puts the control panel on the left or right. **Themes:** System (follows your OS light/dark setting), Light, Dark and High contrast, remembered per device.

All processing happens locally. Images never leave your computer.

## Documentation

The [wiki](https://github.com/AbstractPolygon/Lenticulator/wiki) has a full user guide with screenshots. Its source is in `docs/wiki/`; edits there are published to the wiki automatically.

## Sample images

The Samples menu in the top bar loads ready-made sets: eight 3D scenes, each with 7 camera views, from the
[Middlebury 2005 and 2006 stereo datasets](https://vision.middlebury.edu/stereo/data/) (Scharstein & Pal, CVPR 2007;
Hirschmüller & Scharstein, CVPR 2007); a rotating Earth from NASA's [EPIC](https://epic.gsfc.nasa.gov/) camera (public domain);
and Eadweard Muybridge animations: an elephant, cat, elk, camel and raccoon from *Animal Locomotion* (1887,
[Wellcome Collection](https://wellcomecollection.org/), public domain) and [The Horse in Motion](https://www.loc.gov/item/97502309/)
(1878, Library of Congress). The desktop app doesn't package them: tick Settings → Samples → Sample images to download them.
See `public/samples/SOURCES.txt`.

## Getting started

```bash
npm install
npm run dev            # web app at http://localhost:5173
npm test               # unit tests for interlacing, alignment, file formats
npm run electron:dev   # build and open the desktop app
```

### Desktop installers

| Platform | Installer | Build locally |
|---|---|---|
| Linux | AppImage and Snap (x64) | `npm run dist:linux` (Snap needs `snapcraft`) |
| Windows | NSIS setup `.exe` (x64, arm64, and 32-bit built with Electron 43) with a choice of install folder | `npm run dist:win` |
| macOS | `.dmg` (Intel and Apple silicon) | `npm run dist:mac` |

Installers are written to `release/`. The **Desktop builds** workflow builds all of them on GitHub Actions:
run it from the Actions tab to get the installers as downloadable artifacts, or push a tag such as `v0.3.11`
to also attach them to a draft release. The builds are unsigned unless you add signing certificates, so
Windows SmartScreen and macOS Gatekeeper will warn on first launch. The macOS app gets an ad-hoc signature
(`build/mac-adhoc-sign.cjs`) so Apple Silicon accepts it, and the workflow checks the signatures and launches both Mac
apps before publishing. A Snap built here is installed with
`sudo snap install --dangerous Lenticulator-*.snap` until it's published to the Snap Store.

### Web version

`npm run build` produces the app as a static site in `dist/` that you can host anywhere. The **Deploy web app** workflow publishes the landing page from `site/` at the root of GitHub Pages and the app under `/app/`.

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

[PolyForm Shield License 1.0.0](https://polyformproject.org/licenses/shield/1.0.0). You may use, change and
share Lenticulator for any purpose except providing a product that competes with it. See `LICENSE`.
Bundled third-party components keep their own licenses; see `THIRD_PARTY_NOTICES.md`.
