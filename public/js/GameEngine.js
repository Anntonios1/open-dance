import {
  PIXELS_PER_SECOND,
  HIT_ZONE_X,
  MAX_SCORE,
  TIMING_WINDOWS,
  SCORE_VALUES,
  STAR_THRESHOLDS,
  RANK_THRESHOLDS,
  RATING_LABELS,
} from './config.js';
import DebugOverlay, { DEBUG } from './DebugOverlay.js';
import MSMLoader from './MSMLoader.js';
import MotionMatcher from './MotionMatcher.js';

export default class GameEngine {
  constructor(options) {
    this.video = options.videoElement;
    this.audio = options.audioElement || null;
    this.pictoTrack = options.pictoTrack;
    this.pictoContainer = options.pictoContainer;
    this.lyricsContainer = options.lyricsContainer;
    this.ratingDisplay = options.ratingDisplay;
    this.starProgress = options.starProgress;
    this.starList = options.starList;
    this.goldFlash = options.goldFlash;
    this.countdownOverlay = options.countdownOverlay;
    this.countdownNumber = options.countdownNumber;
    this.hudElement = options.hudElement;
    this.hudPlayerCard = options.hudPlayerCard || null;
    this.onEnd = options.onEnd || (() => {});

    this.song = null;
    this.coachID = 0;
    this.mode = 'keyboard';
    this.state = null;
    this.animFrameId = null;
    this.pictoElements = {};
    this.lyricsLines = [];
    this.errorCount = 0;
    this.maxErrors = 5;
    this.videoStartTime = 0;
    this.useSeparateAudio = false;
    this._starting = false;
    this.beats = [];

    // --- Joy-Con motion matching ---
    /** @type {import('./JoyConController.js').default|null} */
    this.joycon = null;
    this.motionMatcher = new MotionMatcher();
    /** Preloaded MSM data keyed by move name */
    this._msmCache = {};
    /** Samples being collected for the active move */
    this._motionBuffer = [];
    /** Index of the move currently being tracked (in state.moves) */
    this._activeMove = null;
    /** Sliding history buffer of Joy-Con samples */
    this._joyconHistory = [];
    this._lastSongTime = 0;
    this._lastSongTimeRealTime = 0;

    // --- Debug overlay ---
    this.debugOverlay = null;
    if (DEBUG) {
      this.debugOverlay = new DebugOverlay({
        video: this.video,
        audio: this.audio,
        beats: this.beats,
        timeline: { pictos: [], moves: [], lyrics: [] },
        getGameState: () => this.state,
        getSongTime: () => this._getSongTime(),
      });
      this.debugOverlay.mount();
    }

    this._bindVideoEvents();
  }

