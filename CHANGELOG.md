# Changelog

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
