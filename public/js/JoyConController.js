/**
 * ==========================================
 * JoyConController — WebHID Joy-Con driver
 * ==========================================
 * Connects to a Nintendo Joy-Con via WebHID,
 * enables the IMU (accelerometer + gyroscope),
 * and streams parsed sensor samples at ~60 Hz.
 *
 * Usage:
 *   const jc = new JoyConController();
 *   await jc.connect();          // opens HID picker
 *   jc.onSample = (sample) => {  // { ax, ay, az, gx, gy, gz }
 *     console.log(sample);
 *   };
 *   jc.disconnect();
 */

const NINTENDO_VENDOR_ID = 0x057e;
const JOYCON_L_PRODUCT   = 0x2006;
const JOYCON_R_PRODUCT   = 0x2007;
const PRO_CON_PRODUCT    = 0x2009;

// Subcommand IDs
const SC_SET_INPUT_MODE = 0x03;
const SC_ENABLE_IMU     = 0x40;
const SC_SET_PLAYER_LED = 0x30;

// Input report mode values
const INPUT_FULL = 0x30;   // Standard full — buttons + 6-axis IMU

// IMU sensitivity defaults
const ACC_SENSITIVITY  = 8192.0;   // LSB/g  at ±4 g
const GYRO_SENSITIVITY = 16.375;   // LSB/°/s at ±2000 °/s

export default class JoyConController {
  constructor() {
    /** @type {HIDDevice|null} */
    this.device = null;
    this.connected = false;
    this.side = null;          // 'L' | 'R' | 'Pro'

    // Subcommand rumble counter (lower nibble increments)
    this._globalCounter = 0;

    // Calibration offsets (set after first few idle samples)
    this._calSamples = [];
    this._calDone = false;
    this._calOffset = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };

    /**
     * Called for every parsed IMU sample (~180 Hz — 3 samples per report × 60 reports/s).
     * Override this in consuming code.
     * @type {function({ax:number, ay:number, az:number, gx:number, gy:number, gz:number}):void}
     */
    this.onSample = null;

    /** Called when the device disconnects. */
    this.onDisconnect = null;

