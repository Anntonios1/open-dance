export default class MotionMatcher {
  /**
   * @param {object} options
   * @param {number} [options.perfectThreshold=0.75]
   * @param {number} [options.superThreshold=0.62]
   * @param {number} [options.goodThreshold=0.48]
   * @param {number} [options.okThreshold=0.30]
   */
  constructor(options = {}) {
    this.thresholds = {
      perfect: options.perfectThreshold ?? 0.75,
      super:   options.superThreshold   ?? 0.62,
      good:    options.goodThreshold    ?? 0.48,
      ok:      options.okThreshold      ?? 0.30,
    };
  }

  /**
   * Evaluate a move by searching for the peak correlation across multiple lags
   * and potential axis configurations.
   *
   * @param {Array<{ax:number,ay:number,az:number,gx:number,gy:number,gz:number}>} playerSamples
   *   Raw Joy-Con samples collected during the move window.
   * @param {Array<number[]>} refSamples
   *   Reference samples from the .msm file.
   * @param {number} components
   *   Number of components per reference sample.
   * @returns {{ rating: string, score: number }}
   */
  /**
   * Evaluate a move by searching for the peak correlation across multiple lags,
   * axis configurations, and first-derivative (jerk) curves.
   *
   * @param {Array<{ax:number,ay:number,az:number,gx:number,gy:number,gz:number}>} playerSamples
   *   Raw Joy-Con samples collected during the move window.
   * @param {Array<number[]>} refSamples
   *   Reference samples from the .msm file.
   * @param {number} components
   *   Number of components per reference sample.
   * @param {number} [moveDuration=null]
   *   Duration of the core move (excluding padding) in seconds.
   *   If provided, activates padded sliding matching.
   * @param {number} [padLeft=0.4]
   *   Padding time in seconds at the start of playerSamples.
   * @param {number} [padRight=0.4]
   *   Padding time in seconds at the end of playerSamples.
   * @returns {{ rating: string, score: number, lag: number }}
   */
  evaluate(playerSamples, refSamples, components = 2, moveDuration = null, padLeft = 0.4, padRight = 0.4) {
    console.log(`[MotionMatcher] Evaluating: Player samples = ${playerSamples?.length}, Ref samples = ${refSamples?.length}, Components = ${components}, Duration = ${moveDuration}s`);
    if (!playerSamples || playerSamples.length < 3) {
      console.warn(`[MotionMatcher] Too few player samples to match.`);
      return { rating: 'miss', score: 0, lag: 0 };
    }

    // Apply moving average smoothing to player samples to remove high-frequency noise
    // Using window size = 3 to keep the sharp beat peaks intact
    const smoothedSamples = this._smooth(playerSamples, 3);

    // Print stats of player samples to check if they are changing
    const sampleVariances = { ax: 0, ay: 0, az: 0 };
    const n = smoothedSamples.length;
    const mean = { ax: 0, ay: 0, az: 0 };
    smoothedSamples.forEach(s => { mean.ax += s.ax; mean.ay += s.ay; mean.az += s.az; });
    mean.ax /= n; mean.ay /= n; mean.az /= n;
    smoothedSamples.forEach(s => {
      sampleVariances.ax += (s.ax - mean.ax) ** 2;
      sampleVariances.ay += (s.ay - mean.ay) ** 2;
      sampleVariances.az += (s.az - mean.az) ** 2;
    });
    console.log(`[MotionMatcher] Player Stats (Smoothed) — Mean: [${mean.ax.toFixed(2)}, ${mean.ay.toFixed(2)}, ${mean.az.toFixed(2)}], Sum of Squares: [${sampleVariances.ax.toFixed(2)}, ${sampleVariances.ay.toFixed(2)}, ${sampleVariances.az.toFixed(2)}]`);

    // List of projections to test. If components === 2, we test both [ax, ay] and [ax, az]
    const projectionsToTest = [];
    const projectionNames = [];
    if (components === 2) {
      projectionsToTest.push(
        smoothedSamples.map(s => [s.ax, s.ay]), // X-Y
        smoothedSamples.map(s => [s.ax, s.az])  // X-Z (No Pitch style)
      );
      projectionNames.push("X-Y (Lateral-Vertical)", "X-Z (Lateral-Depth)");
    } else {
      projectionsToTest.push(smoothedSamples.map(s => this._project(s, components)));
      projectionNames.push("Generic Projection");
    }

    let bestScore = -1;
    let bestProjName = "";
    let bestLag = 0;

    for (let idx = 0; idx < projectionsToTest.length; idx++) {
      const projected = projectionsToTest[idx];
      const name = projectionNames[idx];

      let score, lag;
      if (moveDuration !== null) {
        const res = this._computeBestNCCSliding(projected, refSamples, components, moveDuration, padLeft, padRight);
        score = res.score;
        lag = res.lag;
      } else {
        const resampled = this._resample(projected, refSamples.length, components);
        score = this._computeBestNCCWithLag(resampled, refSamples, components, 12);
        lag = 0;
      }

      console.log(`[MotionMatcher]   NCC for ${name}: ${score.toFixed(3)} (lag = ${(lag * 1000).toFixed(0)}ms)`);
      if (score > bestScore) {
        bestScore = score;
        bestProjName = name;
        bestLag = lag;
      }
    }

    // Map the best score to a rating
    let rating;
    if (bestScore >= this.thresholds.perfect) rating = 'perfect';
    else if (bestScore >= this.thresholds.super) rating = 'super';
    else if (bestScore >= this.thresholds.good)  rating = 'good';
    else if (bestScore >= this.thresholds.ok)    rating = 'ok';
    else rating = 'miss';

    console.log(`[MotionMatcher] Result → Rating: ${rating.toUpperCase()}, Score: ${bestScore.toFixed(3)} (Best Projection: ${bestProjName}, Lag: ${(bestLag * 1000).toFixed(0)}ms)`);
    return { rating, score: bestScore, lag: bestLag };
  }

  /**
   * Find peak correlation by sliding the reference window across resampled padded player data.
   * Evaluates raw component NCC, 2D raw magnitude NCC, first-derivative (velocity) components NCC,
   * and 2D magnitude of the first-derivative (jerk envelope) NCC.
   */
  _computeBestNCCSliding(player, reference, components, moveDuration, padLeft, padRight) {
    const L_ref = reference.length;
    
    // Player covers moveDuration + padLeft + padRight.
    // Resample player so its sample rate matches the reference sample rate.
    const totalDuration = moveDuration + padLeft + padRight;
    const L_resampled = Math.round(L_ref * (totalDuration / moveDuration));

    if (L_resampled <= L_ref) {
      const resampled = this._resample(player, L_ref, components);
      const score = this._computeBestNCCWithLag(resampled, reference, components, 12);
      return { score, lag: 0 };
    }

    const resampledPlayer = this._resample(player, L_resampled, components);
    const maxStartIdx = L_resampled - L_ref;
    let bestScore = -1;
    let bestStartIdx = 0;

    // Precompute reference magnitudes & derivatives
    let refMag = null;
    let refDeriv = null;
    let refDerivMag = null;

    if (components === 2) {
      refMag = reference.map(r => Math.sqrt(r[0] * r[0] + r[1] * r[1]));
    }
    
    refDeriv = [];
    for (let i = 0; i < L_ref - 1; i++) {
      const row = [];
      for (let c = 0; c < components; c++) {
        row.push(reference[i + 1][c] - reference[i][c]);
      }
      refDeriv.push(row);
    }

    if (components === 2) {
      refDerivMag = refDeriv.map(d => Math.sqrt(d[0] * d[0] + d[1] * d[1]));
    }

    for (let s = 0; s <= maxStartIdx; s++) {
      const playerWindow = resampledPlayer.slice(s, s + L_ref);
      
      // 1. Raw components NCC (average & max)
      const componentScores = [];
      for (let c = 0; c < components; c++) {
        const refCol = reference.map(r => r[c]);
        const playCol = playerWindow.map(p => p[c]);
        componentScores.push(this._ncc(refCol, playCol));
      }
      const avgComponents = componentScores.reduce((sum, v) => sum + v, 0) / components;
      const maxComponent = Math.max(...componentScores);
      let scoreForShift = Math.max(avgComponents, maxComponent);

      // 2. Magnitude envelope NCC
      if (components === 2 && refMag) {
        const playMag = playerWindow.map(p => Math.sqrt(p[0] * p[0] + p[1] * p[1]));
        const nccMag = this._ncc(refMag, playMag);
        scoreForShift = Math.max(scoreForShift, nccMag);
      }

      // 3. Derivative component NCC
      const playDeriv = [];
      for (let i = 0; i < L_ref - 1; i++) {
        const row = [];
        for (let c = 0; c < components; c++) {
          row.push(playerWindow[i + 1][c] - playerWindow[i][c]);
        }
        playDeriv.push(row);
      }

      const derivComponentScores = [];
      for (let c = 0; c < components; c++) {
        const refDerivCol = refDeriv.map(d => d[c]);
        const playDerivCol = playDeriv.map(d => d[c]);
        derivComponentScores.push(this._ncc(refDerivCol, playDerivCol));
      }
      const avgDerivComponents = derivComponentScores.reduce((sum, v) => sum + v, 0) / components;
      const maxDerivComponent = Math.max(...derivComponentScores);
      scoreForShift = Math.max(scoreForShift, avgDerivComponents, maxDerivComponent);

      // 4. Derivative Magnitude NCC (Jerk magnitude, 100% rotation invariant)
      if (components === 2 && refDerivMag) {
        const playDerivMag = playDeriv.map(d => Math.sqrt(d[0] * d[0] + d[1] * d[1]));
        const nccDerivMag = this._ncc(refDerivMag, playDerivMag);
        scoreForShift = Math.max(scoreForShift, nccDerivMag);
      }

      if (scoreForShift > bestScore) {
        bestScore = scoreForShift;
        bestStartIdx = s;
      }
    }

    const refSampleRate = L_ref / moveDuration;
    const centerSampleIndex = Math.round(padLeft * refSampleRate);
    const lagFrames = bestStartIdx - centerSampleIndex;
    const lagSeconds = lagFrames / refSampleRate;

    return { score: bestScore, lag: lagSeconds };
  }


  /**
   * Projects a sample to N components.
   */
  _project(sample, components) {
    if (components === 3) {
      return [sample.ax, sample.ay, sample.az];
    }
    const axes = [sample.ax, sample.ay, sample.az, sample.gx, sample.gy, sample.gz];
    return axes.slice(0, components);
  }

  /**
   * Applies a simple moving average filter to smooth accelerometer samples.
   */
  _smooth(samples, windowSize = 7) {
    const smoothed = [];
    for (let i = 0; i < samples.length; i++) {
      let count = 0;
      let sumAx = 0, sumAy = 0, sumAz = 0;
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(samples.length - 1, i + Math.floor(windowSize / 2));
      for (let j = start; j <= end; j++) {
        sumAx += samples[j].ax;
        sumAy += samples[j].ay;
        sumAz += samples[j].az;
        count++;
      }
      smoothed.push({
        ax: sumAx / count,
        ay: sumAy / count,
        az: sumAz / count,
        gx: samples[i].gx,
        gy: samples[i].gy,
        gz: samples[i].gz
      });
    }
    return smoothed;
  }

  /**
   * Find the peak correlation by comparing components individually, averaging them,
   * or comparing their 2D energy magnitude envelopes.
   */
  _computeBestNCCWithLag(player, reference, components, maxLag = 12) {
    let bestScore = -1;

    // Precompute 2D magnitudes if components === 2
    let refMag = null;
    let playMag = null;
    if (components === 2) {
      refMag = reference.map(r => Math.sqrt(r[0] * r[0] + r[1] * r[1]));
      playMag = player.map(p => Math.sqrt(p[0] * p[0] + p[1] * p[1]));
    }

    for (let lag = -maxLag; lag <= maxLag; lag++) {
      const componentScores = [];
      let valid = true;

      for (let c = 0; c < components; c++) {
        const refCol = reference.map(r => r[c]);
        const playCol = player.map(p => p[c]);

        // Shift playCol by lag
        let subRef = [];
        let subPlay = [];
        for (let i = 0; i < refCol.length; i++) {
          const j = i + lag;
          if (j >= 0 && j < playCol.length) {
            subRef.push(refCol[i]);
            subPlay.push(playCol[j]);
          }
        }

        // Require at least 40% overlap to evaluate
        if (subRef.length < Math.max(5, refCol.length * 0.4)) {
          valid = false;
          break;
        }

        componentScores.push(this._ncc(subRef, subPlay));
      }

      if (!valid) continue;

      // Average NCC across components
      const avgComponents = componentScores.reduce((s, v) => s + v, 0) / components;
      
      // Peak component NCC (allows scoring if player matches lateral axis perfectly even if vertical is noisy)
      const maxComponent = Math.max(...componentScores);

      let scoreForLag = Math.max(avgComponents, maxComponent);

      // Compute magnitude envelope correlation (tilt & orientation invariant energy matching)
      if (components === 2 && refMag && playMag) {
        let subRefMag = [];
        let subPlayMag = [];
        for (let i = 0; i < refMag.length; i++) {
          const j = i + lag;
          if (j >= 0 && j < playMag.length) {
            subRefMag.push(refMag[i]);
            subPlayMag.push(playMag[j]);
          }
        }
        if (subRefMag.length >= Math.max(5, refMag.length * 0.4)) {
          const nccMag = this._ncc(subRefMag, subPlayMag);
          scoreForLag = Math.max(scoreForLag, nccMag);
        }
      }

      if (scoreForLag > bestScore) {
        bestScore = scoreForLag;
      }
    }

    return bestScore;
  }

  /**
   * Resamples an array of vectors to a target length.
   */
  _resample(src, targetLen, dim) {
    if (src.length === targetLen) return src;
    const out = [];
    for (let i = 0; i < targetLen; i++) {
      const t = (i / (targetLen - 1)) * (src.length - 1);
      const lo = Math.floor(t);
      const hi = Math.min(lo + 1, src.length - 1);
      const frac = t - lo;
      const vec = [];
      for (let d = 0; d < dim; d++) {
        vec.push(src[lo][d] * (1 - frac) + src[hi][d] * frac);
      }
      out.push(vec);
    }
    return out;
  }

  /**
   * Normalised cross-correlation of two 1-D signals.
   * Returns the absolute value of correlation to support inverted axes.
   */
  _ncc(a, b) {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 0;

    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const meanA = sumA / n;
    const meanB = sumB / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA;
      const db = b[i] - meanB;
      num  += da * db;
      denA += da * da;
      denB += db * db;
    }

    const den = Math.sqrt(denA * denB);
    if (den < 1e-9) return 0;
    
    // Return absolute value to handle inverted axes due to holding styles
    return Math.abs(num / den);
  }
}
