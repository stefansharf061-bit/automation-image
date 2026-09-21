import { DrawingData, DrawingStroke, DrawingStyle, StrokePoint } from '../types';
import { handRenderer } from './handRenderer';
import { soundEngine } from './soundEngine';

/**
 * Minimum-Jerk trajectory polynomial (Flash & Hogan 1985)
 * Replicates biological human motor control:
 * Produces zero velocity and zero acceleration at endpoints with a natural bell-shaped velocity curve.
 */
export function easeMinimumJerk(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * u * (10 + u * (-15 + 6 * u)); // 10u^3 - 15u^4 + 6u^5
}

/**
 * Standard cubic ease-in-out
 */
export function easeInOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * Cubic ease-out for natural deceleration
 */
export function easeOutCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - u, 3);
}

/**
 * Cubic ease-in for natural acceleration
 */
export function easeInCubic(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  return u * u * u;
}

/**
 * Specialized human drawing stroke easing:
 * Accelerates smoothly into the mark, maintains fluid cruising momentum,
 * and decelerates gently to a controlled stop before lifting.
 */
export function easeHumanDrawingStroke(t: number): number {
  const u = Math.max(0, Math.min(1, t));
  // 5th-order minimum jerk with slight asymmetric acceleration bias
  const mj = u * u * u * (10 + u * (-15 + 6 * u));
  const smooth = u * u * (3 - 2 * u);
  return mj * 0.75 + smooth * 0.25;
}

export interface PathComplexityData {
  cumulativeTimeWeights: number[];
  totalTimeWeight: number;
  tortuosity: number;
  averageCurvature: number;
  complexityFactor: number;
}

/**
 * Compute the path complexity profile for a stroke based on local curvature, heading changes,
 * and tortuosity. Uses the biomechanical 2/3 power law: drawing speed slows down on tight curves
 * and intricate turns, and accelerates along straight or gentle arcs.
 */
export function computeStrokeComplexity(stroke: DrawingStroke): PathComplexityData {
  const pts = stroke.points;
  if (pts.length < 2) {
    return {
      cumulativeTimeWeights: [0],
      totalTimeWeight: 1,
      tortuosity: 1,
      averageCurvature: 0,
      complexityFactor: 1
    };
  }

  const cumulativeTimeWeights: number[] = [0];
  let totalAngularChange = 0;
  let totalArcLength = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const pPrev = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const pNext = pts[Math.min(pts.length - 1, i + 2)];

    const segLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    totalArcLength += segLen;

    // Angle of current segment
    const curAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    // Heading change from previous segment
    let dAngle = 0;
    if (i > 0) {
      const prevAngle = Math.atan2(p1.y - pPrev.y, p1.x - pPrev.x);
      let diff = Math.abs(curAngle - prevAngle);
      while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);
      dAngle = diff;
      totalAngularChange += dAngle;
    }

    // Lookahead angular change (anticipating upcoming corners)
    if (i < pts.length - 2) {
      const nextAngle = Math.atan2(pNext.y - p2.y, pNext.x - p2.x);
      let nextDiff = Math.abs(nextAngle - curAngle);
      while (nextDiff > Math.PI) nextDiff = Math.abs(nextDiff - 2 * Math.PI);
      dAngle = Math.max(dAngle, nextDiff * 0.65);
    }

    // Local curvature (radians per pixel)
    const localCurvature = dAngle / Math.max(1, segLen);

    // Biomechanical time weighting:
    // Tight curves and sharp turns demand more time per pixel from human motor control.
    // Straightaways and gentle sweeps have low complexity weight -> drawn faster.
    const curvaturePenalty = 1.0 + 2.8 * Math.min(1.8, dAngle) + 1.2 * Math.min(2.0, localCurvature * 18);
    const segmentTimeWeight = Math.max(0.1, segLen * curvaturePenalty);

    cumulativeTimeWeights.push(cumulativeTimeWeights[cumulativeTimeWeights.length - 1] + segmentTimeWeight);
  }

  const totalTimeWeight = Math.max(0.001, cumulativeTimeWeights[cumulativeTimeWeights.length - 1]);
  const chordDist = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
  const tortuosity = totalArcLength / Math.max(1, chordDist);
  const averageCurvature = totalAngularChange / Math.max(1, totalArcLength);

  // Overall stroke complexity factor scales the stroke's scheduled drawing duration
  const complexityFactor = 1.0 + Math.min(1.5, (tortuosity - 1) * 0.4 + averageCurvature * 28);

  return {
    cumulativeTimeWeights,
    totalTimeWeight,
    tortuosity,
    averageCurvature,
    complexityFactor
  };
}

