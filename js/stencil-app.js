class StencilApp {
  constructor() {
    this.paintCanvas = document.getElementById("paintCanvas");
    this.paintCtx = this.paintCanvas.getContext("2d");
    this.strokeCanvas = document.getElementById("strokeCanvas");
    this.strokeCtx = this.strokeCanvas.getContext("2d");
    this.guideCanvas = document.getElementById("guideCanvas");
    this.guideCtx = this.guideCanvas.getContext("2d");

    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.instances = []; // placed stencil instances
    this.selectedIds = new Set();
    this.activePointerId = null;
    this.draggingInstanceId = null;
    this.dragStart = null;
    this.interactionMode = null; // 'move' | 'scale' | 'rotate'
    this.gesture = null; // gesture state for transforms
    this.clipToStencil = true; // when true, cleanup outside; when false, keep overspray
    this._stageCanvases = []; // for cursor updates
    this._rotateCursorUrl = null; // cached custom cursor for rotate
    this._compositeLoopRunning = false;
    this.rotateIcon = new Image();
    this.rotateIconLoaded = false;
    const srcs = ["assets/rotate.png"];
    const tryLoad = (i = 0) => {
      if (i >= srcs.length) return;
      this.rotateIcon.onload = () => (this.rotateIconLoaded = true);
      this.rotateIcon.onerror = () => tryLoad(i + 1);
      this.rotateIcon.src = srcs[i];
    };
    tryLoad();

    // Create spray tool (will be rebuilt on first resize to sync buffers)
    this.spray = new SprayPaint(this.strokeCanvas, this.strokeCtx);
    this.spray.setColor("#221F20");
    this.spray.setNozzleSize(25);
    this.spray.startDripLoop();
    this.spray.getDripCompositeMode = () => "source-over";

    // External PNG assets
    this.assetDefs = {
      girl: "assets/GIRL.png",
      heart: "assets/heart.png",
      "heart-string": "assets/heart-string.png",
    };
    // Per-asset pass preference for paper-background scans:
    // 'dark' → dark ink passes (spray shows where dark), 'light' → light passes, 'auto' → decide by center
    this.assetPassPreference = {
      heart: "dark",
      "heart-string": "dark",
      girl: "dark",
    };
    this.assetBitmaps = {}; // key -> canvas with image drawn

    this.resize = this.resize.bind(this);
    this.onTrayPointerDown = this.onTrayPointerDown.bind(this);
    this.onStagePointerDown = this.onStagePointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.init();
  }

  async init() {
    window.addEventListener("resize", this.resize);
    this.resize();

    // Preload PNGs
    await this.loadAssets();

    // If there are no instances yet, drop initial stencils on the canvas
    this.spawnInitialStencils();

    // Wire tray interactions
    document
      .getElementById("stencilTray")
      .addEventListener("pointerdown", this.onTrayPointerDown);

    // Stage interactions
    const layers = [this.guideCanvas, this.strokeCanvas, this.paintCanvas];
    this._stageCanvases = layers;
    layers.forEach((c) => {
      c.addEventListener("pointerdown", this.onStagePointerDown);
      c.addEventListener("pointermove", this.onPointerMove);
      c.addEventListener("pointerup", this.onPointerUp);
      c.addEventListener("pointercancel", this.onPointerUp);
      c.addEventListener("pointerleave", this.onPointerUp);
    });

    // Controls (HUD buttons optional; main panel has clearBtn/exportBtn)
    const clearPaintBtn = document.getElementById("clearPaint");
    if (clearPaintBtn) {
      clearPaintBtn.addEventListener("click", () => {
        this.paintCtx.clearRect(
          0,
          0,
          this.paintCanvas.width,
          this.paintCanvas.height
        );
        this.redrawGuides();
      });
    }
    const exportPNGBtn = document.getElementById("exportPNG");
    if (exportPNGBtn) {
      exportPNGBtn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.download = "stencil-art.png";
        a.href = this.paintCanvas.toDataURL("image/png");
        a.click();
      });
    }
    const clipBtn = document.getElementById("clipToggle");
    if (clipBtn) {
      clipBtn.addEventListener("click", () => {
        this.clipToStencil = !this.clipToStencil;
        clipBtn.textContent = `Clip: ${this.clipToStencil ? "On" : "Off"}`;
      });
    }

    // --- Color & Drip controls wiring (match index.html IDs) ---
    const colorPicker = document.getElementById("colorPicker");
    const goldBtn = document.getElementById("goldColorBtn");
    const blackBtn = document.getElementById("blackColorBtn");
    const presetButtons = Array.from(
      document.querySelectorAll(".color-preset-btn")
    );
    const setActivePreset = (btn) => {
      if (!presetButtons.length) return;
      presetButtons.forEach((b) => b.classList.remove("active"));
      if (btn) btn.classList.add("active");
    };
    if (colorPicker) {
      colorPicker.addEventListener("input", (e) => {
        const v = e.target.value;
        this.spray.setColor(v);
        // Custom color – clear preset active state
        setActivePreset(null);
      });
    }
    if (goldBtn) {
      goldBtn.addEventListener("click", () => {
        this.spray.setColor("#EAC677");
        if (colorPicker) colorPicker.value = "#EAC677";
        setActivePreset(goldBtn);
      });
    }
    if (blackBtn) {
      blackBtn.addEventListener("click", () => {
        this.spray.setColor("#221F20");
        if (colorPicker) colorPicker.value = "#221F20";
        setActivePreset(blackBtn);
      });
    }

    // Panel Clear / Export
    const panelClearBtn = document.getElementById("clearBtn");
    if (panelClearBtn) {
      panelClearBtn.addEventListener("click", () => {
        this.paintCtx.clearRect(
          0,
          0,
          this.paintCanvas.width,
          this.paintCanvas.height
        );
        this.strokeCtx.clearRect(
          0,
          0,
          this.strokeCanvas.width,
          this.strokeCanvas.height
        );
        this.redrawGuides();
      });
    }
    const panelExportBtn = document.getElementById("exportBtn");
    if (panelExportBtn) {
      panelExportBtn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.download = "stencil-art.png";
        a.href = this.paintCanvas.toDataURL("image/png");
        a.click();
      });
    }

    const dripToggleBtn = document.getElementById("dripToggleBtn");
    if (dripToggleBtn) {
      dripToggleBtn.addEventListener("click", () => {
        const enabled = this.spray.toggleDrips();
        dripToggleBtn.textContent = enabled ? "Disable Drips" : "Enable Drips";
        dripToggleBtn.style.backgroundColor = enabled ? "#4CAF50" : "#f44336";
      });
    }
    const dripThresholdSlider = document.getElementById("dripThresholdSlider");
    const dripGravitySlider = document.getElementById("dripGravitySlider");
    const dripViscositySlider = document.getElementById("dripViscositySlider");
    const dripEvaporationSlider = document.getElementById(
      "dripEvaporationSlider"
    );
    if (dripThresholdSlider)
      dripThresholdSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setDripThreshold(v);
        setText("dripThresholdValue", v + "%");
      });
    if (dripGravitySlider)
      dripGravitySlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setDripGravity(v);
        setText("dripGravityValue", String(v));
      });
    if (dripViscositySlider)
      dripViscositySlider.addEventListener("input", (e) => {
        const v = parseFloat(e.target.value);
        this.spray.setDripViscosity(v);
        setText("dripViscosityValue", v.toFixed(1));
      });
    if (dripEvaporationSlider)
      dripEvaporationSlider.addEventListener("input", (e) => {
        const v = parseFloat(e.target.value);
        this.spray.setDripEvaporation(v);
        setText("dripEvaporationValue", (v / 100).toFixed(2));
      });

    // --- Core spray controls ---
    const nozzleSlider = document.getElementById("nozzleSlider");
    const softnessSlider = document.getElementById("softnessSlider");
    const opacitySlider = document.getElementById("opacitySlider");
    const flowSlider = document.getElementById("flowSlider");
    const scatterRadiusSlider = document.getElementById("scatterRadiusSlider");
    const scatterAmountSlider = document.getElementById("scatterAmountSlider");
    const scatterSizeSlider = document.getElementById("scatterSizeSlider");
    const overspraySlider = document.getElementById("overspraySlider");
    const distanceSlider = document.getElementById("distanceSlider");

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    if (nozzleSlider)
      nozzleSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setNozzleSize(v);
        setText("nozzleValue", String(v));
      });
    if (softnessSlider)
      softnessSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setSoftness(v);
        setText("softnessValue", v + "%");
      });
    if (opacitySlider)
      opacitySlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setOpacity(v);
        setText("opacityValue", v + "%");
      });
    if (flowSlider)
      flowSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setFlow(v);
        setText("flowValue", v + "%");
      });
    if (scatterRadiusSlider)
      scatterRadiusSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setScatterRadius(v);
        setText("scatterRadiusValue", v + "%");
      });
    if (scatterAmountSlider)
      scatterAmountSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setScatterAmount(v);
        setText("scatterAmountValue", v + "%");
      });
    if (scatterSizeSlider)
      scatterSizeSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setScatterSize(v);
        setText("scatterSizeValue", v + "%");
      });
    if (overspraySlider)
      overspraySlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setOverspray(v);
        setText("oversprayValue", v + "%");
      });
    if (distanceSlider)
      distanceSlider.addEventListener("input", (e) => {
        const v = parseInt(e.target.value);
        this.spray.setDistance(v);
        setText("distanceValue", v + "px");
      });

    // Apply initial values from panel (if present)
    if (colorPicker) this.spray.setColor(colorPicker.value);
    if (nozzleSlider) this.spray.setNozzleSize(parseInt(nozzleSlider.value));
    if (softnessSlider) this.spray.setSoftness(parseInt(softnessSlider.value));
    if (opacitySlider) this.spray.setOpacity(parseInt(opacitySlider.value));
    if (flowSlider) this.spray.setFlow(parseInt(flowSlider.value));
    if (scatterRadiusSlider)
      this.spray.setScatterRadius(parseInt(scatterRadiusSlider.value));
    if (scatterAmountSlider)
      this.spray.setScatterAmount(parseInt(scatterAmountSlider.value));
    if (scatterSizeSlider)
      this.spray.setScatterSize(parseInt(scatterSizeSlider.value));
    if (overspraySlider)
      this.spray.setOverspray(parseInt(overspraySlider.value));
    if (distanceSlider) this.spray.setDistance(parseInt(distanceSlider.value));
    if (dripThresholdSlider)
      this.spray.setDripThreshold(parseInt(dripThresholdSlider.value));
    if (dripGravitySlider)
      this.spray.setDripGravity(parseInt(dripGravitySlider.value));
    if (dripViscositySlider)
      this.spray.setDripViscosity(parseFloat(dripViscositySlider.value));
    if (dripEvaporationSlider)
      this.spray.setDripEvaporation(parseFloat(dripEvaporationSlider.value));

    this.redrawGuides();

    // Begin background composite loop for drips
    this.startCompositeLoop();

    // Make sure drips are enabled by default
    this.spray.dripsEnabled = true;
    // Slightly more permissive defaults to see drips easier
    this.spray.setDripThreshold(55);
    this.spray.setFlow(120);
  }

  // Rebuild SprayPaint when canvas size changes so internal buffers match
  rebuildSpray() {
    const old = this.spray;
    const s = new SprayPaint(this.strokeCanvas, this.strokeCtx);
    // Carry over settings if previous exists
    if (old) {
      try {
        s.setColor(old.color);
        s.setNozzleSize(old.nozzleSize);
        s.setSoftness(Math.round((old.softness || 0.95) * 100));
        s.setOpacity(Math.round((old.opacity || 1.0) * 100));
        s.setFlow(Math.round((old.flow || 1.0) * 100));
        s.setScatterRadius(
          Math.round((old.scatterRadiusMultiplier || 2.0) * 100)
        );
        s.setScatterAmount(
          Math.round((old.scatterAmountMultiplier || 1.0) * 100)
        );
        s.setScatterSize(Math.round((old.scatterSizeMultiplier || 1.5) * 100));
        s.setOverspray(Math.round((old.oversprayMultiplier || 1.0) * 100));
        s.setDistance(old.distance || 6);
        s.setDripThreshold(Math.round((old.DRIP_THRESHOLD || 0.55) * 100));
        s.setDripGravity(old.GRAVITY || 1580);
        s.setDripViscosity(old.VISCOSITY || 4.2);
        s.setDripEvaporation(Math.round((old.WET_EVAP || 0.26) * 100));
        s.dripsEnabled = old.dripsEnabled !== false;
      } catch (_) {}
    }
    s.startDripLoop();
    s.getDripCompositeMode = () => "source-over";
    this.spray = s;
  }

  // Periodically composites strokeCanvas → paintCanvas so drips are baked in
  startCompositeLoop() {
    if (this._compositeLoopRunning) return;
    this._compositeLoopRunning = true;
    const tick = () => {
      try {
        const hasDrips =
          this.spray &&
          Array.isArray(this.spray.drips) &&
          this.spray.drips.length > 0;
        // Only bake drips when user is NOT actively drawing to avoid "endpoint dot" artifacts
        if (hasDrips && this.spray && !this.spray.isDrawing) {
          this.compositeStroke();
          // Clear the stroke layer after baking so next drip frame draws fresh
          this.strokeCtx.clearRect(
            0,
            0,
            this.strokeCanvas.width,
            this.strokeCanvas.height
          );
        }
      } catch (e) {
        // ignore
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Place initial stencils on the canvas so users can start dragging/spraying immediately
  spawnInitialStencils() {
    if (this.instances.length) return;
    const stageW = this.guideCanvas.width / this.dpr;
    const stageH = this.guideCanvas.height / this.dpr;

    // Smaller, Banksy-like initial sizes per asset (based on stage height)
    const defs = this.assetBitmaps;
    if (!defs) return;

    // Target heights as a fraction of the stage for consistent visual balance
    const targetH = {
      girl: Math.max(90, stageH * 0.38),
      heart: Math.max(60, stageH * 0.2),
      "heart-string": Math.max(80, stageH * 0.26),
    };

    // Compute scales from bitmap heights
    const scaleFor = (key) => {
      const bmp = defs[key];
      if (!bmp) return undefined;
      return Math.min(
        1,
        (targetH[key] || stageH * 0.25) / Math.max(1, bmp.height)
      );
    };

    // Positions: girl left-center vertically, heart near top, string below heart
    const girlX = stageW * 0.44;
    const girlY = stageH * 0.55;

    const heartX = stageW * 0.68;
    const heartY = stageH * 0.19;

    // Place string below heart using heart's target height for spacing
    const stringX = heartX - 70;
    const stringY = heartY + (targetH.heart || 0);

    if (defs.girl) this.addInstance("girl", girlX, girlY, scaleFor("girl"));
    if (defs.heart) {
      const sHeart = scaleFor("heart");
      this.addInstance(
        "heart",
        heartX,
        heartY,
        Math.max(0.05, (sHeart || 0.1) * 0.65)
      );
    }
    if (defs["heart-string"]) {
      const sStr = scaleFor("heart-string");
      this.addInstance(
        "heart-string",
        stringX,
        stringY,
        Math.max(0.05, (sStr || 0.1) * 0.55)
      );
    }

    // Keep only the last one selected for clarity
    if (this.instances.length)
      this.selectOnly(this.instances[this.instances.length - 1].id);
  }

  async loadAssets() {
    const entries = Object.entries(this.assetDefs);
    await Promise.all(
      entries.map(
        ([key, url]) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
              const c = document.createElement("canvas");
              c.width = img.naturalWidth || img.width;
              c.height = img.naturalHeight || img.height;
              const g = c.getContext("2d");
              g.clearRect(0, 0, c.width, c.height);
              g.drawImage(img, 0, 0);
              this.assetBitmaps[key] = c; // store as canvas for consistent API
              resolve();
            };
            img.onerror = reject;
            img.src = url;
          })
      )
    );
  }

  resize() {
    const rect = this.paintCanvas.parentElement.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(400, rect.height);
    [this.paintCanvas, this.strokeCanvas, this.guideCanvas].forEach((c) => {
      const wasW = c.width,
        wasH = c.height;
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      c.style.width = w + "px";
      c.style.height = h + "px";
      const g = c.getContext("2d");
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (c === this.paintCanvas && (wasW || wasH)) {
        // keep background color by filling; content is not preserved on resize
        g.fillStyle = getComputedStyle(document.body).backgroundColor;
        g.fillRect(0, 0, w, h);
      }
    });
    // Reset spray tool so its internal buffers match new canvas size
    this.rebuildSpray();
    this.redrawGuides();
  }

  // Add a stencil instance
  addInstance(assetKey, x, y, scaleOverride) {
    const id = Math.random().toString(36).slice(2);
    const bitmap = this.assetBitmaps[assetKey];
    if (!bitmap) return;
    // Default scale so the instance isn't huge on mobile
    const stageW = this.guideCanvas.width / this.dpr;
    const stageH = this.guideCanvas.height / this.dpr;
    const maxTarget = Math.max(100, Math.min(stageW, stageH) * 0.22);
    const baseMax = Math.max(bitmap.width, bitmap.height);
    const defaultScale =
      scaleOverride !== undefined
        ? scaleOverride
        : Math.min(1, maxTarget / Math.max(1, baseMax));
    const inst = {
      id,
      assetKey,
      bitmap,
      x,
      y,
      scale: defaultScale,
      rotation: 0,
      maskCanvas: null,
    };
    inst.maskCanvas = this.buildMaskCanvas(inst);
    this.instances.push(inst);
    this.selectOnly(inst.id);
    this.redrawGuides();
  }

  buildMaskCanvas(inst) {
    const src = inst.bitmap;
    const w = src.width,
      h = src.height;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.clearRect(0, 0, w, h);
    // draw source alpha as white opaque (no rotation baked into mask)
    g.globalCompositeOperation = "source-over";
    g.drawImage(src, 0, 0);
    // Build mask where WHITE=let paint through (pass), TRANSPARENT=block
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;

    // Detect background: sample 4 corners to see if they are opaque "paper" white
    const sample = (x, y) => {
      const i = (y * w + x) * 4;
      const r = d[i],
        gg = d[i + 1],
        b = d[i + 2],
        a = d[i + 3];
      const l = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
      return { l, a };
    };
    const cs = [
      sample(0, 0),
      sample(w - 1, 0),
      sample(0, h - 1),
      sample(w - 1, h - 1),
    ];
    const avgL = cs.reduce((s, v) => s + v.l, 0) / cs.length;
    const avgA = cs.reduce((s, v) => s + v.a, 0) / cs.length;
    const likelyPaperWhite = avgA > 240 && avgL > 0.85; // opaque bright bg
    // center luminance to decide whether the shape is dark-on-white or light-on-white
    const centerSamples = [
      sample((w / 2) | 0, (h / 2) | 0),
      sample((w * 0.5) | 0, (h * 0.35) | 0),
      sample((w * 0.5) | 0, (h * 0.65) | 0),
      sample((w * 0.35) | 0, (h * 0.5) | 0),
      sample((w * 0.65) | 0, (h * 0.5) | 0),
    ];
    const centerL =
      centerSamples.reduce((s, v) => s + v.l, 0) / centerSamples.length;

    if (likelyPaperWhite) {
      // Compute an Otsu threshold on luminance for crisp separation of paper vs ink
      const hist = new Uint32Array(256);
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          gg = d[i + 1],
          b = d[i + 2];
        const l = Math.max(
          0,
          Math.min(255, Math.round(0.299 * r + 0.587 * gg + 0.114 * b))
        );
        hist[l]++;
      }
      // Otsu
      const total = (w * h) | 0;
      let sum = 0;
      for (let t = 0; t < 256; t++) sum += t * hist[t];
      let sumB = 0,
        wB = 0,
        wF = 0,
        mB = 0,
        mF = 0,
        maxVar = -1,
        threshold = 200;
      for (let t = 0; t < 256; t++) {
        wB += hist[t];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;
        sumB += t * hist[t];
        mB = sumB / wB;
        mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > maxVar) {
          maxVar = between;
          threshold = t;
        }
      }
      // bias slightly brighter to suppress paper texture
      threshold = Math.min(255, threshold + 12);

      // prefer per-asset setting if provided
      const pref =
        (this.assetPassPreference && this.assetPassPreference[inst.assetKey]) ||
        "auto";
      const invert =
        pref === "dark" ? true : pref === "light" ? false : centerL < 0.5; // dark center object → pass dark
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i],
          gg = d[i + 1],
          b = d[i + 2];
        const l = Math.round(0.299 * r + 0.587 * gg + 0.114 * b);
        let passBin = invert ? l < threshold : l > threshold;
        // smaller feather width for crisper edge
        const feather = 6; // px
        const soft = Math.max(
          0,
          Math.min(1, (invert ? threshold - l : l - threshold) / feather)
        );
        const A = passBin
          ? Math.round(255 * Math.min(1, 0.8 + soft * 0.2)) // mostly solid where passed
          : Math.round(255 * Math.max(0, Math.min(1, soft * 0.5))); // narrow transition
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = A;
      }
    } else {
      // Alpha assets: use alpha directly, with slight hardening around 0.5
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i + 3] / 255;
        // harden transparency: shift threshold slightly and apply gain
        let pass = Math.max(0, Math.min(1, (1 - a - 0.06) * 1.35));
        const A = Math.round(255 * pass);
        d[i] = 255;
        d[i + 1] = 255;
        d[i + 2] = 255;
        d[i + 3] = A;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  // Pointer from tray creates an instance on drop at pointer location
  onTrayPointerDown(e) {
    const chip = e.target.closest(".stencil-chip");
    if (!chip) return;
    e.preventDefault();
    const asset = chip.getAttribute("data-asset");
    const stageRect = this.paintCanvas.getBoundingClientRect();
    const x = e.clientX - stageRect.left;
    const y = e.clientY - stageRect.top + 80; // drop slightly below tray
    this.addInstance(asset, x, y);
  }

  // Stage interactions: select/move, press with two fingers to rotate/scale (simple)
  onStagePointerDown(e) {
    e.preventDefault();
    const { x, y } = this.toStage(e);
    // 1) If a selected stencil has a hovered handle, start transform instead of painting
    const selectedTop = [...this.instances]
      .reverse()
      .find((i) => this.selectedIds.has(i.id));
    if (selectedTop) {
      const handle = this.handleHit(selectedTop, x, y);
      if (
        handle &&
        (handle === "rotate" ||
          handle === "move" ||
          handle.startsWith("resize:"))
      ) {
        this.activePointerId = e.pointerId;
        this.interactionMode =
          handle === "rotate" ? "rotate" : handle === "move" ? "move" : "scale";
        const dx = x - selectedTop.x,
          dy = y - selectedTop.y;
        const angle = Math.atan2(dy, dx);
        const dist = Math.hypot(dx, dy);
        this.gesture = {
          instId: selectedTop.id,
          startX: x,
          startY: y,
          startScale: selectedTop.scale,
          startRotation: selectedTop.rotation,
          startAngle: angle,
          startDist: dist,
          cx: selectedTop.x,
          cy: selectedTop.y,
          handle,
        };
        return; // never start spray when interacting with a handle
      }
    }

    // 2) Otherwise, if body hit: select first, spray on next press
    const hit = this.hitTest(x, y);
    if (hit && !this.selectedIds.has(hit.id)) {
      this.selectOnly(hit.id);
      return; // don't start spraying on the same click that selects
    }
    // start spraying (empty area or already-selected)
    this.strokeCtx.clearRect(
      0,
      0,
      this.strokeCanvas.width,
      this.strokeCanvas.height
    );
    this.spray.startDrawing(x, y, 1.0);
  }

  onPointerMove(e) {
    if (
      this.activePointerId &&
      e.pointerId === this.activePointerId &&
      this.gesture
    ) {
      e.preventDefault();
      const { x, y } = this.toStage(e);
      const inst = this.instances.find((i) => i.id === this.gesture.instId);
      if (inst) {
        if (this.interactionMode === "move") {
          inst.x = x - (this.gesture.startX - this.gesture.cx);
          inst.y = y - (this.gesture.startY - this.gesture.cy);
        } else if (this.interactionMode === "scale") {
          // uniform scale using distance from center relative to start
          const dx = x - inst.x,
            dy = y - inst.y;
          const dist = Math.hypot(dx, dy);
          const scale = Math.max(
            0.1,
            this.gesture.startScale *
              (dist / Math.max(10, this.gesture.startDist))
          );
          inst.scale = Math.min(8, scale);
        } else if (this.interactionMode === "rotate") {
          const dx = x - inst.x,
            dy = y - inst.y;
          const ang = Math.atan2(dy, dx);
          inst.rotation =
            this.gesture.startRotation + (ang - this.gesture.startAngle);
        }
        this.redrawGuides();
      }
      return;
    }

    if (this.spray.isDrawing) {
      const { x, y } = this.toStage(e);
      this.spray.draw(x, y, 1.0);
      // render to strokeCanvas, then composite per selection
      this.compositeStroke();
      // Avoid re-compositing the same stroke content on subsequent move frames
      this.strokeCtx.clearRect(
        0,
        0,
        this.strokeCanvas.width,
        this.strokeCanvas.height
      );
      return;
    }

    // Hover cursor over handles (mouse/pen only)
    if (!this.activePointerId && e.pointerType !== "touch") {
      const { x, y } = this.toStage(e);
      const inst = [...this.instances]
        .reverse()
        .find((i) => this.selectedIds.has(i.id));
      let cursor = "default";
      if (inst) {
        const h = this.handleHit(inst, x, y);
        if (h) cursor = this.cursorForHandle(h, inst);
      }
      this.setStageCursor(cursor);
    }
  }

  onPointerUp(e) {
    if (e.pointerId === this.activePointerId) {
      this.activePointerId = null;
      this.draggingInstanceId = null;
      this.interactionMode = null;
      this.gesture = null;
    }
    if (this.spray.isDrawing) {
      this.spray.stopDrawing();
      // finalize last stroke composite
      this.compositeStroke();
      // clear stroke layer
      this.strokeCtx.clearRect(
        0,
        0,
        this.strokeCanvas.width,
        this.strokeCanvas.height
      );
    }
  }

  toStage(e) {
    const r = this.paintCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Coarse bbox hit-test with rotation bounding box approximation
  hitTest(x, y) {
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      const w = inst.bitmap.width * inst.scale;
      const h = inst.bitmap.height * inst.scale;
      const cx = inst.x,
        cy = inst.y;
      // rotated bbox extents
      const cos = Math.cos(inst.rotation),
        sin = Math.sin(inst.rotation);
      const rx = Math.abs(w * 0.5 * cos) + Math.abs(h * 0.5 * sin);
      const ry = Math.abs(w * 0.5 * sin) + Math.abs(h * 0.5 * cos);
      if (x >= cx - rx && x <= cx + rx && y >= cy - ry && y <= cy + ry) {
        return inst;
      }
    }
    return null;
  }

  selectOnly(id) {
    this.selectedIds.clear();
    if (id) this.selectedIds.add(id);
    this.redrawGuides();
  }

  redrawGuides() {
    const g = this.guideCtx;
    const w = this.guideCanvas.width / this.dpr;
    const h = this.guideCanvas.height / this.dpr;
    g.clearRect(0, 0, w, h);
    // draw instances silhouettes
    for (const inst of this.instances) {
      g.save();
      g.translate(inst.x, inst.y);
      g.rotate(inst.rotation);
      g.scale(inst.scale, inst.scale);
      g.globalAlpha = this.selectedIds.has(inst.id) ? 0.9 : 0.55;
      g.drawImage(inst.bitmap, -inst.bitmap.width / 2, -inst.bitmap.height / 2);
      g.restore();

      // bbox
      if (this.selectedIds.has(inst.id)) {
        const hp = this.getHandlePositions(inst);
        g.save();
        g.strokeStyle = "#1a73e8";
        g.setLineDash([6, 6]);
        g.lineWidth = 2;
        // Draw rotated rectangle path
        g.beginPath();
        g.moveTo(hp.nw.x, hp.nw.y);
        g.lineTo(hp.ne.x, hp.ne.y);
        g.lineTo(hp.se.x, hp.se.y);
        g.lineTo(hp.sw.x, hp.sw.y);
        g.closePath();
        g.stroke();
        // draw transform handles (center move + 8 resize + 1 rotate)
        g.setLineDash([]);
        this.drawHandle(g, hp.center.x, hp.center.y, "#fbbc04");
        const order = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
        for (const k of order) this.drawHandle(g, hp[k].x, hp[k].y, "#1a73e8");
        this.drawRotateHandle(g, hp.rotate.x, hp.rotate.y);
        g.restore();
      }
    }
  }

  drawHandle(g, x, y, color) {
    g.save();
    g.fillStyle = color;
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 10, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }

  setStageCursor(cursor) {
    for (const c of this._stageCanvases) c.style.cursor = cursor || "default";
  }

  cursorForHandle(handle, inst) {
    if (handle === "move") return "move";
    if (handle === "rotate") return "move";
    if (!handle.startsWith("resize:")) return "default";

    const dir = handle.split(":")[1];
    const rot = ((inst.rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const within = (ang) => {
      const a = Math.abs(((rot - ang + Math.PI) % (2 * Math.PI)) - Math.PI);
      return a;
    };

    // For edges: choose ns vs ew based on rotation alignment
    const edgeAxis = (axisAngle) =>
      within(axisAngle) < Math.PI / 4 ? "ns-resize" : "ew-resize";
    // For corners: choose diagonal based on rotation phase within 90°
    const diagType = () => {
      const r = ((rot % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2); // 0..PI/2
      const standard = r < Math.PI / 4; // near axes → standard mapping
      return standard
        ? { a: "nwse-resize", b: "nesw-resize" }
        : { a: "nesw-resize", b: "nwse-resize" };
    };

    switch (dir) {
      case "n":
      case "s":
        return edgeAxis(0); // axis aligned with y when rot≈0
      case "e":
      case "w":
        return edgeAxis(Math.PI / 2);
      case "nw":
      case "se":
        return diagType().a;
      case "ne":
      case "sw":
        return diagType().b;
    }
    return "default";
  }

  getRotateCursor() {
    if (this._rotateCursorUrl) return this._rotateCursorUrl;
    // draw a small PNG cursor for better cross-browser support
    const c = document.createElement("canvas");
    c.width = 24;
    c.height = 24;
    const g = c.getContext("2d");
    g.clearRect(0, 0, 24, 24);
    g.strokeStyle = "#34a853";
    g.lineWidth = 2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.arc(12, 12, 8, Math.PI * 0.15, Math.PI * 1.75);
    g.stroke();
    g.beginPath();
    g.moveTo(17, 6);
    g.lineTo(22, 6);
    g.lineTo(19, 10);
    g.stroke();
    this._rotateCursorUrl = c.toDataURL("image/png");
    return this._rotateCursorUrl;
  }

  drawRotateHandle(g, x, y) {
    g.save();
    if (this.rotateIconLoaded && this.rotateIcon.width) {
      const size = 26;
      g.drawImage(this.rotateIcon, x - size / 2, y - size / 2, size, size);
    } else {
      g.translate(x, y);
      g.strokeStyle = "#34a853";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, 10, Math.PI * 0.15, Math.PI * 1.75);
      g.stroke();
      g.beginPath();
      g.moveTo(6, -6);
      g.lineTo(12, -6);
      g.lineTo(8.5, -1.5);
      g.stroke();
    }
    g.restore();
  }

  // Compute rotated handle positions (corners, edges, center, rotate)
  getHandlePositions(inst) {
    const w = inst.bitmap.width * inst.scale;
    const h = inst.bitmap.height * inst.scale;
    const cosR = Math.cos(inst.rotation),
      sinR = Math.sin(inst.rotation);
    const tr = (lx, ly) => ({
      x: inst.x + cosR * lx - sinR * ly,
      y: inst.y + sinR * lx + cosR * ly,
    });
    const hx = w / 2,
      hy = h / 2;
    const nw = tr(-hx, -hy);
    const ne = tr(hx, -hy);
    const se = tr(hx, hy);
    const sw = tr(-hx, hy);
    const n = tr(0, -hy);
    const e = tr(hx, 0);
    const south = tr(0, hy);
    const wpt = tr(-hx, 0);
    // rotate handle offset outward from top edge
    const vnx = n.x - inst.x,
      vny = n.y - inst.y;
    const len = Math.max(1, Math.hypot(vnx, vny));
    const nx = vnx / len,
      ny = vny / len;
    const rotate = { x: n.x + nx * 28, y: n.y + ny * 28 };
    return {
      center: { x: inst.x, y: inst.y },
      nw,
      ne,
      se,
      sw,
      n,
      e,
      s: south,
      w: wpt,
      rotate,
    };
  }

  // Composite strokeCanvas to paintCanvas with stencil masks when selected
  compositeStroke() {
    const hasSelection = this.selectedIds.size > 0;
    const sw = this.strokeCanvas.width / this.dpr;
    const sh = this.strokeCanvas.height / this.dpr;
    if (!hasSelection) {
      // draw full stroke
      this.paintCtx.save();
      this.paintCtx.globalCompositeOperation = "source-over";
      this.paintCtx.drawImage(
        this.strokeCanvas,
        0,
        0,
        sw * this.dpr,
        sh * this.dpr,
        0,
        0,
        sw,
        sh
      );
      this.paintCtx.restore();
      return;
    }

    if (!this.clipToStencil) {
      // 1) Keep overspray outside selected stencil bbox(es)
      const outside = document.createElement("canvas");
      outside.width = this.strokeCanvas.width;
      outside.height = this.strokeCanvas.height;
      const og = outside.getContext("2d");
      og.drawImage(this.strokeCanvas, 0, 0);
      // remove inside each ROTATED rect, not the AABB
      for (const inst of this.instances) {
        if (!this.selectedIds.has(inst.id)) continue;
        const hp = this.getHandlePositions(inst);
        // carve out the rotated quad from the outside layer
        og.save();
        og.globalCompositeOperation = "destination-out";
        og.beginPath();
        og.moveTo(
          Math.round(hp.nw.x * this.dpr),
          Math.round(hp.nw.y * this.dpr)
        );
        og.lineTo(
          Math.round(hp.ne.x * this.dpr),
          Math.round(hp.ne.y * this.dpr)
        );
        og.lineTo(
          Math.round(hp.se.x * this.dpr),
          Math.round(hp.se.y * this.dpr)
        );
        og.lineTo(
          Math.round(hp.sw.x * this.dpr),
          Math.round(hp.sw.y * this.dpr)
        );
        og.closePath();
        og.fillStyle = "#000";
        og.fill();
        og.restore();
      }
      // draw remaining (outside-of-bboxes) stroke to paint
      this.paintCtx.save();
      this.paintCtx.globalCompositeOperation = "source-over";
      this.paintCtx.drawImage(
        outside,
        0,
        0,
        sw * this.dpr,
        sh * this.dpr,
        0,
        0,
        sw,
        sh
      );
      this.paintCtx.restore();

      // 2) For each selected stencil, draw masked inside region
      for (const inst of this.instances) {
        if (!this.selectedIds.has(inst.id)) continue;
        const bbox = this.rotatedBbox(inst);
        const clip = document.createElement("canvas");
        clip.width = Math.ceil(bbox.w * this.dpr);
        clip.height = Math.ceil(bbox.h * this.dpr);
        const cg = clip.getContext("2d");
        cg.setTransform(1, 0, 0, 1, 0, 0);
        cg.drawImage(
          this.strokeCanvas,
          Math.floor(bbox.x * this.dpr),
          Math.floor(bbox.y * this.dpr),
          Math.ceil(bbox.w * this.dpr),
          Math.ceil(bbox.h * this.dpr),
          0,
          0,
          Math.ceil(bbox.w * this.dpr),
          Math.ceil(bbox.h * this.dpr)
        );
        // apply pass mask (destination-in)
        cg.globalCompositeOperation = "destination-in";
        const m = inst.maskCanvas;
        const sx = inst.x - bbox.x;
        const sy = inst.y - bbox.y;
        cg.save();
        cg.translate(Math.round(sx * this.dpr), Math.round(sy * this.dpr));
        cg.rotate(inst.rotation);
        cg.scale(inst.scale * this.dpr, inst.scale * this.dpr);
        cg.translate(-m.width / 2, -m.height / 2);
        cg.drawImage(m, 0, 0);
        cg.restore();

        this.paintCtx.save();
        this.paintCtx.globalCompositeOperation = "source-over";
        this.paintCtx.drawImage(clip, bbox.x, bbox.y, bbox.w, bbox.h);
        this.paintCtx.restore();
      }
      return;
    }

    for (const inst of this.instances) {
      if (!this.selectedIds.has(inst.id)) continue;
      const bbox = this.rotatedBbox(inst);

      // clipCanvas: draw stroke region then mask with destination-in
      const clip = document.createElement("canvas");
      clip.width = Math.ceil(bbox.w * this.dpr);
      clip.height = Math.ceil(bbox.h * this.dpr);
      const cg = clip.getContext("2d");
      cg.setTransform(1, 0, 0, 1, 0, 0);
      // draw stroke region into clip
      cg.drawImage(
        this.strokeCanvas,
        Math.floor(bbox.x * this.dpr),
        Math.floor(bbox.y * this.dpr),
        Math.ceil(bbox.w * this.dpr),
        Math.ceil(bbox.h * this.dpr),
        0,
        0,
        Math.ceil(bbox.w * this.dpr),
        Math.ceil(bbox.h * this.dpr)
      );

      // destination-in with pass mask: white areas keep paint (allow through), black blocks
      cg.globalCompositeOperation = "destination-in";
      // draw mask transformed into bbox-space
      const m = inst.maskCanvas;
      // draw mask centered at inst.x/y into bbox offset with current rotation/scale
      const sx = inst.x - bbox.x;
      const sy = inst.y - bbox.y;
      cg.save();
      cg.translate(Math.round(sx * this.dpr), Math.round(sy * this.dpr));
      cg.rotate(inst.rotation);
      cg.scale(inst.scale * this.dpr, inst.scale * this.dpr);
      cg.translate(-m.width / 2, -m.height / 2);
      cg.drawImage(m, 0, 0);
      cg.restore();

      // composite onto paint canvas
      this.paintCtx.save();
      this.paintCtx.globalCompositeOperation = "source-over";
      this.paintCtx.drawImage(clip, bbox.x, bbox.y, bbox.w, bbox.h);
      this.paintCtx.restore();
    }
  }

  rotatedBbox(inst) {
    const w = inst.bitmap.width * inst.scale;
    const h = inst.bitmap.height * inst.scale;
    const cos = Math.cos(inst.rotation),
      sin = Math.sin(inst.rotation);
    const rx = Math.abs(w * 0.5 * cos) + Math.abs(h * 0.5 * sin);
    const ry = Math.abs(w * 0.5 * sin) + Math.abs(h * 0.5 * cos);
    return { x: inst.x - rx, y: inst.y - ry, w: rx * 2, h: ry * 2 };
  }

  handleHit(inst, x, y) {
    const hp = this.getHandlePositions(inst);
    const rotPos = hp.rotate;
    const within = (px, py, hx, hy, r = 14) =>
      Math.hypot(px - hx, py - hy) <= r;
    // center move handle
    if (within(x, y, hp.center.x, hp.center.y)) return "move";
    const handles = [
      ["resize:nw", hp.nw.x, hp.nw.y],
      ["resize:n", hp.n.x, hp.n.y],
      ["resize:ne", hp.ne.x, hp.ne.y],
      ["resize:e", hp.e.x, hp.e.y],
      ["resize:se", hp.se.x, hp.se.y],
      ["resize:s", hp.s.x, hp.s.y],
      ["resize:sw", hp.sw.x, hp.sw.y],
      ["resize:w", hp.w.x, hp.w.y],
    ];
    for (const [k, hx, hy] of handles) {
      if (within(x, y, hx, hy)) return k;
    }
    if (within(x, y, rotPos.x, rotPos.y)) return "rotate";
    return null;
  }

  instanceLocalToStage(inst) {
    // Returns a function mapping local (bitmap space centered) to stage; not used extensively here
    const cx = inst.x,
      cy = inst.y;
    const s = inst.scale,
      r = inst.rotation;
    const cos = Math.cos(r),
      sin = Math.sin(r);
    return (lx, ly) => ({
      x: cx + (lx * s * cos - ly * s * sin),
      y: cy + (lx * s * sin + ly * s * cos),
    });
  }
}

// bootstrap
(() => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new StencilApp());
  } else {
    new StencilApp();
  }
})();
