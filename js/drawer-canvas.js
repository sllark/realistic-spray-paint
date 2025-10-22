class CanvasDrawer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.sprayPaint = null;

    // Canvas setup
    this.setupCanvas();
    this.setupEventListeners();

    // Performance monitoring
    this.frameCount = 0;
    this.lastFpsTime = 0;
    this.fps = 60;
  }

  setupCanvas() {
    // Set canvas to full screen with device pixel ratio
    this.resizeCanvas();

    // Set initial canvas properties
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";

    // Listen for window resize
    window.addEventListener("resize", () => this.resizeCanvas());
  }

  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();

    // Set display size
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";

    // Set actual canvas size with device pixel ratio
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;

    // Scale context to match device pixel ratio
    this.ctx.scale(dpr, dpr);

    // Update canvas size for drawing operations
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setupEventListeners() {
    // Mouse events
    this.canvas.addEventListener("mousedown", (e) => this.handleStart(e));
    this.canvas.addEventListener("mousemove", (e) => this.handleMove(e));
    this.canvas.addEventListener("mouseup", (e) => this.handleEnd(e));
    this.canvas.addEventListener("mouseleave", (e) => this.handleEnd(e));

    // Touch events
    this.canvas.addEventListener("touchstart", (e) => this.handleTouchStart(e));
    this.canvas.addEventListener("touchmove", (e) => this.handleTouchMove(e));
    this.canvas.addEventListener("touchend", (e) => this.handleTouchEnd(e));
    this.canvas.addEventListener("touchcancel", (e) => this.handleTouchEnd(e));

    // Prevent context menu
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Prevent scrolling on touch devices
    this.canvas.addEventListener("touchmove", (e) => e.preventDefault(), {
      passive: false,
    });
  }

  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  getTouchPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const touch = e.touches[0];
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  getPressure(e) {
    // Simulate pressure based on mouse button or touch force
    if (e.pressure !== undefined) {
      return Math.max(0.1, Math.min(1.0, e.pressure));
    }

    // Default pressure for mouse
    return 1.0;
  }

  handleStart(e) {
    e.preventDefault();
    const pos = this.getMousePos(e);
    const pressure = this.getPressure(e);

    if (this.sprayPaint) {
      this.sprayPaint.startDrawing(pos.x, pos.y, pressure);
    }
  }

  handleMove(e) {
    e.preventDefault();
    const pos = this.getMousePos(e);
    const pressure = this.getPressure(e);

    if (this.sprayPaint && this.sprayPaint.isDrawing) {
      this.sprayPaint.draw(pos.x, pos.y, pressure);
    }
  }

  handleEnd(e) {
    e.preventDefault();

    if (this.sprayPaint) {
      this.sprayPaint.stopDrawing();
    }
  }

  handleTouchStart(e) {
    e.preventDefault();
    const pos = this.getTouchPos(e);
    const pressure = this.getPressure(e);

    if (this.sprayPaint) {
      this.sprayPaint.startDrawing(pos.x, pos.y, pressure);
    }
  }

  handleTouchMove(e) {
    e.preventDefault();
    const pos = this.getTouchPos(e);
    const pressure = this.getPressure(e);

    if (this.sprayPaint && this.sprayPaint.isDrawing) {
      this.sprayPaint.draw(pos.x, pos.y, pressure);
    }
  }

  handleTouchEnd(e) {
    e.preventDefault();

    if (this.sprayPaint) {
      this.sprayPaint.stopDrawing();
    }
  }

  setSprayPaint(sprayPaint) {
    this.sprayPaint = sprayPaint;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.sprayPaint) {
      this.sprayPaint.clear();
    }
  }

  exportPNG() {
    // Create a temporary canvas for export
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = this.canvas.width;
    exportCanvas.height = this.canvas.height;
    const exportCtx = exportCanvas.getContext("2d");

    // Fill with white background
    exportCtx.fillStyle = "#ffffff";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw the spray canvas content
    exportCtx.drawImage(this.canvas, 0, 0);

    // Convert to PNG and download
    const dataURL = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `spray-paint-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
  }

  // Performance monitoring
  updateFPS() {
    this.frameCount++;
    const now = performance.now();

    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;

      // Clean up cache if performance is low
      if (this.fps < 45 && this.sprayPaint) {
        this.sprayPaint.cleanupCache();
      }
    }
  }

  // Animation loop for drips and performance monitoring
  startAnimationLoop() {
    const animate = () => {
      this.updateFPS();
      requestAnimationFrame(animate);
    };
    animate();
  }
}
