import SongLoader from './SongLoader.js';
import ScreenManager from './ScreenManager.js';
import GameEngine from './GameEngine.js';
import UIManager from './UIManager.js';
import ResultsScreen from './ResultsScreen.js';
import InputHandler from './InputHandler.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let songs = [];
let currentSong = null;
let selectedCoach = 0;

const screenManager = new ScreenManager({
  title: $('#screen-title'),
  menu: $('#screen-menu'),
  selection: $('#screen-selection'),
  coach: $('#screen-coach'),
  gameplay: $('#screen-gameplay'),
  results: $('#screen-results'),
});

const ui = new UIManager();
const results = new ResultsScreen();
const input = new InputHandler();

const gameEngine = new GameEngine({
  videoElement: $('#game-video'),
  audioElement: $('#game-audio'),
  pictoTrack: $('#picto-track'),
  pictoContainer: $('.hud-pictos'),
  lyricsContainer: $('#lyrics-container'),
  ratingDisplay: $('#rating-display'),
  starProgress: $('#star-progress'),
  starList: $('#star-list'),
  goldFlash: $('#gold-flash'),
  countdownOverlay: $('#countdown-overlay'),
  countdownNumber: $('#countdown-number'),
  hudElement: $('.game-hud'),
  onEnd: (r) => showResults(r),
});

function selectSong(index) {
  ui.updateSongSelection(index);
  currentSong = songs[index];
  selectedCoach = 0;
  ui.updatePreview(currentSong);
}

function openCoachSelection() {
  if (!currentSong) return;
  ui.renderCoachSelection(currentSong);
  screenManager.show('coach');
}

async function startGame() {
  if (!currentSong) {
    console.error('[main] No song selected');
    return;
  }
  try {
    console.log(`[main] Loading timeline for: ${currentSong.title}`);
    await SongLoader.fetchTimeline(currentSong);
    console.log('[main] Timeline loaded, starting game');
  } catch (err) {
    console.error('[main] Error loading timeline:', err);
    alert(`Error cargando la canción: ${err.message}`);
    screenManager.show('selection');
    return;
  }
  screenManager.show('gameplay');
  gameEngine.start(currentSong, selectedCoach, 'keyboard');
}

function showResults(r) {
  screenManager.show('results');
  results.show(r);
}

async function loadSongs() {
  songs = await SongLoader.fetchAllSongs();
  ui.renderSongGrid(songs, selectSong);
  if (songs.length > 0) selectSong(0);
}

screenManager.screens.title.addEventListener('click', () => screenManager.show('menu'));

$$('.menu-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.menu === 'justdance') screenManager.show('selection');
  });
});

$$('.sidebar-item').forEach((item) => {
  item.addEventListener('click', () => {
    $$('.sidebar-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
  });
});

$('#play-song-btn').addEventListener('click', openCoachSelection);

$('#coach-options-big').addEventListener('click', (e) => {
  const opt = e.target.closest('.coach-option-big');
  if (opt) {
    selectedCoach = Array.from($$('#coach-options-big .coach-option-big')).indexOf(opt);
    ui.updateCoachSelection(selectedCoach);
  }
});

screenManager.screens.coach.addEventListener('click', (e) => {
  if (e.target.closest('.coach-option-big') || e.target.closest('.coach-bottom-bar')) return;
  startGame();
});

$('#retry-btn').addEventListener('click', () => {
  screenManager.show('gameplay');
  startGame();
});

$('#back-btn').addEventListener('click', () => screenManager.show('selection'));

input
  .on('space', () => {
    if (screenManager.isActive('title')) screenManager.show('menu');
    else if (screenManager.isActive('gameplay')) gameEngine.handleKeyboardHit();
  })
  .on('enter', () => {
    if (screenManager.isActive('menu')) screenManager.show('selection');
    else if (screenManager.isActive('selection')) openCoachSelection();
    else if (screenManager.isActive('coach')) startGame();
  })
  .on('escape', () => {
    if (screenManager.isActive('coach')) screenManager.show('selection');
    else if (screenManager.isActive('gameplay')) gameEngine.stop();
    else if (screenManager.isActive('results')) screenManager.show('selection');
  })
  .on('arrowRight', () => {
    if (!screenManager.isActive('selection')) return;
    const selected = $('.song-card.selected');
    if (selected && selected.nextElementSibling) {
      const next = selected.nextElementSibling;
      selectSong(parseInt(next.dataset.index));
      next.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }
  })
  .on('arrowLeft', () => {
    if (!screenManager.isActive('selection')) return;
    const selected = $('.song-card.selected');
    if (selected && selected.previousElementSibling) {
      const prev = selected.previousElementSibling;
      selectSong(parseInt(prev.dataset.index));
      prev.scrollIntoView({ behavior: 'smooth', inline: 'center' });
    }
  })
  .bind();

loadSongs();
