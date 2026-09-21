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

// Distance between two 2D points
function dist(p1: { x: number; y: number }, p2: { x: number; y: number }): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
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
    let d = 0;
    if (lineLen === 0) {
      d = dist(points[i], start);
    } else {
      // Perpendicular distance
      const num = Math.abs(
        (end.y - start.y) * points[i].x -
        (end.x - start.x) * points[i].y +
        end.x * start.y -
        end.y * start.x
      );
      d = num / lineLen;
    }
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = rdp(points.slice(0, index + 1), epsilon);
    const recResults2 = rdp(points.slice(index), epsilon);
    return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
  } else {
    return [start, end];
  }
}

// Smooth points with Catmull-Rom interpolation for natural hand feel
function smoothPoints(points: StrokePoint[]): StrokePoint[] {
  if (points.length < 3) return points;
  const result: StrokePoint[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const segmentDist = dist(p1, p2);
    const steps = Math.max(1, Math.min(6, Math.floor(segmentDist / 4)));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom formula
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

// Main image to drawing path analyzer
export function processImageToDrawing(
  image: HTMLImageElement,
  style: DrawingStyle = 'pencil',
  targetWidth = 720,
  targetHeight = 960
): DrawingData {
  // 1. Setup offscreen canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;

  // Fit image into target bounds with artistic paper margin
  const marginX = targetWidth * 0.08;
  const marginY = targetHeight * 0.08;
  const drawWidth = targetWidth - marginX * 2;
  const drawHeight = targetHeight - marginY * 2;

  // Calculate aspect ratio fit
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

  // 2. Extract pixel data for analysis
  const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
  const data = imgData.data;

  // Grayscale and luminance buffer
  const gray = new Float32Array(targetWidth * targetHeight);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Perceptual luminance (0 to 255)
    gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // 3. Sobel edge detection
  const gradMag = new Float32Array(targetWidth * targetHeight);
  const gradDir = new Float32Array(targetWidth * targetHeight);

  for (let y = 1; y < targetHeight - 1; y++) {
    for (let x = 1; x < targetWidth - 1; x++) {
      const idx = y * targetWidth + x;
      // Sobel horizontal
      const gx =
        -1 * gray[idx - targetWidth - 1] + 1 * gray[idx - targetWidth + 1] +
        -2 * gray[idx - 1] + 2 * gray[idx + 1] +
        -1 * gray[idx + targetWidth - 1] + 1 * gray[idx + targetWidth + 1];

      // Sobel vertical
      const gy =
        -1 * gray[idx - targetWidth - 1] - 2 * gray[idx - targetWidth] - 1 * gray[idx - targetWidth + 1] +
         1 * gray[idx + targetWidth - 1] + 2 * gray[idx + targetWidth] + 1 * gray[idx + targetWidth + 1];

      const mag = Math.hypot(gx, gy);
      gradMag[idx] = mag;
      gradDir[idx] = Math.atan2(gy, gx);
    }
  }

  // 4. Trace edge contours
  const visited = new Uint8Array(targetWidth * targetHeight);
  const rawContours: { points: StrokePoint[]; avgMag: number; isStrong: boolean }[] = [];

  const strongThreshold = 45;
  const weakThreshold = 22;

  for (let y = Math.floor(offsetY); y < offsetY + finalH; y += 2) {
    for (let x = Math.floor(offsetX); x < offsetX + finalW; x += 2) {
      const idx = y * targetWidth + x;
      if (visited[idx] === 0 && gradMag[idx] > strongThreshold) {
        // Trace this line
        const points: StrokePoint[] = [];
        let cx = x;
        let cy = y;
        let totalMag = 0;

        while (
          cx >= 0 &&
          cx < targetWidth &&
          cy >= 0 &&
          cy < targetHeight &&
          points.length < 240
        ) {
          const cidx = cy * targetWidth + cx;
          if (visited[cidx] === 1 || gradMag[cidx] < weakThreshold) break;

          visited[cidx] = 1;
          totalMag += gradMag[cidx];

          const pressure = Math.min(1.0, Math.max(0.2, gradMag[cidx] / 150));
          points.push({ x: cx, y: cy, pressure });

          // Follow tangent to gradient (perpendicular to edge normal)
          const angle = gradDir[cidx] + Math.PI / 2;
          let nx = Math.round(cx + Math.cos(angle) * 2);
          let ny = Math.round(cy + Math.sin(angle) * 2);

          // Find neighbor with highest gradient magnitude in general forward cone
          let bestNeighbor = { x: nx, y: ny, mag: -1 };
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const testX = cx + dx;
              const testY = cy + dy;
              if (
                testX >= 0 &&
                testX < targetWidth &&
                testY >= 0 &&
                testY < targetHeight
              ) {
                const tidx = testY * targetWidth + testX;
                if (visited[tidx] === 0 && gradMag[tidx] > bestNeighbor.mag) {
                  bestNeighbor = { x: testX, y: testY, mag: gradMag[tidx] };
                }
              }
            }
          }

          if (bestNeighbor.mag > weakThreshold) {
            cx = bestNeighbor.x;
            cy = bestNeighbor.y;
          } else {
            break;
          }
        }

        if (points.length >= 4) {
          const avgMag = totalMag / points.length;
          rawContours.push({
            points: smoothPoints(rdp(points, 1.8)),
            avgMag,
            isStrong: avgMag > 70
          });
        }
      }
    }
  }

  // 5. Generate Shading & Cross-Hatching for dark regions (Phase 4 & 5)
  const hatchingStrokes: { points: StrokePoint[]; darkness: number; isCross: boolean }[] = [];
  const hatchStep = style === 'fineliner' ? 9 : style === 'charcoal' ? 12 : 10;

  for (let y = Math.floor(offsetY); y < offsetY + finalH; y += hatchStep) {
    for (let x = Math.floor(offsetX); x < offsetX + finalW; x += hatchStep) {
      const idx = y * targetWidth + x;
      const lum = gray[idx];

      // If in shadow/mid-tone (lum < 160)
      if (lum < 160) {
        const darkness = (160 - lum) / 160; // 0 to 1
        const strokeLen = Math.floor(10 + darkness * 22);

        // Direction 1: 45 degree artistic diagonal
        const p1x = x - strokeLen * 0.5;
        const p1y = y - strokeLen * 0.5;
        const p2x = x + strokeLen * 0.5;
        const p2y = y + strokeLen * 0.5;

        // Add small human curve/wobble
        const midWobble = (Math.random() - 0.5) * 1.5;
        const midX = (p1x + p2x) / 2 + midWobble;
        const midY = (p1y + p2y) / 2 - midWobble;

        hatchingStrokes.push({
          points: [
            { x: p1x, y: p1y, pressure: 0.3 * darkness },
            { x: midX, y: midY, pressure: 0.8 * darkness },
            { x: p2x, y: p2y, pressure: 0.4 * darkness }
          ],
          darkness,
          isCross: false
        });

        // Direction 2: Cross-hatching if very dark (lum < 85)
        if (lum < 85) {
          const c1x = x + strokeLen * 0.5;
          const c1y = y - strokeLen * 0.5;
          const c2x = x - strokeLen * 0.5;
          const c2y = y + strokeLen * 0.5;

          hatchingStrokes.push({
            points: [
              { x: c1x, y: c1y, pressure: 0.4 * darkness },
              { x: x, y: y, pressure: 0.9 * darkness },
              { x: c2x, y: c2y, pressure: 0.5 * darkness }
            ],
            darkness,
            isCross: true
          });
        }
      }
    }
  }

  // 6. Generate Light Construction Lines (Phase 1)
  // An artist starts with very light 2H pencil bounding shapes, center axes, ellipses
  const constructionStrokes: { points: StrokePoint[] }[] = [];
  const centerX = offsetX + finalW / 2;
  const centerY = offsetY + finalH / 2;

  // Head/Subject oval gesture
  const ovalPoints: StrokePoint[] = [];
  for (let a = -Math.PI; a <= Math.PI; a += Math.PI / 8) {
    const rx = (finalW * 0.38) * (1 + (Math.random() - 0.5) * 0.05);
    const ry = (finalH * 0.42) * (1 + (Math.random() - 0.5) * 0.05);
    ovalPoints.push({
      x: centerX + Math.cos(a) * rx,
      y: centerY + Math.sin(a) * ry,
      pressure: 0.25
    });
  }
  constructionStrokes.push({ points: smoothPoints(ovalPoints) });

  // Axis lines
  constructionStrokes.push({
    points: [
      { x: centerX + (Math.random() - 0.5) * 10, y: offsetY + finalH * 0.1, pressure: 0.2 },
      { x: centerX + (Math.random() - 0.5) * 10, y: offsetY + finalH * 0.9, pressure: 0.25 }
    ]
  });

  constructionStrokes.push({
    points: [
      { x: offsetX + finalW * 0.15, y: centerY - finalH * 0.1, pressure: 0.18 },
      { x: offsetX + finalW * 0.85, y: centerY - finalH * 0.08, pressure: 0.22 }
    ]
  });

  // Loose gestural framing box
  constructionStrokes.push({
    points: [
      { x: offsetX, y: offsetY + finalH * 0.2, pressure: 0.2 },
      { x: offsetX + finalW * 0.3, y: offsetY, pressure: 0.25 },
      { x: offsetX + finalW, y: offsetY + finalH * 0.15, pressure: 0.18 }
    ]
  });

  // 7. Organize into Artistic 6-Phase Sequence
  const strokes: DrawingStroke[] = [];
  let strokeIdCounter = 0;

  // Style characteristics
  const styleConfig = {
    pencil: {
      color: '#282725',
      baseWidth: 1.4,
      alpha: 0.75
    },
    charcoal: {
      color: '#1a1917',
      baseWidth: 2.2,
      alpha: 0.85
    },
    fineliner: {
      color: '#0d0c0a',
      baseWidth: 1.1,
      alpha: 0.95
    }
  }[style];

  // PHASE 1: Light Construction Marks (0-5s)
  for (const cs of constructionStrokes) {
    let len = 0;
    for (let i = 1; i < cs.points.length; i++) {
      len += dist(cs.points[i - 1], cs.points[i]);
    }
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 1,
      phaseName: 'Construction Marks',
      points: cs.points,
      color: '#8c8a86',
      baseWidth: 0.9,
      alpha: 0.25,
      style,
      length: len
    });
  }

  // Separate contours into Phase 2 (Major Outlines) and Phase 3 (Important Details)
  // Sort raw contours by length (longer = major structural outlines)
  rawContours.sort((a, b) => b.points.length - a.points.length);

  const majorCount = Math.min(rawContours.length, Math.max(8, Math.floor(rawContours.length * 0.35)));
  const majorContours = rawContours.slice(0, majorCount);
  const detailContours = rawContours.slice(majorCount);

  // Group contours spatially so artist works organically in regions rather than jumping frantically
  function sortSpatially(items: typeof rawContours) {
    if (items.length <= 1) return items;
    const sorted: typeof rawContours = [items[0]];
    const remaining = items.slice(1);

    while (remaining.length > 0) {
      const lastPoint = sorted[sorted.length - 1].points[sorted[sorted.length - 1].points.length - 1];
      let nearestIdx = 0;
      let minDist = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const d = dist(lastPoint, remaining[i].points[0]);
        if (d < minDist) {
          minDist = d;
          nearestIdx = i;
        }
      }
      sorted.push(remaining.splice(nearestIdx, 1)[0]);
    }
    return sorted;
  }

  const sortedMajor = sortSpatially(majorContours);
  const sortedDetails = sortSpatially(detailContours);

  // PHASE 2: Major Outlines (5-20s)
  for (const c of sortedMajor) {
    let len = 0;
    for (let i = 1; i < c.points.length; i++) {
      len += dist(c.points[i - 1], c.points[i]);
    }
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 2,
      phaseName: 'Major Outlines',
      points: c.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * 1.2,
      alpha: styleConfig.alpha,
      style,
      length: len
    });
  }

  // PHASE 3: Important Details (20-40s)
  for (const c of sortedDetails) {
    let len = 0;
    for (let i = 1; i < c.points.length; i++) {
      len += dist(c.points[i - 1], c.points[i]);
    }
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 3,
      phaseName: 'Features & Form',
      points: c.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * 0.95,
      alpha: styleConfig.alpha * 0.9,
      style,
      length: len
    });
  }

  // PHASE 4: Shadows & Midtone Shading (40-53s)
  // Sort hatching spatially to simulate continuous natural wrist hatching
  hatchingStrokes.sort((a, b) => a.points[0].y - b.points[0].y + (Math.random() - 0.5) * 40);

  const midtoneHatching = hatchingStrokes.filter(h => !h.isCross);
  for (const h of midtoneHatching) {
    let len = 0;
    for (let i = 1; i < h.points.length; i++) {
      len += dist(h.points[i - 1], h.points[i]);
    }
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 4,
      phaseName: 'Shading & Tones',
      points: h.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * (0.8 + h.darkness * 0.5),
      alpha: styleConfig.alpha * (0.45 + h.darkness * 0.4),
      style,
      isHatching: true,
      length: len
    });
  }

  // PHASE 5: Deep Accents & Cross-hatching (53-58s)
  const deepHatching = hatchingStrokes.filter(h => h.isCross);
  for (const h of deepHatching) {
    let len = 0;
    for (let i = 1; i < h.points.length; i++) {
      len += dist(h.points[i - 1], h.points[i]);
    }
    strokes.push({
      id: `stroke-${strokeIdCounter++}`,
      phase: 5,
      phaseName: 'Deep Contrast & Accents',
      points: h.points,
      color: styleConfig.color,
      baseWidth: styleConfig.baseWidth * 1.3,
      alpha: styleConfig.alpha,
      style,
      isHatching: true,
      length: len
    });
  }

  // PHASE 6: Final Signature Mark & Cleanup (58-60s)
  // Artistic cursive initials mark at lower-right
  const sigX = offsetX + finalW * 0.88;
  const sigY = offsetY + finalH * 0.94;
  const sigPoints: StrokePoint[] = [
    { x: sigX, y: sigY, pressure: 0.6 },
    { x: sigX + 6, y: sigY - 4, pressure: 0.8 },
    { x: sigX + 12, y: sigY + 2, pressure: 0.5 },
    { x: sigX + 18, y: sigY - 2, pressure: 0.9 },
    { x: sigX + 24, y: sigY + 4, pressure: 0.4 }
  ];

  let sigLen = 0;
  for (let i = 1; i < sigPoints.length; i++) {
    sigLen += dist(sigPoints[i - 1], sigPoints[i]);
  }
  strokes.push({
    id: `stroke-${strokeIdCounter++}`,
    phase: 6,
    phaseName: 'Artist Signature',
    points: smoothPoints(sigPoints),
    color: styleConfig.color,
    baseWidth: styleConfig.baseWidth * 1.1,
    alpha: styleConfig.alpha * 0.85,
    style,
    length: sigLen
  });

  // Calculate statistics
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
