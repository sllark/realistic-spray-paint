/**
 * Shake-to-Spray Prank Feature
 *
 * A hidden spray painting prank that activates when the user shakes their phone:
 * 1. Shake phone → hear spray can rattling
 * 2. After a few seconds of motion → spray paint hissing sound
 * 3. Black screen overlay (no UI)
 * 4. Continues as long as phone is shaken
 * 5. After shaking stops → fade out and return to certificate view
 */

class ShakeSprayPrank {
  constructor() {
    this.isActive = false;
    this.isShaking = false;
    this.shakeStartTime = null;
    this.lastShakeTime = null;
    this.shakeThreshold = 26; // Tuned threshold to reduce false positives without needing an aggressive shake
    this.shakeTimeout = null;
    this.stopCountdownTimeout = null;
    this.audioUnlocked = false; // Track if audio has been unlocked via user interaction
    this.motionDetectionActive = false;

    // Timing constants
    this.RATTLE_PLAY_COUNT = 1; // Play rattle once, then switch to spray
    this.RATTLE_PLAY_COUNT_CURRENT = 0; // Track current rattle play count
    this.SHAKE_STOP_DELAY_MS = 3000; // How long to wait after shaking stops before fading out
    this.FADE_OUT_DURATION_MS = 1000; // Fade out duration
    this.ORIENTATION_SHAKE_THRESHOLD = 14; // Orientation-based shake sensitivity

    // Audio elements
    this.rattleAudio = null;
    this.sprayAudio = null;

    // UI elements
    this.blackScreenOverlay = null;
    this.permissionMessage = null;

    // Motion data
    this.lastAcceleration = { x: 0, y: 0, z: 0 };
    this.lastOrientation = null;
    this.motionPermissionGranted = false;
    this.useOrientationFallback = false;

    this.init();
  }

  init() {
    // Create black screen overlay
    this.createBlackScreen();

    // Load audio files
    this.loadAudio();

    // Request motion permission (but don't start listening yet)
    this.requestMotionPermission();

    // Create debug panel for mobile testing
    this.createDebugPanel();

    // Set up user gesture listeners to unlock audio early
    this.setupAudioUnlock();

    // Wait for user interaction to unlock audio, then wait for shake
    // TODO: Move this to activate after certificate completion
    this.waitForUserInteraction();
  }

  createDebugPanel() {
    // Create a debug panel to show logs on mobile
    this.debugPanel = document.createElement("div");
    this.debugPanel.id = "shakeSprayDebugPanel";
    this.debugPanel.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      right: 10px;
      max-height: 200px;
      overflow-y: auto;
      background-color: rgba(0, 0, 0, 0.8);
      color: #00ff00;
      font-family: monospace;
      font-size: 12px;
      padding: 10px;
      border-radius: 5px;
      z-index: 100000;
      pointer-events: auto;
      display: none;
    `;
    document.body.appendChild(this.debugPanel);

    // Add toggle button
    const toggleBtn = document.createElement("button");
    toggleBtn.textContent = "Debug";
    toggleBtn.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      border: 1px solid #fff;
      padding: 5px 10px;
      border-radius: 3px;
      z-index: 100001;
      font-size: 12px;
    `;
    toggleBtn.addEventListener("click", () => {
      const isVisible = this.debugPanel.style.display !== "none";
      this.debugPanel.style.display = isVisible ? "none" : "block";
      toggleBtn.textContent = isVisible ? "Debug" : "Hide";
    });
    document.body.appendChild(toggleBtn);

    // Override console.log to also show in panel
    this.originalLog = console.log;
    console.log = (...args) => {
      this.originalLog.apply(console, args);
      this.addDebugLog(args.join(" "));
    };

    this.addDebugLog("Debug panel ready");
  }

  addDebugLog(message) {
    if (!this.debugPanel) return;

    const logEntry = document.createElement("div");
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEntry.style.marginBottom = "5px";
    this.debugPanel.appendChild(logEntry);

    // Keep only last 20 logs
    while (this.debugPanel.children.length > 20) {
      this.debugPanel.removeChild(this.debugPanel.firstChild);
    }

    // Auto-scroll to bottom
    this.debugPanel.scrollTop = this.debugPanel.scrollHeight;
  }

