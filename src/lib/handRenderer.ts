import { DrawingStyle } from '../types';

interface HandConfig {
  file: string;
  tipX: number;
  tipY: number;
  wristX: number;
  wristY: number;
  scale: number;
  baseAngle: number;
}

const HAND_CONFIGS: Record<DrawingStyle, HandConfig> = {
  pencil: {
    file: '/assets/hand_pencil.png',
    tipX: 149,
    tipY: 868,
    wristX: 720,
    wristY: 380,
    scale: 1.05,
    baseAngle: -0.02
  },
  charcoal: {
    file: '/assets/hand_charcoal.png',
    tipX: 398,
    tipY: 896,
    wristX: 780,
    wristY: 240,
    scale: 1.05,
    baseAngle: 0.04
  },
  fineliner: {
    file: '/assets/hand_fineliner.png',
    tipX: 636,
    tipY: 899,
    wristX: 540,
    wristY: 680,
    scale: 1.0,
    baseAngle: 0.0
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
   * Render the realistic hand and pencil with strict tip synchronization.
   * The forearm enters from outside the visible camera frame edge.
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

    // 1. Off-screen wrist and forearm anchor kinematics
    // The forearm enters from outside the bottom-right frame edge
    const wristPivotX = canvasW * 1.25;
    const wristPivotY = canvasH * 1.2;

    const armAngle = Math.atan2(y - wristPivotY, x - wristPivotX);
    const centerAngle = Math.atan2(canvasH * 0.5 - wristPivotY, canvasW * 0.5 - wristPivotX);

    // Subtle anatomical sweep as the hand reaches across the paper
    const sweepAngle = (armAngle - centerAngle) * 0.32;

    // Biomechanical wrist micro-flexion responding to drawing vector
    const speed = Math.hypot(vx, vy);
    const strokeAngle = Math.atan2(vy, vx);
    const wristDeflection =
      speed > 6 ? Math.sin(strokeAngle - armAngle) * Math.min(0.045, speed * 0.00028) : 0;

    const targetAngle = config.baseAngle + sweepAngle + wristDeflection;
    this.currentAngle += (targetAngle - this.currentAngle) * 0.16;

    // 2. Strict Pencil Tip Synchronization
    // When drawing, contact is 100% locked to (x, y): zero lift offset, zero delay.
    let handX: number;
    let handY: number;

    if (isDrawing) {
      this.currentLift = 0;
      handX = x;
      handY = y;
    } else {
      this.currentLift = Math.min(1.0, this.currentLift + 0.18);
      const liftOffset = this.currentLift * 18 * paperScale;
      handX = x + this.currentLift * 6 * paperScale;
      handY = y - liftOffset;
    }

    const renderScale = config.scale * paperScale;
    const wristOffsetX = config.wristX * renderScale;
    const wristOffsetY = config.wristY * renderScale;

    // Calculate rotation around wrist joint so tip lands at (handX, handY)
    const tipRelX = (config.tipX - config.wristX) * renderScale;
    const tipRelY = (config.tipY - config.wristY) * renderScale;

    const cosA = Math.cos(this.currentAngle);
    const sinA = Math.sin(this.currentAngle);

    const rotTipX = tipRelX * cosA - tipRelY * sinA;
    const rotTipY = tipRelX * sinA + tipRelY * cosA;

    const wristWorldX = handX - rotTipX;
    const wristWorldY = handY - rotTipY;

    // -------------------------------------------------------------
    // LAYER 1: Natural Ambient Cast Shadow
    // Soft shadow cast by overhead studio lighting onto paper and board
    // -------------------------------------------------------------
    ctx.save();
    const shadowDist = (8 + this.currentLift * 16) * paperScale;
    const shadowBlur = (6 + this.currentLift * 12) * paperScale;
    const shadowAlpha = Math.max(0.06, 0.28 - this.currentLift * 0.14);

    ctx.translate(wristWorldX + shadowDist * 0.75, wristWorldY + shadowDist * 0.85);
    ctx.rotate(this.currentAngle + 0.015);
    ctx.filter = `blur(${shadowBlur}px)`;
    ctx.globalAlpha = shadowAlpha;

    ctx.drawImage(
      img,
      -wristOffsetX,
      -wristOffsetY,
      img.naturalWidth * renderScale,
      img.naturalHeight * renderScale
    );
    ctx.restore();

    // -------------------------------------------------------------
    // LAYER 2: Crisp Pencil Lead Contact Point Shadow
    // Directly under the lead tip when in contact with the paper
    // -------------------------------------------------------------
    ctx.save();
    const tipShadowAlpha = isDrawing ? 0.8 : Math.max(0, 0.4 - this.currentLift * 0.4);
    if (tipShadowAlpha > 0.05) {
      const tipShadowDist = (1.2 + this.currentLift * 10) * paperScale;
      const radius = (3.0 + this.currentLift * 5) * paperScale;
      const grad = ctx.createRadialGradient(
        handX + tipShadowDist,
        handY + tipShadowDist * 0.85,
        0,
        handX + tipShadowDist,
        handY + tipShadowDist * 0.85,
        radius
      );
      grad.addColorStop(0, `rgba(30, 26, 22, ${tipShadowAlpha})`);
      grad.addColorStop(1, 'rgba(30, 26, 22, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(handX + tipShadowDist, handY + tipShadowDist * 0.85, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // -------------------------------------------------------------
    // LAYER 3: Photographic Hand & Pencil
    // Forearm enters from frame edge; pencil tip locked to graphite mark
    // -------------------------------------------------------------
    ctx.save();
    ctx.translate(wristWorldX, wristWorldY);
    ctx.rotate(this.currentAngle);

    ctx.drawImage(
      img,
      -wristOffsetX,
      -wristOffsetY,
      img.naturalWidth * renderScale,
      img.naturalHeight * renderScale
    );

    ctx.restore();
  }
}

export const handRenderer = new HandRenderer();
