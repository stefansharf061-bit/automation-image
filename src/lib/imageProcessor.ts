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

function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Compute tangent vector from stroke endpoint
function getTangent(pts: StrokePoint[], fromEnd = false, span = 4): { x: number; y: number } {
  if (pts.length < 2) return { x: 1, y: 0 };
  const n = pts.length;
  const pA = fromEnd ? pts[Math.max(0, n - span - 1)] : pts[0];
  const pB = fromEnd ? pts[n - 1] : pts[Math.min(n - 1, span)];
  const d = Math.hypot(pB.x - pA.x, pB.y - pA.y);
  return d === 0 ? { x: 1, y: 0 } : { x: (pB.x - pA.x) / d, y: (pB.y - pA.y) / d };
}

// Ramer-Douglas-Peucker line simplification
function rdp(points: StrokePoint[], epsilon: number): StrokePoint[] {
  if (points.length <= 2) return points;

  let dmax = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  const lineLen = dist(start, end);

  for (let i = 1; i < points.length - 1; i++) {
    const d = lineLen === 0 ? dist(points[i], start) :
      Math.abs(
        (end.y - start.y) * points[i].x -
        (end.x - start.x) * points[i].y +
        end.x * start.y -
        end.y * start.x
      ) / lineLen;
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const r1 = rdp(points.slice(0, index + 1), epsilon);
    const r2 = rdp(points.slice(index), epsilon);
    return r1.slice(0, r1.length - 1).concat(r2);
  }
  return [start, end];
}

// Catmull-Rom smoothing for organic human hand feel
function smoothPoints(points: StrokePoint[]): StrokePoint[] {
  if (points.length < 3) return points;
  const result: StrokePoint[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const segmentDist = dist(p1, p2);
    const steps = Math.max(1, Math.min(5, Math.floor(segmentDist / 4)));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
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

      const pressure = p1.pressure + (p2.pressure - p1.pressure) * t;
      result.push({ x, y, pressure });
    }
  }

  return result;
}

// Long-Path Chaining: connects compatible contour segments into continuous artist strokes
function chainContours(
  contours: { points: StrokePoint[]; avgMag: number }[],
  maxJoinDist = 28
): { points: StrokePoint[]; avgMag: number }[] {
  if (contours.length <= 1) return contours;

  const pool = [...contours];
  pool.sort((a, b) => b.points.length - a.points.length);
  const chained: { points: StrokePoint[]; avgMag: number }[] = [];

  while (pool.length > 0) {
    let current = pool.shift()!;
    let extended = true;

    while (extended) {
      extended = false;
      const tail = current.points[current.points.length - 1];
      const tailTan = getTangent(current.points, true, 4);

      let bestIdx = -1;
      let bestScore = -Infinity;
      let flip = false;

      for (let i = 0; i < pool.length; i++) {
        const cand = pool[i];
        const headPt = cand.points[0];
        const tailPt = cand.points[cand.points.length - 1];

        // Connection 1: tail -> cand.head
        const d1 = dist(tail, headPt);
        if (d1 < maxJoinDist) {
          const candTan = getTangent(cand.points, false, 4);
          const dot = tailTan.x * candTan.x + tailTan.y * candTan.y;
          const score = (maxJoinDist - d1) + dot * 12;
          if (dot > -0.25 && score > bestScore) {
            bestScore = score;
            bestIdx = i;
            flip = false;
          }
        }

        // Connection 2: tail -> cand.tail (reversed)
        const d2 = dist(tail, tailPt);
        if (d2 < maxJoinDist) {
          const candTanRev = getTangent(cand.points, true, 4);
          const dot = tailTan.x * (-candTanRev.x) + tailTan.y * (-candTanRev.y);
          const score = (maxJoinDist - d2) + dot * 12;
          if (dot > -0.25 && score > bestScore) {
            bestScore = score;
            bestIdx = i;
            flip = true;
          }
        }
      }

      if (bestIdx !== -1) {
        const next = pool.splice(bestIdx, 1)[0];
        const nextPts = flip ? next.points.reverse() : next.points;
        current.points.push(...nextPts);
        current.avgMag = (current.avgMag + next.avgMag) / 2;
        extended = true;
      }
    }

    chained.push(current);
  }

  return chained;
}

