export default class InputHandler {
  constructor() {
    this.$ = (sel) => document.querySelector(sel);
    this.handlers = {
      space: [],
      enter: [],
      escape: [],
      arrowRight: [],
      arrowLeft: [],
    };
    this._bound = false;
  }

  on(key, callback) {
    const k = key.toLowerCase();
    if (this.handlers[k]) {
      this.handlers[k].push(callback);
    }
    return this;
  }

  bind() {
    if (this._bound) return;
    this._bound = true;

    document.addEventListener('keydown', (e) => {
      const key = e.code.toLowerCase();

      if (key === 'space') {
        e.preventDefault();
        this.handlers.space.forEach((fn) => fn(e));
      }
      if (key === 'enter') {
        this.handlers.enter.forEach((fn) => fn(e));
      }
      if (key === 'escape') {
        this.handlers.escape.forEach((fn) => fn(e));
      }
      if (key === 'arrowright') {
        this.handlers.arrowRight.forEach((fn) => fn(e));
      }
      if (key === 'arrowleft') {
        this.handlers.arrowLeft.forEach((fn) => fn(e));
      }
    });
  }
}
