import { DrawingData, DrawingStroke, DrawingStyle, StrokePoint } from '../types';
import { handRenderer } from './handRenderer';
import { soundEngine } from './soundEngine';

export interface TimelineState {
  currentTime: number; // in seconds
  totalDuration: number;
  isPlaying: boolean;
  isFinished: boolean;
  currentPhase: number;
  phaseName: string;
  progress: number; // 0 to 1
  handPos: { x: number; y: number; isDrawing: boolean; vx: number; vy: number };
}

export class AnimationController {
  private drawingData: DrawingData | null = null;
  private paperCanvas: HTMLCanvasElement | null = null;
  private paperCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private totalDuration: number = 60.0; // 60 seconds
  private currentTime: number = 0;
  private isPlaying: boolean = false;
  private playbackRate: number = 1.0;
  private animFrameId: number | null = null;
  private lastTimestamp: number = 0;

  // Render state cache
  private strokeProgress: number[] = []; // progress per stroke (0 to 1)
  private currentStrokeIdx: number = 0;
  private currentPointIdx: number = 0;
  private handX: number = 0;
  private handY: number = 0;
  private handVx: number = 0;
  private handVy: number = 0;
  private isHandDrawing: boolean = false;
  private style: DrawingStyle = 'pencil';

  private onStateChange: ((state: TimelineState) => void) | null = null;

  // Timeline phase boundaries (in seconds)
  // Phase 1: 0 - 5.0s (Curiosity / Construction)
  // Phase 2: 5.0 - 20.0s (Major Outlines)
  // Phase 3: 20.0 - 40.0s (Details & Features)
  // Phase 4: 40.0 - 53.0s (Shading & Hatching)
  // Phase 5: 53.0 - 58.0s (Accents & Deep Contrast)
  // Phase 6: 58.0 - 60.0s (Signature & Reveal)
  private readonly phaseTimes = [
    { phase: 1, start: 0, end: 5.0, name: 'Curiosity & Construction Marks' },
    { phase: 2, start: 5.0, end: 20.0, name: 'Major Outlines & Silhouette' },
    { phase: 3, start: 20.0, end: 40.0, name: 'Facial Features & Form' },
    { phase: 4, start: 40.0, end: 53.0, name: 'Artistic Shading & Hatching' },
    { phase: 5, start: 53.0, end: 58.0, name: 'Deep Accents & Contrast' },
    { phase: 6, start: 58.0, end: 60.0, name: 'Final Signature & Reveal' }
  ];

  public setCanvases(paper: HTMLCanvasElement, overlay: HTMLCanvasElement) {
    this.paperCanvas = paper;
    this.paperCtx = paper.getContext('2d', { willReadFrequently: true });
    this.overlayCanvas = overlay;
    this.overlayCtx = overlay.getContext('2d');
  }

  public setCallback(cb: (state: TimelineState) => void) {
    this.onStateChange = cb;
  }

  public loadDrawing(data: DrawingData, style: DrawingStyle) {
    this.drawingData = data;
    this.style = style;
    soundEngine.setStyle(style);
    this.currentTime = 0;
    this.isPlaying = false;
    this.strokeProgress = new Array(data.strokes.length).fill(0);
    this.currentStrokeIdx = 0;
    this.currentPointIdx = 0;

    // Start hand off-screen to the right
    this.handX = data.width * 1.3;
    this.handY = data.height * 0.4;
    this.isHandDrawing = false;

    this.clearPaper();
    this.renderOverlay();
    this.notifyState();
  }

  public clearPaper() {
    if (!this.paperCtx || !this.paperCanvas || !this.drawingData) return;
    const w = this.paperCanvas.width;
    const h = this.paperCanvas.height;

    // Draw pristine textured drawing paper base
    this.paperCtx.save();
    this.paperCtx.fillStyle = '#fcf9f2'; // Fine cold-press cotton rag paper
    this.paperCtx.fillRect(0, 0, w, h);

    // Subtle paper grain noise
    this.paperCtx.fillStyle = 'rgba(0, 0, 0, 0.015)';
    for (let i = 0; i < 4000; i++) {
      const rx = Math.random() * w;
      const ry = Math.random() * h;
      this.paperCtx.fillRect(rx, ry, 1, 1);
    }

    // Subtle directional paper vignette from desk lighting
    const grad = this.paperCtx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
    grad.addColorStop(1, 'rgba(40, 30, 20, 0.04)');
    this.paperCtx.fillStyle = grad;
    this.paperCtx.fillRect(0, 0, w, h);

    this.paperCtx.restore();
  }

