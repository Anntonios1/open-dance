/**
 * ========================================
 * CONFIGURACIÓN GLOBAL DEL JUEGO
 * ========================================
 * Todas las constantes del juego en un solo lugar.
 * Cambiar estos valores afecta a TODAS las canciones.
 */

export const PIXELS_PER_SECOND = 220;
export const HIT_ZONE_X = 80;
export const MAX_SCORE = 13000;

export const TIMING_WINDOWS = {
  perfect: 0.12,
  super: 0.22,
  good: 0.35,
  ok: 0.50,
};

export const SCORE_VALUES = {
  perfect: 130,
  super: 100,
  good: 60,
  ok: 30,
};

export const STAR_THRESHOLDS = [
  { star: 1, pct: 20 },
  { star: 2, pct: 38 },
  { star: 3, pct: 55 },
  { star: 4, pct: 77 },
  { star: 5, pct: 92 },
];

export const RANK_THRESHOLDS = [
  { pct: 0.92, title: 'MEGASTAR' },
  { pct: 0.77, title: 'SUPERSTAR' },
  { pct: 0.55, title: 'DANCE STAR' },
  { pct: 0.38, title: 'RISING STAR' },
  { pct: 0.20, title: 'STAR' },
];

export const RATING_LABELS = {
  perfect: 'PERFECT',
  super: 'SUPER',
  good: 'GOOD',
  ok: 'OK',
  miss: 'X MISS',
  yeah: 'YEAH',
};

export const API_ENDPOINTS = {
  songs: '/api/songs',
  timeline: (id) => `/api/songs/${id}/timeline`,
};
