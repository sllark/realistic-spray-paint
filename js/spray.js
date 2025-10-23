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
    this.nozzleSize = 80;
    this.softness = 0.95; // Maximum softness
    this.opacity = 1.0; // Maximum opacity
    this.flow = 1.1; // Enhanced flow

    // Performance optimization
    this.stampCache = new Map();
    this.lastStampTime = 0;
    this.stampInterval = 0; // No throttling - maximum performance

    // Pressure simulation
    this.pressure = 1.0;
    this.pressureSmoothing = 0.2;

    // Scatter controls
    this.scatterRadiusMultiplier = 1.2; // 120% default - moderate spread
    this.scatterAmountMultiplier = 1.0; // 100% default - full density
    this.scatterSizeMultiplier = 1.5; // 150% default - larger particles

    // Overspray control
    this.oversprayMultiplier = 0.3; // 30% default - moderate overspray
  }

  setColor(color) {
    this.color = color;
  }

  setNozzleSize(size) {
    this.nozzleSize = Math.max(2, Math.min(120, size));
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
    this.oversprayMultiplier = overspray / 100; // Convert percentage to multiplier
  }

  // --- Helper functions for sophisticated grain control ---
  randn() {
    // Box–Muller transform for normal distribution
    let u = 1 - Math.random(),
      v = 1 - Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
  }

  calculateGrainSize(baseRadius, size) {
    // Base controls
    const distance = 12; // Default distance in pixels
    const pressure = this.pressure || 0.7; // Current pressure (0..1)

    // --- grain size: log-normal with gentle caps ---
    const mu = 0.0; // median multiplier ~ e^mu = 1.0
    const sigma = 0.35; // spread; 0.3–0.5 feels good
    let sizeFactor = Math.exp(mu + sigma * this.randn());

    // occasional large splats (1–2%)
    if (Math.random() < 0.02) sizeFactor *= 1.8 + Math.random() * 1.2;

    // map to environment: farther distance → larger blur footprint; high pressure → finer grain
    sizeFactor *= (distance / 15) * (1 / Math.sqrt(pressure + 0.2));

    // cap extremes so it doesn't go crazy
    sizeFactor = this.clamp(sizeFactor, 0.35, 2.2);

    // final pixel radius (keep a floor so AA doesn't swallow tiny dots)
    return Math.max(0.5, baseRadius * sizeFactor);
  }

  calculateGrainOpacity(baseOpacity, sizeFactor) {
    // --- opacity: slight positive correlation with size, but with plateau ---
    const sizeOpacityBoost = this.clamp(
      0.6 + 0.5 * Math.sqrt(sizeFactor),
      0.5,
      1.25
    );
    // per-dot jitter so it's not flat
    const jitter = 0.85 + Math.random() * 0.25; // 0.85–1.10
    let dotOpacity = baseOpacity * sizeOpacityBoost * jitter;

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

    console.log(
      `🎨 Base Line: distance=${distance.toFixed(
        1
      )}, stamps=${numStamps}, stampDist=${stampDistance.toFixed(
        2
      )}, size=${effectiveSize.toFixed(1)}`
    );

    // Create continuous line with overlapping stamps
    for (let i = 0; i <= numStamps; i++) {
      const t = i / numStamps;
      const stampX = startX + (endX - startX) * t;
      const stampY = startY + (endY - startY) * t;

      // Add some randomness for natural spray effect
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;

      console.log(
        `📍 Base stamp ${i + 1}/${numStamps + 1}: t=${t.toFixed(3)} pos=(${(
          stampX + jitterX
        ).toFixed(1)},${(stampY + jitterY).toFixed(1)})`
      );

      this.stamp(stampX + jitterX, stampY + jitterY);
    }

    // Smart gap filling for fast movement
    this.fillGapsForFastMovement(
      startX,
      startY,
      endX,
      endY,
      distance,
      effectiveSize
    );
  }

  fillGapsForFastMovement(startX, startY, endX, endY, distance, effectiveSize) {
    // Calculate optimal stamp density based on movement speed
    const speedRatio = distance / effectiveSize;

    console.log(
      `🔍 Gap Analysis: dist=${distance.toFixed(
        1
      )}, size=${effectiveSize.toFixed(1)}, speed=${speedRatio.toFixed(
        2
      )}, from=(${startX.toFixed(1)},${startY.toFixed(1)}) to=(${endX.toFixed(
        1
      )},${endY.toFixed(1)})`
    );

    if (speedRatio > 1.5) {
      // Fast movement - use intelligent gap filling
      const gapSize = effectiveSize * 0.2;
      const numGaps = Math.floor(distance / gapSize);

      console.log(
        `⚡ Fast Movement: gapSize=${gapSize.toFixed(
          1
        )}, numGaps=${numGaps}, adding=${numGaps} stamps`
      );

      // Fill gaps with systematic stamps
      for (let i = 0; i < numGaps; i++) {
        const t = (i + 0.5) / numGaps;
        const stampX = startX + (endX - startX) * t;
        const stampY = startY + (endY - startY) * t;

        // Add slight randomness for natural effect
        const jitterX = (Math.random() - 0.5) * 2;
        const jitterY = (Math.random() - 0.5) * 2;

        console.log(
          `📍 Gap stamp ${i + 1}/${numGaps}: t=${t.toFixed(3)} pos=(${(
            stampX + jitterX
          ).toFixed(1)},${(stampY + jitterY).toFixed(1)})`
        );

        this.stamp(stampX + jitterX, stampY + jitterY);
      }
    }

    if (speedRatio > 3.0) {
      // Very fast movement - add extra coverage
      const extraDensity = Math.floor(speedRatio);

      console.log(
        `🚀 Very Fast: extraDensity=${extraDensity}, adding=${extraDensity} extra stamps`
      );

      for (let i = 0; i < extraDensity; i++) {
        const t = Math.random();
        const stampX = startX + (endX - startX) * t;
        const stampY = startY + (endY - startY) * t;

        const jitterX = (Math.random() - 0.5) * 3;
        const jitterY = (Math.random() - 0.5) * 3;

        console.log(
          `📍 Extra stamp ${i + 1}/${extraDensity}: t=${t.toFixed(3)} pos=(${(
            stampX + jitterX
          ).toFixed(1)},${(stampY + jitterY).toFixed(1)})`
        );

        this.stamp(stampX + jitterX, stampY + jitterY);
      }
    }

    if (speedRatio > 5.0) {
      // Extremely fast movement - maximum coverage
      const maxStamps = Math.floor(distance / (effectiveSize * 0.1));

      console.log(
        `💨 Ultra Fast: maxStamps=${maxStamps}, adding=${maxStamps} ultra stamps`
      );

      for (let i = 0; i < maxStamps; i++) {
        const t = Math.random();
        const stampX = startX + (endX - startX) * t;
        const stampY = startY + (endY - startY) * t;

        const jitterX = (Math.random() - 0.5) * 4;
        const jitterY = (Math.random() - 0.5) * 4;

        console.log(
          `📍 Ultra stamp ${i + 1}/${maxStamps}: t=${t.toFixed(3)} pos=(${(
            stampX + jitterX
          ).toFixed(1)},${(stampY + jitterY).toFixed(1)})`
        );

        this.stamp(stampX + jitterX, stampY + jitterY);
      }
    }

    if (speedRatio <= 1.5) {
      console.log(`🐌 Slow Movement - No extra stamps needed`);
    }
  }

  stamp(x, y) {
    const now = Date.now();
    if (now - this.lastStampTime < this.stampInterval) {
      return;
    }
    this.lastStampTime = now;

    const effectiveSize = this.nozzleSize * (0.8 + this.pressure * 0.4);

    // Create noisy path with individual dots instead of solid stamps
    this.createNoisyPath(x, y, effectiveSize);
  }

  createNoisyPath(x, y, size) {
    // Calculate number of dots based on size, flow, and scatter amount - ultra dense granular effect
    const numDots = Math.floor(
      size * 15.0 * this.flow * this.scatterAmountMultiplier
    ); // Maximum density dots with scatter control
    const dotRadius = Math.max(0.1, size * 0.005 * this.scatterSizeMultiplier); // Ultra tiny dots with scatter size control

    this.ctx.save();
    this.ctx.fillStyle = this.color;
    this.ctx.globalAlpha = this.opacity;

    // Main spray area dots
    for (let i = 0; i < numDots; i++) {
      // Create uniform circular distribution (no center bias)
      const scatterRadius = size * 0.4 * this.scatterRadiusMultiplier; // Apply scatter radius multiplier
      const angle = Math.random() * Math.PI * 2; // Random angle
      const distance = Math.sqrt(Math.random()) * scatterRadius; // Square root for uniform area distribution
      const dotX = x + Math.cos(angle) * distance;
      const dotY = y + Math.sin(angle) * distance;

      // Use sophisticated grain control system
      const randomSize = this.calculateGrainSize(dotRadius, size);
      const dotOpacity = this.calculateGrainOpacity(
        this.opacity,
        randomSize / dotRadius
      );

      // Set individual dot opacity
      this.ctx.globalAlpha = dotOpacity;

      // Draw individual dot
      this.ctx.beginPath();
      this.ctx.arc(dotX, dotY, randomSize, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Add overspray effect - excess paint that spreads beyond the main area
    this.addOverspray(x, y, size);

    this.ctx.restore();
  }

  addOverspray(x, y, size) {
    // Skip overspray if multiplier is 0
    if (this.oversprayMultiplier <= 0) return;

    // Overspray settings - excess paint that spreads beyond the main spray area
    const oversprayRadius = size * 0.8; // Overspray extends beyond main spray
    const oversprayDensity = 0.3 * this.oversprayMultiplier; // Use overspray multiplier
    const numOversprayDots = Math.floor(
      size * 4.0 * this.flow * this.scatterAmountMultiplier * oversprayDensity
    );
    const oversprayDotRadius = Math.max(
      0.05,
      size * 0.003 * this.scatterSizeMultiplier
    ); // Smaller than main dots
    const oversprayOpacity = this.opacity * 0.4 * this.oversprayMultiplier; // Use overspray multiplier for opacity

    this.ctx.globalAlpha = oversprayOpacity;

    for (let i = 0; i < numOversprayDots; i++) {
      // Create overspray in a larger radius around the main spray
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * oversprayRadius;
      const dotX = x + Math.cos(angle) * distance;
      const dotY = y + Math.sin(angle) * distance;

      // Skip dots that are too close to the center (main spray area)
      const distanceFromCenter = Math.sqrt((dotX - x) ** 2 + (dotY - y) ** 2);
      if (distanceFromCenter < size * 0.3) {
        continue; // Skip dots in the main spray area
      }

      // Use sophisticated grain control for overspray too
      const randomSize = this.calculateGrainSize(oversprayDotRadius, size);
      const dotOversprayOpacity = this.calculateGrainOpacity(
        oversprayOpacity,
        randomSize / oversprayDotRadius
      );

      // Set individual overspray dot opacity
      this.ctx.globalAlpha = dotOversprayOpacity;

      // Draw overspray dot
      this.ctx.beginPath();
      this.ctx.arc(dotX, dotY, randomSize, 0, Math.PI * 2);
      this.ctx.fill();
    }
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
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
