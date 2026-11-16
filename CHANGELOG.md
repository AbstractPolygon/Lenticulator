# Changelog

## 0.3.29
- **Split scan** (Frames panel): splits the selected frame, a film scan with 2, 3 or 4 frames side by side (Nimslo,
  Nishika, Reto3D …), into separate equal-size frames, finding the gaps and trimming the film border.

## 0.3.28
- **Crop to overlap** (Alignment panel): frames the print on the area every frame covers, so no blank edges show in
  the print, GIF or video. **Auto crop** (Framing & page, on by default) does this after every auto-align.

## 0.3.27
- GIF dither defaults to Atkinson.
- Alignment fixes: the GIF dither dropdown lines up with the fps field (and video loops likewise); Match LPI lines up
  with the Frames field, and Reverse frame order with Sampling.

## 0.3.26
- Zoom works on a rendered GIF or video in the Output tab (buttons, Fit, 100%, mouse wheel, keyboard), as it does
  in Preview, Align and on the rendered print.
- Render, Download and Print share one row; Download (and Print, for stills) appear only after something is rendered.
- Align: the photo outside the print area is dimmed (with Show print area on).

## 0.3.25
- Preview: the playhead only follows the mouse while the button is held (click or drag across the preview), not on hover.

## 0.3.24
- Logo: just the lines, without the square (purple in light mode, blue in dark mode). Also on the website.

## 0.3.23
- GIF and video: **Render** now makes the animation (not the lenticular print) and plays it in the Output tab;
  **Download** saves it (rendering first if frames or settings changed since).
- Preview: **Smooth** is off by default, and the playhead is a tall rectangle.

## 0.3.22
- Dark theme: the accent colour is blue instead of violet, matching the website.

## 0.3.21
- Video export: set how many times the video tilts back and forth (1–20 loops, default 2), next to the format buttons.
- The render button now just says "Render".
- GIF export: dither options (none, Floyd–Steinberg, Atkinson, ordered) next to the speed.

## 0.3.20
- macOS: the app is ad-hoc signed, so Apple Silicon Macs open it instead of saying it "is damaged". The first time,
  macOS may still ask: System Settings → Privacy & Security → Open Anyway. The build now checks the signatures and
  launches both Mac apps (Apple Silicon and Intel) before publishing.
- Includes 0.3.19 (not released on its own): the version is shown as "(beta)" in the app and on the website.

## 0.3.19
- The version is shown as "(beta)" in the app (header, About, window title, update popup) and on the website.

## 0.3.18
- GIF speed is adjustable: choose GIF in the export formats and set the frames per second (1–50, default 10).

## 0.3.17
- GIF export is a real frame animation: one GIF frame per aligned frame at 10 per second, with no lenticular
  blending. Animations loop forward; 3D views rock back and forth. (Video still records the tilt preview.)
- Size presets: a Social group (Instagram post and portrait, Story/Reel/TikTok, YouTube, X, Facebook/LinkedIn,
  Pinterest). These set exactly that many pixels at the current DPI, keep their pixels when the DPI changes, and
  GIF/video exports use the same pixel size.

## 0.3.16
- Desktop: checks GitHub for a newer release on launch. The popup's Download button links straight to the
  installer for your system (Windows x64/arm64/32-bit, macOS Intel/Apple silicon, Linux AppImage or Snap).
  Skip hides it until the next version; Later asks again on the next launch.

## 0.3.15
- New samples: the 3D sets are now full-size Middlebury views (4× the pixels), with four more scenes (Art, Dolls,
  Moebius, Reindeer). New animations: Earth from NASA's EPIC camera, and Muybridge's elephant, cat, elk, camel
  and raccoon from the Wellcome Collection's public-domain plates.
- Desktop: sample images are no longer packaged. Settings → Samples → Sample images downloads them; the Samples
  button appears once they're installed. Untick to delete them.

## 0.3.14
- GPU rendering: the print can be interlaced on the graphics card (WebGL2). Settings → Rendering: Auto (GPU when
  available, otherwise CPU), GPU or CPU. Output matches the CPU renderer to within one level per channel.
- 32-bit Windows installer (built with Electron 43, the last Electron release that supports 32-bit Windows).

## 0.3.13
- Export panel: format buttons above the render button; the button now says "Render image".
- Website (`site/`): landing page with downloads, the browser version under `/app/`, screenshots and docs links.
- Tagged builds are published as public GitHub releases.

## 0.3.12
- Windows: build only the per-architecture installers (x64, arm64), not an extra combined one.

## 0.3.11
- Desktop builds workflow: Linux AppImage and Snap, Windows NSIS installer (x64, arm64), macOS DMG
  (Intel, Apple silicon); manual runs upload installers as artifacts, version tags attach them to a draft release.
- Smaller desktop app (154 MB instead of 201 MB): libraries already bundled by the build are no longer copied in again.

## 0.3.10
- Faster rendering: the print is interlaced in parallel bands across all CPU cores, each band receiving
  only the part of every frame it needs; opaque frames skip transparency maths (about 2× faster end to end
  on 4 cores, output pixel-identical).
- Lower memory: workers no longer keep full copies of every frame, and a render keeps one copy of its pixels.
- Smoother views: large photos are drawn from a 2048 px copy when zoomed out; the output view uses a reduced
  copy when zoomed out; anaglyph overlays reuse their canvases.
- Fix: opening a project now clears the previous depth map and render.
- Fix (desktop): the app's file server could read sibling folders whose names start with "dist".
- Code: shared drawing, canvas, menu and depth-panel modules; dead code removed.

## 0.3.9
- Fix: long frame names no longer push the frame buttons out of view.

## 0.3.8
- Fix: the key point could land in the wrong place when picking it switched to the Align tab.
- Fix: the frame list's scrollbar no longer covers the remove buttons.

## 0.3.7
- Tooltips on all controls.
- Logo: solid colour (no gradient), strips centred.

## 0.3.6
- Top-bar icon buttons spaced closer together.

## 0.3.5
- About panel (top bar, left of Settings): version, source repository, app license, and licenses of the depth model, libraries and sample images.
- Top-bar icon buttons drawn without a button box.

## 0.3.4
- License changed to the PolyForm Shield License 1.0.0; third-party notices added.

## 0.3.3
- The depth model is now stored in the repository (`public/models/`), so builds work offline.

## 0.3.2
- Settings: "Panel" renamed to "Panel location".

## 0.3.1
- Settings → Panel: show the control panel on the left or right.
- Depth model parts use a `.wasm` extension so every static host serves them.

## 0.3.0
- **Depth from a single photo**: estimate depth on-device (Depth Anything V2 Small, WebAssembly) or load a
  depth map, then generate N views for a 3D print. Frame count can follow DPI ÷ LPI ("Match LPI").
- Export: PNG / JPG / TIF (DPI-tagged), animated GIF and video (MP4/WebM) of the tilt preview.
- Preview: onion skin, difference, flicker and anaglyph overlays.
- Samples menu with bundled 3D (Middlebury) and animation (Muybridge) sets.
- Import HEIC/HEIF, TIFF (multi-page), PSD/PSB (flattened or per layer); real MPO files split via the MP index.
- Zoom & pan in all views (buttons in the tab row, mouse wheel, keyboard).
- 3D / Animation modes; icon-only top bar; Settings menu with themes; no hint text in the UI.

## 0.2.0
- First public build: interlacing, auto-alignment, test patterns, PNG/TIFF export, printing, projects,
  Electron desktop app.
