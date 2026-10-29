# Chatter Finder

Phone web app for CNC milling: listen to the cut, find the chatter frequency, get stable spindle speeds.

## Use at the machine
1. Open https://phunkhazardcrew-svg.github.io/Cahtter-Finder/ in Chrome or Safari on the phone, allow the microphone. Menu → *Add to home screen* makes it start like an app.
2. Measure tab: pick machine, enter actual spindle speed n (override included), teeth z, tool Ø, feed F and overhang L. The overhang does not change the speed table (the measured fc already contains it), but it tells you whether the tool itself or the holder/spindle/workpiece is chattering.
3. **Cutting sound:** start the microphone, hold the phone 20–50 cm from the cut while it chatters, press *Capture 3 s*.
4. Read the result: chatter frequency fc, phase ε, sidebands. The *Stable speeds* table lists n = 60·fc / (z·(N+1)) inside the machine limits; the row marked *try first* is the next pocket above the current speed.
5. Cut again at the new speed, capture, *Save snapshot*, and compare before/after in the Compare tab.
6. **Tap test:** spindle stopped, tap the cutting edge 5–10 times; the app averages the ring-downs and gives the tool natural frequency fn and a damping estimate.
7. No live microphone (embedded preview, blocked)? Record with the voice memo app and use *Load recording*.

## Tabs
- **Measure** – live spectrum, verdict, stable speeds, new feed.
- **Compare** – overlay two snapshots, level change at the chatter frequency.
- **Tool list** – per-tool record (holder, overhang, fc, fn, good/bad speeds), JSON/CSV export and import.
- **Fix guide** – frequency bands → likely source, ordered countermeasures, overhang calculator (k ∝ 1/L³, fn ∝ 1/L²), feed-per-tooth check, ACC note (< 100 Hz only).
- **Machines** – speed limits per machine (defaults are placeholders: check the spindle data plate), mains frequency, ignore-below frequency.

## Files
- `index.html` – the built app (served by GitHub Pages). `chatter-finder.html` – same app as fragment for the claude.ai artifact.
- `src/core.js` – DSP and machining math, no DOM. `src/app.src.html` – UI source with `/*CORE*/` placeholder.
- `build.sh` – rebuilds `index.html` and `chatter-finder.html` from `src/`. Edit `src/`, never `index.html`.
- `test/test-core.js` – synthetic signal tests (`node test/test-core.js`).
- `test/mkwav.js` + `test/e2e.js` – generate test WAVs, then Playwright end-to-end test with a fake microphone.
- `manifest.webmanifest`, `icon.svg` – "Add to home screen" support.

## Limits
Single-degree-of-freedom rules of thumb. Phone microphones are uncalibrated: frequencies are accurate, levels are relative. Drive, pump or bearing whine can look like chatter – cross-check once with the spindle running in air. Chatter within ~3 Hz of a tooth harmonic cannot be separated. A wrong z gives wrong speeds. Always approach new speeds carefully.