export interface TimelineState {
  currentTime: number; // in seconds (0 to 60)
  totalDuration: number;
  isPlaying: boolean;
  isFinished: boolean;
  currentPhase: number;
  phaseName: string;
  progress: number; // 0 to 1
  handPos: {
    x: number;
    y: number;
    isDrawing: boolean;
    vx: number;
    vy: number;
    lift: number;
    angle: number;
  };
  handMode: 'representative' | 'sprite';
}

interface ScheduledStroke {
  stroke: DrawingStroke;
  phase: number;
  startTime: number;
  drawDuration: number;
  endTime: number;
  pauseAfter: number;
}

export class AnimationController {
  private drawingData: DrawingData | null = null;
  private paperCanvas: HTMLCanvasElement | null = null;
  private paperCtx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;

  private totalDuration: number = 60.0;
  private currentTime: number = 0;
  private isPlaying: boolean = false;
  private playbackRate: number = 1.0;
  private animFrameId: number | null = null;
  private lastTimestamp: number = 0;

  // Scheduled timeline
  private scheduledStrokes: ScheduledStroke[] = [];
  private strokeDrawnProgress: number[] = [];
  private strokeComplexityMap: Map<DrawingStroke, PathComplexityData> = new Map();

  // Real-time hand state
  private handX: number = 0;
  private handY: number = 0;
  private handVx: number = 0;
  private handVy: number = 0;
  private handLift: number = 1.0; // 0 = paper contact, 1 = lifted
  private handAngle: number = 0;
  private isHandDrawing: boolean = false;
  private style: DrawingStyle = 'pencil';
  private handMode: 'representative' | 'sprite' = 'sprite';

  // Coordinate transform when overlayCanvas is positioned over the full scene/container
  private overlayTransform = { offsetX: 0, offsetY: 0, scale: 1 };

  private onStateChange: ((state: TimelineState) => void) | null = null;

  // Strict 6-phase timeline boundaries (sum = 60.0s)
  private readonly phaseWindows = [
    { phase: 1, name: 'Curiosity & Construction Marks', start: 0.0, end: 5.0 },
    { phase: 2, name: 'Major Outlines & Proportions', start: 5.0, end: 20.0 },
    { phase: 3, name: 'Features, Contour & Anatomy', start: 20.0, end: 40.0 },
    { phase: 4, name: 'Tonal Shading & Hatching', start: 40.0, end: 53.0 },
    { phase: 5, name: 'Deep Contrast & Accents', start: 53.0, end: 58.0 },
    { phase: 6, name: 'Artist Signature & Final Reveal', start: 58.0, end: 60.0 }
  ];

  public setCanvases(paperCanvas: HTMLCanvasElement, overlayCanvas: HTMLCanvasElement) {
    this.paperCanvas = paperCanvas;
    this.paperCtx = paperCanvas.getContext('2d', { willReadFrequently: false });
    this.overlayCanvas = overlayCanvas;
    this.overlayCtx = overlayCanvas.getContext('2d');
  }

  public setOverlayTransform(offsetX: number, offsetY: number, scale: number) {
    this.overlayTransform = { offsetX, offsetY, scale };
    this.renderOverlay();
  }

  public setCallback(cb: (state: TimelineState) => void) {
    this.onStateChange = cb;
  }

  public setHandMode(mode: 'representative' | 'sprite') {
    this.handMode = mode;
    this.renderOverlay();
    this.notifyState();
  }

  public getHandMode(): 'representative' | 'sprite' {
    return this.handMode;
  }

  public loadDrawing(data: DrawingData, style: DrawingStyle) {
    this.drawingData = data;
    this.style = style;
    this.currentTime = 0;
    this.strokeDrawnProgress = new Array(data.strokes.length).fill(0);

    // Precompute path complexity profiles for every stroke
    this.strokeComplexityMap.clear();
    for (const s of data.strokes) {
      this.strokeComplexityMap.set(s, computeStrokeComplexity(s));
    }

    // Build the master time schedule with variable timing based on path complexity
    this.buildTimeSchedule(data);

    // Initial hand position off-screen bottom-right ready to enter
    this.handX = data.width * 1.35;
    this.handY = data.height * 0.95;
    this.handLift = 1.0;
    this.handAngle = 0;
    this.isHandDrawing = false;

    this.clearPaper();
    this.renderOverlay();
    this.notifyState();
  }

