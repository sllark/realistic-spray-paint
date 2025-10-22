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
    this.nozzleSize = 10;
    this.softness = 0.85; // More subtle softness
    this.opacity = 0.8; // More subtle opacity
    this.flow = 0.85; // More subtle flow
    this.dripsEnabled = false;

    // Drip system
    this.dripThreshold = 35;
    this.dripSpeed = 5;
    this.dripAccumulator = 0;
    this.dripGrid = null;
    this.dripFunctions = [];

    // Performance optimization
    this.stampCache = new Map();
    this.lastStampTime = 0;
    this.stampInterval = 0; // No throttling - maximum performance

    // Pressure simulation
    this.pressure = 1.0;
    this.pressureSmoothing = 0.2;

    // Scatter controls
    this.scatterRadiusMultiplier = 1.61; // 161% default - more subtle spread
    this.scatterAmountMultiplier = 0.8; // 80% default - more subtle density
    this.scatterSizeMultiplier = 1; // 100% default - smaller particles
  }

  setColor(color) {
    this.color = color;
  }

  setNozzleSize(size) {
    this.nozzleSize = Math.max(6, Math.min(60, size));
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

  setDripsEnabled(enabled) {
    this.dripsEnabled = enabled;
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

  startDrawing(x, y, pressure = 1.0) {
    this.isDrawing = true;
    this.lastX = x;
    this.lastY = y;
    this.currentX = x;
    this.currentY = y;
    this.pressure = pressure;
    this.dripAccumulator = 0;
    this.dripPoints = [];
    this.lastDripTime = Date.now();

    // Add initial spray burst effect for natural start
    this.addSprayBurst(x, y);
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

    // Update drip accumulator
    if (this.dripsEnabled) {
      this.dripAccumulator += distance;
      this.updateDrips(x, y);
      this.updateDripFunctions();
    }

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
      console.log(
        `⏰ Stamp throttled: ${now - this.lastStampTime}ms since last stamp`
      );
      return;
    }
    this.lastStampTime = now;

    // Calculate effective size based on pressure
    const effectiveSize = this.nozzleSize * (0.8 + this.pressure * 0.4);
    const effectiveOpacity = this.opacity * (0.9 + this.pressure * 0.1);

    // Create or get cached stamp
    const cacheKey = `${Math.floor(effectiveSize)}_${Math.floor(
      this.softness * 100
    )}`;
    let stampCanvas = this.stampCache.get(cacheKey);

    if (!stampCanvas) {
      stampCanvas = this.createStamp(effectiveSize);
      this.stampCache.set(cacheKey, stampCanvas);
    }

    // Apply stamp with flow and opacity
    this.ctx.globalAlpha = effectiveOpacity * this.flow;
    this.ctx.drawImage(
      stampCanvas,
      x - effectiveSize / 2,
      y - effectiveSize / 2
    );

    // Add additional random specks for more visible scatter effect
    this.addRandomSpecks(x, y, effectiveSize);

    this.ctx.globalAlpha = 1.0;
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

  updateDrips(x, y) {
    if (!this.dripsEnabled) return;

    // Convert to grid coordinates
    const gridX = Math.floor(x / this.nozzleSize);
    const gridY = Math.floor(y / this.nozzleSize);

    // Ensure grid exists
    if (!this.dripGrid) {
      this.initializeDripGrid();
    }

    // Check bounds
    if (
      gridX >= 0 &&
      gridX < this.dripGrid.length &&
      gridY >= 0 &&
      gridY < this.dripGrid[gridX].length
    ) {
      const drip = this.dripGrid[gridX][gridY];
      drip.count += this.nozzleSize;

      if (drip.count >= this.dripThreshold) {
        drip.drips = true;
        drip.width = this.nozzleSize;
        this.dripAt(gridX, gridY, drip);
      }
    }
  }

  initializeDripGrid() {
    const gridWidth = Math.ceil(this.canvas.width / this.nozzleSize);
    const gridHeight = Math.ceil(this.canvas.height / this.nozzleSize);

    this.dripGrid = [];
    this.dripFunctions = [];

    for (let x = 0; x < gridWidth; x++) {
      this.dripGrid[x] = [];
      for (let y = 0; y < gridHeight; y++) {
        this.dripGrid[x][y] = {
          count: 0,
          drips: false,
          width: 0,
          dripSpeed: this.dripSpeed,
        };
      }
    }
  }

  dripAt(gridX, gridY, initialDrip) {
    const maxY = this.dripGrid[gridX].length - 1;
    this.dripFunctions.push(
      this.createDripFunctionFor(maxY, gridX, gridY, initialDrip)
    );
  }

  createDripFunctionFor(maxY, gridX, gridY, myDrip) {
    return (idx) => {
      if (myDrip.count <= 0) {
        myDrip.count = 0;
        this.dripFunctions.splice(idx, 1);
        return;
      }

      if (gridY < maxY) {
        myDrip.dripSpeed = Math.max(1, myDrip.dripSpeed - myDrip.width);

        if (myDrip.dripSpeed === 1) {
          const deltaWidth = Math.floor(Math.random() * 3) - 1;
          const deltaX = Math.floor(Math.random() * 3) - 1;

          // Move drip to next step
          const nextY = gridY + 1;
          const otherDrip = this.dripGrid[gridX][nextY];

          if (!otherDrip.drips) {
            otherDrip.drips = true;
            myDrip.count = myDrip.count - myDrip.width;
          }

          otherDrip.count += myDrip.count;
          otherDrip.width = Math.max(
            Math.max(1, myDrip.width + deltaWidth),
            otherDrip.width
          );

          // Draw drip line
          this.drawDripLine(
            gridX * this.nozzleSize,
            gridY * this.nozzleSize,
            gridX * this.nozzleSize + deltaX,
            nextY * this.nozzleSize,
            myDrip.width
          );

          myDrip.count = 0;
          myDrip = otherDrip;
          gridY = nextY;
        } else {
          myDrip.count = myDrip.count + this.nozzleSize;
        }

        this.dripFunctions.splice(
          idx,
          1,
          this.createDripFunctionFor(maxY, gridX, gridY, myDrip)
        );
      }
    };
  }

  drawDripLine(x1, y1, x2, y2, width) {
    this.ctx.save();
    this.ctx.strokeStyle = this.color;
    this.ctx.lineWidth = width;
    this.ctx.lineCap = "round";
    this.ctx.globalAlpha = 0.8;

    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
    this.ctx.restore();
  }

  updateDripFunctions() {
    if (!this.dripsEnabled || this.dripFunctions.length === 0) return;

    // Update all active drip functions (reverse iteration for safe removal)
    for (let i = this.dripFunctions.length - 1; i >= 0; i--) {
      try {
        this.dripFunctions[i](i);
      } catch (error) {
        // Remove invalid drip functions
        this.dripFunctions.splice(i, 1);
      }
    }
  }

  stopDrawing() {
    this.isDrawing = false;
    this.dripAccumulator = 0;
    // Clear drip functions when stopping
    this.dripFunctions = [];

    // Add final spray burst effect for natural end
    this.addSprayBurst(this.currentX, this.currentY);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.dripFunctions = [];
    this.dripGrid = null;
    this.dripAccumulator = 0;
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

  addSprayBurst(x, y) {
    const effectiveSize = this.nozzleSize * (0.8 + this.pressure * 0.4);
    const burstRadius = effectiveSize * 0.5; // Smaller burst radius
    const numBurstStamps = Math.floor(effectiveSize * 0.6); // Fewer burst stamps

    // Create subtle circular burst pattern for natural spray start/end
    for (let i = 0; i < numBurstStamps; i++) {
      const angle = (i / numBurstStamps) * Math.PI * 2;
      const distance = Math.random() * burstRadius;
      const burstX = x + Math.cos(angle) * distance;
      const burstY = y + Math.sin(angle) * distance;

      // Add subtle randomness to the burst
      const jitterX = (Math.random() - 0.5) * 2;
      const jitterY = (Math.random() - 0.5) * 2;

      this.stamp(burstX + jitterX, burstY + jitterY);
    }

    // Add center stamp for subtle density
    this.stamp(x, y);
  }
}