  createBlackScreen() {
    this.blackScreenOverlay = document.createElement("div");
    this.blackScreenOverlay.id = "shakeSprayBlackScreen";
    this.blackScreenOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: #000000;
      z-index: 99999;
      opacity: 0;
      pointer-events: none;
      transition: opacity ${this.FADE_OUT_DURATION_MS}ms ease-out;
    `;
    document.body.appendChild(this.blackScreenOverlay);
  }

  loadAudio() {
    // Load rattle audio (spray can shaking) - should play first
    this.rattleAudio = new Audio("assets/audio/shaking-can-spray-paint.wav");
    this.rattleAudio.loop = false;
    this.rattleAudio.volume = 0.8;

    // Load spray audio (spray paint hissing) - should play after rattles
    this.sprayAudio = new Audio("assets/audio/aerosol-can-spray.wav");
    this.sprayAudio.loop = true;
    this.sprayAudio.volume = 0.8;

    // Preload audio
    this.rattleAudio.load();
    this.sprayAudio.load();
  }

  setupAudioUnlock() {
    const unlockHandler = () => {
      this.unlockAudio();
      this.startMotionDetection();
    };

    ["touchstart", "pointerdown", "click"].forEach((eventName) => {
      window.addEventListener(eventName, unlockHandler, {
        once: true,
        capture: true,
      });
    });
  }

  unlockAudio() {
    if (this.audioUnlocked) return;

    this.audioUnlocked = true;
    this.addDebugLog("🔓 Audio unlocked via user gesture");

    [this.rattleAudio, this.sprayAudio].forEach((audioEl) => {
      if (!audioEl) return;
      const wasMuted = audioEl.muted;
      audioEl.muted = true;
      audioEl
        .play()
        .then(() => {
          audioEl.pause();
          audioEl.currentTime = 0;
        })
        .catch((error) => {
          this.addDebugLog(`⚠️ Audio unlock failed: ${error.message}`);
        })
        .finally(() => {
          audioEl.muted = wasMuted;
        });
    });
  }

  async requestMotionPermission() {
    // Try to request permission for DeviceMotionEvent (iOS 13+)
    // This MUST be called from a user gesture handler
    if (
      typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function"
    ) {
      try {
        const permission = await DeviceMotionEvent.requestPermission();
        this.motionPermissionGranted = permission === "granted";
        this.addDebugLog(`DeviceMotionEvent permission: ${permission}`);

        if (permission === "granted") {
          this.addDebugLog("✅ Motion permission GRANTED");
        } else if (permission === "denied") {
          this.addDebugLog("❌ Motion permission DENIED");
          this.addDebugLog("💡 Trying fallback method...");
          // Try fallback method even if permission denied
          this.tryFallbackMotionDetection();
        } else {
          this.addDebugLog("⚠️ Motion permission: " + permission);
        }
      } catch (error) {
        console.warn(
          "[ShakeSpray] DeviceMotionEvent permission request failed:",
          error
        );
        this.addDebugLog(`❌ Permission request error: ${error.message}`);
        // Try fallback method
        this.tryFallbackMotionDetection();
      }
    } else {
      // Permission not required (Android, older iOS, or iOS 18+)
      this.motionPermissionGranted = true;
      this.addDebugLog("DeviceMotionEvent permission not required");
    }
  }

  async tryFallbackMotionDetection() {
    // Try to use motion events without explicit permission
    // Some iOS versions allow this, or we can try DeviceOrientationEvent
    this.addDebugLog("Trying fallback motion detection...");

    // Try DeviceOrientationEvent as fallback
    // iOS 13+ also requires permission for DeviceOrientationEvent
    if (typeof DeviceOrientationEvent !== "undefined") {
      this.addDebugLog("DeviceOrientationEvent available");

      // Check if we need to request permission for orientation too
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        try {
          this.addDebugLog("Requesting DeviceOrientationEvent permission...");
          const permission = await DeviceOrientationEvent.requestPermission();
          this.addDebugLog(`DeviceOrientationEvent permission: ${permission}`);

          if (permission === "granted") {
            this.useOrientationFallback = true;
            this.motionPermissionGranted = true;
            this.addDebugLog("✅ Orientation permission granted!");
          } else {
            this.addDebugLog("❌ Orientation permission denied");
            this.showPermissionDeniedMessage();
          }
        } catch (error) {
          this.addDebugLog(`Orientation permission error: ${error.message}`);
          // Try anyway
          this.useOrientationFallback = true;
          this.motionPermissionGranted = true;
        }
      } else {
        // No permission required, use it directly
        this.addDebugLog("No permission required for DeviceOrientationEvent");
        this.useOrientationFallback = true;
        this.motionPermissionGranted = true;
      }
    } else {
      this.addDebugLog("No fallback available - shake detection disabled");
      this.showPermissionDeniedMessage();
    }
  }

  showPermissionDeniedMessage() {
    // Show a user-friendly message about enabling motion permission
    if (this.permissionMessage) return; // Already showing

    this.permissionMessage = document.createElement("div");
    this.permissionMessage.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      color: #fff;
      padding: 20px;
      border-radius: 10px;
      z-index: 100002;
      max-width: 300px;
      text-align: center;
      font-size: 14px;
      line-height: 1.5;
    `;
    this.permissionMessage.innerHTML = `
      <div style="margin-bottom: 15px; font-weight: bold;">Motion Permission Required</div>
      <div style="margin-bottom: 15px;">
        To use the shake feature, please enable Motion & Orientation access:
      </div>
      <div style="margin-bottom: 15px; font-size: 12px; color: #ccc;">
        iOS 18: Settings → Safari → Advanced → Motion & Orientation<br/>
        Or try refreshing the page after granting permission
      </div>
      <button id="closePermissionMsg" style="
        background: #007AFF;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 5px;
        font-size: 14px;
        cursor: pointer;
      ">OK</button>
    `;
    document.body.appendChild(this.permissionMessage);

    document
      .getElementById("closePermissionMsg")
      .addEventListener("click", () => {
        if (this.permissionMessage && this.permissionMessage.parentNode) {
          this.permissionMessage.parentNode.removeChild(this.permissionMessage);
          this.permissionMessage = null;
        }
      });

    // Auto-hide after 10 seconds
    setTimeout(() => {
      if (this.permissionMessage && this.permissionMessage.parentNode) {
        this.permissionMessage.parentNode.removeChild(this.permissionMessage);
        this.permissionMessage = null;
      }
    }, 10000);
  }