  _log(level, msg, data = null) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    const prefix = `[GameEngine ${timestamp}]`;
    if (level === 'error') {
      console.error(`${prefix} ERROR:`, msg, data || '');
      this._showErrorUI(msg);
    } else if (level === 'warn') {
      console.warn(`${prefix} WARN:`, msg, data || '');
    } else {
      console.log(`${prefix}`, msg, data || '');
    }
  }

  _showErrorUI(msg) {
    this.errorCount++;
    if (this.errorCount > this.maxErrors) {
      this._log('warn', 'Too many errors, stopping error UI display');
      return;
    }

    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(255, 0, 0, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-family: monospace;
      font-size: 12px;
      max-width: 400px;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    errorDiv.textContent = `⚠️ ${msg}`;
    document.body.appendChild(errorDiv);

    setTimeout(() => {
      errorDiv.style.transition = 'opacity 0.5s';
      errorDiv.style.opacity = '0';
      setTimeout(() => errorDiv.remove(), 500);
    }, 5000);
  }

  _bindVideoEvents() {
    if (!this.video) {
      this._log('error', 'Video element not provided');
      return;
    }

    this.video.addEventListener('error', (e) => {
      const error = this.video.error;
      const errorMsg = error ? `Code ${error.code}: ${error.message}` : 'Unknown error';
      this._log('error', `Video load failed: ${errorMsg}`, { src: this.video.src });
    });

    this.video.addEventListener('stalled', () => {
      this._log('warn', 'Video stalled, waiting for data');
    });
  }

  _getSongTime() {
    const offset = (DEBUG && this.debugOverlay) ? this.debugOverlay.getAudioOffsetSec() : 0;
    if (this.useSeparateAudio && this.audio) {
      return this.audio.currentTime + offset;
    }
    return this.video.currentTime - this.videoStartTime + offset;
  }

  start(song, coachID = 0, mode = 'keyboard', modifiers = null, activeProfile = null) {
    try {
      this._log('info', `Starting game: ${song?.title || 'unknown'} (coach ${coachID}, mode ${mode})`);

      if (!song) {
        throw new Error('Song is null or undefined');
      }

      if (!song.hasTimeline()) {
        throw new Error('Song timeline not loaded');
      }

      this.song = song;
      this.coachID = coachID;
      this.mode = mode;
      this.errorCount = 0;

      // Inicializar Modos de Juego
      this._workoutActive = false;
      this._workoutKcal = 0;
      this._lastRafTime = null;

      // Resetear clases de disruptores de video anteriores
      this.video.classList.remove('disruptor-invert', 'disruptor-blur');

      if (modifiers) {
        // Workout Mode
        if (modifiers.workoutMode && modifiers.workoutMode.active) {
          this._workoutActive = true;
          this._workoutKcal = 0;
          const widget = document.querySelector('#hud-workout-widget');
          if (widget) {
            widget.style.display = 'flex';
            document.querySelector('#hud-workout-kcal-txt').textContent = '0.0';
          }
        } else {
          const widget = document.querySelector('#hud-workout-widget');
          if (widget) widget.style.display = 'none';
        }

        // Party Mode disruptores visuales
        if (modifiers.partyMode) {
          if (modifiers.partyMode.invert) {
            this.video.classList.add('disruptor-invert');
          }
          if (modifiers.partyMode.blur) {
            this.video.classList.add('disruptor-blur');
          }
        }
      }

      this.hudElement.className = 'game-hud';
      if (mode === 'spectator') this.hudElement.classList.add('spectator-mode');

      const coachMoves = song.getMovesForCoach(coachID);
      if (!coachMoves || coachMoves.length === 0) {
        this._log('warn', `No moves found for coach ${coachID}`);
      }

      this.state = {
        score: 0,
        stars: 0,
        perfects: 0,
        supers: 0,
        goods: 0,
        oks: 0,
        misses: 0,
        goldMovesHit: 0,
        goldMovesTotal: song.getGoldMoveCount(coachID),
        moves: coachMoves,
        pictos: song.pictos.map((p, i) => ({
          ...p,
          index: i,
          hit: false,
          isGold: song.moves[i] ? song.moves[i].goldMove === 1 : false,
        })),
        started: false,
        ended: false,
      };

      // Configure Joy-Con callbacks to capture samples continuously in sliding history
      if (this.mode === 'joycon' && this.joycon) {
        this._joyconHistory = [];
        this._activeMove = null;
        this._lastSongTime = 0;
        this._lastSongTimeRealTime = performance.now();
        this.joycon.onSample = (sample) => {
          const now = performance.now();
          const elapsed = (now - this._lastSongTimeRealTime) / 1000;
          const sampleTime = this._lastSongTime + elapsed * (this.video?.playbackRate || 1.0);
          
          this._joyconHistory.push({ ...sample, time: sampleTime });
          
          // Keep only the last 5 seconds of samples to save memory
          const minTime = sampleTime - 5.0;
          while (this._joyconHistory.length > 0 && this._joyconHistory[0].time < minTime) {
            this._joyconHistory.shift();
          }
        };
      }

      this._log('info', `Game state initialized: ${this.state.pictos.length} pictos, ${this.state.goldMovesTotal} gold moves`);

      this.videoStartTime = song.videoStartTime || 0;
      this.useSeparateAudio = song.hasSeparateAudio() && !!song.videoUrl;
      this._log('info', `videoStartTime: ${this.videoStartTime}s, separateAudio: ${this.useSeparateAudio}`);

      // Pasar beats y timeline al overlay de debug
      if (DEBUG && this.debugOverlay) {
        this.debugOverlay.timeline = {
          pictos: song.pictos || [],
          moves:  song.moves  || [],
          lyrics: song.lyrics || [],
        };
        if (song._musictrack) {
          this.beats = song._musictrack.beats || [];
          this.debugOverlay.beats = this.beats;
        }
      }

      this._resetStarsUI();
      this.pictoTrack.innerHTML = '';
      this.pictoElements = {};
      this._setupLyrics();

      const mediaUrl = song.getPlayableMediaUrl();
      if (!mediaUrl) {
        throw new Error('No playable media URL available');
      }

      this._log('info', `Loading media: ${mediaUrl}`);

      if (this.useSeparateAudio) {
        this.video.muted = true;
        this.video.src = song.videoUrl;
        this.video.load();

        const audioUrl = song.getAudioUrl();
        this._log('info', `Loading separate audio: ${audioUrl}`);
        this.audio.src = audioUrl;
        this.audio.load();

        const videoReady = new Promise((resolve) => {
          this.video.addEventListener('canplay', resolve, { once: true });
        });
        const audioReady = new Promise((resolve) => {
          this.audio.addEventListener('canplay', resolve, { once: true });
        });

        Promise.all([videoReady, audioReady]).then(() => {
          this.video.pause();
          this.audio.currentTime = 0;
          this._log('info', `Media ready. Video paused. videoStartTime=${this.videoStartTime}s`);

          const doSeek = () => {
            return new Promise((resolve) => {
              if (this.videoStartTime === 0) {
                resolve();
              } else {
                this.video.addEventListener('seeked', resolve, { once: true });
                this.video.currentTime = this.videoStartTime;
              }
            });
          };

          doSeek().then(() => {
            this._log('info', `Video at ${this.video.currentTime}s. Starting countdown`);
            this._runCountdown(() => {
              this._starting = true;

              // Resetear audio a 0.
              this.audio.currentTime = 0;

              // Lanzamos ambos play() de forma consecutiva inmediata
              const p1 = this.video.play();
              const p2 = this.audio.play();

              Promise.all([p1, p2]).then(() => {
                // Acelerar si el disruptor de velocidad está activo
                if (modifiers && modifiers.partyMode && modifiers.partyMode.speed) {
                  this.video.playbackRate = 1.15;
                  this.audio.playbackRate = 1.15;
                } else {
                  this.video.playbackRate = 1.0;
                  this.audio.playbackRate = 1.0;
                }

                this._log('info', `Both media playing — audio.ct=${this.audio.currentTime.toFixed(3)}s video.ct=${this.video.currentTime.toFixed(3)}s`);
                if (DEBUG && this.debugOverlay) this.debugOverlay.notifyStart();
                setTimeout(() => { this._starting = false; }, 500);

                this.state.started = true;
                this._log('info', 'Game loop started');
                this._gameLoop();
              }).catch((err) => {
                this._log('error', `Play failed: ${err.message}`);
                this._starting = false;
              });
            });
          });
        });
      } else {
        this.video.muted = false;
        this.video.src = mediaUrl;
        this.video.load();

        this.video.addEventListener(
          'canplay',
          () => {
            this.video.pause();
            this._log('info', `Video ready. Paused. videoStartTime=${this.videoStartTime}s`);

            const doSeek = () => {
              return new Promise((resolve) => {
                if (this.videoStartTime === 0) {
                  resolve();
                } else {
                  this.video.addEventListener('seeked', resolve, { once: true });
                  this.video.currentTime = this.videoStartTime;
                }
              });
            };

            doSeek().then(() => {
              this._runCountdown(() => {
                this.video.play().then(() => {
                  if (modifiers && modifiers.partyMode && modifiers.partyMode.speed) {
                    this.video.playbackRate = 1.15;
                  } else {
                    this.video.playbackRate = 1.0;
                  }
                }).catch((err) => {
                  this._log('error', `Video play() failed: ${err.message}`);
                });
                this.state.started = true;
                this._log('info', 'Game loop started');
                this._gameLoop();
              });
            });
          },
          { once: true }
        );
      }
    } catch (err) {
      this._log('error', `Failed to start game: ${err.message}`, err.stack);
    }
  }

  handleKeyboardHit() {
    if (!this.state || !this.state.started || this.state.ended) return;
    if (this.mode !== 'keyboard') return;

    const currentTime = this._getSongTime();
    let bestIdx = -1;
    let bestDiff = Infinity;

    this.state.pictos.forEach((picto, i) => {
      if (picto.hit) return;
      const diff = Math.abs(currentTime - picto.time);
      if (diff < bestDiff && diff < TIMING_WINDOWS.ok) {
        bestDiff = diff;
        bestIdx = i;
      }
    });

    if (bestIdx >= 0) {
      let rating;
      if (bestDiff <= TIMING_WINDOWS.perfect) rating = 'perfect';
      else if (bestDiff <= TIMING_WINDOWS.super) rating = 'super';
      else if (bestDiff <= TIMING_WINDOWS.good) rating = 'good';
      else rating = 'ok';
      this._hitPicto(bestIdx, rating);
    }
  }

  getResults() {
    if (!this.state) {
      this._log('warn', 'getResults() called but no state exists');
      return null;
    }

    const pct = this.state.score / MAX_SCORE;
    let rankTitle = 'BEGINNER';
    for (const t of RANK_THRESHOLDS) {
      if (pct >= t.pct) {
        rankTitle = t.title;
        break;
      }
    }

    return {
      score: this.state.score,
      stars: this.state.stars,
      perfects: this.state.perfects,
      supers: this.state.supers,
      goods: this.state.goods,
      oks: this.state.oks,
      misses: this.state.misses,
      goldMovesHit: this.state.goldMovesHit,
      goldMovesTotal: this.state.goldMovesTotal,
      rankTitle,
      workoutKcal: this._workoutActive ? this._workoutKcal : 0
    };
  }

  stop() {
    if (!this.state) {
      this._log('warn', 'stop() called but no state exists');
      return;
    }
    this._log('info', 'Game stopped');
    this.state.ended = true;
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
    
    // Restablecer vídeo y audio a velocidades y filtros por defecto
    this.video.classList.remove('disruptor-invert', 'disruptor-blur');
    this.video.playbackRate = 1.0;
    if (this.audio) {
      this.audio.playbackRate = 1.0;
      this.audio.pause();
    }
    this.video.pause();

    // Clean up Joy-Con callbacks
    if (this.joycon) {
      this.joycon.onSample = null;
    }

    // Ocultar HUD de ejercicio
    const widget = document.querySelector('#hud-workout-widget');
    if (widget) widget.style.display = 'none';
  }

  _gameLoop(rafTime) {
    if (!this.state.started || this.state.ended) return;

    try {
      const currentTime = this._getSongTime();
      this._lastSongTime = currentTime;
      this._lastSongTimeRealTime = performance.now();

      // Calcular calorías quemadas si Workout Mode está activo
      if (this._workoutActive && this.video && !this.video.paused) {
        if (!this._lastRafTime) this._lastRafTime = rafTime || performance.now();
        const dt = (rafTime - this._lastRafTime) / 1000;
        
        if (dt > 0 && dt < 1) { // Filtrar saltos de cuadro irregulares
          const scoreFactor = (this.state.score / 13000) * 0.5 + 0.8;
          this._workoutKcal = (this._workoutKcal || 0) + dt * 0.16 * scoreFactor;
        }
        
        this._lastRafTime = rafTime;

        // Actualizar HUD en tiempo real
        const hudKcal = document.querySelector('#hud-workout-kcal-txt');
        if (hudKcal) hudKcal.textContent = this._workoutKcal.toFixed(1);
      }

      // Actualizar debug overlay cada frame
      if (DEBUG && this.debugOverlay) this.debugOverlay.update(rafTime || performance.now());

      // Beat-pulse visual en la hit zone
      if (this.beats.length > 0) this._updateBeatPulse(currentTime);

      this._updateLyrics(currentTime);
      this._updatePictos(currentTime);
      this._updateStars();

      if (this.mode === 'autoplay') {
        this._handleAutoplay(currentTime);
      } else if (this.mode === 'joycon') {
        this._handleJoyCon(currentTime);
      }

      const mediaEnded = this.useSeparateAudio
        ? (this.audio && this.audio.ended)
        : this.video.ended;

      if (mediaEnded) {
        this._log('info', 'Media ended, showing results');
        this.state.ended = true;
        
        // Restablecer estilos al terminar
        this.video.classList.remove('disruptor-invert', 'disruptor-blur');
        this.video.playbackRate = 1.0;
        if (this.audio) this.audio.playbackRate = 1.0;

        // Clean up Joy-Con callbacks
        if (this.joycon) {
          this.joycon.onSample = null;
        }

        setTimeout(() => this.onEnd(this.getResults()), 500);
        return;
      }

      this.animFrameId = requestAnimationFrame((t) => this._gameLoop(t));
    } catch (err) {
      this._log('error', `Game loop error: ${err.message}`, err.stack);
      this.animFrameId = requestAnimationFrame((t) => this._gameLoop(t));
    }
  }

  _updateBeatPulse(currentTime) {
    // Pulso visual en la hit-line en cada beat
    const nextBeatIdx = this.beats.findIndex(b => b > currentTime);
    if (nextBeatIdx < 1) return;
    const prevBeat = this.beats[nextBeatIdx - 1];
    const timeSinceBeat = currentTime - prevBeat;
    // Flash durante los primeros 100ms después de cada beat
    if (timeSinceBeat >= 0 && timeSinceBeat < 0.1) {
      const hitLine = this.pictoTrack?.parentElement?.querySelector('.picto-hit-line');
      if (hitLine && !hitLine._pulsing) {
        hitLine._pulsing = true;
        hitLine.classList.add('beat-pulse');
        setTimeout(() => {
          hitLine.classList.remove('beat-pulse');
          hitLine._pulsing = false;
        }, 100);
      }

      // Baile de estrellas (beat-dance) alternando direcciones
      if (this.starList && !this._starsPulsing) {
        this._starsPulsing = true;
        const starItems = this.starList.querySelectorAll('.star-item');
        starItems.forEach((item, index) => {
          item.classList.add('beat-dance');
          if (index % 2 === 0) {
            item.classList.add('dance-left');
          } else {
            item.classList.add('dance-right');
          }
        });
        setTimeout(() => {
          starItems.forEach((item) => {
            item.classList.remove('beat-dance', 'dance-left', 'dance-right');
          });
          this._starsPulsing = false;
        }, 120);
      }

      // Beat-bounce on the player card
      if (this.hudPlayerCard && !this.hudPlayerCard._bouncing) {
        this.hudPlayerCard._bouncing = true;
        this.hudPlayerCard.classList.add('beat-bounce');
        setTimeout(() => {
          this.hudPlayerCard.classList.remove('beat-bounce');
          this.hudPlayerCard._bouncing = false;
        }, 140);
      }
    }
  }

  _updatePictos(currentTime) {
    const containerWidth = this.pictoContainer.offsetWidth || 700;

    this.state.pictos.forEach((picto, i) => {
      const timeDiff = picto.time - currentTime;
      const x = HIT_ZONE_X + timeDiff * PIXELS_PER_SECOND;

      if (x > containerWidth + 120 || x < -120) {
        if (this.pictoElements[i]) {
          this.pictoElements[i].remove();
          delete this.pictoElements[i];
        }
        if (!picto.hit && timeDiff < -TIMING_WINDOWS.ok) {
          picto.hit = true;
          if (this.mode === 'keyboard') {
            this.state.misses++;
            this._showRating('miss');
            if (DEBUG && this.debugOverlay) this.debugOverlay.notifyMiss(picto.name, timeDiff);
          }
        }
        return;
      }

      if (!this.pictoElements[i] && x < containerWidth + 80) {
        const el = document.createElement('div');
        el.className = 'picto-item' + (picto.isGold ? ' gold' : '');
        const pictoUrl = this.song.getPictoUrl(picto.name);
        el.innerHTML = `<img src="${pictoUrl}" alt="" onerror="console.error('Picto failed to load:', '${pictoUrl}')">`;
        this.pictoTrack.appendChild(el);
        this.pictoElements[i] = el;
      }

      if (this.pictoElements[i]) {
        this.pictoElements[i].style.left = x + 'px';
      }
    });
  }

  _handleAutoplay(currentTime) {
    this.state.pictos.forEach((picto, i) => {
      if (picto.hit) return;
      const timeDiff = Math.abs(currentTime - picto.time);
      if (timeDiff < TIMING_WINDOWS.perfect) {
        const rand = Math.random();
        let rating;
        if (rand < 0.5) rating = 'perfect';
        else if (rand < 0.8) rating = 'super';
        else if (rand < 0.95) rating = 'good';
        else rating = 'ok';
        this._hitPicto(i, rating);
      }
    });
  }

  /* ========================================
   * Joy-Con motion mode
   * ======================================== */

  /**
   * Set the Joy-Con controller reference.
   * When set, the engine can be started in mode='joycon'.
   */
  setJoyCon(joyconController) {
    this.joycon = joyconController;
  }

  /**
   * Preload all unique .msm files referenced by the song's moves
   * for the selected coach. Called once at game start.
   */
  async _preloadMSM() {
    if (!this.state || !this.state.moves) return;
    const songId = this.song.id;
    const uniqueNames = [...new Set(this.state.moves.map(m => m.name))];
    const promises = uniqueNames.map(async (name) => {
      if (this._msmCache[name]) return;
      const url = `/songs/${songId}/moves/${name}.msm`;
      try {
        const data = await MSMLoader.load(url);
        this._msmCache[name] = data;
      } catch (err) {
        this._log('warn', `MSM load failed for ${name}: ${err.message}`);
      }
    });
    await Promise.allSettled(promises);
    this._log('info', `MSM preloaded: ${Object.keys(this._msmCache).length} / ${uniqueNames.length}`);
  }

  /**
   * Called every frame when mode === 'joycon'.
   * Manages the sample-collection windows per move.
   */
  _handleJoyCon(currentTime) {
    if (!this.joycon || !this.joycon.connected) return;

    // Find the move whose window [time, time+duration] contains currentTime
    for (let i = 0; i < this.state.moves.length; i++) {
      const move = this.state.moves[i];
      const end  = move.time + move.duration;

      // Already past this move
      if (currentTime > end + 0.05) continue;

      // Inside the move window
      if (currentTime >= move.time && currentTime <= end) {
        this._activeMove = i;
        return;
      }

      // Just exited a move window — evaluate
      if (this._activeMove === i && currentTime > end) {
        this._evaluateMove(i);
        this._activeMove = null;
        return;
      }
    }

    // If we have a pending active move that was never evaluated
    if (this._activeMove !== null) {
      this._evaluateMove(this._activeMove);
      this._activeMove = null;
    }
  }

  /**
   * Evaluate collected motion samples for a move against MSM reference.
   */
  _evaluateMove(moveIndex) {
    const move = this.state.moves[moveIndex];
    if (!move) return;

    // Find the corresponding picto index
    const pictoIdx = this.state.pictos.findIndex(
      p => !p.hit && Math.abs(p.time - move.time) < 0.5
    );

    const msm = this._msmCache[move.name];
    
    // Extract player samples from history with 400ms padding on both sides
    const pad = 0.4;
    const startTime = move.time - pad;
    const endTime = move.time + move.duration + pad;
    const extracted = this._joyconHistory.filter(s => s.time >= startTime && s.time <= endTime);

    console.log(`[GameEngine] _evaluateMove for "${move.name}": msmLoaded = ${!!msm}, extractedLength = ${extracted.length}`);
    if (!msm || extracted.length < 3) {
      if (!msm) console.warn(`[GameEngine] Move "${move.name}" has no preloaded MSM reference data!`);
      if (extracted.length < 3) console.warn(`[GameEngine] Extracted history has only ${extracted.length} samples. Check if Joy-Con is sending samples.`);
      
      if (pictoIdx >= 0) {
        this.state.pictos[pictoIdx].hit = true;
        this.state.misses++;
        this._showRating('miss');
      }
      return;
    }

    const { rating, score, lag } = this.motionMatcher.evaluate(
      extracted,
      msm.samples,
      msm.components,
      move.duration,
      pad,
      pad
    );

    this._log('info', `Move "${move.name}" → ${rating} (NCC=${score.toFixed(3)}, lag=${(lag * 1000).toFixed(0)}ms)`);

    if (pictoIdx >= 0) {
      this._hitPicto(pictoIdx, rating);
      if (DEBUG && this.debugOverlay) {
        if (rating === 'miss') {
          this.debugOverlay.notifyMiss(move.name, lag);
        } else {
          this.debugOverlay.notifyHit(move.name, rating, score, lag);
        }
      }
    }
  }

  _hitPicto(index, rating) {
    const picto = this.state.pictos[index];
    if (!picto || picto.hit) return;
    picto.hit = true;

    this.state.score = Math.min(MAX_SCORE, this.state.score + (SCORE_VALUES[rating] || 0));

    if (rating === 'perfect') this.state.perfects++;
    else if (rating === 'super') this.state.supers++;
    else if (rating === 'good') this.state.goods++;
    else if (rating === 'ok') this.state.oks++;
    else if (rating === 'miss') this.state.misses++;

    if (picto.isGold) {
      this.state.goldMovesHit++;
      this._triggerGoldFlash();
      if (rating === 'perfect' || rating === 'super') {
        rating = 'yeah';
      }
    }

    this._showRating(rating);

    if (this.pictoElements[index]) {
      const el = this.pictoElements[index];
      el.classList.add('hit');
      // Immediately remove from layout so it doesn't block pictos behind it
      el.style.pointerEvents = 'none';
      setTimeout(() => {
        if (this.pictoElements[index]) {
          this.pictoElements[index].remove();
          delete this.pictoElements[index];
        }
      }, 220);
    }
  }

  _showRating(rating) {
    this.ratingDisplay.className = 'rating-display';
    this.ratingDisplay.textContent = RATING_LABELS[rating] || '';
    this.ratingDisplay.classList.add(`rating-${rating}`, 'show');
    setTimeout(() => this.ratingDisplay.classList.remove('show'), 500);
  }

  _triggerGoldFlash() {
    this.goldFlash.classList.remove('active');
    void this.goldFlash.offsetHeight;
    this.goldFlash.classList.add('active');
    setTimeout(() => this.goldFlash.classList.remove('active'), 800);
  }

  _updateStars() {
    const pct = (this.state.score / MAX_SCORE) * 100;
    this.starProgress.style.height = pct + '%';

    STAR_THRESHOLDS.forEach((t) => {
      const item = this.starList.querySelector(`.star-item[data-star="${t.star}"]`);
      if (item && pct >= t.pct && !item.classList.contains('earned')) {
        item.classList.add('earned');
      }
    });

    this.state.stars = STAR_THRESHOLDS.filter((t) => pct >= t.pct).length;
  }

  _resetStarsUI() {
    this.starList.querySelectorAll('.star-item').forEach((s) => s.classList.remove('earned'));
    this.starProgress.style.height = '0%';
  }

  _setupLyrics() {
    this.lyricsContainer.innerHTML = '';
    if (!this.song.lyrics || this.song.lyrics.length === 0) {
      this._log('warn', 'No lyrics available for this song');
      this.lyricsLines = [];
      return;
    }

    this.lyricsLines = [];
    let currentLine = [];
    let lineIndex = 0;

    this.song.lyrics.forEach((lyric) => {
      currentLine.push({ ...lyric, originalIndex: this.lyricsLines.length });
      if (lyric.isLineEnding && currentLine.length > 0) {
        this.lyricsLines.push({
          index: lineIndex++,
          words: currentLine,
          startTime: currentLine[0].time,
          endTime: currentLine[currentLine.length - 1].time + currentLine[currentLine.length - 1].duration,
        });
        currentLine = [];
      }
    });

    if (currentLine.length > 0) {
      this.lyricsLines.push({
        index: lineIndex,
        words: currentLine,
        startTime: currentLine[0].time,
        endTime: currentLine[currentLine.length - 1].time + currentLine[currentLine.length - 1].duration,
      });
    }

    this._log('info', `Lyrics loaded: ${this.lyricsLines.length} lines`);
    this._renderLyricLines();
  }

  _renderLyricLines() {
    this.lyricsContainer.innerHTML = '';
    this.lyricsLines.forEach((line) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyric-line';
      lineEl.dataset.lineIndex = line.index;
      line.words.forEach((w) => {
        const span = document.createElement('span');
        span.className = 'lyric-syllable';
        span.textContent = w.text;
        span.dataset.time = w.time;
        span.dataset.duration = w.duration;
        lineEl.appendChild(span);
      });
      this.lyricsContainer.appendChild(lineEl);
    });
  }

  _updateLyrics(currentTime) {
    if (!this.lyricsLines.length) return;

    const lineEls = this.lyricsContainer.querySelectorAll('.lyric-line');
    let currentLineIndex = -1;

    for (let i = 0; i < this.lyricsLines.length; i++) {
      if (currentTime >= this.lyricsLines[i].startTime && currentTime <= this.lyricsLines[i].endTime + 0.5) {
        currentLineIndex = i;
        break;
      }
      if (currentTime < this.lyricsLines[i].startTime) {
        currentLineIndex = i;
        break;
      }
    }

    if (currentLineIndex < 0) currentLineIndex = this.lyricsLines.length - 1;

    lineEls.forEach((el, idx) => {
      const line = this.lyricsLines[idx];
      const syllables = el.querySelectorAll('.lyric-syllable');

      if (idx === currentLineIndex) {
        el.style.display = 'flex';
        el.style.opacity = '1';
        syllables.forEach((syl) => {
          const sylTime = parseFloat(syl.dataset.time);
          const sylDur = parseFloat(syl.dataset.duration);
          if (currentTime >= sylTime && currentTime <= sylTime + sylDur) {
            syl.classList.add('active');
            syl.classList.remove('passed');
          } else if (currentTime > sylTime + sylDur) {
            syl.classList.remove('active');
            syl.classList.add('passed');
          } else {
            syl.classList.remove('active', 'passed');
          }
        });
      } else if (idx === currentLineIndex + 1) {
        el.style.display = 'flex';
        el.style.opacity = '0.5';
        syllables.forEach((syl) => syl.classList.remove('active', 'passed'));
      } else {
        el.style.display = 'none';
      }
    });
  }

  _runCountdown(callback) {
    // Recalibrate Joy-Con if connected and in joycon mode so offsets are captured while static
    if (this.mode === 'joycon' && this.joycon && this.joycon.connected) {
      this.joycon.recalibrate();
    }

    this.countdownOverlay.classList.add('active');
    let count = 3;
    this.countdownNumber.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        this.countdownNumber.textContent = count;
      } else {
        clearInterval(interval);
        this.countdownNumber.textContent = 'DANCE!';
        setTimeout(() => {
          this.countdownOverlay.classList.remove('active');
          callback();
        }, 600);
      }
    }, 800);
  }
}
