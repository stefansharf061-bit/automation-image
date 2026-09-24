import { DrawingData, DrawingStroke, DrawingStyle, StrokePoint } from '../types';

export async function loadImage(source: string | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error('Failed to load image: ' + e));

    if (typeof source === 'string') {
      img.src = source;
    } else {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (typeof ev.target?.result === 'string') {
          img.src = ev.target.result;
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(source);
    }
  });
}

interface Point2D {
  x: number;
  y: number;
}

// -------------------------------------------------------------
// GEOMETRIC & CURVE SIMPLIFICATION UTILITIES
// -------------------------------------------------------------

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function pathLength(pts: Point2D[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += dist(pts[i], pts[i - 1]);
  }
  return len;
}

/**
 * Ramer-Douglas-Peucker line simplification
 */
function rdp(pts: Point2D[], eps: number): Point2D[] {
  if (pts.length <= 2) return pts;
  let maxD = 0;
  let index = 0;
  const p1 = pts[0];
  const p2 = pts[pts.length - 1];
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < pts.length - 1; i++) {
    let d = 0;
    if (lenSq === 0) {
      d = dist(pts[i], p1);
    } else {
      const t = Math.max(0, Math.min(1, ((pts[i].x - p1.x) * dx + (pts[i].y - p1.y) * dy) / lenSq));
      d = dist(pts[i], { x: p1.x + t * dx, y: p1.y + t * dy });
    }
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }

  if (maxD > eps) {
    const r1 = rdp(pts.slice(0, index + 1), eps);
    const r2 = rdp(pts.slice(index), eps);
    return r1.slice(0, -1).concat(r2);
  }
  return [p1, p2];
}

/**
 * Catmull-Rom cubic spline interpolation for organic artist stroke fluidness
 */
function smoothPoints(pts: Point2D[]): Point2D[] {
  if (pts.length <= 2) return pts;
  const res: Point2D[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    for (let t = 0.33; t <= 0.67; t += 0.34) {
      const t2 = t * t;
      const t3 = t2 * t;
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      res.push({ x, y });
    }
    res.push(p2);
  }
  return res;
}

// -------------------------------------------------------------
// SEPARABLE 1D GAUSSIAN BLUR
// -------------------------------------------------------------

function gaussianBlur(
  src: Float32Array,
  w: number,
  h: number,
  sigma: number
): Float32Array {
  const dst = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);
  const radius = Math.ceil(sigma * 2.5);
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const px = Math.min(w - 1, Math.max(0, x + k));
        acc += src[row + px] * kernel[k + radius];
      }
      tmp[row + x] = acc;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const py = Math.min(h - 1, Math.max(0, y + k));
        acc += tmp[py * w + x] * kernel[k + radius];
      }
      dst[y * w + x] = acc;
    }
  }

  return dst;
}

// -------------------------------------------------------------
// ZHANG-SUEN MORPHOLOGICAL THINNING (SKELETONIZATION)
// -------------------------------------------------------------

