/**
 * ========================================
 * SCREEN MANAGER
 * ========================================
 *
 * Gestiona las transiciones entre pantallas del juego.
 * Todas las pantallas comparten la misma lógica: agregar/quitar la clase "active".
 */

export default class ScreenManager {
  /**
   * @param {Object} screenMap - Mapa de nombre de pantalla a elemento DOM.
   * Ej: { title: el, menu: el, selection: el, ... }
   */
  constructor(screenMap) {
    this.screens = screenMap;
    this.current = null;
    for (const [name, el] of Object.entries(screenMap)) {
      if (el.classList.contains('active')) {
        this.current = name;
        break;
      }
    }
  }

  /**
   * Muestra la pantalla indicada y oculta las demás.
   * @param {string} name - Nombre de la pantalla a mostrar.
   */
  show(name) {
    if (!this.screens[name]) {
      console.warn(`[ScreenManager] Pantalla "${name}" no encontrada.`);
      return;
    }
    Object.values(this.screens).forEach((s) => s.classList.remove('active'));
    this.screens[name].classList.add('active');
    this.current = name;
  }

  /**
   * @returns {string} Nombre de la pantalla actual.
   */
  getCurrent() {
    return this.current;
  }

  /**
   * @param {string} name
   * @returns {boolean} true si la pantalla indicada está activa.
   */
  isActive(name) {
    return this.current === name;
  }
}