  /**
   * Precompute an exact, non-linear human drawing schedule for every stroke.
   * Replaces constant-speed drawing with variable timing based on path complexity,
   * tortuosity, and ensures deliberate biological pauses between marks.
   */
  private buildTimeSchedule(data: DrawingData) {
    this.scheduledStrokes = [];
    const strokes = data.strokes;

    for (const pw of this.phaseWindows) {
      const phaseStrokes = strokes.filter(s => s.phase === pw.phase);
      if (phaseStrokes.length === 0) continue;

      // Intro padding for Phase 1 (hand glides in from off-screen)
      const phaseIntro = pw.phase === 1 ? 1.0 : 0.0;
      // Outro padding for Phase 6 (signature finishes, hand retreats)
      const phaseOutro = pw.phase === 6 ? 0.8 : 0.0;

      const availableTime = Math.max(0.5, (pw.end - pw.start) - phaseIntro - phaseOutro);

      // Compute raw human duration for each stroke in this phase based on path complexity
      const rawDurations: number[] = [];
      const rawPauses: number[] = [];

      for (let i = 0; i < phaseStrokes.length; i++) {
        const s = phaseStrokes[i];
        const complexity = this.strokeComplexityMap.get(s) || computeStrokeComplexity(s);

        let baseDur = 0.8;
        if (s.isHatching) {
          // Shading sweeps: rhythmic oscillating motions
          baseDur = Math.max(0.65, Math.min(1.7, 0.55 + s.length * 0.0032));
        } else if (s.length < 80) {
          // Quick detail strokes
          baseDur = Math.max(0.38, Math.min(0.85, 0.32 + s.length * 0.0038));
        } else if (s.length < 240) {
          // Medium contour line
          baseDur = Math.max(0.75, Math.min(1.65, 0.65 + s.length * 0.0032));
        } else {
          // Long architectural or silhouette mark
          baseDur = Math.max(1.2, Math.min(2.7, 1.0 + s.length * 0.0026));
        }

        // Variable timing: scale duration by path complexity factor (tortuosity + local curvature)
        const dur = baseDur * complexity.complexityFactor;
        rawDurations.push(dur);

        // Deliberate repositioning pause between strokes:
        // Gives the hand dedicated time to pause, lift, transit in an arc, and hover before touchdown
        if (i < phaseStrokes.length - 1) {
          const nextS = phaseStrokes[i + 1];
          const lastPt = s.points[s.points.length - 1];
          const nextFirstPt = nextS.points[0];
          const jumpDist = Math.hypot(nextFirstPt.x - lastPt.x, nextFirstPt.y - lastPt.y);
          // Pause scales with distance to travel with guaranteed minimum of 0.20s
          const pause = Math.max(0.20, Math.min(0.48, 0.18 + jumpDist * 0.0009));
          rawPauses.push(pause);
        } else {
          rawPauses.push(0.18);
        }
      }

      const totalRaw = rawDurations.reduce((a, b) => a + b, 0) + rawPauses.reduce((a, b) => a + b, 0);
      const timeScale = availableTime / Math.max(0.1, totalRaw);

      let curTime = pw.start + phaseIntro;
      for (let i = 0; i < phaseStrokes.length; i++) {
        const s = phaseStrokes[i];
        const scaledDur = rawDurations[i] * timeScale;
        const scaledPause = rawPauses[i] * timeScale;

        this.scheduledStrokes.push({
          stroke: s,
          phase: pw.phase,
          startTime: curTime,
          drawDuration: scaledDur,
          endTime: curTime + scaledDur,
          pauseAfter: scaledPause
        });

        curTime += scaledDur + scaledPause;
      }
    }
  }

