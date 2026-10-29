# Changelog

## 1.2.1 – 2026-10-28
- Dropdowns for teeth z (1–24) and tool Ø (standard end mill and face mill sizes) in Setup, Tool list and Fix guide;
  "Other…" opens free entry.

## 1.2.0 – 2026-10-28
- Setup: spindle interface (HSK-A100 default, per machine profile), holder type (shrink, hydraulic, power chuck,
  ER, Weldon, shell mill arbor, damped), total length and stick-out, optional holder front Ø.
- Cut: material (H13 soft, H13 40 HRC, H13 45–50 HRC, P20, C45, GG25, aluminium) and strategy presets
  (HPC, HDC ae 0.1–0.5×D, Highfeed) with editable ae/ap.
- Setup check: beam model of spindle + interface + tapered holder + clamping + tool → tip stiffness, tool mode,
  spindle/holder mode, compliance shares, damping, worst-case and in-pocket stable depth (empirical factor 12,
  calibratable from a known cut), vc range and chip-thinning warnings, biggest lever.
- Measured chatter frequency is assigned to tool mode, spindle/holder mode or workpiece/fixture.
- Speed table flags vc outside the material range. Tool list stores the whole setup; CSV export guarded.
- Fix guide overhang calculator compares whole-assembly stiffness.

## 1.1.0 – 2026-10-28
- Setup: optional overhang L (holder face to tool tip).
- Result: L/D and estimated tool bending range (cantilever, 50–100 % of the solid-shank value). The measured
  frequency is compared with it: fits the tool (speed tuning + shorter overhang help), well below
  (holder, spindle, workpiece, fixture) or above (higher mode, thin wall, edge).
- Overhang is carried into the tool list and prefilled in the Fix guide overhang calculator.

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
