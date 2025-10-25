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
    this.nozzleSize = 40;
    this.softness = 0.88; // 88% softness
    this.opacity = 0.9; // 90% opacity
    this.flow = 1.0; // 100% flow

    // Performance optimization
    this.stampCache = new Map();
    this.lastStampTime = 0;
    this.stampInterval = 0; // No throttling - maximum performance

    // Pressure simulation
    this.pressure = 1.0;
    this.pressureSmoothing = 0.2;

    // Scatter controls
    this.scatterRadiusMultiplier = 1.1; // 110% default
    this.scatterAmountMultiplier = 1.0; // 100% default - full density
    this.scatterSizeMultiplier = 1.0; // 100% default

    // Overspray control
    this.oversprayMultiplier = 0.15; // 15% default

    // Distance physics
    this.distance = 10; // 10px default
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
    this.DRIP_THRESHOLD = 0.24; // pooled paint needed at center cell
    this.DRIP_HYST = 0.085; // local drain after spawn
    this.GRAVITY = 1500; // px/s^2
    this.VISCOSITY = 3.8; // s^-1 damping
    this.WET_EVAP = 0.24; // s^-1 evaporation from buffer
    this.W_CAP = 1.0; // per-cell wetness cap (keep only this line)
    this.MAX_DRIPS = 120;

    this._lastT = performance.now();

    // pooling / spacing / shape
    this.NBR_MIN = 0.44; // min 3×3 pooled wetness
    this.MIN_DRIP_SPACING = 18; // px — merges nearby seeds to thicken
    this.DEPOSIT_PER_PX = 1.25; // volume lost per 60–70 px of travel
    this.LATERAL_SPREAD = 0.6; // px/frame lateral meander

    // speed estimation for dwell logic
    this.lastStampAtMs = performance.now();
    this.speedEMA = 0; // px/s EMA

    // dwell speed references
    this.V_REF = 160; // "normal hand" speed
    this.V_SLOW = 80; // below this → dwell spreading

    // spawn cooldown map
    this._spawnCooldown = new Uint16Array(this.paintBuf.length);

    // drip control
    this.dripsEnabled = true;

    // --- radius safety & merge damping ---
    this.GLOBAL_TRAIL_CAP = 26.0;   // absolute visual max for any trail stamp
    this.R_BASE_HARD_MAX  = 12.0;   // baseR can't exceed this (prevents huge heads)
    this.MERGE_DAMP       = 0.35;   // 0..1, how much to move toward area-conserving merge

    // --- overspray timing ---
    this._lastDwellOverAt = 0;      // ms
    this._oversprayTimeStepMs = 70; // emit overspray ring ~14 Hz when stationary

    // Speed→thickness dynamics
    this.lineDynamicsEnabled = true;
    this.thickSlowScale = 1.3; // max scale when very slow/holding
    this.thinFastScale  = 0.7; // min scale when very fast
    this.V_FAST = this.V_REF * 20; // speed at which thinning saturates
    this.speedCurve = 1.3; // >1 = smoother, <1 = snappier
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

  setLineDynamicsEnabled(on) { this.lineDynamicsEnabled = !!on; }
  
  setLineDynamicsRange(minScale, maxScale) {
    this.thinFastScale = Math.max(0.4, Math.min(1.0, minScale));
    this.thickSlowScale = Math.max(1.0, Math.min(2.0, maxScale));
  }
  setLineDynamicsCurve(curve = 1.25) { this.speedCurve = Math.max(0.5, Math.min(3, curve)); }
  
  setLineDynamicsFastSpeed(vfast) { this.V_FAST = Math.max(this.V_REF * 1.2, vfast); }

  toggleDrips() {
    // Toggle drip simulation by enabling/disabling drip spawning
    this.dripsEnabled = !this.dripsEnabled;
    return this.dripsEnabled;
  }

  _getThicknessScale(speed) {
    if (!this.lineDynamicsEnabled) return 1.0;
  
    // normalize speed between V_SLOW and V_FAST
    const nRaw = (speed - this.V_SLOW) / Math.max(1, (this.V_FAST - this.V_SLOW));
    const n = Math.max(0, Math.min(1, nRaw));
    // ease-in curve for smoother response
    const eased = Math.pow(n, this.speedCurve);
  
    // lerp: slow→thick, fast→thin
    const minS = this.thinFastScale;   // at n=1 (fast)
    const maxS = this.thickSlowScale;  // at n=0 (slow)
    return maxS + (minS - maxS) * eased;
  }

  // --- 1) getBrush(radius) with large-radius warning ---
  getBrush(radius) {
    if (radius > 64) {
      console.warn(`getBrush large radius=${radius}`);
    }

    const R = this._safeR(radius);
    const r = Math.round(R); // cache on integer radii
    const key = `${r}-${this.color}-${this.softness}`;
    if (this.stampCache.has(key)) return this.stampCache.get(key);

    const s = Math.max(2, r * 2);
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d");

    if (!g || !Number.isFinite(r)) return c;

    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, this.color);
    grad.addColorStop(this.softness, this.color);
    grad.addColorStop(1, this.color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);

    this.stampCache.set(key, c);
    return c;
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
      const dwellWet = 0.10 * this.flow * (0.85 + 0.5 * this.pressure);
      this._accumWet(x, y, dwellWet, this.V_SLOW, /*centerBias=*/true);
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
  
    const shouldEmitByDistance = !this.lastOverPos || dOver >= this.oversprayStep;
    if (shouldEmitByDistance) {
      if (this.lastOverPos && dOver < this.oversprayStep * 1.2) {
        this.addOverspray(x, y, size);
      }
      this.lastOverPos = { x, y };
    }
  }

  createNoisyPath(x, y, size, speed = this.V_REF) {
    // Compute derived spray parameters once per stamp
    const params = this.deriveSprayParams();
    const { scatterRadius } = params;

    // dwell already computed below; add speed-based thickness scale
    const thicknessK = this._getThicknessScale(speed);

    // dwell: spread footprint & reduce per-dot alpha when moving slowly
    const dwell = Math.min(1, speed / this.V_REF); // 0..1
    const spread = 1 + 0.35 * (1 - dwell);

    // ⬇️ scale the footprint radius by speed
    const displayRadius = Math.max(scatterRadius, size * 0.55) * spread * thicknessK;

    // Dot count ∝ nozzle area (area factor)
    // Increase dots when thinner, decrease when thicker, so darkness stays balanced.
    const areaFactor = (this.nozzleSize * this.nozzleSize) / (this.Dref * this.Dref);
    const baseDots = 6.0 * areaFactor * this.flow;
    const densityComp = 1 / Math.max(0.6, Math.min(1.6, thicknessK));
    const MAX_DOTS = 1400; // tune for your device
    const numDots = Math.min(
      MAX_DOTS,
      Math.floor(displayRadius * baseDots * this.scatterAmountMultiplier * densityComp)
    );
    
    const dotRadius = Math.max(0.1, size * 0.005 * this.scatterSizeMultiplier);
    this.ctx.save();
    this.ctx.fillStyle = this.color;
    this.ctx.globalAlpha = this.opacity;

    // Main spray area dots
    for (let i = 0; i < numDots; i++) {
      // Create uniform circular distribution using display radius
      const angle = Math.random() * Math.PI * 2; // Random angle
      const distance = Math.sqrt(Math.random()) * displayRadius; // Use display radius
      const dotX = x + Math.cos(angle) * distance;
      const dotY = y + Math.sin(angle) * distance;

      // Use sophisticated grain control system with pre-computed params
      const randomSize = this.calculateGrainSize(dotRadius, size, params);

      // ... inside your dot loop after "randomSize" and before drawImage:
      let dotOpacity = this.calculateGrainOpacity(
        this.opacity,
        randomSize / dotRadius,
        params
      );

      // Apply saturation plateau (alphaScale already applied in calculateGrainOpacity)
      dotOpacity *= 0.35 + 0.65 * dwell; // was 0.55 + 0.45*dwell

      // Use soft brush cache for realistic Gaussian softness
      const brush = this.getBrush(randomSize);
      this.ctx.globalAlpha = dotOpacity; // keep per-dot jitter alpha
      this.ctx.drawImage(brush, dotX - randomSize, dotY - randomSize);

      // accumulate EVERY dot (we’ll cap the buffer) using area-based wetness
      if ((i & 3) === 0) {
        // area ~ r^2; normalize by nozzle area and scale so typical hits give 0.01–0.05
        const normNozzleArea = Math.max(64, this.nozzleSize * this.nozzleSize); // avoid tiny division
        const G = 100; // gain to bring units into a useful range
        const wet =
          ((G * dotOpacity * (randomSize * randomSize)) / normNozzleArea) *
          (0.8 + 0.6 * this.pressure) * // more pressure → wetter
          this.flow; // more flow → wetter

        this._accumWet(dotX, dotY, wet, speed);
        this._trySpawnDripAt(dotX, dotY, speed);
      }
    }

    // Add overspray effect - excess paint that spreads beyond the main area
    // this.addOverspray(x, y, size);

    this.ctx.restore();
  }

  addOverspray(x, y, size) {
    if (this.oversprayMultiplier <= 0) return;

    const params = this.deriveSprayParams();
    const { Rz, alphaScale } = params; // alphaScale ~ (opacity*pressure)/(1+0.02 z^2)

    // physical halo radius, clamped so it doesn't explode
    const speed = this.speedEMA || this.V_REF;
    const haloK = this._getThicknessScale(speed);
    const haloR = Math.min(Math.max(size * 1.1, 2.0 * Rz), size * 2.2) * haloK;

    // orientation
    const vx = this.currentX - this.lastX,
      vy = this.currentY - this.lastY;
    const vlen = Math.hypot(vx, vy) || 1;
    const ang = Math.atan2(vy, vx);
    const cos = Math.cos(ang),
      sin = Math.sin(ang);

    // ellipse axes (⟂ a, ‖ b)
    const a = haloR * (1.05 + 0.1 * this.oversprayMultiplier);
    const b = haloR * (0.8 + 0.05 * this.oversprayMultiplier);

    // ---- COUNT from ellipse perimeter + nozzle/alpha factors ----
    const h = (a - b) ** 2 / (a + b) ** 2; // Ramanujan approx
    const perimeter =
      Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));

    const spacing = 20; // px target spacing around the ring
    const baseCount = perimeter / spacing;

    // bigger nozzle → more specks; use sqrt so it doesn’t explode
    const nozzleFactor = Math.sqrt(Math.max(0.5, this.nozzleSize / this.Dref));

    // overspray knob & pressure
    const knob = 0.6 + 0.8 * this.oversprayMultiplier; // 0.6..1.4
    const press = 0.7 + 0.6 * this.pressure; // 0.7..1.3

    // alphaScale already reduces with distance; also lifts with opacity/pressure
    let count = Math.floor(
      baseCount * nozzleFactor * knob * press * (0.6 + 0.8 * alphaScale)
    );
    count = this.clamp(count, 6, 140);

    // ---- SPECKS (edge-biased radius; size & opacity respect nozzle/distance) ----
    const rMin = Math.max(0.7, haloR * 0.01);
    const rMax = Math.max(2.6, haloR * 0.035);
    const prevAlpha = this.ctx.globalAlpha;

    for (let i = 0; i < count; i++) {
      // radius 0.72..1.0 of halo, biased to edge
      const u = Math.random();
      const rNorm = 0.72 + 0.28 * Math.pow(u, 0.55);
      const r = rNorm * haloR;

      const phi = Math.random() * Math.PI * 2;
      const ex = Math.cos(phi) * (r * 1.0); // ⟂
      const ey = Math.sin(phi) * (r * 0.85); // ‖
      const ox = x + cos * ey - sin * ex;
      const oy = y + sin * ey + cos * ex;

      // log-normal sizes; a bit larger near the edge; slightly larger with nozzle
      const s = Math.exp(0.0 + 0.45 * this.randn());
      const nozzleSizeLift = 0.3 * (nozzleFactor - 1); // subtle
      const dotR = this.clamp(
        rMin + 0.8 * s + (rNorm - 0.72) * haloR * 0.012 + nozzleSizeLift,
        rMin,
        rMax
      );

      // opacity: knob + edge bias + nozzle + alphaScale (distance falloff)
      let aPix =
        (0.15 + 0.45 * this.oversprayMultiplier) * // 0.025..0.08 base
        (0.75 + 0.5 * rNorm) * // edge brighter
        (0.9 + 0.2 * (nozzleFactor - 1)) * // bigger cap → stronger
        (0.85 + 0.3 * Math.random()) * // jitter
        alphaScale; // falls with distance

      aPix = this.clamp(aPix, 0.018, 0.14);

      // rare larger flecks at high overspray
      let R = dotR;
      if (this.oversprayMultiplier > 0.8 && Math.random() < 0.1) {
        R = Math.min(dotR * (1.4 + 0.6 * Math.random()), rMax * 1.15);
        aPix = Math.min(aPix * 1.2, 0.16);
      }

      const brush = this.getBrush(R);
      this.ctx.globalAlpha = aPix;
      this.ctx.drawImage(brush, ox - R, oy - R);
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
      const cx = (x / this.bufScale) | 0, cy = (y / this.bufScale) | 0;

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

    // tighter requirements when moving slowly
    const slowFactor = speed < this.V_SLOW ? this.V_SLOW / Math.max(20, speed) : 1;
    const needCenter = this.DRIP_THRESHOLD * Math.min(1.5, slowFactor);
    const needPool   = this.NBR_MIN * Math.min(1.5, slowFactor);
    if (centerWet < needCenter || pool < needPool) return;

    // merge with nearby drip
    for (let j = this.drips.length - 1; j >= 0; j--) {
      const d = this.drips[j];
      if (Math.abs(d.x - x) < this.MIN_DRIP_SPACING &&
          Math.abs(d.y - y) < this.MIN_DRIP_SPACING * 0.8) {
            const addVol = Math.min(0.45 * (1 + (pool - this.DRIP_THRESHOLD)), 1.2);
            const addBaseR = Math.max(2.0, d.baseR * 0.92); // treat source as similar scale
            this._mergeIntoDrip(d, addBaseR, addVol);
            this._spawnCooldown[idx] = 10;
            return;
      }
    }

    // drain & capacity check
    this.paintBuf[idx] = Math.max(0, centerWet - this.DRIP_HYST);
    if (this.drips.length >= this.MAX_DRIPS) return;

    // thicker base + moderate volume
    const areaScore = Math.max(0, pool - this.DRIP_THRESHOLD);
    const slowClamp = speed < this.V_SLOW ? 0.75 + 0.25 * (speed / this.V_SLOW) : 1;

    const vol = Math.min(1.6 * slowClamp, 0.6 + 1.2 * areaScore);
    const baseR = Math.max(
      2.1,
      (1.6 + 0.9 * Math.sqrt(areaScore + 0.01) + (this.nozzleSize / 48) * 0.7) * slowClamp
    );

    this.drips.push({
      x, y, px: x, py: y, vy: 0,
      vol, baseR, len: 0, life: 1.0,
    });
    this._spawnCooldown[idx] = 10;

    console.log(
      `SPAWN id=${this.drips.length - 1} @(${x.toFixed(1)},${y.toFixed(1)}) baseR=${baseR.toFixed(2)} vol=${vol.toFixed(2)} pool=${areaScore.toFixed(2)}`
    );
  }

  // time-based update for drips (call every frame)

  // --- 4) _updateDrips(dt) with TRAIL/HEAD/cap & frame max logs ---
  _updateDrips(dt) {
    if (!this.drips.length) return;
  
    const ctx = this.ctx;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "multiply";
  
    let maxTrailSeen = 0;
  
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
  
      // motion
      d.vy += this.GRAVITY * dt * (0.55 + 0.45 * d.vol);
      d.vy *= Math.exp(-this.VISCOSITY * dt);
      d.py = d.y;
      d.y += d.vy * dt;
  
      // small lateral meander
      d.x += (Math.random() - 0.5) * this.LATERAL_SPREAD * (0.6 + 0.6 * d.vol);
  
      const dy = d.y - d.py;
      d.len += Math.abs(dy);
  
      // trail stamps
      const stepPx = 1.0;
      const steps = Math.max(1, Math.floor(Math.abs(dy) / stepPx));
      const aBase = 0.22 * d.vol;
  
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const yy = d.py + dy * t;
  
        // 🔧 shrink growth with length a bit; clamp max spread
        const widen = Math.min(1.12, 1.0 + 0.0015 * d.len);
  
        const capR = this.trailCapFor(d);
        const rawR = d.baseR * (1.08 + 0.60 * d.vol) * Math.min(1.12, 1.0 + 0.0015 * d.len) * (1.0 + 0.10 * t);
        
        // ease down if we overshoot cap (prevents flat-topped disks)
        let drawR = rawR;
        if (rawR >= capR) {
          const overshoot = Math.min(1.0, (rawR - capR) / Math.max(1e-3, capR));
          drawR = capR - (capR * 0.12) * overshoot * overshoot * (2 - overshoot); // cubic ease
          drawR = Math.min(drawR, capR - 0.25); // tiny cushion below cap
        }
        const R = this._safeR(drawR);
        
        if (s === 1) {
          console.log(`TRAIL-START id=${i} baseR=${d.baseR.toFixed(2)} vol=${d.vol.toFixed(2)} len=${d.len.toFixed(1)}`);
          console.log(`TRAIL rawR=${rawR.toFixed(2)} capR=${capR.toFixed(2)} len=${d.len.toFixed(1)}`);
        }
        if (s === steps) {
          console.log(`TRAIL rawR=${rawR.toFixed(2)} capR=${capR.toFixed(2)} len=${d.len.toFixed(1)}`);
        }
        console.log(`TRAIL drawR=${R.toFixed(2)} (t=${t.toFixed(2)})`);
        if (R >= capR - 0.3) console.warn(`NEAR-CAP id=${i} drawR=${R.toFixed(2)} capR=${capR.toFixed(2)}`);
  
        if (s === 1) {
          console.log(
            `TRAIL-START id=${i} baseR=${d.baseR.toFixed(2)} vol=${d.vol.toFixed(2)} len=${d.len.toFixed(1)}`
          );
          console.log(`TRAIL rawR=${rawR.toFixed(2)} capR=${capR.toFixed(2)} len=${d.len.toFixed(1)}`);
        }
        if (s === steps) {
          console.log(`TRAIL rawR=${rawR.toFixed(2)} capR=${capR.toFixed(2)} len=${d.len.toFixed(1)}`);
        }
        console.log(`TRAIL drawR=${R.toFixed(2)} (t=${t.toFixed(2)})`);
  
        if (R > maxTrailSeen) maxTrailSeen = R;
  
        const xx = d.x + (Math.random() - 0.5) * 0.5 * R;
  
        // 🔧 alpha falloff as R approaches cap (prevents cloudy disks)
        const nearCap = R / Math.max(1e-3, capR);
        const falloff = Math.max(0.35, 1 - 0.65 * nearCap * nearCap); // 1 → 0.35 near cap
        const alpha = Math.max(0.05, Math.min(0.2, aBase * (0.7 + 0.5 * t) * falloff));
  
        ctx.globalAlpha = alpha;
        ctx.drawImage(this.getBrush(R), xx - R, yy - R);
  
        this._accumWet(xx, yy, alpha * 0.06);
      }
  
      // head (unchanged, but keep log)
      const Rhead = this.headRadiusFor(d);
      ctx.globalAlpha = Math.min(0.22, 0.16 + 0.10 * d.vol);
      ctx.drawImage(this.getBrush(Rhead), d.x - Rhead, d.y - Rhead);
  
      // life
      d.vol -= (this.DEPOSIT_PER_PX * Math.abs(dy)) / 60 + this.WET_EVAP * dt * 0.45;
      if (d.vol <= 0.06 || d.len > 70 || d.y > this.canvas.height + 5) {
        this.drips.splice(i, 1);
      }
    }
  
    if (maxTrailSeen > 20) {
      console.log(`FRAME maxTrailR=${maxTrailSeen.toFixed(2)}`);
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
    const byBase = d.baseR * 1.6;                 // gentler than 2.4
    const byVol  = 6.0 + 7.5 * Math.sqrt(d.vol);  // grows slowly with vol
    const cap = Math.min(byBase, byVol, this.GLOBAL_TRAIL_CAP);
    if (cap < d.baseR) {
      console.warn(`CAP-LOWERED id? baseR=${d.baseR.toFixed(2)} cap=${cap.toFixed(2)}`);
    }
    return cap;
  }

  headRadiusFor(d) {
    const raw = d.baseR * (1.15 + 0.45 * d.vol);
    const cap = Math.min(this.trailCapFor(d) * 0.9, this.GLOBAL_TRAIL_CAP * 0.9);
    const R = Math.max(1.0, Math.min(raw, cap));
    console.log(`HEAD id=? Rhead=${R.toFixed(2)} baseR=${d.baseR.toFixed(2)} vol=${d.vol.toFixed(2)}`);
    return R;
  }

  _mergeIntoDrip(target, addBaseR, addVol) {
    const oldBase = target.baseR, oldVol = target.vol;
  
    const vol = Math.min(oldVol + addVol, 2.40); // keep your existing 2.4 cap
    const areaMass =
      (oldBase * oldBase) * oldVol +
      (addBaseR * addBaseR) * addVol;
  
    const rEff = Math.sqrt(Math.max(1e-6, areaMass / Math.max(1e-6, vol)));
    const rAvg = 0.5 * (oldBase + addBaseR);
    let newBase = rAvg + this.MERGE_DAMP * (rEff - rAvg);
  
    if (newBase > this.R_BASE_HARD_MAX) {
      console.warn(`MERGE-CLAMP baseR ${newBase.toFixed(2)} → ${this.R_BASE_HARD_MAX.toFixed(2)}`);
      newBase = this.R_BASE_HARD_MAX;
    }
  
    target.vol = vol;
    target.baseR = newBase;
  
    console.log(
      `MERGE into id=? newVol=${vol.toFixed(2)} newBaseR=${newBase.toFixed(2)} (from base=${oldBase.toFixed(2)}, vol=${oldVol.toFixed(2)} + ${addVol.toFixed(2)})`
    );
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
