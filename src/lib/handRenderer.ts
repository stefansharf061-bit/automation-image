import { DrawingStyle } from '../types';

interface HandConfig {
  file: string;
  tipX: number;
  tipY: number;
  wristX: number;
  wristY: number;
  scale: number;
  baseAngle: number;
  // Forearm cut edge description in asset coordinates (1024x1024)
  cutEdge: {
    type: 'right' | 'top-right' | 'bottom';
    min: number;
    max: number;
  };
  skinColors: {
    highlight: string;
    mid: string;
    shadow: string;
  };
}

const HAND_CONFIGS: Record<DrawingStyle, HandConfig> = {
  pencil: {
    file: '/assets/hand_pencil.png',
    tipX: 147,
    tipY: 871,
    wristX: 720,
    wristY: 380,
    scale: 0.82,
    baseAngle: -0.02,
    cutEdge: {
      type: 'right',
      min: 211,
      max: 488
    },
    skinColors: {
      highlight: '#d5aa89',
      mid: '#a37557',
      shadow: '#66432c'
    }
  },
  charcoal: {
    file: '/assets/hand_charcoal.png',
    tipX: 397,
    tipY: 895,
    wristX: 780,
    wristY: 240,
    scale: 0.86,
    baseAngle: 0.04,
    cutEdge: {
      type: 'top-right',
      min: 0,
      max: 260
    },
    skinColors: {
      highlight: '#c8a68b',
      mid: '#966d51',
      shadow: '#5e402b'
    }
  },
  fineliner: {
    file: '/assets/hand_fineliner.png',
    tipX: 634,
    tipY: 897,
    wristX: 540,
    wristY: 680,
    scale: 0.8,
    baseAngle: 0.0,
    cutEdge: {
      type: 'bottom',
      min: 419,
      max: 672
    },
    skinColors: {
      highlight: '#d5b397',
      mid: '#a3795b',
      shadow: '#64442e'
    }
  }
};

export class HandRenderer {
  private images: Partial<Record<DrawingStyle, HTMLImageElement>> = {};
  private currentAngle: number = 0;
  private currentLift: number = 0;
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
   * Render the realistic hand, pencil, and dual-layer contact shadow with off-screen pivot physics
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
    const canvasW = ctx.canvas.width;
    const canvasH = ctx.canvas.height;

    // -------------------------------------------------------------
    // 1. Off-Screen Wrist & Forearm Pivot Kinematics
    // The wrist and forearm rotate around an off-screen pivot point
    // located down-right from the drawing board (representing the artist's forearm/desk anchor).
    // -------------------------------------------------------------
    const wristPivotX = canvasW * 1.38;
    const wristPivotY = canvasH * 1.28;

    // Vector from off-screen wrist pivot point to pencil contact point
    const armAngle = Math.atan2(y - wristPivotY, x - wristPivotX);
    const centerAngle = Math.atan2(canvasH * 0.5 - wristPivotY, canvasW * 0.5 - wristPivotX);

    // Anatomical sweep: natural angle change as the arm reaches across the art paper
    const sweepAngle = (armAngle - centerAngle) * 0.38;

    // Biomechanical micro-wrist flexion responding dynamically to stroke drawing vector
    const speed = Math.hypot(vx, vy);
    const strokeAngle = Math.atan2(vy, vx);
    const wristDeflection = speed > 6
      ? Math.sin(strokeAngle - armAngle) * Math.min(0.055, speed * 0.00032)
      : 0;

    const targetAngle = config.baseAngle + sweepAngle + wristDeflection;
    this.currentAngle += (targetAngle - this.currentAngle) * 0.14;

    // 2. Strict Pencil Tip Synchronization
    // When drawing, contact is 100% authoritative: zero lift offset, zero tremor jitter.
    // When lifted between strokes, the pencil naturally floats up and glides.
    let handX: number;
    let handY: number;

    if (isDrawing) {
      this.currentLift = 0;
      handX = x;
      handY = y;
    } else {
      this.currentLift = Math.min(1.0, this.currentLift + 0.15);
      const liftOffset = this.currentLift * 24 * paperScale;
      handX = x + this.currentLift * 8 * paperScale;
      handY = y - liftOffset;
    }

    const renderScale = config.scale * paperScale;
    const wristOffsetX = config.wristX * renderScale;
    const wristOffsetY = config.wristY * renderScale;

