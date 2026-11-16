# Third-party notices

Lenticulator itself is licensed under the PolyForm Shield License 1.0.0 (see `LICENSE`).
It bundles or loads the following components, which remain under their own licenses:

| Component | Used for | License |
|---|---|---|
| [Depth Anything V2 Small](https://huggingface.co/depth-anything/Depth-Anything-V2-Small) (ONNX export by [onnx-community](https://huggingface.co/onnx-community/depth-anything-v2-small)) | Depth estimation model in `public/models/` | Apache-2.0 |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | Runs the depth model | MIT |
| [libheif-js](https://github.com/catdad-experiments/libheif-js) (libheif) | HEIC/HEIF import, loaded as a separate, replaceable module | LGPL-3.0 |
| [UTIF.js / utif2](https://github.com/photopea/UTIF.js) | TIFF import | MIT |
| [ag-psd](https://github.com/Agamnentzar/ag-psd) | PSD import | MIT |
| [gifenc](https://github.com/mattdesl/gifenc) | Animated GIF export | MIT |
| [Electron](https://www.electronjs.org/) | Desktop app shell | MIT |
| Middlebury 2005 and 2006 stereo datasets (`public/samples/aloe`, `art`, `baby1`, `bowling2`, `dolls`, `flowerpots`, `moebius`, `reindeer`) | Sample images | Free to use with citation: Scharstein & Pal, CVPR 2007; Hirschmüller & Scharstein, CVPR 2007 |
| NASA EPIC camera on NOAA's DSCOVR (`public/samples/earth`) | Sample images | Public domain (NASA imagery) |
| Eadweard Muybridge, *Animal Locomotion* (1887), Wellcome Collection (`public/samples/elephant`, `cat`, `elk`, `camel`, `raccoon`) | Sample images | Public Domain Mark |
| Eadweard Muybridge, *The Horse in Motion* (1878), Library of Congress (`public/samples/horse`) | Sample images | No known restrictions on publication |
