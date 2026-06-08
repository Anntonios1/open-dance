export default class ResultsScreen {
  constructor() {
    this.$ = (sel) => document.querySelector(sel);
    this.confettiFrame = null;
  }

  show(results) {
    this._renderStars(results.stars);
    this._animateCounter(this.$('#results-score'), results.score, 1500);
    this.$('#stat-perfects').textContent = results.perfects;
    this.$('#stat-supers').textContent = results.supers;
    this.$('#stat-goods').textContent = results.goods;
    this.$('#stat-misses').textContent = results.misses;
    this.$('#stat-golds').textContent = `${results.goldMovesHit}/${results.goldMovesTotal}`;
    this.$('#results-title').textContent = results.rankTitle;
    this._startConfetti();
  }

  _renderStars(count) {
    const starsHtml = [];
    for (let i = 1; i <= 5; i++) {
      starsHtml.push(`<span class="r-star${i <= count ? ' earned' : ''}">\u2605</span>`);
    }
    this.$('#results-stars').innerHTML = starsHtml.join('');
  }

  _animateCounter(el, target, duration) {
    const startTime = performance.now();
    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.floor(eased * target);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _startConfetti() {
    const canvas = this.$('#confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#e91e8c', '#9c27b0', '#00b4d8', '#ffc107', '#4caf50', '#f44336'];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        w: Math.random() * 10 + 5,
        h: Math.random() * 6 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 2,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        if (p.y > canvas.height + 20) {
          p.y = -20;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      this.confettiFrame = requestAnimationFrame(draw);
    };
    draw();

    setTimeout(() => {
      cancelAnimationFrame(this.confettiFrame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 8000);
  }
}
