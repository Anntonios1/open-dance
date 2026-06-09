import SongLoader from './SongLoader.js';
import ScreenManager from './ScreenManager.js';
import GameEngine from './GameEngine.js';
import UIManager from './UIManager.js';
import ResultsScreen from './ResultsScreen.js';
import InputHandler from './InputHandler.js';
import NebulaEffect from './NebulaEffect.js';
import JoyConController from './JoyConController.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let songs = [];
let currentSong = null;
let selectedCoach = 0;
let profiles = [];
let activeProfile = null;

// Joy-Con controller instance
const joycon = new JoyConController();
joycon.onStateChange = (connected) => {
  const btn = $('#joycon-connect-btn');
  const indicator = $('#joycon-status-indicator');
  if (btn) {
    btn.textContent = connected ? `🎮 Joy-Con ${joycon.side} conectado` : '🎮 Conectar Joy-Con';
    btn.classList.toggle('connected', connected);
  }
  if (indicator) {
    indicator.style.display = connected ? 'flex' : 'none';
    if (connected) indicator.querySelector('.joycon-side-label').textContent = `Joy-Con (${joycon.side})`;
  }
};

// Modos de juego
const gameModifiers = {
  partyMode: {
    invert: false,
    blur: false,
    speed: false
  },
  workoutMode: {
    active: false,
    targetKcal: 200,
    intensity: 'medium'
  }
};

const screenManager = new ScreenManager({
  title: $('#screen-title'),
  menu: $('#screen-menu'),
  selection: $('#screen-selection'),
  loading: $('#screen-loading'),
  coach: $('#screen-coach'),
  'intro-nebula': $('#screen-intro-nebula'),
  gameplay: $('#screen-gameplay'),
  results: $('#screen-results'),
});

// Nebula canvas background
const nebula = new NebulaEffect('nebula-canvas');
nebula.start();
nebula.setMode('menu');

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
  hudPlayerCard: $('.hud-player-card'),
  onEnd: (r) => showResults(r),
});

// ==========================================
// PESTAÑAS (TABS NAVIGATION)
// ==========================================
function switchTab(tabId) {
  $$('.sidebar-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });

  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `${tabId}-panel`);
  });

  // Si cambiamos de pestaña, ocultar el detalle
  closeDetailView();

  // Si volvemos al Home, actualizar el banner de canción destacada
  if (tabId === 'home' && songs.length > 0) {
    updateFeaturedSongBanner();
  }
}

function updateFeaturedSongBanner() {
  if (songs.length === 0) return;
  const seed = new Date().getDate() % songs.length;
  const featured = songs[seed];
  
  $('#featured-song-cover').src = featured.coverPath;
  $('#featured-song-title').textContent = featured.title;
  $('#featured-song-artist').textContent = featured.artist;

  // Hacer que al hacer clic en la destacada la seleccione directamente
  const banner = $('#featured-song-card');
  banner.onclick = () => {
    switchTab('songs');
    const songIndex = songs.indexOf(featured);
    if (songIndex !== -1) selectSong(songIndex);
  };
}

// ==========================================
// VISTA DETALLADA DE CANCIÓN
// ==========================================
function selectSong(index) {
  ui.updateSongSelection(index);
  currentSong = songs[index];
  selectedCoach = 0;
  
  // Renderizar y abrir el panel de detalles
  ui.updatePreview(currentSong, activeProfile);
  $('#detail-view-panel').classList.add('active');
}

function closeDetailView() {
  const detailPanel = $('#detail-view-panel');
  if (detailPanel.classList.contains('active')) {
    detailPanel.classList.remove('active');
    
    // Detener y limpiar el video
    const detailVid = $('#detail-video');
    detailVid.pause();
    detailVid.src = '';
  }
}

// ==========================================
// GESTIÓN DE PERFILES (DANCE CARDS)
// ==========================================
async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    if (res.ok) {
      profiles = await res.ok ? await res.json() : [];
      activeProfile = profiles.find((p) => p.is_active === 1) || profiles[0] || null;
      if (activeProfile) {
        ui.updateActiveProfileUI(activeProfile);
      }
    }
  } catch (err) {
    console.error('Error al cargar perfiles:', err);
  }
}

