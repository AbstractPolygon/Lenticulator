# Lenticulator: notes for Claude

## ALWAYS keep the live artifact up to date (user requirement)
Immediately after **every** change to the app, rebuild and republish the claude.ai artifact so the user can see it.
Don't batch changes or leave a change unpublished. If a publish is rejected, fix the cause and republish
before doing anything else. The artifact only serves known file types (e.g. binary data must use `.wasm`):
https://claude.ai/artifact/3c21TLFn6CRxTrVdtvcG8z

```bash
npm run build && node scripts/build-artifact.mjs artifact
```
Then publish `artifact/lenticulator.html` with the Artifact tool (`url` above, `root: "artifact"`, and the
`files` map the script prints). Pass `null` for asset files from the previous version that no longer exist.
The page declares the `downloads` capability (saves go through the host's save prompt).

## UI text
- **No description / explanatory text in the UI.** No hint paragraphs, captions, subtitles or
  parenthetical explanations in labels or dropdown options (e.g. "Vertical", not "Vertical (flip L/R, 3D)").
- **No labels where the control is self-explanatory** (e.g. a slider next to Play, a dropdown whose options
  name themselves). Use `aria-label` for accessibility instead of visible text.
- Explanations belong in tooltips (`title`); every control should have one.
- Keep labels short. Short warnings (⚠) and status messages are fine; explanations go in the README.

## Conventions
- Version lives in `package.json` (shown next to the app name). **Bump it with every change, patch only**:
  0.3.5 → 0.3.6 … up to 0.3.999. Only bump the minor (second) number when the user explicitly asks.
  (`npm version <x.y.z> --no-git-tag-version`), and add a CHANGELOG.md entry.
- `npm test` (vitest) and `npx tsc --noEmit` must pass before committing.
- Use `npm install --legacy-peer-deps` (also set in `.npmrc`).
- Core logic in `src/core/` is pure and unit-tested; UI in `src/main.ts` and `src/ui/`.
- The same web build runs in browsers, in Electron (`electron/`, served over `app://`) and as the artifact.