// Spatial sorting so the artist draws nearby features in logical sequence
function spatialSort<T extends { points: StrokePoint[] }>(items: T[]): T[] {
  if (items.length <= 1) return items;
  const sorted = [items[0]];
  const pool = items.slice(1);

  while (pool.length > 0) {
    const last = sorted[sorted.length - 1].points[sorted[sorted.length - 1].points.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < pool.length; i++) {
      const d = dist(last, pool[i].points[0]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    sorted.push(pool.splice(bestIdx, 1)[0]);
  }

  return sorted;
}

export function processImageToDrawing(
  image: HTMLImageElement,
  style: DrawingStyle = 'pencil',
  targetWidth = 720,
  targetHeight = 960
): DrawingData {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;

  const marginX = targetWidth * 0.08;
  const marginY = targetHeight * 0.08;
  const drawWidth = targetWidth - marginX * 2;
  const drawHeight = targetHeight - marginY * 2;

  const imgAspect = image.naturalWidth / image.naturalHeight;
  const boxAspect = drawWidth / drawHeight;
  let finalW = drawWidth;
  let finalH = drawHeight;
  let offsetX = marginX;
  let offsetY = marginY;

  if (imgAspect > boxAspect) {
    finalH = drawWidth / imgAspect;
    offsetY = marginY + (drawHeight - finalH) / 2;
  } else {
    finalW = drawHeight * imgAspect;
    offsetX = marginX + (drawWidth - finalW) / 2;
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(image, offsetX, offsetY, finalW, finalH);

  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imgData.data;

  // Grayscale buffer
  const gray = new Float32Array(targetWidth * targetHeight);
  for (let i = 0; i < data.length; i += 4) {
    gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // Gaussian 3x3 filter to eliminate sensor noise & micro-jitter
  const blurred = new Float32Array(targetWidth * targetHeight);
  for (let y = 1; y < targetHeight - 1; y++) {
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = y * targetWidth + x;
      blurred[idx] =
        (gray[idx - targetWidth - 1] * 1 + gray[idx - targetWidth] * 2 + gray[idx - targetWidth + 1] * 1 +
          gray[idx - 1] * 2 + gray[idx] * 4 + gray[idx + 1] * 2 +
          gray[idx + targetWidth - 1] * 1 + gray[idx + targetWidth] * 2 + gray[idx + targetWidth + 1] * 1) /
        16;
    }
  }

  // Sobel Edge Detection
  const gradMag = new Float32Array(targetWidth * targetHeight);
  const gradDir = new Float32Array(targetWidth * targetHeight);

  for (let y = 1; y < targetHeight - 1; y++) {
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = y * targetWidth + x;
      const gx =
        -1 * blurred[idx - targetWidth - 1] + 1 * blurred[idx - targetWidth + 1] +
        -2 * blurred[idx - 1] + 2 * blurred[idx + 1] +
        -1 * blurred[idx + targetWidth - 1] + 1 * blurred[idx + targetWidth + 1];

      const gy =
        -1 * blurred[idx - targetWidth - 1] - 2 * blurred[idx - targetWidth] - 1 * blurred[idx - targetWidth + 1] +
         1 * blurred[idx + targetWidth - 1] + 2 * blurred[idx + targetWidth] + 1 * blurred[idx + targetWidth + 1];

      gradMag[idx] = Math.hypot(gx, gy);
      gradDir[idx] = Math.atan2(gy, gx);
    }
  }

  // Contour ridge tracing with selective thresholds
  const visited = new Uint8Array(targetWidth * targetHeight);
  const rawContours: { points: StrokePoint[]; avgMag: number }[] = [];

  const strongThreshold = 44;
  const weakThreshold = 22;

  for (let y = Math.floor(offsetY); y < offsetY + finalH; y += 3) {
    for (let x = Math.floor(offsetX); x < offsetX + finalW; x += 3) {
      const idx = y * targetWidth + x;
      if (visited[idx] === 0 && gradMag[idx] > strongThreshold) {
        const points: StrokePoint[] = [];
        let cx = x;
        let cy = y;
        let totalMag = 0;

        while (
          cx >= 1 &&
          cx < targetWidth - 1 &&
          cy >= 1 &&
          cy < targetHeight - 1 &&
          points.length < 550
        ) {
          const cidx = cy * targetWidth + cx;
          if (visited[cidx] === 1 || gradMag[cidx] < weakThreshold) break;

          visited[cidx] = 1;
          totalMag += gradMag[cidx];

          const pressure = Math.min(1.0, Math.max(0.35, 0.35 + gradMag[cidx] / 150));
          points.push({ x: cx, y: cy, pressure });

          const angle = gradDir[cidx] + Math.PI / 2;
          const nx = Math.round(cx + Math.cos(angle) * 3);
          const ny = Math.round(cy + Math.sin(angle) * 3);

          let best = { x: nx, y: ny, mag: -1 };
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (dx === 0 && dy === 0) continue;
              const tx = cx + dx;
              const ty = cy + dy;
              if (tx >= 1 && tx < targetWidth - 1 && ty >= 1 && ty < targetHeight - 1) {
                const tidx = ty * targetWidth + tx;
                if (visited[tidx] === 0 && gradMag[tidx] > best.mag) {
                  best = { x: tx, y: ty, mag: gradMag[tidx] };
                }
              }
            }
          }

          if (best.mag > weakThreshold) {
            cx = best.x;
            cy = best.y;
          } else {
            break;
          }
        }

        if (points.length >= 10) {
          rawContours.push({
            points,
            avgMag: totalMag / points.length
          });
        }
      }
    }
  }

  // Chain adjacent contours into continuous, flowing artist paths
  const chainedContours = chainContours(rawContours, 28);

  // Simplify and smooth chained contours
  const smoothedContours = chainedContours
    .filter(c => c.points.length >= 12)
    .map(c => {
      const pts = smoothPoints(rdp(c.points, 1.8));
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
      return { points: pts, avgMag: c.avgMag, length: len };
    })
    .filter(c => c.length >= 25);

  smoothedContours.sort((a, b) => b.length - a.length);

  // Major structural contours (Phase 2: jaw, silhouette, hair boundaries, shoulder)
  const majorCount = Math.min(26, Math.max(12, Math.round(smoothedContours.length * 0.25)));
  const majorContours = smoothedContours.slice(0, majorCount);

  // Detail feature contours (Phase 3: facial features, inner hair, clothing details)
  const detailBudget = Math.min(55, Math.max(25, Math.round(smoothedContours.length * 0.55)));
  const detailContours = smoothedContours.slice(majorCount, majorCount + detailBudget);

  // Spatially sort contours so the hand works through connected areas logically
  const sortedMajor = spatialSort(majorContours);
  const sortedDetails = spatialSort(detailContours);

  // Grouped Shading Gestures (Phase 4 & Phase 5)
  // Instead of isolated dashes, create continuous rhythmic zigzag passes (5-12 per region)
  const bandHeight = 36;
  const midtoneShadingStrokes: { points: StrokePoint[]; darkness: number; length: number }[] = [];
  const deepAccentStrokes: { points: StrokePoint[]; darkness: number; length: number }[] = [];

  for (let y0 = Math.floor(offsetY); y0 < offsetY + finalH; y0 += bandHeight) {
    const rowDark: { x: number; lum: number }[] = [];
    for (let x = Math.floor(offsetX); x < offsetX + finalW; x += 6) {
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y0 + bandHeight && y < targetHeight; y += 4) {
        sum += gray[y * targetWidth + x];
        count++;
      }
      const avg = sum / count;
      if (avg < 140) {
        rowDark.push({ x, lum: avg });
      }
    }

    if (rowDark.length >= 5) {
      // Group contiguous shadow runs
      const runs: { x: number; lum: number }[][] = [];
      let currentRun = [rowDark[0]];

      for (let i = 1; i < rowDark.length; i++) {
        if (rowDark[i].x - rowDark[i - 1].x <= 20) {
          currentRun.push(rowDark[i]);
        } else {
          if (currentRun.length >= 5) runs.push(currentRun);
          currentRun = [rowDark[i]];
        }
      }
      if (currentRun.length >= 5) runs.push(currentRun);

      for (const run of runs) {
        const xMin = run[0].x;
        const xMax = run[run.length - 1].x;
        const avgLum = run.reduce((acc, p) => acc + p.lum, 0) / run.length;
        const darkness = (145 - avgLum) / 145;

        // Long rhythmic zigzag pass across this shadow area
        const stepX = Math.max(8, Math.min(16, (xMax - xMin) / 8));
        const pts: StrokePoint[] = [];
        let goingUp = true;

        for (let x = xMin; x <= xMax; x += stepX) {
          const yOffset = goingUp ? -bandHeight * 0.38 : bandHeight * 0.38;
          const yCenter = y0 + bandHeight * 0.5;
          pts.push({
            x,
            y: yCenter + yOffset,
            pressure: Math.min(0.85, 0.4 + darkness * 0.45)
          });
          goingUp = !goingUp;
        }

        if (pts.length >= 4) {
          const smoothedPts = smoothPoints(pts);
          let len = 0;
          for (let i = 1; i < smoothedPts.length; i++) len += dist(smoothedPts[i - 1], smoothedPts[i]);
          midtoneShadingStrokes.push({
            points: smoothedPts,
            darkness,
            length: len
          });
        }

        // For deepest shadow areas (lum < 75), add a rhythmic cross-shading accent gesture
        if (avgLum < 75 && pts.length >= 5) {
          const crossPts: StrokePoint[] = [];
          let up = false;
          for (let x = xMin + stepX * 0.5; x <= xMax; x += stepX * 1.3) {
            const yOffset = up ? -bandHeight * 0.32 : bandHeight * 0.32;
            const yCenter = y0 + bandHeight * 0.5;
            crossPts.push({
              x,
              y: yCenter + yOffset,
              pressure: 0.8
            });
            up = !up;
          }
          if (crossPts.length >= 4) {
            const smoothedCross = smoothPoints(crossPts);
            let len = 0;
            for (let i = 1; i < smoothedCross.length; i++) len += dist(smoothedCross[i - 1], smoothedCross[i]);
            deepAccentStrokes.push({
              points: smoothedCross,
              darkness: 0.9,
              length: len
            });
          }
        }
      }
    }
  }

  // Phase 1: Deliberate Construction Gestures (4-8 strokes)
  const constructionStrokes: { points: StrokePoint[]; length: number }[] = [];
  const centerX = offsetX + finalW / 2;
  const centerY = offsetY + finalH / 2;

  // 1. Head/Subject Gesture Oval (flowing single ellipse loop)
  const ovalPoints: StrokePoint[] = [];
  for (let a = -Math.PI; a <= Math.PI + 0.1; a += Math.PI / 12) {
    const rx = finalW * 0.36 * (1 + Math.sin(a * 2) * 0.03);
    const ry = finalH * 0.42 * (1 + Math.cos(a * 2) * 0.03);
    ovalPoints.push({
      x: centerX + Math.cos(a) * rx,
      y: centerY + Math.sin(a) * ry,
      pressure: 0.22
    });
  }
  const smoothedOval = smoothPoints(ovalPoints);
  let ovalLen = 0;
  for (let i = 1; i < smoothedOval.length; i++) ovalLen += dist(smoothedOval[i - 1], smoothedOval[i]);
  constructionStrokes.push({ points: smoothedOval, length: ovalLen });

  // 2. Vertical Line of Symmetry (central facial axis)
  const vertPts: StrokePoint[] = [
    { x: centerX, y: offsetY + finalH * 0.07, pressure: 0.18 },
    { x: centerX, y: offsetY + finalH * 0.91, pressure: 0.22 }
  ];
  constructionStrokes.push({ points: vertPts, length: dist(vertPts[0], vertPts[1]) });

  // 3. Horizontal Eyeline Guide
  const eyeLinePts: StrokePoint[] = [
    { x: offsetX + finalW * 0.14, y: centerY - finalH * 0.07, pressure: 0.18 },
    { x: offsetX + finalW * 0.86, y: centerY - finalH * 0.06, pressure: 0.22 }
  ];
  constructionStrokes.push({ points: eyeLinePts, length: dist(eyeLinePts[0], eyeLinePts[1]) });

  // 4. Nose Base / Brow Alignment Marker
  const noseLinePts: StrokePoint[] = [
    { x: centerX - finalW * 0.18, y: centerY + finalH * 0.09, pressure: 0.17 },
    { x: centerX + finalW * 0.18, y: centerY + finalH * 0.095, pressure: 0.2 }
  ];
  constructionStrokes.push({ points: noseLinePts, length: dist(noseLinePts[0], noseLinePts[1]) });

  // 5. Chin & Jaw Alignment Gesture
  const chinPts: StrokePoint[] = [
    { x: centerX - finalW * 0.22, y: centerY + finalH * 0.25, pressure: 0.2 },
    { x: centerX, y: centerY + finalH * 0.32, pressure: 0.24 },
    { x: centerX + finalW * 0.22, y: centerY + finalH * 0.25, pressure: 0.2 }
  ];
  const smoothedChin = smoothPoints(chinPts);
  let chinLen = 0;
  for (let i = 1; i < smoothedChin.length; i++) chinLen += dist(smoothedChin[i - 1], smoothedChin[i]);
  constructionStrokes.push({ points: smoothedChin, length: chinLen });

  // Style configs
  const styleConfig = {
    pencil: { color: '#272624', baseWidth: 1.6, alpha: 0.82 },
    charcoal: { color: '#161514', baseWidth: 2.5, alpha: 0.92 },
    fineliner: { color: '#0a0a09', baseWidth: 1.25, alpha: 0.95 }
  }[style];

  const strokes: DrawingStroke[] = [];
  let strokeId = 0;

  // Phase 1: Construction (0-5s)
  for (const cs of constructionStrokes) {
    strokes.push({
      id: `stroke-${strokeId++}`,
      phase: 1,
      phaseName: 'Construction Marks',
      points: cs.points,
      color: '#8e8b86',
      baseWidth: 1.0,
      alpha: 0.28,
      style,
      length: cs.length
    });
  }

  // Phase 2: Major Outlines (5-20s)
  for (const c of sortedMajor) {
    strokes.push({
      id: `stroke-${strokeId++}`,
      phase: 2,
      phaseName: 'Major Outlines',
      points: c.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * 1.25,
      alpha: styleConfig.alpha,
      style,
      length: c.length
    });
  }

  // Phase 3: Details & Features (20-40s)
  for (const c of sortedDetails) {
    strokes.push({
      id: `stroke-${strokeId++}`,
      phase: 3,
      phaseName: 'Features & Form',
      points: c.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * 0.95,
      alpha: styleConfig.alpha * 0.88,
      style,
      length: c.length
    });
  }

  // Phase 4: Midtone Shading (40-53s)
  for (const s of midtoneShadingStrokes) {
    strokes.push({
      id: `stroke-${strokeId++}`,
      phase: 4,
      phaseName: 'Shading & Tones',
      points: s.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * (0.8 + s.darkness * 0.45),
      alpha: styleConfig.alpha * (0.45 + s.darkness * 0.4),
      style,
      isHatching: true,
      length: s.length
    });
  }

  // Phase 5: Deep Cross-hatching & Accents (53-58s)
  for (const s of deepAccentStrokes) {
    strokes.push({
      id: `stroke-${strokeId++}`,
      phase: 5,
      phaseName: 'Deep Contrast & Accents',
      points: s.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * 1.35,
      alpha: styleConfig.alpha,
      style,
      isHatching: true,
      length: s.length
    });
  }

  // Phase 6: Artist Signature (58-60s)
  const sigX = offsetX + finalW * 0.82;
  const sigY = offsetY + finalH * 0.94;
  const sigPoints: StrokePoint[] = [
    { x: sigX, y: sigY, pressure: 0.6 },
    { x: sigX + 10, y: sigY - 6, pressure: 0.85 },
    { x: sigX + 18, y: sigY + 4, pressure: 0.5 },
    { x: sigX + 26, y: sigY - 4, pressure: 0.9 },
    { x: sigX + 36, y: sigY + 6, pressure: 0.45 }
  ];
  const smoothedSig = smoothPoints(sigPoints);
  let sigLen = 0;
  for (let i = 1; i < smoothedSig.length; i++) sigLen += dist(smoothedSig[i - 1], smoothedSig[i]);

  strokes.push({
    id: `stroke-${strokeId++}`,
    phase: 6,
    phaseName: 'Artist Signature',
    points: smoothedSig,
    color: styleConfig.color,
    baseWidth: styleConfig.baseWidth * 1.15,
    alpha: styleConfig.alpha * 0.92,
    style,
    length: sigLen
  });

  let totalLength = 0;
  const phaseLengths: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  for (const s of strokes) {
    totalLength += s.length;
    phaseLengths[s.phase] = (phaseLengths[s.phase] || 0) + s.length;
  }

  return {
    width: targetWidth,
    height: targetHeight,
    aspectRatio: targetWidth / targetHeight,
    strokes,
    totalLength,
    phaseLengths,
    sourceImageUrl: image.src
  };
}