    /** Called when connection state changes. */
    this.onStateChange = null;
  }

  /* -----------------------------------------------------------
   * Public API
   * --------------------------------------------------------- */

  /** Returns true if WebHID is available in the current browser. */
  static isSupported() {
    return 'hid' in navigator;
  }

  /**
   * Opens the browser HID picker filtered to Nintendo controllers
   * and initialises the IMU.
   */
  async connect() {
    if (!JoyConController.isSupported()) {
      throw new Error('WebHID API is not supported in this browser.');
    }

    const devices = await navigator.hid.requestDevice({
      filters: [
        { vendorId: NINTENDO_VENDOR_ID }
      ],
    });

    if (!devices || devices.length === 0) {
      throw new Error('No Joy-Con selected.');
    }

    this.device = devices[0];

    // Determine side
    if (this.device.productId === JOYCON_L_PRODUCT) this.side = 'L';
    else if (this.device.productId === JOYCON_R_PRODUCT) this.side = 'R';
    else this.side = 'Pro';

    if (!this.device.opened) {
      await this.device.open();
    }

    // Listen for input reports
    this.device.addEventListener('inputreport', (e) => this._onInputReport(e));

    // Listen for disconnection
    navigator.hid.addEventListener('disconnect', (e) => {
      if (e.device === this.device) {
        this.connected = false;
        this.device = null;
        if (this.onDisconnect) this.onDisconnect();
        if (this.onStateChange) this.onStateChange(false);
      }
    });

    // Initialise: set input mode to full, enable IMU, set LEDs
    await this._sendSubcommand(SC_SET_INPUT_MODE, [INPUT_FULL]);
    await this._sleep(50);
    await this._sendSubcommand(SC_ENABLE_IMU, [0x01]);  // 1 = enable
    await this._sleep(50);
    await this._sendSubcommand(SC_SET_PLAYER_LED, [0x01]); // LED 1 on
    await this._sleep(50);

    this.connected = true;
    this._calSamples = [];
    this._calDone = false;
    if (this.onStateChange) this.onStateChange(true);

    console.log(`[JoyCon] Connected: ${this.side} (${this.device.productName})`);
  }

  /** Triggers sensor recalibration (runs automatically during song countdown). */
  recalibrate() {
    this._calSamples = [];
    this._calDone = false;
    console.log('[JoyCon] Recalibration triggered. Keep controller static.');
  }

  /** Disconnects the device gracefully. */
  async disconnect() {
    if (this.device && this.device.opened) {
      try {
        // Disable IMU before closing
        await this._sendSubcommand(SC_ENABLE_IMU, [0x00]);
      } catch (_) { /* ignore */ }
      await this.device.close();
    }
    this.connected = false;
    this.device = null;
    if (this.onStateChange) this.onStateChange(false);
  }

  /**
   * Returns the latest calibrated sample or null.
   * Useful for polling instead of callback-driven usage.
   */
  get latestSample() {
    return this._latest || null;
  }

  /* -----------------------------------------------------------
   * Private — subcommand protocol
   * --------------------------------------------------------- */

  /**
   * Sends a subcommand via output report 0x01.
   * The rumble data is neutral (no vibration).
   */
  async _sendSubcommand(subId, data = []) {
    if (!this.device || !this.device.opened) return;

    // El reporte 0x01 espera un buffer de payload de exactamente 48 bytes bajo Bluetooth
    const buf = new Uint8Array(48);

    // Byte 0: global packet counter (lower nibble)
    buf[0] = this._globalCounter & 0x0f;
    this._globalCounter++;

    // Bytes 1-8: rumble data (neutral/sin vibracion)
    buf[1] = 0x00; buf[2] = 0x01; buf[3] = 0x40; buf[4] = 0x40;
    buf[5] = 0x00; buf[6] = 0x01; buf[7] = 0x40; buf[8] = 0x40;

    // Byte 9: subcommand ID
    buf[9] = subId;

    // Bytes 10+: subcommand data
    for (let i = 0; i < data.length; i++) {
      buf[10 + i] = data[i];
    }

    await this.device.sendReport(0x01, buf);
  }

  /* -----------------------------------------------------------
   * Private — input report parsing
   * --------------------------------------------------------- */

  _onInputReport(event) {
    const { reportId, data } = event;

    // Standard full report with IMU
    if (reportId !== 0x30) return;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // IMU data starts at byte offset 12 (after buttons/sticks).
    // There are 3 consecutive IMU frames, each 12 bytes (6 × int16LE).
    for (let frame = 0; frame < 3; frame++) {
      const off = 13 + frame * 12;
      if (off + 12 > data.byteLength) break;

      const raw = {
        ax: view.getInt16(off + 0, true),
        ay: view.getInt16(off + 2, true),
        az: view.getInt16(off + 4, true),
        gx: view.getInt16(off + 6, true),
        gy: view.getInt16(off + 8, true),
        gz: view.getInt16(off + 10, true),
      };

      // Convert to physical units (g for accel, °/s for gyro)
      const sample = {
        ax: raw.ax / ACC_SENSITIVITY,
        ay: raw.ay / ACC_SENSITIVITY,
        az: raw.az / ACC_SENSITIVITY,
        gx: raw.gx / GYRO_SENSITIVITY,
        gy: raw.gy / GYRO_SENSITIVITY,
        gz: raw.gz / GYRO_SENSITIVITY,
      };

      // Calibration: collect first 60 samples while idle to estimate bias
      if (!this._calDone) {
        this._calSamples.push(sample);
        if (this._calSamples.length >= 60) {
          this._computeCalibration();
        }
        continue; // don't emit during calibration
      }

      // Apply calibration offset
      sample.ax -= this._calOffset.ax;
      sample.ay -= this._calOffset.ay;
      sample.az -= this._calOffset.az;
      sample.gx -= this._calOffset.gx;
      sample.gy -= this._calOffset.gy;
      sample.gz -= this._calOffset.gz;

      this._latest = sample;
      if (this.onSample) this.onSample(sample);
    }
  }

  _computeCalibration() {
    const n = this._calSamples.length;
    const sum = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 };
    for (const s of this._calSamples) {
      sum.ax += s.ax; sum.ay += s.ay; sum.az += s.az;
      sum.gx += s.gx; sum.gy += s.gy; sum.gz += s.gz;
    }
    // Average — but do NOT subtract gravity from az (assume controller resting flat → az ≈ 1g)
    this._calOffset.ax = sum.ax / n;
    this._calOffset.ay = sum.ay / n;
    this._calOffset.az = sum.az / n - 1.0; // keep 1g in Z
    this._calOffset.gx = sum.gx / n;
    this._calOffset.gy = sum.gy / n;
    this._calOffset.gz = sum.gz / n;

    this._calDone = true;
    console.log('[JoyCon] Calibration done — offsets:', this._calOffset);
  }

  _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
