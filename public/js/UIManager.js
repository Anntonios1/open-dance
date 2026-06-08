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

      card.addEventListener('click', () => onSelect(idx));
      grid.appendChild(card);
    });
  }

  updateSongSelection(index) {
    this.$$('.song-card').forEach((c, i) => {
      c.classList.toggle('selected', i === index);
    });
  }

  updatePreview(song) {
    this.$('#preview-cover').src = song.coverPath;
    this.$('#preview-title').textContent = song.title;
    this.$('#preview-artist').textContent = song.artist;
    this.$('#preview-version').textContent = `Just Dance ${song.jdVersion}`;
    this.renderDifficulty(song.difficulty, this.$('#preview-difficulty'));

    const previewVid = this.$('#preview-video');
    previewVid.src = song.previewUrl || '';
    previewVid.load();
    previewVid.play().catch(() => {});
  }

  renderCoachSelection(song) {
    this.$('#coach-bkg').src = song.bkgPath || song.coverPath || '';
    this.$('#coach-cover-small').src = song.coverPath;
    this.$('#coach-song-title').textContent = song.title;
    this.$('#coach-song-artist').textContent = song.artist;

    const container = this.$('#coach-options-big');
    container.innerHTML = '';

    if (song.coaches && song.coaches.length > 0) {
      song.coaches.forEach((coachUrl, i) => {
        const opt = document.createElement('div');
        opt.className = 'coach-option-big' + (i === 0 ? ' selected' : '');
        opt.innerHTML = `<img src="${coachUrl}" alt="Coach ${i + 1}">`;
        container.appendChild(opt);
      });
    } else {
      const opt = document.createElement('div');
      opt.className = 'coach-option-big selected';
      opt.innerHTML = `<img src="${song.coverPath}" alt="Coach">`;
      container.appendChild(opt);
    }
  }

  updateCoachSelection(index) {
    this.$$('.coach-option-big').forEach((c) => c.classList.remove('selected'));
    const options = this.$$('#coach-options-big .coach-option-big');
    if (options[index]) options[index].classList.add('selected');
  }
}
