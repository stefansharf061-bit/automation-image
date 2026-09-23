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
// GEOMETRIC & CURVE SMOOTHING UTILITIES
// -------------------------------------------------------------

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/**
 * Ramer-Douglas-Peucker line simplification algorithm
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

    // Subdivide into 3 micro-segments
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

/**
 * Compute total arc length of a sequence of points
 */
function computePathLength(pts: StrokePoint[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

/**
 * Separable 1D Gaussian blur for image luminance
 */
function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const dst = new Float32Array(w * h);
  const tmp = new Float32Array(w * h);
  const kRadius = Math.ceil(sigma * 2.5);
  const kernel: number[] = [];
  let kSum = 0;

  for (let i = -kRadius; i <= kRadius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    kSum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  // Horizontal blur pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -kRadius; k <= kRadius; k++) {
        const px = Math.min(w - 1, Math.max(0, x + k));
        sum += src[row + px] * kernel[k + kRadius];
      }
      tmp[row + x] = sum;
    }
  }

  // Vertical blur pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -kRadius; k <= kRadius; k++) {
        const py = Math.min(h - 1, Math.max(0, y + k));
        sum += tmp[py * w + x] * kernel[k + kRadius];
      }
      dst[y * w + x] = sum;
    }
  }

  return dst;
}

