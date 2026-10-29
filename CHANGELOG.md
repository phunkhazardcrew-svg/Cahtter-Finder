# Changelog

## 1.0.0 – 2026-10-28
- First version: live microphone FFT (32 768 points, ~1.5 Hz), 3 s capture, recording upload.
- Chatter detection: noise floor, peak finding, tooth/spindle/mains harmonic removal, sideband check, confidence.
- Speed check: entered rpm is verified against the measured tooth-pass comb (catches override/typos).
- Stable speeds n = 60·fc/(z·(N+1)) within machine and tool limits, new feed at constant fz, vc.
- Tap test with automatic hit detection, adaptive ring-down window, damping estimate.
- Snapshots and before/after compare; tool list with JSON/CSV export/import; machine profiles.
- Fix guide with frequency bands, countermeasures, overhang calculator, fz check, ACC note.
- Independent reviews (DSP/machining and code/UX): low-rpm speed table window, runout comb at many teeth,
  tight harmonic tolerance after comb fit, tap test for stiff tools, iOS audio start, wake lock,
  XSS-safe import, 44 px touch targets, contrast.
