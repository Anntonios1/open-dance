(() => {
  'use strict';

  const PIXELS_PER_SECOND = 220;
  const HIT_ZONE_X = 80;
  const MAX_SCORE = 13000;
  const TIMING_WINDOWS = {
    perfect: 0.12,
    super: 0.22,
    good: 0.35,
    ok: 0.50
  };
  const SCORE_VALUES = {
    perfect: 130,
    super: 100,
    good: 60,
    ok: 30
  };

  let songs = [];
  let currentSong = null;
  let currentTimeline = null;
  let selectedCoach = 0;
  let selectedMode = 'keyboard';
  let gameState = null;
  let animFrameId = null;
  let pictoElements = {};
  let videoStartTime = 0;
  let useSeparateAudio = false;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    title: $('#screen-title'),
    menu: $('#screen-menu'),
    selection: $('#screen-selection'),
    coach: $('#screen-coach'),
    gameplay: $('#screen-gameplay'),
    results: $('#screen-results')
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function renderDifficulty(difficulty, container) {
    container.innerHTML = '';
    const maxDiff = 4;
    for (let i = 0; i < maxDiff; i++) {
      const star = document.createElement('span');
      star.className = 'star' + (i < difficulty ? '' : ' empty');
      star.textContent = '\u2605';
      container.appendChild(star);
    }
  }

  async function loadSongs() {
    try {
      const res = await fetch('/api/songs');
      songs = await res.json();
      renderSongGrid();
    } catch (err) {
      console.error('Error loading songs:', err);
    }
  }

  function renderSongGrid() {
    const grid = $('#songs-grid');
    grid.innerHTML = '';

    songs.forEach((song, idx) => {
      const card = document.createElement('div');
      card.className = 'song-card' + (idx === 0 ? ' selected' : '');
      card.dataset.index = idx;

      card.innerHTML = `
        <div class="song-card-cover-wrap">
          <img class="song-card-cover" src="${song.coverPath}" alt="${song.title}" loading="lazy">
          <video class="song-card-preview" src="${song.previewUrl}" muted loop playsinline></video>
        </div>
        <div class="song-card-title">${song.title}</div>
        <div class="song-card-artist">${song.artist}</div>
      `;

      card.addEventListener('mouseenter', () => {
        const vid = card.querySelector('.song-card-preview');
        if (vid.src) vid.play().catch(() => {});
      });

      card.addEventListener('mouseleave', () => {
        const vid = card.querySelector('.song-card-preview');
        vid.pause();
        vid.currentTime = 0;
      });

      card.addEventListener('click', () => selectSong(idx));

      grid.appendChild(card);
    });

    if (songs.length > 0) {
      selectSong(0);
    }
  }

  function selectSong(index) {
    $$('.song-card').forEach((c, i) => {
      c.classList.toggle('selected', i === index);
    });

    const song = songs[index];
    currentSong = song;
    selectedCoach = 0;

    $('#preview-cover').src = song.coverPath;
    $('#preview-title').textContent = song.title;
    $('#preview-artist').textContent = song.artist;
    $('#preview-version').textContent = `Just Dance ${song.jdVersion}`;
    renderDifficulty(song.difficulty, $('#preview-difficulty'));

    const previewVid = $('#preview-video');
    previewVid.src = song.previewUrl || '';
    previewVid.load();
    previewVid.play().catch(() => {});
  }

  function openCoachSelection() {
    if (!currentSong) return;

    $('#coach-bkg').src = currentSong.bkgPath;
    $('#coach-cover-small').src = currentSong.coverPath;
    $('#coach-song-title').textContent = currentSong.title;
    $('#coach-song-artist').textContent = currentSong.artist;

    const container = $('#coach-options-big');
    container.innerHTML = '';

    if (currentSong.coaches && currentSong.coaches.length > 0) {
      currentSong.coaches.forEach((coachUrl, i) => {
        const opt = document.createElement('div');
        opt.className = 'coach-option-big' + (i === 0 ? ' selected' : '');
        opt.innerHTML = `<img src="${coachUrl}" alt="Coach ${i + 1}">`;
        opt.addEventListener('click', () => {
          $$('.coach-option-big').forEach(c => c.classList.remove('selected'));
          opt.classList.add('selected');
          selectedCoach = i;
        });
        container.appendChild(opt);
      });
    } else {
      const opt = document.createElement('div');
      opt.className = 'coach-option-big selected';
      opt.innerHTML = `<img src="${currentSong.coverPath}" alt="Coach">`;
      container.appendChild(opt);
    }

    showScreen('coach');
  }

  function getSongTime() {
    if (useSeparateAudio) {
      return $('#game-audio').currentTime;
    }
    return $('#game-video').currentTime - videoStartTime;
  }

  async function startGame() {
    if (!currentSong) return;

    try {
      const res = await fetch(`/api/songs/${currentSong.id}/timeline`);
      currentTimeline = await res.json();
    } catch (err) {
      console.error('Error loading timeline:', err);
      return;
    }

    showScreen('gameplay');

    videoStartTime = currentSong.videoStartTime || 0;
    useSeparateAudio = !!(currentSong.audioUrl && currentSong.videoUrl);

    const hud = $('.game-hud');
    hud.className = 'game-hud';
    if (selectedMode === 'spectator') hud.classList.add('spectator-mode');

    gameState = {
      score: 0,
      stars: 0,
      perfects: 0,
      supers: 0,
      goods: 0,
      oks: 0,
      misses: 0,
      goldMovesHit: 0,
      goldMovesTotal: 0,
      moves: [],
      pictos: [],
      started: false,
      ended: false
    };

    if (currentTimeline.moves) {
      gameState.moves = currentTimeline.moves.filter(m => m.coachID === selectedCoach);
      gameState.goldMovesTotal = gameState.moves.filter(m => m.goldMove === 1).length;
    }

    if (currentTimeline.pictos) {
      gameState.pictos = currentTimeline.pictos.map((p, i) => ({
        ...p,
        index: i,
        hit: false,
        isGold: gameState.moves[i] ? gameState.moves[i].goldMove === 1 : false
      }));
    }

    $$('.star-item').forEach(s => s.classList.remove('earned'));
    $('#star-progress').style.height = '0%';
    $('#picto-track').innerHTML = '';
    pictoElements = {};
    setupLyrics();

    const video = $('#game-video');
    const audio = $('#game-audio');

    if (useSeparateAudio) {
      video.muted = true;
      video.src = currentSong.videoUrl;
      video.load();
      audio.src = currentSong.audioUrl;
      audio.load();

      const videoReady = new Promise((resolve) => {
        video.addEventListener('canplay', resolve, { once: true });
      });
      const audioReady = new Promise((resolve) => {
        audio.addEventListener('canplay', resolve, { once: true });
      });

      Promise.all([videoReady, audioReady]).then(() => {
        video.pause();
        audio.pause();
        video.currentTime = videoStartTime;
        audio.currentTime = 0;
        runCountdown(() => {
          const startBoth = () => {
            video.play().catch(() => {});
            audio.play().catch(() => {});
            gameState.started = true;
            gameLoop();
          };
          if (videoStartTime === 0) {
            startBoth();
          } else {
            video.addEventListener('seeked', startBoth, { once: true });
          }
        });
      });
    } else {
      video.muted = false;
      video.src = currentSong.videoUrl || currentSong.audioUrl;
      video.load();

      video.addEventListener('canplay', function onCanPlay() {
        video.removeEventListener('canplay', onCanPlay);
        video.pause();
        video.currentTime = videoStartTime;
        runCountdown(() => {
          const startVideo = () => {
            video.play().catch(() => {});
            gameState.started = true;
            gameLoop();
          };
          if (videoStartTime === 0) {
            startVideo();
          } else {
            video.addEventListener('seeked', startVideo, { once: true });
          }
        });
      });
    }
  }

  function runCountdown(callback) {
    const overlay = $('#countdown-overlay');
    const numEl = $('#countdown-number');
    overlay.classList.add('active');
    let count = 3;
    numEl.textContent = count;

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        numEl.textContent = count;
      } else {
        clearInterval(interval);
        numEl.textContent = 'DANCE!';
        setTimeout(() => {
          overlay.classList.remove('active');
          callback();
        }, 600);
      }
    }, 800);
  }

  let lyricsLines = [];

  function setupLyrics() {
    const container = $('#lyrics-container');
    container.innerHTML = '';
    if (!currentTimeline.lyrics) return;

    lyricsLines = [];
    let currentLine = [];
    let lineIndex = 0;

    currentTimeline.lyrics.forEach((lyric, i) => {
      currentLine.push({ ...lyric, originalIndex: i });
      if (lyric.isLineEnding && currentLine.length > 0) {
        lyricsLines.push({
          index: lineIndex++,
          words: currentLine,
          startTime: currentLine[0].time,
          endTime: currentLine[currentLine.length - 1].time + currentLine[currentLine.length - 1].duration
        });
        currentLine = [];
      }
    });

    if (currentLine.length > 0) {
      lyricsLines.push({
        index: lineIndex,
        words: currentLine,
        startTime: currentLine[0].time,
        endTime: currentLine[currentLine.length - 1].time + currentLine[currentLine.length - 1].duration
      });
    }

    renderLyricLines();
  }

  function renderLyricLines() {
    const container = $('#lyrics-container');
    container.innerHTML = '';
    lyricsLines.forEach((line) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'lyric-line';
      lineEl.dataset.lineIndex = line.index;
      line.words.forEach(w => {
        const span = document.createElement('span');
        span.className = 'lyric-syllable';
        span.textContent = w.text;
        span.dataset.time = w.time;
        span.dataset.duration = w.duration;
        lineEl.appendChild(span);
      });
      container.appendChild(lineEl);
    });
  }

  function updateLyrics(currentTime) {
    if (!lyricsLines.length) return;

    const lineEls = $$('.lyric-line');
    let currentLineIndex = -1;

    for (let i = 0; i < lyricsLines.length; i++) {
      if (currentTime >= lyricsLines[i].startTime && currentTime <= lyricsLines[i].endTime + 0.5) {
        currentLineIndex = i;
        break;
      }
      if (currentTime < lyricsLines[i].startTime) {
        currentLineIndex = i;
        break;
      }
    }

    if (currentLineIndex < 0) currentLineIndex = lyricsLines.length - 1;

    lineEls.forEach((el, idx) => {
      const line = lyricsLines[idx];
      const syllables = el.querySelectorAll('.lyric-syllable');

      if (idx === currentLineIndex) {
        el.style.display = 'flex';
        el.style.opacity = '1';
        syllables.forEach(syl => {
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
        syllables.forEach(syl => syl.classList.remove('active', 'passed'));
      } else {
        el.style.display = 'none';
      }
    });
  }

  function gameLoop() {
    if (!gameState.started || gameState.ended) return;

    const currentTime = getSongTime();

    updateLyrics(currentTime);
    updatePictos(currentTime);
    updateStars();

    if (selectedMode === 'autoplay') {
      handleAutoplay(currentTime);
    }

    const mediaEnded = useSeparateAudio
      ? ($('#game-audio').ended)
      : ($('#game-video').ended);

    if (mediaEnded) {
      endGame();
      return;
    }

    animFrameId = requestAnimationFrame(gameLoop);
  }

  function updatePictos(currentTime) {
    const track = $('#picto-track');
    const container = $('.hud-pictos');
    const containerWidth = container.offsetWidth || 700;

    gameState.pictos.forEach((picto, i) => {
      const timeDiff = picto.time - currentTime;
      const x = HIT_ZONE_X + timeDiff * PIXELS_PER_SECOND;

      if (x > containerWidth + 120 || x < -120) {
        if (pictoElements[i]) {
          pictoElements[i].remove();
          delete pictoElements[i];
        }
        if (!picto.hit && timeDiff < -TIMING_WINDOWS.ok && selectedMode === 'keyboard') {
          picto.hit = true;
          gameState.misses++;
        }
        return;
      }

      if (!pictoElements[i] && x < containerWidth + 80) {
        const el = document.createElement('div');
        el.className = 'picto-item' + (picto.isGold ? ' gold' : '');
        el.innerHTML = `<img src="/songs/${currentSong.id}/pictos/${picto.name}.png" alt="">`;
        track.appendChild(el);
        pictoElements[i] = el;
      }

      if (pictoElements[i]) {
        pictoElements[i].style.left = x + 'px';
      }
    });
  }

  function handleAutoplay(currentTime) {
    gameState.pictos.forEach((picto, i) => {
      if (picto.hit) return;
      const timeDiff = Math.abs(currentTime - picto.time);
      if (timeDiff < TIMING_WINDOWS.perfect) {
        const rand = Math.random();
        let rating;
        if (rand < 0.5) rating = 'perfect';
        else if (rand < 0.8) rating = 'super';
        else if (rand < 0.95) rating = 'good';
        else rating = 'ok';
        hitPicto(i, rating);
      }
    });
  }

  function handleKeyboardHit() {
    if (!gameState || !gameState.started || gameState.ended) return;
    if (selectedMode !== 'keyboard') return;

    const currentTime = getSongTime();

    let bestIdx = -1;
    let bestDiff = Infinity;

    gameState.pictos.forEach((picto, i) => {
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
      hitPicto(bestIdx, rating);
    }
  }

  function hitPicto(index, rating) {
    const picto = gameState.pictos[index];
    if (!picto || picto.hit) return;
    picto.hit = true;

    const scoreAdd = SCORE_VALUES[rating] || 0;
    gameState.score = Math.min(MAX_SCORE, gameState.score + scoreAdd);

    if (rating === 'perfect') gameState.perfects++;
    else if (rating === 'super') gameState.supers++;
    else if (rating === 'good') gameState.goods++;
    else if (rating === 'ok') gameState.oks++;

    if (picto.isGold) {
      gameState.goldMovesHit++;
      triggerGoldFlash();
    }

    showRating(rating);

    if (pictoElements[index]) {
      pictoElements[index].classList.add('hit');
      setTimeout(() => {
        if (pictoElements[index]) {
          pictoElements[index].remove();
          delete pictoElements[index];
        }
      }, 300);
    }
  }

  function showRating(rating) {
    const el = $('#rating-display');
    el.className = 'rating-display';
    const labels = {
      perfect: 'PERFECT',
      super: 'SUPER',
      good: 'GOOD',
      ok: 'OK',
      miss: 'X MISS'
    };
    el.textContent = labels[rating] || '';
    el.classList.add(`rating-${rating}`, 'show');
    setTimeout(() => el.classList.remove('show'), 500);
  }

  function triggerGoldFlash() {
    const flash = $('#gold-flash');
    flash.classList.remove('active');
    void flash.offsetHeight;
    flash.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 800);
  }

  function updateStars() {
    const pct = (gameState.score / MAX_SCORE) * 100;
    const progress = $('#star-progress');
    progress.style.height = pct + '%';

    const thresholds = [
      { star: 1, pct: 20 },
      { star: 2, pct: 38 },
      { star: 3, pct: 55 },
      { star: 4, pct: 77 },
      { star: 5, pct: 92 }
    ];

    thresholds.forEach(t => {
      const item = $(`.star-item[data-star="${t.star}"]`);
      if (pct >= t.pct && !item.classList.contains('earned')) {
        item.classList.add('earned');
      }
    });

    gameState.stars = thresholds.filter(t => pct >= t.pct).length;
  }

  function endGame() {
    gameState.ended = true;
    if (animFrameId) cancelAnimationFrame(animFrameId);

    const video = $('#game-video');
    const audio = $('#game-audio');
    video.pause();
    if (audio) audio.pause();

    setTimeout(() => showResults(), 500);
  }

  function showResults() {
    showScreen('results');

    const totalMoves = gameState.pictos.length;
    const starsHtml = [];
    for (let i = 1; i <= 5; i++) {
      starsHtml.push(`<span class="r-star${i <= gameState.stars ? ' earned' : ''}">\u2605</span>`);
    }
    $('#results-stars').innerHTML = starsHtml.join('');

    animateCounter($('#results-score'), gameState.score, 1500);
    $('#stat-perfects').textContent = gameState.perfects;
    $('#stat-supers').textContent = gameState.supers;
    $('#stat-goods').textContent = gameState.goods;
    $('#stat-misses').textContent = gameState.misses;
    $('#stat-golds').textContent = `${gameState.goldMovesHit}/${gameState.goldMovesTotal}`;

    const pct = gameState.score / MAX_SCORE;
    let rankTitle = 'BEGINNER';
    if (pct >= 0.92) rankTitle = 'MEGASTAR';
    else if (pct >= 0.77) rankTitle = 'SUPERSTAR';
    else if (pct >= 0.55) rankTitle = 'DANCE STAR';
    else if (pct >= 0.38) rankTitle = 'RISING STAR';
    else if (pct >= 0.2) rankTitle = 'STAR';
    $('#results-title').textContent = rankTitle;

    startConfetti();
  }

  function animateCounter(el, target, duration) {
    let start = 0;
    const startTime = performance.now();
    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function startConfetti() {
    const canvas = $('#confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#e91e8c', '#9c27b0', '#00b4d8', '#ffc107', '#4caf50', '#f44336'];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 10 + 5,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 2,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2
      });
    }

    let confettiFrame;
    function drawConfetti() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        if (p.y > canvas.height + 20) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      confettiFrame = requestAnimationFrame(drawConfetti);
    }
    drawConfetti();

    setTimeout(() => {
      cancelAnimationFrame(confettiFrame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 8000);
  }

  /* ===== EVENT LISTENERS ===== */

  // Title screen -> Main Menu
  screens.title.addEventListener('click', () => showScreen('menu'));

  // Main menu buttons
  $$('.menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.menu === 'justdance') {
        showScreen('selection');
      }
    });
  });

  // Sidebar navigation
  $$('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.sidebar-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // Play song button -> Coach selection
  $('#play-song-btn').addEventListener('click', openCoachSelection);

  // Coach selection -> Gameplay
  $('#coach-options-big').addEventListener('click', (e) => {
    const opt = e.target.closest('.coach-option-big');
    if (opt) {
      $$('.coach-option-big').forEach(c => c.classList.remove('selected'));
      opt.classList.add('selected');
      selectedCoach = Array.from($$('#coach-options-big .coach-option-big')).indexOf(opt);
    }
  });

  // Click on coach screen background starts game
  screens.coach.addEventListener('click', (e) => {
    if (e.target.closest('.coach-option-big') || e.target.closest('.coach-bottom-bar')) return;
    startGame();
  });

  // Results buttons
  $('#retry-btn').addEventListener('click', () => {
    showScreen('gameplay');
    startGame();
  });

  $('#back-btn').addEventListener('click', () => showScreen('selection'));

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (screens.title.classList.contains('active')) {
        showScreen('menu');
      } else if (screens.gameplay.classList.contains('active')) {
        handleKeyboardHit();
      }
    }
    if (e.code === 'Enter') {
      if (screens.menu.classList.contains('active')) {
        showScreen('selection');
      } else if (screens.selection.classList.contains('active')) {
        openCoachSelection();
      } else if (screens.coach.classList.contains('active')) {
        startGame();
      }
    }
    if (e.code === 'Escape') {
      if (screens.coach.classList.contains('active')) {
        showScreen('selection');
      } else if (screens.gameplay.classList.contains('active')) {
        endGame();
      } else if (screens.results.classList.contains('active')) {
        showScreen('selection');
      }
    }
    if (e.code === 'ArrowRight' && screens.selection.classList.contains('active')) {
      const selected = $('.song-card.selected');
      if (selected) {
        const next = selected.nextElementSibling;
        if (next) {
          const idx = parseInt(next.dataset.index);
          selectSong(idx);
          next.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }
      }
    }
    if (e.code === 'ArrowLeft' && screens.selection.classList.contains('active')) {
      const selected = $('.song-card.selected');
      if (selected) {
        const prev = selected.previousElementSibling;
        if (prev) {
          const idx = parseInt(prev.dataset.index);
          selectSong(idx);
          prev.scrollIntoView({ behavior: 'smooth', inline: 'center' });
        }
      }
    }
  });

  // Initialize
  loadSongs();
})();
