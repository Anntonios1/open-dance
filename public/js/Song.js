/**
 * ========================================
 * MODELO DE CANCIÓN (Song Model)
 * ========================================
 *
 * Este es el MÓDULO BASE. Todas las canciones se adaptan a esta misma forma.
 * No existe un módulo separado por canción; cada canción es simplemente una
 * instancia de Song con sus propios datos (metadatos, timeline, assets).
 *
 * La estructura es siempre la misma:
 *   - Metadatos (título, artista, dificultad, número de coaches, etc.)
 *   - Rutas de assets (portada, fondo, vídeo, audio, preview, coaches)
 *   - Timeline (letras, movimientos, pictogramas con timestamps)
 *
 * Lo único que varía entre canciones son los VALORES, nunca la FORMA.
 */

export default class Song {
  /**
   * @param {Object} data - Datos crudos de la canción provenientes de la API.
   * @param {string} data.id
   * @param {string} data.title
   * @param {string} data.artist
   * @param {string} data.credits
   * @param {string} data.jdVersion
   * @param {number} data.numCoach
   * @param {number} data.difficulty
   * @param {string} data.coverPath
   * @param {string} data.bkgPath
   * @param {string} data.titlePath
   * @param {string[]} data.coaches
   * @param {string} data.previewUrl
   * @param {string} data.videoUrl
   * @param {string} data.audioUrl
   */
  constructor(data) {
    // --- Metadatos ---
    this.id = data.id || '';
    this.title = data.title || 'Desconocido';
    this.artist = data.artist || 'Desconocido';
    this.credits = data.credits || '';
    this.jdVersion = data.jdVersion || '';
    this.numCoach = data.numCoach || 1;
    this.difficulty = data.difficulty || 1;

    // --- Rutas de assets ---
    this.coverPath = data.coverPath || '';
    this.bkgPath = data.bkgPath || '';
    this.titlePath = data.titlePath || '';
    this.coaches = Array.isArray(data.coaches) ? data.coaches : [];
    this.previewUrl = data.previewUrl || '';
    this.videoUrl = data.videoUrl || '';
    this.audioUrl = data.audioUrl || '';
    this.videoStartTime = data.videoStartTime || 0;

    // --- Timeline (se carga después con loadTimeline) ---
    this.lyrics = [];
    this.moves = [];
    this.pictos = [];
    this.lyricColor = null;
    this._timelineLoaded = false;
  }

  /**
   * Carga el timeline de la canción desde la API.
   * El timeline contiene las letras, los movimientos y los pictogramas.
   * Esta es la ÚNICA parte que varía significativamente entre canciones,
   * pero la estructura del timeline es siempre la misma.
   *
   * @param {Object} timelineData - Datos del timeline.json
   */
  setTimeline(timelineData) {
    this.lyricColor = timelineData.lyricColor || null;
    this.lyrics = Array.isArray(timelineData.lyrics) ? timelineData.lyrics : [];
    this.moves = Array.isArray(timelineData.moves) ? timelineData.moves : [];
    this.pictos = Array.isArray(timelineData.pictos) ? timelineData.pictos : [];
    this._timelineLoaded = true;
  }

  /**
   * @returns {boolean} true si el timeline ha sido cargado.
   */
  hasTimeline() {
    return this._timelineLoaded;
  }

  /**
   * Obtiene los movimientos filtrados para un coach específico.
   * @param {number} coachID - ID del coach (0-based).
   * @returns {Object[]} Array de movimientos del coach.
   */
  getMovesForCoach(coachID) {
    return this.moves.filter((m) => m.coachID === coachID);
  }

  /**
   * Cuenta los movimientos de oro (gold moves) para un coach.
   * @param {number} coachID
   * @returns {number}
   */
  getGoldMoveCount(coachID) {
    return this.getMovesForCoach(coachID).filter((m) => m.goldMove === 1).length;
  }

  /**
   * Devuelve la URL del asset de un pictograma.
   * @param {string} pictoName - Nombre del pictograma (sin extensión).
   * @returns {string} URL completa del pictograma.
   */
  getPictoUrl(pictoName) {
    return `/songs/${this.id}/pictos/${pictoName}.png`;
  }

  /**
   * Devuelve la URL del vídeo o, en su defecto, del audio.
   * @returns {string}
   */
  getPlayableMediaUrl() {
    return this.videoUrl || this.audioUrl;
  }

  getAudioUrl() {
    return this.audioUrl || '';
  }

  hasSeparateAudio() {
    return !!this.audioUrl;
  }

  /**
   * Devuelve la duración total de la canción en segundos,
   * calculada a partir del último evento del timeline.
   * @returns {number}
   */
  getDuration() {
    let maxTime = 0;
    for (const m of this.moves) {
      const end = m.time + (m.duration || 0);
      if (end > maxTime) maxTime = end;
    }
    for (const l of this.lyrics) {
      const end = l.time + (l.duration || 0);
      if (end > maxTime) maxTime = end;
    }
    return maxTime;
  }
}
