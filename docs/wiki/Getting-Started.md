# Getting Started

## Install

**Web version**: build it once and host the `dist/` folder anywhere, or run it locally:

```bash
npm install
npm run dev
```

**Desktop app**: installers are attached to [GitHub releases](https://github.com/AbstractPolygon/Lenticulator/releases):

| Platform | File | Install |
|---|---|---|
| Linux | `Lenticulator-<version>-linux-x86_64.AppImage` | Make it executable (`chmod +x`) and run it. |
| Linux | `Lenticulator-<version>-linux-amd64.snap` | `sudo snap install --dangerous Lenticulator-<version>-linux-amd64.snap` |
| Windows | `Lenticulator-Setup-<version>-x64.exe` (or `-arm64`) | Run the installer. Choose "More info → Run anyway" if SmartScreen warns about an unsigned app. |
| macOS | `Lenticulator-<version>-mac-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel) | Drag Lenticulator to Applications. The first time, right-click it and choose **Open**, because the app isn't signed. |

The desktop app works fully offline, including depth estimation.

To build the installers yourself:

```bash
npm run dist:linux
```
```bash
npm run dist:win
```
```bash
npm run dist:mac
```

## Your first print

1. **Choose the effect** at the top of the left panel: **3D** or **Animation**. 3D uses vertical lenses and key-point alignment; Animation uses horizontal lenses and shift-only alignment.
2. **Add frames.** Drag images or a whole folder onto the window, click the import button, or pick a set from the **Samples** menu. See [Importing Frames](Importing-Frames).
3. **Set up the print.** Choose the size, your printer's **DPI** and your lens **LPI**. See [Print and Lens Settings](Print-and-Lens-Settings).
4. **Align the frames.** Click **Auto-align**. For 3D, click **Pick key point** first and click the subject that should sit at the print surface. See [Alignment](Alignment).
5. **Check the preview.** Move the mouse across the **Preview** tab to simulate tilting the print.
6. **Render and export.** Choose PNG, JPG or TIF, click **Render image**, then **Download** or **Print…**. See [Preview and Export](Preview-and-Export).

![Samples menu](images/samples-menu.png)

> **Tip:** before your first real print, print a [pitch test](Test-Patterns) to find your lens's true LPI. The nominal value printed on the lens packaging is rarely exact at your viewing distance.

## Printing tips

- Print at **100% / actual size**, with "fit to page", scaling and borderless expansion turned off.
- Use your printer's native resolution as DPI (often 600/1200 for Canon and HP, 720/1440 for Epson).
- Keep the number of frames at or below DPI ÷ LPI; the info box under the lens settings warns you when you go over.
- Lay the lens on the print and rotate it until the [lens alignment bars](Print-and-Lens-Settings#margins-alignment-bars-and-crop-marks) look uniform, then fix it in place.
