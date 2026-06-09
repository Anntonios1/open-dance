/**
 * ========================================
 * SONG LOADER
 * ========================================
 *
 * Módulo encargado de cargar el catálogo de canciones y sus timelines
 * desde el servidor. Convierte los datos crudos en instancias de Song.
 *
 * Este es el "cargador base" que se encarga de traer todos los datos
 * de cualquier canción, independientemente de cuál sea.
 */

import Song from './Song.js';
import { API_ENDPOINTS } from './config.js';

export default class SongLoader {
  static async fetchAllSongs() {
    try {
      console.log('[SongLoader] Fetching song catalog...');
      const response = await fetch(API_ENDPOINTS.songs);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const rawData = await response.json();
      console.log(`[SongLoader] Loaded ${rawData.length} songs`);
      return rawData.map((data) => new Song(data));
    } catch (err) {
      console.error('[SongLoader] Failed to load songs:', err.message);
      return [];
    }
  }

  static async fetchTimeline(song) {
    if (!(song instanceof Song)) {
      throw new Error('[SongLoader] Expected a Song instance');
    }

    try {
      console.log(`[SongLoader] Fetching timeline for "${song.id}"...`);
      const response = await fetch(API_ENDPOINTS.timeline(song.id));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const timelineData = await response.json();
      
      if (!timelineData.lyrics && !timelineData.moves && !timelineData.pictos) {
        console.warn(`[SongLoader] Timeline for "${song.id}" appears empty`);
      }
      
      song.setTimeline(timelineData);
      console.log(`[SongLoader] Timeline loaded: ${song.lyrics.length} lyrics, ${song.moves.length} moves, ${song.pictos.length} pictos`);

      // Cargar musictrack para tener los beats disponibles (usado por el debug overlay)
      try {
        const mtRes = await fetch(`/songs/${song.id}/musictrack.json`);
        if (mtRes.ok) {
          const mt = await mtRes.json();
          song._musictrack = mt;
          console.log(`[SongLoader] Musictrack loaded: ${mt.beats?.length || 0} beats`);
        }
      } catch (e) {
        console.warn(`[SongLoader] musictrack.json no disponible para ${song.id}`);
      }

      return song;
    } catch (err) {
      console.error(`[SongLoader] Failed to load timeline for "${song.id}":`, err.message);
      throw err;
    }
  }
}
