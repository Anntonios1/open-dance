/**
 * ========================================
 * DEBUG OVERLAY — Just Dance Sync Analyzer
 * ========================================
 *
 * Uso:
 *   const debug = new DebugOverlay({ video, audio, beats, getGameState, getSongTime });
 *   debug.mount();
 *   debug.update(currentTime);   // llamar desde el game loop
 *
 * Teclas de control (solo cuando está activo):
 *   D  → toggle overlay visible/oculto
 *   +  → audioOffset +10ms
 *   -  → audioOffset -10ms
 *   0  → audioOffset = 0ms (reset)
 *   A  → toggle modo "audio solo" (silencia video)
 *   P  → pausa / reanuda (frame-step mode)
 *   →  → (solo pausado) avanza exactamente 1 frame (1/60s)
 */

export const DEBUG = true; // ← poner false para eliminar todo overhead

export default class DebugOverlay {
  constructor({ video, audio, beats, timeline, getGameState, getSongTime }) {
    if (!DEBUG) return;

    this.video       = video;
    this.audio       = audio;
    this.beats       = beats || [];
    this.timeline    = timeline || { pictos: [], moves: [], lyrics: [] };
    this.getGameState = getGameState || (() => null);
    this.getSongTime  = getSongTime  || (() => 0);

    // --- Estado interno ---
    this.visible     = false;
    this.audioOffset = 0;        // ms que se suman al reloj
    this.audioSolo   = false;
    this.paused      = false;
    this._externalPause = false; // ¿fue el juego quien pausó?

    // Historial de drift (60 slots = 60 segundos)
    this._driftHistory  = new Array(60).fill(0);
    this._lastDriftSec  = -1;

    // Logger circular (20 entradas máx)
    this._logSlots   = new Array(20).fill(null);
    this._logHead    = 0;
    this._logCount   = 0;

    // Métricas entre frames
    this._lastRafTime    = 0;
    this._rafDelta       = 0;
    this._lastReadyState = -1;

    // Umbrales de drift ya notificados
    this._driftThresholds = { 50: false, 150: false, 300: false };

    // DOM refs
    this._container  = null;
    this._els        = {};

    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API PÚBLICA
  // ─────────────────────────────────────────────────────────────────────────

  mount() {
    if (!DEBUG) return;
    this._buildDOM();
    document.addEventListener('keydown', this._boundKeyDown);
    this._log('system', 'DebugOverlay montado. Pulsa [D] para mostrar.');
  }

  destroy() {
    if (!DEBUG) return;
    document.removeEventListener('keydown', this._boundKeyDown);
    if (this._container) this._container.remove();
  }

  toggle() {
    if (!DEBUG) return;
    this.visible = !this.visible;
    this._container.style.display = this.visible ? 'flex' : 'none';
  }

  /**
   * Llamar desde el game loop en cada frame.
   * @param {number} rafTime  — timestamp de requestAnimationFrame
   */
  update(rafTime) {
    if (!DEBUG || !this.visible) {
      // Seguimos midiendo el drift aunque el overlay esté oculto
      this._trackDrift();
      return;
    }

    // Δt entre frames
    if (this._lastRafTime > 0) {
      this._rafDelta = rafTime - this._lastRafTime;
    }
    this._lastRafTime = rafTime;

    this._trackDrift();
    this._updateDOM();
  }

  /** Notifica al overlay que el juego arrancó (para logear timestamps de inicio) */
  notifyStart() {
    if (!DEBUG) return;
    const act = this.audio ? this.audio.currentTime.toFixed(3) : 'N/A';
    const vct = this.video ? this.video.currentTime.toFixed(3) : 'N/A';
    this._log('start', `PLAY(): audio.ct=${act}s  video.ct=${vct}s`);
  }

  /** Notifica un miss de picto para logearlo con desfase */
  notifyMiss(pictoName, drift) {
    if (!DEBUG) return;
    this._log('miss', `MISS "${pictoName}"  desfase=${(drift * 1000).toFixed(0)}ms`);
  }

  /** Notifica un hit exitoso para logear precisión, score NCC y desfase */
  notifyHit(pictoName, rating, score, drift) {
    if (!DEBUG) return;
    this._log('sync', `HIT "${pictoName}" → ${rating.toUpperCase()} (NCC=${score.toFixed(3)}, desfase=${(drift * 1000).toFixed(0)}ms)`);
  }

  /** Notifica una corrección de sync del motor */
  notifySync(driftSec) {
    if (!DEBUG) return;
    this._log('sync', `SYNC corrección drift=${(driftSec * 1000).toFixed(0)}ms`);
  }

  /** Devuelve el offset de audio en segundos (para usar en _getSongTime) */
  getAudioOffsetSec() {
    if (!DEBUG) return 0;
    return this.audioOffset / 1000;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM BUILD
  // ─────────────────────────────────────────────────────────────────────────

  _buildDOM() {
    const css = `
      #dbg-overlay {
        display: none;
        position: fixed;
        top: 0; left: 0;
        width: 340px;
        max-height: 100vh;
        overflow-y: auto;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        background: rgba(0,0,0,0.82);
        backdrop-filter: blur(6px);
        color: #e0e0e0;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        z-index: 99999;
        border-right: 2px solid #333;
        border-bottom: 2px solid #333;
        border-radius: 0 0 8px 0;
        box-shadow: 4px 4px 20px rgba(0,0,0,0.7);
        user-select: none;
      }
      #dbg-overlay .dbg-title {
        font-size: 12px;
        font-weight: bold;
        color: #ff6bce;
        letter-spacing: 2px;
        text-align: center;
        padding-bottom: 4px;
        border-bottom: 1px solid #444;
        margin-bottom: 2px;
      }
      #dbg-overlay .dbg-block {
        background: rgba(255,255,255,0.04);
        border: 1px solid #333;
        border-radius: 4px;
        padding: 5px 7px;
      }
      #dbg-overlay .dbg-block-title {
        font-size: 10px;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 3px;
      }
      #dbg-overlay .dbg-row {
        display: flex;
        justify-content: space-between;
        margin: 2px 0;
        line-height: 1.4;
      }
      #dbg-overlay .dbg-label { color: #888; }
      #dbg-overlay .dbg-val   { color: #e0e0e0; font-weight: bold; }
      #dbg-overlay .drift-green  { color: #4ade80; }
      #dbg-overlay .drift-yellow { color: #facc15; }
      #dbg-overlay .drift-red    { color: #f87171; }
      #dbg-overlay .offset-val   { color: #60a5fa; font-weight: bold; font-size: 13px; }
      #dbg-overlay .offset-label { color: #60a5fa; }
      #dbg-overlay #dbg-log-list {
        max-height: 130px;
        overflow-y: auto;
        font-size: 10px;
        color: #aaa;
      }
      #dbg-overlay #dbg-log-list .log-start  { color: #4ade80; }
      #dbg-overlay #dbg-log-list .log-warn   { color: #facc15; }
      #dbg-overlay #dbg-log-list .log-miss   { color: #f87171; }
      #dbg-overlay #dbg-log-list .log-sync   { color: #a78bfa; }
      #dbg-overlay #dbg-log-list .log-system { color: #60a5fa; }
      #dbg-overlay #dbg-log-list .log-stall  { color: #fb923c; }
      #dbg-overlay #dbg-drift-chart {
        display: flex;
        align-items: flex-end;
        gap: 1px;
        height: 48px;
        padding: 2px 0;
        overflow: hidden;
      }
      #dbg-overlay .drift-bar {
        flex: 1;
        min-width: 3px;
        border-radius: 1px 1px 0 0;
        transition: height 0.3s;
      }
      #dbg-overlay .dbg-kbd {
        display: inline-block;
        background: #333;
        border: 1px solid #555;
        border-radius: 3px;
        padding: 0 4px;
        font-size: 10px;
        color: #bbb;
      }
      #dbg-overlay .mode-badge {
        display: inline-block;
        padding: 1px 6px;
        border-radius: 10px;
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 1px;
      }
      #dbg-overlay .mode-solo   { background: #7c3aed; color: #fff; }
      #dbg-overlay .mode-paused { background: #b45309; color: #fff; }
      #dbg-overlay .mode-live   { background: #065f46; color: #fff; }
    `;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const c = document.createElement('div');
    c.id = 'dbg-overlay';
    c.innerHTML = `
      <div class="dbg-title">◈ SYNC DEBUG ◈</div>

      <!-- Modo badge + offset -->
      <div class="dbg-block" style="display:flex;justify-content:space-between;align-items:center;">
        <span id="dbg-mode-badge" class="mode-badge mode-live">LIVE</span>
        <span>
          <span class="offset-label">offset audio:</span>
          <span id="dbg-offset" class="offset-val">0ms</span>
        </span>
        <span>
          <span class="dbg-kbd">+</span>
          <span class="dbg-kbd">-</span>
          <span class="dbg-kbd">0</span>
        </span>
      </div>

      <!-- Relojes -->
      <div class="dbg-block">
        <div class="dbg-block-title">🕐 Relojes</div>
        <div class="dbg-row"><span class="dbg-label">audio.ct</span><span id="dbg-act" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">video.ct</span><span id="dbg-vct" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">songTime</span><span id="dbg-stime" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">drift A-V</span><span id="dbg-drift" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">rAF Δt</span><span id="dbg-raf" class="dbg-val">–</span></div>
      </div>

      <!-- Próximos eventos -->
      <div class="dbg-block">
        <div class="dbg-block-title">⏭ Próximos eventos</div>
        <div class="dbg-row"><span class="dbg-label">next PICTO</span><span id="dbg-npicto" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">next MOVE</span><span id="dbg-nmove" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">next LYRIC</span><span id="dbg-nlyric" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">next BEAT</span><span id="dbg-nbeat" class="dbg-val">–</span></div>
      </div>

      <!-- Estado media -->
      <div class="dbg-block">
        <div class="dbg-block-title">📡 Estado media</div>
        <div class="dbg-row"><span class="dbg-label">video.readyState</span><span id="dbg-vrs" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">video.buffered</span><span id="dbg-vbuf" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">audio.buffered</span><span id="dbg-abuf" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">video.paused</span><span id="dbg-vpause" class="dbg-val">–</span></div>
        <div class="dbg-row"><span class="dbg-label">audio.paused</span><span id="dbg-apause" class="dbg-val">–</span></div>
      </div>

      <!-- Historial drift -->
      <div class="dbg-block">
        <div class="dbg-block-title">📈 Drift A-V (últimos 60s)</div>
        <div id="dbg-drift-chart"></div>
        <div style="display:flex;justify-content:space-between;color:#555;font-size:9px;margin-top:2px;">
          <span>-60s</span><span>ahora</span>
        </div>
      </div>

      <!-- Logger -->
      <div class="dbg-block">
        <div class="dbg-block-title">📋 Eventos críticos</div>
        <div id="dbg-log-list"></div>
      </div>

      <!-- Atajos -->
      <div style="color:#555;font-size:9px;text-align:center;padding-top:2px;">
        <span class="dbg-kbd">D</span> toggle &nbsp;
        <span class="dbg-kbd">P</span> pause &nbsp;
        <span class="dbg-kbd">→</span> frame &nbsp;
        <span class="dbg-kbd">A</span> audio-solo
      </div>
    `;

    document.body.appendChild(c);
    this._container = c;

    // Cache refs
    const ids = ['dbg-act','dbg-vct','dbg-stime','dbg-drift','dbg-raf',
                  'dbg-npicto','dbg-nmove','dbg-nlyric','dbg-nbeat',
                  'dbg-vrs','dbg-vbuf','dbg-abuf','dbg-vpause','dbg-apause',
                  'dbg-offset','dbg-mode-badge','dbg-log-list','dbg-drift-chart'];
    ids.forEach(id => {
      this._els[id] = document.getElementById(id);
    });

    // Construir barras del gráfico
    const chart = this._els['dbg-drift-chart'];
    this._driftBars = [];
    for (let i = 0; i < 60; i++) {
      const bar = document.createElement('div');
      bar.className = 'drift-bar';
      bar.style.height = '2px';
      bar.style.background = '#4ade80';
      chart.appendChild(bar);
      this._driftBars.push(bar);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ACTUALIZACIÓN DEL DOM
  // ─────────────────────────────────────────────────────────────────────────

  _updateDOM() {
    const a = this.audio;
    const v = this.video;
    if (!a || !v) return;

    const act  = a.currentTime;
    const vct  = v.currentTime;
    const drift = (act - (vct - (this.video._startOffset || 0))) * 1000; // ms

    // --- Relojes ---
    this._set('dbg-act',   act.toFixed(3)  + 's');
    this._set('dbg-vct',   vct.toFixed(3)  + 's');
    this._set('dbg-stime', this.getSongTime().toFixed(3) + 's');

    const driftAbs = Math.abs(drift);
    const driftCls = driftAbs < 50  ? 'drift-green'
                   : driftAbs < 150 ? 'drift-yellow'
                                     : 'drift-red';
    const el = this._els['dbg-drift'];
    el.textContent = (drift >= 0 ? '+' : '') + drift.toFixed(1) + 'ms';
    el.className = 'dbg-val ' + driftCls;

    this._set('dbg-raf', this._rafDelta.toFixed(2) + 'ms');

    // Drift threshold logging
    const driftMs = Math.abs(drift);
    [50, 150, 300].forEach(thr => {
      if (driftMs >= thr && !this._driftThresholds[thr]) {
        this._driftThresholds[thr] = true;
        this._log('warn', `Drift ≥ ${thr}ms  actual=${drift.toFixed(1)}ms`);
      }
    });

    // --- Próximos eventos ---
    const st = this.getSongTime();
    this._updateNextEvents(st);

    // --- Estado media ---
    const RS_LABELS = ['HAVE_NOTHING','HAVE_METADATA','HAVE_CURRENT_DATA','HAVE_FUTURE_DATA','HAVE_ENOUGH_DATA'];
    const rs = v.readyState;
    this._set('dbg-vrs', `${rs} ${RS_LABELS[rs] || ''}`);

    // Detectar readyState bajando de 4
    if (this._lastReadyState === 4 && rs < 4) {
      this._log('stall', `VIDEO STALL: readyState ${this._lastReadyState}→${rs}  audio.ct=${act.toFixed(3)}s  video.ct=${vct.toFixed(3)}s`);
    }
    this._lastReadyState = rs;

    this._set('dbg-vbuf', this._bufferedRange(v));
    this._set('dbg-abuf', this._bufferedRange(a));
    this._set('dbg-vpause', v.paused ? 'true ⏸' : 'false ▶');
    this._set('dbg-apause', a.paused ? 'true ⏸' : 'false ▶');

    // --- Offset ---
    this._els['dbg-offset'].textContent = (this.audioOffset >= 0 ? '+' : '') + this.audioOffset + 'ms';

    // --- Modo badge ---
    const badge = this._els['dbg-mode-badge'];
    if (this.paused) {
      badge.textContent = 'PAUSED';
      badge.className = 'mode-badge mode-paused';
    } else if (this.audioSolo) {
      badge.textContent = 'AUDIO SOLO';
      badge.className = 'mode-badge mode-solo';
    } else {
      badge.textContent = 'LIVE';
      badge.className = 'mode-badge mode-live';
    }

    // --- Gráfico de drift ---
    this._updateChart();

    // --- Logger ---
    this._renderLog();
  }

  _updateNextEvents(songTime) {
    // PICTO
    const pictos = this.timeline.pictos || [];
    const np = pictos.find(p => p.time > songTime);
    this._set('dbg-npicto', np
      ? `${np.name}  (${(np.time - songTime).toFixed(3)}s)`
      : '— fin —');

    // MOVE
    const moves = this.timeline.moves || [];
    const nm = moves.find(m => m.time > songTime);
    this._set('dbg-nmove', nm
      ? `${nm.name}  (${(nm.time - songTime).toFixed(3)}s)`
      : '— fin —');

    // LYRIC
    const lyrics = this.timeline.lyrics || [];
    const nl = lyrics.find(l => l.time > songTime);
    this._set('dbg-nlyric', nl
      ? `"${nl.text}"  (${(nl.time - songTime).toFixed(3)}s)`
      : '— fin —');

    // BEAT
    const nextBeatIdx = this.beats.findIndex(b => b > songTime);
    if (nextBeatIdx >= 0) {
      const msLeft = (this.beats[nextBeatIdx] - songTime) * 1000;
      this._set('dbg-nbeat', `#${nextBeatIdx}  (${msLeft.toFixed(0)}ms)`);
    } else {
      this._set('dbg-nbeat', '— fin —');
    }
  }

  _updateChart() {
    const maxDrift = 300; // ms = barra completa
    this._driftBars.forEach((bar, i) => {
      const drift = Math.abs(this._driftHistory[i]);
      const pct = Math.min(1, drift / maxDrift);
      const h = Math.max(2, pct * 44);
      bar.style.height = h + 'px';
      bar.style.background = drift < 50  ? '#4ade80'
                           : drift < 150 ? '#facc15'
                                          : '#f87171';
    });
  }

  _renderLog() {
    const list = this._els['dbg-log-list'];
    if (!list) return;
    let html = '';
    const total = Math.min(this._logCount, 20);
    for (let i = 0; i < total; i++) {
      // Leer en orden cronológico (el más antiguo primero)
      const idx = (this._logHead - total + i + 20) % 20;
      const entry = this._logSlots[idx];
      if (!entry) continue;
      html += `<div class="log-${entry.type}">[${entry.ts}] ${entry.msg}</div>`;
    }
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TRACKING DE DRIFT
  // ─────────────────────────────────────────────────────────────────────────

  _trackDrift() {
    if (!this.audio || !this.video) return;
    const act = this.audio.currentTime;
    const vct = this.video.currentTime;
    const drift = (act - vct) * 1000; // ms

    // Una vez por segundo, guardar en historial
    const sec = Math.floor(act);
    if (sec !== this._lastDriftSec && sec >= 0) {
      this._lastDriftSec = sec;
      // Rotar buffer
      this._driftHistory.shift();
      this._driftHistory.push(drift);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOGGER CIRCULAR
  // ─────────────────────────────────────────────────────────────────────────

  _log(type, msg) {
    const now = new Date();
    const ts = now.toTimeString().slice(0, 8);
    this._logSlots[this._logHead] = { type, msg, ts };
    this._logHead = (this._logHead + 1) % 20;
    this._logCount = Math.min(this._logCount + 1, 20);
    // Siempre imprimir en consola también
    console.log(`[DBG ${ts}] [${type.toUpperCase()}] ${msg}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TECLADO
  // ─────────────────────────────────────────────────────────────────────────

  _onKeyDown(e) {
    if (!DEBUG) return;

    switch (e.key.toLowerCase()) {
      case 'd':
        this.toggle();
        break;

      case '+':
      case '=': // "=" sin shift en algunos teclados
        this.audioOffset = Math.min(500, this.audioOffset + 10);
        this._log('system', `audioOffset → ${this.audioOffset}ms`);
        break;

      case '-':
        this.audioOffset = Math.max(-500, this.audioOffset - 10);
        this._log('system', `audioOffset → ${this.audioOffset}ms`);
        break;

      case '0':
        this.audioOffset = 0;
        this._log('system', 'audioOffset → 0ms (reset)');
        break;

      case 'a':
        // Solo actuar si el overlay está visible para no interferir con
        // otros usos de la tecla A en el menú
        if (!this.visible) break;
        e.preventDefault();
        this._toggleAudioSolo();
        break;

      case 'p':
        if (!this.visible) break;
        e.preventDefault();
        this._togglePause();
        break;

      case 'arrowright':
        if (this.visible && this.paused) {
          e.preventDefault();
          this._stepFrame();
        }
        break;
    }
  }

  _toggleAudioSolo() {
    this.audioSolo = !this.audioSolo;
    if (this.audioSolo) {
      this.video.volume = 0;
      if (this.audio) this.audio.volume = 1;
      this._log('system', 'AUDIO SOLO ON — video silenciado');
    } else {
      this.video.volume = 1;
      this._log('system', 'AUDIO SOLO OFF — video normal');
    }
  }

  _togglePause() {
    this.paused = !this.paused;
    if (this.paused) {
      if (this.video && !this.video.paused) {
        this.video.pause();
        this._externalPause = true;
      }
      if (this.audio && !this.audio.paused) {
        this.audio.pause();
      }
      this._log('system', `FRAME-STEP MODE  audio.ct=${this.audio?.currentTime.toFixed(3)}s`);
    } else {
      if (this._externalPause) {
        this.video?.play().catch(() => {});
        this.audio?.play().catch(() => {});
        this._externalPause = false;
      }
      this._log('system', 'RESUMED');
    }
  }

  _stepFrame() {
    const dt = 1 / 60;
    if (this.video) this.video.currentTime = Math.min(this.video.duration || Infinity, this.video.currentTime + dt);
    if (this.audio) this.audio.currentTime = Math.min(this.audio.duration || Infinity, this.audio.currentTime + dt);
    // Forzar una actualización del overlay aunque el rAF no esté corriendo
    this._updateDOM();
    this._log('system', `STEP +16.67ms  audio.ct=${this.audio?.currentTime.toFixed(3)}s  video.ct=${this.video?.currentTime.toFixed(3)}s`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  _set(id, text) {
    const el = this._els[id];
    if (el) el.textContent = text;
  }

  _bufferedRange(media) {
    try {
      if (!media || media.buffered.length === 0) return 'vacío';
      const start = media.buffered.start(0).toFixed(1);
      const end   = media.buffered.end(media.buffered.length - 1).toFixed(1);
      return `${start}s – ${end}s`;
    } catch {
      return 'N/A';
    }
  }
}
