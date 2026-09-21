import { DrawingStyle } from '../types';

interface HandConfig {
  file: string;
  tipX: number;
  tipY: number;
  scale: number;
  baseAngle: number; // in radians
}

const HAND_CONFIGS: Record<DrawingStyle, HandConfig> = {
  pencil: {
    file: '/assets/hand_pencil.png',
    tipX: 149,
    tipY: 866,
    scale: 0.58, // scaled relative to paper dimensions
    baseAngle: 0
  },
  charcoal: {
    file: '/assets/hand_charcoal.png',
    tipX: 314,
    tipY: 571,
    scale: 0.62,
    baseAngle: 0
  },
  fineliner: {
    file: '/assets/hand_fineliner.png',
    tipX: 342,
    tipY: 748,
    scale: 0.56,
    baseAngle: 0
  }
};

export class HandRenderer {
  private images: Partial<Record<DrawingStyle, HTMLImageElement>> = {};
  private currentAngle: number = 0;
  private currentLift: number = 0; // 0 (touching paper) to 1 (lifted)
  private loaded: boolean = false;

  constructor() {
    this.preload();
  }

  public async preload(): Promise<void> {
    const promises = (['pencil', 'charcoal', 'fineliner'] as DrawingStyle[]).map(
      (style) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.src = HAND_CONFIGS[style].file;
          img.onload = () => {
            this.images[style] = img;
            resolve();
          };
          img.onerror = () => {
            console.warn(`Could not load hand image for ${style}`);
            resolve();
          };
        })
    );

    await Promise.all(promises);
    this.loaded = true;
  }

  public isReady(): boolean {
    return this.loaded;
  }

  /**
   * Render the realistic hand, pencil, and dual-layer realistic contact shadow
   * @param ctx Overlay canvas context
   * @param x Target drawing X on paper
   * @param y Target drawing Y on paper
   * @param isDrawing True if pencil lead is actively marking paper
   * @param vx Velocity X of the stroke
   * @param vy Velocity Y of the stroke
   * @param style Drawing style ('pencil' | 'charcoal' | 'fineliner')
   * @param time Current animation time in seconds
   * @param paperScale Canvas scale factor relative to native resolution
   */
  public render(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    isDrawing: boolean,
    vx: number,
    vy: number,
    style: DrawingStyle,
    time: number,
    paperScale: number = 1
  ) {
    const img = this.images[style] || this.images['pencil'];
    if (!img) return;

    const config = HAND_CONFIGS[style];

    // 1. Natural hand rotation response to stroke direction (wrist articulation)
    const targetAngle = Math.max(-0.18, Math.min(0.18, vx * 0.015 - vy * 0.008));
    this.currentAngle += (targetAngle - this.currentAngle) * 0.12;

    // 2. Smooth lift transition between strokes (pencil elevation)
    const targetLift = isDrawing ? 0 : 1;
    this.currentLift += (targetLift - this.currentLift) * 0.18;

    // Micro-human physiological tremor (pink-noise / multi-frequency sinusoidal breathing & pulse)
    const tremorX = Math.sin(time * 18.5) * 0.6 + Math.cos(time * 7.2) * 0.4;
    const tremorY = Math.cos(time * 15.3) * 0.5 + Math.sin(time * 9.1) * 0.4;

    // Height above paper when lifted (in pixels)
    const liftOffset = this.currentLift * 24 * paperScale;

    // Pencil tip placement on paper
    const drawX = x + tremorX;
    const drawY = y + tremorY;

    // Hand position when lifted pulls slightly up and to the right (natural biomechanics of wrist)
    const handX = drawX + this.currentLift * 8 * paperScale;
    const handY = drawY - liftOffset;

    const renderScale = config.scale * paperScale;
    const tipOffsetX = config.tipX * renderScale;
    const tipOffsetY = config.tipY * renderScale;

    ctx.save();

    // -------------------------------------------------------------
    // LAYER 1: Cast Shadow onto Paper & Art Board
    // Directional light from top-left desk lamp: shadow casts down-right
    // -------------------------------------------------------------
    ctx.save();
    const shadowDistance = (12 + this.currentLift * 30) * paperScale;
    const shadowBlur = (8 + this.currentLift * 18) * paperScale;
    const shadowAlpha = Math.max(0.12, 0.38 - this.currentLift * 0.2);

    ctx.translate(handX + shadowDistance * 0.8, handY + shadowDistance * 0.9);
    ctx.rotate(this.currentAngle + 0.02);

    // Render soft silhouette shadow of the hand
    ctx.filter = `blur(${shadowBlur}px)`;
    ctx.globalAlpha = shadowAlpha;
    ctx.fillStyle = '#1e1c18';

    // Draw shadow using a tinted version of the hand or offscreen blur
    // Using canvas globalCompositeOperation tint
    ctx.drawImage(
      img,
      -tipOffsetX,
      -tipOffsetY,
      img.naturalWidth * renderScale,
      img.naturalHeight * renderScale
    );
    ctx.restore();

    // -------------------------------------------------------------
    // LAYER 2: Crisp Pencil Tip Contact Shadow
    // When the pencil lead is on the paper, there is a tiny, intense contact shadow directly at the tip
    // When lifted, the tip shadow separates from the tip and diffuses
    // -------------------------------------------------------------
    ctx.save();
    const tipShadowDist = (1.5 + this.currentLift * 16) * paperScale;
    const tipShadowAlpha = Math.max(0, 0.65 - this.currentLift * 0.5);

    if (tipShadowAlpha > 0.05) {
      const grad = ctx.createRadialGradient(
        drawX + tipShadowDist,
        drawY + tipShadowDist * 0.8,
        0,
        drawX + tipShadowDist,
        drawY + tipShadowDist * 0.8,
        (4 + this.currentLift * 8) * paperScale
      );
      grad.addColorStop(0, `rgba(30, 25, 20, ${tipShadowAlpha})`);
      grad.addColorStop(1, 'rgba(30, 25, 20, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(
        drawX + tipShadowDist,
        drawY + tipShadowDist * 0.8,
        (4 + this.currentLift * 8) * paperScale,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();

    // -------------------------------------------------------------
    // LAYER 3: The Photorealistic Hand & Pencil
    // -------------------------------------------------------------
    ctx.save();
    ctx.translate(handX, handY);
    ctx.rotate(this.currentAngle);

    // Subtle warm ambient lighting from desk lamp
    ctx.filter = 'drop-shadow(2px 3px 6px rgba(0, 0, 0, 0.15))';
    ctx.drawImage(
      img,
      -tipOffsetX,
      -tipOffsetY,
      img.naturalWidth * renderScale,
      img.naturalHeight * renderScale
    );

    ctx.restore();
    ctx.restore();
  }
}

export const handRenderer = new HandRenderer();
