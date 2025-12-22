class StencilApp {
  constructor() {
    this.paintCanvas = document.getElementById("paintCanvas");
    this.paintCtx = this.paintCanvas.getContext("2d");
    this.strokeCanvas = document.getElementById("strokeCanvas");
    this.strokeCtx = this.strokeCanvas.getContext("2d");
    this.guideCanvas = document.getElementById("guideCanvas");
    this.guideCtx = this.guideCanvas.getContext("2d");
    this.stageBgCanvas = document.getElementById("stageBg");
    this.stageBgCtx =
      this.stageBgCanvas && this.stageBgCanvas.getContext
        ? this.stageBgCanvas.getContext("2d")
        : null;
    this._stageBgBase = null; // canvas in stage CSS px units

    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.instances = []; // placed stencil instances
    this.selectedIds = new Set();
    this.activePointerId = null;
    this.draggingInstanceId = null;
    this.dragStart = null;
    this.interactionMode = null; // 'move' | 'scale' | 'rotate'
    this.gesture = null; // gesture state for transforms
    this.clipToStencil = false; // when true, cleanup outside; when false, keep overspray
    this._stageCanvases = []; // for cursor updates
    this._compositeLoopRunning = false;
    this.peelState = {
      instId: null,
      pointerId: null,
      anchor: null,
      tip: null,
      vector: null,
      maxLen: 0,
      progress: 0,
      dragging: false,
      removed: false,
      animToken: 0,
    };
    this.stencilRemoved = false;
    this.peelHintUnlocked = false;
    this._paintStartTime = null; // Track when user started painting
    this._lowProgressWarningShown = false; // Track if we've shown the low progress warning
    this._strokeStartTs = 0;
    this._paintTimerLastTs = 0;
    this._peelDebugLastLogTs = 0;
    this._peelHintAnim = {
      running: false,
      lastTs: 0,
      lastDrawTs: 0,
      phase: 0,
    };
    this._peelHintWasVisible = false;
    this.peelBackImageUrl =
      (document.body &&
        document.body.dataset &&
        document.body.dataset.peelBackImage) ||
      null;
    this.peelBackImage = null;
    this.peelBackReady = false;
    // Auto-peel: when enabled, a small drag triggers auto-complete + fade-out.
    this.autoPeelEnabled = true; // set true to enable
    this.autoPeelTriggerProgress = 0.12; // how far user must drag before auto completes
    this.autoPeelFadeDurationMs = 1; // fade-out duration after peel completes
    // Default cursor reflecting selected can
    this._canCursor = null;
    this._makeCursorFromImage = (
      src,
      hotspotX = 6,
      hotspotY = 6,
      maxLongSide = 64
    ) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          try {
            const ratio = img.width / Math.max(1, img.height);
            const longIsWidth = ratio >= 1;
            const targetLong = Math.max(16, Math.min(128, maxLongSide));
            const w = longIsWidth
              ? targetLong
              : Math.max(8, Math.round(targetLong * ratio));
            const h = longIsWidth
              ? Math.max(8, Math.round(targetLong / Math.max(0.01, ratio)))
              : targetLong;
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const g = c.getContext("2d");
            g.clearRect(0, 0, w, h);
            g.imageSmoothingEnabled = true;
            g.imageSmoothingQuality = "high";
            g.drawImage(img, 0, 0, w, h);
            const url = c.toDataURL("image/png");
            resolve(`url('${url}') ${hotspotX} ${hotspotY}, auto`);
          } catch (_) {
            resolve(`url('${src}') ${hotspotX} ${hotspotY}, auto`);
          }
        };
        img.onerror = () =>
          resolve(`url('${src}') ${hotspotX} ${hotspotY}, auto`);
        img.src = src;
      });
    };
    // Multi-pointer tracking for touch/pinch
    this.activePointers = new Map(); // id -> {x,y}

    // Create spray tool (will be rebuilt on first resize to sync buffers)
    this.spray = new SprayPaint(this.strokeCanvas, this.strokeCtx);
    this.spray.setColor("#221F20");
    this.spray.setNozzleSize(this.getNozzleSizeForDevice());
    this.spray.startDripLoop();
    this.spray.getDripCompositeMode = () => "source-over";

    // Page-level configuration via <body data-*>
    const bodyDs = (document.body && document.body.dataset) || {};
    this.fixedStencilKey = bodyDs.fixedStencil || null; // e.g. "certificate"
    this.lockedStencilMode =
      bodyDs.lockStencil === "true" || Boolean(this.fixedStencilKey);

    // External PNG assets
    this.assetDefs = {};
    // Optionally include fixed-only assets without polluting the default tray
    if (this.fixedStencilKey === "certificate") {
      this.assetDefs.certificate = "assets/certificate-stencil.png";
    }
    // Per-asset pass preference for paper-background scans:
    // 'dark' → dark ink passes (spray shows where dark), 'light' → light passes, 'auto' → decide by center
    this.assetPassPreference = {
      certificate: "alpha",
    };
    this.assetBitmaps = {}; // key -> canvas with image drawn
    this._derivedBitmaps = {}; // cache for cropped/derived bitmaps per mode

    this.resize = this.resize.bind(this);
    this.onStagePointerDown = this.onStagePointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.init();
  }

  async init() {
    window.addEventListener("resize", this.resize);
    // Listen for orientation changes to update canvas orientation in real-time
    window.addEventListener("orientationchange", () => {
      // Stop any active drawing when orientation changes
      if (this.spray && this.spray.isDrawing) {
        this.spray.stopDrawing();
        // Clear any partial stroke on orientation change
        if (this.strokeCanvas) {
          this.strokeCtx.clearRect(
            0,
            0,
            this.strokeCanvas.width,
            this.strokeCanvas.height
          );
        }
        if (this.spray) {
          this.spray._strokeDirty = false;
        }
      }
      // Small delay to ensure orientation is fully updated
      setTimeout(() => this.resize(), 100);
    });
    // Also listen for media query changes (more reliable on some devices)
    if (window.matchMedia) {
      const mq = window.matchMedia("(orientation: portrait)");
      mq.addEventListener("change", () => {
        // Stop any active drawing when orientation changes
        if (this.spray && this.spray.isDrawing) {
          this.spray.stopDrawing();
          // Clear any partial stroke on orientation change
          if (this.strokeCanvas) {
            this.strokeCtx.clearRect(
              0,
              0,
              this.strokeCanvas.width,
              this.strokeCanvas.height
            );
          }
          if (this.spray) {
            this.spray._strokeDirty = false;
          }
        }
        this.resize();
      });
    }
    this.resize();

    // Listen for certificate.html stageBg re-renders so we can capture a clean base image
    // and re-apply peel hint/effect on top.
    window.addEventListener("stagebg:rendered", (e) => {
      try {
        const canvas = e && e.detail && e.detail.canvas;
        if (canvas) this.onStageBgRendered(canvas);
      } catch (_) {}
    });

    // Preload PNGs
    await this.loadAssets();

    // Optional peel backside texture
    this.loadPeelBackTexture();

    // Stage interactions
    const layers = [this.guideCanvas, this.strokeCanvas, this.paintCanvas];
    this._stageCanvases = layers;
    layers.forEach((c) => {
      c.addEventListener("pointerdown", this.onStagePointerDown, {
        passive: false,
      });
      c.addEventListener("pointermove", this.onPointerMove, { passive: false });
      c.addEventListener("pointerup", this.onPointerUp, { passive: false });
      c.addEventListener("pointercancel", this.onPointerUp, { passive: false });
      c.addEventListener("pointerleave", this.onPointerUp, { passive: false });
    });

    // Fixed-stencil mode (single locked stencil, always clipped)
    if (this.fixedStencilKey) {
      this.clipToStencil = true;
      this.buildOrUpdateFixedStencil();
    }

    // Spray can image controls (gold/black)
    const goldCanImg = document.querySelector(".spray-can-gold");
    const blackCanImg = document.querySelector(".spray-can-black");

    const selectCan = async (which) => {
      if (goldCanImg) goldCanImg.classList.toggle("selected", which === "gold");
      if (blackCanImg)
        blackCanImg.classList.toggle("selected", which === "black");

      // Build a cursor using the can image; hotspot tuned roughly near nozzle
      const hotspotX = 8,
        hotspotY = 8;
      const src =
        which === "gold"
          ? "assets/spray-can-gold.png"
          : "assets/spray-can-black.png";
      // Downscale to a safe cursor size via canvas to improve browser support (preserve aspect)
      this._canCursor = await this._makeCursorFromImage(
        src,
        hotspotX,
        hotspotY,
        72
      );
      // Apply immediately as base cursor across stage layers
      this.setStageCursor(this._canCursor);
    };

    if (goldCanImg) {
      goldCanImg.addEventListener("click", () => {
        this.spray.setColor("#EAC677");
        selectCan("gold");
      });
    }
    if (blackCanImg) {
      blackCanImg.addEventListener("click", () => {
        this.spray.setColor("#221F20");
        selectCan("black");
      });
    }

    // Initialize selection to match default color
    selectCan("black");

    this.redrawGuides();

    // Begin background composite loop for drips
    this.startCompositeLoop();
    // Subtle animated hint for the peel corner in locked/certificate mode
    this.startPeelHintLoop();

    // Fallback: if certificate.html rendered the background before our event listener was ready,
    // capture the current stageBg contents as the base on the next frame.
    if (this.stageBgCanvas) {
      requestAnimationFrame(() => {
        try {
          this.onStageBgRendered(this.stageBgCanvas);
        } catch (_) {}
      });
    }
  }

  loadPeelBackTexture() {
    const url = this.peelBackImageUrl;
    if (!url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      this.peelBackImage = img;
      this.peelBackReady = true;
    };
    img.onerror = () => {
      this.peelBackImage = null;
      this.peelBackReady = false;
    };
    img.src = url;
  }

  hasStageBackground() {
    return Boolean(document.getElementById("stageBg"));
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
        s.setDripThreshold(Math.round((old.DRIP_THRESHOLD || 0.59) * 100));
        s.setDripGravity(old.GRAVITY || 500);
        s.setDripViscosity(old.VISCOSITY || 8.9);
        s.setDripEvaporation(Math.round((old.WET_EVAP || 0.18) * 100));
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
        // Track paint progress and unlock peel hint at 99% completion
        const shouldCheckProgress =
          !this.peelHintUnlocked &&
          this.lockedStencilMode &&
          this.fixedStencilKey &&
          !this.stencilRemoved;

        if (shouldCheckProgress) {
          // Track when user starts painting
          if (this.spray && this.spray.isDrawing && !this._paintStartTime) {
            this._paintStartTime = performance.now();
          }

          // Check paint progress periodically
          const progressCheckNow = performance.now();
          const lastProgressCheck = this._lastProgressCheckTs || 0;
          if (progressCheckNow - lastProgressCheck >= 500) {
            this._lastProgressCheckTs = progressCheckNow;
            try {
              const progress = this.getPaintProgress();

              // Unlock peel hint when progress reaches 99%
              if (progress.progress >= 95 && !this.peelHintUnlocked) {
                this.peelHintUnlocked = true;
                if (typeof window !== "undefined" && window.DEBUG_PEEL) {
                  console.log(
                    "[peel] hint unlocked",
                    "progress:",
                    progress.progress.toFixed(2) + "%"
                  );
                }
                // Fire the peel-ready event
                if (typeof window !== "undefined") {
                  window.dispatchEvent(new CustomEvent("stencil:peel-ready"));
                }
                // Hide low progress warning if it was showing
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("stencil:progress-warning-hide")
                  );
                }
              }

              // Show low progress warning if user has been painting for a while but progress is low
              if (
                this._paintStartTime &&
                !this._lowProgressWarningShown &&
                !this.peelHintUnlocked
              ) {
                const paintDuration = progressCheckNow - this._paintStartTime;
                const paintDurationSeconds = paintDuration / 1000;

                // Show warning if painting for more than 15 seconds and progress is less than 50%
                if (paintDurationSeconds > 25 && progress.progress < 80) {
                  this._lowProgressWarningShown = true;
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(
                      new CustomEvent("stencil:progress-warning-show", {
                        detail: { progress: progress.progress },
                      })
                    );
                  }
                }
              }
            } catch (e) {
              console.error("[Paint Progress] Error checking progress:", e);
            }
          }
        }

        const hasDrips =
          this.spray &&
          Array.isArray(this.spray.drips) &&
          this.spray.drips.length > 0;
        // Only bake drips when user is NOT actively drawing and there is fresh stroke content
        // In locked stencil mode, don't composite during painting - wait for peel event
        if (
          hasDrips &&
          this.spray &&
          !this.spray.isDrawing &&
          this.spray._strokeDirty &&
          !this.lockedStencilMode
        ) {
          this.compositeStroke();
          // Clear the stroke layer after baking so next drip frame draws fresh
          this.strokeCtx.clearRect(
            0,
            0,
            this.strokeCanvas.width,
            this.strokeCanvas.height
          );
          // reset dirty flag after baking
          this.spray._strokeDirty = false;
        }

        // Track paint progress periodically (throttled to avoid performance issues)
        // Note: Progress checking for peel hint unlock is now done in the shouldCheckProgress block above
        if (typeof window !== "undefined" && window.DEBUG_PAINT_PROGRESS) {
          const progressCheckNow = performance.now();
          const lastProgressLog = this._lastProgressLogTs || 0;
          if (progressCheckNow - lastProgressLog >= 2000) {
            // Log progress every 2 seconds (less frequent to reduce console spam)
            this._lastProgressLogTs = progressCheckNow;
            try {
              const progress = this.getPaintProgress();
              if (progress.totalPassPixels > 0) {
                console.log(
                  `[Paint Progress] ${progress.progress.toFixed(2)}% complete`,
                  `(${progress.paintedPixels.toLocaleString()} / ${progress.totalPassPixels.toLocaleString()} pixels)`
                );
              }
            } catch (e) {
              console.error("[Paint Progress] Error calculating progress:", e);
            }
          }
        }
      } catch (e) {
        // ignore
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  startPeelHintLoop() {
    if (!this._peelHintAnim || this._peelHintAnim.running) return;
    this._peelHintAnim.running = true;
    const tick = (ts) => {
      try {
        const canHint =
          this.peelHintUnlocked &&
          this.lockedStencilMode &&
          !this.stencilRemoved &&
          this.fixedStencilKey &&
          this.instances &&
          this.instances.length > 0 &&
          this.peelState &&
          !this.peelState.dragging &&
          (this.peelState.progress || 0) <= 0;

        if (canHint) {
          if (
            typeof window !== "undefined" &&
            window.DEBUG_PEEL &&
            !this._peelHintWasVisible
          ) {
            console.log("[peel] hint loop active", {
              instances: this.instances ? this.instances.length : 0,
              peelProgress: this.peelState ? this.peelState.progress : null,
            });
          }
          this._peelHintWasVisible = true;
          const prev = this._peelHintAnim.lastTs || ts;
          const dt = Math.max(0, ts - prev);
          this._peelHintAnim.phase += dt / 1000;
          this._peelHintAnim.lastTs = ts;

          // Throttle redraws to ~30fps (use a dedicated timestamp so dt doesn't get reset each frame).
          const lastDraw = this._peelHintAnim.lastDrawTs || 0;
          if (!lastDraw || ts - lastDraw >= 33) {
            this._peelHintAnim.lastDrawTs = ts;
            this.redrawGuides();
          }
        } else {
          this._peelHintAnim.lastTs = ts;
          this._peelHintAnim.lastDrawTs = ts;
          this._peelHintWasVisible = false;
          // Optional debug: explain why hint isn't visible after unlock.
          if (
            typeof window !== "undefined" &&
            window.DEBUG_PEEL &&
            this.peelHintUnlocked
          ) {
            const now = performance.now();
            if (now - (this._peelDebugLastLogTs || 0) > 1500) {
              this._peelDebugLastLogTs = now;
              console.log("[peel] hint suppressed", {
                lockedStencilMode: this.lockedStencilMode,
                stencilRemoved: this.stencilRemoved,
                fixedStencilKey: this.fixedStencilKey,
                instances: this.instances ? this.instances.length : 0,
                peelDragging: this.peelState ? this.peelState.dragging : null,
                peelProgress: this.peelState ? this.peelState.progress : null,
              });
            }
          }
        }
      } catch (_) {}
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Place initial stencils on the canvas so users can start dragging/spraying immediately

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

  getNozzleSizeForDevice() {
    // Use smaller nozzle size on mobile devices (works in both portrait and landscape)
    // Check multiple conditions to catch mobile in all orientations
    const hasTouch =
      typeof window !== "undefined" &&
      ("ontouchstart" in window ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

    const isSmallWidth =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 768px)").matches;

    const isSmallHeight =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-height: 768px)").matches;

    // Also check if we're in certificate landscape mode (indicates mobile)
    const isMobileLandscape =
      typeof window !== "undefined" &&
      window.__certificateLandscapeMode === true;

    // Consider it mobile if: small width OR small height OR has touch + small screen OR mobile landscape mode
    const isMobile =
      isSmallWidth ||
      isSmallHeight ||
      (hasTouch && (window.innerWidth <= 1024 || window.innerHeight <= 1024)) ||
      isMobileLandscape;

    return isMobile ? 7 : 15; // 8px for mobile devices, 15px for desktop
  }

  resize() {
    const rect = this.paintCanvas.parentElement.getBoundingClientRect();
    // In fixed/locked stencil mode (e.g. certificate page) the stage can be small on mobile.
    // Do NOT apply the large minimums there, or canvases will become larger than the stage
    // and the stencil/background will drift out of alignment.

    // Check if we're in mobile landscape mode (from certificate.html)
    const isMobileLandscape =
      typeof window !== "undefined" &&
      window.__certificateLandscapeMode === true;
    const isPortrait =
      typeof window !== "undefined" && window.__certificateIsPortrait === true;

    // On mobile in portrait, the stage dimensions are already swapped by fitStage()
    // so we use the rect dimensions directly which should be in landscape orientation
    let w = this.lockedStencilMode
      ? Math.max(1, rect.width)
      : Math.max(320, rect.width);
    let h = this.lockedStencilMode
      ? Math.max(1, rect.height)
      : Math.max(400, rect.height);

    // Ensure landscape orientation on mobile (width > height)
    if (isMobileLandscape && isPortrait && h > w) {
      // If somehow height > width, swap them to maintain landscape
      [w, h] = [h, w];
    }

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
        // If the page provides a stage background image, keep paint transparent so the background shows through.
        if (!this.hasStageBackground()) {
          g.fillStyle = getComputedStyle(document.body).backgroundColor;
          g.fillRect(0, 0, w, h);
        }
      }
    });
    // Reset spray tool so its internal buffers match new canvas size
    this.rebuildSpray();
    // Update nozzle size based on current device size
    if (this.spray) {
      this.spray.setNozzleSize(this.getNozzleSizeForDevice());
    }
    if (this.fixedStencilKey && !this.stencilRemoved)
      this.buildOrUpdateFixedStencil();
    this.redrawGuides();
  }

  buildOrUpdateFixedStencil() {
    if (this.stencilRemoved) return;
    const key = this.fixedStencilKey;
    if (!key) return;
    let bitmap = this.assetBitmaps[key];
    if (!bitmap) return;

    // Use the full certificate image without cropping
    // (Previously cropped, but now using full 3266×1832 dimensions)

    const stageW = this.guideCanvas.width / this.dpr;
    const stageH = this.guideCanvas.height / this.dpr;
    const scale = Math.min(stageW / bitmap.width, stageH / bitmap.height);
    const fixedId = `fixed:${key}`;
    let inst = this.instances.find((i) => i.id === fixedId);
    if (!inst) {
      inst = {
        id: fixedId,
        assetKey: key,
        bitmap,
        x: stageW / 2,
        y: stageH / 2,
        scale,
        rotation: 0,
        maskCanvas: null,
      };
      inst.maskCanvas = this.buildMaskCanvas(inst);
      this.instances = [inst];
    } else {
      inst.assetKey = key;
      const bitmapChanged =
        !inst.bitmap ||
        inst.bitmap.width !== bitmap.width ||
        inst.bitmap.height !== bitmap.height;
      inst.bitmap = bitmap;
      inst.x = stageW / 2;
      inst.y = stageH / 2;
      inst.scale = scale;
      inst.rotation = 0;
      if (!inst.maskCanvas || bitmapChanged)
        inst.maskCanvas = this.buildMaskCanvas(inst);
    }
    // Never show transform handles in fixed mode.
    if (this.lockedStencilMode) this.selectedIds.clear();
  }

  // Add a stencil instance
  addInstance(assetKey, x, y, scaleOverride) {
    const id = Math.random().toString(36).slice(2);
    const bitmap = this.assetBitmaps[assetKey];
    if (!bitmap) return;
    // Default scale tuned per-asset so sizes feel intentional
    const stageH = this.guideCanvas.height / this.dpr;
    const baseH = Math.max(1, bitmap.height);
    const computedScale = (stageH * 0.25) / baseH;
    const defaultScale =
      scaleOverride !== undefined
        ? scaleOverride
        : Math.max(0.05, Math.min(2.5, computedScale));
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
    let likelyPaperWhite = avgA > 240 && avgL > 0.85; // opaque bright bg
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

    // Allow forcing alpha-mask mode for assets that have real transparency (e.g. stencil cutouts)
    const prefOverride =
      (this.assetPassPreference && this.assetPassPreference[inst.assetKey]) ||
      null;
    if (prefOverride === "alpha") likelyPaperWhite = false;

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

  // Stage interactions: select/move, press with two fingers to rotate/scale (simple)
  onStagePointerDown(e) {
    // Try fullscreen on first interaction (Android mobile only - iOS doesn't support it)
    if (typeof window !== "undefined" && !window.__fullscreenAttempted) {
      const isMobile = window.matchMedia("(max-width: 768px)").matches;
      // Skip iOS as it doesn't support Fullscreen API
      const isIOS =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

      if (isMobile && !isIOS) {
        window.__fullscreenAttempted = true;
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
          // Standard API (Chrome, Firefox, Edge on Android)
          elem.requestFullscreen().catch(() => {});
        } else if (elem.webkitRequestFullscreen) {
          elem.webkitRequestFullscreen();
        } else if (elem.webkitRequestFullScreen) {
          elem.webkitRequestFullScreen();
        } else if (elem.mozRequestFullScreen) {
          elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
          elem.msRequestFullscreen();
        }
      }
    }

    e.preventDefault();
    const { x, y } = this.toStage(e);
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (_) {}
    this.activePointers.set(e.pointerId, { x, y });

    // Locked (fixed-stencil) mode: always paint; no selecting/moving/resizing.
    if (this.lockedStencilMode) {
      // Disable painting if stencil has been removed
      if (this.stencilRemoved) return;
      // Allow peeling the fixed stencil from the bottom-right corner instead of painting.
      if (this.tryStartPeel(x, y, e.pointerId)) return;
      // If a peel is mid-animation, ignore paint input until it settles.
      if (
        this.peelState &&
        !this.peelState.removed &&
        this.peelState.progress > 0
      )
        return;

      // Before we begin a new stroke: if there are pending drips on the stroke layer,
      // bake them to the paint layer so clearing doesn't truncate them.
      // In locked stencil mode, don't composite during painting - wait for peel event
      if (this.spray && this.spray._strokeDirty && !this.lockedStencilMode) {
        try {
          this.compositeStroke();
          this.strokeCtx.clearRect(
            0,
            0,
            this.strokeCanvas.width,
            this.strokeCanvas.height
          );
          this.spray._strokeDirty = false;
        } catch (_) {}
      }
      // Start paint-time tracking for peel-hint unlock (cumulative across strokes).
      this._strokeStartTs = performance.now();
      this._paintTimerLastTs = this._strokeStartTs;
      this.spray.startDrawing(x, y, 1.0);
      return;
    }
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
          startDist: Math.max(1, dist),
          cx: selectedTop.x,
          cy: selectedTop.y,
          handle,
          // two-finger gesture baseline (if a second finger comes down)
          twoStartDist: null,
          twoStartAngle: null,
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
    // Before we begin a new stroke: if there are pending drips on the stroke layer,
    // bake them to the paint layer so clearing doesn't truncate them.
    // In locked stencil mode, don't composite during painting - wait for peel event
    if (this.spray && this.spray._strokeDirty && !this.lockedStencilMode) {
      try {
        this.compositeStroke();
        this.strokeCtx.clearRect(
          0,
          0,
          this.strokeCanvas.width,
          this.strokeCanvas.height
        );
        this.spray._strokeDirty = false;
      } catch (_) {}
    }
    // Deselect any current selection when starting to paint
    if (!hit || (hit && this.selectedIds.has(hit.id))) {
      this.selectOnly(null);
    }
    // No unconditional clear here; we already baked + cleared if needed above
    this.spray.startDrawing(x, y, 1.0);
  }

  onPointerMove(e) {
    // Update pointer position
    const pt = this.toStage(e);
    if (this.activePointers.has(e.pointerId))
      this.activePointers.set(e.pointerId, pt);

    // Peeling takes precedence over all other interactions (including spraying).
    if (
      this.peelState &&
      this.peelState.dragging &&
      e.pointerId === this.peelState.pointerId
    ) {
      e.preventDefault();
      this.updatePeelDrag(pt.x, pt.y);
      return;
    }

    // Two-finger pinch (scale/rotate) when two pointers are active on a selected instance
    if (
      this.gesture &&
      this.selectedIds.size === 1 &&
      this.activePointers.size >= 2
    ) {
      e.preventDefault();
      const inst = this.instances.find((i) => i.id === this.gesture.instId);
      if (inst) {
        const [p1, p2] = Array.from(this.activePointers.values());
        const v1x = p1.x - inst.x,
          v1y = p1.y - inst.y;
        const v2x = p2.x - inst.x,
          v2y = p2.y - inst.y;
        const ang = Math.atan2(v2y, v2x) - Math.atan2(v1y, v1x);
        const d1 = Math.hypot(v1x, v1y),
          d2 = Math.hypot(v2x, v2y);
        const dist = Math.max(1, (d1 + d2) * 0.5);
        if (this.gesture.twoStartDist == null) {
          this.gesture.twoStartDist = dist;
          this.gesture.twoStartAngle = ang;
          this.gesture.startScale = inst.scale;
          this.gesture.startRotation = inst.rotation;
        }
        const s = Math.max(
          0.05,
          Math.min(
            8,
            this.gesture.startScale *
              (dist / Math.max(1, this.gesture.twoStartDist))
          )
        );
        inst.scale = s;
        inst.rotation =
          this.gesture.startRotation +
          (ang - (this.gesture.twoStartAngle || 0));
        this.redrawGuides();
        return;
      }
    }

    // Single-pointer transform gesture
    if (
      this.activePointerId &&
      e.pointerId === this.activePointerId &&
      this.gesture
    ) {
      e.preventDefault();
      const { x, y } = pt;
      const inst = this.instances.find((i) => i.id === this.gesture.instId);
      if (inst) {
        if (this.interactionMode === "move") {
          inst.x = x - (this.gesture.startX - this.gesture.cx);
          inst.y = y - (this.gesture.startY - this.gesture.cy);
        } else if (this.interactionMode === "scale") {
          const dx = x - inst.x,
            dy = y - inst.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const scale =
            this.gesture.startScale *
            (dist / Math.max(1, this.gesture.startDist));
          inst.scale = Math.max(0.05, Math.min(8, scale));
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
      // Disable painting if stencil has been removed
      if (this.stencilRemoved) return;
      // Draw live to stroke layer only; bake on pointer up
      this.spray.draw(x, y, 1.0);
      return;
    }

    // Locked/certificate mode: show pointer cursor over the peel hint/hotspot.
    if (
      !this.activePointerId &&
      e.pointerType !== "touch" &&
      this.lockedStencilMode
    ) {
      // Disable painting if stencil has been removed
      if (this.stencilRemoved) {
        this.setStageCursor("default");
        return;
      }
      const { x, y } = this.toStage(e);
      this.setStageCursor(
        this.isOverPeelHint(x, y) ? "pointer" : this._canCursor || "default"
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
      // Use the can cursor as the default fallback when not over a handle
      this.setStageCursor(
        cursor === "default" ? this._canCursor || "default" : cursor
      );
    }
  }

  onPointerUp(e) {
    if (
      this.peelState &&
      this.peelState.dragging &&
      e.pointerId === this.peelState.pointerId
    ) {
      e.preventDefault();
      this.releasePeel();
    }
    if (e.pointerId === this.activePointerId) {
      this.activePointerId = null;
      this.draggingInstanceId = null;
      this.interactionMode = null;
      this.gesture = null;
    }
    // Remove pointer from active set
    if (this.activePointers.has(e.pointerId))
      this.activePointers.delete(e.pointerId);
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (this.spray.isDrawing) {
      this.spray.stopDrawing();
      // finalize last stroke composite
      // In locked stencil mode, don't composite during painting - wait for peel event
      if (!this.lockedStencilMode) {
        this.compositeStroke();
        // clear stroke layer
        this.strokeCtx.clearRect(
          0,
          0,
          this.strokeCanvas.width,
          this.strokeCanvas.height
        );
        this.spray._strokeDirty = false;
      }
      this._strokeStartTs = 0;

      // Check and log paint progress after stroke completes
      try {
        const progress = this.getPaintProgress();
        if (progress.totalPassPixels > 0) {
          console.log(
            `[Paint Progress] Stroke complete: ${progress.progress.toFixed(
              2
            )}%`,
            `(${progress.paintedPixels.toLocaleString()} / ${progress.totalPassPixels.toLocaleString()} pixels)`
          );
        }
      } catch (e) {
        console.error("[Paint Progress] Error calculating progress:", e);
      }
    }
  }

  toStage(e) {
    const r = this.paintCanvas.getBoundingClientRect();
    let x = e.clientX - r.left;
    let y = e.clientY - r.top;

    // Account for CSS rotation transform in mobile portrait mode
    const isMobileLandscape =
      typeof window !== "undefined" &&
      window.__certificateLandscapeMode === true;
    const isPortrait =
      typeof window !== "undefined" && window.__certificateIsPortrait === true;

    if (isMobileLandscape && isPortrait) {
      // The app is rotated 90deg clockwise, so we need to transform coordinates
      // When canvas is rotated 90deg clockwise:
      // - Canvas's top edge (y=0) is now on visual right edge
      // - Canvas's right edge (x=canvasWidth) is now on visual bottom edge
      // - Canvas's bottom edge (y=canvasHeight) is now on visual left edge
      // - Canvas's left edge (x=0) is now on visual top edge
      //
      // After 90deg rotation, bounding rect dimensions are swapped:
      // - r.width = actual canvas height
      // - r.height = actual canvas width
      //
      // Visual coordinates (x, y) relative to rotated bounding rect:
      // - x ranges from 0 to r.width (which is canvas height)
      // - y ranges from 0 to r.height (which is canvas width)
      //
      // Visual to canvas transformation (reverse the 90deg clockwise rotation):
      // - canvas_x = y              (visual Y becomes canvas X)
      // - canvas_y = r.width - x    (invert visual X, use r.width as canvas height)
      const canvasWidth = r.height; // After rotation, height is the canvas width
      const canvasHeight = r.width; // After rotation, width is the canvas height

      const newX = y;
      const newY = canvasHeight - x;
      x = newX;
      y = newY;
    }

    return { x, y };
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
      const fade =
        this.peelState && typeof this.peelState.fadeAlpha === "number"
          ? this.peelState.fadeAlpha
          : 1;
      g.globalAlpha =
        (this.lockedStencilMode
          ? 0.9
          : this.selectedIds.has(inst.id)
          ? 0.9
          : 0.55) * fade;
      g.drawImage(inst.bitmap, -inst.bitmap.width / 2, -inst.bitmap.height / 2);
      g.restore();

      const peelActive =
        this.peelState &&
        !this.peelState.removed &&
        this.peelState.instId === inst.id &&
        this.peelState.progress > 0;
      if (peelActive) {
        this.drawPeelEffect(g, inst, this.peelState);
      } else if (this.lockedStencilMode && !this.stencilRemoved) {
        // Hint where to start peeling (bottom-right corner) in fixed-stencil mode.
        this.drawPeelHint(g, inst);
      }

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
        // draw transform handles (center move + 4 corner resize + 1 rotate)
        g.setLineDash([]);
        this.drawHandle(g, hp.center.x, hp.center.y, "#fbbc04", 10);
        const corners = ["nw", "ne", "se", "sw"];
        for (const k of corners)
          this.drawHandle(g, hp[k].x, hp[k].y, "#1a73e8", 6);
        this.drawRotateHandle(g, hp.rotate.x, hp.rotate.y);
        g.restore();
      }
    }

    // Keep the certificate background peel in sync with the stencil peel.
    this.redrawStageBg();
  }

  drawHandle(g, x, y, color, radius = 10) {
    g.save();
    g.fillStyle = color;
    g.strokeStyle = "#dfc29b";
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
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
    // Use fixed mapping by handle so the diagonal never flips 180°
    if (dir === "nw" || dir === "se") return "nwse-resize";
    if (dir === "ne" || dir === "sw") return "nesw-resize";
    if (dir === "n" || dir === "s") return "ns-resize";
    if (dir === "e" || dir === "w") return "ew-resize";
    return "default";
  }

  drawRotateHandle(g, x, y) {
    g.save();
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
    const sw = this.strokeCanvas.width / this.dpr;
    const sh = this.strokeCanvas.height / this.dpr;

    if (!this.clipToStencil) {
      // 1) Keep overspray outside selected stencil bbox(es)
      const outside = document.createElement("canvas");
      outside.width = this.strokeCanvas.width;
      outside.height = this.strokeCanvas.height;
      const og = outside.getContext("2d");
      og.drawImage(this.strokeCanvas, 0, 0);
      // remove inside each ROTATED rect, not the AABB
      for (const inst of this.instances) {
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

      // 2) For each stencil, draw masked inside region
      for (const inst of this.instances) {
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

  /**
   * Calculate paint progress for stencil(s) - percentage of transparent/pass areas that have been painted
   * @param {string|null} instanceId - Optional: specific instance ID to check, or null for all instances
   * @returns {Object} { progress: number (0-100), paintedPixels: number, totalPassPixels: number, details: Array }
   */
  getPaintProgress(instanceId = null) {
    if (!this.instances || this.instances.length === 0) {
      return { progress: 0, paintedPixels: 0, totalPassPixels: 0, details: [] };
    }

    const instancesToCheck = instanceId
      ? this.instances.filter((inst) => inst.id === instanceId)
      : this.instances;

    if (instancesToCheck.length === 0) {
      return { progress: 0, paintedPixels: 0, totalPassPixels: 0, details: [] };
    }

    let totalPainted = 0;
    let totalPassArea = 0;
    const details = [];

    // Combine paint from both paintCanvas and strokeCanvas for accurate progress
    // In locked stencil mode, paint stays on strokeCanvas until peel, so we must check both
    const combinedPaintCanvas = document.createElement("canvas");
    combinedPaintCanvas.width = this.paintCanvas.width;
    combinedPaintCanvas.height = this.paintCanvas.height;
    const combinedCtx = combinedPaintCanvas.getContext("2d");
    combinedCtx.drawImage(this.paintCanvas, 0, 0);
    // Always check strokeCanvas - in locked mode, paint is only on strokeCanvas
    if (this.strokeCanvas) {
      combinedCtx.globalCompositeOperation = "source-over";
      combinedCtx.drawImage(this.strokeCanvas, 0, 0);
    }

    const paintData = combinedCtx.getImageData(
      0,
      0,
      combinedPaintCanvas.width,
      combinedPaintCanvas.height
    );
    const paintPixels = paintData.data;

    for (const inst of instancesToCheck) {
      if (!inst.maskCanvas) {
        console.warn("[Paint Progress] Instance missing maskCanvas:", inst.id);
        continue;
      }

      const bbox = this.rotatedBbox(inst);
      const mask = inst.maskCanvas;

      // Create a transformed mask canvas at canvas resolution
      const transformedMask = document.createElement("canvas");
      transformedMask.width = this.paintCanvas.width;
      transformedMask.height = this.paintCanvas.height;
      const maskCtx = transformedMask.getContext("2d");
      maskCtx.setTransform(1, 0, 0, 1, 0, 0);

      // Draw the mask transformed to match the instance position/rotation/scale
      // This matches the transformation used in compositeStroke()
      // The mask is centered at inst.x, inst.y, then rotated and scaled
      const sx = inst.x - bbox.x;
      const sy = inst.y - bbox.y;
      maskCtx.save();
      // Translate to instance center position (in canvas pixel coordinates)
      maskCtx.translate(
        Math.round(inst.x * this.dpr),
        Math.round(inst.y * this.dpr)
      );
      maskCtx.rotate(inst.rotation);
      maskCtx.scale(inst.scale * this.dpr, inst.scale * this.dpr);
      // Translate back by half mask size to center it
      maskCtx.translate(-mask.width / 2, -mask.height / 2);
      maskCtx.drawImage(mask, 0, 0);
      maskCtx.restore();

      // Get mask image data
      const maskData = maskCtx.getImageData(
        0,
        0,
        transformedMask.width,
        transformedMask.height
      );
      const maskPixels = maskData.data;

      // Sample pixels within the bounding box for efficiency
      const minX = Math.max(0, Math.floor(bbox.x * this.dpr));
      const maxX = Math.min(
        transformedMask.width - 1,
        Math.ceil((bbox.x + bbox.w) * this.dpr)
      );
      const minY = Math.max(0, Math.floor(bbox.y * this.dpr));
      const maxY = Math.min(
        transformedMask.height - 1,
        Math.ceil((bbox.y + bbox.h) * this.dpr)
      );

      let instancePassPixels = 0;
      let instancePaintedPixels = 0;
      let debugSampleCount = 0;
      let debugPassAreaCount = 0;
      let debugPaintFoundCount = 0;

      // Sample every Nth pixel for performance (adjust sampling rate as needed)
      const sampleRate = 2; // Sample every 2 pixels (4x faster, still accurate)

      for (let y = minY; y <= maxY; y += sampleRate) {
        for (let x = minX; x <= maxX; x += sampleRate) {
          debugSampleCount++;
          const idx = (y * transformedMask.width + x) * 4;

          // Check if this pixel is in the pass area (mask alpha > threshold)
          // For alpha-based masks (like certificate), white/opaque = pass area
          const maskAlpha = maskPixels[idx + 3];
          const isPassArea = maskAlpha > 128; // Threshold: 50% opacity in mask = pass area

          if (isPassArea) {
            debugPassAreaCount++;
            instancePassPixels += sampleRate * sampleRate; // Account for sampling

            // Check if this pixel has paint (alpha > threshold)
            const paintR = paintPixels[idx];
            const paintG = paintPixels[idx + 1];
            const paintB = paintPixels[idx + 2];
            const paintAlpha = paintPixels[idx + 3];
            // Check for any non-transparent paint (very low threshold)
            const hasPaint = paintAlpha > 5; // Lowered threshold to catch any paint

            if (hasPaint) {
              debugPaintFoundCount++;
              instancePaintedPixels += sampleRate * sampleRate;
            }
          }
        }
      }

      const instanceProgress =
        instancePassPixels > 0
          ? (instancePaintedPixels / instancePassPixels) * 100
          : 0;

      details.push({
        instanceId: inst.id,
        assetKey: inst.assetKey,
        progress: instanceProgress,
        paintedPixels: instancePaintedPixels,
        totalPassPixels: instancePassPixels,
      });

      totalPainted += instancePaintedPixels;
      totalPassArea += instancePassPixels;
    }

    const overallProgress =
      totalPassArea > 0 ? (totalPainted / totalPassArea) * 100 : 0;

    return {
      progress: Math.round(overallProgress * 100) / 100, // Round to 2 decimal places
      paintedPixels: totalPainted,
      totalPassPixels: totalPassArea,
      details: details,
    };
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
    const within = (px, py, hx, hy, r = 12) =>
      Math.hypot(px - hx, py - hy) <= r;
    // center move handle
    if (within(x, y, hp.center.x, hp.center.y)) return "move";
    const handles = [
      ["resize:nw", hp.nw.x, hp.nw.y],
      ["resize:ne", hp.ne.x, hp.ne.y],
      ["resize:se", hp.se.x, hp.se.y],
      ["resize:sw", hp.sw.x, hp.sw.y],
    ];
    for (const [k, hx, hy] of handles) {
      if (within(x, y, hx, hy)) return k;
    }
    if (within(x, y, rotPos.x, rotPos.y)) return "rotate";
    return null;
  }

  clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  normalizeVec(x, y) {
    const len = Math.max(1e-6, Math.hypot(x, y));
    return { x: x / len, y: y / len };
  }

  dot(ax, ay, bx, by) {
    return ax * bx + ay * by;
  }

  polyBounds(points) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (
      !isFinite(minX) ||
      !isFinite(minY) ||
      !isFinite(maxX) ||
      !isFinite(maxY)
    )
      return { x: 0, y: 0, w: 1, h: 1 };
    return {
      x: minX,
      y: minY,
      w: Math.max(1e-3, maxX - minX),
      h: Math.max(1e-3, maxY - minY),
    };
  }

  drawPeelBackImage(g, poly) {
    if (!this.peelBackReady || !this.peelBackImage) return false;
    if (!poly || poly.length < 3) return false;
    const b = this.polyBounds(poly);
    g.save();
    g.beginPath();
    g.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) g.lineTo(poly[i].x, poly[i].y);
    g.closePath();
    g.clip();
    // Ensure it's fully opaque even if the image has alpha.
    g.fillStyle = "#dfc29b";
    g.fillRect(b.x, b.y, b.w, b.h);
    try {
      g.drawImage(this.peelBackImage, b.x, b.y, b.w, b.h);
    } catch (_) {}
    g.restore();
    return true;
  }

  // Clips a convex polygon against the half-plane defined by dot((P - M), v) <= 0.
  // Returns the clipped polygon and up to 2 intersection points that lie on the boundary line.
  clipConvexPolygonHalfPlane(poly, M, v) {
    const out = [];
    const intersections = [];
    const vx = v.x,
      vy = v.y;
    const inside = (p) => this.dot(p.x - M.x, p.y - M.y, vx, vy) <= 0;
    const intersect = (s, e) => {
      const sx = s.x,
        sy = s.y,
        ex = e.x,
        ey = e.y;
      const dx = ex - sx,
        dy = ey - sy;
      const denom = this.dot(dx, dy, vx, vy);
      if (Math.abs(denom) < 1e-8) return null;
      const t = this.dot(M.x - sx, M.y - sy, vx, vy) / denom;
      const tt = Math.max(0, Math.min(1, t));
      return { x: sx + dx * tt, y: sy + dy * tt };
    };

    for (let i = 0; i < poly.length; i++) {
      const s = poly[i];
      const e = poly[(i + 1) % poly.length];
      const sIn = inside(s);
      const eIn = inside(e);
      if (sIn && eIn) {
        out.push(e);
      } else if (sIn && !eIn) {
        const p = intersect(s, e);
        if (p) {
          out.push(p);
          intersections.push(p);
        }
      } else if (!sIn && eIn) {
        const p = intersect(s, e);
        if (p) {
          out.push(p);
          intersections.push(p);
        }
        out.push(e);
      }
    }
    return { poly: out, intersections };
  }

  reflectPointAcrossLine(p, M, nUnit) {
    // Line is defined by (X - M)·n = 0 where n is a unit normal.
    const dx = p.x - M.x;
    const dy = p.y - M.y;
    const dist = this.dot(dx, dy, nUnit.x, nUnit.y);
    return { x: p.x - 2 * nUnit.x * dist, y: p.y - 2 * nUnit.y * dist };
  }

  computePeelHintTip(inst, hp) {
    const anchor = hp.se;
    const up = this.normalizeVec(hp.ne.x - anchor.x, hp.ne.y - anchor.y);
    const left = this.normalizeVec(hp.sw.x - anchor.x, hp.sw.y - anchor.y);
    const t = (this._peelHintAnim && this._peelHintAnim.phase) || 0;
    // Reduced pulse effect for smaller, less animated hint
    const pulse = 1 + 0.05 * Math.sin(t * 2.0);
    // Remove wobble to stop movement - set to 0
    const wobble = 0;
    const maxLen = this.computePeelMaxLen(inst);
    const diag = this.normalizeVec(up.x + left.x, up.y + left.y);
    // Reduced base size to make hint smaller
    const base = 0.03;
    const hintProgress = this.clamp01(base * pulse + wobble);
    const tip = {
      x: anchor.x + diag.x * maxLen * hintProgress,
      y: anchor.y + diag.y * maxLen * hintProgress,
    };
    const strength = this.clamp01(hintProgress / base);
    return { tip, hintProgress, strength };
  }

  applyReflectionTransform(g, mid, nUnit) {
    // Apply reflection transform across the fold line: X' = M + R*(X-M), where R = I - 2nn^T
    const nx = nUnit.x,
      ny = nUnit.y;
    const a = 1 - 2 * nx * nx;
    const b = -2 * nx * ny;
    const c = -2 * nx * ny;
    const d = 1 - 2 * ny * ny;
    const e = mid.x - (a * mid.x + c * mid.y);
    const f = mid.y - (b * mid.x + d * mid.y);
    g.transform(a, b, c, d, e, f);
  }

  drawPeelFromSource(g, inst, sourceCanvas, tip, strength) {
    if (!sourceCanvas) return;
    const hp = this.getHandlePositions(inst);
    const anchor = hp.se;
    const vx = tip.x - anchor.x;
    const vy = tip.y - anchor.y;
    const vLen = Math.hypot(vx, vy);
    if (vLen < 1e-3) return;

    const mid = { x: (anchor.x + tip.x) / 2, y: (anchor.y + tip.y) / 2 };
    const nUnit = { x: vx / vLen, y: vy / vLen };
    const paper = [hp.nw, hp.ne, hp.se, hp.sw];
    const clipped = this.clipConvexPolygonHalfPlane(paper, mid, {
      x: vx,
      y: vy,
    });
    const flapPaper = clipped.poly;
    if (!flapPaper || flapPaper.length < 3) return;

    // Cut flap region from the front.
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.moveTo(flapPaper[0].x, flapPaper[0].y);
    for (let i = 1; i < flapPaper.length; i++)
      g.lineTo(flapPaper[i].x, flapPaper[i].y);
    g.closePath();
    g.fillStyle = "#000";
    g.fill();
    g.restore();

    // Fill the exposed area with an opaque "paper underside" so the peel never looks transparent.
    g.save();
    const paperGrad = g.createLinearGradient(mid.x, mid.y, tip.x, tip.y);
    paperGrad.addColorStop(0, "rgb(240,220,190)"); // Lighter #dfc29b
    paperGrad.addColorStop(1, "rgb(223,194,155)"); // #dfc29b
    g.fillStyle = paperGrad;
    g.beginPath();
    g.moveTo(flapPaper[0].x, flapPaper[0].y);
    for (let i = 1; i < flapPaper.length; i++)
      g.lineTo(flapPaper[i].x, flapPaper[i].y);
    g.closePath();
    g.fill();
    g.restore();

    // Flap polygon in its new position (reflected).
    const flapBack = flapPaper.map((p) =>
      this.reflectPointAcrossLine(p, mid, nUnit)
    );

    // Shadow under flap.
    g.save();
    g.fillStyle = `rgba(0,0,0,${0.12 * strength})`;
    g.shadowColor = `rgba(0,0,0,${0.3 * strength})`;
    g.shadowBlur = 18 * strength + 2;
    g.shadowOffsetX = 4 * strength;
    g.shadowOffsetY = 6 * strength;
    g.beginPath();
    g.moveTo(flapBack[0].x, flapBack[0].y);
    for (let i = 1; i < flapBack.length; i++)
      g.lineTo(flapBack[i].x, flapBack[i].y);
    g.closePath();
    g.fill();
    g.restore();

    // Flap content: use custom peel-back image if provided, otherwise reflect the source.
    const drewCustomBack = this.drawPeelBackImage(g, flapBack);
    if (!drewCustomBack) {
      g.save();
      g.beginPath();
      g.moveTo(flapBack[0].x, flapBack[0].y);
      for (let i = 1; i < flapBack.length; i++)
        g.lineTo(flapBack[i].x, flapBack[i].y);
      g.closePath();
      g.clip();
      this.applyReflectionTransform(g, mid, nUnit);
      g.globalAlpha = 1;
      g.drawImage(sourceCanvas, 0, 0);
      g.restore();
    }

    // Shade the flap without introducing transparency:
    // use multiply/screen with fully opaque colors inside the flap shape.
    g.save();
    g.globalCompositeOperation = "multiply";
    const dark = g.createLinearGradient(mid.x, mid.y, tip.x, tip.y);
    const darkC = Math.round(223 - 18 * strength); // Base #dfc29b (223)
    const darkR = Math.round(223 - 18 * strength);
    const darkG = Math.round(194 - 15 * strength);
    const darkB = Math.round(155 - 12 * strength);
    dark.addColorStop(0, "rgb(223,194,155)"); // #dfc29b
    dark.addColorStop(1, `rgb(${darkR},${darkG},${darkB})`);
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(flapBack[0].x, flapBack[0].y);
    for (let i = 1; i < flapBack.length; i++)
      g.lineTo(flapBack[i].x, flapBack[i].y);
    g.closePath();
    g.fill();
    g.restore();

    g.save();
    g.globalCompositeOperation = "screen";
    const light = g.createLinearGradient(tip.x, tip.y, mid.x, mid.y);
    const lightR = Math.round(240 - 8 * strength); // Lighter #dfc29b
    const lightG = Math.round(220 - 6 * strength);
    const lightB = Math.round(190 - 5 * strength);
    light.addColorStop(0, "rgb(240,220,190)"); // Lighter #dfc29b
    light.addColorStop(1, `rgb(${lightR},${lightG},${lightB})`);
    g.fillStyle = light;
    g.beginPath();
    g.moveTo(flapBack[0].x, flapBack[0].y);
    for (let i = 1; i < flapBack.length; i++)
      g.lineTo(flapBack[i].x, flapBack[i].y);
    g.closePath();
    g.fill();
    g.restore();

    // Crease highlight.
    if (clipped.intersections && clipped.intersections.length >= 2) {
      const a0 = clipped.intersections[0];
      const b0 = clipped.intersections[1];
      g.save();
      g.strokeStyle = `rgba(223,194,155,${0.28 * strength})`; // #dfc29b
      g.lineWidth = 1.2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(a0.x, a0.y);
      g.lineTo(b0.x, b0.y);
      g.stroke();
      g.strokeStyle = `rgba(0,0,0,${0.14 * strength})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(a0.x, a0.y);
      g.lineTo(b0.x, b0.y);
      g.stroke();
      g.restore();
    }
  }

  onStageBgRendered(canvas) {
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;
    if (!this.stageBgCanvas) this.stageBgCanvas = canvas;
    if (this.stageBgCanvas !== canvas) this.stageBgCanvas = canvas;
    this.stageBgCtx = this.stageBgCanvas.getContext("2d");
    const stageW = Math.max(1, Math.round(this.stageBgCanvas.width / this.dpr));
    const stageH = Math.max(
      1,
      Math.round(this.stageBgCanvas.height / this.dpr)
    );
    // Copy the freshly rendered background as the "clean base" (in stage CSS px units).
    const base = document.createElement("canvas");
    base.width = stageW;
    base.height = stageH;
    const bg = base.getContext("2d");
    bg.clearRect(0, 0, stageW, stageH);
    try {
      bg.drawImage(
        this.stageBgCanvas,
        0,
        0,
        this.stageBgCanvas.width,
        this.stageBgCanvas.height,
        0,
        0,
        stageW,
        stageH
      );
    } catch (_) {}
    this._stageBgBase = base;
    this.redrawStageBg();
  }

  redrawStageBg() {
    if (!this.stageBgCanvas || !this.stageBgCtx) return;
    if (!this._stageBgBase) return;

    // Use the same rounding as onStageBgRendered to ensure dimensions match exactly
    const stageW = Math.max(1, Math.round(this.stageBgCanvas.width / this.dpr));
    const stageH = Math.max(
      1,
      Math.round(this.stageBgCanvas.height / this.dpr)
    );
    const g = this.stageBgCtx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, stageW, stageH);

    // When fully peeled, hide the stage background completely.
    if (this.stencilRemoved) return;

    // Draw base certificate background first.
    // Use the exact dimensions of _stageBgBase to avoid any pixel misalignment
    const fade =
      this.peelState && typeof this.peelState.fadeAlpha === "number"
        ? this.peelState.fadeAlpha
        : 1;
    g.save();
    g.globalAlpha = fade;
    // Use _stageBgBase's actual dimensions to ensure perfect alignment
    g.drawImage(
      this._stageBgBase,
      0,
      0,
      this._stageBgBase.width,
      this._stageBgBase.height,
      0,
      0,
      stageW,
      stageH
    );
    g.restore();

    const inst = this.getPeelTargetInstance();
    if (!inst) return;

    // Apply full peel if active.
    if (
      this.peelState &&
      !this.peelState.removed &&
      this.peelState.instId === inst.id &&
      this.peelState.progress > 0
    ) {
      const tip = this.peelState.tip || this.getPeelAnchor(inst);
      g.save();
      g.globalAlpha = fade;
      this.drawPeelFromSource(
        g,
        inst,
        this._stageBgBase,
        tip,
        this.clamp01(this.peelState.progress)
      );
      g.restore();
      return;
    }

    // Otherwise, show hint peel on the background too (same geometry as stencil hint).
    if (
      this.peelHintUnlocked &&
      this.peelState &&
      !this.peelState.dragging &&
      (this.peelState.progress || 0) <= 0
    ) {
      const hp = this.getHandlePositions(inst);
      const { tip, strength } = this.computePeelHintTip(inst, hp);
      g.save();
      g.globalAlpha = fade;
      this.drawPeelFromSource(g, inst, this._stageBgBase, tip, strength);
      g.restore();
    }
  }

  getPeelTargetInstance() {
    if (!this.lockedStencilMode || this.stencilRemoved) return null;
    if (!this.instances || this.instances.length === 0) return null;
    // Certificate page uses a single fixed stencil instance.
    if (this.fixedStencilKey) return this.instances[0];
    return null;
  }

  getPeelAnchor(inst) {
    const hp = this.getHandlePositions(inst);
    return hp.se;
  }

  getPeelHandleRadius(inst) {
    const size =
      Math.min(inst.bitmap.width, inst.bitmap.height) *
      Math.max(0.5, inst.scale);
    return Math.max(26, Math.min(90, size * 0.18));
  }

  computePeelMaxLen() {
    const stageW = this.guideCanvas.width / this.dpr;
    return Math.max(1, stageW * 2.5);
  }

  tryStartPeel(x, y, pointerId) {
    const inst = this.getPeelTargetInstance();
    if (!inst) return false;

    if (this.peelState && (this.peelState.dragging || this.peelState.removed))
      return false;

    const anchor = this.getPeelAnchor(inst);
    // Use an expanded hit area when the hint is visible so clicks near the hint still start peel.
    const r =
      this.getPeelHandleRadius(inst) * (this.peelHintUnlocked ? 1.65 : 1.25);
    if (Math.hypot(x - anchor.x, y - anchor.y) > r) return false;

    // Fire event to hide peel hint tooltip
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("stencil:peel-started"));
    }

    const maxLen = this.computePeelMaxLen(inst);
    this.peelState.instId = inst.id;
    this.peelState.pointerId = pointerId;
    this.peelState.anchor = anchor;
    this.peelState.vector = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    this.peelState.maxLen = maxLen;
    this.peelState.tip = { x: anchor.x, y: anchor.y };
    this.peelState.progress = 0.001;
    this.peelState.dragging = false; // Don't set dragging to true - we'll animate immediately
    this.peelState.removed = false;
    this.peelState.fadeAlpha = 1;
    this.peelState.autoTriggered = false;
    this.peelState.animToken++;

    // Immediately animate to completion and remove stencil
    this.animatePeelTo(1, {
      removeOnComplete: true,
      fadeOutOnComplete: false,
    });

    return true;
  }

  updatePeelDrag(x, y) {
    const ps = this.peelState;
    if (!ps || !ps.dragging) return;
    const inst = this.instances.find((i) => i.id === ps.instId);
    if (!inst) return;

    const hp = this.getHandlePositions(inst);
    const anchor = hp.se;
    const up = this.normalizeVec(hp.ne.x - anchor.x, hp.ne.y - anchor.y);
    const left = this.normalizeVec(hp.sw.x - anchor.x, hp.sw.y - anchor.y);
    const maxLen = ps.maxLen || this.computePeelMaxLen(inst);
    const dx = x - anchor.x;
    const dy = y - anchor.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(maxLen, dist);
    let dir =
      dist > 1e-3
        ? { x: dx / dist, y: dy / dist }
        : ps.vector || { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    // Constrain drag direction to the inside of the stencil (towards its center),
    // so the corner doesn't peel "outwards" off-canvas.
    if (dist > 1e-3) {
      const dUp = Math.max(0, dir.x * up.x + dir.y * up.y);
      const dLeft = Math.max(0, dir.x * left.x + dir.y * left.y);
      const cx = up.x * dUp + left.x * dLeft;
      const cy = up.y * dUp + left.y * dLeft;
      const clen = Math.hypot(cx, cy);
      if (clen > 1e-3) {
        dir = { x: cx / clen, y: cy / clen };
      } else {
        const diag = this.normalizeVec(up.x + left.x, up.y + left.y);
        dir = diag;
      }
    }

    ps.anchor = anchor;
    ps.maxLen = maxLen;
    ps.vector = dir;
    ps.tip = { x: anchor.x + dir.x * clamped, y: anchor.y + dir.y * clamped };
    ps.progress = this.clamp01(clamped / maxLen);
    this.redrawGuides();

    // Auto-peel: once the user drags a bit, complete automatically and fade out.
    if (
      this.autoPeelEnabled &&
      !ps.autoTriggered &&
      ps.progress >= this.autoPeelTriggerProgress
    ) {
      ps.autoTriggered = true;
      ps.dragging = false;
      ps.pointerId = null;
      this.animatePeelTo(1, {
        removeOnComplete: false,
        fadeOutOnComplete: true,
      });
    }
  }

  // Hover/press hotspot for the peel hint (bottom-right corner).
  isOverPeelHint(x, y) {
    if (!this.lockedStencilMode || this.stencilRemoved) return false;
    if (!this.peelHintUnlocked) return false;
    if (
      !this.peelState ||
      this.peelState.dragging ||
      this.peelState.progress > 0
    )
      return false;
    const inst = this.getPeelTargetInstance();
    if (!inst) return false;
    const anchor = this.getPeelAnchor(inst);
    // Expand touch zone for ease of starting peel.
    const r = this.getPeelHandleRadius(inst) * 1.65;
    const inset = r * 0.6;
    const inCircle = Math.hypot(x - anchor.x, y - anchor.y) <= r;
    const inRect =
      x >= anchor.x - inset &&
      x <= anchor.x + inset * 1.4 &&
      y >= anchor.y - inset * 0.8 &&
      y <= anchor.y + inset * 1.4;
    return inCircle || inRect;
  }

  releasePeel(forceComplete = false) {
    const ps = this.peelState;
    if (!ps || !ps.dragging) return;
    ps.dragging = false;
    ps.pointerId = null;

    const shouldRemove = forceComplete || ps.progress >= 0.8;
    this.animatePeelTo(shouldRemove ? 1 : 0, {
      removeOnComplete: shouldRemove,
    });
  }

  animatePeelTo(
    targetProgress,
    { removeOnComplete = false, fadeOutOnComplete = false } = {}
  ) {
    const ps = this.peelState;
    if (!ps) return;
    const inst = this.instances.find((i) => i.id === ps.instId) || null;
    const anchor = inst ? this.getPeelAnchor(inst) : ps.anchor;
    if (!anchor) return;

    const startProgress = ps.progress || 0;
    const startTip = ps.tip || { x: anchor.x, y: anchor.y };
    const dir = ps.vector || { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    const maxLen = ps.maxLen || (inst ? this.computePeelMaxLen(inst) : 200);
    const targetTip =
      targetProgress <= 0
        ? { x: anchor.x, y: anchor.y }
        : { x: anchor.x + dir.x * maxLen, y: anchor.y + dir.y * maxLen };

    const token = ++ps.animToken;
    const startTime = performance.now();
    const duration = 280;
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const step = (now) => {
      if (!this.peelState || this.peelState.animToken !== token) return;
      const t = this.clamp01((now - startTime) / duration);
      const e = easeOutCubic(t);
      ps.progress = startProgress + (targetProgress - startProgress) * e;
      ps.tip = {
        x: startTip.x + (targetTip.x - startTip.x) * e,
        y: startTip.y + (targetTip.y - startTip.y) * e,
      };
      this.redrawGuides();
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }

      ps.progress = targetProgress;
      ps.tip = targetTip;
      this.redrawGuides();
      if (targetProgress <= 0.001) {
        ps.progress = 0;
        ps.tip = { x: anchor.x, y: anchor.y };
        ps.fadeAlpha = 1;
        ps.autoTriggered = false;
        return;
      }

      if (fadeOutOnComplete && targetProgress >= 0.999) {
        this.startPeelFadeOut();
        return;
      }
      if (removeOnComplete && targetProgress >= 0.999) {
        this.finishPeelRemoval();
        return;
      }
    };
    requestAnimationFrame(step);
  }

  startPeelFadeOut() {
    const ps = this.peelState;
    if (!ps) return;
    const token = ++ps.animToken;
    const start = performance.now();
    const dur = this.autoPeelFadeDurationMs || 420;
    const easeIn = (t) => t * t;
    const step = (now) => {
      if (!this.peelState || this.peelState.animToken !== token) return;
      const t = this.clamp01((now - start) / dur);
      ps.fadeAlpha = 1 - easeIn(t);
      this.redrawGuides();
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      ps.fadeAlpha = 0;
      this.finishPeelRemoval();
    };
    requestAnimationFrame(step);
  }

  finishPeelRemoval() {
    if (this.stencilRemoved) return;

    // Step 1: Save the instance before clearing (needed for masking)
    const inst = this.getPeelTargetInstance();
    const instancesToMask = inst ? [inst] : this.instances.slice(); // Save a copy

    // Step 2: Composite ALL paint from strokeCanvas to paintCanvas BEFORE clearing instances
    // This ensures all paint (including black) is transferred to paintCanvas
    if (this.lockedStencilMode && inst) {
      // Temporarily set clipToStencil to false to composite ALL paint without masking
      const wasClipToStencil = this.clipToStencil;
      this.clipToStencil = false;

      // Composite all paint from strokeCanvas to paintCanvas
      this.compositeStroke();

      // Restore clipToStencil
      this.clipToStencil = wasClipToStencil;
    }

    // Step 3: Remove stencils, hide paint canvas, show base certificate immediately
    this.stencilRemoved = true;
    if (this.peelState) {
      this.peelState.removed = true;
      this.peelState.dragging = false;
      this.peelState.pointerId = null;
      this.peelState.progress = 1;
    }
    // Remove stencil instance so the guide overlay disappears
    this.instances = [];
    this.selectedIds.clear();
    this.clipToStencil = false;
    this.redrawStageBg(); // hide stage background
    this.redrawGuides();

    // Hide paint canvas and show certificate base image immediately
    const certificateBaseImg = document.getElementById("certificateBaseImage");
    const sprayCans = document.getElementById("sprayCans");
    if (this.paintCanvas) {
      this.paintCanvas.style.display = "none"; // Hide paint canvas
    }
    if (certificateBaseImg) {
      certificateBaseImg.style.display = "block"; // Show base certificate
    }
    if (sprayCans) {
      sprayCans.style.display = "none";
    }

    // Step 4: Apply masking on paint canvas (while it's hidden)
    // Now apply the stencil mask to remove excess paint outside the stencil
    if (this.lockedStencilMode && inst) {
      try {
        // Now apply the stencil mask to any paint already on paintCanvas
        // Use the same approach as compositeStroke() to ensure consistency
        // Use the saved instance(s) since we cleared this.instances earlier
        for (const instance of instancesToMask) {
          const bbox = this.rotatedBbox(instance);

          // Create a clip canvas for this stencil's bbox region
          const clip = document.createElement("canvas");
          clip.width = Math.ceil(bbox.w * this.dpr);
          clip.height = Math.ceil(bbox.h * this.dpr);
          const cg = clip.getContext("2d");
          cg.setTransform(1, 0, 0, 1, 0, 0);

          // Draw the paint canvas region into the clip canvas
          cg.drawImage(
            this.paintCanvas,
            Math.floor(bbox.x * this.dpr),
            Math.floor(bbox.y * this.dpr),
            Math.ceil(bbox.w * this.dpr),
            Math.ceil(bbox.h * this.dpr),
            0,
            0,
            Math.ceil(bbox.w * this.dpr),
            Math.ceil(bbox.h * this.dpr)
          );

          // Apply stencil mask using destination-in (same as compositeStroke)
          cg.globalCompositeOperation = "destination-in";
          const m = instance.maskCanvas;
          const sx = instance.x - bbox.x;
          const sy = instance.y - bbox.y;
          cg.save();
          cg.translate(Math.round(sx * this.dpr), Math.round(sy * this.dpr));
          cg.rotate(instance.rotation);
          cg.scale(instance.scale * this.dpr, instance.scale * this.dpr);
          cg.translate(-m.width / 2, -m.height / 2);
          cg.drawImage(m, 0, 0);
          cg.restore();

          // Clear the original region and composite the masked result back
          this.paintCtx.save();
          this.paintCtx.globalCompositeOperation = "destination-out";
          this.paintCtx.fillStyle = "#000";
          this.paintCtx.beginPath();
          // Draw a rotated rectangle to clear the exact region
          const hp = this.getHandlePositions(instance);
          this.paintCtx.moveTo(hp.nw.x, hp.nw.y);
          this.paintCtx.lineTo(hp.ne.x, hp.ne.y);
          this.paintCtx.lineTo(hp.se.x, hp.se.y);
          this.paintCtx.lineTo(hp.sw.x, hp.sw.y);
          this.paintCtx.closePath();
          this.paintCtx.fill();
          this.paintCtx.restore();

          // Composite the masked clip back onto paint canvas
          this.paintCtx.save();
          this.paintCtx.globalCompositeOperation = "source-over";
          this.paintCtx.drawImage(clip, bbox.x, bbox.y, bbox.w, bbox.h);
          this.paintCtx.restore();
        }

        // Clear the stroke layer after masking
        this.strokeCtx.clearRect(
          0,
          0,
          this.strokeCanvas.width,
          this.strokeCanvas.height
        );
        if (this.spray) {
          this.spray._strokeDirty = false;
        }
      } catch (e) {
        console.error("Error applying mask on peel:", e);
      }
    }

    // Step 5: Once masking is complete, show the masked paint canvas
    if (this.paintCanvas) {
      this.paintCanvas.style.display = ""; // Show paint canvas (remove display: none)
    }

    // Disable painting by stopping any active drawing
    if (this.spray && this.spray.isDrawing) {
      this.spray.stopDrawing();
    }
  }

  drawPeelHint(g, inst) {
    // Only show when peel is idle and stencil is present.
    if (!this.lockedStencilMode || this.stencilRemoved) return;
    if (!this.peelHintUnlocked) return;
    if (
      this.peelState &&
      (this.peelState.dragging || this.peelState.progress > 0)
    )
      return;

    const hp = this.getHandlePositions(inst);
    const anchor = hp.se;
    // Build the hint *from the stencil itself*: lift a small corner flap (reflection across fold line)
    // and cut it out of the front stencil overlay so the hint isn't a separate drawn triangle.
    const { tip, hintProgress, strength } = this.computePeelHintTip(inst, hp);

    const vx = tip.x - anchor.x;
    const vy = tip.y - anchor.y;
    const vLen = Math.hypot(vx, vy);
    if (vLen < 1e-3) return;

    // Fold line is the perpendicular bisector of anchor->tip.
    const mid = { x: (anchor.x + tip.x) / 2, y: (anchor.y + tip.y) / 2 };
    const nUnit = { x: vx / vLen, y: vy / vLen };
    const paper = [hp.nw, hp.ne, hp.se, hp.sw];
    const clipped = this.clipConvexPolygonHalfPlane(paper, mid, {
      x: vx,
      y: vy,
    });
    const flapPaper = clipped.poly;
    if (!flapPaper || flapPaper.length < 3) return;

    if (typeof window !== "undefined" && window.DEBUG_PEEL) {
      const now = performance.now();
      if (now - (this._peelDebugLastLogTs || 0) > 1000) {
        this._peelDebugLastLogTs = now;
        let area2 = 0;
        for (let i = 0; i < flapPaper.length; i++) {
          const p = flapPaper[i];
          const q = flapPaper[(i + 1) % flapPaper.length];
          area2 += p.x * q.y - q.x * p.y;
        }
        const area = Math.abs(area2) / 2;
        console.log("[peel] drawPeelHint", {
          hintProgress: +hintProgress.toFixed(3),
          tipDist: Math.round(vLen),
          flapPts: flapPaper.length,
          flapArea: Math.round(area),
          strength: +strength.toFixed(2),
        });
      }
    }

    // 1) Remove the flap area from the front overlay.
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.moveTo(flapPaper[0].x, flapPaper[0].y);
    for (let i = 1; i < flapPaper.length; i++)
      g.lineTo(flapPaper[i].x, flapPaper[i].y);
    g.closePath();
    g.fillStyle = "#000";
    g.fill();
    g.restore();

    // 2) Draw the lifted flap by reflecting the stencil bitmap across the fold line.
    const flapBack = flapPaper.map((p) =>
      this.reflectPointAcrossLine(p, mid, nUnit)
    );

    // Shadow under the flap.
    g.save();
    g.fillStyle = `rgba(0,0,0,${0.12 * strength})`;
    g.shadowColor = `rgba(0,0,0,${0.3 * strength})`;
    g.shadowBlur = 18 * strength + 2;
    g.shadowOffsetX = 4 * strength;
    g.shadowOffsetY = 6 * strength;
    g.beginPath();
    g.moveTo(flapBack[0].x, flapBack[0].y);
    for (let i = 1; i < flapBack.length; i++)
      g.lineTo(flapBack[i].x, flapBack[i].y);
    g.closePath();
    g.fill();
    g.restore();

    // Clip to the flap area (where it appears), then draw the reflected stencil.
    g.save();
    g.beginPath();
    g.moveTo(flapBack[0].x, flapBack[0].y);
    for (let i = 1; i < flapBack.length; i++)
      g.lineTo(flapBack[i].x, flapBack[i].y);
    g.closePath();
    g.clip();

    // Apply reflection transform across the fold line: X' = M + R*(X-M), where R = I - 2nn^T
    const nx = nUnit.x,
      ny = nUnit.y;
    const a = 1 - 2 * nx * nx;
    const b = -2 * nx * ny;
    const c = -2 * nx * ny;
    const d = 1 - 2 * ny * ny;
    const e = mid.x - (a * mid.x + c * mid.y);
    const f = mid.y - (b * mid.x + d * mid.y);
    g.transform(a, b, c, d, e, f);

    g.save();
    g.translate(inst.x, inst.y);
    g.rotate(inst.rotation);
    g.scale(inst.scale, inst.scale);
    g.globalAlpha = 1;
    g.drawImage(inst.bitmap, -inst.bitmap.width / 2, -inst.bitmap.height / 2);
    g.restore();
    g.restore();

    // 3) Crease along the fold line segment on the paper (subtle).
    if (clipped.intersections && clipped.intersections.length >= 2) {
      const a0 = clipped.intersections[0];
      const b0 = clipped.intersections[1];
      g.save();
      g.strokeStyle = `rgba(223,194,155,${0.32 * strength})`; // #dfc29b
      g.lineWidth = 1.2;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(a0.x, a0.y);
      g.lineTo(b0.x, b0.y);
      g.stroke();
      g.strokeStyle = `rgba(0,0,0,${0.16 * strength})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(a0.x, a0.y);
      g.lineTo(b0.x, b0.y);
      g.stroke();
      g.restore();
    }
  }

  drawPeelEffect(g, inst, peel) {
    if (!peel || peel.progress <= 0) return;

    const hp = this.getHandlePositions(inst);
    const anchor = hp.se;
    const maxLen = peel.maxLen || this.computePeelMaxLen(inst);
    const dir = peel.vector || { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    const tip = peel.tip || {
      x: anchor.x + dir.x * maxLen * peel.progress,
      y: anchor.y + dir.y * maxLen * peel.progress,
    };

    const vx = tip.x - anchor.x;
    const vy = tip.y - anchor.y;
    const vLen = Math.hypot(vx, vy);
    if (vLen < 1e-3) return;

    // Fold line is the perpendicular bisector of anchor->tip.
    const mid = { x: (anchor.x + tip.x) / 2, y: (anchor.y + tip.y) / 2 };
    const nUnit = { x: vx / vLen, y: vy / vLen }; // unit normal of fold line

    // Paper quad in stage coordinates.
    const paper = [hp.nw, hp.ne, hp.se, hp.sw];

    // Flap region (in paper space) is the half-plane containing the original corner (anchor).
    const clipped = this.clipConvexPolygonHalfPlane(paper, mid, {
      x: vx,
      y: vy,
    });
    const flapPaper = clipped.poly;
    if (!flapPaper || flapPaper.length < 3) return;

    // 1) Remove flap area from the "front" stencil overlay.
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.moveTo(flapPaper[0].x, flapPaper[0].y);
    for (let i = 1; i < flapPaper.length; i++)
      g.lineTo(flapPaper[i].x, flapPaper[i].y);
    g.closePath();
    g.fillStyle = "#000";
    g.fill();
    g.restore();

    // 2) Draw the flap moved into place (reflect across fold line).
    const flapBack = flapPaper.map((p) =>
      this.reflectPointAcrossLine(p, mid, nUnit)
    );

    const drewCustomBack = this.drawPeelBackImage(g, flapBack);
    if (drewCustomBack) {
      const strength = this.clamp01(peel.progress);
      const stageW = this.guideCanvas.width / this.dpr;
      const stageH = this.guideCanvas.height / this.dpr;
      g.save();
      g.beginPath();
      g.moveTo(flapBack[0].x, flapBack[0].y);
      for (let i = 1; i < flapBack.length; i++)
        g.lineTo(flapBack[i].x, flapBack[i].y);
      g.closePath();
      g.clip();
      g.globalCompositeOperation = "multiply";
      const dark = g.createLinearGradient(mid.x, mid.y, tip.x, tip.y);
      const darkR = Math.round(223 - 22 * strength); // Base #dfc29b (223)
      const darkG = Math.round(194 - 18 * strength);
      const darkB = Math.round(155 - 15 * strength);
      dark.addColorStop(0, "rgb(223,194,155)"); // #dfc29b
      dark.addColorStop(1, `rgb(${darkR},${darkG},${darkB})`);
      g.fillStyle = dark;
      g.fillRect(0, 0, stageW, stageH);
      g.restore();

      g.save();
      g.beginPath();
      g.moveTo(flapBack[0].x, flapBack[0].y);
      for (let i = 1; i < flapBack.length; i++)
        g.lineTo(flapBack[i].x, flapBack[i].y);
      g.closePath();
      g.clip();
      g.globalCompositeOperation = "screen";
      const light = g.createLinearGradient(tip.x, tip.y, mid.x, mid.y);
      const lightR = Math.round(240 - 10 * strength); // Lighter #dfc29b
      const lightG = Math.round(220 - 8 * strength);
      const lightB = Math.round(190 - 7 * strength);
      light.addColorStop(0, "rgb(240,220,190)"); // Lighter #dfc29b
      light.addColorStop(1, `rgb(${lightR},${lightG},${lightB})`);
      g.fillStyle = light;
      g.fillRect(0, 0, stageW, stageH);
      g.restore();
    } else {
      g.save();
      const grad = g.createLinearGradient(mid.x, mid.y, tip.x, tip.y);
      // Keep the peeled flap fully opaque (no see-through).
      // Use color (not alpha) to suggest shading.
      const shade = this.clamp01(peel.progress);
      // Convert grayscale to #dfc29b variations
      const r0 = Math.round(240 - 8 * shade); // Lighter #dfc29b
      const g0 = Math.round(220 - 6 * shade);
      const b0 = Math.round(190 - 5 * shade);
      const r1 = Math.round(223 - 20 * shade); // Base #dfc29b
      const g1 = Math.round(194 - 18 * shade);
      const b1 = Math.round(155 - 15 * shade);
      const r2 = Math.round(200 - 30 * shade); // Darker #dfc29b
      const g2 = Math.round(170 - 25 * shade);
      const b2 = Math.round(130 - 20 * shade);
      grad.addColorStop(0, `rgb(${r0},${g0},${b0})`);
      grad.addColorStop(0.6, `rgb(${r1},${g1},${b1})`);
      grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(flapBack[0].x, flapBack[0].y);
      for (let i = 1; i < flapBack.length; i++)
        g.lineTo(flapBack[i].x, flapBack[i].y);
      g.closePath();
      g.fill();
      g.restore();
    }

    // 3) Draw a subtle crease along the fold line segment on the paper.
    if (clipped.intersections && clipped.intersections.length >= 2) {
      const a = clipped.intersections[0];
      const b = clipped.intersections[1];
      g.save();
      g.strokeStyle = `rgba(0,0,0,${0.16 * peel.progress})`;
      g.lineWidth = 1.25;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.restore();
    }
  }
}

// bootstrap
(() => {
  const app = new StencilApp();
  // Store globally for tooltip management and debugging
  window.stencilApp = app;
})();