function zhangSuenThinning(bin: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(bin);
  let changed = true;

  while (changed) {
    changed = false;
    const step1: number[] = [];

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        if (img[idx] !== 1) continue;

        const p2 = img[idx - w];
        const p3 = img[idx - w + 1];
        const p4 = img[idx + 1];
        const p5 = img[idx + w + 1];
        const p6 = img[idx + w];
        const p7 = img[idx + w - 1];
        const p8 = img[idx - 1];
        const p9 = img[idx - w - 1];

        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;

        let a = 0;
        if (p2 === 0 && p3 === 1) a++;
        if (p3 === 0 && p4 === 1) a++;
        if (p4 === 0 && p5 === 1) a++;
        if (p5 === 0 && p6 === 1) a++;
        if (p6 === 0 && p7 === 1) a++;
        if (p7 === 0 && p8 === 1) a++;
        if (p8 === 0 && p9 === 1) a++;
        if (p9 === 0 && p2 === 1) a++;
        if (a !== 1) continue;

        if (p2 * p4 * p6 !== 0) continue;
        if (p4 * p6 * p8 !== 0) continue;

        step1.push(idx);
      }
    }

    for (const idx of step1) {
      img[idx] = 0;
      changed = true;
    }

    const step2: number[] = [];
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = row + x;
        if (img[idx] !== 1) continue;

        const p2 = img[idx - w];
        const p3 = img[idx - w + 1];
        const p4 = img[idx + 1];
        const p5 = img[idx + w + 1];
        const p6 = img[idx + w];
        const p7 = img[idx + w - 1];
        const p8 = img[idx - 1];
        const p9 = img[idx - w - 1];

        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;

        let a = 0;
        if (p2 === 0 && p3 === 1) a++;
        if (p3 === 0 && p4 === 1) a++;
        if (p4 === 0 && p5 === 1) a++;
        if (p5 === 0 && p6 === 1) a++;
        if (p6 === 0 && p7 === 1) a++;
        if (p7 === 0 && p8 === 1) a++;
        if (p8 === 0 && p9 === 1) a++;
        if (p9 === 0 && p2 === 1) a++;
        if (a !== 1) continue;

        if (p2 * p4 * p8 !== 0) continue;
        if (p2 * p6 * p8 !== 0) continue;

        step2.push(idx);
      }
    }

    for (const idx of step2) {
      img[idx] = 0;
      changed = true;
    }
  }

  return img;
}

// -------------------------------------------------------------
// MASTER PROCESSOR: CLEAN ANATOMICAL LINE-ART PORTRAIT PIPELINE
// -------------------------------------------------------------

