class SprayPaint {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;
    this.currentX = 0;
    this.currentY = 0;

    // Spray settings
    this.color = "#000000";
    this.nozzleSize = 25;
    this.softness = 0.95; // 95% softness
    this.opacity = 1.0; // 100% opacity
    this.flow = 1.2; // 120% flow

    // Performance optimization
    this.stampCache = new Map();
    this.lastStampTime = 0;
    this.stampInterval = 0; // No throttling - maximum performance

    // Pressure simulation
    this.pressure = 1.0;
    this.pressureSmoothing = 0.2;

    // Scatter controls
    this.scatterRadiusMultiplier = 2.0; // 200% default
    this.scatterAmountMultiplier = 1.0; // 100% default - full density
    this.scatterSizeMultiplier = 1.5; // 150% default

    // Overspray control
    this.oversprayMultiplier = 1.0; // 100% default

    // Distance physics
    this.distance = 6; // 6px default
    this.theta0 = 0.2; // ~11.5°
    this.kTheta = 0.1;
    this.Dref = 40; // px nozzle reference

    // Overspray simulation
    this.lastOverPos = null;
    this.oversprayStep = this.computeOversprayStep();

    // --- DRIPS: buffers & params ---
    this.bufScale = 2;
    this.bufW = Math.ceil(canvas.width / this.bufScale);
    this.bufH = Math.ceil(canvas.height / this.bufScale);
    this.paintBuf = new Float32Array(this.bufW * this.bufH);
    this.drips = [];

    // physics (seconds-based)
    this.DRIP_THRESHOLD = 0.59; // pooled paint needed at center cell
    this.DRIP_HYST = 0.24; // local drain after spawn
    this.GRAVITY = 500; // px/s^2
    this.VISCOSITY = 8.9; // s^-1 damping
    this.WET_EVAP = 0.18; // s^-1 evaporation from buffer
    this.W_CAP = 0.9; // per-cell wetness cap (keep only this line)
    this.MAX_DRIPS = 90;

    this._lastT = performance.now();

    // pooling / spacing / shape
    this.NBR_MIN = 0.78; // min 3×3 pooled wetness
    this.MIN_DRIP_SPACING = 22; // px — merges nearby seeds to thicken
    this.DEPOSIT_PER_PX = 1.25; // volume lost per 60–70 px of travel
    this.LATERAL_SPREAD = 0.6; // px/frame lateral meander

    // speed estimation for dwell logic
    this.lastStampAtMs = performance.now();
    this.speedEMA = 0; // px/s EMA

    // dwell speed references
    this.V_REF = 160; // "normal hand" speed
    this.V_SLOW = 70; // below this → dwell spreading

    // spawn cooldown map
    this._spawnCooldown = new Uint16Array(this.paintBuf.length);

    // drip control
    this.dripsEnabled = true;

    // dwell pacing
    this._lastDwellWetAt = 0; // NEW: timestamp for dwell-wet pacing
    this._dwellWetStepMs = 70; // NEW: add dwell wetness ~14 Hz max

    // --- radius safety & merge damping ---
    this.GLOBAL_TRAIL_CAP = 26.0; // absolute visual max for any trail stamp
    this.R_BASE_HARD_MAX = 12.0; // baseR can't exceed this (prevents huge heads)
    this.MERGE_DAMP = 0.35; // 0..1, how much to move toward area-conserving merge

    // --- overspray timing ---
    this._lastDwellOverAt = 0; // ms
    this._oversprayTimeStepMs = 70; // emit overspray ring ~14 Hz when stationary

    // Speed→thickness dynamics
    this.lineDynamicsEnabled = true;
    this.thickSlowScale = 1.3; // max scale when very slow/holding
    this.thinFastScale = 0.7; // min scale when very fast
    this.V_FAST = this.V_REF * 20; // speed at which thinning saturates
    this.speedCurve = 1.3; // >1 = smoother, <1 = snappier

    // ---- add to constructor ----
    this._drawingDrip = false; // internal: true while drawing drips
    this.metallicShimmerSpray = false; // shimmer on spray dots (off = exact match)
    this.metallicShimmerDrip = false; // shimmer on drips   (off = exact match)
    this.dripHighlightGain = 1.0; // 0..1, reduce bright center on drips

    // --- tail & variation controls ---
    this.TAIL_TAPER_MIN = 0.35; // 0..1 how thin the tail tip can get (fraction of baseR)
    this.TAIL_TAPER_MAX = 0.85; // 0..1 upper bound for taper factor
    this.TAIL_CAP_STEPS = 7; // how many stamps to round the tip when a drip ends

    // per-location spawn throttling (ms); avoid multiple instant drips
    this.MIN_SPAWN_INTERVAL_MS = 2000; // ~0.55s
    this._lastSpawnAt = new Uint32Array(this.paintBuf.length); // per-cell timestamp (ms)

    // optional: longer cell cooldown after a spawn (frames, decremented in loop)
    this.SPAWN_COOLDOWN_FRAMES = 140; // ~0.6s @ ~60fps
    // --- small-nozzle anti-double-spawn state ---
    this._lastSpawnGlobalAt = 0;          // ms
    this._recentSpawns = [];              // circular-ish buffer of recent spawns
    this.RECENT_SPAWN_WINDOW_MS = 900;    // keep spawns around for ~0.9s for proximity checks

    // --- extra randomness for drip shapes ---
    this.SHAPE_NOISE_AMP = 0.22; // 0..0.3 — how wobbly the radius gets along the trail
    this.SHAPE_NOISE_FREQ = [0.7, 1.6]; // Hz-ish range for the 1D noise speed
    this.TAIL_HOOK_STRENGTH = 0.6; // 0..1 — curvature of the tail (randomized per drip)
    this.TAIL_BEAD_CHANCE = 0.35; // 0..1 — chance of a tiny bead at the very tip

    this.GOLD_DRIP_ALPHA_GAIN = 0.98; // +?% density for gold drips
    this.GOLD_GLAZE = 0.26; // strength of warm multiply glaze
    this.metallicShimmerDrip = true; // enable subtle metallic shimmer on drips

    // after other fields
    this._dripUID = 0;                 // running ID
    this._cssScaleX = 1;               // updated before drawing
    this._cssScaleY = 1;
    this._cssDensityComp = 1;          // touch density normalization

    this.dpr = window.devicePixelRatio || 1;  // once, e.g., in constructor or resizeCanvas

    // --- drip arming (prevents instant/first-paint drips) ---
    this._dripArmed = false;
    this._paintStartMs = 0;
    this._travelSinceStart = 0;
    this._armAfterMs = 450;      // wait ~0.45s after first touch
    this._armAfterTravel = 26;   // and at least ~26px of path length

    // --- device / input hints for gold handling ---
    this.isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

