/* ChatterCore: pure signal processing and machining math. No DOM access.
   Units: Hz, rpm, mm, mm/min, m/min. Spectra are one-sided power arrays (length N/2+1). */
const ChatterCore = (function () {
  "use strict";

  /* ---------- FFT (radix-2, in place) ---------- */
  const fftCache = new Map();
  function fftTables(n) {
    let t = fftCache.get(n);
    if (t) return t;
    const lev = Math.round(Math.log2(n));
    if (1 << lev !== n) throw new Error("FFT size must be a power of two");
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < lev; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    t = { rev, cos, sin };
    fftCache.set(n, t);
    return t;
  }
  function fft(re, im) {
    const n = re.length, { rev, cos, sin } = fftTables(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const p = i + j, q = p + half, wr = cos[k], wi = -sin[k];
          const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        }
      }
    }
  }

  /* ---------- Windows and spectra ---------- */
  const hannCache = new Map();
  function hann(n) {
    let w = hannCache.get(n);
    if (w) return w;
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    hannCache.set(n, w);
    return w;
  }
  /* Power spectrum of one Hann-windowed frame. Scaled so a full-scale sine reads about 0 dB. */
  function frameSpectrum(x, n) {
    const w = hann(n), re = new Float64Array(n), im = new Float64Array(n);
    let ws = 0;
    for (let i = 0; i < n; i++) { re[i] = (x[i] || 0) * w[i]; ws += w[i]; }
    fft(re, im);
    const half = n / 2, P = new Float64Array(half + 1), s = 4 / (ws * ws);
    for (let k = 0; k <= half; k++) P[k] = (re[k] * re[k] + im[k] * im[k]) * s;
    return P;
  }
  /* Welch average over a whole recording (50 % overlap). */
  function welch(samples, n) {
    const hop = n / 2;
    let acc = null, cnt = 0;
    if (samples.length < n) {
      const pad = new Float32Array(n); pad.set(samples);
      return frameSpectrum(pad, n);
    }
    for (let s = 0; s + n <= samples.length; s += hop) {
      const P = frameSpectrum(samples.subarray(s, s + n), n);
      if (!acc) acc = P; else for (let k = 0; k < P.length; k++) acc[k] += P[k];
      cnt++;
    }
    for (let k = 0; k < acc.length; k++) acc[k] /= cnt;
    return acc;
  }
  function toDb(P) {
    const d = new Float32Array(P.length);
    for (let k = 0; k < P.length; k++) d[k] = 10 * Math.log10(P[k] + 1e-14);
    return d;
  }
  function rmsDb(x) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return 10 * Math.log10(s / Math.max(1, x.length) + 1e-14);
  }

  /* Noise floor: 35th percentile in a sliding window of about ±winHz, computed on a coarse grid and interpolated. */
  function noiseFloor(db, df, winHz) {
    const n = db.length, half = Math.max(8, Math.round((winHz || 60) / df)), step = Math.max(1, Math.round(half / 6));
    const gridK = [], gridV = [];
    const buf = [];
    for (let k = 0; k < n; k += step) {
      const a = Math.max(0, k - half), b = Math.min(n - 1, k + half);
      buf.length = 0;
      for (let i = a; i <= b; i++) buf.push(db[i]);
      buf.sort((p, q) => p - q);
      gridK.push(k); gridV.push(buf[Math.floor(buf.length * 0.35)]);
    }
    if (gridK[gridK.length - 1] !== n - 1) { gridK.push(n - 1); gridV.push(gridV[gridV.length - 1]); }
    const fl = new Float32Array(n);
    for (let g = 0; g < gridK.length - 1; g++) {
      const k0 = gridK[g], k1 = gridK[g + 1], v0 = gridV[g], v1 = gridV[g + 1];
      for (let k = k0; k <= k1; k++) fl[k] = v0 + (v1 - v0) * (k - k0) / Math.max(1, k1 - k0);
    }
    return fl;
  }

  /* Local maxima above the floor, refined by parabolic interpolation on the dB curve. */
  function findPeaks(db, floor, df, fmin, fmax, minProm) {
    const out = [], n = db.length, R = 3;
    const k0 = Math.max(R, Math.ceil(fmin / df)), k1 = Math.min(n - 1 - R, Math.floor(fmax / df));
    for (let k = k0; k <= k1; k++) {
      const v = db[k];
      if (v - floor[k] < minProm) continue;
      let isMax = true;
      for (let j = 1; j <= R; j++) { if (db[k - j] > v || db[k + j] >= v) { isMax = false; break; } }
      if (!isMax) continue;
      const a = db[k - 1], b = v, c = db[k + 1], den = a - 2 * b + c;
      const d = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
      out.push({ f: (k + d) * df, level: b - 0.25 * (a - c) * d, prom: v - floor[k], bin: k });
    }
    out.sort((p, q) => q.level - p.level);
    return out;
  }

  /* Label a peak frequency as tooth-pass harmonic, spindle (runout) harmonic, mains hum or none. */
  /* Tolerance for "is this a harmonic": wide while the speed is only known from the input,
     tight once the tooth-pass frequency has been fitted to the measured comb (ctx.fitted). */
  function harmTol(f, ctx) {
    return ctx.fitted ? Math.max(2 * ctx.df, 0.0005 * f) : Math.max(2.5 * ctx.df, 0.003 * f);
  }
  function classify(f, ctx) {
    const tol = harmTol(f, ctx);
    const fr = ctx.rpm / 60, ft = fr * ctx.z;
    if (ft > 0 && ft > 4 * tol) {
      const k = Math.round(f / ft);
      if (k >= 1 && Math.abs(f - k * ft) <= tol) return { type: "tooth", k };
    }
    if (fr > 0 && fr > 10 * tol) {
      const k = Math.round(f / fr);
      if (k >= 1 && Math.abs(f - k * fr) <= tol) return { type: "spindle", k };
    }
    if (ctx.mains > 0) {
      const k = Math.round(f / ctx.mains);
      if (k >= 1 && k <= 8 && Math.abs(f - k * ctx.mains) <= 1.5 + ctx.df) return { type: "mains", k };
    }
    return { type: "none", k: 0 };
  }
  /* Can the current speed be told apart from chatter at frequency f at all? */
  function harmonicResolution(f, ctx) {
    const tol = harmTol(f, ctx), fr = ctx.rpm / 60, ft = fr * ctx.z;
    if (!(ft > 4 * tol)) return false;
    /* Spindle harmonics too dense to test one by one: f could be a runout harmonic */
    if (!(fr > 10 * tol) && fr > 0) {
      const k = Math.round(f / fr);
      if (k >= 1 && Math.abs(f - k * fr) <= tol) return false;
    }
    return true;
  }
  /* Refine a tooth-pass frequency by least squares on the peaks that sit on its comb (tight tolerance).
     Only harmonics 1..6: a chatter peak with its tooth-pass sidebands also forms a short comb with
     spacing ft, and at high orders it would pull the fit onto itself. */
  function refineComb(peaks, f0, df) {
    for (let it = 0; it < 3; it++) {
      let sfm = 0, smm = 0, cnt = 0;
      for (const q of peaks.slice(0, 20)) {
        const m = Math.round(q.f / f0);
        if (m >= 1 && m <= 6 && Math.abs(q.f - m * f0) <= Math.max(1.5 * df, 0.001 * q.f)) { sfm += q.f * m; smm += m * m; cnt++; }
      }
      if (cnt < 3) return null;
      f0 = sfm / smm;
    }
    return f0;
  }

  /* Find the base frequency f0 (within ±20 % of the nominal tooth-pass frequency) whose multiples
     explain the most of the 12 strongest peaks. Returns {f0, count} refined by least squares, or null. */
  function estimateToothFreq(peaks, ftNom, df) {
    if (!(ftNom > 0)) return null;
    const top = peaks.slice(0, 12);
    let best = null;
    for (const p of top) {
      for (let k = 1; k <= 6; k++) {
        const f0 = p.f / k;
        if (Math.abs(f0 / ftNom - 1) > 0.2) continue;
        let count = 0, sfm = 0, smm = 0;
        for (const q of top) {
          const m = Math.round(q.f / f0);
          if (m >= 1 && Math.abs(q.f - m * f0) <= Math.max(2 * df, 0.002 * q.f)) { count++; sfm += q.f * m; smm += m * m; }
        }
        if (count < 3) continue;
        const fr = sfm / smm;
        if (!best || count > best.count || (count === best.count && Math.abs(fr - ftNom) < Math.abs(best.f0 - ftNom))) best = { f0: fr, count };
      }
    }
    return best;
  }

  /* Main analysis of a cutting sound. P = power spectrum, sr = sample rate, n = FFT size. */
  function analyzeCut(P, sr, n, ctx) {
    const df = sr / n, db = toDb(P);
    const fmin = ctx.fmin || 40, fmax = Math.min(ctx.fmax || 12000, sr * 0.45);
    const floor = noiseFloor(db, df, 60);
    const peaks = findPeaks(db, floor, df, fmin, fmax, 8);
    const c = { rpm: ctx.rpm, z: ctx.z, df, mains: ctx.mains || 0 };
    for (const p of peaks) p.cls = classify(p.f, c);
    /* Speed check: if a harmonic comb near the entered tooth-pass frequency explains more peaks,
       the entered speed is off (override, typo). Use the measured comb instead. */
    let rpmEst = NaN;
    const est = estimateToothFreq(peaks, ctx.rpm / 60 * ctx.z, df);
    if (est) {
      const nominal = peaks.slice(0, 12).filter(p => p.cls.type === "tooth").length;
      if (est.count >= Math.max(4, nominal + 2) && Math.abs(est.f0 / (ctx.rpm / 60 * ctx.z) - 1) > 0.004) {
        rpmEst = est.f0 * 60 / ctx.z;
        c.rpm = rpmEst;
        for (const p of peaks) p.cls = classify(p.f, c);
      }
      /* Pin the comb to the measured harmonics so the harmonic test can use a tight tolerance:
         chatter a few Hz beside a tooth harmonic is then not hidden as "tooth". Only small
         corrections (< 0.5 %) are applied silently; larger ones are the rpmEst case above. */
      const fit = refineComb(peaks, est.f0, df);
      const ftNow = c.rpm / 60 * ctx.z;
      if (fit && Math.abs(fit / ftNow - 1) < 0.005) {
        c.rpm = fit * 60 / ctx.z; c.fitted = true;
        for (const p of peaks) p.cls = classify(p.f, c);
      }
    }
    /* Low speed, many teeth: spindle (runout) harmonics are too dense for classify() (it only labels
       them when they are 10 tolerances apart, so a chatter peak is rarely hidden). A peak on
       k·fr with a non-tooth neighbour on (k±1)·fr or (k±2)·fr of similar level is part of a runout comb, not chatter. */
    const fr = c.rpm / 60;
    for (const p of peaks) {
      if (p.cls.type !== "none" || !(fr > 0)) continue;
      const tol = harmTol(p.f, c);
      if (fr > 10 * tol || fr <= 2 * tol) continue;
      const k = Math.round(p.f / fr);
      if (k < 1 || Math.abs(p.f - k * fr) > tol) continue;
      const nb = peaks.some(q => q !== p && q.level >= p.level - 10 && q.cls.type !== "tooth" &&
        [-2, -1, 1, 2].some(d => k + d >= 1 && Math.abs(q.f - (k + d) * fr) <= harmTol(q.f, c)));
      if (nb) p.cls = { type: "spindle", k };
    }
    const harm = peaks.filter(p => p.cls.type === "tooth" || p.cls.type === "spindle");
    const free = peaks.filter(p => p.cls.type === "none");
    const topHarm = harm.length ? harm[0] : null;
    let maxLevel = -200;
    for (let k = Math.ceil(fmin / df); k <= Math.floor(fmax / df); k++) if (db[k] > maxLevel) maxLevel = db[k];
    const ft = c.rpm / 60 * ctx.z;
    let cand = null;
    /* Strongest non-harmonic peak wins; prominence breaks near-ties (within 3 dB) */
    for (const p of free) {
      if (!cand || p.level > cand.level + 3 || (Math.abs(p.level - cand.level) <= 3 && p.prom > cand.prom)) cand = p;
    }
    let verdict = "clean", confidence = 0, sidebands = 0;
    if (cand) {
      const rel = topHarm ? cand.level - topHarm.level : 0;
      if (ft > 0) {
        for (const s of [-2, -1, 1, 2]) {
          const fs = cand.f + s * ft;
          if (fs <= fmin || fs >= fmax) continue;
          const tol = Math.max(3 * df, 0.004 * fs);
          if (free.some(q => q !== cand && Math.abs(q.f - fs) <= tol)) sidebands++;
        }
      }
      confidence = Math.max(0, Math.min(1, (cand.prom - 8) / 20 + (rel + 20) / 60 + 0.12 * sidebands));
      if (cand.prom >= 15 && rel >= -10) verdict = "chatter";
      else if (cand.prom >= 10 && rel >= -20) verdict = "possible";
      else verdict = harm.length ? "forced" : "clean";
    } else if (harm.length) verdict = "forced";
    if (verdict === "chatter" || verdict === "possible") {
      if (!harmonicResolution(cand.f, c)) confidence *= 0.6;
    }
    return { db, floor, df, peaks, cand: (verdict === "chatter" || verdict === "possible") ? cand : null,
      alt: free.slice(0, 4), topHarm, verdict, confidence, sidebands, maxLevel, rpmEst, rpmUsed: c.rpm,
      resolvable: cand ? harmonicResolution(cand.f, c) : true };
  }

  /* Best spindle speeds: tooth-pass frequency = fc/(N+1). */
  /* Rows are listed from high to low speed. With a current speed, the window is centred on the
     pocket nearest to it (5 faster, 2 slower), so the nearby pockets are never cut off at low rpm. */
  function suggestSpeeds(fc, z, rpmNow, nMin, nMax, maxRows) {
    const all = [], mx = maxRows || 8;
    if (!(fc > 0 && z > 0)) return all;
    for (let N = 0; N < 5000; N++) {
      const n = 60 * fc / (z * (N + 1));
      if (n < nMin) break;
      if (n > nMax) continue;
      all.push({ N, n, nRound: Math.round(n / 10) * 10, change: rpmNow > 0 ? (n / rpmNow - 1) : 0, ft: n * z / 60 });
      if (!(rpmNow > 0) && all.length >= mx) break;
    }
    if (!(rpmNow > 0) || all.length <= mx) return all;
    let near = 0;
    for (let i = 1; i < all.length; i++) if (Math.abs(all[i].n - rpmNow) < Math.abs(all[near].n - rpmNow)) near = i;
    const start = Math.max(0, Math.min(all.length - mx, near - (mx - 3)));
    return all.slice(start, start + mx);
  }
  /* Phase between successive teeth for chatter frequency fc at speed rpm. */
  function phaseInfo(fc, z, rpm) {
    const ft = rpm * z / 60;
    if (!(ft > 0)) return null;
    const q = fc / ft, N = Math.floor(q), eps = (q - N) * 360;
    return { ratio: q, N, eps };
  }
  function pickRecommendations(rows, rpmNow) {
    if (!rows.length) return {};
    let above = null, nearest = null;
    for (const r of rows) {
      if (r.n >= rpmNow && (!above || r.n < above.n)) above = r;
      if (!nearest || Math.abs(r.n - rpmNow) < Math.abs(nearest.n - rpmNow)) nearest = r;
    }
    return { above, nearest, best: rows[0] };
  }

  function cuttingSpeed(D, rpm) { return Math.PI * D * rpm / 1000; }
  function scaleFeed(F, rpmOld, rpmNew) { return rpmOld > 0 ? F * rpmNew / rpmOld : NaN; }

  /* Cantilever estimate for a solid tool shank. D, L in mm. Returns k in N/µm and first bending mode in Hz. */
  function overhang(D, L, mat) {
    const E = mat === "steel" ? 210e9 : mat === "hss" ? 220e9 : 600e9;
    const rho = mat === "steel" || mat === "hss" ? 7850 : 14500;
    const d = 0.8 * D / 1000, l = L / 1000;
    const I = Math.PI * Math.pow(d, 4) / 64, A = Math.PI * d * d / 4;
    const k = 3 * E * I / Math.pow(l, 3) / 1e6;
    const fn = (1.875 * 1.875 / (2 * Math.PI)) * Math.sqrt(E * I / (rho * A * Math.pow(l, 4)));
    return { k, fn };
  }

  /* ---------- Tap test ---------- */
  /* Find hammer hits in a recording: block peak far above the running noise. Returns sample indices. */
  function detectTaps(x, sr, opts) {
    const o = Object.assign({ block: 256, ratio: 10, minAbs: 0.02, refractory: 0.5 }, opts || {});
    const hits = [];
    let noise = 0, init = false, last = -Infinity;
    for (let s = 0; s + o.block <= x.length; s += o.block) {
      let pk = 0, sq = 0;
      for (let i = s; i < s + o.block; i++) { const v = Math.abs(x[i]); if (v > pk) pk = v; sq += v * v; }
      const rms = Math.sqrt(sq / o.block);
      if (!init) { noise = rms; init = true; continue; }
      if (pk > Math.max(o.minAbs, o.ratio * noise * 1.414) && (s - last) / sr > o.refractory) {
        let j = s;
        for (let i = s; i < s + o.block; i++) if (Math.abs(x[i]) > 0.5 * pk) { j = i; break; }
        hits.push(j); last = s;
      } else if (rms < 4 * noise) {
        noise = 0.98 * noise + 0.02 * rms;
      }
    }
    return hits;
  }
  /* Power spectrum of the ring-down after one hit: skip the click, taper the tail, zero-pad. */
  /* The click is skipped (TAP_SKIP s). The window ends where the ring-down has sunk into the noise
     (at least 25 ms): a stiff, well damped tool rings only a few ms, and a fixed long window
     would bury that in noise. Normalisation is fixed, so taps of different length average fairly. */
  const TAP_SKIP = 0.0015;
  function tapSpectrum(x, sr, start, n) {
    const Lmax = n / 2, skip = Math.round(TAP_SKIP * sr);
    const seg = new Float32Array(n);
    const t0 = start + skip;
    const B = Math.max(16, Math.round(0.001 * sr)), nb = Math.floor(Math.min(Lmax, x.length - t0) / B);
    let L = Lmax;
    if (nb >= 8) {
      const e = [];
      for (let b = 0; b < nb; b++) { let s = 0; for (let i = 0; i < B; i++) { const v = x[t0 + b * B + i]; s += v * v; } e.push(s / B); }
      const tail = e.slice(Math.floor(nb * 0.7)).sort((p, q) => p - q), noise = tail[Math.floor(tail.length / 2)] || 0;
      let end = nb;
      for (let b = 0; b < nb; b++) if (e[b] < 4 * noise) { end = b; break; }
      L = Math.min(Lmax, Math.max(Math.round(0.025 * sr), Math.round(end * B * 1.6)));
    }
    const taper = Math.floor(L * 0.3);
    for (let i = 0; i < L && t0 + i < x.length; i++) {
      let w = 1;
      if (i > L - taper) w = 0.5 + 0.5 * Math.cos(Math.PI * (i - (L - taper)) / taper);
      seg[i] = x[t0 + i] * w;
    }
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = seg[i];
    fft(re, im);
    const P = new Float64Array(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) P[k] = (re[k] * re[k] + im[k] * im[k]) / (Lmax * Lmax);
    return P;
  }
  function analyzeTap(P, sr, n, fmin) {
    const df = sr / n, db = toDb(P), floor = noiseFloor(db, df, 2000);
    const peaks = findPeaks(db, floor, df, fmin || 150, sr * 0.45, 10);
    /* Half-power bandwidth of the strongest mode gives a rough damping ratio */
    let zeta = NaN;
    if (peaks.length) {
      const p = peaks[0], k = p.bin, lim = p.level - 3;
      let a = k, b = k;
      while (a > 1 && db[a] > lim) a--;
      while (b < db.length - 2 && db[b] > lim) b++;
      const bw = (b - a) * df;
      if (bw > 2 * df) zeta = bw / (2 * p.f);
    }
    return { db, floor, df, peaks, fn: peaks.length ? peaks[0].f : NaN, zeta };
  }

  /* Compress a dB spectrum to a fixed grid for storage (step Hz up to fmax). */
  function compress(db, df, step, fmax) {
    const out = [];
    for (let f = 0; f <= fmax; f += step) {
      const a = Math.floor(f / df), b = Math.min(db.length - 1, Math.floor((f + step) / df));
      let m = -200;
      for (let k = a; k <= b; k++) if (db[k] > m) m = db[k];
      out.push(Math.round(m * 10) / 10);
    }
    return out;
  }
  function levelAt(arr, step, f, bw) {
    const a = Math.max(0, Math.floor((f - bw) / step)), b = Math.min(arr.length - 1, Math.ceil((f + bw) / step));
    let m = -200;
    for (let i = a; i <= b; i++) if (arr[i] > m) m = arr[i];
    return m;
  }
  function bandEnergyDb(arr, step, f0, f1) {
    let s = 0;
    for (let i = Math.floor(f0 / step); i <= Math.min(arr.length - 1, Math.floor(f1 / step)); i++) s += Math.pow(10, arr[i] / 10);
    return 10 * Math.log10(s + 1e-14);
  }

  /* ---------- Tool assembly model ----------
     Static tip compliance of spindle + interface + holder + clamp + tool as a stepped cantilever:
     a force F at the tip bends every segment with the moment arm to the tip.
     Values are engineering estimates for comparing setups, not measured data. */
  const SPINDLES = {
    /* kr: radial stiffness at the spindle nose N/µm; kth: tilt stiffness of bearings + interface Nm/rad;
       m: effective spindle mass at the nose kg; body: max. holder body Ø mm; fl/flLen: flange Ø and length mm
       (the flange sits right in front of the spindle face, inside the gauge length) */
    "HSK-A100": { kr: 250, kth: 2.5e6, m: 6.0, body: 75, fl: 100, flLen: 28 },
    "HSK-A63":  { kr: 150, kth: 1.0e6, m: 3.0, body: 50, fl: 63,  flLen: 24 },
    "HSK-A125": { kr: 320, kth: 4.0e6, m: 8.0, body: 90, fl: 125, flLen: 32 },
    "SK50/BT50":{ kr: 220, kth: 2.0e6, m: 6.0, body: 70, fl: 97,  flLen: 20 },
    "SK40/BT40":{ kr: 120, kth: 0.7e6, m: 3.0, body: 50, fl: 63,  flLen: 16 },
    "Capto C8": { kr: 240, kth: 2.3e6, m: 6.0, body: 70, fl: 80,  flLen: 22 },
    "Capto C6": { kr: 160, kth: 1.1e6, m: 3.5, body: 50, fl: 63,  flLen: 20 }
  };
  /* clamp: extra effective length in multiples of D at the holder face; zeta: typical damping of the assembly;
     nose: estimated holder front diameter as a function of D; taper: half angle in degrees from the nose toward the spindle */
  const HOLDERS = {
    shrink:  { name: "Shrink fit",            clamp: 0.30, zeta: 0.020, taper: 4.5, nose: D => D + 11 },
    hydro:   { name: "Hydraulic",             clamp: 0.50, zeta: 0.028, taper: 2, nose: D => D + 16 },
    power:   { name: "Power / milling chuck", clamp: 0.35, zeta: 0.025, taper: 2, nose: D => D + 30 },
    er:      { name: "Collet ER",             clamp: 1.60, zeta: 0.028, taper: 6, nose: D => Math.max(D + 22, 1.9 * D + 14) },
    weldon:  { name: "Weldon / side lock",    clamp: 0.80, zeta: 0.025, taper: 0, nose: D => D + 26 },
    shell:   { name: "Shell mill arbor (face / insert cutter)", clamp: 0.10, zeta: 0.030, taper: 0, nose: D => Math.max(40, 0.5 * D), shell: true },
    damped:  { name: "Damped holder / extension", clamp: 0.40, zeta: 0.050, taper: 0, nose: D => D + 20 }
  };
  /* Ks: specific cutting force N/mm² used as the tangential coefficient in the stability estimate (relative values
     matter, the absolute level is absorbed by the calibration factor); vc: typical range m/min for coated solid carbide */
  const MATERIALS = {
    h13soft: { name: "H13 / 1.2344 soft annealed (~200 HB)", Ks: 2100, vc: [140, 220] },
    h13_40:  { name: "H13 / 1.2344 at 40 HRC",               Ks: 2600, vc: [90, 160] },
    h13_48:  { name: "H13 / 1.2344 at 45–50 HRC",            Ks: 3000, vc: [60, 120] },
    p20:     { name: "P20 / 1.2311 (~30 HRC)",               Ks: 2300, vc: [150, 240] },
    c45:     { name: "C45 / 1.0503",                         Ks: 2000, vc: [180, 280] },
    gg25:    { name: "Grey cast iron GG25",                  Ks: 1300, vc: [150, 250] },
    alu:     { name: "Aluminium alloy",                      Ks: 800,  vc: [300, 1000] }
  };
  /* ae and ap as multiples of D; mu: share of the cutting force that drives the bending direction */
  const STRATEGIES = {
    hpc:    { name: "HPC (trochoidal, small ae)", ae: 0.10, ap: 1.5,  mu: 0.50 },
    hdc01:  { name: "HDC ae 0.1×D",               ae: 0.10, ap: 0.5,  mu: 0.55 },
    hdc02:  { name: "HDC ae 0.2×D",               ae: 0.20, ap: 0.5,  mu: 0.60 },
    hdc03:  { name: "HDC ae 0.3×D",               ae: 0.30, ap: 0.5,  mu: 0.60 },
    hdc04:  { name: "HDC ae 0.4×D",               ae: 0.40, ap: 0.5,  mu: 0.60 },
    hdc05:  { name: "HDC ae 0.5×D",               ae: 0.50, ap: 0.5,  mu: 0.60 },
    highfeed:{ name: "Highfeed (small ap, axial force)", ae: 0.70, ap: 0.06, mu: 0.25 },
    custom: { name: "Custom",                     ae: 0.30, ap: 0.5,  mu: 0.60 }
  };

  /* table lookup that ignores inherited keys such as "constructor" */
  function own(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : null; }
  /* inp: {spindle, holder, D, L (stick-out), Lg (gauge length from spindle face), Dh (optional holder front Ø)} all mm */
  function assembly(inp) {
    const sp = own(SPINDLES, inp.spindle) || SPINDLES["HSK-A100"], h = own(HOLDERS, inp.holder) || HOLDERS.shrink;
    const D = inp.D, L = inp.L;
    if (!(D > 0 && L > 0)) return null;
    /* unknown gauge length: typical holder (shell mill arbors are short stubs) */
    const Lg = inp.Lg > L ? inp.Lg : L + (h.shell ? 60 : 2.5 * D + 40);
    const Lh = Lg - L;
    const Dh = inp.Dh > D || (h.shell && inp.Dh > 0) ? inp.Dh : h.nose(D);
    const Ec = 600e9, Es = 210e9, rc = 14500, rs = 7850, mm = 1e-3;
    /* cutting part: fluted length (core about 0.8·D) near the tip, full shank Ø behind it; shell mills: cutter body */
    const Etool = h.shell ? Es : Ec, rTool = h.shell ? rs : rc;
    const dFl = (h.shell ? 0.6 : 0.8) * D * mm, dSh = (h.shell ? 0.6 : 1.0) * D * mm;
    const Lfl = Math.min(L, h.shell ? L : 2.5 * D);
    const IFl = Math.PI * Math.pow(dFl, 4) / 64, ISh = Math.PI * Math.pow(dSh, 4) / 64;
    /* bore: the clamped shank (length lc) stiffens the holder front; behind it only a small screw/coolant bore */
    const dIn = h.shell ? 0 : D * mm, lc = h.shell ? 0 : Math.min(Lh, 3 * D), dBack = h.shell ? 0 : 0.5 * D * mm;
    /* holder Ø grows from the nose toward the spindle with the taper angle, capped at the body Ø of the interface */
    const tg = 2 * Math.tan((h.taper || 0) * Math.PI / 180), Dbody = Math.max(sp.body, Dh);
    const flStart = Lh - Math.min(sp.flLen, 0.5 * Lh);
    const dAt = u => (u >= flStart ? Math.max(sp.fl, Dh) : Math.min(Dbody, Dh + tg * u)) * mm;   /* u = mm from the nose */
    const Lm = L * mm, Lgm = Lg * mm, Lhm = Lh * mm;
    /* compliances in m/N for a unit force at the tip: integral of arm² / (E I) along the beam */
    const cSpindle = 1 / (sp.kr * 1e6) + Lgm * Lgm / sp.kth;
    const NS = 40;
    let cHolder = 0, cBaseH = 0, mHolderBody = 0;
    for (let i = 0; i < NS; i++) {
      const u = (i + 0.5) / NS * Lh, du = Lh / NS * mm, d = dAt(u), inClamp = u < lc, b = inClamp ? dIn : dBack;
      /* bending stiffness E·I of the holder wall, plus the clamped tool shank inside it */
      const EI = Es * Math.PI * (Math.pow(d, 4) - Math.pow(b, 4)) / 64 + (inClamp ? Etool * Math.PI * Math.pow(dIn, 4) / 64 : 0);
      const arm = (L + u) * mm, armBase = u * mm;
      cHolder += arm * arm * du / EI;
      cBaseH += armBase * armBase * du / EI;
      mHolderBody += rs * Math.PI * (d * d - b * b) / 4 * du;
    }
    const lf = Lfl * mm;
    const cTool = Math.pow(lf, 3) / (3 * Etool * IFl) + (Math.pow(Lm, 3) - Math.pow(lf, 3)) / (3 * Etool * ISh);
    const cClamp = Lm * Lm * (h.clamp * D * mm) / (Etool * ISh);
    const cTot = cSpindle + cHolder + cClamp + cTool;
    const kTip = 1 / cTot / 1e6;                              /* N/µm */
    /* masses */
    const mTool = rTool * Math.PI / 4 * (dFl * dFl * lf + dSh * dSh * (Lm - lf));
    const mHolder = mHolderBody + rTool * Math.PI * dIn * dIn / 4 * lc * mm;
    /* Two modes. Tool mode: tool mass (cantilever equivalent 0.236·m) on the whole tip compliance.
       Spindle/holder mode: spindle, holder and tool mass on the compliance at the holder nose. */
    const fTool = Math.sqrt(1 / cTot / (0.236 * mTool)) / (2 * Math.PI);
    const cBase = 1 / (sp.kr * 1e6) + Lhm * Lhm / sp.kth + cBaseH;
    const fBase = Math.sqrt(1 / cBase / (sp.m + mHolder + mTool)) / (2 * Math.PI);
    const flexTool = cTool + cClamp, flexBase = cSpindle + cHolder;
    const dominant = flexTool >= flexBase ? "tool" : "base";
    return { Lg, Lh, Dh, kTip, fTool, fBase, fn: dominant === "tool" ? fTool : fBase, dominant, zeta: h.zeta, mTool, mHolder,
      share: { spindle: cSpindle / cTot, holder: cHolder / cTot, clamp: cClamp / cTot, tool: cTool / cTot }, guessedLg: !(inp.Lg > L),
      shell: !!h.shell, flLen: sp.flLen };
  }
  /* Worst-case stable depth of cut over all speeds (1 DOF, average directional factor). k in N/µm, Ks N/mm². */
  function stableDepth(k, zeta, Ks, mu, z, aeD) {
    const phi = Math.acos(1 - 2 * Math.min(1, Math.max(0.001, aeD)));
    const ze = Math.max(z * phi / (2 * Math.PI), 0.15);
    return { aLim: 2 * k * 1000 * zeta * (1 + zeta) / (Ks * mu * ze), ze, phiDeg: phi * 180 / Math.PI };
  }
  /* Maximum chip thickness with radial chip thinning (ae < D/2) */
  function chipThickness(fz, aeD) {
    const a = Math.min(1, Math.max(0, aeD));
    return a >= 0.5 ? fz : fz * 2 * Math.sqrt(a * (1 - a));
  }
  function vcStatus(matKey, vc) {
    const m = own(MATERIALS, matKey);
    if (!m || !(vc > 0)) return null;
    return { lo: m.vc[0], hi: m.vc[1], status: vc < m.vc[0] * 0.9 ? "low" : vc > m.vc[1] * 1.1 ? "high" : "ok" };
  }
  /* Which part of the assembly does a measured frequency belong to? */
  function sourceOf(f, asm) {
    if (!asm || !(f > 0)) return null;
    const inT = f >= 0.6 * asm.fTool && f <= 1.35 * asm.fTool, inB = f >= 0.55 * asm.fBase && f <= 1.5 * asm.fBase;
    if (inT && inB) return Math.abs(Math.log(f / asm.fTool)) < Math.abs(Math.log(f / asm.fBase)) ? "tool" : "base";
    if (inT) return "tool";
    if (inB) return "base";
    if (f < 0.55 * Math.min(asm.fTool, asm.fBase)) return "below";
    return f > 1.35 * Math.max(asm.fTool, asm.fBase) ? "above" : "between";
  }

  return { SPINDLES, HOLDERS, MATERIALS, STRATEGIES, assembly, stableDepth, chipThickness, vcStatus, sourceOf,
    fft, hann, frameSpectrum, welch, toDb, rmsDb, noiseFloor, findPeaks, classify, analyzeCut,
    suggestSpeeds, phaseInfo, pickRecommendations, cuttingSpeed, scaleFeed, overhang,
    detectTaps, tapSpectrum, TAP_SKIP, analyzeTap, compress, levelAt, bandEnergyDb, refineComb };
})();
if (typeof module !== "undefined") module.exports = ChatterCore;
