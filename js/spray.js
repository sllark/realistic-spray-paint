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
    this.DRIP_THRESHOLD = 0.55; // pooled paint needed at center cell
    this.DRIP_HYST = 0.12; // local drain after spawn
    this.GRAVITY = 1580; // px/s^2
    this.VISCOSITY = 4.2; // s^-1 damping
    this.WET_EVAP = 0.26; // s^-1 evaporation from buffer
    this.W_CAP = 0.9; // per-cell wetness cap (keep only this line)
    this.MAX_DRIPS = 90;

    this._lastT = performance.now();

    // pooling / spacing / shape
    this.NBR_MIN = 0.72; // min 3×3 pooled wetness
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
    this.dripHighlightGain = 0.6; // 0..1, reduce bright center on drips

    // --- tail & variation controls ---
    this.TAIL_TAPER_MIN = 0.35; // 0..1 how thin the tail tip can get (fraction of baseR)
    this.TAIL_TAPER_MAX = 0.85; // 0..1 upper bound for taper factor
    this.TAIL_CAP_STEPS = 7; // how many stamps to round the tip when a drip ends

    // per-location spawn throttling (ms); avoid multiple instant drips
    this.MIN_SPAWN_INTERVAL_MS = 1000; // ~0.55s
    this._lastSpawnAt = new Uint32Array(this.paintBuf.length); // per-cell timestamp (ms)

    // optional: longer cell cooldown after a spawn (frames, decremented in loop)
    this.SPAWN_COOLDOWN_FRAMES = 40; // ~0.6s @ ~60fps

    // --- extra randomness for drip shapes ---
    this.SHAPE_NOISE_AMP = 0.22; // 0..0.3 — how wobbly the radius gets along the trail
    this.SHAPE_NOISE_FREQ = [0.7, 1.6]; // Hz-ish range for the 1D noise speed
    this.TAIL_HOOK_STRENGTH = 0.6; // 0..1 — curvature of the tail (randomized per drip)
    this.TAIL_BEAD_CHANCE = 0.35; // 0..1 — chance of a tiny bead at the very tip
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
    const cx = radius,
      cy = radius;
    const gain = variant === "drip" ? this.dripHighlightGain : 1.0; // tone down on drips

    // Base body
    const g0 = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g0.addColorStop(0.0, this._hexToRgba("#FFD700", 0.85 * gain)); // bright core
    g0.addColorStop(0.3, "#EAC677");
    g0.addColorStop(0.7, "#D4AF37");
    g0.addColorStop(1.0, this._hexToRgba("#B8860B", 1.0));
    ctx.fillStyle = g0;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Highlight (reduced on drips)
    const g1 = ctx.createRadialGradient(
      cx * 0.72,
      cy * 0.72,
      0,
      cx,
      cy,
      radius * 0.62
    );
    g1.addColorStop(0.0, this._hexToRgba("#FFF8DC", 0.55 * gain));
    g1.addColorStop(0.4, this._hexToRgba("#FFD700", 0.45 * gain));
    g1.addColorStop(1.0, this._hexToRgba("#FFD700", 0.0));
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Second reflection (very subtle)
    const g2 = ctx.createRadialGradient(
      cx * 1.2,
      cy * 0.8,
      0,
      cx,
      cy,
      radius * 0.4
    );
    g2.addColorStop(0.0, this._hexToRgba("#FFFFFF", 0.2 * gain));
    g2.addColorStop(0.3, this._hexToRgba("#FFD700", 0.15 * gain));
    g2.addColorStop(1.0, this._hexToRgba("#FFD700", 0.0));
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Subtle texture (same as yours; left as-is)
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
    const alphaScale = (this.opacity * p) / (0.02 * z * z + 1);
    const scatterRadius = Rz * this.scatterRadiusMultiplier;
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

    // Start continuous spraying
    if (!this._sprayInterval) {
      this._sprayInterval = setInterval(() => {
        if (this.isDrawing) {
          this.stamp(this.currentX, this.currentY);
        }
      }, 16); // ~60fps, adjust to 30–60fps range for performance
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

    if (speedRatio <= 1.5) {
      // console.log(`🐌 Slow Movement - No extra stamps needed`);
    }
  }

  stamp(x, y) {
    const now = performance.now();
    const dx = x - (this.lastX ?? x);
    const dy = y - (this.lastY ?? y);
    const speed = this._updateSpeed(now, dx, dy);

    if (now - this.lastStampTime < this.stampInterval) return;
    this.lastStampTime = now;

    const size = this.nozzleSize * (0.8 + this.pressure * 0.4);

    // 🔹 NEW: stationary dwell behavior
    const stationary = speed < this.V_SLOW * 0.3; // ~very slow/held in place
    if (stationary) {
      // Time-based overspray emission (distance doesn't advance)
      if (now - (this._lastDwellOverAt || 0) >= this._oversprayTimeStepMs) {
        this.addOverspray(x, y, size);
        this._lastDwellOverAt = now;
      }

      // Extra centered pooling so a drip can spawn
      // (use centerBias=true and neutral speed to avoid "slow penalty")
      const dwellWet = 0.1 * this.flow * (0.85 + 0.5 * this.pressure);
      this._accumWet(x, y, dwellWet, this.V_SLOW, /*centerBias=*/ true);
      this._trySpawnDripAt(x, y, this.V_SLOW); // neutral thresholds
    } else {
      // reset dwell overspray timer when moving again
      this._lastDwellOverAt = 0;
    }

    // draw grain (speed-aware)
    this.createNoisyPath(x, y, size, speed);

    // --- existing distance-based overspray pacing (keep yours) ---
    const dOver = !this.lastOverPos
      ? Infinity
      : Math.hypot(x - this.lastOverPos.x, y - this.lastOverPos.y);

    const shouldEmitByDistance =
      !this.lastOverPos || dOver >= this.oversprayStep;
    if (shouldEmitByDistance) {
      if (this.lastOverPos && dOver < this.oversprayStep * 1.2) {
        this.addOverspray(x, y, size);
      }
      this.lastOverPos = { x, y };
    }
  }

  // --- Blue-noise-ish scatter with HiDPI brush, sub-pixel positions ---
  createNoisyPath(x, y, size, speed = this.V_REF) {
    const params = this.deriveSprayParams();
    const { scatterRadius } = params;

    // if you added speed-based thickness earlier, use it; otherwise 1.0
    const thicknessK =
      typeof this._getThicknessScale === "function"
        ? this._getThicknessScale(speed)
        : 1.0;

    // dwell (already in your code) + thickness scaling
    const dwell = Math.min(1, speed / this.V_REF); // 0..1
    const spread = 1 + 0.35 * (1 - dwell);
    const displayRadius =
      Math.max(scatterRadius, size * 0.55) * spread * thicknessK;

    // density that breathes with footprint but avoids “too many dots”
    const areaFactor =
      (this.nozzleSize * this.nozzleSize) / (this.Dref * this.Dref);
    const baseDots = 6.0 * areaFactor * this.flow;
    const densityComp = 1 / Math.max(0.6, Math.min(1.6, thicknessK));
    const MAX_DOTS = 1400;

    // Use golden-angle spiral with jitter → blue-noise-like randomness without clumps
    // n ≈ proportional to area, then trimmed by MAX_DOTS.
    let nDots = Math.min(
      MAX_DOTS,
      Math.floor(
        displayRadius * baseDots * this.scatterAmountMultiplier * densityComp
      )
    );
    if (nDots <= 0) return;

    const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle ~2.399963...
    const baseOpacity = this.opacity;
    const dotBaseR = Math.max(0.6, size * 0.005 * this.scatterSizeMultiplier); // a tad larger to avoid pixel steps

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    // global target smoothing on destination
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    // Use a single save/restore for perf
    this.ctx.save();
    this.ctx.fillStyle = this.color;

    // Per-stamp alpha baseline
    // Slight compensation to keep tone stable when thick vs thin
    const toneComp = Math.sqrt(1 / Math.max(0.6, Math.min(1.6, thicknessK)));

    // Emit dots on a spiral with jittered radius & angle
    // r ~ sqrt(i/N) for uniform disk coverage, + small noise for randomness
    const N = nDots;
    const jitterR = 0.12; // radial jitter fraction
    const jitterT = 0.35; // angular jitter (radians) scaled per sample
    for (let i = 0; i < N; i++) {
      // base polar position
      const u = (i + 0.5) / N; // stratified 0..1
      const r0 = Math.sqrt(u) * displayRadius;
      const t0 = i * phi;

      // add jitter (more jitter near center to avoid grid look)
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

      // Grain size with your existing model, but minimum ~0.6px to avoid “pixel stair”
      const rndSize = Math.max(
        0.6,
        this.calculateGrainSize(dotBaseR, size, params)
      );

      // Opacity using your model + tone compensation + dwell attenuation
      let dotOpacity = this.calculateGrainOpacity(
        baseOpacity,
        rndSize / dotBaseR,
        params
      );
      dotOpacity *= (0.35 + 0.65 * dwell) * toneComp;

      // Draw with HiDPI gradient brush at sub-pixel coordinates
      const b = this.getBrush(rndSize);
      this.ctx.globalAlpha = dotOpacity;

      // Add metallic shimmer for gold particles
      if (
        this.isGoldColor(this.color) &&
        this.metallicShimmerSpray &&
        Math.random() < 0.3
      ) {
        this.ctx.globalCompositeOperation = "screen";
        this.ctx.drawImage(b, dotX - rndSize, dotY - rndSize);
        this.ctx.globalCompositeOperation = "source-over";
      }

      this.ctx.drawImage(b, dotX - rndSize, dotY - rndSize);

      // accumulate wetness sparsely for performance (every 4th dot)
      if ((i & 3) === 0) {
        // scale wetness by size^2 and opacity, normalized by nozzle area
        const normNozzleArea = Math.max(64, this.nozzleSize * this.nozzleSize);
        const G = 100;
        const wet =
          ((G * dotOpacity * (rndSize * rndSize)) / normNozzleArea) *
          (0.8 + 0.6 * this.pressure) *
          this.flow;

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

  // --- Natural, dot-only overspray with size/opacity falloff and subtle blob variants ---
  addOverspray(x, y, size) {
    if (this.oversprayMultiplier <= 0) return;

    // precompute physical params
    const { Rz, alphaScale } = this.deriveSprayParams();

    // halo radius (how far overspray extends). Grows with nozzle & distance, gently clamped.
    const haloR = Math.min(Math.max(size * 1.05, 2.0 * Rz), size * 2.1);

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
    count = Math.max(18, Math.min(240, count));

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

    // gentler gain overall
    const gain = (0.85 + 0.45 * this.flow) * (0.75 + 0.55 * this.pressure);
    let add = amount * gain;

    // cap growth at the cell so it can't snowball
    const wet = this.paintBuf[idx];
    const left = Math.max(0, 1 - wet / this.W_CAP);
    add *= left;

    // 🔸 NEW: center-biased path (no lateral spreading)
    if (centerBias) {
      this.paintBuf[idx] += add;
      return;
    }

    // (existing dwell-based lateral spread)
    const dwell = Math.min(1, speed / this.V_REF); // 0..1
    if (dwell < 0.8) {
      const side = add * (0.55 * (1 - dwell)); // up to 55% sideflow
      const cx = (x / this.bufScale) | 0,
        cy = (y / this.bufScale) | 0;

      const addTo = (ix, iy, v) => {
        if (ix < 0 || iy < 0 || ix >= this.bufW || iy >= this.bufH) return;
        const k = iy * this.bufW + ix;
        const rem = Math.max(0, 1 - this.paintBuf[k] / this.W_CAP);
        this.paintBuf[k] += v * rem;
      };

      addTo(cx - 1, cy, side * 0.5);
      addTo(cx + 1, cy, side * 0.5);
      addTo(cx, cy - 1, side * 0.5);
      addTo(cx, cy + 1, side * 0.5);

      add *= 1 - 0.9 * (1 - dwell);
    }

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
  _trySpawnDripAt(x, y, speed = this.V_REF) {
    if (!this.dripsEnabled) return;

    const cx = (x / this.bufScale) | 0;
    const cy = (y / this.bufScale) | 0;
    if (cx < 0 || cy < 0 || cx >= this.bufW || cy >= this.bufH) return;

    const idx = cy * this.bufW + cx;

    // strong speed gate: only when really slow/lingering
    if (speed > this.V_SLOW * 0.7) return;

    // time-based throttle per cell (prevents “3 instant drips” at one spot)
    const nowMs = performance.now() | 0;
    if (nowMs - this._lastSpawnAt[idx] < this.MIN_SPAWN_INTERVAL_MS) return;

    // frame cooldown as a second guard
    if (this._spawnCooldown[idx] > 0) return;

    // pooled wetness in 3×3 with neighbor weight
    let pool = 0;
    for (let oy = -1; oy <= 1; oy++) {
      const yy = cy + oy;
      if (yy < 0 || yy >= this.bufH) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const xx = cx + ox;
        if (xx < 0 || xx >= this.bufW) continue;
        const w = this.paintBuf[yy * this.bufW + xx];
        pool += w * (ox === 0 && oy === 0 ? 1.0 : 0.65);
      }
    }
    const centerWet = this.paintBuf[idx];

    // thresholds tighten as you slow down (unchanged idea)
    const slowFactor =
      speed < this.V_SLOW ? this.V_SLOW / Math.max(20, speed) : 1;
    const needCenter = this.DRIP_THRESHOLD * Math.min(1.5, slowFactor);
    const needPool = this.NBR_MIN * Math.min(1.5, slowFactor);
    if (centerWet < needCenter || pool < needPool) return;

    // if there’s an existing drip very close, MERGE volume instead of spawning a new one
    for (let j = this.drips.length - 1; j >= 0; j--) {
      const d = this.drips[j];
      if (
        Math.abs(d.x - x) < this.MIN_DRIP_SPACING &&
        Math.abs(d.y - y) < this.MIN_DRIP_SPACING * 0.8
      ) {
        const addVol = Math.min(0.6 * (1 + (pool - this.DRIP_THRESHOLD)), 1.2);
        const addBaseR = Math.max(1.6, d.baseR * (0.9 + Math.random() * 0.2));
        this._mergeIntoDrip(d, addBaseR, addVol);
        // still start a cooldown so more don’t pop instantly
        this._spawnCooldown[idx] = this.SPAWN_COOLDOWN_FRAMES;
        this._lastSpawnAt[idx] = nowMs;
        return;
      }
    }

    // drain a little and enforce capacity
    this.paintBuf[idx] = Math.max(0, centerWet - this.DRIP_HYST);
    if (this.drips.length >= this.MAX_DRIPS) return;

    // base size/volume
    const areaScore = Math.max(0, pool - this.DRIP_THRESHOLD);
    const vol = Math.min(1.6, 0.6 + 1.2 * areaScore);
    const baseR = Math.max(
      2.1,
      1.6 + 0.9 * Math.sqrt(areaScore + 0.01) + (this.nozzleSize / 48) * 0.7
    );

    // per-drip shape profile for natural variety
    const profile = {
      widenK: 1.02 + Math.random() * 0.2, // growth rate
      wobbleA: this.LATERAL_SPREAD * (0.4 + Math.random() * 1.0), // lateral meander
      wobbleF: 0.5 + Math.random() * 1.2, // wobble freq
      taperTo:
        this.TAIL_TAPER_MIN +
        Math.random() * (this.TAIL_TAPER_MAX - this.TAIL_TAPER_MIN),
      tipBias: 0.6 + Math.random() * 0.6,
      // NEW: radius noise & tail hook parameters
      noiseF:
        this.SHAPE_NOISE_FREQ[0] +
        Math.random() * (this.SHAPE_NOISE_FREQ[1] - this.SHAPE_NOISE_FREQ[0]),
      seed: Math.random() * 1000,
      hookDir: Math.random() < 0.5 ? -1 : 1, // left/right
      hookJ: 0.65 + Math.random() * 0.7, // per-drip hook intensity
      bead: Math.random() < this.TAIL_BEAD_CHANCE, // tip bead on/off
    };

    this.drips.push({
      x,
      y,
      px: x,
      py: y,
      vy: 0,
      vol,
      baseR,
      len: 0,
      life: 1,
      t: 0, // internal time for wobble
      profile,
    });

    this._spawnCooldown[idx] = this.SPAWN_COOLDOWN_FRAMES;
    this._lastSpawnAt[idx] = nowMs;
  }

  // --- 4) _updateDrips(dt) with TRAIL/HEAD/cap & frame max logs ---
  _updateDrips(dt) {
    if (!this.drips.length) return;

    const ctx = this.ctx;
    const prevOp = ctx.globalCompositeOperation;
    const dripOp = this.getDripCompositeMode();
    ctx.globalCompositeOperation = dripOp;

    const isGold = this.isGoldColor(this.color);
    const toneParity = isGold ? 0.92 : 1.0;

    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.t += dt;

      // gravity + damping
      d.gravityScale = 0.85 + Math.random() * 0.3;
      d.vy += this.GRAVITY * d.gravityScale * dt * (0.55 + 0.45 * d.vol);
      d.vy *= Math.exp(-this.VISCOSITY * dt);

      d.py = d.y;
      d.y += d.vy * dt;

      // --- lateral wobble + hooked tail curvature (len-normalized) ---
      const lenNorm = d.len / (d.len + 28); // 0..1, grows with length
      const wobble =
        Math.sin(d.t * (3.0 * d.profile.wobbleF)) * d.profile.wobbleA;
      const hookGain =
        this.TAIL_HOOK_STRENGTH *
        d.profile.hookJ *
        (1 + 0.6 * lenNorm * lenNorm);
      d.x += wobble * dt + d.profile.hookDir * hookGain * lenNorm * dt * 26;

      const dy = d.y - d.py;
      d.len += Math.abs(dy);

      // stamps along segment
      const stepPx = 1.0;
      const steps = Math.max(1, Math.floor(Math.abs(dy) / stepPx));
      const aBase = 0.22 * d.vol * toneParity;

      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const yy = d.py + dy * t;

        // widening (existing)
        const widen = Math.min(1.14, 1.0 + 0.0015 * d.len * d.profile.widenK);

        // base radius (existing)
        const capR = this.trailCapFor(d);
        const elongate = 1 + Math.min(0.4, d.len * 0.003);
        let rawR =
          d.baseR * elongate * (1.06 + 0.62 * d.vol) * widen * (1.0 + 0.12 * t);

        // --- NEW: low-frequency radius noise → small bulges/skinny sections ---
        const n = this._smoothNoise1D(
          d.profile.seed + d.len * 0.05 * d.profile.noiseF
        ); // 0..1
        const jitter = 1 + this.SHAPE_NOISE_AMP * (n - 0.5); // ~0.92..1.08
        rawR *= jitter;

        // clamp smoothly to cap
        let R = rawR;
        if (rawR >= capR) {
          const overshoot = Math.min(1.0, (rawR - capR) / Math.max(1e-3, capR));
          R = capR - capR * 0.12 * overshoot * overshoot * (2 - overshoot);
          R = Math.min(R, capR - 0.25);
        }
        R = this._safeR(R);

        // slight cross-axis jitter + gentle hook bias baked in already via d.x
        const xx = d.x + (Math.random() - 0.5) * 0.4 * R;

        // alpha falloff near cap (existing)
        const nearCap = R / Math.max(1e-3, capR);
        const falloff = Math.max(0.35, 1 - 0.65 * nearCap * nearCap);
        const alpha = Math.max(
          0.05,
          Math.min(0.2, aBase * (0.7 + 0.5 * t) * falloff)
        );

        ctx.globalAlpha = alpha;
        ctx.drawImage(this.getBrush(R), xx - R, yy - R);

        // Tiny chance of a slightly thicker "pool" near the trail's upper quarter.
        if (Math.random() < 0.05 && t < 0.25) {
          ctx.globalAlpha = Math.min(1, alpha * 1.5);
          const Rb = R * 1.2;
          ctx.drawImage(this.getBrush(Rb), xx - Rb, yy - Rb);
          // no need to reset globalAlpha; you'll set it again on the next loop
        }

        this._accumWet(xx, yy, alpha * 0.06);
      }

      // head
      const Rhead = this.headRadiusFor(d);
      ctx.globalAlpha = Math.min(0.22, (0.16 + 0.1 * d.vol) * toneParity);
      ctx.drawImage(this.getBrush(Rhead), d.x - Rhead, d.y - Rhead);

      // occasional tiny flecks just below the tail tip
      {
        const toneParity = 0.9; // keep same tone as paint; tweak (e.g., 0.9) if too bright
        if (Math.random() < 0.15) {
          for (let k = 0; k < 3; k++) {
            const rr = 0.5 + Math.random(); // 0.5–1.5 px
            const xx2 = d.x + (Math.random() - 0.5) * Rhead * 2; // slight horizontal spread
            const yy2 = d.y + (Math.random() + 0.2) * Rhead * 3; // below the head
            ctx.globalAlpha = 0.05 * toneParity;
            ctx.drawImage(this.getBrush(rr), xx2 - rr, yy2 - rr);
          }
        }
      }

      // life
      d.vol -=
        (this.DEPOSIT_PER_PX * Math.abs(dy)) / 60 + this.WET_EVAP * dt * 0.45;

      // rounded, slightly variable tip at end (no flat cutoffs)
      if (d.vol <= 0.08 || d.len > 70 || d.y > this.canvas.height + 5) {
        this._currentDripProfile = d.profile; // <-- for tip bead helper
        const taperTo = Math.max(0.8, d.baseR * d.profile.taperTo);
        const stepsTip = this.TAIL_CAP_STEPS;
        const dirY = dy >= 0 ? 1 : -1;
        this._drawTaperTip(
          d.x,
          d.y,
          dirY,
          Math.max(1.0, Rhead),
          taperTo,
          stepsTip,
          0.14 * toneParity
        );
        this._currentDripProfile = null;
        this.drips.splice(i, 1);
        continue;
      }
    }

    ctx.globalCompositeOperation = prevOp;
  }

  // game loop hook — call once after constructing the tool
  startDripLoop() {
    console.log(`🚀 Starting drip simulation loop`);
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
    const byBase = d.baseR * 1.6; // gentler than 2.4
    const byVol = 6.0 + 7.5 * Math.sqrt(d.vol); // grows slowly with vol
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
    console.log(
      `HEAD id=? Rhead=${R.toFixed(2)} baseR=${d.baseR.toFixed(
        2
      )} vol=${d.vol.toFixed(2)}`
    );
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

    console.log(
      `MERGE into id=? newVol=${vol.toFixed(2)} newBaseR=${newBase.toFixed(
        2
      )} (from base=${oldBase.toFixed(2)}, vol=${oldVol.toFixed(
        2
      )} + ${addVol.toFixed(2)})`
    );
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
