# Changelog

## 0.3.49
- Printer presets: the Resolution entries read "600 DPI" etc. again.

## 0.3.48
- Printer presets: the Resolution group lists the common DPIs (300 – 2880) without brand names.
- Printer preset for the Epson Stylus Photo series.

## 0.3.47
- Printer presets: back to printers grouped by brand plus a separate Resolution group (Epson 720 / 1440 / 2880,
  Canon / HP 600 / 1200 / 2400, Laser 600 / 1200).

## 0.3.46
- Printer preset resolutions are shown as plain numbers (e.g. Epson → 1440).

## 0.3.45
- Printer presets are all listed by brand: each brand's plain resolutions (e.g. Epson 720 / 1440 / 2880 DPI) sit
  under it next to its printers, and laser printers have their own group.

## 0.3.44
- Printer presets are listed by brand (resolution entries removed; restored under their brands in 0.3.45).

## 0.3.43
- More lens sheet presets: 10, 120, 150 and 161 LPI.

## 0.3.42
- The Printer preset groups printers by brand (Canon, Epson, HP).

## 0.3.41
- Printer presets for popular photo printers: Canon PIXMA, PIXMA PRO-200 / PRO-100, imagePROGRAF PRO-300 and
  SELPHY; Epson EcoTank Photo, Expression Photo and SureColor P700 / P900; HP ENVY / Smart Tank.

## 0.3.40
- **Split scan** lists known film cameras by name (Nimslo 3D, Nishika N8000 / N9000, Vivitar 3D, Reto3D,
  ImageTech 3D Wizard, Loreo 3D); 2, 3 or 4 frames are still there for other cameras.

## 0.3.39
- Projects keep the depth map stored in iPhone portrait photos, so **Estimate depth** still uses it after
  reopening a saved project.

## 0.3.38
- iPhone portrait photos: the depth map stored in the photo (JPEG or HEIC) is kept with it, and **Estimate depth**
  uses it directly (instant, and more accurate than estimating).
- Fix: an iPhone portrait JPEG no longer imports as several frames (photo, depth map, matte); only 3D-camera MPOs,
  whose images are all the same size, split into views.

## 0.3.37
- Video import: importing a video (MP4, MOV, M4V, WebM), such as the MOV of an iPhone Live Photo, takes evenly
  spaced frames (Settings → Import → Video frames, default 10).
- Fix: a rendered video now plays in the Output tab (the page's security policy blocked video).

## 0.3.36
- Print-shop export: **PDF** with the page exactly the print size, and TIF in **CMYK** (or RGB).

## 0.3.35
- **Printer** and **Lens sheet** presets (Print & lens) set the DPI and LPI by name; they show Custom for typed values.
  Print DPI and Lens LPI now sit side by side above them.

## 0.3.34
- In Key point mode, **Auto-align** is greyed out until a key point has been picked.

## 0.3.33
- Depth budget: the Depth panel warns (⚠ max …%) when the depth is more than the lens shows cleanly for the frames,
  LPI and print size (about one lens pitch per frame). The default depth is now 2.5 %.

## 0.3.32
- **In-between** frames for GIFs and frame videos: up to 4 motion-interpolated frames between each pair, for a
  smoother wiggle at the same speed.

## 0.3.31
- Video export can play the **Frames** (like the GIF, with its fps, loop and hold) for Reels and TikTok, or record the
  **Tilt** preview as before. Frames is the default.

## 0.3.30
- GIF timing: **Back and forth** or **Loop** (defaults: back and forth for 3D, loop for Animation), and a **hold** that
  shows the first and last frames longer.

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
