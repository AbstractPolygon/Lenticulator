# Print and Lens Settings

![Print and lens panel](images/print-lens-panel.png)

## Effect

**3D** or **Animation** at the top of the panel. Switching sets sensible defaults:

| Effect | Lens direction | Alignment |
|---|---|---|
| 3D | Vertical (each eye sees a different view) | Key point |
| Animation | Horizontal (both eyes see the same frame, no ghosting) | Shift only |

## Size, DPI and LPI

| Setting | Meaning |
|---|---|
| **Size preset**, **Width**, **Height**, **Units** | Print size without margins, in inches or mm. Presets keep the current portrait/landscape orientation. |
| **Print DPI** | Your printer's resolution. Use its native resolution (e.g. 600/1200 Canon/HP, 720/1440 Epson). |
| **Lens LPI** | Lenses per inch. Fractional values are allowed; use the value found with the [pitch test](Test-Patterns). |
| **Lens direction** | **Vertical**: tilt left/right (needed for 3D). **Horizontal**: tilt up/down. |
| **Sampling** | **Blend**: anti-aliased strips, exact for any DPI/LPI. **Nearest**: crisp strips of whole printer dots. |
| **Reverse frame order** | Tick if the print moves the wrong way when tilted. |
| **Strip phase** | Shifts the strips under the lenses; changes which frame is seen head-on. |

The info box shows dots per lens, dots per frame strip, the output size in pixels and the number of lenses. It warns when there are more frames than dots per lens, when the lens direction doesn't suit the effect, and when the output is very large.

## Framing and page

| Setting | Meaning |
|---|---|
| **Fit** | **Fill** crops the image to fill the print; **Fit** shows the whole image with borders. |
| **Background** | Colour used where an image doesn't cover the print. |
| **Zoom**, **Pan X**, **Pan Y** | Enlarge and move the image within the print area. |
| **Margin** | White border around the image. |

### Margins, alignment bars and crop marks

With a margin set:

- **Lens alignment bars** print strips in the margin at the lens pitch, in phase with the image. Lay the lens on the print and rotate it until the bars look uniform along their whole length, then fix it in place.
- **Crop marks** show where to cut.