    // --- gold debug flags/state ---
    this.debugGold = true; // master switch for gold/touch diagnostics
    this._dbgLast = { stamp: 0, grain: 0, over: 0, brush: 0 };
    this._dbgStrokeId = 0;

  }

  setColor(color) {
    this.color = color;
  }

  setNozzleSize(size) {
    this.nozzleSize = Math.max(2, Math.min(120, size));
    this.oversprayStep = this.computeOversprayStep();
  }

  setSoftness(softness) {
    this.softness = Math.max(0.7, Math.min(0.95, softness / 100));
  }

  setOpacity(opacity) {
    this.opacity = Math.max(0.8, Math.min(1.0, opacity / 100));
  }

  setFlow(flow) {
    this.flow = Math.max(0.8, Math.min(1.2, flow / 100));
  }

  setScatterRadius(radius) {
    this.scatterRadiusMultiplier = radius / 100; // Convert percentage to multiplier
  }

  setScatterAmount(amount) {
    this.scatterAmountMultiplier = amount / 100; // Convert percentage to multiplier
  }

  setScatterSize(size) {
    this.scatterSizeMultiplier = size / 100; // Convert percentage to multiplier
  }

  setOverspray(overspray) {
    // clamp 0..100 → 0..1
    const v = Math.max(0, Math.min(100, overspray));
    this.oversprayMultiplier = v / 100;

    // recompute emission spacing based on current nozzle + overspray
    this.oversprayStep = this.computeOversprayStep();

    // reset emitter so the new spacing takes effect immediately
    this.lastOverPos = null;
  }

  setDistance(zPx) {
    this.distance = Math.max(2, zPx | 0);
  }

  // NEW: choose a compositor for drips based on color
  getDripCompositeMode() {
    // Metallics (like gold) should not be multiplied — it darkens them.
    // Use normal blending for identical tone. Keep multiply for non-metal.
    return this.isGoldColor(this.color) ? "source-over" : "multiply";
  }

  // Draw one drip stamp. Gold gets extra metallic passes.
  // Keeps spray brushes untouched (no effect on dot density).
  // --- Replace the whole helper with this version ---
  // Matches the spray's metallic recipe: warm multiply + two screened lobes.
  // Only runs for gold; keeps stamp density unchanged.
  _stampDrip(R, x, y, alpha) {
    const ctx = this.ctx;

    // 0) Base body (identical tone as paint)
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.getBrush(R), x - R, y - R);

    if (!this.isGoldColor(this.color)) return;

    // Tunables (tight link to spray look)
    const GLZ = 0.09; // warm glaze strength (0.08–0.14)
    const SH1 = 0.18; // primary highlight (0.04–0.08)
    const SH2 = 0.05; // secondary reflection (0.02–0.05)
    const OFF1 = 0.34; // primary highlight offset (fraction of R)
    const OFF2 = 0.7; // secondary highlight offset
    const SHR = 0.86; // highlight radius scale
    const SHR2 = 0.55; // second lobe radius scale

    // 1) Warm mid-tone multiply glaze (deepens like the spray core)
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = GLZ;
    ctx.drawImage(this.getBrush(R), x - R, y - R);
    ctx.restore();

    // Light comes from up-left (same as brush layout in createMetallicBrush)
    const offX1 = R * OFF1,
      offY1 = R * OFF1; // up-left
    const offX2 = R * OFF2,
      offY2 = R * 0.1; // slight lateral second lobe

    // 2) Primary specular lobe (screen)
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = SH1;
    const R1 = Math.max(0.7, R * SHR);
    ctx.drawImage(this.getBrush(R1), x - R1 - offX1, y - R1 - offY1);
    ctx.restore();

    // 3) Secondary reflection (screen, smaller & fainter)
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = SH2;
    const R2 = Math.max(0.5, R * SHR2);
    ctx.drawImage(this.getBrush(R2), x - R2 + offX2, y - R2 - offY2);
    ctx.restore();

    // 3b) Metallic sheen to lift center tone
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.08;
    const sheen = ctx.createRadialGradient(
      x - R * 0.12,
      y - R * 0.18,
      0,
      x,
      y,
      R * 1.05
    );
    sheen.addColorStop(0.0, "rgba(255,240,210,0.75)");
    sheen.addColorStop(0.45, "rgba(255,228,170,0.28)");
    sheen.addColorStop(1.0, "rgba(255,228,170,0.0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.restore();

    // 4) Tiny micro-sparkle (rare + very faint; avoids glitter)
    if (Math.random() < 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const Rs = Math.max(0.45, R * (0.42 + Math.random() * 0.2));
      const jx = (Math.random() - 0.3) * R * 0.22;
      const jy = (Math.random() - 0.6) * R * 0.22;
      ctx.globalAlpha = 0.02;
      ctx.drawImage(this.getBrush(Rs), x + jx - Rs, y + jy - Rs);
      ctx.restore();
    }
  }

  // Convenience wrapper so the drip code is clean
  _stampDripAt(R, xx, yy, alpha) {
    this._stampDrip(R, xx, yy, alpha);
  }

  // Lightweight, cached specular brush for gold (pure highlight, no color shift)
  getGoldSpecBrush(radius) {
    const R = Math.max(1, Math.round(radius * 2) / 2);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const key = `gold-spec-${R}-${dpr}`;
    if (this.stampCache.has(key)) return this.stampCache.get(key);

    const px = Math.ceil(R * 2 * dpr);
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(2, px);

    const g = c.getContext("2d", { alpha: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";

    const rr = R * dpr;
    // bright center → quick falloff, neutral white/yellow for screen blending
    const spec = g.createRadialGradient(rr, rr, 0, rr, rr, rr);
    spec.addColorStop(0.0, "rgba(255,255,255,1.0)");
    spec.addColorStop(0.3, "rgba(255,244,200,0.8)");
    spec.addColorStop(0.75, "rgba(255,215,0,0.20)");
    spec.addColorStop(1.0, "rgba(255,215,0,0.00)");
    g.fillStyle = spec;
    g.fillRect(0, 0, c.width, c.height);

    this.stampCache.set(key, c);
    return c;
  }

  // Drip control methods
  setDripThreshold(threshold) {
    this.DRIP_THRESHOLD = Math.max(0.1, Math.min(0.8, threshold / 100));
  }

  setDripGravity(gravity) {
    this.GRAVITY = Math.max(500, Math.min(5000, gravity));
  }

  setDripViscosity(viscosity) {
    this.VISCOSITY = Math.max(0.5, Math.min(15, viscosity));
  }

  setDripEvaporation(evaporation) {
    this.WET_EVAP = Math.max(0.05, Math.min(1.0, evaporation / 100));
  }

  setLineDynamicsEnabled(on) {
    this.lineDynamicsEnabled = !!on;
  }

  setLineDynamicsRange(minScale, maxScale) {
    this.thinFastScale = Math.max(0.4, Math.min(1.0, minScale));
    this.thickSlowScale = Math.max(1.0, Math.min(2.0, maxScale));
  }

  setLineDynamicsCurve(curve = 1.25) {
    this.speedCurve = Math.max(0.5, Math.min(3, curve));
  }

  setLineDynamicsFastSpeed(vfast) {
    this.V_FAST = Math.max(this.V_REF * 1.2, vfast);
  }

  toggleDrips() {
    // Toggle drip simulation by enabling/disabling drip spawning
    this.dripsEnabled = !this.dripsEnabled;
    return this.dripsEnabled;
  }

  _getThicknessScale(speed) {
    if (!this.lineDynamicsEnabled) return 1.0;

    // normalize speed between V_SLOW and V_FAST
    const nRaw = (speed - this.V_SLOW) / Math.max(1, this.V_FAST - this.V_SLOW);
    const n = Math.max(0, Math.min(1, nRaw));
    // ease-in curve for smoother response
    const eased = Math.pow(n, this.speedCurve);

    // lerp: slow→thick, fast→thin
    const minS = this.thinFastScale; // at n=1 (fast)
    const maxS = this.thickSlowScale; // at n=0 (slow)
    return maxS + (minS - maxS) * eased;
  }

  // --- HD brush with devicePixelRatio & smoothing ---
  getBrush(radius) {
    const R = this._safeR(radius);
    const r = Math.max(1, Math.round(R * 4) / 4);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const variant = this._drawingDrip ? "drip" : "spray"; // NEW
    const key = `hd-${r}-${dpr}-${this.color}-${this.softness}-${variant}`;

    if (this.stampCache.has(key)) return this.stampCache.get(key);

    const px = Math.ceil(r * 2 * dpr);
    const c = document.createElement("canvas");
    c.width = c.height = Math.max(2, px);

    const g = c.getContext("2d", { alpha: true });
    if (!g) return c;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";

    const rr = r * dpr;

    if (this.isGoldColor(this.color)) {
      // pass variant so drips use toned-down highlight
      this.createMetallicBrush(g, rr, r, dpr, variant);
    } else {
      const grad = g.createRadialGradient(rr, rr, 0, rr, rr, rr);
      grad.addColorStop(0, this.color);
      grad.addColorStop(this.softness, this.color);
      grad.addColorStop(1, this.color + "00");
      g.fillStyle = grad;
      g.fillRect(0, 0, c.width, c.height);
    }

    this.stampCache.set(key, c);
    return c;
  }

  // Check if the color is gold (close to #EAC677)
  isGoldColor(color) {
    const goldHex = "#eac677";
    const normalizedColor = color.toLowerCase();
    return normalizedColor === goldHex || normalizedColor === "#eac677";
  }

  // Create metallic brush effect for gold color
  // helper
  _hexToRgba(hex, a = 1) {
    const c = hex.replace("#", "");
    const r = parseInt(c.slice(0, 2), 16),
      g = parseInt(c.slice(2, 4), 16),
      b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // variant: "spray" | "drip"
  createMetallicBrush(ctx, radius, baseRadius, dpr, variant = "spray") {
    const cx = radius, cy = radius;
    const _nowDbg = performance.now();

    // Helper
    const rgba = (hex, a = 1) => {
      const c = hex.replace("#", "");
      const r = parseInt(c.slice(0, 2), 16),
            g = parseInt(c.slice(2, 4), 16),
            b = parseInt(c.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    };

    // ---- GOLD DRIP (tone-matched to spray, but denser & less "pale") ----
    if (this.isGoldColor(this.color) && variant === "drip") {
      const gold = "#EAC677";

      // Body: higher core density + slightly faster edge falloff
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0.00, rgba(gold, 0.92));
      g.addColorStop(Math.min(0.58, this.softness * 0.7), rgba(gold, 0.86));
      g.addColorStop(1.00, rgba(gold, 0.12));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Warm multiply glaze to match sprayed midtone depth
      ctx.globalCompositeOperation = "multiply";
      const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      warm.addColorStop(0.0, rgba("#D6A84E", this.GOLD_GLAZE * 0.65));
      warm.addColorStop(1.0, rgba("#D6A84E", 0.0));
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Subtle spec band (reduced so drips don’t look “light gold”)
      ctx.globalCompositeOperation = "screen";
      const band = ctx.createRadialGradient(cx * 0.78, cy * 0.72, 0, cx, cy, radius * 0.6);
      band.addColorStop(0.0, rgba("#FFF8DC", 0.08));
      band.addColorStop(0.45, rgba("#FFD700", 0.05));
      band.addColorStop(1.0, rgba("#FFD700", 0.0));
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      ctx.globalCompositeOperation = "source-over";
      if (this.debugGold && _nowDbg - (this._dbgLast.brush || 0) > 800) {
        console.log(`[GOLD-BRUSH] variant=drip dpr=${dpr} isTouch=${this.isTouch}`);
        this._dbgLast.brush = _nowDbg;
      }
      return;
    }

    // ---- GOLD SPRAY (slightly safer on touch to avoid "end burst") ----
    if (this.isGoldColor(this.color)) {
      const touchAtten = this.isTouch ? 0.75 : 1.0; // reduce highlight strength on touch

      // Base body
      const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g0.addColorStop(0.00, rgba("#FFD700", 0.80));
      g0.addColorStop(0.30, "#EAC677");
      g0.addColorStop(0.70, "#D4AF37");
      g0.addColorStop(1.00, rgba("#B8860B", 1.0));
      ctx.fillStyle = g0;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Highlight (attenuated on touch to prevent burst)
      const g1 = ctx.createRadialGradient(cx * 0.72, cy * 0.72, 0, cx, cy, radius * 0.62);
      g1.addColorStop(0.0, rgba("#FFF8DC", 0.42 * touchAtten));
      g1.addColorStop(0.4, rgba("#FFD700", 0.34 * touchAtten));
      g1.addColorStop(1.0, rgba("#FFD700", 0.0));
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Secondary reflection (also attenuated on touch)
      const g2 = ctx.createRadialGradient(cx * 1.18, cy * 0.82, 0, cx, cy, radius * 0.42);
      g2.addColorStop(0.0, rgba("#FFFFFF", 0.16 * touchAtten));
      g2.addColorStop(0.3, rgba("#FFD700", 0.12 * touchAtten));
      g2.addColorStop(1.0, rgba("#FFD700", 0.0));
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      // Remove micro-sparkles on touch devices (they can spike when stamps stack)
      if (!this.isTouch) {
        // extremely subtle sprinkle (kept off on touch)
        if (Math.random() < 0.25) {
          const spark = ctx.createRadialGradient(cx * 1.04, cy * 0.92, 0, cx, cy, radius * 0.34);
          spark.addColorStop(0.0, rgba("#FFFFFF", 0.02));
          spark.addColorStop(1.0, rgba("#FFFFFF", 0.0));
          ctx.fillStyle = spark;
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        }
      }

      ctx.globalCompositeOperation = "source-over";
      if (this.debugGold && _nowDbg - (this._dbgLast.brush || 0) > 800) {
        console.log(
          `[GOLD-BRUSH] variant=spray dpr=${dpr} isTouch=${this.isTouch} touchAtten=${touchAtten}`
        );
        this._dbgLast.brush = _nowDbg;
      }
      return;
    }

    // ---- Non-gold fallback (unchanged from your previous behavior) ----
    const gStd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gStd.addColorStop(0.0, this._hexToRgba("#FFD700", 0.85));
    gStd.addColorStop(0.3, "#EAC677");
    gStd.addColorStop(0.7, "#D4AF37");
    gStd.addColorStop(1.0, this._hexToRgba("#B8860B", 1.0));
    ctx.fillStyle = gStd;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const gHi = ctx.createRadialGradient(cx * 0.72, cy * 0.72, 0, cx, cy, radius * 0.62);
    gHi.addColorStop(0.0, this._hexToRgba("#FFF8DC", 0.55));
    gHi.addColorStop(0.4, this._hexToRgba("#FFD700", 0.45));
    gHi.addColorStop(1.0, this._hexToRgba("#FFD700", 0.0));
    ctx.fillStyle = gHi;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    this.addMetallicNoise(ctx, cx, cy, radius);
  }
  // Add metallic noise texture
  addMetallicNoise(ctx, centerX, centerY, radius) {
    const imageData = ctx.getImageData(
      0,
      0,
      ctx.canvas.width,
      ctx.canvas.height
    );
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % ctx.canvas.width;
      const y = Math.floor(i / 4 / ctx.canvas.width);
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

      if (distance <= radius) {
        // Add subtle metallic noise
        const noise = (Math.random() - 0.5) * 20; // ±10 brightness variation
        data[i] = Math.max(0, Math.min(255, data[i] + noise)); // Red
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise)); // Green
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise)); // Blue
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  deriveSprayParams() {
    const Dn = this.nozzleSize;
    const z = this.distance;
    const p = this.pressure;

    // add mild pressure widening (kd ≈ 0.06–0.10)
    const theta =
      this.theta0 +
      this.kTheta * Math.log(1 + Dn / this.Dref) +
      0.08 * Math.log(1 + p); // new

    const Rz = z * Math.tan(theta);
    const sigma = Math.max(0.6, (z / 15) * (Dn / this.Dref) * 1.5);
    const densityFactor = this._goldTouchDensityFactor();
    const touchAlphaFactor =
      this.isTouch && this.isGoldColor(this.color) ? 0.5 : 1;
    let alphaScale = (this.opacity * p) / (0.02 * z * z + 1);
    if (densityFactor < 1) {
      alphaScale *= densityFactor * touchAlphaFactor;
    }
    let scatterRadius = Rz * this.scatterRadiusMultiplier;
    if (densityFactor < 1) {
      scatterRadius *= Math.max(0.7, densityFactor * 1.15);
    }
    return { theta, Rz, sigma, alphaScale, scatterRadius };
  }

  // --- Helper functions for sophisticated grain control ---
  randn() {
    // Box–Muller transform for normal distribution
    let u = 1 - Math.random(),
      v = 1 - Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  computeOversprayStep() {
    // smaller step → more emissions
    const z = this.distance; // px
    const nozzle = this.nozzleSize; // px
    const o = this.oversprayMultiplier; // 0..1

    // farther distance: increase step a bit (halo already bigger)
    const zScale = 1 + 0.015 * Math.max(0, z - 10); // +1.5% per px beyond ~10

    // bigger nozzle: decrease step (more paint)
    const nozzleScale = 0.9 * Math.max(10, nozzle); // base around nozzle size

    // more overspray knob: decrease step strongly
    const knobScale = 1.2 - 0.7 * o; // 1.2 → 0.5

    return Math.max(12, nozzleScale * knobScale * zScale);
  }

  clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  _goldTouchDensityFactor() {
    if (!this.isGoldColor(this.color)) return 1;
    if (!this.isTouch) return 1;
    const areaScale =
      this._cssDensityComp ||
      ((this._cssScaleX || 1) * (this._cssScaleY || 1));
    const clampedArea = Math.max(0.05, Math.min(1, areaScale || 1));
    return Math.max(0.3, Math.sqrt(clampedArea));
  }

  _goldTouchCountScale() {
    const d = this._goldTouchDensityFactor();
    if (d >= 1) return 1;
    return Math.max(0.45, Math.min(1, d * 1.05));
  }

  calculateGrainSize(baseRadius, _size, params) {
    const pressure = this.pressure || 0.7;

    // log-normal
    const mu = 0.0,
      sigmaGrain = 0.35;
    let sizeFactor = Math.exp(mu + sigmaGrain * this.randn());

    if (Math.random() < 0.02) sizeFactor *= 1.8 + Math.random() * 1.2;

    // use params for distance (don't read this.distance again)
    sizeFactor *=
      (Math.max(2, this.distance) / 15) * (1 / Math.sqrt(pressure + 0.2));

    sizeFactor = this.clamp(sizeFactor, 0.35, 2.2);
    return Math.max(0.5, baseRadius * sizeFactor);
  }

  calculateGrainOpacity(baseOpacity, sizeFactor, params) {
    // Use pre-computed derived spray parameters for distance-based intensity falloff
    const { alphaScale } = params;

    // --- opacity: slight positive correlation with size, but with plateau ---
    const sizeOpacityBoost = this.clamp(
      0.6 + 0.5 * Math.sqrt(sizeFactor),
      0.5,
      1.25
    );
    // per-dot jitter so it's not flat
    const jitter = 0.85 + Math.random() * 0.25; // 0.85–1.10
    let dotOpacity = baseOpacity * sizeOpacityBoost * jitter * alphaScale;

    // safety clamp
    return this.clamp(dotOpacity, 0.05, 1.0);
  }

  startDrawing(x, y, pressure = 1.0) {
    this.isDrawing = true;
    this.lastX = x;
    this.lastY = y;
    this.currentX = x;
    this.currentY = y;
    this.pressure = pressure;
    this.lastOverPos = null;
  
    // arm-state for first-paint drip lockout
    this._dripArmed = false;
    this._paintStartMs = performance.now();
    this._travelSinceStart = 0;

    if (this.debugGold) {
      this._dbgStrokeId += 1;
      console.log(
        `[STROKE#${this._dbgStrokeId}] input=${this.isTouch ? 'touch' : 'mouse'} dpr=${this.dpr} ` +
        `nozzle=${this.nozzleSize} flow=${this.flow} opacity=${this.opacity} softness=${this.softness}`
      );
    }

    // Start continuous spraying
    if (!this._sprayInterval) {
      this._sprayInterval = setInterval(() => {
        if (this.isDrawing) {
          this.stamp(this.currentX, this.currentY);
        }
      }, 16); // ~60fps
    }
  }

  draw(x, y, pressure = 1.0) {
    if (!this.isDrawing) return;

    this.currentX = x;
    this.currentY = y;

    // Smooth pressure changes
    this.pressure += (pressure - this.pressure) * this.pressureSmoothing;

    // Calculate distance for stamping
    const distance = Math.sqrt((x - this.lastX) ** 2 + (y - this.lastY) ** 2);

    // Use continuous line drawing for smooth coverage
    this.drawContinuousLine(this.lastX, this.lastY, x, y);

    // Periodic cache cleanup
    if (Math.random() < 0.01) {
      // 1% chance per draw call
      this.cleanupCache();
    }

    this.lastX = x;
    this.lastY = y;
  }

  drawContinuousLine(startX, startY, endX, endY) {
    const distance = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
    const effectiveSize = this.nozzleSize * (0.8 + this.pressure * 0.4);
    const effectiveOpacity = this.opacity * (0.9 + this.pressure * 0.1);

    // Calculate number of stamps needed for continuous coverage - much denser
    const stampDistance = Math.max(0.2, effectiveSize * 0.05);
    const numStamps = Math.max(1, Math.floor(distance / stampDistance));

    // Create continuous line with overlapping stamps
    for (let i = 0; i <= numStamps; i++) {
      const t = i / numStamps;
      const stampX = startX + (endX - startX) * t;
      const stampY = startY + (endY - startY) * t;

      // Add some randomness for natural spray effect
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;

      this.stamp(stampX + jitterX, stampY + jitterY);
    }

    // Smart gap filling for fast movement
    // this.fillGapsForFastMovement(
    //   startX,
    //   startY,
    //   endX,
    //   endY,
    //   distance,
    //   effectiveSize
    // );
  }

  fillGapsForFastMovement(startX, startY, endX, endY, distance, effectiveSize) {
    // Calculate optimal stamp density based on movement speed
    const speedRatio = distance / effectiveSize;

    if (speedRatio > 1.5) {
      // Fast movement - use intelligent gap filling
      const gapSize = effectiveSize * 0.2;
      const numGaps = Math.floor(distance / gapSize);

      // Fill gaps with systematic stamps
      for (let i = 0; i < numGaps; i++) {
        const t = (i + 0.5) / numGaps;
        const stampX = startX + (endX - startX) * t;
        const stampY = startY + (endY - startY) * t;

        // Add slight randomness for natural effect
        const jitterX = (Math.random() - 0.5) * 2;
        const jitterY = (Math.random() - 0.5) * 2;

        this.stamp(stampX + jitterX, stampY + jitterY);
      }
    }

    if (speedRatio > 3.0) {
      // Very fast movement - add extra coverage
      const extraDensity = Math.floor(speedRatio);

      for (let i = 0; i < extraDensity; i++) {
        const t = Math.random();
        const stampX = startX + (endX - startX) * t;
        const stampY = startY + (endY - startY) * t;

        const jitterX = (Math.random() - 0.5) * 3;
        const jitterY = (Math.random() - 0.5) * 3;

        this.stamp(stampX + jitterX, stampY + jitterY);
      }
    }

    if (speedRatio > 5.0) {
      // Extremely fast movement - maximum coverage
      const maxStamps = Math.floor(distance / (effectiveSize * 0.1));

      for (let i = 0; i < maxStamps; i++) {
        const t = Math.random();
        const stampX = startX + (endX - startX) * t;
        const stampY = startY + (endY - startY) * t;

        const jitterX = (Math.random() - 0.5) * 4;
        const jitterY = (Math.random() - 0.5) * 4;

        this.stamp(stampX + jitterX, stampY + jitterY);
      }
    }
  }

  stamp(x, y) {
    const now = performance.now();
    const dx = x - (this.lastX ?? x);
    const dy = y - (this.lastY ?? y);
  
    // accumulate travel since stroke start (for drip arming)
    this._travelSinceStart += Math.hypot(dx, dy);
  
    // arm drips only after both time + travel thresholds
    if (!this._dripArmed) {
      if ((now - this._paintStartMs) >= this._armAfterMs &&
          this._travelSinceStart >= this._armAfterTravel) {
        this._dripArmed = true;
      }
    }
  
    const speed = this._updateSpeed(now, dx, dy);
  
    const cw = this.canvas.clientWidth  || this.canvas.width;
    const ch = this.canvas.clientHeight || this.canvas.height;
    this._cssScaleX = cw / this.canvas.width;
    this._cssScaleY = ch / this.canvas.height;
    if (this.isTouch) {
      const scaleX = Math.max(0.1, this._cssScaleX || 1);
      const scaleY = Math.max(0.1, this._cssScaleY || 1);
      this._cssDensityComp = Math.min(1, scaleX * scaleY);
    } else {
      this._cssDensityComp = 1;
    }
  
    if (now - this.lastStampTime < this.stampInterval) return;
    this.lastStampTime = now;
  
    let size = this.nozzleSize * (0.8 + this.pressure * 0.4);
    // touch size handled via density factors elsewhere

    // --- stationary dwell behavior ---
    const stationary = speed < this.V_SLOW * 0.3; // very slow/held in place
    if (this.debugGold && this.isGoldColor(this.color)) {
      const nowLog = now;
      if (nowLog - (this._dbgLast.stamp || 0) > 300) { // ~3 logs/sec
        const { alphaScale } = this.deriveSprayParams();
        console.log(
          `[GOLD-STAMP] t=${nowLog.toFixed(1)}ms speed=${speed.toFixed(1)} ` +
          `stationary=${stationary} size=${(this.nozzleSize * (0.8 + this.pressure * 0.4)).toFixed(2)} ` +
          `pressure=${this.pressure.toFixed(2)} alphaScale=${alphaScale.toFixed(3)} ` +
          `oversprayStep=${this.oversprayStep.toFixed(1)} cssScale=(${this._cssScaleX.toFixed(2)},${this._cssScaleY.toFixed(2)}) ` +
          `isTouch=${this.isTouch}`
        );
        this._dbgLast.stamp = nowLog;
      }
    }
    if (stationary) {
      // Time-based overspray emission
      if (now - (this._lastDwellOverAt || 0) >= this._oversprayTimeStepMs) {
        this.addOverspray(x, y, size);
        this._lastDwellOverAt = now;
      }
  
      // paced pooling (reduced for small/mid nozzles)
      const nowMs = now;
      if (nowMs - (this._lastDwellWetAt || 0) >= this._dwellWetStepMs) {
        let dwellWet = 0.045 * this.flow * (0.85 + 0.5 * this.pressure);
        if (this.nozzleSize <= 12) dwellWet *= 0.6;      // ↓ pooling tiny tips
        else if (this.nozzleSize < 20) dwellWet *= 0.8;  // mildly lower mid tips
        if (this.isTouch && this.isGoldColor(this.color)) {
          dwellWet *= Math.max(0.2, this._goldTouchDensityFactor() * 0.6);
        }
        this._accumWet(x, y, dwellWet, this.V_SLOW, /*centerBias=*/ true);
        this._lastDwellWetAt = nowMs;
      }
  
      // try spawn at center
      this._trySpawnDripAt(x, y, 0);
    } else {
      this._lastDwellOverAt = 0; // reset dwell overspray timer
    }
  
    // draw grain (speed-aware)
    this.createNoisyPath(x, y, size, speed);
  
    // distance-paced overspray
    const dOver = !this.lastOverPos
      ? Infinity
      : Math.hypot(x - this.lastOverPos.x, y - this.lastOverPos.y);
  
    const shouldEmitByDistance = !this.lastOverPos || dOver >= this.oversprayStep;
    if (shouldEmitByDistance) {
      if (this.lastOverPos && dOver < this.oversprayStep * 1.2) {
        this.addOverspray(x, y, size);
      }
      this.lastOverPos = { x, y };
    }
  }

  // --- Blue-noise-ish scatter with HiDPI brush + small-nozzle smoothing ---
  // --- Blue-noise scatter with HiDPI brush; small nozzles use denser/smaller dots ---
createNoisyPath(x, y, size, speed = this.V_REF) {
  const params = this.deriveSprayParams();
  let { scatterRadius } = params;
  const densityFactor = this._goldTouchDensityFactor();
  const countScale = this._goldTouchCountScale();
  const usingGoldTouch = this.isGoldColor(this.color) && this.isTouch;

  const thicknessK =
    typeof this._getThicknessScale === "function"
      ? this._getThicknessScale(speed)
      : 1.0;

  const dwell = Math.min(1, speed / this.V_REF); // 0..1
  const spread = 1 + 0.35 * (1 - dwell);

  const smallNozzle = this.nozzleSize < 20;

  // pull the cloud slightly inward when small so it fills without a blob
  if (smallNozzle) scatterRadius *= 0.86;

  const displayRadius =
    Math.max(scatterRadius, size * 0.55) * spread * thicknessK;

  // base density
  const areaFactor =
    (this.nozzleSize * this.nozzleSize) / (this.Dref * this.Dref);
  const baseDots = 6.0 * areaFactor * this.flow;
  const densityComp = 1 / Math.max(0.6, Math.min(1.6, thicknessK));
  const MAX_DOTS = 1400;

  let nDots = Math.min(
    MAX_DOTS,
    Math.floor(displayRadius * baseDots * this.scatterAmountMultiplier * densityComp)
  );

  // small-nozzle tuning: ensure enough dots to look filled (but with smaller grains)
  const rawMinDots = smallNozzle ? 70 + Math.floor(displayRadius * 1.2) : 0;
  if (rawMinDots) {
    nDots = Math.max(rawMinDots, nDots);
  }

  if (usingGoldTouch && countScale < 1) {
    const scaledMin = rawMinDots
      ? Math.max(18, Math.floor(rawMinDots * countScale))
      : 0;
    nDots = Math.max(
      scaledMin,
      Math.max(1, Math.floor(nDots * countScale))
    );
  }
  if (nDots <= 0) return;

  if (this.debugGold && this.isGoldColor(this.color)) {
    const nowLog = performance.now();
    if (nowLog - (this._dbgLast.grain || 0) > 350) {
      console.log(
        `[GOLD-GRAIN] speed=${speed.toFixed(1)} thicknessK=${thicknessK.toFixed(2)} ` +
        `displayR=${displayRadius.toFixed(2)} nDots=${nDots} smallNozzle=${this.nozzleSize < 20} isTouch=${this.isTouch}` +
        (usingGoldTouch
          ? ` cssArea=${(this._cssDensityComp || 1).toFixed(2)} density=${densityFactor.toFixed(2)} countScale=${countScale.toFixed(2)}`
          : "")
      );
      this._dbgLast.grain = nowLog;
    }
  }

  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  const baseOpacity = this.opacity;
  const dotBaseR = Math.max(0.45, size * 0.005 * this.scatterSizeMultiplier);

  // HiDPI smoothing
  this.ctx.imageSmoothingEnabled = true;
  this.ctx.imageSmoothingQuality = "high";
  this.ctx.save();
  this.ctx.fillStyle = this.color;

  const toneComp = Math.sqrt(1 / Math.max(0.6, Math.min(1.6, thicknessK)));

  const jitterR = smallNozzle ? 0.05 : 0.12;
  const jitterT = smallNozzle ? 0.16 : 0.35;

  for (let i = 0; i < nDots; i++) {
    // blue-noise-ish spiral with stratification
    const u = (i + 0.5) / nDots; // 0..1
    const r0 = Math.sqrt(u) * displayRadius; // uniform disk
    const t0 = i * phi;

    // tempered jitter (slightly more near center)
    const jr =
      (Math.random() * 2 - 1) *
      jitterR *
      (0.6 + 0.4 * (1 - u)) *
      displayRadius;
    const jt = (Math.random() * 2 - 1) * jitterT * (0.35 + 0.65 * (1 - u));

    const r = Math.max(0, r0 + jr);
    const t = t0 + jt;

    const dotX = x + Math.cos(t) * r;
    const dotY = y + Math.sin(t) * r;

    // smaller grains when small nozzle
    const minGrain = smallNozzle ? 0.45 : 0.6;
    let rndSize = Math.max(minGrain, this.calculateGrainSize(dotBaseR, size, params));
    if (smallNozzle) rndSize *= 0.9;

    // opacity with gentle center bias
    let dotOpacity = this.calculateGrainOpacity(baseOpacity, rndSize / dotBaseR, params);
    const centerBias =
      1 - Math.pow(Math.min(1, r / Math.max(1e-3, displayRadius)), 1.35);
    const smallBoost = smallNozzle ? 0.96 + 0.18 * centerBias : 1.0;
    dotOpacity *= (0.65 + 0.35 * dwell) * toneComp * smallBoost;
    if (usingGoldTouch && densityFactor < 1) {
      dotOpacity *= Math.max(0.22, densityFactor * 0.7);
    }
    if (this.isGoldColor(this.color)) {
      const dwellBoostFactor = this.isTouch ? 1.55 : 1.25;
      const slowNorm = Math.min(1, speed / (this.V_SLOW * 0.55));
      const dwellBoost = 1 + (1 - slowNorm) * dwellBoostFactor;
      dotOpacity *= dwellBoost;
    }
    dotOpacity = Math.min(1.0, dotOpacity);

    // draw
    const b = this.getBrush(rndSize);
    this.ctx.globalAlpha = dotOpacity;
    this.ctx.drawImage(b, dotX - rndSize, dotY - rndSize);

    // micro dither pair every ~6th dot for tiny tips
    if (smallNozzle && i % 6 === 0) {
      const off = rndSize * 0.35;
      const t2 = t + (Math.random() - 0.5) * 0.6;
      const d2x = dotX + Math.cos(t2) * off;
      const d2y = dotY + Math.sin(t2) * off;
      const r2 = Math.max(minGrain, rndSize * (0.8 + Math.random() * 0.3));
      this.ctx.globalAlpha = dotOpacity * 0.9;
      this.ctx.drawImage(this.getBrush(r2), d2x - r2, d2y - r2);
    }

    // --- UPDATED wetness accumulation for small nozzles ---
    // smaller G and sparser accumulation when small
    const normNozzleArea = Math.max(64, this.nozzleSize * this.nozzleSize);
    const G = smallNozzle ? 70 : 100; // was 115 for small; now much lower
    const shouldAccum = smallNozzle ? (i % 6 === 0) : ((i & 3) === 0);
    if (shouldAccum) {
      let wet =
        ((G * dotOpacity * (rndSize * rndSize)) / normNozzleArea) *
        (0.8 + 0.6 * this.pressure) *
        this.flow;
      if (usingGoldTouch && densityFactor < 1) {
        wet *= Math.max(0.2, densityFactor * 0.65);
      }
      this._accumWet(dotX, dotY, wet, speed);
      this._trySpawnDripAt(dotX, dotY, speed);
    }
  }

  this.ctx.restore();

}
  // --- helper: draw a tiny "blobby" dot made of 1–4 overlapping sub-dots ---
  _drawDotCluster(cx, cy, baseR, tangentAngle = 0) {
    // choose 1–4 sub-dots; mostly 1–2 so shapes look like dots with slight lumps
    const sub =
      Math.random() < 0.65
        ? 1
        : Math.random() < 0.85
        ? 2
        : Math.random() < 0.95
        ? 3
        : 4;
    const brush = this.getBrush(this._safeR(baseR));
    // small cluster radius where sub-dots can sit (kept sub-pixel to avoid “flower” look)
    const clusterRad = baseR * (0.15 + Math.random() * 0.15); // 0.15–0.30 R

    // slight orientation bias along the ring tangent (keeps clusters subtle, not streaks)
    const bias = tangentAngle + (Math.random() - 0.5) * (Math.PI / 10);

    for (let i = 0; i < sub; i++) {
      const r = clusterRad * Math.sqrt(Math.random());
      const a = bias + (Math.random() - 0.5) * (Math.PI / 3);
      const ox = cx + Math.cos(a) * r;
      const oy = cy + Math.sin(a) * r;

      // each sub-dot varies 80–120% of base
      const Ri = this._safeR(baseR * (0.8 + Math.random() * 0.4));
      const bi = Ri === baseR ? brush : this.getBrush(Ri);
      this.ctx.drawImage(bi, ox - Ri, oy - Ri, Ri * 2, Ri * 2);
    }
  }

  _pruneRecentSpawns(now) {
    const keepAfter = now - this.RECENT_SPAWN_WINDOW_MS;
    // prune in-place
    let w = 0;
    for (let i = 0; i < this._recentSpawns.length; i++) {
      if (this._recentSpawns[i].t >= keepAfter) {
        this._recentSpawns[w++] = this._recentSpawns[i];
      }
    }
    this._recentSpawns.length = w;
  }

  // --- Natural, dot-only overspray with size/opacity falloff and subtle blob variants ---
  addOverspray(x, y, size) {
    if (this.oversprayMultiplier <= 0) return;

    // precompute physical params
    const { Rz, alphaScale } = this.deriveSprayParams();
    const densityFactor = this._goldTouchDensityFactor();
    const countScale = this._goldTouchCountScale();
    const usingGoldTouch = this.isGoldColor(this.color) && this.isTouch;

    // halo radius (how far overspray extends). Grows with nozzle & distance, gently clamped.
    let haloR = Math.min(Math.max(size * 1.05, 2.0 * Rz), size * 2.1);
    if (usingGoldTouch && densityFactor < 1) {
      haloR *= Math.max(0.85, densityFactor * 1.15);
    }

    // motion orientation (for gentle tangent bias of clusters)
    const vx = this.currentX - this.lastX;
    const vy = this.currentY - this.lastY;
    const motionAngle = Math.atan2(vy || 0.0001, vx || 0.0001);
    const cos = Math.cos(motionAngle),
      sin = Math.sin(motionAngle);

    // ellipse axes (⊥ a, ‖ b) — oval cloud like in real spray
    const a = haloR * (1.08 + 0.08 * this.oversprayMultiplier);
    const b = haloR * (0.82 + 0.05 * this.oversprayMultiplier);

    // perimeter → particle count; modulated by flow/pressure
    const h = (a - b) ** 2 / (a + b) ** 2;
    const P = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    const spacing = 16; // denser than before for a richer grain
    const baseCount = P / spacing;
    const nozzleFactor = Math.sqrt(Math.max(0.5, this.nozzleSize / this.Dref));
    const press = 0.75 + 0.55 * this.pressure;
    const knob = 0.55 + 0.85 * this.oversprayMultiplier;

    // total particles; later we bias where they land (more near center)
    let count = Math.floor(
      baseCount * nozzleFactor * knob * press * (0.6 + 0.8 * alphaScale)
    );
    if (usingGoldTouch && countScale < 1) {
      count = Math.max(1, Math.floor(count * countScale));
    }
    const minCount =
      usingGoldTouch && countScale < 1
        ? Math.max(6, Math.floor(18 * countScale))
        : 18;
    count = Math.max(minCount, Math.min(240, count));

    if (this.debugGold && this.isGoldColor(this.color)) {
      const nowLog = performance.now();
      if (nowLog - (this._dbgLast.over || 0) > 500) {
        console.log(
          `[GOLD-OVER] haloR=${haloR.toFixed(2)} count=${count} ` +
          `alphaScale=${alphaScale.toFixed(3)} isTouch=${this.isTouch}` +
          (usingGoldTouch
            ? ` cssArea=${(this._cssDensityComp || 1).toFixed(2)} density=${densityFactor.toFixed(2)} countScale=${countScale.toFixed(2)}`
            : "")
        );
        this._dbgLast.over = nowLog;
      }
    }

    // HiDPI-friendly smoothing
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    const prevAlpha = this.ctx.globalAlpha;

    // golden-angle progression gives blue-noise-ish spacing
    const PHI = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
      // stratified index & jitter
      const u = (i + 0.5) / count;

      // --- radial placement with *center bias* so near-path is denser ---
      // rNorm in [0..1], more weight near 0 (center): p≈u^1.6 works well
      const rNorm = Math.pow(Math.random() * 0.999 + 0.0005, 1.6);

      // angle with jitter to avoid spokes
      const theta = i * PHI + (Math.random() - 0.5) * 0.35;

      // map to ellipse, then rotate by motion direction
      const rx = rNorm * a,
        ry = rNorm * b;
      const ex = Math.cos(theta) * rx;
      const ey = Math.sin(theta) * ry;
      const ox = x + cos * ey - sin * ex;
      const oy = y + sin * ey + cos * ex;

      // --- size falloff: larger near the path, smaller farther out ---
      // base radius scales from (nearPath ~ 0.05*haloR) down to (far ~ 0.008*haloR)
      // smooth curve using (1 - rNorm)^gamma
      const near = Math.max(1.4, haloR * 0.05);
      const far = Math.max(0.6, haloR * 0.008);
      const gamma = 1.1; // controls how quickly it shrinks
      const baseR = far + (near - far) * Math.pow(1 - rNorm, gamma);

      // slight per-dot size jitter (±20%) but keep circular feel
      const R = this._safeR(baseR * (0.85 + Math.random() * 0.3));

      // --- opacity distribution: mostly faint, some medium, rare dark near the core ---
      // radial falloff (near center darker; far faint)
      let aPix =
        (0.1 + 0.55 * this.oversprayMultiplier) * // user knob
        (0.7 + 0.45 * (1 - rNorm)) * // center bias
        alphaScale;
      if (usingGoldTouch && densityFactor < 1) {
        aPix *= Math.max(0.12, densityFactor * 0.55);
      }

      // mixture: 65% faint, 28% medium, 6% strong, 1% very dark
      const m = Math.random();
      let mult;
      if (m < 0.65) mult = 0.35 + Math.random() * 0.35;
      else if (m < 0.93) mult = 0.85 + Math.random() * 0.4;
      else if (m < 0.99) mult = 1.4 + Math.random() * 0.45;
      else mult = 2.0 + Math.random() * 0.7;

      // slightly boost opacity for bigger dots (visual consistency)
      const sizeBias = 0.9 + 0.22 * (R / near);
      aPix = this.clamp(aPix * mult * sizeBias, 0.02, 0.75);

      // draw: use small "blobby" clusters so dots aren't perfectly circular,
      // but still read as dots (no streaks).
      this.ctx.globalAlpha = aPix;
      // tangent direction for subtle cluster orientation
      const tangent = theta + Math.PI * 0.5;
      this._drawDotCluster(ox, oy, R, tangent);
    }

    this.ctx.globalAlpha = prevAlpha;
  }

  createStamp(size) {
    const stampSize = Math.ceil(size * 2);
    const stampCanvas = document.createElement("canvas");
    stampCanvas.width = stampSize;
    stampCanvas.height = stampSize;
    const stampCtx = stampCanvas.getContext("2d");

    // Create radial gradient for spray effect
    const center = stampSize / 2;
    const gradient = stampCtx.createRadialGradient(
      center,
      center,
      0,
      center,
      center,
      size
    );

    // Dense core
    gradient.addColorStop(0, this.color);
    gradient.addColorStop(this.softness, this.color);

    // Soft halo
    const haloColor = this.color + "00"; // Transparent
    gradient.addColorStop(1, haloColor);

    // Draw main gradient
    stampCtx.fillStyle = gradient;
    stampCtx.fillRect(0, 0, stampSize, stampSize);

    // Add micro specks for realism
    this.addMicroSpecks(stampCtx, center, size);

    return stampCanvas;
  }

  addMicroSpecks(ctx, center, size) {
    // Create realistic spray paint mist with directional scattering
    const numRings = Math.floor(size / 1.2) + 6; // More rings for denser mist

    // Calculate spray direction for directional scattering
    const deltaX = this.currentX - this.lastX;
    const deltaY = this.currentY - this.lastY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const sprayAngle =
      distance > 0.1 ? Math.atan2(deltaY, deltaX) : Math.random() * Math.PI * 2;

    for (let ring = 0; ring < numRings; ring++) {
      const ringRadius =
        (ring + 1) * (size / numRings) * this.scatterRadiusMultiplier;
      const numSpecksInRing = Math.floor(
        ringRadius * 4.8 * this.scatterAmountMultiplier
      );

      for (let i = 0; i < numSpecksInRing; i++) {
        // Create balanced distribution on both sides of spray path
        const isLeftSide = Math.random() < 0.5; // 50% chance for each side
        const sideAngle =
          sprayAngle + (isLeftSide ? -Math.PI / 3 : Math.PI / 3); // 60° angles for better coverage
        const randomOffset = (Math.random() - 0.5) * Math.PI * 0.4; // Random variation
        const angle = sideAngle + randomOffset;
        const distance = ringRadius + (Math.random() - 0.5) * 8; // Increased scatter range
        const x = center + Math.cos(angle) * distance;
        const y = center + Math.sin(angle) * distance;

        // Variable speck sizes - larger close to center, smaller at edges
        const distanceRatio = distance / (size * this.scatterRadiusMultiplier);
        const baseSpeckSize = Math.max(0.2, 2.5 - distanceRatio * 2.0);
        const speckSize = baseSpeckSize * this.scatterSizeMultiplier;
        const speckOpacity = Math.max(0.05, 0.6 - distanceRatio * 0.5); // More subtle opacity

        ctx.globalAlpha = speckOpacity;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(x, y, speckSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Add initial burst effect - more specks at the center
    const burstSpecks = Math.floor(size * 1.2 * this.scatterAmountMultiplier);
    for (let i = 0; i < burstSpecks; i++) {
      // Create balanced burst distribution on both sides
      const isLeftSide = Math.random() < 0.5; // 50% chance for each side
      const sideAngle = sprayAngle + (isLeftSide ? -Math.PI / 3 : Math.PI / 3); // 60° angles for better coverage
      const randomOffset = (Math.random() - 0.5) * Math.PI * 0.4; // Random variation
      const angle = sideAngle + randomOffset;
      const distance =
        Math.random() * size * 0.8 * this.scatterRadiusMultiplier;
      const x = center + Math.cos(angle) * distance;
      const y = center + Math.sin(angle) * distance;

      // Burst specks - larger close to center
      const burstDistanceRatio =
        distance / (size * 0.8 * this.scatterRadiusMultiplier);
      const baseSpeckSize = Math.max(0.3, 2.0 - burstDistanceRatio * 1.5);
      const speckSize = baseSpeckSize * this.scatterSizeMultiplier;
      const speckOpacity = Math.max(0.2, 0.6 - burstDistanceRatio * 0.4); // More subtle opacity

      ctx.globalAlpha = speckOpacity;
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(x, y, speckSize, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;
  }

  addRandomSpecks(x, y, size) {
    // Create directional mist pattern based on spray angle
    const numSpecks =
      Math.floor(size * 3.6 * this.scatterAmountMultiplier) + 15;

    // Calculate spray direction for directional scattering
    const deltaX = this.currentX - this.lastX;
    const deltaY = this.currentY - this.lastY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    // Use movement direction if available, otherwise use random direction
    const sprayAngle =
      distance > 0.1 ? Math.atan2(deltaY, deltaX) : Math.random() * Math.PI * 2;

    for (let i = 0; i < numSpecks; i++) {
      // Create balanced distribution on both sides of spray direction
      const isLeftSide = Math.random() < 0.5; // 50% chance for each side
      const sideAngle = sprayAngle + (isLeftSide ? -Math.PI / 3 : Math.PI / 3); // 60° angles for better coverage
      const randomOffset = (Math.random() - 0.5) * Math.PI * 0.6; // Random offset within side
      const angle = sideAngle + randomOffset;
      const distance =
        size * (0.25 + Math.random() * 1.5) * this.scatterRadiusMultiplier;
      const speckX = x + Math.cos(angle) * distance;
      const speckY = y + Math.sin(angle) * distance;

      // Variable speck sizes - larger close to center, smaller at edges
      const distanceRatio = distance / size;
      const baseSpeckSize = Math.max(0.2, 2.8 - distanceRatio * 2.2);
      const speckSize = baseSpeckSize * this.scatterSizeMultiplier;
      const speckOpacity = Math.max(0.1, 0.5 - distanceRatio * 0.4); // More subtle opacity

      this.ctx.globalAlpha = speckOpacity;
      this.ctx.fillStyle = this.color;
      this.ctx.beginPath();
      this.ctx.arc(speckX, speckY, speckSize, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Add initial burst specks at the start of spray
    const burstSpecks = Math.floor(size * 0.9 * this.scatterAmountMultiplier);
    for (let i = 0; i < burstSpecks; i++) {
      // Create balanced burst distribution on both sides
      const isLeftSide = Math.random() < 0.5; // 50% chance for each side
      const sideAngle = sprayAngle + (isLeftSide ? -Math.PI / 3 : Math.PI / 3); // 60° angles for better coverage
      const randomOffset = (Math.random() - 0.5) * Math.PI * 0.4; // Random variation
      const angle = sideAngle + randomOffset;
      const distance =
        Math.random() * size * 1.0 * this.scatterRadiusMultiplier;
      const speckX = x + Math.cos(angle) * distance;
      const speckY = y + Math.sin(angle) * distance;

      // Burst specks - variable sizes based on distance from center
      const burstDistanceRatio =
        distance / (size * 1.0 * this.scatterRadiusMultiplier);
      const baseSpeckSize = Math.max(0.3, 2.2 - burstDistanceRatio * 1.7);
      const speckSize = baseSpeckSize * this.scatterSizeMultiplier;
      const speckOpacity = Math.max(0.2, 0.6 - burstDistanceRatio * 0.4); // More subtle opacity

      this.ctx.globalAlpha = speckOpacity;
      this.ctx.fillStyle = this.color;
      this.ctx.beginPath();
      this.ctx.arc(speckX, speckY, speckSize, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.globalAlpha = 1.0;
  }

  stopDrawing() {
    this.isDrawing = false;
    this.lastOverPos = null;
    if (this._sprayInterval) {
      clearInterval(this._sprayInterval);
      this._sprayInterval = null;
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  toRgba(hex, a = 1) {
    const c = hex.startsWith("#") ? hex.slice(1) : hex;
    const f =
      c.length === 3
        ? c
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : c.padEnd(6, "0");
    const r = parseInt(f.slice(0, 2), 16),
      g = parseInt(f.slice(2, 4), 16),
      b = parseInt(f.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Drip simulation helper functions
  cellIndexFromXY(x, y) {
    const cx = (x / this.bufScale) | 0;
    const cy = (y / this.bufScale) | 0;
    if (cx < 0 || cy < 0 || cx >= this.bufW || cy >= this.bufH) return -1;
    return cy * this.bufW + cx;
  }

  // accumulate wetness into the buffer (cheap)
  _accumWet(x, y, amount, speed = this.V_REF, centerBias = false) {
    const idx = this.cellIndexFromXY(x, y);
    if (idx < 0) return;
  
    // slightly less aggressive overall
    const gain = (0.8 + 0.4 * this.flow) * (0.7 + 0.5 * this.pressure);
    let add = amount * gain;
    const isGold = this.isGoldColor(this.color);
    const density = this._goldTouchDensityFactor && this.isTouch
      ? Math.max(0.18, this._goldTouchDensityFactor())
      : 1;
    if (isGold) {
      const touchBoost = this.isTouch ? Math.min(4.0, 2.8 / density) : 1.45;
      add *= touchBoost;
    }

    // nozzle-conditioned effective cap
    let Wcap = this.W_CAP; // default per-cell wetness cap (e.g., 0.9)
    if (this.nozzleSize <= 12) Wcap *= 0.8;      // tighter for tiny tips
    else if (this.nozzleSize < 20) Wcap *= 0.9;  // slightly tighter for mid
    if (isGold) {
      Wcap *= this.isTouch ? 1.45 : 1.2;         // allow more wetness reserve for gold
    }
  
    const wet = this.paintBuf[idx];
    const left = Math.max(0, 1 - wet / Wcap);
    add *= left;
  
    if (centerBias) {
      this.paintBuf[idx] += add;
      return;
    }
  
    // For non-center accumulation, gently bias wetness to center + faint neighbors.
    const cx = (x / this.bufScale) | 0,
          cy = (y / this.bufScale) | 0;
  
    const addTo = (ix, iy, v) => {
      if (ix < 0 || iy < 0 || ix >= this.bufW || iy >= this.bufH) return;
      const k = iy * this.bufW + ix;
      const rem = Math.max(0, 1 - this.paintBuf[k] / Wcap);
      this.paintBuf[k] += v * rem;
    };
  
    const dwell = Math.min(1, speed / this.V_REF);
  
    // keep most at center, faintly to neighbors
    const side = add * (0.35 * (1 - dwell));
    add *= 1 - 0.7 * (1 - dwell);
  
    addTo(cx - 1, cy, side * 0.4);
    addTo(cx + 1, cy, side * 0.4);
    addTo(cx, cy - 1, side * 0.4);
    addTo(cx, cy + 1, side * 0.4);
  
    this.paintBuf[idx] += add;
  }

  _updateSpeed(nowMs, dx, dy) {
    const dt = Math.max(1, nowMs - this.lastStampAtMs) / 1000; // s
    const v = Math.hypot(dx, dy) / dt; // px/s
    // EMA with ~120 ms time constant
    const k = Math.exp(-dt / 0.12);
    this.speedEMA = k * this.speedEMA + (1 - k) * v;
    this.lastStampAtMs = nowMs;
    return this.speedEMA;
  }

  // called occasionally from spraying to attempt spawning a drip

  // --- 3) _trySpawnDripAt(x,y,speed) with SPAWN / MERGE logs ---
  // Attempt to spawn (or merge into) a drip near (x,y) given current draw speed
  _trySpawnDripAt(x, y, speed = this.V_REF) {
    if (!this.dripsEnabled) return;
  
    // block any spawning until paint is armed (prevents first-paint drips)
    if (!this._dripArmed) return;
  
    const isGold = this.isGoldColor(this.color);
    const isGoldTouch = this.isTouch && isGold;

    const cx = (x / this.bufScale) | 0;
    const cy = (y / this.bufScale) | 0;
    if (cx < 0 || cy < 0 || cx >= this.bufW || cy >= this.bufH) return;
  
    const idx = cy * this.bufW + cx;
    const now = performance.now();
  
    const nozzle = Math.max(2, this.nozzleSize);
    const smallNoz = nozzle <= 12;
    const midNoz   = nozzle > 12 && nozzle < 20;
  
    // movement gating (base)
    const slowCap = this.V_SLOW * (isGoldTouch ? 1.5 : isGold ? 1.3 : 1.2);
    if (speed > slowCap) return;
    const soften = isGoldTouch ? 0.82 : isGold ? 0.92 : 1.0;
    if (speed > this.V_SLOW * (0.7 * soften)) { this.paintBuf[idx] *= 0.98; return; }

    // extra strict for very small nozzles: must be near-stationary
    if (smallNoz && speed > this.V_SLOW * (isGoldTouch ? 0.55 : isGold ? 0.42 : 0.35)) return;

    // dynamic thresholds (tightened for smaller nozzles)
    const slowFactor = Math.min(1.6, this.V_SLOW / Math.max(20, speed));
    const baseTighten = smallNoz ? 1.35 : (midNoz ? 1.15 : 1.0); // ↑ means harder
    const tightenAdj = isGoldTouch ? 0.82 : isGold ? 0.9 : 1.0;
    const nozzleTighten = baseTighten * tightenAdj;
    const centerScale = isGoldTouch ? 0.7 : isGold ? 0.82 : 1.0;
    const poolScale   = isGoldTouch ? 0.68 : isGold ? 0.85 : 1.0;
    const needCenter = this.DRIP_THRESHOLD * slowFactor * nozzleTighten * centerScale;
    const needPool   = this.NBR_MIN       * slowFactor * nozzleTighten * poolScale;
  
    // 3×3 pooled wetness
    let pool = 0;
    for (let oy = -1; oy <= 1; oy++) {
      const yy = cy + oy; if (yy < 0 || yy >= this.bufH) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox; if (xx < 0 || xx >= this.bufW) continue;
        const w = this.paintBuf[yy * this.bufW + xx];
        pool += w * (ox === 0 && oy === 0 ? 1.0 : 0.6);
      }
    }
  
    const centerWet = this.paintBuf[idx];
    const trigger = 0.55 * (centerWet / needCenter) + 0.45 * (pool / needPool);
  
    const triggerFloor = isGoldTouch ? 0.7 : isGold ? 0.83 : 0.9;
    if (trigger < triggerFloor) return;
    const slopeGate = isGoldTouch ? 0.65 : isGold ? 0.6 : 0.5;
    const triggerGate = isGoldTouch ? 1.0 : isGold ? 1.05 : 1.1;
    if (speed > this.V_SLOW * slopeGate && trigger < triggerGate) return;

    // probability curve (reduced for small/mid nozzles)
    const triggerBoost = isGoldTouch
      ? Math.max(0, trigger - 0.66)
      : isGold
      ? Math.max(0, trigger - 0.78)
      : Math.max(0, trigger - 0.9);
    let spawnProb = Math.pow(triggerBoost, isGold ? 2.4 : 3.0) *
      (isGoldTouch ? 5.2 : isGold ? 3.8 : 3.2);
    if (smallNoz) spawnProb *= isGoldTouch ? 1.35 : isGold ? 1.15 : 0.6;
    else if (midNoz) spawnProb *= isGoldTouch ? 1.2 : isGold ? 1.05 : 0.85;
    spawnProb = Math.min(1.0, spawnProb);
    if (Math.random() > spawnProb) return;
  
    // pick bottom-centered cell within radius
    const pickRadPx = nozzle * 0.55;
    const pickRad   = Math.max(1, Math.round(pickRadPx / this.bufScale));
    const maxSide   = Math.round(pickRad * 0.5);
    let bestIx = cx, bestIy = cy, bestScore = -Infinity;
  
    for (let oy = 0; oy <= pickRad; oy++) {
      const yy = cy + oy; if (yy < 0 || yy >= this.bufH) continue;
      for (let ox = -maxSide; ox <= maxSide; ox++) {
        const xx = cx + ox; if (xx < 0 || xx >= this.bufW) continue;
        const w = this.paintBuf[yy * this.bufW + xx];
        if (w <= 0) continue;
        const d2 = ox * ox + oy * oy;
        const bias = Math.exp(-d2 * 0.25) * (1 + 0.6 * (oy / (pickRad + 1)));
        const score = w * bias;
        if (score > bestScore) { bestScore = score; bestIx = xx; bestIy = yy; }
      }
    }
    if (bestScore <= 0) return;
  
    // temporal/cell neighborhood gate
    const areaRad = Math.max(1, Math.round((nozzle * 0.6) / this.bufScale));
    for (let oy = -areaRad; oy <= areaRad; oy++) {
      for (let ox = -areaRad; ox <= areaRad; ox++) {
        const yy = bestIy + oy, xx = bestIx + ox;
        if (xx < 0 || yy < 0 || xx >= this.bufW || yy >= this.bufH) continue;
        const k = yy * this.bufW + xx;
        if (this._spawnCooldown[k] > 0) return;
        const last = this._lastSpawnAt[k] || 0;
        const baseInterval = this.MIN_SPAWN_INTERVAL_MS *
          (smallNoz ? 2.2 : midNoz ? 1.5 : 1.0);
        const minInterval = baseInterval * (isGoldTouch ? 0.55 : isGold ? 0.8 : 1.0);
        if (now - last < minInterval) return;
      }
    }

    // global debounce for very small nozzles (avoid twin spawns)
    if (smallNoz) {
      const MIN_GLOBAL_GAP = isGoldTouch ? 140 : isGold ? 220 : 260; // ↑ from 180ms
      if (now - (this._lastSpawnGlobalAt || 0) < MIN_GLOBAL_GAP) return;
    }
  
    // spawn position (canvas px)
    const spawnX = (bestIx + 0.5) * this.bufScale;
    const spawnY = (bestIy + 0.5) * this.bufScale;
    const jx = (Math.random() - 0.5) * (nozzle * 0.04);
    const jy = Math.random() * (nozzle * 0.06);
    const sx = spawnX + jx;
    const sy = spawnY + jy;
  
    // spatial lockout vs recent spawns
    const lockR = smallNoz ? Math.max(14, 1.2 * nozzle + 8)
                           : midNoz   ? Math.max(12, 1.0 * nozzle + 6)
                                      : Math.max(10, 0.9 * nozzle + 6);
    const lockR2 = lockR * lockR;
  
    this._pruneRecentSpawns(now);
    for (let i = 0; i < this._recentSpawns.length; i++) {
      const sp = this._recentSpawns[i];
      const ddx = sx - sp.x, ddy = sy - sp.y;
      if (ddx * ddx + ddy * ddy <= lockR2) {
        return;
      }
    }
  
    // radius & volume
    const areaScore = Math.max(0, pool - this.DRIP_THRESHOLD);
    const densityFactor = Math.min(1.5, 0.7 + areaScore * 0.4);
  
    let vol   = Math.min(1.3, 0.6 + 0.8 * densityFactor);
    let baseR = (1.6 + 0.8 * Math.sqrt(areaScore + 0.01)) * (nozzle / 32);
  
    if (smallNoz) { baseR *= 1.55; vol *= 1.1; }
    else if (midNoz) { baseR *= 1.15; }
  
    baseR = Math.max(2.1, baseR); // floor
    const id = ++this._dripUID;
  
    this.drips.push({
      id, x: sx, y: sy, px: sx, py: sy, vy: 0,
      vol, baseR, len: 0, life: 1.0, t: 0,
      _maxTrailR: 0, _maxHeadR: 0, _firstHeadLogged: false,
      profile: {
        wobbleF: 0.6 + Math.random() * 1.0,
        wobbleA: this.LATERAL_SPREAD * (0.4 + Math.random() * 1.0),
        hookJ: 0.6 + Math.random() * 0.6,
        hookDir: Math.random() < 0.5 ? -1 : 1,
        widenK: 1.02 + Math.random() * 0.2,
        seed: Math.random() * 1000,
        noiseF: this.SHAPE_NOISE_FREQ[0] +
                Math.random()*(this.SHAPE_NOISE_FREQ[1]-this.SHAPE_NOISE_FREQ[0]),
        taperTo: this.TAIL_TAPER_MIN +
                 Math.random()*(this.TAIL_TAPER_MAX - this.TAIL_TAPER_MIN),
        bead: Math.random() < this.TAIL_BEAD_CHANCE,
      },
    });
  
    // drain & cooldown (scaled for small/mid nozzles)
    const drainRadPx = (smallNoz ? nozzle * 0.8 : midNoz ? nozzle * 0.6 : nozzle * 0.4);
    const drainRad   = Math.max(1, Math.round(drainRadPx / this.bufScale));
    const cooldownMult = smallNoz ? 2.6 : midNoz ? 1.9 : 1.4;
  
    for (let oy = -drainRad; oy <= drainRad; oy++) {
      for (let ox = -drainRad; ox <= drainRad; ox++) {
        const yy = bestIy + oy, xx = bestIx + ox;
        if (xx < 0 || yy < 0 || xx >= this.bufW || yy >= this.bufH) continue;
        const rr2 = ox * ox + oy * oy;
        if (rr2 > drainRad * drainRad) continue;
        const k = yy * this.bufW + xx;
        const fall = 0.5 + 0.5 * (1 - rr2 / (drainRad * drainRad));
        this.paintBuf[k] = Math.max(0, this.paintBuf[k] - this.DRIP_HYST * fall);
        this._spawnCooldown[k] = Math.round(this.SPAWN_COOLDOWN_FRAMES * cooldownMult);
        this._lastSpawnAt[k] = now;
      }
    }
  
    this._lastSpawnGlobalAt = now;
    this._recentSpawns.push({ x: sx, y: sy, t: now });
  
    console.log(
      `[DRIP-SPAWN#${id}] t=${now.toFixed(1)}ms at (x=${sx.toFixed(1)}, y=${sy.toFixed(1)})` +
      ` pool=${pool.toFixed(2)} trigger=${trigger.toFixed(2)} nozzle=${nozzle}` +
      ` speed=${speed.toFixed(1)} baseR=${baseR.toFixed(2)}px`
    );
  }

  // --- 4) _updateDrips(dt) with TRAIL/HEAD/cap & frame max logs ---
  _updateDrips(dt) {
    if (!this.drips.length) return;
  
    const ctx = this.ctx;
    const prevOp = ctx.globalCompositeOperation;
    const dripOp = this.getDripCompositeMode();
    ctx.globalCompositeOperation = dripOp;
    this._drawingDrip = true;
  
    const toneParity = 1.0;
    const dpr = this.dpr || window.devicePixelRatio || 1;
    const isGold = this.isGoldColor(this.color);
  
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.t += dt;
  
      // Gravity & damping
      d.vy += this.GRAVITY * 0.9 * dt * (0.55 + 0.45 * d.vol);
      d.vy *= Math.exp(-this.VISCOSITY * dt);
  
      d.py = d.y;
      d.y += d.vy * dt;
      d.len += Math.abs(d.vy * dt);
  
      // Lateral wobble
      const lenNorm = d.len / (d.len + 25);
      const wobble = Math.sin(d.t * 3.5 * d.profile.wobbleF) * d.profile.wobbleA * lenNorm;
      d.x += wobble * 0.4;
  
      // --- Trail drawing ---
      const dy = d.y - d.py;
      const stepPx = 1.0;
      const steps = Math.max(1, Math.floor(Math.abs(dy) / stepPx));
  
      // Base alpha (slightly higher for gold drips so they don't read as pale)
      let aBase = 0.22 * d.vol * toneParity;
      if (isGold) aBase *= 1.15 * this.GOLD_DRIP_ALPHA_GAIN; // ~+26% default
  
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const yy = d.py + dy * t;
  
        // radius evolution
        const widen = 1.0 + 0.0015 * d.len * d.profile.widenK;
        const elongate = 1.0 + Math.min(0.4, d.len * 0.003);
        let R = d.baseR * elongate * (1.05 + 0.6 * d.vol) * widen;
        R *= 1 / dpr; // normalize for retina
  
        // Base body
        ctx.globalAlpha = Math.max(0.05, Math.min(0.28, aBase));
        ctx.drawImage(this.getBrush(R), d.x - R, yy - R);
        d._maxTrailR = Math.max(d._maxTrailR || 0, R);
  
        // Warm glaze (gold only): very light multiply pass to deepen tone
        if (isGold) {
          ctx.save();
          ctx.globalCompositeOperation = "multiply";
          ctx.globalAlpha = 0.08; // subtle; avoids mud
          ctx.drawImage(this.getBrush(R * 0.98), d.x - R * 0.98, yy - R * 0.98);
          ctx.restore();
        }
      }
  
      // --- Head drawing ---
      const Rhead = this.headRadiusFor(d) / dpr;
      let headA = (0.16 + 0.1 * d.vol) * toneParity;
      if (isGold) headA *= 1.12 * this.GOLD_DRIP_ALPHA_GAIN;
      ctx.globalAlpha = Math.min(0.30, headA);
      ctx.drawImage(this.getBrush(Rhead), d.x - Rhead, d.y - Rhead);
      d._maxHeadR = Math.max(d._maxHeadR || 0, Rhead);
  
      if (isGold) {
        // Gentle head glaze for cohesion with trail
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = 0.10;
        ctx.drawImage(this.getBrush(Rhead * 0.97), d.x - Rhead * 0.97, d.y - Rhead * 0.97);
        ctx.restore();
      }
  
      // --- Terminate drip ---
      d.vol -= (this.DEPOSIT_PER_PX * Math.abs(dy)) / 60 + this.WET_EVAP * dt * 0.45;
      if (d.vol <= 0.08 || d.len > 70 || d.y > this.canvas.height + 5) {
        const maxR = Math.max(d._maxTrailR || 0, d._maxHeadR || 0);
        console.log(
          `[DRIP-END#${d.id}] maxTrailR=${(d._maxTrailR || 0).toFixed(2)}px ` +
          `maxHeadR=${(d._maxHeadR || 0).toFixed(2)}px maxWidthCanvas=${(2*maxR).toFixed(2)}px ` +
          `cssWidth≈${(2*maxR*dpr).toFixed(2)}px len=${d.len.toFixed(1)}px`
        );
        this.drips.splice(i, 1);
        continue;
      }
    }
  
    this._drawingDrip = false;
    ctx.globalCompositeOperation = prevOp;
  }
  // game loop hook — call once after constructing the tool
  startDripLoop() {
    const tick = (t) => {
      const dt = Math.min(0.05, (t - this._lastT) / 1000); // seconds, clamp 50ms
      this._lastT = t;

      // bleed down buffers a bit (evaporation) & cooldown spawns
      const decay = Math.exp(-this.WET_EVAP * dt);
      for (let i = 0; i < this.paintBuf.length; i++) {
        this.paintBuf[i] *= decay;
        if (this._spawnCooldown[i] > 0) this._spawnCooldown[i]--;
      }

      this._updateDrips(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // --- 2) _safeR(r) with abnormal input warning ---
  _safeR(r) {
    if (!Number.isFinite(r) || r > 256) {
      console.warn(`_safeR abnormal input r=${r}`);
    }
    return Math.max(1, Math.min(256, Number.isFinite(r) ? r : 1));
  }

  trailCapFor(d) {
    const byBase = d.baseR * 2.0; // gentler than 2.4
    const byVol = 8.0 + 9.0 * Math.sqrt(d.vol); // grows slowly with vol
    const cap = Math.min(byBase, byVol, this.GLOBAL_TRAIL_CAP);
    if (cap < d.baseR) {
      console.warn(
        `CAP-LOWERED id? baseR=${d.baseR.toFixed(2)} cap=${cap.toFixed(2)}`
      );
    }
    return cap;
  }

  headRadiusFor(d) {
    const raw = d.baseR * (1.15 + 0.45 * d.vol);
    const cap = Math.min(
      this.trailCapFor(d) * 0.9,
      this.GLOBAL_TRAIL_CAP * 0.9
    );
    const R = Math.max(1.0, Math.min(raw, cap));
    return R;
  }

  _mergeIntoDrip(target, addBaseR, addVol) {
    const oldBase = target.baseR,
      oldVol = target.vol;

    const vol = Math.min(oldVol + addVol, 2.4); // keep your existing 2.4 cap
    const areaMass = oldBase * oldBase * oldVol + addBaseR * addBaseR * addVol;

    const rEff = Math.sqrt(Math.max(1e-6, areaMass / Math.max(1e-6, vol)));
    const rAvg = 0.5 * (oldBase + addBaseR);
    let newBase = rAvg + this.MERGE_DAMP * (rEff - rAvg);

    if (newBase > this.R_BASE_HARD_MAX) {
      console.warn(
        `MERGE-CLAMP baseR ${newBase.toFixed(
          2
        )} → ${this.R_BASE_HARD_MAX.toFixed(2)}`
      );
      newBase = this.R_BASE_HARD_MAX;
    }

    target.vol = vol;
    target.baseR = newBase;
  }

  _drawTaperTip(x, y, dirY, Rstart, taperTo, steps, alphaBase = 0.16) {
    // Draw a small rounded teardrop at the end of a drip
    // dirY: +1 or -1 (downwards usually +1)
    const ctx = this.ctx;
    const sign = Math.sign(dirY) || 1;
    let R = Rstart;
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      // ease radius to smaller tip
      const k = 1 - u;
      const Ri = this._safeR(taperTo + (R - taperTo) * (k * k)); // quadratic ease
      const yy = y + sign * i * Math.max(0.5, Ri * 0.7); // slightly tighter spacing near the tip
      const a = Math.max(0.03, alphaBase * (k * 0.9));
      ctx.globalAlpha = a;
      ctx.drawImage(this.getBrush(Ri), x - Ri, yy - Ri);
      R = Ri;
    }

    // optional tiny bead at the very tip
    if (this._currentDripProfile && this._currentDripProfile.bead) {
      const beadR = Math.max(0.8, R * (0.75 + Math.random() * 0.35));
      const yy =
        y +
        (Math.sign(dirY) || 1) *
          (steps * Math.max(0.5, beadR * 0.7) + beadR * 0.4);
      const a = 0.12;
      const b = this.getBrush(beadR);
      this.ctx.globalAlpha = a;
      this.ctx.drawImage(b, x - beadR, yy - beadR);
    }
  }

  // light-weight, deterministic-ish 1D noise (smoothed value noise)
  _noise1Dhash(t) {
    const s = Math.sin(t * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  _smoothNoise1D(t) {
    const i = Math.floor(t),
      f = t - i;
    const a = this._noise1Dhash(i),
      b = this._noise1Dhash(i + 1);
    const u = f * f * (3 - 2 * f); // smoothstep
    return a + (b - a) * u; // 0..1
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
  
    // Match canvas pixel buffer to real display size
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
  
    this.ctx.scale(dpr, dpr);
    this.dpr = dpr;
    console.log(`[CANVAS] DPR=${dpr} size=${rect.width}×${rect.height}`);
  }

  // Clean up cache periodically
  cleanupCache() {
    if (this.stampCache.size > 50) {
      // Keep only the most recent 20 stamps
      const entries = Array.from(this.stampCache.entries());
      this.stampCache.clear();
      entries.slice(-20).forEach(([key, value]) => {
        this.stampCache.set(key, value);
      });
    }
  }
}
