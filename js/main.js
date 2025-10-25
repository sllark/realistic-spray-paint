// Main application controller
class SprayPaintApp {
  constructor() {
    this.canvasDrawer = null;
    this.sprayPaint = null;
    this.shapeDrawer = null;

    // UI elements
    this.colorPicker = null;
    this.nozzleSlider = null;
    this.softnessSlider = null;
    this.opacitySlider = null;
    this.flowSlider = null;
    this.scatterRadiusSlider = null;
    this.scatterAmountSlider = null;
    this.scatterSizeSlider = null;
    this.overspraySlider = null;
    this.distanceSlider = null;
    this.dripThresholdSlider = null;
    this.dripGravitySlider = null;
    this.dripViscositySlider = null;
    this.dripEvaporationSlider = null;
    this.dripToggleBtn = null;
    this.goldColorBtn = null;
    this.blackColorBtn = null;
    this.clearBtn = null;
    this.exportBtn = null;

    // Value displays
    this.nozzleValue = null;
    this.softnessValue = null;
    this.opacityValue = null;
    this.flowValue = null;
    this.scatterRadiusValue = null;
    this.scatterAmountValue = null;
    this.scatterSizeValue = null;
    this.oversprayValue = null;
    this.distanceValue = null;
    this.dripThresholdValue = null;
    this.dripGravityValue = null;
    this.dripViscosityValue = null;
    this.dripEvaporationValue = null;

    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.setup());
    } else {
      this.setup();
    }
  }

  setup() {
    try {
      // Initialize canvas drawer
      this.canvasDrawer = new CanvasDrawer("sprayCanvas");

      // Initialize spray paint
      this.sprayPaint = new SprayPaint(
        this.canvasDrawer.canvas,
        this.canvasDrawer.ctx
      );

      // start drip simulation
      this.sprayPaint.startDripLoop();

      // Initialize shape drawer
      this.shapeDrawer = new ShapeDrawer(this.sprayPaint);

      // Connect canvas drawer to spray paint
      this.canvasDrawer.setSprayPaint(this.sprayPaint);

      // Setup UI controls
      this.setupUIControls();

      // Start animation loop
      this.canvasDrawer.startAnimationLoop();

      console.log("Spray Paint App initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Spray Paint App:", error);
    }
  }

  setupUIControls() {
    // Get UI elements
    this.colorPicker = document.getElementById("colorPicker");
    this.nozzleSlider = document.getElementById("nozzleSlider");
    this.softnessSlider = document.getElementById("softnessSlider");
    this.opacitySlider = document.getElementById("opacitySlider");
    this.flowSlider = document.getElementById("flowSlider");
    this.scatterRadiusSlider = document.getElementById("scatterRadiusSlider");
    this.scatterAmountSlider = document.getElementById("scatterAmountSlider");
    this.scatterSizeSlider = document.getElementById("scatterSizeSlider");
    this.overspraySlider = document.getElementById("overspraySlider");
    this.distanceSlider = document.getElementById("distanceSlider");
    this.dripThresholdSlider = document.getElementById("dripThresholdSlider");
    this.dripGravitySlider = document.getElementById("dripGravitySlider");
    this.dripViscositySlider = document.getElementById("dripViscositySlider");
    this.dripEvaporationSlider = document.getElementById(
      "dripEvaporationSlider"
    );
    this.dripToggleBtn = document.getElementById("dripToggleBtn");
    this.goldColorBtn = document.getElementById("goldColorBtn");
    this.blackColorBtn = document.getElementById("blackColorBtn");
    this.clearBtn = document.getElementById("clearBtn");
    this.exportBtn = document.getElementById("exportBtn");

    // Get value displays
    this.nozzleValue = document.getElementById("nozzleValue");
    this.softnessValue = document.getElementById("softnessValue");
    this.opacityValue = document.getElementById("opacityValue");
    this.flowValue = document.getElementById("flowValue");
    this.scatterRadiusValue = document.getElementById("scatterRadiusValue");
    this.scatterAmountValue = document.getElementById("scatterAmountValue");
    this.scatterSizeValue = document.getElementById("scatterSizeValue");
    this.oversprayValue = document.getElementById("oversprayValue");
    this.distanceValue = document.getElementById("distanceValue");
    this.dripThresholdValue = document.getElementById("dripThresholdValue");
    this.dripGravityValue = document.getElementById("dripGravityValue");
    this.dripViscosityValue = document.getElementById("dripViscosityValue");
    this.dripEvaporationValue = document.getElementById("dripEvaporationValue");

    // Setup event listeners
    this.setupEventListeners();

    // Set initial values
    this.updateDisplayValues();
  }

  setupEventListeners() {
    // Color picker
    this.colorPicker.addEventListener("input", (e) => {
      this.sprayPaint.setColor(e.target.value);
      this.updateColorPresetButtons(e.target.value);
    });

    // Nozzle size slider
    this.nozzleSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setNozzleSize(value);
      this.nozzleValue.textContent = value;
    });

    // Softness slider
    this.softnessSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setSoftness(value);
      this.softnessValue.textContent = value + "%";
    });

    // Opacity slider
    this.opacitySlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setOpacity(value);
      this.opacityValue.textContent = value + "%";
    });

    // Flow slider
    this.flowSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setFlow(value);
      this.flowValue.textContent = value + "%";
    });

    // Scatter radius slider
    this.scatterRadiusSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setScatterRadius(value);
      this.scatterRadiusValue.textContent = value + "%";
    });

    // Scatter amount slider
    this.scatterAmountSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setScatterAmount(value);
      this.scatterAmountValue.textContent = value + "%";
    });

    // Scatter size slider
    this.scatterSizeSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setScatterSize(value);
      this.scatterSizeValue.textContent = value + "%";
    });

    // Overspray slider
    this.overspraySlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setOverspray(value);
      this.oversprayValue.textContent = value + "%";
    });

    // Distance slider
    this.distanceSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setDistance(value);
      this.distanceValue.textContent = value + "px";
    });

    // Drip threshold slider
    this.dripThresholdSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setDripThreshold(value);
      this.dripThresholdValue.textContent = value + "%";
    });

    // Drip gravity slider
    this.dripGravitySlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      this.sprayPaint.setDripGravity(value);
      this.dripGravityValue.textContent = value;
    });

    // Drip viscosity slider
    this.dripViscositySlider.addEventListener("input", (e) => {
      const value = parseFloat(e.target.value);
      this.sprayPaint.setDripViscosity(value);
      this.dripViscosityValue.textContent = value.toFixed(1);
    });

    // Drip evaporation slider
    this.dripEvaporationSlider.addEventListener("input", (e) => {
      const value = parseFloat(e.target.value);
      this.sprayPaint.setDripEvaporation(value);
      this.dripEvaporationValue.textContent = (value / 100).toFixed(2);
    });

    // Drip toggle button
    this.dripToggleBtn.addEventListener("click", () => {
      const enabled = this.sprayPaint.toggleDrips();
      this.dripToggleBtn.textContent = enabled
        ? "Disable Drips"
        : "Enable Drips";
      this.dripToggleBtn.style.backgroundColor = enabled
        ? "#4CAF50"
        : "#f44336";
    });

    // Clear button
    this.clearBtn.addEventListener("click", () => {
      this.canvasDrawer.clear();
    });

    // Export button
    this.exportBtn.addEventListener("click", () => {
      this.canvasDrawer.exportPNG();
    });

    // Color preset buttons
    this.goldColorBtn.addEventListener("click", () => {
      this.setColor("#EAC677");
      this.updateColorPresetButtons("#EAC677");
    });

    this.blackColorBtn.addEventListener("click", () => {
      this.setColor("#221F20");
      this.updateColorPresetButtons("#221F20");
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      this.handleKeyboard(e);
    });
  }

  handleKeyboard(e) {
    // Prevent default for our shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "s":
          e.preventDefault();
          this.canvasDrawer.exportPNG();
          break;
        case "z":
          e.preventDefault();
          this.canvasDrawer.clear();
          break;
      }
    }

    // Number keys for quick nozzle size changes
    if (e.key >= "1" && e.key <= "9") {
      const size = parseInt(e.key) * 6;
      this.sprayPaint.setNozzleSize(size);
      this.nozzleSlider.value = size;
      this.nozzleValue.textContent = size;
    }

    // Space bar to toggle drips
    if (e.key === " ") {
      e.preventDefault();
      const enabled = this.sprayPaint.toggleDrips();
      this.dripToggleBtn.textContent = enabled
        ? "Disable Drips"
        : "Enable Drips";
      this.dripToggleBtn.style.backgroundColor = enabled
        ? "#4CAF50"
        : "#f44336";
    }

    // 'M' key to toggle scatter controls visibility
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      const scatterControls = document.querySelectorAll('[id*="scatter"]');
      scatterControls.forEach((control) => {
        const parent = control.closest(".control-group");
        if (parent) {
          parent.style.display =
            parent.style.display === "none" ? "flex" : "none";
        }
      });
    }

    // 'D' key to toggle drip controls visibility
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      const dripControls = document.querySelectorAll('[id*="drip"]');
      dripControls.forEach((control) => {
        const parent = control.closest(".control-group");
        if (parent) {
          parent.style.display =
            parent.style.display === "none" ? "flex" : "none";
        }
      });
    }
  }

  updateDisplayValues() {
    // Set initial values from sliders
    this.nozzleValue.textContent = this.nozzleSlider.value;
    this.softnessValue.textContent = this.softnessSlider.value + "%";
    this.opacityValue.textContent = this.opacitySlider.value + "%";
    this.flowValue.textContent = this.flowSlider.value + "%";
    this.scatterRadiusValue.textContent = this.scatterRadiusSlider.value + "%";
    this.scatterAmountValue.textContent = this.scatterAmountSlider.value + "%";
    this.scatterSizeValue.textContent = this.scatterSizeSlider.value + "%";
    this.oversprayValue.textContent = this.overspraySlider.value + "%";
    this.distanceValue.textContent = this.distanceSlider.value + "px";
    this.dripThresholdValue.textContent = this.dripThresholdSlider.value + "%";
    this.dripGravityValue.textContent = this.dripGravitySlider.value;
    this.dripViscosityValue.textContent = this.dripViscositySlider.value;
    this.dripEvaporationValue.textContent = (
      parseFloat(this.dripEvaporationSlider.value) / 100
    ).toFixed(2);

    // Set initial spray paint values
    this.sprayPaint.setColor(this.colorPicker.value);
    this.sprayPaint.setNozzleSize(parseInt(this.nozzleSlider.value));
    this.sprayPaint.setSoftness(parseInt(this.softnessSlider.value));
    this.sprayPaint.setOpacity(parseInt(this.opacitySlider.value));
    this.sprayPaint.setFlow(parseInt(this.flowSlider.value));
    this.sprayPaint.setScatterRadius(parseInt(this.scatterRadiusSlider.value));
    this.sprayPaint.setScatterAmount(parseInt(this.scatterAmountSlider.value));
    this.sprayPaint.setScatterSize(parseInt(this.scatterSizeSlider.value));
    this.sprayPaint.setOverspray(parseInt(this.overspraySlider.value));
    this.sprayPaint.setDistance(parseInt(this.distanceSlider.value));
    this.sprayPaint.setDripThreshold(parseInt(this.dripThresholdSlider.value));
    this.sprayPaint.setDripGravity(parseInt(this.dripGravitySlider.value));
    this.sprayPaint.setDripViscosity(
      parseFloat(this.dripViscositySlider.value)
    );
    this.sprayPaint.setDripEvaporation(
      parseFloat(this.dripEvaporationSlider.value)
    );
  }

  // Public methods for external control
  setColor(color) {
    this.sprayPaint.setColor(color);
    this.colorPicker.value = color;
    this.updateColorPresetButtons(color);
  }

  updateColorPresetButtons(currentColor) {
    // Remove active class from all preset buttons
    this.goldColorBtn.classList.remove("active");
    this.blackColorBtn.classList.remove("active");

    // Add active class to matching button
    if (currentColor === "#EAC677") {
      this.goldColorBtn.classList.add("active");
    } else if (currentColor === "#221F20") {
      this.blackColorBtn.classList.add("active");
    }
  }

  setNozzleSize(size) {
    this.sprayPaint.setNozzleSize(size);
    this.nozzleSlider.value = size;
    this.nozzleValue.textContent = size;
  }

  setSoftness(softness) {
    this.sprayPaint.setSoftness(softness);
    this.softnessSlider.value = softness;
    this.softnessValue.textContent = softness + "%";
  }

  setOpacity(opacity) {
    this.sprayPaint.setOpacity(opacity);
    this.opacitySlider.value = opacity;
    this.opacityValue.textContent = opacity + "%";
  }

  setFlow(flow) {
    this.sprayPaint.setFlow(flow);
    this.flowSlider.value = flow;
    this.flowValue.textContent = flow + "%";
  }

  clear() {
    this.canvasDrawer.clear();
  }

  exportPNG() {
    this.canvasDrawer.exportPNG();
  }

  // Utility methods
  getSprayPaint() {
    return this.sprayPaint;
  }

  getShapeDrawer() {
    return this.shapeDrawer;
  }

  getCanvasDrawer() {
    return this.canvasDrawer;
  }
}

// Initialize the app when the script loads
const app = new SprayPaintApp();

// Make app globally available for debugging
window.sprayPaintApp = app;