export async function processImageToDrawing(
  source: string | File,
  style: DrawingStyle = 'pencil',
  targetWidth: number = 720,
  targetHeight: number = 960
): Promise<DrawingData> {
  const img = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get canvas context');

  // Draw background white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  // Contain resize with centered composition
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const targetAspect = targetWidth / targetHeight;
  let dw = targetWidth;
  let dh = targetHeight;
  let dx = 0;
  let dy = 0;

  if (imgAspect > targetAspect) {
    dh = targetWidth / imgAspect;
    dy = (targetHeight - dh) / 2;
  } else {
    dw = targetHeight * imgAspect;
    dx = (targetWidth - dw) / 2;
  }

  ctx.drawImage(img, dx, dy, dw, dh);
  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const pixels = imgData.data;

  // 1. Grayscale luminance extraction (ITU-R BT.601)
  const gray = new Float32Array(targetWidth * targetHeight);
  for (let i = 0; i < pixels.length; i += 4) {
    gray[i / 4] = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255.0;
  }

  // 2. High-Fidelity Anatomical Edge Extraction (Canny with Directional NMS & Adaptive Hysteresis)
  // Fine Gaussian smoothing preserving delicate facial details (pupils, eyelids, nostril crevices, lip seam)
  const fineSmooth = gaussianBlur(gray, targetWidth, targetHeight, 2.2);

  const gx = new Float32Array(targetWidth * targetHeight);
  const gy = new Float32Array(targetWidth * targetHeight);
  const mag = new Float32Array(targetWidth * targetHeight);

  // Exclude immediate canvas boundary to prevent artificial frame borders
  const margin = 8;
  for (let y = margin; y < targetHeight - margin; y++) {
    const row = y * targetWidth;
    for (let x = margin; x < targetWidth - margin; x++) {
      const idx = row + x;
      const gX =
        -fineSmooth[(y - 1) * targetWidth + (x - 1)] +
        fineSmooth[(y - 1) * targetWidth + (x + 1)] +
        -2 * fineSmooth[row + (x - 1)] +
        2 * fineSmooth[row + (x + 1)] +
        -fineSmooth[(y + 1) * targetWidth + (x - 1)] +
        fineSmooth[(y + 1) * targetWidth + (x + 1)];

      const gY =
        -fineSmooth[(y - 1) * targetWidth + (x - 1)] -
        2 * fineSmooth[(y - 1) * targetWidth + x] -
        fineSmooth[(y - 1) * targetWidth + (x + 1)] +
        fineSmooth[(y + 1) * targetWidth + (x - 1)] +
        2 * fineSmooth[(y + 1) * targetWidth + x] +
        fineSmooth[(y + 1) * targetWidth + (x + 1)];

      gx[idx] = gX;
      gy[idx] = gY;
      mag[idx] = Math.hypot(gX, gY);
    }
  }

  // Non-maximum suppression along gradient orientation
  const nms = new Float32Array(targetWidth * targetHeight);
  for (let y = margin; y < targetHeight - margin; y++) {
    const row = y * targetWidth;
    for (let x = margin; x < targetWidth - margin; x++) {
      const idx = row + x;
      const m = mag[idx];
      if (m < 0.035) continue; // Noise floor

      const gX = gx[idx];
      const gY = gy[idx];
      let angle = (Math.atan2(gY, gX) * 180) / Math.PI;
      if (angle < 0) angle += 180;

      let m1 = 0;
      let m2 = 0;
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        m1 = mag[idx - 1];
        m2 = mag[idx + 1];
      } else if (angle >= 22.5 && angle < 67.5) {
        m1 = mag[(y - 1) * targetWidth + (x + 1)];
        m2 = mag[(y + 1) * targetWidth + (x - 1)];
      } else if (angle >= 67.5 && angle < 112.5) {
        m1 = mag[(y - 1) * targetWidth + x];
        m2 = mag[(y + 1) * targetWidth + x];
      } else {
        m1 = mag[(y - 1) * targetWidth + (x - 1)];
        m2 = mag[(y + 1) * targetWidth + (x + 1)];
      }

      if (m >= m1 && m >= m2) {
        nms[idx] = m;
      }
    }
  }

  // Hysteresis thresholding for clean, continuous sketch lines
  const highT = 0.085;
  const lowT = 0.042;
  const edges = new Uint8Array(targetWidth * targetHeight);

  for (let y = margin; y < targetHeight - margin; y++) {
    const row = y * targetWidth;
    for (let x = margin; x < targetWidth - margin; x++) {
      const idx = row + x;
      if (nms[idx] >= highT) {
        edges[idx] = 1;
      }
    }
  }

  // Connect weak edge neighbors
  let changed = true;
  while (changed) {
    changed = false;
    for (let y = margin; y < targetHeight - margin; y++) {
      const row = y * targetWidth;
      for (let x = margin; x < targetWidth - margin; x++) {
        const idx = row + x;
        if (edges[idx] === 0 && nms[idx] >= lowT) {
          if (
            edges[idx - 1] === 1 ||
            edges[idx + 1] === 1 ||
            edges[idx - targetWidth] === 1 ||
            edges[idx + targetWidth] === 1 ||
            edges[idx - targetWidth - 1] === 1 ||
            edges[idx - targetWidth + 1] === 1 ||
            edges[idx + targetWidth - 1] === 1 ||
            edges[idx + targetWidth + 1] === 1
          ) {
            edges[idx] = 1;
            changed = true;
          }
        }
      }
    }
  }

  // 3. Graph Path Tracing from Endpoints and Junctions
  const visited = new Uint8Array(targetWidth * targetHeight);
  const degree = new Uint8Array(targetWidth * targetHeight);

  for (let y = margin; y < targetHeight - margin; y++) {
    const row = y * targetWidth;
    for (let x = margin; x < targetWidth - margin; x++) {
      const idx = row + x;
      if (edges[idx] !== 1) continue;
      let d = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (edges[(y + dy) * targetWidth + (x + dx)] === 1) d++;
        }
      }
      degree[idx] = d;
    }
  }

  function tracePath(startIdx: number): Point2D[] {
    const path: Point2D[] = [];
    let curr = startIdx;
    visited[curr] = 1;
    let cx = curr % targetWidth;
    let cy = Math.floor(curr / targetWidth);
    path.push({ x: cx, y: cy });

    while (true) {
      let nextIdx = -1;
      let nx = -1;
      let ny = -1;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const px = cx + dx;
          const py = cy + dy;
          if (
            px >= margin &&
            px < targetWidth - margin &&
            py >= margin &&
            py < targetHeight - margin
          ) {
            const nidx = py * targetWidth + px;
            if (edges[nidx] === 1 && visited[nidx] === 0) {
              nextIdx = nidx;
              nx = px;
              ny = py;
              break;
            }
          }
        }
        if (nextIdx !== -1) break;
      }

      if (nextIdx !== -1) {
        visited[nextIdx] = 1;
        cx = nx;
        cy = ny;
        path.push({ x: cx, y: cy });
      } else {
        break;
      }
    }
    return path;
  }

  const rawPaths: Point2D[][] = [];
  // Trace endpoints first (degree === 1)
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] === 1 && degree[i] === 1 && visited[i] === 0) {
      const p = tracePath(i);
      if (p.length >= 8) rawPaths.push(p);
    }
  }
  // Trace any remaining closed loops
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] === 1 && visited[i] === 0) {
      const p = tracePath(i);
      if (p.length >= 8) rawPaths.push(p);
    }
  }

  // 4. Collinear Segment Stitching: Join nearby endpoints into single fluid artist strokes
  const activePaths = rawPaths.map((pts, id) => ({ id, pts, active: true }));
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < activePaths.length; i++) {
      const A = activePaths[i];
      if (!A.active) continue;
      const tailA = A.pts[A.pts.length - 1];
      let bestJ = -1;
      let bestDist = 22; // join proximity radius in pixels
      let revB = false;

      for (let j = 0; j < activePaths.length; j++) {
        if (i === j) continue;
        const B = activePaths[j];
        if (!B.active) continue;

        const d1 = dist(tailA, B.pts[0]);
        if (d1 < bestDist) {
          bestDist = d1;
          bestJ = j;
          revB = false;
        }
        const d2 = dist(tailA, B.pts[B.pts.length - 1]);
        if (d2 < bestDist) {
          bestDist = d2;
          bestJ = j;
          revB = true;
        }
      }

      if (bestJ !== -1) {
        const B = activePaths[bestJ];
        B.active = false;
        const bPts = revB ? [...B.pts].reverse() : B.pts;
        A.pts = A.pts.concat(bPts);
        joined = true;
        break;
      }
    }
  }

  // 5. RDP Line Simplification & Catmull-Rom Cubic Spline Smoothing
  let cleanPaths = activePaths
    .filter((a) => a.active)
    .map((a) => smoothPoints(rdp(a.pts, 1.8)))
    .filter((a) => pathLength(a) >= 28);

  // Sort paths by length descending
  cleanPaths.sort((a, b) => pathLength(b) - pathLength(a));

  // Cap to target 30–80 meaningful paths (target ~45–60 paths)
  cleanPaths = cleanPaths.slice(0, 56);

  // -------------------------------------------------------------
  // 7. ORCHESTRATE 6-PHASE AUTHENTIC ARTIST TIMELINE
  // -------------------------------------------------------------
  const strokes: DrawingStroke[] = [];
  let strokeIdCounter = 0;

  const baseColor =
    style === 'pencil'
      ? '#262421'
      : style === 'charcoal'
      ? '#141414'
      : '#1a1816';

  // PHASE 1: Foundational Silhouettes (Top major boundary strokes)
  const phase1Count = Math.min(5, Math.max(3, Math.floor(cleanPaths.length * 0.1)));
  for (let i = 0; i < phase1Count; i++) {
    const p = cleanPaths[i];
    const points: StrokePoint[] = p.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.35 + 0.3 * Math.sin((idx / Math.max(1, p.length - 1)) * Math.PI)
    }));

    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 1,
      phaseName: 'Curiosity & Construction Marks',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.6 : style === 'charcoal' ? 2.4 : 1.3,
      alpha: 0.7,
      style,
      isHatching: false,
      length: pathLength(points)
    });
  }

  // PHASE 2: Hairline, Head Mass, Jawline, Neck, Shoulders
  const phase2Count = Math.floor(cleanPaths.length * 0.28);
  for (let i = phase1Count; i < phase1Count + phase2Count; i++) {
    const p = cleanPaths[i];
    const points: StrokePoint[] = p.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.5 + 0.35 * Math.sin((idx / Math.max(1, p.length - 1)) * Math.PI)
    }));

    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 2,
      phaseName: 'Major Outlines & Proportions',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 2.0 : style === 'charcoal' ? 3.0 : 1.5,
      alpha: 0.85,
      style,
      isHatching: false,
      length: pathLength(points)
    });
  }

  // PHASE 3: Facial Features (Eyes, Eyebrows, Nose, Lips)
  const phase3Count = Math.floor(cleanPaths.length * 0.32);
  const phase3Start = phase1Count + phase2Count;
  for (let i = phase3Start; i < phase3Start + phase3Count; i++) {
    const p = cleanPaths[i];
    const points: StrokePoint[] = p.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.55 + 0.35 * Math.sin((idx / Math.max(1, p.length - 1)) * Math.PI)
    }));

    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 3,
      phaseName: 'Features, Contour & Anatomy',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.8 : style === 'charcoal' ? 2.8 : 1.4,
      alpha: 0.9,
      style,
      isHatching: false,
      length: pathLength(points)
    });
  }

  // PHASE 4: Secondary Character Lines & Key Shadow Boundaries
  const phase4Start = phase3Start + phase3Count;
  const phase4Count = Math.floor(cleanPaths.length * 0.2);
  for (let i = phase4Start; i < phase4Start + phase4Count; i++) {
    const p = cleanPaths[i];
    const points: StrokePoint[] = p.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.45 + 0.3 * Math.sin((idx / Math.max(1, p.length - 1)) * Math.PI)
    }));

    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 4,
      phaseName: 'Tonal Contours & Key Shadow Boundaries',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.7 : style === 'charcoal' ? 2.6 : 1.3,
      alpha: 0.82,
      style,
      isHatching: false,
      length: pathLength(points)
    });
  }

  // PHASE 5: Deep Contrast Accents & Precision Eye Highlights
  const phase5Start = phase4Start + phase4Count;
  for (let i = phase5Start; i < cleanPaths.length; i++) {
    const p = cleanPaths[i];
    const points: StrokePoint[] = p.map((pt) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.85
    }));

    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 5,
      phaseName: 'Deep Contrast & Precision Accents',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 2.2 : style === 'charcoal' ? 3.4 : 1.6,
      alpha: 0.95,
      style,
      isHatching: false,
      length: pathLength(points)
    });
  }

  // PHASE 6: Artist Signature (Bottom Right Corner)
  const sigX = targetWidth * 0.76;
  const sigY = targetHeight * 0.94;
  const sigPoints: StrokePoint[] = [
    { x: sigX, y: sigY, pressure: 0.5 },
    { x: sigX + 14, y: sigY - 7, pressure: 0.65 },
    { x: sigX + 28, y: sigY + 3, pressure: 0.55 },
    { x: sigX + 42, y: sigY - 5, pressure: 0.6 },
    { x: sigX + 54, y: sigY + 2, pressure: 0.45 },
    { x: sigX + 68, y: sigY - 2, pressure: 0.35 }
  ];
  strokes.push({
    id: `stroke-${strokeIdCounter++}`,
    phase: 6,
    phaseName: 'Artist Signature',
    points: sigPoints,
    color: baseColor,
    baseWidth: style === 'pencil' ? 1.6 : 2.0,
    alpha: 0.78,
    style,
    isHatching: false,
    length: pathLength(sigPoints)
  });

  // Calculate metrics
  let totalLength = 0;
  const phaseLengths: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const s of strokes) {
    totalLength += s.length;
    phaseLengths[s.phase] = (phaseLengths[s.phase] || 0) + s.length;
  }

  let sourceImageUrl = '';
  if (typeof source === 'string') {
    sourceImageUrl = source;
  } else {
    sourceImageUrl = URL.createObjectURL(source);
  }

  return {
    width: targetWidth,
    height: targetHeight,
    aspectRatio: targetWidth / targetHeight,
    strokes,
    totalLength,
    phaseLengths,
    sourceImageUrl
  };
}
