import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const imagesDir = path.resolve('src/assets/images');
const outputDir = path.resolve('public/assets');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Copy desk texture to public/assets/desk.jpg
const deskFile = fs.readdirSync(imagesDir).find(f => f.startsWith('artist_wood_desk'));
if (deskFile) {
  fs.copyFileSync(path.join(imagesDir, deskFile), path.join(outputDir, 'desk.jpg'));
  console.log('Copied desk texture to public/assets/desk.jpg');
}

// Copy sample portrait to public/assets/sample-portrait.jpg
const portraitFile = fs.readdirSync(imagesDir).find(f => f.startsWith('sample_portrait'));
if (portraitFile) {
  fs.copyFileSync(path.join(imagesDir, portraitFile), path.join(outputDir, 'sample-portrait.jpg'));
  console.log('Copied sample portrait to public/assets/sample-portrait.jpg');
}

const handFiles = [
  { name: 'pencil', prefix: 'artist_hand_pencil' },
  { name: 'charcoal', prefix: 'artist_hand_charcoal_v2' },
  { name: 'fineliner', prefix: 'artist_hand_fineliner_v2' }
];

async function processHand(item) {
  const file = fs.readdirSync(imagesDir).find(f => f.startsWith(item.prefix));
  if (!file) {
    console.warn(`File for ${item.name} not found`);
    return null;
  }

  const inputPath = path.join(imagesDir, file);
  console.log(`Processing ${file}...`);

  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const outputBuffer = Buffer.from(data);

  // Sample corner to detect green screen key color
  let sampleR = 0, sampleG = 0, sampleB = 0, samples = 0;
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const idx = (y * width + x) * channels;
      sampleR += data[idx];
      sampleG += data[idx + 1];
      sampleB += data[idx + 2];
      samples++;
    }
  }
  const keyR = sampleR / samples;
  const keyG = sampleG / samples;
  const keyB = sampleB / samples;
  console.log(`Key color for ${item.name}: R=${keyR.toFixed(1)}, G=${keyG.toFixed(1)}, B=${keyB.toFixed(1)}`);

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const maxRB = Math.max(r, b);
    const greenDiff = g - maxRB;

    // Green screen distance
    if (greenDiff > 35) {
      // Background
      outputBuffer[i + 3] = 0;
    } else if (greenDiff > 12) {
      // Feather edge
      const alphaFraction = 1 - (greenDiff - 12) / 23;
      outputBuffer[i + 3] = Math.round(alphaFraction * 255);
      outputBuffer[i + 1] = Math.min(g, maxRB + 5);
    } else {
      // Solid subject
      outputBuffer[i + 3] = 255;
      if (g > maxRB && g > 75) {
        outputBuffer[i + 1] = Math.round(maxRB * 0.95);
      }
    }
  }

  // Find the exact tip of the drawing tool
  // The hand enters from the top-right / right side, and the pencil/charcoal/fineliner points down-left
  // So the tip is the non-transparent pixel with minimum (x + y*0.6) or minimum (x + (height - y)*0.4)
  // Let's filter only pixels with high alpha
  let candidates = [];
  let minX = width, maxX = 0, minY = height, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      if (outputBuffer[idx + 3] > 180) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // Weight towards bottom-left / lower-left region where pencil touches paper
        const distToCorner = Math.hypot(x, y - height * 0.8);
        candidates.push({ x, y, score: distToCorner + x * 0.5 });
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const bestCandidate = candidates[0] || { x: minX, y: maxY };

  // For high precision, find local minimum in a 10px radius
  const tipX = bestCandidate.x;
  const tipY = bestCandidate.y;

  const outFileName = `hand_${item.name}.png`;
  const outFilePath = path.join(outputDir, outFileName);

  await sharp(outputBuffer, {
    raw: { width, height, channels }
  })
    .png({ compressionLevel: 8 })
    .toFile(outFilePath);

  console.log(`Saved ${outFileName}. BBox: [${minX}, ${minY}, ${maxX}, ${maxY}], tip: (${tipX}, ${tipY})`);

  return {
    style: item.name,
    file: `/assets/${outFileName}`,
    width,
    height,
    bbox: { minX, minY, maxX, maxY },
    tip: { x: tipX, y: tipY }
  };
}

async function run() {
  const meta = {};
  for (const item of handFiles) {
    const res = await processHand(item);
    if (res) meta[item.name] = res;
  }
  fs.writeFileSync(path.join(outputDir, 'hands-meta.json'), JSON.stringify(meta, null, 2));
  console.log('Done processing all hands!');
}

run().catch(console.error);
