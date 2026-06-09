export default class UIManager {
  constructor() {
    this.$ = (sel) => document.querySelector(sel);
    this.$$ = (sel) => document.querySelectorAll(sel);
  }

  renderDifficulty(difficulty, container) {
    container.innerHTML = '';
    const maxDiff = 4;
    for (let i = 0; i < maxDiff; i++) {
      const star = document.createElement('span');
      star.className = 'star' + (i < difficulty ? '' : ' empty');
      star.textContent = '\u2605';
      container.appendChild(star);
    }
  }

  renderSongGrid(songs, onSelect) {
    const grid = this.$('#songs-grid');
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
        <div class="song-card-details">
          <div class="song-card-title">${song.title}</div>
          <div class="song-card-artist">${song.artist}</div>
          <div class="song-card-meta">
            <span class="song-card-difficulty-pill">★ Dificultad: ${song.difficulty}/4</span>
            <span class="song-card-coach-pill">${song.numCoach || 1} Coach(es)</span>
          </div>
        </div>
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

      card.addEventListener('click', () => onSelect(idx));
      grid.appendChild(card);
    });
  }

  updateSongSelection(index) {
    this.$$('.song-card').forEach((c, i) => {
      c.classList.toggle('selected', i === index);
    });
  }

  updatePreview(song, activeProfile) {
    this.$('#detail-title').textContent = song.title;
    this.$('#detail-artist').textContent = song.artist;
    this.$('#detail-edition').textContent = `Just Dance ${song.jdVersion} Edition`;
    
    // Mapear esfuerzo y dificultad en español
    const efforts = ['Chill', 'Moderate', 'Intense', 'Extreme'];
    const effort = efforts[song.difficulty - 1] || 'Moderate';
    this.$('#detail-difficulty').textContent = ['Fácil', 'Medio', 'Difícil', 'Extremo'][song.difficulty - 1] || 'Medio';
    this.$('#detail-effort').textContent = effort;
    this.$('#detail-coaches').textContent = song.numCoach || 1;

    const previewVid = this.$('#detail-video');
    previewVid.src = song.previewUrl || '';
    previewVid.muted = false;
    previewVid.volume = 0.4;
    previewVid.load();
    previewVid.play().catch((e) => console.warn('Autoplay blocked:', e.message));

    // Renderizar leaderboards dinámicos
    this.renderLeaderboards(song.title, activeProfile);
  }

  renderLeaderboards(songTitle, activeProfile) {
    const worldList = this.$('#world-leaderboard-list');
    const friendsList = this.$('#friends-leaderboard-list');
    
    const seed = songTitle.charCodeAt(0) || 10;
    const worldPlayers = [
      { name: 'agus :)', score: 13300 + (seed % 29), avatar: '/assets/avatars/avatar_02.png' },
      { name: 'Manu', score: 13200 + (seed % 17), avatar: '/assets/avatars/avatar_01.png' },
      { name: 'nivek', score: 13080 + (seed % 13), avatar: '/assets/avatars/avatar_03.png' }
    ];
    
    const friendsPlayers = [
      { name: 'huwi', score: 13180 + (seed % 19), avatar: '/assets/avatars/avatar_04.png' },
      { name: activeProfile ? activeProfile.name : 'Player 1', score: 12500 + (seed % 400), avatar: activeProfile ? activeProfile.avatar : '/assets/avatars/avatar_01.png' },
      { name: 'れい <3', score: 12180 + (seed % 99), avatar: '/assets/avatars/avatar_02.png' }
    ];

    worldList.innerHTML = worldPlayers.map((p, i) => `
      <div class="leaderboard-item">
        <span class="leaderboard-rank rank-${i+1}">${i+1}</span>
        <img class="leaderboard-avatar" src="${p.avatar}" alt="">
        <span class="leaderboard-name">${p.name}</span>
        <span class="leaderboard-score">${p.score.toLocaleString()}</span>
      </div>
    `).join('');

    friendsList.innerHTML = friendsPlayers.map((p, i) => `
      <div class="leaderboard-item">
        <span class="leaderboard-rank rank-${i+1}">${i+1}</span>
        <img class="leaderboard-avatar" src="${p.avatar}" alt="">
        <span class="leaderboard-name">${p.name}</span>
        <span class="leaderboard-score">${p.score.toLocaleString()}</span>
      </div>
    `).join('');
  }

  renderProfilesModal(profiles, onActivate, onDelete) {
    const grid = this.$('#modal-profiles-grid');
    grid.innerHTML = '';

    profiles.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'profile-card-item' + (p.is_active ? ' active' : '');
      item.innerHTML = `
        <img class="profile-card-avatar" src="${p.avatar}" alt="${p.name}">
        <div class="profile-card-name">${p.name}</div>
        ${p.is_active ? '<span class="profile-card-badge">Tú</span>' : ''}
        <div class="profile-actions" style="margin-top:0.4rem; display:flex; gap:0.4rem; z-index:5;">
          <button class="profile-btn-select" style="background:linear-gradient(135deg, var(--jd-magenta) 0%, var(--jd-purple) 100%); border:none; padding:0.25rem 0.6rem; border-radius:6px; font-size:0.7rem; font-weight:800; color:#fff; cursor:pointer;">Usar</button>
          <button class="profile-btn-delete" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); padding:0.25rem 0.5rem; border-radius:6px; font-size:0.7rem; color:#fff; cursor:pointer;">Borrar</button>
        </div>
      `;

      item.querySelector('.profile-btn-select').addEventListener('click', (e) => {
        e.stopPropagation();
        onActivate(p.id);
      });

      item.querySelector('.profile-btn-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        onDelete(p.id);
      });

      item.addEventListener('click', () => {
        onActivate(p.id);
      });

      grid.appendChild(item);
    });
  }

  updateActiveProfileUI(profile) {
    if (!profile) return;
    // Sidebar image
    const sidebarImg = this.$('#sidebar-active-profile-img');
    if (sidebarImg) sidebarImg.src = profile.avatar;
    
    // DANCE button overlay avatar
    const overlay = this.$('#dance-btn-player-avatar');
    if (overlay) {
      overlay.innerHTML = `<img src="${profile.avatar}" alt="${profile.name}">`;
    }
    
    // Home stats
    const homeName = this.$('#home-stat-name');
    if (homeName) homeName.textContent = profile.name;
    
    // Coach screen active user avatar and name
    const coachImg = this.$('#coach-active-avatar-img');
    if (coachImg) coachImg.src = profile.avatar;
    
    const coachName = this.$('#coach-active-name-txt');
    if (coachName) coachName.textContent = profile.name;
    
    // HUD active user name & avatar
    const hudName = this.$('#hud-player-name-txt');
    if (hudName) hudName.textContent = profile.name;
    const hudAvatar = this.$('#hud-player-avatar-img');
    if (hudAvatar) hudAvatar.src = profile.avatar;

    // Results screen active user name and avatar
    const resultsName = this.$('#results-name-txt');
    if (resultsName) resultsName.textContent = profile.name;
    const resultsImg = this.$('#results-avatar-img');
    if (resultsImg) resultsImg.src = profile.avatar;
  }

  renderAvatarOptions(selectedAvatarUrl) {
    const container = this.$('#avatar-selector-grid');
    container.innerHTML = '';
    const avatars = [
      '/assets/avatars/avatar_01.png',
      '/assets/avatars/avatar_02.png',
      '/assets/avatars/avatar_03.png',
      '/assets/avatars/avatar_04.png'
    ];
    avatars.forEach((url) => {
      const opt = document.createElement('div');
      opt.className = 'avatar-option' + (url === selectedAvatarUrl ? ' selected' : '');
      opt.innerHTML = `<img src="${url}" alt="Avatar">`;
      opt.addEventListener('click', () => {
        this.$$('.avatar-option').forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        container.dataset.selected = url;
      });
      container.appendChild(opt);
    });
    container.dataset.selected = selectedAvatarUrl || avatars[0];
  }

  renderCoachSelection(song, activeProfile) {
    this.$('#coach-bkg').src = song.bkgPath || song.coverPath || '';
    this.$('#coach-cover-small').src = song.coverPath;
    this.$('#coach-song-title').textContent = song.title;
    this.$('#coach-song-artist').textContent = song.artist;

    const container = this.$('#coach-options-big');
    container.innerHTML = '';

    const coachesList = song.coaches && song.coaches.length > 0
      ? song.coaches
      : [song.coverPath];

    coachesList.forEach((coachUrl, i) => {
      const opt = document.createElement('div');
      opt.className = 'coach-option-big' + (i === 0 ? ' selected' : '');
      opt.dataset.index = i;
      opt.innerHTML = `
        <img src="${coachUrl}" alt="Coach ${i + 1}">
        <!-- Contenedor del avatar flotante para cuando esté seleccionado -->
        <div class="coach-player-avatar-slot" style="position:absolute; bottom:-50px; left:50%; transform:translateX(-50%); display:none; flex-direction:column; align-items:center; gap:0.4rem; z-index:10; width:100px;">
          <img src="${activeProfile ? activeProfile.avatar : '/assets/avatars/avatar_01.png'}" style="width:48px; height:48px; border-radius:50%; border:3px solid var(--jd-magenta); box-shadow:0 0 15px var(--jd-magenta); object-fit:cover;">
          <span style="font-weight:800; font-size:0.75rem; color:#fff; text-shadow:0 2px 5px #000; background:rgba(15,5,25,0.7); padding:0.15rem 0.5rem; border-radius:10px; text-align:center; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${activeProfile ? activeProfile.name : 'Player 1'}</span>
        </div>
      `;
      container.appendChild(opt);
    });

    this.updateCoachSelection(0);
  }

  updateCoachSelection(index) {
    this.$$('.coach-option-big').forEach((c, i) => {
      const isSelected = i === index;
      c.classList.toggle('selected', isSelected);
      const slot = c.querySelector('.coach-player-avatar-slot');
      if (slot) slot.style.display = isSelected ? 'flex' : 'none';
    });
  }
}