  waitForUserInteraction() {
    // Check if we're on mobile
    const isMobile =
      navigator.userAgent.match(/mobile/i) ||
      navigator.userAgent.match(/Android/i);

    if (isMobile) {
      // Check if permission request is needed (iOS 13+)
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        // Set timeout to show permission modal (like the reference code)
        this.permissionTimeoutId = setTimeout(() => {
          this.showPermissionRequestModal();
        }, 500);

        // Listen for deviceorientation events - if we get one, permission is already granted
        const checkPermission = (e) => {
          clearTimeout(this.permissionTimeoutId);
          window.removeEventListener("deviceorientation", checkPermission);

          // Permission already granted, start detection
          this.useOrientationFallback =
            typeof window.DeviceMotionEvent === "undefined";
          this.motionPermissionGranted = true;
          this.addDebugLog(
            "✅ Motion permission already granted - waiting for tap to unlock audio"
          );
        };

        window.addEventListener("deviceorientation", checkPermission, {
          once: true,
        });
        this.addDebugLog("Checking for existing permission...");
      } else {
        // No permission required (Android, older iOS)
        this.useOrientationFallback =
          typeof window.DeviceMotionEvent === "undefined";
        this.motionPermissionGranted = true;
        this.addDebugLog(
          "No permission required - waiting for tap to unlock audio"
        );
      }
    } else {
      // Desktop - no motion detection needed
      this.addDebugLog("Desktop detected - motion detection not available");
    }
  }

  showPermissionRequestModal() {
    // Create modal to request motion/orientation permission (following reference pattern)
    const modal = document.createElement("div");
    modal.className = "shake-spray-permission-modal";
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      z-index: 100003;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const modalContent = document.createElement("div");
    modalContent.id = "requestmodal";
    modalContent.style.cssText = `
      background: rgba(0, 0, 0, 0.95);
      color: #fff;
      padding: 30px;
      border-radius: 15px;
      max-width: 320px;
      text-align: center;
      border: 2px solid #fff;
      cursor: pointer;
    `;

    modalContent.innerHTML = `
      <div style="margin-bottom: 20px; font-size: 16px; line-height: 1.5;">
        To use the shake feature, Safari needs access to Device Motion and Orientation
      </div>
      <button style="
        background: #007AFF;
        color: white;
        border: none;
        padding: 15px 30px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        cursor: pointer;
      ">OK</button>
    `;

    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Request permission when modal is clicked (following reference pattern exactly)
    modalContent.addEventListener("click", (event) => {
      // Hide modal first (like reference code)
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }

      this.addDebugLog("Permission request button clicked");

      // Request DeviceOrientationEvent permission (exactly like reference code)
      if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
      ) {
        DeviceOrientationEvent.requestPermission()
          .then((permissionState) => {
            this.addDebugLog(
              `DeviceOrientationEvent permission: ${permissionState}`
            );

            if (permissionState === "granted") {
              this.useOrientationFallback =
                typeof window.DeviceMotionEvent === "undefined";
              this.motionPermissionGranted = true;
              this.unlockAudio();
              this.startMotionDetection();
              this.addDebugLog(
                "✅ Permission granted! Shake your phone to start the prank!"
              );
            } else {
              // Permission denied - show message (exactly like reference code)
              modalContent.innerHTML =
                "Permission denied. Please restart Safari to clear permissions and try again.";
              document.body.appendChild(modal);
              this.addDebugLog("❌ Permission denied");
            }
          })
          .catch((error) => {
            this.addDebugLog(`❌ Permission request error: ${error.message}`);
            // Show error message
            modalContent.innerHTML = `Error: ${error.message}`;
            document.body.appendChild(modal);
          });
      } else {
        // No permission required
        this.unlockAudio();
        this.useOrientationFallback =
          typeof window.DeviceMotionEvent === "undefined";
        this.motionPermissionGranted = true;
        this.startMotionDetection();
        this.addDebugLog("No permission required - motion detection started!");
      }
    });
  }

  activate() {
    if (this.isActive) return;

    this.isActive = true;
    this.showBlackScreen();
    this.startMotionDetection();

    this.addDebugLog("🎉 Prank activated - black screen shown!");
  }

  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.isShaking = false;
    this.shakeStartTime = null;
    this.stopAllAudio();
    this.hideBlackScreen();

    // Reset rattle play count
    this.RATTLE_PLAY_COUNT_CURRENT = 0;

    // Clear any pending timeouts
    if (this.shakeTimeout) {
      clearTimeout(this.shakeTimeout);
      this.shakeTimeout = null;
    }
    if (this.stopCountdownTimeout) {
      clearTimeout(this.stopCountdownTimeout);
      this.stopCountdownTimeout = null;
    }

    console.log("[ShakeSpray] Prank deactivated");
  }

  showBlackScreen() {
    if (!this.blackScreenOverlay) return;

    this.blackScreenOverlay.style.pointerEvents = "auto";
    this.blackScreenOverlay.style.opacity = "1";
  }

  hideBlackScreen() {
    if (!this.blackScreenOverlay) return;

    this.blackScreenOverlay.style.opacity = "0";

    // Remove pointer events after fade out
    setTimeout(() => {
      if (this.blackScreenOverlay) {
        this.blackScreenOverlay.style.pointerEvents = "none";
      }
    }, this.FADE_OUT_DURATION_MS);
  }

  startMotionDetection() {
    if (!this.audioUnlocked) {
      this.addDebugLog(
        "⚠️ Audio not unlocked yet - waiting for user interaction"
      );
      return;
    }

    if (!this.motionPermissionGranted && !this.useOrientationFallback) {
      this.addDebugLog(
        "⚠️ Motion permission not granted - shake detection disabled"
      );
      return;
    }

    if (this.motionDetectionActive) {
      this.addDebugLog("ℹ️ Motion detection already active");
      return;
    }

    // Try DeviceMotionEvent first
    if (typeof window.DeviceMotionEvent !== "undefined") {
      this.motionHandler = this.handleDeviceMotion.bind(this);
      window.addEventListener("devicemotion", this.motionHandler);
      this.addDebugLog("✅ DeviceMotionEvent listener added");
    }

    // Try DeviceOrientationEvent as fallback
    if (
      this.useOrientationFallback &&
      typeof window.DeviceOrientationEvent !== "undefined"
    ) {
      this.orientationHandler = this.handleDeviceOrientation.bind(this);

      // Test if events are firing at all
      const testHandler = () => {
        this.addDebugLog("🎉 Orientation event received! Handler is working!");
        window.removeEventListener("deviceorientation", testHandler);
      };
      window.addEventListener("deviceorientation", testHandler);

      window.addEventListener("deviceorientation", this.orientationHandler);
      this.addDebugLog("✅ DeviceOrientationEvent listener added (fallback)");
      this.addDebugLog("📱 Waiting for orientation events...");
    }

    this.motionDetectionActive = true;
    this.addDebugLog("✅ Motion detection started - shake your phone!");
  }

  stopMotionDetection() {
    if (this.motionHandler) {
      window.removeEventListener("devicemotion", this.motionHandler);
      this.motionHandler = null;
    }
    if (this.orientationHandler) {
      window.removeEventListener("deviceorientation", this.orientationHandler);
      this.orientationHandler = null;
    }
    this.motionDetectionActive = false;
  }

  handleDeviceOrientation(event) {
    // Log that handler is being called (first time only)
    if (!this._handlerCalled) {
      this._handlerCalled = true;
      this.addDebugLog("🎉 Orientation handler is being called!");
    }

    // Fallback method using orientation changes to detect shake
    if (!this.audioUnlocked) {
      if (
        !this._orientationUnlockLog ||
        Date.now() - this._orientationUnlockLog > 2000
      ) {
        this.addDebugLog(
          "⚠️ Orientation event received but audio not unlocked"
        );
        this._orientationUnlockLog = Date.now();
      }
      return;
    }

    // Log that we're receiving events (first time after unlock)
    if (!this._orientationEventCount) {
      this._orientationEventCount = 0;
      this.addDebugLog("📱 Receiving orientation events!");
    }
    this._orientationEventCount++;

    // Use beta (pitch) and gamma (roll) changes to detect shake
    if (event.beta === null || event.gamma === null) {
      // Log occasionally if we're getting null values
      if (!this._lastNullLog || Date.now() - this._lastNullLog > 2000) {
        this.addDebugLog(
          `⚠️ Orientation: beta=${event.beta}, gamma=${event.gamma}, alpha=${event.alpha}`
        );
        this._lastNullLog = Date.now();
      }
      return;
    }

    const beta = event.beta;
    const gamma = event.gamma;
    const alpha = event.alpha || 0;

    // Initialize last orientation on first event
    if (!this.lastOrientation) {
      this.lastOrientation = { beta, gamma, alpha };
      this.addDebugLog(
        `📱 Orientation initialized: beta=${beta.toFixed(
          1
        )}, gamma=${gamma.toFixed(1)}`
      );
      this.addDebugLog("📱 Start shaking your phone!");
      return;
    }

    // Calculate change in orientation (absolute change)
    const deltaBeta = Math.abs(beta - this.lastOrientation.beta);
    const deltaGamma = Math.abs(gamma - this.lastOrientation.gamma);
    const deltaAlpha = Math.abs(alpha - (this.lastOrientation.alpha || 0));

    const totalChange = deltaBeta + deltaGamma + deltaAlpha;

    // Update last orientation
    this.lastOrientation = { beta, gamma, alpha };

    // Log more frequently for debugging (every 500ms)
    if (
      !this._lastOrientationLog ||
      Date.now() - this._lastOrientationLog > 500
    ) {
      // this.addDebugLog(`📱 Change: ${totalChange.toFixed(2)} (need > 3)`);
      this._lastOrientationLog = Date.now();
    }

    // Detect shake - tuned to ignore gentle tilts but not require aggressive shaking
    if (totalChange > this.ORIENTATION_SHAKE_THRESHOLD) {
      // this.addDebugLog(`🎯 SHAKE DETECTED! Change: ${totalChange.toFixed(2)}`);
      this.onShakeDetected();
    } else {
      this.onShakeStopped();
    }
  }

  handleDeviceMotion(event) {
    if (!this.audioUnlocked || !this.motionPermissionGranted) return;

    // iOS prefers accelerationIncludingGravity, Android uses acceleration
    const acceleration =
      event.accelerationIncludingGravity || event.acceleration;
    if (
      !acceleration ||
      acceleration.x === null ||
      acceleration.y === null ||
      acceleration.z === null
    ) {
      return;
    }

    const { x, y, z } = acceleration;

    // Initialize last acceleration on first event
    if (
      this.lastAcceleration.x === 0 &&
      this.lastAcceleration.y === 0 &&
      this.lastAcceleration.z === 0
    ) {
      this.lastAcceleration = { x, y, z };
      return;
    }

    const deltaX = Math.abs(x - this.lastAcceleration.x);
    const deltaY = Math.abs(y - this.lastAcceleration.y);
    const deltaZ = Math.abs(z - this.lastAcceleration.z);

    const totalDelta = deltaX + deltaY + deltaZ;

    // Update last acceleration
    this.lastAcceleration = { x, y, z };

    // Detect shake (threshold tuned to avoid auto-trigger on page load)
    if (totalDelta > this.shakeThreshold) {
      this.onShakeDetected();
    } else {
      this.onShakeStopped();
    }
  }

  onShakeDetected() {
    const now = Date.now();
    this.lastShakeTime = now;

    // Reset stop countdown so the prank keeps running while shaking
    if (this.stopCountdownTimeout) {
      clearTimeout(this.stopCountdownTimeout);
      this.stopCountdownTimeout = null;
    }

    // Clear any pending shake stop timeout
    if (this.shakeTimeout) {
      clearTimeout(this.shakeTimeout);
      this.shakeTimeout = null;
    }

    // If this is the first shake, activate and start the sequence
    if (!this.isShaking) {
      this.isShaking = true;
      this.shakeStartTime = now;
      this.RATTLE_PLAY_COUNT_CURRENT = 0; // Reset rattle play count

      // Activate prank (show black screen)
      if (!this.isActive) {
        this.activate();
      }

      // Start rattle sound sequence (play once)
      this.addDebugLog("🔊 Starting rattle sound sequence (1 play)...");
      this.startRattleSoundSequence();
    }

    // Always keep countdown running so we stop 3s after the last shake
    this.startStopCountdown();
  }

  onShakeStopped() {
    if (!this.isShaking) return;

    // Clear any existing timeout
    if (this.shakeTimeout) {
      clearTimeout(this.shakeTimeout);
    }

    // Debounce minor jitters before starting the stop countdown
    this.shakeTimeout = setTimeout(() => {
      if (this.isShaking && this.isActive) {
        this.startStopCountdown();
      }
    }, 500); // Small delay to debounce shake detection
  }

  startRattleSoundSequence() {
    if (!this.rattleAudio) return;

    // Stop spray sound if playing
    this.stopSpraySound();

    // Reset rattle audio
    this.rattleAudio.currentTime = 0;

    // Remove any existing event listeners
    this.rattleAudio.removeEventListener("ended", this._rattleEndedHandler);

    // Create handler for when rattle sound ends (single play)
    this._rattleEndedHandler = () => {
      this.RATTLE_PLAY_COUNT_CURRENT++;
      this.addDebugLog("🔊 Rattle sound finished (1/1)");

      // Immediately switch to spray sound
      if (this.isShaking && this.isActive) {
        this.addDebugLog("🔊 Switching to spray sound (looping)...");
        this.startSpraySound();
      }
    };

    // Add event listener for when rattle sound ends
    this.rattleAudio.addEventListener("ended", this._rattleEndedHandler);

    // Play rattle sound (single play)
    this.rattleAudio.play().catch((error) => {
      this.addDebugLog("🔊 Failed to play rattle sound:", error.message);
      console.warn("[ShakeSpray] Failed to play rattle sound:", error);
    });
  }

  startRattleSound() {
    // Legacy method - redirect to sequence
    this.startRattleSoundSequence();
  }

  startSpraySound() {
    if (!this.sprayAudio) return;

    // Stop rattle sound
    if (this.rattleAudio && !this.rattleAudio.paused) {
      this.rattleAudio.pause();
      this.rattleAudio.currentTime = 0;
    }

    // Play spray sound (looping)
    this.sprayAudio.currentTime = 0;
    this.sprayAudio.play().catch((error) => {
      this.addDebugLog("🔊 Failed to play spray sound:", error);
      console.warn("[ShakeSpray] Failed to play spray sound:", error);
    });
  }

  stopSpraySound() {
    if (this.sprayAudio && !this.sprayAudio.paused) {
      this.sprayAudio.pause();
      this.sprayAudio.currentTime = 0;
    }
  }

  stopRattleSound() {
    if (this.rattleAudio) {
      // Remove event listener if it exists
      if (this._rattleEndedHandler) {
        this.rattleAudio.removeEventListener("ended", this._rattleEndedHandler);
        this._rattleEndedHandler = null;
      }

      if (!this.rattleAudio.paused) {
        this.rattleAudio.pause();
        this.rattleAudio.currentTime = 0;
      }
    }

    // Reset rattle play count
    this.RATTLE_PLAY_COUNT_CURRENT = 0;
  }

  stopAllAudio() {
    this.stopRattleSound();
    this.stopSpraySound();
  }

  startStopCountdown() {
    if (this.stopCountdownTimeout) {
      clearTimeout(this.stopCountdownTimeout);
    }

    this.stopCountdownTimeout = setTimeout(() => {
      this.addDebugLog("⏹️ Stopping prank after shake ended");
      this.deactivate();
    }, this.SHAKE_STOP_DELAY_MS);
  }

  // Test audio playback without shake detection
  testAudioPlayback() {
    console.log("[ShakeSpray] Testing audio playback...");

    // Play rattle sound first
    if (this.rattleAudio) {
      this.rattleAudio.currentTime = 0;
      this.rattleAudio
        .play()
        .then(() => {
          console.log("[ShakeSpray] Rattle audio playing");

          // After rattle duration, switch to spray sound
          setTimeout(() => {
            if (this.sprayAudio) {
              this.sprayAudio.currentTime = 0;
              this.sprayAudio
                .play()
                .then(() => {
                  console.log("[ShakeSpray] Spray audio playing (looping)");

                  // Stop after 5 seconds for testing
                  setTimeout(() => {
                    this.stopSpraySound();
                    console.log("[ShakeSpray] Stopped spray audio");

                    // Deactivate after a moment
                    setTimeout(() => {
                      this.deactivate();
                    }, 500);
                  }, 5000);
                })
                .catch((error) => {
                  console.error(
                    "[ShakeSpray] Failed to play spray audio:",
                    error
                  );
                });
            }
          }, this.RATTLE_DURATION_MS);
        })
        .catch((error) => {
          console.error("[ShakeSpray] Failed to play rattle audio:", error);
          console.error("[ShakeSpray] Error details:", {
            message: error.message,
            name: error.name,
            code: error.code,
          });
        });
    } else {
      console.error("[ShakeSpray] Rattle audio not loaded");
    }
  }
}

// Initialize on page load and expose globals for external triggers
if (typeof window !== "undefined") {
  window.ShakeSprayPrank = ShakeSprayPrank;

  // if (document.readyState === "loading") {
  //   document.addEventListener("DOMContentLoaded", () => {
  //     window.shakeSprayPrank = new ShakeSprayPrank();
  //   });
  // } else {
  //   window.shakeSprayPrank = new ShakeSprayPrank();
  // }
}