    // Calculate rotation around the wrist pivot point:
    // Vector from wrist joint to pencil tip on the sprite
    const tipRelX = (config.tipX - config.wristX) * renderScale;
    const tipRelY = (config.tipY - config.wristY) * renderScale;

    const cosA = Math.cos(this.currentAngle);
    const sinA = Math.sin(this.currentAngle);

    // Tip position relative to wrist when rotated by currentAngle
    const rotTipX = tipRelX * cosA - tipRelY * sinA;
    const rotTipY = tipRelX * sinA + tipRelY * cosA;

    // World wrist pivot position so rotated tip lands with sub-pixel precision at handX, handY
    const wristWorldX = handX - rotTipX;
    const wristWorldY = handY - rotTipY;

    // -------------------------------------------------------------
    // LAYER 1: Cast Shadow onto Paper & Art Board
    // Light from top-left studio lamp casts soft shadow down-right
    // -------------------------------------------------------------
    ctx.save();
    const shadowDist = (12 + this.currentLift * 26) * paperScale;
    const shadowBlur = (7 + this.currentLift * 16) * paperScale;
    const shadowAlpha = Math.max(0.1, 0.36 - this.currentLift * 0.18);

    ctx.translate(wristWorldX + shadowDist * 0.85, wristWorldY + shadowDist * 0.95);
    ctx.rotate(this.currentAngle + 0.02);

    ctx.filter = `blur(${shadowBlur}px)`;
    ctx.globalAlpha = shadowAlpha;

    // Hand shadow
    ctx.drawImage(
      img,
      -wristOffsetX,
      -wristOffsetY,
      img.naturalWidth * renderScale,
      img.naturalHeight * renderScale
    );

    // Extended forearm shadow
    this.renderForearmExtension(ctx, config, renderScale, wristOffsetX, wristOffsetY, true);

    ctx.restore();

    // -------------------------------------------------------------
    // LAYER 2: Crisp Pencil Lead Contact Shadow
    // Directly under pencil point when touching paper
    // -------------------------------------------------------------
    ctx.save();
    const tipShadowDist = (1.5 + this.currentLift * 14) * paperScale;
    const tipShadowAlpha = isDrawing ? 0.75 : Math.max(0, 0.45 - this.currentLift * 0.45);