// -------------------------------------------------------------
// MAIN PORTRAIT SKETCH GENERATION PIPELINE
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

  // 1. Grayscale luminance extraction
  const gray = new Float32Array(targetWidth * targetHeight);
  for (let i = 0; i < pixels.length; i += 4) {
    gray[i / 4] = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }

  // 2. Pre-smoothing: eliminate photographic grain, sensor noise, and micro skin pores
  // while preserving primary facial contours (eyes, lips, jawline, hair silhouette)
  const smoothed = gaussianBlur(gray, targetWidth, targetHeight, 1.8);

  // 3. Sobel gradient magnitude & direction
  const mag = new Float32Array(targetWidth * targetHeight);
  const dir = new Float32Array(targetWidth * targetHeight);

  for (let y = 1; y < targetHeight - 1; y++) {
    const row = y * targetWidth;
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = row + x;
      const gx =
        -1 * smoothed[idx - targetWidth - 1] +
        1 * smoothed[idx - targetWidth + 1] +
        -2 * smoothed[idx - 1] +
        2 * smoothed[idx + 1] +
        -1 * smoothed[idx + targetWidth - 1] +
        1 * smoothed[idx + targetWidth + 1];
      const gy =
        -1 * smoothed[idx - targetWidth - 1] -
        2 * smoothed[idx - targetWidth] -
        1 * smoothed[idx - targetWidth + 1] +
        1 * smoothed[idx + targetWidth - 1] +
        2 * smoothed[idx + targetWidth] +
        1 * smoothed[idx + targetWidth + 1];

      mag[idx] = Math.hypot(gx, gy);
      dir[idx] = Math.atan2(gy, gx);
    }
  }

  // 4. Non-Maximum Suppression (NMS) for crisp 1-pixel ridges
  const nms = new Float32Array(targetWidth * targetHeight);
  for (let y = 2; y < targetHeight - 2; y++) {
    const row = y * targetWidth;
    for (let x = 2; x < targetWidth - 2; x++) {
      const idx = row + x;
      const m = mag[idx];
      if (m < 14) continue;

      let angle = dir[idx] * (180 / Math.PI);
      if (angle < 0) angle += 180;

      let m1 = 0;
      let m2 = 0;
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        m1 = mag[idx - 1];
        m2 = mag[idx + 1];
      } else if (angle >= 22.5 && angle < 67.5) {
        m1 = mag[idx - targetWidth + 1];
        m2 = mag[idx + targetWidth - 1];
      } else if (angle >= 67.5 && angle < 112.5) {
        m1 = mag[idx - targetWidth];
        m2 = mag[idx + targetWidth];
      } else {
        m1 = mag[idx - targetWidth - 1];
        m2 = mag[idx + targetWidth + 1];
      }

      if (m >= m1 && m >= m2) {
        nms[idx] = m;
      }
    }
  }

  // 5. Dual-Threshold Hysteresis for clear portrait contours
  const highThreshold = 26;
  const lowThreshold = 13;
  const edgeType = new Uint8Array(targetWidth * targetHeight);
  for (let i = 0; i < nms.length; i++) {
    if (nms[i] >= highThreshold) edgeType[i] = 2;
    else if (nms[i] >= lowThreshold) edgeType[i] = 1;
  }

  const edgeFinal = new Uint8Array(targetWidth * targetHeight);
  const queue: number[] = [];
  for (let y = 1; y < targetHeight - 1; y++) {
    const row = y * targetWidth;
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = row + x;
      if (edgeType[idx] === 2) {
        edgeFinal[idx] = 1;
        queue.push(idx);
      }
    }
  }

  const dxy = [
    -targetWidth - 1,
    -targetWidth,
    -targetWidth + 1,
    -1,
    1,
    targetWidth - 1,
    targetWidth,
    targetWidth + 1
  ];
  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    for (let d = 0; d < 8; d++) {
      const n = curr + dxy[d];
      if (n >= 0 && n < edgeType.length && edgeType[n] === 1 && edgeFinal[n] === 0) {
        edgeFinal[n] = 1;
        queue.push(n);
      }
    }
  }

  // 6. Bidirectional ridge tracking starting from dominant seeds
  const visited = new Uint8Array(targetWidth * targetHeight);
  const seeds: { idx: number; mag: number }[] = [];
  for (let i = 0; i < edgeFinal.length; i++) {
    if (edgeFinal[i] === 1) seeds.push({ idx: i, mag: mag[i] });
  }
  seeds.sort((a, b) => b.mag - a.mag);

  const rawChains: Point2D[][] = [];
  for (const seed of seeds) {
    if (visited[seed.idx] === 1) continue;
    const sy = Math.floor(seed.idx / targetWidth);
    const sx = seed.idx % targetWidth;
    visited[seed.idx] = 1;

    const track = (startX: number, startY: number): Point2D[] => {
      const pts: Point2D[] = [];
      let cx = startX;
      let cy = startY;
      while (true) {
        let bestNx = -1;
        let bestNy = -1;
        let bestMag = -1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 2 && nx < targetWidth - 2 && ny >= 2 && ny < targetHeight - 2) {
              const nidx = ny * targetWidth + nx;
              if (edgeFinal[nidx] === 1 && visited[nidx] === 0) {
                if (mag[nidx] > bestMag) {
                  bestMag = mag[nidx];
                  bestNx = nx;
                  bestNy = ny;
                }
              }
            }
          }
        }
        if (bestNx !== -1) {
          const nidx = bestNy * targetWidth + bestNx;
          visited[nidx] = 1;
          cx = bestNx;
          cy = bestNy;
          pts.push({ x: cx, y: cy });
        } else {
          break;
        }
      }
      return pts;
    };

    const branch1 = track(sx, sy);
    const branch2 = track(sx, sy);
    branch2.reverse();
    const full = branch2.concat([{ x: sx, y: sy }], branch1);
    if (full.length >= 14) {
      rawChains.push(full);
    }
  }

  // 7. Collinear endpoint consolidation (join broken jawline, eyebrow, lip, and eye segments)
  const activeChains = rawChains.map((pts, i) => ({ id: i, points: pts, active: true }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < activeChains.length; i++) {
      const A = activeChains[i];
      if (!A.active) continue;
      const tailA = A.points[A.points.length - 1];
      let bestJ = -1;
      let bestDist = 22;
      let reverseB = false;

      for (let j = 0; j < activeChains.length; j++) {
        if (i === j) continue;
        const B = activeChains[j];
        if (!B.active) continue;

        const d1 = dist(tailA, B.points[0]);
        if (d1 < bestDist) {
          bestDist = d1;
          bestJ = j;
          reverseB = false;
        }
        const d2 = dist(tailA, B.points[B.points.length - 1]);
        if (d2 < bestDist) {
          bestDist = d2;
          bestJ = j;
          reverseB = true;
        }
      }

      if (bestJ !== -1) {
        const B = activeChains[bestJ];
        B.active = false;
        const bPts = reverseB ? [...B.points].reverse() : B.points;
        A.points = A.points.concat(bPts);
        merged = true;
        break;
      }
    }
  }

  const mergedChains = activeChains
    .filter((c) => c.active && c.points.length >= 16)
    .map((c) => c.points);

  // 8. Intentional Form Shading: Identify 3 to 4 major anatomical shadow regions
  // (e.g. neck/under-chin shadow, eye sockets, hair shadow mass, cheek shadow)
  const shadowMask = new Uint8Array(targetWidth * targetHeight);
  const shadowBlur = gaussianBlur(gray, targetWidth, targetHeight, 4.0);
  for (let i = 0; i < shadowBlur.length; i++) {
    if (shadowBlur[i] < 95) shadowMask[i] = 1;
  }

  const shadowVisited = new Uint8Array(targetWidth * targetHeight);
  interface ShadowRegion {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    count: number;
  }
  const shadowRegions: ShadowRegion[] = [];

  for (let y = 10; y < targetHeight - 10; y += 4) {
    for (let x = 10; x < targetWidth - 10; x += 4) {
      const idx = y * targetWidth + x;
      if (shadowMask[idx] === 1 && shadowVisited[idx] === 0) {
        const q = [idx];
        shadowVisited[idx] = 1;
        let count = 0;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;

        while (q.length > 0 && count < 5000) {
          const curr = q.pop()!;
          count++;
          const cy = Math.floor(curr / targetWidth);
          const cx = curr % targetWidth;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          for (const [dx, dy] of [
            [-4, 0],
            [4, 0],
            [0, -4],
            [0, 4]
          ]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx >= 0 && nx < targetWidth && ny >= 0 && ny < targetHeight) {
              const nidx = ny * targetWidth + nx;
              if (shadowMask[nidx] === 1 && shadowVisited[nidx] === 0) {
                shadowVisited[nidx] = 1;
                q.push(nidx);
              }
            }
          }
        }

        if (count >= 400 && maxX - minX > 40 && maxY - minY > 30) {
          shadowRegions.push({ minX, maxX, minY, maxY, count });
        }
      }
    }
  }

  shadowRegions.sort((a, b) => b.count - a.count);
  const topShadows = shadowRegions.slice(0, 4); // Limit to top 4 major shadow masses only

  // Create 3 to 5 parallel rhythmic artist shading strokes per shadow mass (-35° angle)
  const intentionalShadingChains: Point2D[][] = [];
  const hatchAngle = -35 * (Math.PI / 180);
  const cosH = Math.cos(hatchAngle);
  const sinH = Math.sin(hatchAngle);
  const perpX = -sinH;
  const perpY = cosH;

  for (const reg of topShadows) {
    const cx = (reg.minX + reg.maxX) / 2;
    const cy = (reg.minY + reg.maxY) / 2;
    const span = Math.max(reg.maxX - reg.minX, reg.maxY - reg.minY);
    const strokeCount = Math.min(5, Math.max(3, Math.floor(span / 32)));
    const spacing = 16;
    const half = (strokeCount - 1) * spacing * 0.5;

    for (let s = 0; s < strokeCount; s++) {
      const offset = -half + s * spacing;
      const lineCenter = { x: cx + perpX * offset, y: cy + perpY * offset };
      const halfLen = span * 0.42;
      const p1 = { x: lineCenter.x - cosH * halfLen, y: lineCenter.y - sinH * halfLen };
      const p2 = { x: lineCenter.x + cosH * halfLen, y: lineCenter.y + sinH * halfLen };

      const strokePts: Point2D[] = [];
      for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const px = Math.round(p1.x + (p2.x - p1.x) * t);
        const py = Math.round(p1.y + (p2.y - p1.y) * t);
        if (px >= 0 && px < targetWidth && py >= 0 && py < targetHeight) {
          strokePts.push({ x: px, y: py });
        }
      }
      if (strokePts.length >= 4) {
        intentionalShadingChains.push(strokePts);
      }
    }
  }

  // 9. Process and classify strokes into the 6 authentic drawing phases
  // Simplify and smooth all contour lines
  const simplifiedContours = mergedChains.map((c) => smoothPoints(rdp(c, 1.6)));
  // Sort contours by anatomical importance: outer boundary / length
  simplifiedContours.sort((a, b) => b.length - a.length);

  const strokes: DrawingStroke[] = [];
  let strokeIdCounter = 0;

  // Color & alpha setup
  const baseColor =
    style === 'pencil' ? '#252220' : style === 'charcoal' ? '#141210' : '#080808';

  // PHASE 1: Primary Structural Anchors & Silhouette (5 to 7 longest foundational strokes)
  const phase1Count = Math.min(6, Math.max(4, Math.floor(simplifiedContours.length * 0.1)));
  for (let i = 0; i < phase1Count; i++) {
    const raw = simplifiedContours[i];
    const points: StrokePoint[] = raw.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.38 + 0.15 * Math.sin((idx / raw.length) * Math.PI)
    }));
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 1,
      phaseName: 'Foundation & Silhouette Anchors',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.4 : style === 'charcoal' ? 2.2 : 1.2,
      alpha: 0.55,
      style,
      isHatching: false,
      length: computePathLength(points)
    });
  }

  // PHASE 2: Head, Hairline & Outer Contours (Next ~20-25 strokes)
  const phase2Count = Math.min(
    22,
    Math.max(12, Math.floor((simplifiedContours.length - phase1Count) * 0.4))
  );
  for (let i = phase1Count; i < phase1Count + phase2Count && i < simplifiedContours.length; i++) {
    const raw = simplifiedContours[i];
    const points: StrokePoint[] = raw.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.45 + 0.2 * Math.sin((idx / raw.length) * Math.PI)
    }));
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 2,
      phaseName: 'Head Structure & Silhouette Contours',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.6 : style === 'charcoal' ? 2.6 : 1.3,
      alpha: 0.72,
      style,
      isHatching: false,
      length: computePathLength(points)
    });
  }

  // PHASE 3: Expressive Facial Features (Eyes, Brows, Nose, Lips, Ears) (Remaining contours)
  const remainingContours = simplifiedContours.slice(phase1Count + phase2Count);
  // Sort spatially from eyes (top) down to mouth/chin for natural artist execution
  remainingContours.sort((a, b) => {
    const cyA = a.reduce((sum, p) => sum + p.y, 0) / a.length;
    const cyB = b.reduce((sum, p) => sum + p.y, 0) / b.length;
    return cyA - cyB;
  });

  for (const raw of remainingContours) {
    const points: StrokePoint[] = raw.map((pt, idx) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.55 + 0.25 * Math.sin((idx / raw.length) * Math.PI)
    }));
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 3,
      phaseName: 'Facial Features & Definition',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.8 : style === 'charcoal' ? 2.8 : 1.4,
      alpha: 0.85,
      style,
      isHatching: false,
      length: computePathLength(points)
    });
  }

  // PHASE 4: Intentional Form Shading (Clean rhythmic parallel gestures)
  for (const raw of intentionalShadingChains) {
    const points: StrokePoint[] = raw.map((pt) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.42
    }));
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 4,
      phaseName: 'Intentional Form Shading',
      points,
      color: baseColor,
      baseWidth: style === 'pencil' ? 1.2 : style === 'charcoal' ? 2.0 : 1.0,
      alpha: 0.48,
      style,
      isHatching: true,
      length: computePathLength(points)
    });
  }

  // PHASE 5: Deep Contrast Accents & Precision Highlights
  // Select 6-8 sharpest facial accents (deep eye pupil centers, lip parting crease, deep nostrils)
  const accentCount = Math.min(8, Math.max(4, Math.floor(remainingContours.length * 0.25)));
  for (let i = 0; i < accentCount; i++) {
    const srcContour = remainingContours[i % remainingContours.length];
    if (!srcContour || srcContour.length < 4) continue;
    // Extract a focused focal segment
    const startIdx = Math.floor(srcContour.length * 0.25);
    const endIdx = Math.floor(srcContour.length * 0.75);
    const accentPts = srcContour.slice(startIdx, endIdx);
    if (accentPts.length < 3) continue;

    const points: StrokePoint[] = accentPts.map((pt) => ({
      x: pt.x,
      y: pt.y,
      pressure: 0.88
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
      length: computePathLength(points)
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
    baseWidth: style === 'pencil' ? 1.5 : 2.0,
    alpha: 0.75,
    style,
    isHatching: false,
    length: computePathLength(sigPoints)
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
