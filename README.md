# F.S. Editor — Fozmu Studios

**Live: https://editor.fozmu.com** · Windows app: [releases](https://github.com/Fozmu/fs-editor-releases/releases/latest)

Non-linear video editor that runs fully in the browser. No AI, no server: media stays on the device, editing and export run locally (Canvas + Web Audio + WebCodecs via [mediabunny](https://mediabunny.dev)).

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/ (deploy anywhere, e.g. Netlify)
```

Best in Chrome / Edge (WebCodecs + H.264/AAC encoding). Firefox works with WebM export.

## Desktop app (Windows)

```bash
npm run dev:desktop   # Electron + Vite dev server
npm run dist:win      # Windows installer in release/
```

The desktop build adds a bundled **ffmpeg**: any format imports (unsupported codecs are converted to an edit proxy automatically), and export gains x264 HQ, H.265, ProRes 422 HQ and GIF. Media is referenced from disk, projects save as `.fsproj` files (double-click to open), and the app auto-updates.

### Releasing

1. Bump `version` in `package.json` and merge to `main`.
2. GitHub Actions builds the installer and publishes it to [Fozmu/fs-editor-releases](https://github.com/Fozmu/fs-editor-releases) (a version that's already released is skipped); installed apps update themselves.

Needs repo secret `RELEASES_TOKEN`: a fine-grained token with **Contents: read & write** on `Fozmu/fs-editor-releases`.

Every pull request also builds the installer — download it from the workflow run's **Artifacts**.

## Features

**Project & media**
- Import video / audio / images (button, drag & drop onto bin or timeline)
- Thumbnails, waveforms, offline-media relink
- Multiple projects, autosave to IndexedDB, `.fsproj` project files
- Sequence presets: 4K, 1440p, 1080p, 720p, 9:16, 1:1, 4:5, 2.39:1; 23.976–60 fps

**Timeline**
- Unlimited video / audio tracks; hide, mute, solo, lock, track volume, resizable lanes
- Tools: Selection (V), Razor (C), Ripple edit (B), Slip (Y)
- Move across tracks, trim, overwrite edits, snapping, marquee & multi-select
- Split, delete, ripple delete, close gap, copy/paste/duplicate, Alt-drag duplicate
- Markers, In/Out points, zoom (Ctrl+wheel), undo/redo (200 steps)

**Effect Controls (keyframeable)**
- Motion: position, scale, width/height, rotation, opacity; drag/scale directly in the viewer
- Crop & corner radius, blend modes, flip, fit/fill/stretch
- Color: brightness, contrast, saturation, hue, temperature, tint, B&W, sepia, invert + 11 looks
- Effects: Gaussian blur, vignette, drop shadow, adjustment layers
- Keyframes with linear / ease / hold interpolation
- Speed 5%–1600%, detach audio

**Titles** — 12 presets, any font/size/weight, stroke, shadow, background box, typewriter animation

**Transitions** — fade, cross dissolve, dip to black/white, slide ×4, zoom in/out, wipe ×4, iris, blur, spin, typewriter

**Audio** — clip volume & pan (keyframeable), fades, track volume / mute / solo, waveforms

**Export** — MP4 (H.264/AAC) or WebM (VP9/Opus), 25–200 % resolution, frame rate, quality, full or In→Out range, PNG frame grabs. Streams directly to disk in Chromium.

Press `?` in the app for all keyboard shortcuts.

## Structure

```
src/engine/   project model, renderer, playback, export, media, storage
src/ui/       React panels: media bin, viewer, timeline, inspector, dialogs
src/store.ts  Zustand store with undo history
```

## Roadmap

- Chroma key, LUT import, audio effects (EQ, compressor), multicam, proxies