    if (tipShadowAlpha > 0.04) {
      const grad = ctx.createRadialGradient(
        handX + tipShadowDist,
        handY + tipShadowDist * 0.85,
        0,
        handX + tipShadowDist,
        handY + tipShadowDist * 0.85,
        (3.5 + this.currentLift * 7) * paperScale
      );
      grad.addColorStop(0, `rgba(32, 26, 22, ${tipShadowAlpha})`);
      grad.addColorStop(1, 'rgba(32, 26, 22, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(
        handX + tipShadowDist,
        handY + tipShadowDist * 0.85,
        (3.5 + this.currentLift * 7) * paperScale,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();

    // -------------------------------------------------------------
    // LAYER 3: Photographic Hand & Extended Forearm Continuity
    // Rotated around off-screen wrist pivot, tip locks precisely to drawing path
    // -------------------------------------------------------------
    ctx.save();
    ctx.translate(wristWorldX, wristWorldY);
    ctx.rotate(this.currentAngle);

    // 3A. Extended Forearm Continuity (underneath photo asset)
    this.renderForearmExtension(ctx, config, renderScale, wristOffsetX, wristOffsetY, false);

    // 3B. Photographic hand & pencil sprite
    ctx.drawImage(
      img,
      -wristOffsetX,
      -wristOffsetY,
      img.naturalWidth * renderScale,
      img.naturalHeight * renderScale
    );

    // 3C. Seam Blending Overlay: Feather the cut edge of the photographic asset
    this.renderSeamBlend(ctx, config, renderScale, wristOffsetX, wristOffsetY);

    ctx.restore();
  }

  /**
   * Render an organic forearm cylinder extending seamlessly from the PNG cut boundary
   * all the way off-screen (2500px length) to eliminate any visible cut-off or severed arm edge.
   */
  private renderForearmExtension(
    ctx: CanvasRenderingContext2D,
    config: HandConfig,
    scale: number,
    wristOffsetX: number,
    wristOffsetY: number,
    isShadow: boolean
  ) {
    const extLength = 2600 * scale;

    if (config.cutEdge.type === 'right') {
      // Right edge cut (pencil): x = 1024, y from min to max relative to wrist pivot
      const seamX = (1024 * scale) - wristOffsetX;
      const seamY1 = (config.cutEdge.min * scale) - wristOffsetY;
      const seamY2 = (config.cutEdge.max * scale) - wristOffsetY;
      const armWidth = seamY2 - seamY1;

      // Extend down and right along the arm trajectory off-screen
      const endX = seamX + extLength * 0.95;
      const endY1 = seamY1 + extLength * 0.45;
      const endY2 = endY1 + armWidth * 1.25;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(seamX - 35 * scale, seamY1 - 5 * scale);
      ctx.lineTo(endX, endY1);
      ctx.lineTo(endX, endY2);
      ctx.lineTo(seamX - 35 * scale, seamY2 + 10 * scale);
      ctx.closePath();

      if (isShadow) {
        ctx.fillStyle = '#1e1c18';
        ctx.fill();
      } else {
        // Natural transition: skin near wrist -> dark artist smock sleeve
        const sleeveStartX = seamX + 90 * scale;
        const sleeveEndX = seamX + 130 * scale;

        // Base skin arm
        const skinGrad = ctx.createLinearGradient(seamX, seamY1, seamX, seamY2);
        skinGrad.addColorStop(0, config.skinColors.highlight);
        skinGrad.addColorStop(0.42, config.skinColors.mid);
        skinGrad.addColorStop(1, config.skinColors.shadow);
        ctx.fillStyle = skinGrad;
        ctx.fill();

        // Dark artist sweater / smock sleeve extending off-screen
        ctx.beginPath();
        ctx.moveTo(sleeveStartX, seamY1 + (endY1 - seamY1) * (sleeveStartX - seamX) / extLength - 8 * scale);
        ctx.lineTo(endX, endY1);
        ctx.lineTo(endX, endY2);
        ctx.lineTo(sleeveStartX, seamY2 + (endY2 - seamY2) * (sleeveStartX - seamX) / extLength + 10 * scale);
        ctx.closePath();

        const sleeveGrad = ctx.createLinearGradient(sleeveStartX, seamY1, endX, endY2);
        sleeveGrad.addColorStop(0, '#23272f');
        sleeveGrad.addColorStop(0.3, '#1c1f26');
        sleeveGrad.addColorStop(1, '#13151a');
        ctx.fillStyle = sleeveGrad;
        ctx.fill();

        // Sleeve cuff rim highlight
        ctx.beginPath();
        ctx.ellipse(
          sleeveStartX,
          (seamY1 + seamY2) * 0.5 + 25 * scale,
          10 * scale,
          armWidth * 0.55,
          0.38,
          0,
          Math.PI * 2
        );
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fill();
      }
      ctx.restore();
    } else if (config.cutEdge.type === 'top-right') {
      // Top-right cut (charcoal)
      const seamX = (1024 * scale) - wristOffsetX;
      const seamY = (config.cutEdge.min * scale) - wristOffsetY;
      const armWidth = 280 * scale;

      const endX = seamX + extLength * 0.9;
      const endY = seamY + extLength * 0.35;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(seamX - 35 * scale, seamY - 30 * scale);
      ctx.lineTo(endX, endY - 30 * scale);
      ctx.lineTo(endX, endY + armWidth * 1.3);
      ctx.lineTo(seamX - 35 * scale, seamY + armWidth);
      ctx.closePath();

      if (isShadow) {
        ctx.fillStyle = '#1e1c18';
        ctx.fill();
      } else {
        const grad = ctx.createLinearGradient(seamX, seamY, seamX, seamY + armWidth);
        grad.addColorStop(0, config.skinColors.highlight);
        grad.addColorStop(0.45, config.skinColors.mid);
        grad.addColorStop(1, config.skinColors.shadow);
        ctx.fillStyle = grad;
        ctx.fill();

        // Dark artist sleeve continuation
        const sleeveStartX = seamX + 80 * scale;
        ctx.beginPath();
        ctx.moveTo(sleeveStartX, seamY - 20 * scale);
        ctx.lineTo(endX, endY - 30 * scale);
        ctx.lineTo(endX, endY + armWidth * 1.3);
        ctx.lineTo(sleeveStartX, seamY + armWidth + 10 * scale);
        ctx.closePath();
        ctx.fillStyle = '#1e2129';
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Bottom cut (fineliner)
      const seamY = (1024 * scale) - wristOffsetY;
      const seamX1 = (config.cutEdge.min * scale) - wristOffsetX;
      const seamX2 = (config.cutEdge.max * scale) - wristOffsetX;
      const armWidth = seamX2 - seamX1;

      const endY = seamY + extLength * 0.9;
      const endX1 = seamX1 + extLength * 0.35;
      const endX2 = endX1 + armWidth * 1.25;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(seamX1, seamY - 35 * scale);
      ctx.lineTo(endX1, endY);
      ctx.lineTo(endX2, endY);
      ctx.lineTo(seamX2, seamY - 35 * scale);
      ctx.closePath();

      if (isShadow) {
        ctx.fillStyle = '#1e1c18';
        ctx.fill();
      } else {
        const grad = ctx.createLinearGradient(seamX1, seamY, seamX2, seamY);
        grad.addColorStop(0, config.skinColors.highlight);
        grad.addColorStop(0.5, config.skinColors.mid);
        grad.addColorStop(1, config.skinColors.shadow);
        ctx.fillStyle = grad;
        ctx.fill();

        // Dark artist sleeve continuation
        const sleeveStartY = seamY + 80 * scale;
        ctx.beginPath();
        ctx.moveTo(seamX1 - 10 * scale, sleeveStartY);
        ctx.lineTo(endX1, endY);
        ctx.lineTo(endX2, endY);
        ctx.lineTo(seamX2 + 10 * scale, sleeveStartY);
        ctx.closePath();
        ctx.fillStyle = '#1c1f26';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * Render feathered seam blend directly over the cut edge of the photographic asset
   * to guarantee no hard rectangular edge is ever visible to the user.
   */
  private renderSeamBlend(
    ctx: CanvasRenderingContext2D,
    config: HandConfig,
    scale: number,
    wristOffsetX: number,
    wristOffsetY: number
  ) {
    ctx.save();
    if (config.cutEdge.type === 'right') {
      const seamX = (1024 * scale) - wristOffsetX;
      const seamY1 = (config.cutEdge.min * scale) - wristOffsetY;
      const seamY2 = (config.cutEdge.max * scale) - wristOffsetY;

      // Soft vertical feather band covering x = seamX - 25 to seamX + 25
      const blend = ctx.createLinearGradient(seamX - 35 * scale, 0, seamX + 20 * scale, 0);
      blend.addColorStop(0, 'rgba(163, 117, 87, 0)');
      blend.addColorStop(0.55, 'rgba(163, 117, 87, 0.85)');
      blend.addColorStop(1, 'rgba(35, 39, 47, 0.95)');

      ctx.fillStyle = blend;
      ctx.fillRect(seamX - 35 * scale, seamY1 - 15 * scale, 65 * scale, (seamY2 - seamY1) + 30 * scale);
    } else if (config.cutEdge.type === 'top-right') {
      const seamX = (1024 * scale) - wristOffsetX;
      const seamY = (config.cutEdge.min * scale) - wristOffsetY;
      const blend = ctx.createLinearGradient(seamX - 35 * scale, seamY - 20 * scale, seamX + 20 * scale, seamY + 20 * scale);
      blend.addColorStop(0, 'rgba(150, 109, 81, 0)');
      blend.addColorStop(0.5, 'rgba(150, 109, 81, 0.85)');
      blend.addColorStop(1, 'rgba(30, 33, 41, 0.95)');
      ctx.fillStyle = blend;
      ctx.fillRect(seamX - 35 * scale, seamY - 25 * scale, 65 * scale, 320 * scale);
    } else {
      const seamY = (1024 * scale) - wristOffsetY;
      const seamX1 = (config.cutEdge.min * scale) - wristOffsetX;
      const seamX2 = (config.cutEdge.max * scale) - wristOffsetX;
      const blend = ctx.createLinearGradient(0, seamY - 35 * scale, 0, seamY + 20 * scale);
      blend.addColorStop(0, 'rgba(163, 121, 91, 0)');
      blend.addColorStop(0.5, 'rgba(163, 121, 91, 0.85)');
      blend.addColorStop(1, 'rgba(28, 31, 38, 0.95)');
      ctx.fillStyle = blend;
      ctx.fillRect(seamX1 - 15 * scale, seamY - 35 * scale, (seamX2 - seamX1) + 30 * scale, 65 * scale);
    }
    ctx.restore();
  }
}

export const handRenderer = new HandRenderer();
