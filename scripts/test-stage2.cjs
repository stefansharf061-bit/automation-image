const fs = require('fs');
const sharp = require('sharp');

async function testStage2() {
  const { data: sketchPixels, info } = await sharp('subject_portrait_sketch.png')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width, h = info.height, N = w * h;
  const sketchNorm = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    sketchNorm[i] = sketchPixels[i * 3] / 255.0; // 0=black line, 1=white paper
  }

  // Find line darkness
  const darkness = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    darkness[i] = Math.max(0, 1.0 - sketchNorm[i]);
  }

  // Gaussian smooth darkness
  function gBlur(src, sigma) {
    const dst = new Float32Array(N);
    const tmp = new Float32Array(N);
    const rad = Math.ceil(sigma * 2.5);
    const kern = [];
    let s = 0;
    for (let i = -rad; i <= rad; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kern.push(v);
      s += v;
    }
    for (let i = 0; i < kern.length; i++) kern[i] /= s;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let k = -rad; k <= rad; k++) {
          const px = Math.min(w - 1, Math.max(0, x + k));
          acc += src[row + px] * kern[k + rad];
        }
        tmp[row + x] = acc;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let acc = 0;
        for (let k = -rad; k <= rad; k++) {
          const py = Math.min(h - 1, Math.max(0, y + k));
          acc += tmp[py * w + x] * kern[k + rad];
        }
        dst[y * w + x] = acc;
      }
    }
    return dst;
  }

  const smoothD = gBlur(darkness, 1.2);

  // Gradient of darkness
  const gx = new Float32Array(N);
  const gy = new Float32Array(N);
  const mag = new Float32Array(N);
  const margin = 10;
  for (let y = margin; y < h - margin; y++) {
    const row = y * w;
    for (let x = margin; x < w - margin; x++) {
      const idx = row + x;
      const gX =
        -smoothD[(y - 1) * w + (x - 1)] + smoothD[(y - 1) * w + (x + 1)]
        -2 * smoothD[row + (x - 1)] + 2 * smoothD[row + (x + 1)]
        -smoothD[(y + 1) * w + (x - 1)] + smoothD[(y + 1) * w + (x + 1)];
      const gY =
        -smoothD[(y - 1) * w + (x - 1)] - 2 * smoothD[(y - 1) * w + x] - smoothD[(y - 1) * w + (x + 1)]
        +smoothD[(y + 1) * w + (x - 1)] + 2 * smoothD[(y + 1) * w + x] + smoothD[(y + 1) * w + (x + 1)];
      gx[idx] = gX;
      gy[idx] = gY;
      mag[idx] = Math.hypot(gX, gY);
    }
  }

  // Non-maximum suppression along gradient direction
  const nms = new Float32Array(N);
  for (let y = margin; y < h - margin; y++) {
    const row = y * w;
    for (let x = margin; x < w - margin; x++) {
      const idx = row + x;
      const m = mag[idx];
      if (m < 0.08) continue;
      const gX = gx[idx], gY = gy[idx];
      let angle = (Math.atan2(gY, gX) * 180) / Math.PI;
      if (angle < 0) angle += 180;
      let m1 = 0, m2 = 0;
      if ((angle >= 0 && angle < 22.5) || (angle >= 157.5 && angle <= 180)) {
        m1 = mag[idx - 1]; m2 = mag[idx + 1];
      } else if (angle >= 22.5 && angle < 67.5) {
        m1 = mag[(y - 1) * w + (x + 1)]; m2 = mag[(y + 1) * w + (x - 1)];
      } else if (angle >= 67.5 && angle < 112.5) {
        m1 = mag[(y - 1) * w + x]; m2 = mag[(y + 1) * w + x];
      } else {
        m1 = mag[(y - 1) * w + (x - 1)]; m2 = mag[(y + 1) * w + (x + 1)];
      }
      if (m >= m1 && m >= m2) {
        nms[idx] = m;
      }
    }
  }

  // Hysteresis thresholding
  const highT = 0.16;
  const lowT = 0.08;
  const edge = new Uint8Array(N);
  const q = [];
  for (let y = margin; y < h - margin; y++) {
    const row = y * w;
    for (let x = margin; x < w - margin; x++) {
      const idx = row + x;
      if (nms[idx] >= highT && edge[idx] === 0) {
        edge[idx] = 1;
        q.push(idx);
      }
    }
  }
  while (q.length > 0) {
    const curr = q.pop();
    const cy = Math.floor(curr / w);
    const cx = curr % w;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < margin || ny >= h - margin) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        if (nx < margin || nx >= w - margin) continue;
        const nIdx = ny * w + nx;
        if (nms[nIdx] >= lowT && edge[nIdx] === 0) {
          edge[nIdx] = 1;
          q.push(nIdx);
        }
      }
    }
  }

  // Trace continuous chains
  const visited = new Uint8Array(N);
  const rawPaths = [];
  for (let y = margin; y < h - margin; y++) {
    const row = y * w;
    for (let x = margin; x < w - margin; x++) {
      const idx = row + x;
      if (edge[idx] === 1 && visited[idx] === 0) {
        const path = [{ x, y }];
        visited[idx] = 1;
        let cx = x, cy = y;
        while (true) {
          let nextIdx = -1, nx = cx, ny = cy;
          for (let dy = -1; dy <= 1; dy++) {
            const py = cy + dy;
            if (py < margin || py >= h - margin) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const px = cx + dx;
              if (px < margin || px >= w - margin) continue;
              const nIdx = py * w + px;
              if (edge[nIdx] === 1 && visited[nIdx] === 0) {
                nextIdx = nIdx;
                nx = px; ny = py;
                break;
              }
            }
            if (nextIdx !== -1) break;
          }
          if (nextIdx === -1) break;
          visited[nextIdx] = 1;
          path.push({ x: nx, y: ny });
          cx = nx; cy = ny;
        }
        if (path.length >= 10) {
          rawPaths.push(path);
        }
      }
    }
  }

  console.log('Raw continuous paths extracted:', rawPaths.length);

  // Ramer-Douglas-Peucker simplification
  function dist(p1, p2) { return Math.hypot(p1.x - p2.x, p1.y - p2.y); }
  function rdp(pts, eps) {
    if (pts.length <= 2) return pts;
    let maxD = 0, index = 0;
    const p1 = pts[0], p2 = pts[pts.length - 1];
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;
    for (let i = 1; i < pts.length - 1; i++) {
      let d = 0;
      if (lenSq === 0) d = dist(pts[i], p1);
      else {
        const t = Math.max(0, Math.min(1, ((pts[i].x - p1.x) * dx + (pts[i].y - p1.y) * dy) / lenSq));
        d = dist(pts[i], { x: p1.x + t * dx, y: p1.y + t * dy });
      }
      if (d > maxD) { maxD = d; index = i; }
    }
    if (maxD > eps) {
      const r1 = rdp(pts.slice(0, index + 1), eps);
      const r2 = rdp(pts.slice(index), eps);
      return r1.slice(0, -1).concat(r2);
    }
    return [p1, p2];
  }

  function pathLength(pts) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) l += dist(pts[i], pts[i - 1]);
    return l;
  }

  const simplified = rawPaths.map(p => rdp(p, 2.0)).filter(p => pathLength(p) > 20);
  console.log('Simplified paths (>20px):', simplified.length);

  // Sort paths: Anatomy hierarchy
  // Faces/heads first (y < 450), then arms/torso (y >= 450)
  simplified.sort((a, b) => {
    const aMinY = Math.min(...a.map(p => p.y));
    const bMinY = Math.min(...b.map(p => p.y));
    return aMinY - bMinY;
  });

  const finalPaths = simplified.slice(0, 70);
  console.log('Final target paths count:', finalPaths.length);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`;
  svg += `  <rect width="100%" height="100%" fill="#ffffff" />\n`;
  for (let i = 0; i < finalPaths.length; i++) {
    const pts = finalPaths[i];
    const d = pts.map((p, idx) => (idx === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)).join(' ');
    svg += `  <path d="${d}" stroke="#181a1b" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />\n`;
  }
  svg += `</svg>`;

  fs.writeFileSync('final_stage2_paths.svg', svg);
  console.log('Saved final_stage2_paths.svg successfully!');
}

testStage2().catch(console.error);
