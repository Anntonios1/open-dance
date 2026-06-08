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

    this.video.addEventListener('waiting', () => {
      this._log('warn', 'Video buffering');
    });
  }

  _getSongTime() {
    if (this.useSeparateAudio && this.audio) {
      return this.audio.currentTime;
    }
    return this.video.currentTime - this.videoStartTime;
  }

  start(song, coachID = 0, mode = 'keyboard') {
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

      this._log('info', `Game state initialized: ${this.state.pictos.length} pictos, ${this.state.goldMovesTotal} gold moves`);

      this.videoStartTime = song.videoStartTime || 0;
      this.useSeparateAudio = song.hasSeparateAudio() && !!song.videoUrl;
      this._log('info', `videoStartTime: ${this.videoStartTime}s, separateAudio: ${this.useSeparateAudio}`);

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
          this._log('info', 'Video and audio ready, starting countdown');
          this._runCountdown(() => {
            this.video.currentTime = this.videoStartTime;
            this.video.play().catch((err) => {
              this._log('error', `Video play() failed: ${err.message}`);
            });
            this.audio.play().catch((err) => {
              this._log('error', `Audio play() failed: ${err.message}`);
            });
            this.state.started = true;
            this._log('info', 'Game loop started');
            this._gameLoop();
          });
        });
      } else {
        this.video.muted = false;
        this.video.src = mediaUrl;
        this.video.load();

        this.video.addEventListener(
          'canplay',
          () => {
            this._log('info', 'Video ready, starting countdown');
            this._runCountdown(() => {
              if (this.videoStartTime > 0) {
                this.video.currentTime = this.videoStartTime;
              }
              this.video.play().catch((err) => {
                this._log('error', `Video play() failed: ${err.message}`);
              });
              this.state.started = true;
              this._log('info', 'Game loop started');
              this._gameLoop();
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
    this.video.pause();
    if (this.audio) this.audio.pause();
  }

  _gameLoop() {
    if (!this.state.started || this.state.ended) return;

    try {
      const currentTime = this._getSongTime();

      this._updateLyrics(currentTime);
      this._updatePictos(currentTime);
      this._updateStars();

      if (this.mode === 'autoplay') {
        this._handleAutoplay(currentTime);
      }

      const mediaEnded = this.useSeparateAudio
        ? (this.audio && this.audio.ended)
        : this.video.ended;

      if (mediaEnded) {
        this._log('info', 'Media ended, showing results');
        this.state.ended = true;
        setTimeout(() => this.onEnd(this.getResults()), 500);
        return;
      }

      this.animFrameId = requestAnimationFrame(() => this._gameLoop());
    } catch (err) {
      this._log('error', `Game loop error: ${err.message}`, err.stack);
      this.animFrameId = requestAnimationFrame(() => this._gameLoop());
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

  _hitPicto(index, rating) {
    const picto = this.state.pictos[index];
    if (!picto || picto.hit) return;
    picto.hit = true;

    this.state.score = Math.min(MAX_SCORE, this.state.score + (SCORE_VALUES[rating] || 0));

    if (rating === 'perfect') this.state.perfects++;
    else if (rating === 'super') this.state.supers++;
    else if (rating === 'good') this.state.goods++;
    else if (rating === 'ok') this.state.oks++;

    if (picto.isGold) {
      this.state.goldMovesHit++;
      this._triggerGoldFlash();
      if (rating === 'perfect' || rating === 'super') {
        rating = 'yeah';
      }
    }

    this._showRating(rating);

    if (this.pictoElements[index]) {
      this.pictoElements[index].classList.add('hit');
      setTimeout(() => {
        if (this.pictoElements[index]) {
          this.pictoElements[index].remove();
          delete this.pictoElements[index];
        }
      }, 300);
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