async function createProfile(name, avatar) {
  try {
    const res = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, avatar }),
    });
    if (res.ok) {
      await loadProfiles();
      openProfilesModal();
    }
  } catch (err) {
    console.error('Error al crear perfil:', err);
  }
}

async function activateProfile(id) {
  try {
    const res = await fetch(`/api/profiles/${id}/activate`, { method: 'PUT' });
    if (res.ok) {
      const updatedList = await res.json();
      profiles = updatedList;
      activeProfile = profiles.find((p) => p.is_active === 1);
      ui.updateActiveProfileUI(activeProfile);
      
      // Actualizar vista previa del leaderboard
      if (currentSong) {
        ui.renderLeaderboards(currentSong.title, activeProfile);
      }
      
      closeProfilesModal();
    }
  } catch (err) {
    console.error('Error al activar perfil:', err);
  }
}

async function deleteProfile(id) {
  if (profiles.length <= 1) {
    alert('No puedes eliminar el único perfil existente.');
    return;
  }
  if (!confirm('¿Seguro que deseas eliminar este perfil?')) return;
  
  try {
    const res = await fetch(`/api/profiles/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const updatedList = await res.json();
      profiles = updatedList;
      activeProfile = profiles.find((p) => p.is_active === 1);
      ui.updateActiveProfileUI(activeProfile);
      
      // Actualizar listado en modal
      openProfilesModal();
    }
  } catch (err) {
    console.error('Error al eliminar perfil:', err);
  }
}

function openProfilesModal() {
  ui.renderProfilesModal(profiles, activateProfile, deleteProfile);
  ui.renderAvatarOptions('/assets/avatars/avatar_01.png');
  $('#dance-cards-modal').classList.add('active');
}

function closeProfilesModal() {
  $('#dance-cards-modal').classList.remove('active');
}

// ==========================================
// INICIAR PARTIDA
// ==========================================
function openCoachSelection() {
  if (!currentSong) return;
  // Detener el vídeo de la previa antes de salir
  const detailVid = $('#detail-video');
  detailVid.pause();
  
  // Asignar datos de canción a la pantalla de carga
  const loadCover = $('#loading-song-cover');
  const loadTitle = $('#loading-song-title');
  const loadArtist = $('#loading-song-artist');
  if (loadCover) loadCover.src = currentSong.coverPath || '';
  if (loadTitle) loadTitle.textContent = currentSong.title || '';
  if (loadArtist) loadArtist.textContent = currentSong.artist || '';

  // Iniciar animación de la barra de progreso
  const loadingBar = $('.loading-progress-bar');
  if (loadingBar) {
    loadingBar.style.width = '0%';
    void loadingBar.offsetHeight; // forzar reflow
    setTimeout(() => {
      loadingBar.style.width = '100%';
    }, 50);
  }

  // Nebula: modo loading
  nebula.setMode('loading');

  // Mostrar pantalla de carga
  screenManager.show('loading');

  // Transicionar a la pantalla de coaches tras la carga de 1.8 segundos
  setTimeout(() => {
    ui.renderCoachSelection(currentSong, activeProfile);
    // Reset nebula to menu for coach screen
    nebula.setMode('menu');
    screenManager.show('coach');
  }, 1800);
}

async function startGame() {
  if (!currentSong) return;
  try {
    await SongLoader.fetchTimeline(currentSong);
  } catch (err) {
    console.error('[main] Error loading timeline:', err);
    alert(`Error cargando la canción: ${err.message}`);
    screenManager.show('selection');
    return;
  }
  
  // Configurar HUD de entrenamiento
  if (gameModifiers.workoutMode.active) {
    $('#hud-workout-widget').style.display = 'flex';
  } else {
    $('#hud-workout-widget').style.display = 'none';
  }

  // Ensure the picto-rail divider is injected once
  const pictoContainer = $('.hud-pictos');
  if (pictoContainer && !pictoContainer.querySelector('.picto-rail')) {
    const rail = document.createElement('div');
    rail.className = 'picto-rail';
    pictoContainer.appendChild(rail);
  }

  // Apply adaptive color CSS vars based on selected coach
  const coachColors = [
    { color: '#db2777', glow: 'rgba(219,39,119,0.5)' },   // coach 0 - magenta
    { color: '#06b6d4', glow: 'rgba(6,182,212,0.5)' },    // coach 1 - cyan
    { color: '#7c3aed', glow: 'rgba(124,58,237,0.5)' },   // coach 2 - purple
    { color: '#10b981', glow: 'rgba(16,185,129,0.5)' },   // coach 3 - green
  ];
  const cc = coachColors[selectedCoach] || coachColors[0];
  document.documentElement.style.setProperty('--player-color', cc.color);
  document.documentElement.style.setProperty('--player-color-glow', cc.glow);

  // Determine game mode: joycon if connected, keyboard fallback
  const gameMode = (joycon.connected) ? 'joycon' : 'keyboard';
  if (gameMode === 'joycon') {
    gameEngine.setJoyCon(joycon);
  }

  // Warp nebula effect during intro
  nebula.setMode('warp');
  screenManager.show('intro-nebula');

  // Preload MSM files during the intro overlay
  if (gameMode === 'joycon') {
    gameEngine.start(currentSong, selectedCoach, gameMode, gameModifiers, activeProfile);
    // state is now initialised — preload MSMs in background
    gameEngine._preloadMSM().catch(e => console.warn('[main] MSM preload error:', e));
    // wait for intro to finish then the game loop is already running
    await new Promise(resolve => setTimeout(resolve, 2200));
    nebula.setMode('menu');
    screenManager.show('gameplay');
  } else {
    await new Promise(resolve => setTimeout(resolve, 2200));
    nebula.setMode('menu');
    screenManager.show('gameplay');
    gameEngine.start(currentSong, selectedCoach, gameMode, gameModifiers, activeProfile);
  }
}

function showResults(r) {
  screenManager.show('results');
  results.show(r);

  // Guardar puntaje en el HUD/Home si es record
  if (r && r.score && activeProfile) {
    $('#home-stat-score').textContent = r.score.toLocaleString();
  }

  // Mostrar datos de calorías en resultados si workout estaba activo
  if (gameModifiers.workoutMode.active && r && r.workoutKcal) {
    $('#results-workout-box').style.display = 'block';
    $('#results-workout-kcal-txt').textContent = r.workoutKcal.toFixed(1);
  } else {
    $('#results-workout-box').style.display = 'none';
  }
}

// ==========================================
// EVENT LISTENERS
// ==========================================
screenManager.screens.title.addEventListener('click', () => screenManager.show('menu'));

$$('.menu-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.menu === 'justdance') {
      screenManager.show('selection');
      switchTab('home');
    }
  });
});

// Pestañas del menú lateral
$$('.sidebar-item').forEach((item) => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    // El botón de volver atrás de la previa es el propio tab de canciones
    if (tab) switchTab(tab);
  });
});

// Volver atrás en el catálogo (botón de flecha izquierda en sidebar superior)
// Usamos el botón sidebar-icon de Home para volver, pero implementemos un botón para la previa
// En index.html, la previa se cierra con la pestaña Songs o con el botón Back en main
$('#home-play-now-btn').addEventListener('click', () => switchTab('songs'));

// Botón "DANCE" en la vista de detalle
$('#detail-dance-btn').addEventListener('click', openCoachSelection);

// Perfiles y Dance Cards
$('#sidebar-active-profile-btn').addEventListener('click', openProfilesModal);
$('#sidebar-add-profile-btn').addEventListener('click', openProfilesModal);
$('#modal-close-btn').addEventListener('click', closeProfilesModal);

$('#create-profile-submit').addEventListener('click', () => {
  const nameInput = $('#create-profile-name');
  const name = nameInput.value.trim();
  const avatarGrid = $('#avatar-selector-grid');
  const avatar = avatarGrid.dataset.selected || '/assets/avatars/avatar_01.png';

  if (!name) {
    alert('Ingresa un nombre válido');
    return;
  }
  createProfile(name, avatar);
  nameInput.value = '';
});

// Selección de Coaches
$('#coach-options-big').addEventListener('click', (e) => {
  const opt = e.target.closest('.coach-option-big');
  if (opt) {
    selectedCoach = parseInt(opt.dataset.index);
    ui.updateCoachSelection(selectedCoach);
  }
});

screenManager.screens.coach.addEventListener('click', (e) => {
  if (e.target.closest('.coach-option-big') || e.target.closest('.coach-bottom-bar')) return;
  startGame();
});

// Resultados
$('#retry-btn').addEventListener('click', () => {
  screenManager.show('gameplay');
  startGame();
});

$('#back-btn').addEventListener('click', () => {
  screenManager.show('selection');
  switchTab('songs');
});

// ==========================================
// MODOS DE JUEGO (EVENTOS DE TOGGLE)
// ==========================================
// Toggles en Modo Fiesta
$('#checkbox-invert').addEventListener('change', (e) => {
  gameModifiers.partyMode.invert = e.target.checked;
});
$('#checkbox-blur').addEventListener('change', (e) => {
  gameModifiers.partyMode.blur = e.target.checked;
});
$('#checkbox-speed').addEventListener('change', (e) => {
  gameModifiers.partyMode.speed = e.target.checked;
});

// Cambiar de Dance Card en la pantalla de Coach
screenManager.screens.coach.querySelector('.coach-footer-hints').addEventListener('click', (e) => {
  if (e.target.textContent.includes('Dancer Card')) {
    openProfilesModal();
  }
});

// ==========================================
// TECLADO (INPUT HANDLER)
// ==========================================
input
  .on('space', () => {
    if (screenManager.isActive('title')) screenManager.show('menu');
    else if (screenManager.isActive('gameplay')) gameEngine.handleKeyboardHit();
  })
  .on('enter', () => {
    if (screenManager.isActive('menu')) screenManager.show('selection');
    else if (screenManager.isActive('selection')) {
      const detailActive = $('#detail-view-panel').classList.contains('active');
      if (detailActive) openCoachSelection();
    } else if (screenManager.isActive('coach')) startGame();
  })
  .on('escape', () => {
    if (screenManager.isActive('coach')) {
      screenManager.show('selection');
      $('#detail-view-panel').classList.add('active'); // reabrir la previa
    }
    else if (screenManager.isActive('gameplay')) gameEngine.stop();
    else if (screenManager.isActive('results')) {
      screenManager.show('selection');
      switchTab('songs');
    }
    else if (screenManager.isActive('selection')) {
      const detailActive = $('#detail-view-panel').classList.contains('active');
      if (detailActive) closeDetailView();
      else screenManager.show('menu');
    }
  })
  .on('arrowDown', () => {
    if (!screenManager.isActive('selection') || $('#detail-view-panel').classList.contains('active')) return;
    const selected = $('.song-card.selected');
    if (selected && selected.nextElementSibling) {
      const next = selected.nextElementSibling;
      selectSong(parseInt(next.dataset.index));
      next.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  })
  .on('arrowUp', () => {
    if (!screenManager.isActive('selection') || $('#detail-view-panel').classList.contains('active')) return;
    const selected = $('.song-card.selected');
    if (selected && selected.previousElementSibling) {
      const prev = selected.previousElementSibling;
      selectSong(parseInt(prev.dataset.index));
      prev.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  })
  .on('arrowRight', () => {
    if (screenManager.isActive('coach')) {
      const coaches = $$('.coach-option-big');
      if (selectedCoach < coaches.length - 1) {
        selectedCoach++;
        ui.updateCoachSelection(selectedCoach);
      }
    }
  })
  .on('arrowLeft', () => {
    if (screenManager.isActive('coach')) {
      if (selectedCoach > 0) {
        selectedCoach--;
        ui.updateCoachSelection(selectedCoach);
      }
    } else if (screenManager.isActive('selection')) {
      // Si el panel de detalles está activo, la flecha izquierda cierra la previa
      closeDetailView();
    }
  })
  .bind();

// Carga Inicial
async function init() {
  await loadProfiles();
  
  songs = await SongLoader.fetchAllSongs();
  ui.renderSongGrid(songs, selectSong);
  
  // Configurar destacados en la Home
  updateFeaturedSongBanner();
  
  // Agregar buscador en catálogo
  $('#songs-search').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = songs.filter(s => s.title.toLowerCase().includes(query) || s.artist.toLowerCase().includes(query));
    ui.renderSongGrid(filtered, (idx) => {
      const realIndex = songs.indexOf(filtered[idx]);
      if (realIndex !== -1) selectSong(realIndex);
    });
  });

  // Botón para conectar Joy-Con
  const connectBtn = $('#joycon-connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      try {
        await joycon.connect();
      } catch (err) {
        console.error('[main] Joy-Con connection failed:', err);
        alert(`Error al conectar Joy-Con: ${err.message}`);
      }
    });
  }
}

init();
