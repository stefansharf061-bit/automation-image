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

// Compute normalized tangent vector from stroke endpoint
function getTangent(pts: StrokePoint[], fromEnd = false, span = 3): { x: number; y: number } {
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
    const d =
      lineLen === 0
        ? dist(points[i], start)
        : Math.abs(
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

// Spatial sorting so the artist draws nearby features in logical anatomical sequence
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

// ============================================================================
// STROKE CONSOLIDATION LAYER
// ============================================================================
// Groups detected raw edge fragments into coherent, continuous artist-like paths.
// Eliminates micro-fragmentation, bridges low-contrast highlight gaps, and applies
// curvature-preserving smoothing and pressure modeling.
// ============================================================================

interface Fragment {
  points: StrokePoint[];
  avgMag: number;
  length: number;
  active: boolean;
}

interface ConsolidatedPath {
  points: StrokePoint[];
  avgMag: number;
  length: number;
}

function consolidateContours(
  rawFragments: { points: StrokePoint[]; avgMag: number }[],
  minStrokeLength = 22
): ConsolidatedPath[] {
  if (rawFragments.length === 0) return [];

  const pool: Fragment[] = rawFragments.map((f) => {
    let len = 0;
    for (let i = 1; i < f.points.length; i++) len += dist(f.points[i - 1], f.points[i]);
    return { points: [...f.points], avgMag: f.avgMag, length: len, active: true };
  });

  // 3-tier progressive continuity chaining passes:
  // Pass 1: High-confidence collinear adjacent connections
  // Pass 2: Curvature-preserving gap bridging across light highlights / low contrast
  // Pass 3: Broader proximity and contour continuation
  const passes = [
    { maxDist: 20, minCos: 0.6, minGapAlign: 0.45 },
    { maxDist: 34, minCos: 0.35, minGapAlign: 0.3 },
    { maxDist: 48, minCos: 0.15, minGapAlign: 0.15 }
  ];

  for (const pass of passes) {
    let merged = true;
    while (merged) {
      merged = false;
      // Prioritize extending longer, more established structural lines first
      pool.sort((a, b) => b.length - a.length);

      for (let i = 0; i < pool.length; i++) {
        const A = pool[i];
        if (!A || !A.active) continue;

        const tailA = A.points[A.points.length - 1];
        const tanA = getTangent(A.points, true, 4);

        let bestJ = -1;
        let bestScore = -Infinity;
        let bestReverse = false;

        for (let j = 0; j < pool.length; j++) {
          if (i === j || !pool[j].active) continue;
          const B = pool[j];

          // Connection Option 1: A.tail -> B.head
          const headB = B.points[0];
          const d1 = dist(tailA, headB);
          if (d1 <= pass.maxDist) {
            const tanB = getTangent(B.points, false, 4);
            const cosTheta = tanA.x * tanB.x + tanA.y * tanB.y;
            const gapDir = d1 > 0.01 ? { x: (headB.x - tailA.x) / d1, y: (headB.y - tailA.y) / d1 } : tanA;
            const gapAlign = tanA.x * gapDir.x + tanA.y * gapDir.y;

            if (cosTheta >= pass.minCos && (d1 < 5 || gapAlign >= pass.minGapAlign)) {
              const score = (pass.maxDist - d1) * 1.5 + (cosTheta + 1) * 15 + gapAlign * 10;
              if (score > bestScore) {
                bestScore = score;
                bestJ = j;
                bestReverse = false;
              }
            }
          }

          // Connection Option 2: A.tail -> B.tail (reverse B)
          const tailB = B.points[B.points.length - 1];
          const d2 = dist(tailA, tailB);
          if (d2 <= pass.maxDist) {
            const tanB = getTangent(B.points, true, 4);
            const cosTheta = tanA.x * -tanB.x + tanA.y * -tanB.y;
            const gapDir = d2 > 0.01 ? { x: (tailB.x - tailA.x) / d2, y: (tailB.y - tailA.y) / d2 } : tanA;
            const gapAlign = tanA.x * gapDir.x + tanA.y * gapDir.y;

            if (cosTheta >= pass.minCos && (d2 < 5 || gapAlign >= pass.minGapAlign)) {
              const score = (pass.maxDist - d2) * 1.5 + (cosTheta + 1) * 15 + gapAlign * 10;
              if (score > bestScore) {
                bestScore = score;
                bestJ = j;
                bestReverse = true;
              }
            }
          }
        }

        if (bestJ !== -1) {
          const B = pool[bestJ];
          B.active = false;
          const bPts = bestReverse ? [...B.points].reverse() : B.points;

          // Smooth gap bridging across distance: interpolate gentle transition points
          const gapDist = dist(tailA, bPts[0]);
          if (gapDist > 3) {
            const steps = Math.min(6, Math.max(1, Math.floor(gapDist / 4)));
            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              A.points.push({
                x: tailA.x + (bPts[0].x - tailA.x) * t,
                y: tailA.y + (bPts[0].y - tailA.y) * t,
                pressure: (tailA.pressure + bPts[0].pressure) * 0.5
              });
            }
          }

          A.points.push(...bPts);
          let newLen = 0;
          for (let k = 1; k < A.points.length; k++) newLen += dist(A.points[k - 1], A.points[k]);
          A.length = newLen;
          A.avgMag = (A.avgMag + B.avgMag) * 0.5;

          merged = true;
          break; // Re-sort and continue progressive chaining
        }
      }
    }
  }

  // Simplification, curve smoothing, and pressure modulation
  const smoothed = pool
    .filter((f) => f.active && f.length >= minStrokeLength)
    .map((f) => {
      const simplified = rdp(f.points, 1.4);
      const curved = smoothPoints(simplified);
      let len = 0;
      for (let i = 1; i < curved.length; i++) len += dist(curved[i - 1], curved[i]);

      // Modulate pressure: confident body with gentle start and end tapers
      for (let i = 0; i < curved.length; i++) {
        const t = curved.length > 1 ? i / (curved.length - 1) : 0.5;
        const taper = Math.sin(t * Math.PI);
        const basePressure = curved[i].pressure;
        curved[i].pressure = Math.min(1.0, Math.max(0.28, basePressure * (0.65 + taper * 0.35)));
      }

      return {
        points: curved,
        avgMag: f.avgMag,
        length: len
      };
    })
    .filter((f) => f.length >= minStrokeLength);

  smoothed.sort((a, b) => b.length - a.length);
  return smoothed;
}

// ============================================================================
// GROUPED SHADING GESTURES
// ============================================================================
// Replaces disjoint pixel-level hatching with continuous rhythmic back-and-forth
// serpentine shading gestures that sweep across connected tonal shadow patches.
// ============================================================================

interface ShadingGesture {
  points: StrokePoint[];
  darkness: number;
  length: number;
}

function generateGroupedShadingGestures(
  gray: Float32Array,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
  drawW: number,
  drawH: number
): { midtoneGestures: ShadingGesture[]; deepGestures: ShadingGesture[] } {
  const midtoneGestures: ShadingGesture[] = [];
  const deepGestures: ShadingGesture[] = [];

  const bandHeight = 36;
  const strideY = 10; // Vertical spacing between oscillating sweeps

  for (let bY = Math.floor(offsetY); bY < offsetY + drawH; bY += bandHeight) {
    // Scan horizontal strip for dark/shadow columns
    const darkColumns: { x: number; lum: number }[] = [];
    for (let x = Math.floor(offsetX); x < offsetX + drawW; x += 6) {
      let sumLum = 0;
      let count = 0;
      for (let y = bY; y < bY + bandHeight && y < height; y += 4) {
        sumLum += gray[y * width + x];
        count++;
      }
      const avgLum = sumLum / count;
      if (avgLum < 145) {
        darkColumns.push({ x, lum: avgLum });
      }
    }

    if (darkColumns.length < 5) continue;

    // Cluster into contiguous shadow patches
    const clusters: { x: number; lum: number }[][] = [];
    let currentCluster = [darkColumns[0]];

    for (let i = 1; i < darkColumns.length; i++) {
      if (darkColumns[i].x - darkColumns[i - 1].x <= 22) {
        currentCluster.push(darkColumns[i]);
      } else {
        if (currentCluster.length >= 5) clusters.push(currentCluster);
        currentCluster = [darkColumns[i]];
      }
    }
    if (currentCluster.length >= 5) clusters.push(currentCluster);

    // Generate continuous serpentine sweeps for each contiguous tonal patch
    for (const cluster of clusters) {
      const minX = cluster[0].x;
      const maxX = cluster[cluster.length - 1].x;
      const spanW = maxX - minX;
      if (spanW < 30) continue;

      const avgLum = cluster.reduce((sum, c) => sum + c.lum, 0) / cluster.length;
      const darkness = (145 - avgLum) / 145;

      // 1. Midtone Shading Gesture: Continuous multi-pass zigzag with rounded turnaround arcs
      const gesturePts: StrokePoint[] = [];
      const numSweeps = Math.max(3, Math.min(6, Math.floor(bandHeight / strideY)));
      const passStepX = Math.max(8, Math.min(18, spanW / 10));

      let leftToRight = true;
      for (let s = 0; s < numSweeps; s++) {
        const sweepY = bY + s * strideY + strideY * 0.5;
        // Right-handed diagonal slant
        const slant = (s - numSweeps * 0.5) * 4;

        if (leftToRight) {
          for (let x = minX; x <= maxX; x += passStepX) {
            const sampleX = Math.round(x);
            const sampleY = Math.min(height - 1, Math.max(0, Math.round(sweepY)));
            const localDarkness = Math.max(0.15, (160 - gray[sampleY * width + sampleX]) / 160);
            gesturePts.push({
              x: x + slant,
              y: sweepY + Math.sin(x * 0.1) * 1.5,
              pressure: Math.min(0.85, 0.35 + localDarkness * 0.5)
            });
          }
          // Turnaround arc at right boundary
          if (s < numSweeps - 1) {
            gesturePts.push({
              x: maxX + slant + 5,
              y: sweepY + strideY * 0.5,
              pressure: 0.32
            });
          }
        } else {
          for (let x = maxX; x >= minX; x -= passStepX) {
            const sampleX = Math.round(x);
            const sampleY = Math.min(height - 1, Math.max(0, Math.round(sweepY)));
            const localDarkness = Math.max(0.15, (160 - gray[sampleY * width + sampleX]) / 160);
            gesturePts.push({
              x: x + slant,
              y: sweepY - Math.sin(x * 0.1) * 1.5,
              pressure: Math.min(0.85, 0.35 + localDarkness * 0.5)
            });
          }
          // Turnaround arc at left boundary
          if (s < numSweeps - 1) {
            gesturePts.push({
              x: minX + slant - 5,
              y: sweepY + strideY * 0.5,
              pressure: 0.32
            });
          }
        }
        leftToRight = !leftToRight;
      }

      if (gesturePts.length >= 6) {
        const smPts = smoothPoints(gesturePts);
        let len = 0;
        for (let i = 1; i < smPts.length; i++) len += dist(smPts[i - 1], smPts[i]);
        midtoneGestures.push({ points: smPts, darkness, length: len });
      }

      // 2. Deep Accent & Cross-Hatching Gesture: Opposing angle pass for core dark recesses
      if (avgLum < 75 && spanW >= 36) {
        const crossPts: StrokePoint[] = [];
        const crossSweeps = Math.max(2, Math.min(4, Math.floor(bandHeight / (strideY * 1.3))));
        let rightToLeft = true;

        for (let cs = 0; cs < crossSweeps; cs++) {
          const sweepY = bY + cs * (strideY * 1.3) + strideY * 0.6;
          // Opposing cross-angle slant
          const crossSlant = -(cs - crossSweeps * 0.5) * 6;

          if (rightToLeft) {
            for (let x = maxX; x >= minX; x -= passStepX * 1.25) {
              crossPts.push({
                x: x + crossSlant,
                y: sweepY + Math.cos(x * 0.08) * 1.5,
                pressure: Math.min(0.95, 0.65 + darkness * 0.3)
              });
            }
            if (cs < crossSweeps - 1) {
              crossPts.push({
                x: minX + crossSlant - 4,
                y: sweepY + strideY * 1.3 * 0.5,
                pressure: 0.5
              });
            }
          } else {
            for (let x = minX; x <= maxX; x += passStepX * 1.25) {
              crossPts.push({
                x: x + crossSlant,
                y: sweepY - Math.cos(x * 0.08) * 1.5,
                pressure: Math.min(0.95, 0.65 + darkness * 0.3)
              });
            }
            if (cs < crossSweeps - 1) {
              crossPts.push({
                x: maxX + crossSlant + 4,
                y: sweepY + strideY * 1.3 * 0.5,
                pressure: 0.5
              });
            }
          }
          rightToLeft = !rightToLeft;
        }

        if (crossPts.length >= 6) {
          const smCross = smoothPoints(crossPts);
          let cLen = 0;
          for (let i = 1; i < smCross.length; i++) cLen += dist(smCross[i - 1], smCross[i]);
          deepGestures.push({
            points: smCross,
            darkness: Math.min(1.0, darkness * 1.2),
            length: cLen
          });
        }
      }
    }
  }

  return { midtoneGestures, deepGestures };
}

// ============================================================================
// MAIN DRAWING GENERATION PIPELINE
// ============================================================================

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

  // Fast 3x3 Gaussian smoothing to eliminate sensor grain
  const blurred = new Float32Array(targetWidth * targetHeight);
  for (let y = 1; y < targetHeight - 1; y++) {
    const row = y * targetWidth;
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = row + x;
      blurred[idx] =
        (gray[idx - targetWidth - 1] +
          gray[idx - targetWidth] * 2 +
          gray[idx - targetWidth + 1] +
          gray[idx - 1] * 2 +
          gray[idx] * 4 +
          gray[idx + 1] * 2 +
          gray[idx + targetWidth - 1] +
          gray[idx + targetWidth] * 2 +
          gray[idx + targetWidth + 1]) *
        0.0625;
    }
  }

  // Sobel Edge Detection
  const gradMag = new Float32Array(targetWidth * targetHeight);
  const gradDir = new Float32Array(targetWidth * targetHeight);

  for (let y = 1; y < targetHeight - 1; y++) {
    const row = y * targetWidth;
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = row + x;
      const gx =
        -1 * blurred[idx - targetWidth - 1] +
        1 * blurred[idx - targetWidth + 1] +
        -2 * blurred[idx - 1] +
        2 * blurred[idx + 1] +
        -1 * blurred[idx + targetWidth - 1] +
        1 * blurred[idx + targetWidth + 1];

      const gy =
        -1 * blurred[idx - targetWidth - 1] -
        2 * blurred[idx - targetWidth] -
        1 * blurred[idx - targetWidth + 1] +
        1 * blurred[idx + targetWidth - 1] +
        2 * blurred[idx + targetWidth] +
        1 * blurred[idx + targetWidth + 1];

      gradMag[idx] = Math.hypot(gx, gy);
      gradDir[idx] = Math.atan2(gy, gx);
    }
  }

  // Fast Directional Ridge Tracing
  const visited = new Uint8Array(targetWidth * targetHeight);
  const rawContours: { points: StrokePoint[]; avgMag: number }[] = [];
  const strongThreshold = 36;
  const weakThreshold = 18;

  for (let y = Math.floor(offsetY); y < offsetY + finalH; y += 3) {
    const row = y * targetWidth;
    for (let x = Math.floor(offsetX); x < offsetX + finalW; x += 3) {
      const idx = row + x;
      if (visited[idx] === 0 && gradMag[idx] > strongThreshold) {
        const points: StrokePoint[] = [];
        let cx = x;
        let cy = y;
        let totalMag = 0;
        let curAngle = gradDir[idx] + Math.PI * 0.5;

        while (
          cx >= 3 &&
          cx < targetWidth - 3 &&
          cy >= 3 &&
          cy < targetHeight - 3 &&
          points.length < 450
        ) {
          const cidx = cy * targetWidth + cx;
          if (visited[cidx] === 1 || gradMag[cidx] < weakThreshold) break;

          visited[cidx] = 1;
          visited[cidx - 1] = 1;
          visited[cidx + 1] = 1;
          visited[cidx - targetWidth] = 1;
          visited[cidx + targetWidth] = 1;

          totalMag += gradMag[cidx];
          points.push({
            x: cx,
            y: cy,
            pressure: Math.min(1.0, 0.4 + gradMag[cidx] / 150)
          });

          // Forward search along ridge tangent (3 forward sector angles)
          const forwardAngles = [curAngle, curAngle - 0.45, curAngle + 0.45];
          let bestX = -1;
          let bestY = -1;
          let bestMag = weakThreshold;
          let bestAngle = curAngle;

          for (const a of forwardAngles) {
            const stepDist = 3;
            const nx = Math.round(cx + Math.cos(a) * stepDist);
            const ny = Math.round(cy + Math.sin(a) * stepDist);
            if (nx >= 2 && nx < targetWidth - 2 && ny >= 2 && ny < targetHeight - 2) {
              const nidx = ny * targetWidth + nx;
              if (visited[nidx] === 0 && gradMag[nidx] > bestMag) {
                bestMag = gradMag[nidx];
                bestX = nx;
                bestY = ny;
                bestAngle = a;
              }
            }
          }

          if (bestX !== -1) {
            cx = bestX;
            cy = bestY;
            curAngle = bestAngle;
          } else {
            break;
          }
        }

        if (points.length >= 8) {
          rawContours.push({
            points,
            avgMag: totalMag / points.length
          });
        }
      }
    }
  }

  // ==========================================================================
  // APPLY STROKE CONSOLIDATION LAYER
  // ==========================================================================
  const consolidated = consolidateContours(rawContours, 22);

  // Generate Grouped Shading Gestures
  const { midtoneGestures, deepGestures } = generateGroupedShadingGestures(
    gray,
    targetWidth,
    targetHeight,
    offsetX,
    offsetY,
    finalW,
    finalH
  );

  // ==========================================================================
  // PHASE 1: Deliberate Subject-Adaptive Construction Gestures (5 strokes)
  // Dynamically anchored to the detected subject's actual bounding box and center of mass,
  // making it completely authentic for portraits, objects, still life, or landscapes.
  // ==========================================================================
  let minContourX = Infinity, maxContourX = -Infinity;
  let minContourY = Infinity, maxContourY = -Infinity;
  let sumContourX = 0, sumContourY = 0, contourPtsCount = 0;

  for (const c of consolidated) {
    for (const p of c.points) {
      if (p.x < minContourX) minContourX = p.x;
      if (p.x > maxContourX) maxContourX = p.x;
      if (p.y < minContourY) minContourY = p.y;
      if (p.y > maxContourY) maxContourY = p.y;
      sumContourX += p.x;
      sumContourY += p.y;
      contourPtsCount++;
    }
  }

  if (contourPtsCount === 0) {
    minContourX = offsetX + finalW * 0.15;
    maxContourX = offsetX + finalW * 0.85;
    minContourY = offsetY + finalH * 0.12;
    maxContourY = offsetY + finalH * 0.88;
    sumContourX = (minContourX + maxContourX) * 0.5;
    sumContourY = (minContourY + maxContourY) * 0.5;
    contourPtsCount = 1;
  }

  const subjW = Math.max(80, maxContourX - minContourX);
  const subjH = Math.max(80, maxContourY - minContourY);
  const subjCx = (minContourX + maxContourX) / 2;
  const subjCy = (minContourY + maxContourY) / 2;

  const constructionStrokes: { points: StrokePoint[]; length: number }[] = [];

  // 1. Primary Subject Gesture Envelope (bounding silhouette arc)
  const ovalPoints: StrokePoint[] = [];
  for (let a = -Math.PI; a <= Math.PI + 0.08; a += Math.PI / 14) {
    const rx = subjW * 0.52 * (1 + Math.sin(a * 2) * 0.03);
    const ry = subjH * 0.52 * (1 + Math.cos(a * 2) * 0.03);
    ovalPoints.push({
      x: Math.round(subjCx + Math.cos(a) * rx),
      y: Math.round(subjCy + Math.sin(a) * ry),
      pressure: 0.38
    });
  }
  const smoothedOval = smoothPoints(ovalPoints);
  let ovalLen = 0;
  for (let i = 1; i < smoothedOval.length; i++) ovalLen += dist(smoothedOval[i - 1], smoothedOval[i]);
  constructionStrokes.push({ points: smoothedOval, length: ovalLen });

  // 2. Central Structural Axis (major vertical symmetry / orientation vector)
  const vertPts: StrokePoint[] = [
    { x: Math.round(subjCx), y: Math.round(minContourY - subjH * 0.04), pressure: 0.35 },
    { x: Math.round(subjCx), y: Math.round(maxContourY + subjH * 0.04), pressure: 0.42 }
  ];
  constructionStrokes.push({ points: vertPts, length: dist(vertPts[0], vertPts[1]) });

  // 3. Primary Upper Division Line (e.g. Eyeline in portraits, major upper division in objects)
  const upperDivY = Math.round(subjCy - subjH * 0.16);
  const upperPts: StrokePoint[] = [
    { x: Math.round(subjCx - subjW * 0.44), y: upperDivY - 2, pressure: 0.36 },
    { x: Math.round(subjCx + subjW * 0.44), y: upperDivY + 2, pressure: 0.40 }
  ];
  constructionStrokes.push({ points: upperPts, length: dist(upperPts[0], upperPts[1]) });

  // 4. Secondary Lower Division Line (e.g. Nose base / mouth in portraits, lower shelf in objects)
  const lowerDivY = Math.round(subjCy + subjH * 0.18);
  const lowerPts: StrokePoint[] = [
    { x: Math.round(subjCx - subjW * 0.35), y: lowerDivY, pressure: 0.35 },
    { x: Math.round(subjCx + subjW * 0.35), y: lowerDivY, pressure: 0.38 }
  ];
  constructionStrokes.push({ points: lowerPts, length: dist(lowerPts[0], lowerPts[1]) });

  // 5. Grounding Silhouette / Base Anchor Gesture
  const baseAnchorY = Math.round(maxContourY + subjH * 0.02);
  const basePts: StrokePoint[] = [
    { x: Math.round(subjCx - subjW * 0.45), y: baseAnchorY, pressure: 0.36 },
    { x: Math.round(subjCx), y: baseAnchorY + 4, pressure: 0.42 },
    { x: Math.round(subjCx + subjW * 0.45), y: baseAnchorY, pressure: 0.36 }
  ];
  const smoothedBase = smoothPoints(basePts);
  let baseLen = 0;
  for (let i = 1; i < smoothedBase.length; i++) baseLen += dist(smoothedBase[i - 1], smoothedBase[i]);
  constructionStrokes.push({ points: smoothedBase, length: baseLen });

  // ==========================================================================
  // PATH COUNT GOVERNANCE & BUDGETING: ENFORCING 80-180 COHERENT PATHS
  // ==========================================================================
  const fixedCount = constructionStrokes.length + 1; // Construction + Artist Signature = 7

  // Shading Gestures Allocation: 24-40 gestures
  let maxMidtones = Math.min(midtoneGestures.length, 24);
  let maxDeeps = Math.min(deepGestures.length, 14);

  // If shading gestures are low (e.g. high-key graphic), ensure at least 15 shading gestures if available
  const totalShading = maxMidtones + maxDeeps;

  // Contour Paths Allocation: target total between 80 and 180 paths
  // Max contours ceiling = 178 - fixedCount - totalShading
  const maxContours = Math.max(45, 178 - fixedCount - totalShading);
  // Min contours floor = Math.max(30, 82 - fixedCount - totalShading)
  const minContours = Math.max(30, 82 - fixedCount - totalShading);

  let selectedContours = consolidated.slice(0, maxContours);
  if (selectedContours.length < minContours && consolidated.length > selectedContours.length) {
    selectedContours = consolidated.slice(0, minContours);
  }

  // Partition into Phase 2 (Major Outlines: ~35-40%) and Phase 3 (Refined Details: ~60-65%)
  const numMajor = Math.max(16, Math.min(45, Math.round(selectedContours.length * 0.38)));
  const majorPaths = selectedContours.slice(0, numMajor);
  const detailPaths = selectedContours.slice(numMajor);

  // Spatially sequence contour and shading paths for natural hand progression
  const sortedMajor = spatialSort(majorPaths);
  const sortedDetails = spatialSort(detailPaths);
  const sortedMidtones = spatialSort(midtoneGestures.slice(0, maxMidtones));
  const sortedDeeps = spatialSort(deepGestures.slice(0, maxDeeps));

  // Style configs
  const styleConfig = {
    pencil: { color: '#272624', baseWidth: 1.6, alpha: 0.82 },
    charcoal: { color: '#161514', baseWidth: 2.5, alpha: 0.92 },
    fineliner: { color: '#0a0a09', baseWidth: 1.25, alpha: 0.95 }
  }[style];

  const strokes: DrawingStroke[] = [];
  let strokeId = 0;

  // Phase 1: Construction Marks (0-5s)
  for (const cs of constructionStrokes) {
    strokes.push({
      id: `stroke-${strokeId++}`,
      phase: 1,
      phaseName: 'Construction Marks',
      points: cs.points,
      color: style === 'pencil' ? '#686561' : style === 'charcoal' ? '#4d4a46' : '#55514d',
      baseWidth: 1.3,
      alpha: 0.52,
      style,
      length: cs.length
    });
  }

  // Phase 2: Major Structural Outlines (5-20s)
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

  // Phase 3: Features & Secondary Form (20-40s)
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

  // Phase 4: Midtone Shading Gestures (40-53s)
  for (const s of sortedMidtones) {
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

  // Phase 5: Deep Contrast & Accents (53-58s)
  for (const s of sortedDeeps) {
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

  // Calculate phase lengths and total length
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
