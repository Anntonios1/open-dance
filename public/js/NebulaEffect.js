/**
 * ========================================
 * NEBULA EFFECT — Just Dance 2026 Simulator
 * ========================================
 * Canvas-based animated cosmic background.
 * Modes: 'menu' | 'loading' | 'warp'
 */
export default class NebulaEffect {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.mode = 'menu';
    this.running = false;
    this.animId = null;
    this.t = 0;
    this.warpSpeed = 0;
    this._warpTarget = 0;

    // Stars for menu/warp
    this.stars = [];
    this.bokeh = [];
    this.particles = []; // floating particles for loading

    this._resize();
    this._initStars();
    this._initBokeh();
    this._initParticles();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _initStars() {
    this.stars = [];
    const count = 220;
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * (this.canvas?.width || 1920),
        y: Math.random() * (this.canvas?.height || 1080),
        r: Math.random() * 1.6 + 0.3,
        speed: Math.random() * 0.15 + 0.02,
        twinkleOffset: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.03 + 0.01,
        color: this._randomStarColor(),
      });
    }
  }

  _initBokeh() {
    this.bokeh = [];
    const count = 18;
    for (let i = 0; i < count; i++) {
      this.bokeh.push({
        x: Math.random() * (this.canvas?.width || 1920),
        y: Math.random() * (this.canvas?.height || 1080),
        r: Math.random() * 80 + 20,
        colorRGB: this._randomBokehColor(),
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.006 + 0.002,
        vx: (Math.random() - 0.5) * 0.08,
        vy: (Math.random() - 0.5) * 0.05,
      });
    }
  }

  _initParticles() {
    this.particles = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      this.particles.push(this._newParticle());
    }
  }

  _newParticle() {
    const w = this.canvas?.width || 1920;
    const h = this.canvas?.height || 1080;
    return {
      x: Math.random() * w,
      y: h + Math.random() * h,
      vy: -(Math.random() * 0.8 + 0.3),
      r: Math.random() * 2.5 + 0.5,
      life: 0,
      maxLife: Math.random() * 400 + 200,
      color: Math.random() > 0.5 ? '#00ffff' : '#ffffff',
    };
  }

  _randomStarColor() {
    const colors = ['#ffffff', '#e8d8ff', '#c8e8ff', '#ffd8e8', '#c8ffe8'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  _randomBokehColor() {
    const colors = [
      '155, 48, 255',
      '139, 47, 201',
      '0, 191, 255',
      '201, 64, 160',
      '107, 47, 160',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'warp') {
      this._warpTarget = 1;
    } else {
      this._warpTarget = 0;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    this.animId = null;
  }

  _loop() {
    if (!this.running || !this.canvas) return;
    this.t++;
    this.warpSpeed += (this._warpTarget * 12 - this.warpSpeed) * 0.06;

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Base gradient
    const grad = ctx.createRadialGradient(W * 0.5, H * 0.5, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
    if (this.mode === 'warp') {
      grad.addColorStop(0, '#2a0060');
      grad.addColorStop(0.5, '#1a0533');
      grad.addColorStop(1, '#05020c');
    } else if (this.mode === 'loading') {
      grad.addColorStop(0, '#11052c');
      grad.addColorStop(0.6, '#1a0533');
      grad.addColorStop(1, '#05020c');
    } else {
      grad.addColorStop(0, '#1a0533');
      grad.addColorStop(0.5, '#100325');
      grad.addColorStop(1, '#05020c');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Diagonal lines
    this._drawDiagonals(ctx, W, H);

    if (this.mode === 'loading') {
      this._drawNebulaBlob(ctx, W, H);
      this._drawParticles(ctx, W, H);
      this._drawCentralLine(ctx, W, H);
    } else {
      this._drawBokeh(ctx, W, H);
    }

    this._drawStars(ctx, W, H);

    this.animId = requestAnimationFrame(() => this._loop());
  }

  _drawDiagonals(ctx, W, H) {
    const count = 7;
    const spacing = (W + H) / count;
    const opacity = this.mode === 'warp' ? 0.3 : 0.12;
    ctx.save();
    ctx.strokeStyle = `rgba(155, 80, 220, ${opacity})`;
    ctx.lineWidth = this.mode === 'warp' ? 60 : 50;
    for (let i = -2; i < count + 2; i++) {
      const offset = i * spacing + (this.t * (0.1 + this.warpSpeed * 0.5)) % spacing;
      ctx.beginPath();
      ctx.moveTo(offset - H, 0);
      ctx.lineTo(offset + H, H);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawBokeh(ctx, W, H) {
    this.bokeh.forEach(b => {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -b.r * 2) b.x = W + b.r;
      if (b.x > W + b.r * 2) b.x = -b.r;
      if (b.y < -b.r * 2) b.y = H + b.r;
      if (b.y > H + b.r * 2) b.y = -b.r;
      const pulse = Math.sin(this.t * b.speed + b.phase) * 0.12 + 1;
      ctx.save();
      ctx.globalAlpha = 0.6;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r * pulse);
      g.addColorStop(0, `rgba(${b.colorRGB}, 0.5)`);
      g.addColorStop(0.5, `rgba(${b.colorRGB}, 0.15)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  _drawNebulaBlob(ctx, W, H) {
    const scale = 1 + Math.sin(this.t * 0.008) * 0.12;
    const cx = W * 0.5;
    const cy = H * 0.5;
    ctx.save();
    ctx.globalAlpha = 0.55;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 180 * scale);
    g.addColorStop(0, 'rgba(155,48,255,0.85)');
    g.addColorStop(0.4, 'rgba(100,20,200,0.5)');
    g.addColorStop(0.8, 'rgba(60,0,120,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 220 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawParticles(ctx, W, H) {
    this.particles.forEach((p, i) => {
      p.y += p.vy;
      p.life++;
      if (p.life >= p.maxLife || p.y < -20) {
        this.particles[i] = this._newParticle();
        return;
      }
      const progress = p.life / p.maxLife;
      const alpha = progress < 0.15 ? progress / 0.15 : progress > 0.8 ? (1 - progress) / 0.2 : 1;
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  _drawCentralLine(ctx, W, H) {
    const cx = W * 0.5;
    const pulse = Math.sin(this.t * 0.04) * 0.5 + 0.5;
    const lineH = 120 + pulse * 40;
    const cy = H * 0.5;

    // Line
    ctx.save();
    const lineGrad = ctx.createLinearGradient(cx, cy - lineH, cx, cy + lineH);
    lineGrad.addColorStop(0, 'rgba(0,255,255,0)');
    lineGrad.addColorStop(0.5, `rgba(0,255,255,${0.7 + pulse * 0.3})`);
    lineGrad.addColorStop(1, 'rgba(0,255,255,0)');
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - lineH);
    ctx.lineTo(cx, cy + lineH);
    ctx.stroke();

    // Center glow dot
    ctx.shadowBlur = 24;
    ctx.fillStyle = `rgba(0,255,255,${0.8 + pulse * 0.2})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 6 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawStars(ctx, W, H) {
    const warpMult = 1 + this.warpSpeed * 0.7;
    this.stars.forEach(s => {
      // Move stars (warp = faster horizontal stretch)
      s.x -= s.speed * warpMult;
      if (s.x < 0) {
        s.x = W;
        s.y = Math.random() * H;
      }

      const twinkle = Math.sin(this.t * s.twinkleSpeed + s.twinkleOffset) * 0.35 + 0.65;
      const r = s.r * (this.mode === 'warp' ? 1.4 : 1);

      ctx.save();
      if (this.warpSpeed > 1) {
        // Draw streaks in warp mode
        const len = this.warpSpeed * 8;
        const grad = ctx.createLinearGradient(s.x, s.y, s.x + len, s.y);
        const hex = s.color.replace('#', '');
        const rVal = parseInt(hex.substring(0, 2), 16);
        const gVal = parseInt(hex.substring(2, 4), 16);
        const bVal = parseInt(hex.substring(4, 6), 16);
        grad.addColorStop(0, `rgba(${rVal}, ${gVal}, ${bVal}, 0)`);
        grad.addColorStop(1, s.color);
        ctx.strokeStyle = grad;
        ctx.lineWidth = r;
        ctx.globalAlpha = twinkle;
        ctx.beginPath();
        ctx.moveTo(s.x + len, s.y);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
      } else {
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = r * 3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }
}