  public play() {
    if (!this.drawingData) return;
    if (this.currentTime >= this.totalDuration) {
      this.seek(0);
    }
    this.isPlaying = true;
    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
    this.notifyState();
  }

  public pause() {
    this.isPlaying = false;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    soundEngine.stop();
    this.notifyState();
  }

  public restart() {
    this.pause();
    this.seek(0);
    this.play();
  }

  public setPlaybackRate(rate: number) {
    this.playbackRate = rate;
  }

  public seek(targetTime: number) {
    if (!this.drawingData) return;
    this.currentTime = Math.max(0, Math.min(this.totalDuration, targetTime));

    // Fast-rebuild paper up to currentTime
    this.clearPaper();
    this.rebuildPaperUpTo(this.currentTime);
    this.updateHandPositionAt(this.currentTime);
    this.renderOverlay();
    this.notifyState();
  }

  private loop = (now: number) => {
    if (!this.isPlaying) return;

    const dt = Math.min(0.1, (now - this.lastTimestamp) / 1000) * this.playbackRate;
    this.lastTimestamp = now;

    this.currentTime += dt;
    if (this.currentTime >= this.totalDuration) {
      this.currentTime = this.totalDuration;
      this.isPlaying = false;
      soundEngine.stop();
      this.updateHandPositionAt(this.currentTime);
      this.renderOverlay();
      this.notifyState();
      return;
    }

    this.stepDrawing(dt);
    this.renderOverlay();
    this.notifyState();

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  /**
   * Calculates what portion of each stroke should be drawn at the given time
   */
  private stepDrawing(dt: number) {
    if (!this.drawingData || !this.paperCtx) return;

    const t = this.currentTime;
    const currentPhaseConfig = this.getCurrentPhaseConfig(t);
    const pInfo = currentPhaseConfig;

    // Filter strokes belonging to current phase
    const phaseStrokes = this.drawingData.strokes.filter(s => s.phase === pInfo.phase);
    const totalPhaseLength = this.drawingData.phaseLengths[pInfo.phase] || 1;

    // Fraction through current phase (0 to 1)
    const phaseProgress = Math.max(0, Math.min(1, (t - pInfo.start) / (pInfo.end - pInfo.start)));

    // Target cumulative distance in this phase
    const targetDist = phaseProgress * totalPhaseLength;

    // Check special intro and outro periods
    if (pInfo.phase === 1 && t < 1.4) {
      // 0 to 1.4s: Opening suspense! Paper is blank, hand enters frame smoothly from top-right
      const introProgress = t / 1.4;
      const startX = this.drawingData.width * 1.35;
      const startY = this.drawingData.height * 0.45;
      const firstPoint = phaseStrokes[0]?.points[0] || { x: this.drawingData.width * 0.5, y: this.drawingData.height * 0.5 };

      // Ease out cubic
      const ease = 1 - Math.pow(1 - introProgress, 3);
      this.handX = startX + (firstPoint.x - startX) * ease;
      this.handY = startY + (firstPoint.y - startY) * ease;
      this.handVx = (firstPoint.x - startX) * 0.5;
      this.handVy = (firstPoint.y - startY) * 0.5;
      this.isHandDrawing = false;
      soundEngine.update(false, 0, 0);
      return;
    }

    if (pInfo.phase === 6 && t > 58.6) {
      // 58.6 to 60s: Reveal! Artist finishes signature, lifts pencil, hand retreats off-screen
      const outroProgress = (t - 58.6) / 1.4;
      const lastStroke = this.drawingData.strokes[this.drawingData.strokes.length - 1];
      const lastPoint = lastStroke.points[lastStroke.points.length - 1];
      const exitX = this.drawingData.width * 1.4;
      const exitY = this.drawingData.height * 0.5;

      const ease = outroProgress * outroProgress;
      this.handX = lastPoint.x + (exitX - lastPoint.x) * ease;
      this.handY = lastPoint.y + (exitY - lastPoint.y) * ease;
      this.handVx = 15;
      this.handVy = 8;
      this.isHandDrawing = false;
      soundEngine.update(false, 0, 0);
      return;
    }

    // Step through strokes in current phase
    let accumulatedDist = 0;
    let activeStroke: DrawingStroke | null = null;
    let activeStrokeProgress = 0;

    for (const stroke of phaseStrokes) {
      const strokeIdx = this.drawingData.strokes.indexOf(stroke);
      const strokeStartDist = accumulatedDist;
      const strokeEndDist = accumulatedDist + stroke.length;

      if (targetDist >= strokeEndDist) {
        // Fully drawn
        if (this.strokeProgress[strokeIdx] < 1.0) {
          this.drawStrokeSegment(stroke, this.strokeProgress[strokeIdx], 1.0);
          this.strokeProgress[strokeIdx] = 1.0;
        }
      } else if (targetDist > strokeStartDist) {
        // Currently being drawn
        const prevProg = this.strokeProgress[strokeIdx];
        const newProg = Math.max(prevProg, (targetDist - strokeStartDist) / stroke.length);

        if (newProg > prevProg) {
          this.drawStrokeSegment(stroke, prevProg, newProg);
          this.strokeProgress[strokeIdx] = newProg;
        }

        activeStroke = stroke;
        activeStrokeProgress = newProg;
        break;
      } else {
        // Not reached yet
        break;
      }

      accumulatedDist += stroke.length;
    }

    // Update hand position to follow the active stroke
    if (activeStroke) {
      const ptInfo = this.getStrokePointAtProgress(activeStroke, activeStrokeProgress);
      this.handVx = (ptInfo.x - this.handX) * 12;
      this.handVy = (ptInfo.y - this.handY) * 12;
      this.handX = ptInfo.x;
      this.handY = ptInfo.y;
      this.isHandDrawing = true;

      const speed = Math.hypot(this.handVx, this.handVy);
      soundEngine.update(true, speed, ptInfo.pressure);
    } else {
      // Transitioning between strokes: smooth interpolation towards next stroke
      this.isHandDrawing = false;
      soundEngine.update(false, 0, 0);
    }
  }

  private drawStrokeSegment(stroke: DrawingStroke, fromProgress: number, toProgress: number) {
    if (!this.paperCtx || stroke.points.length < 2 || fromProgress >= toProgress) return;

    const ctx = this.paperCtx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.globalAlpha = stroke.alpha;

    const totalPts = stroke.points.length;
    const startIdx = Math.max(0, Math.floor(fromProgress * (totalPts - 1)));
    const endIdx = Math.min(totalPts - 1, Math.ceil(toProgress * (totalPts - 1)));

    for (let i = startIdx; i < endIdx; i++) {
      const p1 = stroke.points[i];
      const p2 = stroke.points[i + 1];
      if (!p2) break;

      const pressure = (p1.pressure + p2.pressure) / 2;
      ctx.lineWidth = Math.max(0.6, stroke.baseWidth * (0.65 + pressure * 0.7));

      // Graphite / charcoal edge texture simulation:
      // Slight opacity fluctuation
      const textureJitter = 0.9 + Math.random() * 0.2;
      ctx.globalAlpha = Math.min(1.0, stroke.alpha * textureJitter);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private getStrokePointAtProgress(stroke: DrawingStroke, progress: number): StrokePoint {
    const pts = stroke.points;
    if (pts.length <= 1) return pts[0] || { x: 0, y: 0, pressure: 0.5 };

    const totalSegments = pts.length - 1;
    const exactIndex = progress * totalSegments;
    const baseIdx = Math.min(totalSegments - 1, Math.floor(exactIndex));
    const frac = exactIndex - baseIdx;

    const p1 = pts[baseIdx];
    const p2 = pts[baseIdx + 1] || p1;

    return {
      x: p1.x + (p2.x - p1.x) * frac,
      y: p1.y + (p2.y - p1.y) * frac,
      pressure: p1.pressure + (p2.pressure - p1.pressure) * frac
    };
  }

  private rebuildPaperUpTo(targetTime: number) {
    if (!this.drawingData) return;

    this.strokeProgress = new Array(this.drawingData.strokes.length).fill(0);

    for (let p = 1; p <= 6; p++) {
      const pConfig = this.phaseTimes[p - 1];
      const phaseStrokes = this.drawingData.strokes.filter(s => s.phase === p);
      const phaseTotalLen = this.drawingData.phaseLengths[p] || 1;

      if (targetTime >= pConfig.end) {
        // Fully draw this phase
        for (const s of phaseStrokes) {
          const sIdx = this.drawingData.strokes.indexOf(s);
          this.drawStrokeSegment(s, 0, 1.0);
          this.strokeProgress[sIdx] = 1.0;
        }
      } else if (targetTime > pConfig.start) {
        // Partially draw this phase
        const phaseProgress = (targetTime - pConfig.start) / (pConfig.end - pConfig.start);
        const targetDist = phaseProgress * phaseTotalLen;
        let accumulated = 0;

        for (const s of phaseStrokes) {
          const sIdx = this.drawingData.strokes.indexOf(s);
          const sEnd = accumulated + s.length;

          if (targetDist >= sEnd) {
            this.drawStrokeSegment(s, 0, 1.0);
            this.strokeProgress[sIdx] = 1.0;
          } else if (targetDist > accumulated) {
            const prog = (targetDist - accumulated) / s.length;
            this.drawStrokeSegment(s, 0, prog);
            this.strokeProgress[sIdx] = prog;
            break;
          } else {
            break;
          }
          accumulated += s.length;
        }
        break;
      }
    }
  }

  private updateHandPositionAt(targetTime: number) {
    if (!this.drawingData) return;

    const pConfig = this.getCurrentPhaseConfig(targetTime);

    if (targetTime <= 0.5) {
      this.handX = this.drawingData.width * 1.35;
      this.handY = this.drawingData.height * 0.45;
      this.isHandDrawing = false;
      return;
    }

    if (targetTime >= 59.0) {
      this.handX = this.drawingData.width * 1.4;
      this.handY = this.drawingData.height * 0.5;
      this.isHandDrawing = false;
      return;
    }

    // Find stroke currently active
    const activeStrokeIdx = this.strokeProgress.findIndex(p => p > 0 && p < 1.0);
    if (activeStrokeIdx !== -1) {
      const s = this.drawingData.strokes[activeStrokeIdx];
      const pt = this.getStrokePointAtProgress(s, this.strokeProgress[activeStrokeIdx]);
      this.handX = pt.x;
      this.handY = pt.y;
      this.isHandDrawing = true;
    } else {
      // Find latest drawn stroke
      let lastIdx = 0;
      for (let i = 0; i < this.strokeProgress.length; i++) {
        if (this.strokeProgress[i] > 0) lastIdx = i;
      }
      const s = this.drawingData.strokes[lastIdx];
      if (s) {
        const pt = s.points[s.points.length - 1];
        this.handX = pt.x;
        this.handY = pt.y;
      }
      this.isHandDrawing = false;
    }
  }

  private renderOverlay() {
    if (!this.overlayCtx || !this.overlayCanvas || !this.drawingData) return;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    const scale = this.overlayCanvas.width / this.drawingData.width;

    handRenderer.render(
      ctx,
      this.handX * scale,
      this.handY * scale,
      this.isHandDrawing,
      this.handVx,
      this.handVy,
      this.style,
      this.currentTime,
      scale
    );
  }

  private getCurrentPhaseConfig(t: number) {
    for (const p of this.phaseTimes) {
      if (t >= p.start && t <= p.end) return p;
    }
    return this.phaseTimes[this.phaseTimes.length - 1];
  }

  private notifyState() {
    if (!this.onStateChange) return;
    const pConfig = this.getCurrentPhaseConfig(this.currentTime);

    this.onStateChange({
      currentTime: this.currentTime,
      totalDuration: this.totalDuration,
      isPlaying: this.isPlaying,
      isFinished: this.currentTime >= this.totalDuration,
      currentPhase: pConfig.phase,
      phaseName: pConfig.name,
      progress: this.currentTime / this.totalDuration,
      handPos: {
        x: this.handX,
        y: this.handY,
        isDrawing: this.isHandDrawing,
        vx: this.handVx,
        vy: this.handVy
      }
    });
  }

  public destroy() {
    this.pause();
  }
}

export const animationController = new AnimationController();
