# Lenticulator: notes for Claude

## Always update the live artifact
After **every** change to the app, rebuild and republish the claude.ai artifact so the user can see it:
https://claude.ai/artifact/3c21TLFn6CRxTrVdtvcG8z

```bash
npm run build && node scripts/build-artifact.mjs artifact
```
Then publish `artifact/lenticulator.html` with the Artifact tool (`url` above, `root: "artifact"`, and the
`files` map the script prints). Pass `null` for asset files from the previous version that no longer exist.
The page declares the `downloads` capability (saves go through the host's save prompt).

## Conventions
- Version lives in `package.json` (shown next to the app name). Start: 0.2.0.
- `npm test` (vitest) and `npx tsc --noEmit` must pass before committing.
- Use `npm install --legacy-peer-deps` (also set in `.npmrc`).
- Core logic in `src/core/` is pure and unit-tested; UI in `src/main.ts` and `src/ui/`.
- The same web build runs in browsers, in Electron (`electron/`, served over `app://`) and as the artifact.
