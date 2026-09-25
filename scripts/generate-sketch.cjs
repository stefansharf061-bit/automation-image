const sharp = require('sharp');
const fs = require('fs');

async function testSketch() {
  const inputPath = 'public/assets/sample-portrait.jpg';
  const targetW = 720;
  const targetH = 960;

  const { data: rgb, info } = await sharp(inputPath)
    .resize(targetW, targetH, { fit: 'contain', background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const N = w * h;

  const gray = new Float32Array(N);
  const skin = new Uint8Array(N);
  const r = new Uint8Array(N);
  const g = new Uint8Array(N);
  const b = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    const p = i * 3;
    const R = rgb[p], G = rgb[p + 1], B = rgb[p + 2];
    r[i] = R;
    g[i] = G;
    b[i] = B;
    gray[i] = (0.299 * R + 0.587 * G + 0.114 * B) / 255.0;

    const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
    const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
    if (cb >= 80 && cb <= 128 && cr >= 133 && cr <= 173 && R > G && G > B && (R - G) >= 10) {
      skin[i] = 1;
    }
  }

  // Downsample to 180x240 for fast connected component analysis
  const dw = 180, dh = 240;
  const downSkin = new Uint8Array(dw * dh);
  const sx = w / dw, sy = h / dh;
  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      const origX = Math.floor(dx * sx);
      const origY = Math.floor(dy * sy);
      downSkin[dy * dw + dx] = skin[origY * w + origX];
    }
  }

  // Connected components on downsampled skin
  const visited = new Uint8Array(dw * dh);
  const clusters = [];
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const idx = y * dw + x;
      if (downSkin[idx] === 1 && !visited[idx]) {
        const q = [idx];
        visited[idx] = 1;
        let count = 0;
        let minX = x, maxX = x, minY = y, maxY = y;
        while (q.length > 0) {
          const curr = q.pop();
          count++;
          const cy = Math.floor(curr / dw);
          const cx = curr % dw;
          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          const nbs = [curr - 1, curr + 1, curr - dw, curr + dw];
          for (const nb of nbs) {
            if (nb >= 0 && nb < dw * dh && downSkin[nb] === 1 && !visited[nb]) {
              visited[nb] = 1;
              q.push(nb);
            }
          }
        }
        if (count >= 15) { // significant skin cluster
          clusters.push({
            count,
            minX: minX * sx,
            maxX: maxX * sx,
            minY: minY * sy,
            maxY: maxY * sy,
            cx: ((minX + maxX) / 2) * sx,
            cy: ((minY + maxY) / 2) * sy
          });
        }
      }
    }
  }

  console.log(`Found ${clusters.length} human skin clusters:`);
  // Filter to top clusters that represent human faces/bodies
  clusters.sort((a, b) => b.count - a.count);
  const mainClusters = clusters.filter(c => c.count > 150);
  console.log("Main human clusters (>150 pts):", mainClusters.length);
  mainClusters.forEach((c, idx) => {
    console.log(`Cluster ${idx + 1}: ${c.count} pts, box=[${Math.round(c.minX)}, ${Math.round(c.minY)}, ${Math.round(c.maxX)}, ${Math.round(c.maxY)}]`);
  });

  // Determine subject bounding hull
  let allMinX = w, allMaxX = 0, allMinY = h, allMaxY = 0;
  for (const c of mainClusters) {
    if (c.minX < allMinX) allMinX = c.minX;
    if (c.maxX > allMaxX) allMaxX = c.maxX;
    if (c.minY < allMinY) allMinY = c.minY;
    if (c.maxY > allMaxY) allMaxY = c.maxY;
  }

  // Extend for hair, shoulders, clothing
  const subjectTop = Math.max(0, Math.round(allMinY - (allMaxY - allMinY) * 0.35));
  const subjectBottom = h - 1;
  const subjectLeft = Math.max(0, Math.round(allMinX - w * 0.12));
  const subjectRight = Math.min(w - 1, Math.round(allMaxX + w * 0.12));

  console.log(`Subject bounding region: X=[${subjectLeft}, ${subjectRight}], Y=[${subjectTop}, ${subjectBottom}]`);

  // Build foreground soft mask
  const fgMask = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (y < subjectTop || y > subjectBottom || x < subjectLeft || x > subjectRight) {
        fgMask[idx] = 0;
        continue;
      }

      // Check distance from horizontal boundary of subjects for soft vignette
      const distFromEdgeX = Math.min(x - subjectLeft, subjectRight - x);
      const distFromEdgeY = y - subjectTop;
      const vignette = Math.min(1.0, distFromEdgeX / 40.0) * Math.min(1.0, distFromEdgeY / 30.0);

      // Check if green foliage
      const isGreen = (g[idx] > r[idx] * 1.05 && g[idx] > b[idx] * 1.15 && g[idx] > 60);
      if (isGreen) {
        fgMask[idx] = 0.0;
      } else {
        fgMask[idx] = vignette;
      }
    }
  }

  // Gaussian blur helper
  function gaussianBlur(src, sigma) {
    const dst = new Float32Array(N);
    const tmp = new Float32Array(N);
    const radius = Math.ceil(sigma * 2.5);
    const kernel = [];
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel.push(v);
      sum += v;
    }
    for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

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

  // Smooth foreground mask
  const smoothMask = gaussianBlur(fgMask, 4.0);

  // STAGE 1 SKETCH:
  // 1. Tonal pencil shading via color dodge
  const inverted = new Float32Array(N);
  for (let i = 0; i < N; i++) inverted[i] = 1.0 - gray[i];
  const blurredInverted = gaussianBlur(inverted, 14.0);

  const tonalPencil = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const base = gray[i];
    const blend = blurredInverted[i];
    let v = 1.0;
    if (blend < 1.0) {
      v = Math.min(1.0, base / (1.0 - blend + 1e-4));
    }
    tonalPencil[i] = Math.pow(v, 1.8);
  }

  // 2. Anatomical Line Art (DoG on grayscale)
  const g1 = gaussianBlur(gray, 1.2);
  const g2 = gaussianBlur(gray, 3.2);

  const sketchImg = Buffer.alloc(N * 3);
  for (let i = 0; i < N; i++) {
    const mask = smoothMask[i];
    if (mask <= 0.05) {
      sketchImg[i * 3] = 255;
      sketchImg[i * 3 + 1] = 255;
      sketchImg[i * 3 + 2] = 255;
      continue;
    }

    const dog = g1[i] - 0.97 * g2[i];
    let lineVal = 1.0;
    if (dog < -0.015) {
      lineVal = Math.max(0.0, 1.0 + dog * 10.0);
    }

    const toneVal = tonalPencil[i];
    const combined = Math.min(lineVal, toneVal);

    // Fade with mask onto clean white paper
    const finalVal = 1.0 - (1.0 - combined) * mask;
    const byteVal = Math.round(Math.min(255, Math.max(0, finalVal * 255)));

    sketchImg[i * 3] = byteVal;
    sketchImg[i * 3 + 1] = byteVal;
    sketchImg[i * 3 + 2] = byteVal;
  }

  await sharp(sketchImg, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile('subject_portrait_sketch.png');

  console.log('Generated subject_portrait_sketch.png successfully!');
}

testSketch().catch(console.error);