  public clearPaper() {
    if (!this.paperCtx || !this.paperCanvas) return;
    const ctx = this.paperCtx;
    const w = this.paperCanvas.width;
    const h = this.paperCanvas.height;

    // Textured cotton drawing paper
    ctx.fillStyle = '#fdfbf7';
    ctx.fillRect(0, 0, w, h);

    // Subtle natural paper grain
    ctx.save();
    ctx.fillStyle = 'rgba(130, 120, 105, 0.022)';
    for (let y = 0; y < h; y += 3) {
      for (let x = (y % 2) * 2; x < w; x += 4) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  public play() {
    if (this.isPlaying) return;
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

    this.clearPaper();
    this.rebuildPaperUpTo(this.currentTime);
    this.updateHandPositionAt(this.currentTime);
    this.renderOverlay();
    this.notifyState();
  }

  private loop = (now: number) => {
    if (!this.isPlaying) return;

    const dt = Math.min(0.08, (now - this.lastTimestamp) / 1000) * this.playbackRate;
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

  private stepDrawing(dt: number) {
    if (!this.drawingData || !this.paperCtx) return;

    const t = this.currentTime;

    // Intro glide: 0.0 to 1.0s hand glides in from bottom-right towards first stroke
    if (t < 1.0) {
      soundEngine.stop();
      this.isHandDrawing = false;
      this.handLift = 1.0;

      const firstStroke = this.scheduledStrokes[0];
      const targetPt = firstStroke ? firstStroke.stroke.points[0] : { x: this.drawingData.width * 0.5, y: this.drawingData.height * 0.3 };
      const startX = this.drawingData.width * 1.35;
      const startY = this.drawingData.height * 0.95;

      const u = t / 1.0;
      // Smooth cubic ease-out
      const ease = 1 - Math.pow(1 - u, 3);

      this.handX = startX + (targetPt.x - startX) * ease;
      this.handY = startY + (targetPt.y - startY) * ease;
      this.handVx = (targetPt.x - startX) * (1 - ease) * 1.2;
      this.handVy = (targetPt.y - startY) * (1 - ease) * 1.2;
      return;
    }

    // Outro reveal: 59.2 to 60.0s hand lifts and retreats off-screen
    if (t >= 59.2) {
      soundEngine.stop();
      this.isHandDrawing = false;
      this.handLift = 1.0;

      const u = (t - 59.2) / 0.8;
      const ease = u * u;

      const targetX = this.drawingData.width * 1.38;
      const targetY = this.drawingData.height * 0.92;

      this.handX += (targetX - this.handX) * (ease * 0.3 + 0.08);
      this.handY += (targetY - this.handY) * (ease * 0.3 + 0.08);
      return;
    }

    // Find the currently scheduled stroke or reposition pause at time t
    let activeSched: ScheduledStroke | null = null;
    let inPause = false;
    let pauseFromPt: StrokePoint | null = null;
    let pauseToPt: StrokePoint | null = null;
    let pauseProgress = 0;

    for (let i = 0; i < this.scheduledStrokes.length; i++) {
      const sched = this.scheduledStrokes[i];
      const strokeIdx = this.drawingData.strokes.indexOf(sched.stroke);

      if (t >= sched.startTime && t < sched.endTime) {
        // Actively drawing this stroke
        activeSched = sched;
        break;
      } else if (t >= sched.endTime && t < sched.endTime + sched.pauseAfter) {
        // In the repositioning pause after this stroke
        inPause = true;
        pauseFromPt = sched.stroke.points[sched.stroke.points.length - 1];
        const nextSched = this.scheduledStrokes[i + 1];
        pauseToPt = nextSched ? nextSched.stroke.points[0] : pauseFromPt;
        pauseProgress = (t - sched.endTime) / Math.max(0.001, sched.pauseAfter);
        // Ensure this stroke is rendered 100%
        if (this.strokeDrawnProgress[strokeIdx] < 1.0) {
          this.drawStrokeSegment(sched.stroke, this.strokeDrawnProgress[strokeIdx], 1.0);
          this.strokeDrawnProgress[strokeIdx] = 1.0;
        }
        break;
      } else if (t >= sched.endTime + sched.pauseAfter) {
        // Stroke is fully completed
        if (this.strokeDrawnProgress[strokeIdx] < 1.0) {
          this.drawStrokeSegment(sched.stroke, this.strokeDrawnProgress[strokeIdx], 1.0);
          this.strokeDrawnProgress[strokeIdx] = 1.0;
        }
      }
    }

    if (activeSched) {
      const strokeIdx = this.drawingData.strokes.indexOf(activeSched.stroke);
      const rawProg = Math.max(0, Math.min(1, (t - activeSched.startTime) / Math.max(0.001, activeSched.drawDuration)));
      // Natural human motor acceleration and deceleration using minimum-jerk profile
      const easeProg = easeHumanDrawingStroke(rawProg);

      // Draw the new segment on the paper
      const prevProg = this.strokeDrawnProgress[strokeIdx];
      if (easeProg > prevProg) {
        this.drawStrokeSegment(activeSched.stroke, prevProg, easeProg);
        this.strokeDrawnProgress[strokeIdx] = easeProg;
      }

      // Hand contact position with variable timing governed by path complexity
      const activePt = this.getStrokePointAtProgress(activeSched.stroke, easeProg);

      const dx = activePt.x - this.handX;
      const dy = activePt.y - this.handY;
      const speed = Math.hypot(dx, dy) / Math.max(0.001, dt);

      this.handVx = dx / Math.max(0.001, dt);
      this.handVy = dy / Math.max(0.001, dt);
      this.handX = activePt.x;
      this.handY = activePt.y;

      // Contact state: pencil tip is locked on the paper
      this.isHandDrawing = true;
      this.handLift = 0.0;

      // Subtle wrist angle response to stroke direction
      if (Math.hypot(this.handVx, this.handVy) > 12) {
        const targetAngle = Math.atan2(this.handVy, this.handVx) * 0.06;
        this.handAngle += (targetAngle - this.handAngle) * 0.14;
      }

      soundEngine.update(true, speed, activePt.pressure);
    } else if (inPause && pauseFromPt && pauseToPt) {
      // Repositioning interval: hand pauses briefly between strokes
      this.isHandDrawing = false;
      soundEngine.stop();

      // Divide the inter-stroke pause into three realistic biological sub-phases:
      // 1. Post-stroke Lift & Deliberation Pause (0.0 to 0.22)
      //    Hand stays stationary at previous stroke end, pencil lifts up.
      // 2. Air Transit Flight (0.22 to 0.78)
      //    Hand glides smoothly in an elevated arc from previous end to upcoming start.
      // 3. Pre-stroke Hover & Landing Pause (0.78 to 1.0)
      //    Hand arrives at next stroke start, pauses and hovers, pencil descends to contact paper.

      if (pauseProgress < 0.22) {
        // Phase 1: Lift-off deliberation pause at previous stroke end
        const liftProg = pauseProgress / 0.22;
        this.handLift = easeOutCubic(liftProg);
        this.handX = pauseFromPt.x;
        this.handY = pauseFromPt.y;
        this.handVx = 0;
        this.handVy = 0;
      } else if (pauseProgress < 0.78) {
        // Phase 2: In-flight transit with minimum jerk acceleration & deceleration
        const transitProg = (pauseProgress - 0.22) / 0.56;
        const transitEase = easeMinimumJerk(transitProg);
        const arcHeight = Math.sin(transitProg * Math.PI) * -14;

        const targetX = pauseFromPt.x + (pauseToPt.x - pauseFromPt.x) * transitEase;
        const targetY = pauseFromPt.y + (pauseToPt.y - pauseFromPt.y) * transitEase + arcHeight;

        this.handVx = (targetX - this.handX) / Math.max(0.001, dt);
        this.handVy = (targetY - this.handY) / Math.max(0.001, dt);
        this.handX = targetX;
        this.handY = targetY;
        this.handLift = 1.0;
      } else {
        // Phase 3: Hover & landing pause poised at upcoming stroke start
        const landProg = (pauseProgress - 0.78) / 0.22;
        this.handLift = Math.max(0, 1.0 - easeInOutCubic(landProg));
        this.handX = pauseToPt.x;
        this.handY = pauseToPt.y;
        this.handVx = 0;
        this.handVy = 0;
      }
    } else {
      this.isHandDrawing = false;
      this.handLift = 0.8;
      soundEngine.stop();
    }
  }

  /**
   * Helper to map progress (0..1) to vertex index using path complexity weights
   */
  private getSegmentIndexAtProgress(stroke: DrawingStroke, prog: number): number {
    const pts = stroke.points;
    if (pts.length <= 1 || prog <= 0) return 0;
    if (prog >= 1.0) return pts.length - 1;

    const comp = this.strokeComplexityMap.get(stroke) || computeStrokeComplexity(stroke);
    const weights = comp.cumulativeTimeWeights;
    const targetWeight = prog * comp.totalTimeWeight;

    let low = 0;
    let high = weights.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (weights[mid] < targetWeight) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, Math.min(pts.length - 1, high));
  }

  private drawStrokeSegment(stroke: DrawingStroke, fromProg: number, toProg: number) {
    if (!this.paperCtx || fromProg >= toProg) return;
    const ctx = this.paperCtx;
    const pts = stroke.points;
    if (pts.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pStart = this.getStrokePointAtProgress(stroke, fromProg);
    const pEnd = this.getStrokePointAtProgress(stroke, toProg);

    const pressure = (pStart.pressure + pEnd.pressure) / 2;
    const width = stroke.baseWidth * (0.65 + pressure * 0.75);
    ctx.lineWidth = width;

    if (stroke.style === 'pencil') {
      ctx.strokeStyle = `rgba(38, 36, 33, ${stroke.alpha * (0.55 + pressure * 0.45)})`;
    } else if (stroke.style === 'charcoal') {
      ctx.strokeStyle = `rgba(20, 18, 16, ${stroke.alpha * (0.65 + pressure * 0.5)})`;
    } else {
      ctx.strokeStyle = `rgba(8, 8, 8, ${stroke.alpha})`;
    }

    if (fromProg <= 0 && toProg >= 1.0) {
      // Whole stroke rendering on timeline scrub / rebuild
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    } else {
      // Precision incremental segment: marks strictly from pStart to pEnd
      // The mark terminates at pEnd, which is mathematically identical to the pencil tip position
      const startIdx = this.getSegmentIndexAtProgress(stroke, fromProg);
      const endIdx = this.getSegmentIndexAtProgress(stroke, toProg);

      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);

      if (endIdx > startIdx) {
        for (let i = startIdx + 1; i <= endIdx; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
      }

      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Determine exact pencil contact point on stroke for given eased progress.
   * Uses precomputed path complexity weights so speed dynamically slows down on sharp corners
   * and intricate curves, and accelerates on smooth straights.
   */
  private getStrokePointAtProgress(stroke: DrawingStroke, easedProg: number): StrokePoint {
    const pts = stroke.points;
    if (pts.length === 0) return { x: 0, y: 0, pressure: 0.5 };
    if (pts.length === 1 || easedProg <= 0) return pts[0];
    if (easedProg >= 1.0) return pts[pts.length - 1];

    const comp = this.strokeComplexityMap.get(stroke) || computeStrokeComplexity(stroke);
    const weights = comp.cumulativeTimeWeights;
    const targetWeight = easedProg * comp.totalTimeWeight;

    // Binary search for segment i where weights[i] <= targetWeight <= weights[i + 1]
    let low = 0;
    let high = weights.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (weights[mid] < targetWeight) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const idx = Math.max(0, Math.min(pts.length - 2, high));
    const w0 = weights[idx];
    const w1 = weights[idx + 1];
    const segWeight = Math.max(1e-5, w1 - w0);
    const frac = Math.max(0, Math.min(1, (targetWeight - w0) / segWeight));

    const p1 = pts[idx];
    const p2 = pts[idx + 1];

    return {
      x: p1.x + (p2.x - p1.x) * frac,
      y: p1.y + (p2.y - p1.y) * frac,
      pressure: p1.pressure + (p2.pressure - p1.pressure) * frac
    };
  }

  private rebuildPaperUpTo(targetTime: number) {
    if (!this.drawingData) return;

    for (let i = 0; i < this.strokeDrawnProgress.length; i++) {
      this.strokeDrawnProgress[i] = 0;
    }

    for (const sched of this.scheduledStrokes) {
      const sIdx = this.drawingData.strokes.indexOf(sched.stroke);
      if (targetTime >= sched.endTime) {
        this.drawStrokeSegment(sched.stroke, 0, 1.0);
        this.strokeDrawnProgress[sIdx] = 1.0;
      } else if (targetTime > sched.startTime) {
        const rawProg = Math.max(0, Math.min(1, (targetTime - sched.startTime) / Math.max(0.001, sched.drawDuration)));
        const easeProg = easeHumanDrawingStroke(rawProg);
        this.drawStrokeSegment(sched.stroke, 0, easeProg);
        this.strokeDrawnProgress[sIdx] = easeProg;
      } else {
        break;
      }
    }
  }

  private updateHandPositionAt(targetTime: number) {
    if (!this.drawingData) return;

    if (targetTime <= 1.0) {
      this.handX = this.drawingData.width * 1.35;
      this.handY = this.drawingData.height * 0.95;
      this.handLift = 1.0;
      this.isHandDrawing = false;
      return;
    }

    if (targetTime >= 59.2) {
      this.handX = this.drawingData.width * 1.38;
      this.handY = this.drawingData.height * 0.92;
      this.handLift = 1.0;
      this.isHandDrawing = false;
      return;
    }

    // Find active stroke or pause at targetTime
    for (let i = 0; i < this.scheduledStrokes.length; i++) {
      const sched = this.scheduledStrokes[i];
      if (targetTime >= sched.startTime && targetTime < sched.endTime) {
        const rawProg = Math.max(0, Math.min(1, (targetTime - sched.startTime) / Math.max(0.001, sched.drawDuration)));
        const easeProg = easeHumanDrawingStroke(rawProg);
        const pt = this.getStrokePointAtProgress(sched.stroke, easeProg);
        this.handX = pt.x;
        this.handY = pt.y;
        this.handLift = 0.0;
        this.isHandDrawing = true;
        return;
      } else if (targetTime >= sched.endTime && targetTime < sched.endTime + sched.pauseAfter) {
        const pauseProg = Math.max(0, Math.min(1, (targetTime - sched.endTime) / Math.max(0.001, sched.pauseAfter)));
        const fromPt = sched.stroke.points[sched.stroke.points.length - 1];
        const nextSched = this.scheduledStrokes[i + 1];
        const toPt = nextSched ? nextSched.stroke.points[0] : fromPt;

        if (pauseProg < 0.22) {
          // Lift-off pause
          this.handLift = easeOutCubic(pauseProg / 0.22);
          this.handX = fromPt.x;
          this.handY = fromPt.y;
        } else if (pauseProg < 0.78) {
          // Transit flight
          const transitProg = (pauseProg - 0.22) / 0.56;
          const transitEase = easeMinimumJerk(transitProg);
          const arc = Math.sin(transitProg * Math.PI) * -14;
          this.handX = fromPt.x + (toPt.x - fromPt.x) * transitEase;
          this.handY = fromPt.y + (toPt.y - fromPt.y) * transitEase + arc;
          this.handLift = 1.0;
        } else {
          // Landing hover pause
          const landProg = (pauseProg - 0.78) / 0.22;
          this.handLift = Math.max(0, 1.0 - easeInOutCubic(landProg));
          this.handX = toPt.x;
          this.handY = toPt.y;
        }

        this.isHandDrawing = false;
        return;
      }
    }
  }

  private renderOverlay() {
    if (!this.overlayCtx || !this.overlayCanvas || !this.drawingData) return;
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    if (this.handMode === 'sprite') {
      const t = this.overlayTransform;
      const renderX = t.offsetX + this.handX * t.scale;
      const renderY = t.offsetY + this.handY * t.scale;

      handRenderer.render(
        ctx,
        renderX,
        renderY,
        this.isHandDrawing,
        this.handVx,
        this.handVy,
        this.style,
        this.currentTime,
        t.scale
      );
    }
  }

  private getCurrentPhaseConfig(t: number) {
    for (const p of this.phaseWindows) {
      if (t >= p.start && t <= p.end) return p;
    }
    return this.phaseWindows[this.phaseWindows.length - 1];
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
      progress: Math.min(1.0, this.currentTime / this.totalDuration),
      handPos: {
        x: this.handX,
        y: this.handY,
        isDrawing: this.isHandDrawing,
        vx: this.handVx,
        vy: this.handVy,
        lift: this.handLift,
        angle: this.handAngle
      },
      handMode: this.handMode
    });
  }

  public destroy() {
    this.pause();
    this.drawingData = null;
    this.paperCanvas = null;
    this.paperCtx = null;
    this.overlayCanvas = null;
    this.overlayCtx = null;
    this.onStateChange = null;
  }
}

export const animationController = new AnimationController();
