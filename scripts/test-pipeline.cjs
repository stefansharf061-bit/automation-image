const sharp = require('sharp');
const fs = require('fs');

async function runPipeline() {
  const inputPath = 'public/assets/sample-portrait.jpg';
  const targetW = 720;
  const targetH = 960;

  // Load image resized to target dimensions
  const { data: rawRgb, info } = await sharp(inputPath)
    .resize(targetW, targetH, { fit: 'contain', background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const numPixels = w * h;

  // 1. Color representations
  const r = new Uint8Array(numPixels);
  const g = new Uint8Array(numPixels);
  const b = new Uint8Array(numPixels);
  const gray = new Float32Array(numPixels);
  const isSkin = new Uint8Array(numPixels);

  for (let i = 0; i < numPixels; i++) {
    const p = i * 3;
    const R = rawRgb[p];
    const G = rawRgb[p + 1];
    const B = rawRgb[p + 2];
    r[i] = R;
    g[i] = G;
    b[i] = B;
    gray[i] = (0.299 * R + 0.587 * G + 0.114 * B) / 255.0;

    // YCbCr skin detection
    const cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
    const cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
    if (cb >= 75 && cb <= 130 && cr >= 130 && cr <= 178 && R > G && G > B) {
      isSkin[i] = 1;
    }
  }

  // 2. Background Model: Sample border colors
  // Sample top 8% of image, left 5%, right 5%
  const bgSamples = [];
  const borderMargin = 20;
  for (let x = 0; x < w; x += 4) {
    for (let y = 0; y < Math.floor(h * 0.08); y += 4) {
      const idx = y * w + x;
      bgSamples.push([r[idx], g[idx], b[idx]]);
    }
  }
  for (let y = 0; y < Math.floor(h * 0.4); y += 4) {
    for (let x = 0; x < Math.floor(w * 0.05); x += 4) {
      const idx = y * w + x;
      bgSamples.push([r[idx], g[idx], b[idx]]);
    }
    for (let x = Math.floor(w * 0.95); x < w; x += 4) {
      const idx = y * w + x;
      bgSamples.push([r[idx], g[idx], b[idx]]);
    }
  }

  // Calculate background color center and covariance/distance threshold
  let bgR = 0, bgG = 0, bgB = 0;
  for (const s of bgSamples) {
    bgR += s[0];
    bgG += s[1];
    bgB += s[2];
  }
  bgR /= bgSamples.length;
  bgG /= bgSamples.length;
  bgB /= bgSamples.length;

  console.log(`Average background color: R=${bgR.toFixed(1)}, G=${bgG.toFixed(1)}, B=${bgB.toFixed(1)}`);

  // 3. Saliency / Foreground Mask Generation
  // Pixels in center region (x: 12%..88%, y: 15%..95%)
  const fgMask = new Float32Array(numPixels);

  // Dilate skin to find head/neck/body anchors
  const dilatedSkin = new Uint8Array(numPixels);
  const radSkin = 12;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      if (isSkin[y * w + x] === 1) {
        for (let dy = -radSkin; dy <= radSkin; dy += 2) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -radSkin; dx <= radSkin; dx += 2) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            if (dx * dx + dy * dy <= radSkin * radSkin) {
              dilatedSkin[ny * w + nx] = 1;
            }
          }
        }
      }
    }
  }

  // Find vertical bounding span of people
  let minSkinY = h, maxSkinY = 0;
  let minSkinX = w, maxSkinX = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isSkin[y * w + x] === 1) {
        if (y < minSkinY) minSkinY = y;
        if (y > maxSkinY) maxSkinY = y;
        if (x < minSkinX) minSkinX = x;
        if (x > maxSkinX) maxSkinX = x;
      }
    }
  }
  console.log(`Detected human subjects span: X=[${minSkinX}, ${maxSkinX}], Y=[${minSkinY}, ${maxSkinY}]`);

  // Hair span is above and around face; body/clothing extends downward
  const headTop = Math.max(0, minSkinY - Math.floor((maxSkinY - minSkinY) * 0.45));
  const bodyBottom = Math.min(h - 1, maxSkinY + Math.floor((maxSkinY - minSkinY) * 1.5));
  const bodyLeft = Math.max(0, minSkinX - Math.floor(w * 0.1));
  const bodyRight = Math.min(w - 1, maxSkinX + Math.floor(w * 0.1));

  console.log(`Subject bounding volume: X=[${bodyLeft}, ${bodyRight}], Y=[${headTop}, ${bodyBottom}]`);

  // Compute foreground probability
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const inY = y >= headTop && y <= bodyBottom;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      const inX = x >= bodyLeft && x <= bodyRight;

      if (!inY || !inX) {
        fgMask[idx] = 0;
        continue;
      }

      // Check distance from border background
      const dR = r[idx] - bgR;
      const dG = g[idx] - bgG;
      const dB = b[idx] - bgB;
      const colorDist = Math.hypot(dR, dG, dB);

      // Check greenness/foliage (grass is usually high G relative to R and B)
      const isFoliage = (g[idx] > r[idx] * 1.05 && g[idx] > b[idx] * 1.1 && g[idx] > 50);

      if (dilatedSkin[idx] === 1) {
        // Direct skin or adjacent (face, ear, neck, arm, hand, baby)
        fgMask[idx] = 1.0;
      } else if (isFoliage) {
        fgMask[idx] = 0.0;
      } else {
        // Clothing / hair / accessories:
        // Hair is dark (low gray) above or next to skin
        const isDarkHair = gray[idx] < 0.35 && y <= maxSkinY;
        // Clothing differs from background
        if (isDarkHair) {
          fgMask[idx] = 1.0;
        } else if (colorDist > 35) {
          // Strong color difference from background
          fgMask[idx] = 0.9;
        } else {
          fgMask[idx] = 0.2;
        }
      }
    }
  }

  // Smooth foreground mask with 8px box blur
  const smoothedMask = new Float32Array(numPixels);
  const blurR = 12;
  // Simple horizontal pass
  const tempMask = new Float32Array(numPixels);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dx = -blurR; dx <= blurR; dx += 2) {
        const nx = x + dx;
        if (nx >= 0 && nx < w) {
          sum += fgMask[row + nx];
          count++;
        }
      }
      tempMask[row + x] = sum / count;
    }
  }
  // Vertical pass
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, count = 0;
      for (let dy = -blurR; dy <= blurR; dy += 2) {
        const ny = y + dy;
        if (ny >= 0 && ny < h) {
          sum += tempMask[ny * w + x];
          count++;
        }
      }
      smoothedMask[y * w + x] = sum / count;
    }
  }

  // 4. STAGE 1: HIGH QUALITY PENCIL SKETCH RENDERING
  // Using bilateral-like DoG + tonal shading on foreground
  // Calculate Gaussian blur of grayscale
  function gBlur(src, sigma) {
    const dst = new Float32Array(numPixels);
    const tmp = new Float32Array(numPixels);
    const rad = Math.ceil(sigma * 2.5);
    const kern = [];
    let s = 0;
    for (let i = -rad; i <= rad; i++) {
      const v = Math.exp(-(i * i) / (2 * sigma * sigma));
      kern.push(v);
      s += v;
    }
    for (let i = 0; i < kern.length; i++) kern[i] /= s;

    // H
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
    // V
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

  // Compute Color-Dodge Sketch
  const inverted = new Float32Array(numPixels);
  for (let i = 0; i < numPixels; i++) inverted[i] = 1.0 - gray[i];
  const blurredInverted = gBlur(inverted, 12.0);

  const dodge = new Float32Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    const base = gray[i];
    const bld = blurredInverted[i];
    let v = 1.0;
    if (bld < 1.0) {
      v = Math.min(1.0, base / (1.0 - bld + 1e-4));
    }
    dodge[i] = Math.pow(v, 1.6);
  }

  // Difference of Gaussians for crisp line edges
  const g1 = gBlur(gray, 1.2);
  const g2 = gBlur(gray, 2.8);

  const sketchRgb = Buffer.alloc(numPixels * 3);
  for (let i = 0; i < numPixels; i++) {
    const mask = smoothedMask[i];
    if (mask < 0.1) {
      // Clean white paper in background!
      sketchRgb[i * 3] = 255;
      sketchRgb[i * 3 + 1] = 255;
      sketchRgb[i * 3 + 2] = 255;
      continue;
    }

    // Line edge from DoG
    const dog = g1[i] - 0.98 * g2[i];
    let lineVal = 1.0;
    if (dog < -0.012) {
      lineVal = Math.max(0.0, 1.0 + dog * 12.0);
    }

    // Combine color-dodge tonal graphite and crisp lines
    const toneVal = dodge[i];
    let combined = Math.min(lineVal, toneVal);

    // Apply subject mask so edges fade softly to white at boundaries
    const finalVal = 1.0 - (1.0 - combined) * Math.min(1.0, mask * 1.5);
    const byteVal = Math.round(Math.min(255, Math.max(0, finalVal * 255)));

    sketchRgb[i * 3] = byteVal;
    sketchRgb[i * 3 + 1] = byteVal;
    sketchRgb[i * 3 + 2] = byteVal;
  }

  await sharp(sketchRgb, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile('clean_subject_sketch.png');

  console.log('Saved clean_subject_sketch.png successfully!');
}

runPipeline().catch(console.error);
