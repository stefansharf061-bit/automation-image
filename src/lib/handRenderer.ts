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
    scale: 1.55,
    baseAngle: 0.38
  },
  charcoal: {
    file: '/assets/hand_charcoal.png',
    tipX: 398,
    tipY: 896,
    wristX: 780,
    wristY: 240,
    scale: 1.55,
    baseAngle: 0.38
  },
  fineliner: {
    file: '/assets/hand_fineliner.png',
    tipX: 636,
    tipY: 899,
    wristX: 540,
    wristY: 680,
    scale: 1.5,
    baseAngle: 0.35
  }
};

export class HandRenderer {
  private images: Partial<Record<DrawingStyle, HTMLImageElement>> = {};
  private currentAngle: number = 0.38;
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
   * Render the natural artist hand and pencil entering from the frame edge
   * with exact pencil tip registration to the active drawing coordinate (x, y).
   */
  public render(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    isDrawing: boolean,
    vx: number,
    vy: number,
    style: DrawingStyle,
    _time: number,
    paperScale: number = 1
  ) {
    const img = this.images[style] || this.images['pencil'];
    if (!img) return;

    const config = HAND_CONFIGS[style];
    const canvasW = ctx.canvas.width;
    const canvasH = ctx.canvas.height;

    // 1. Off-screen wrist and forearm anchor kinematics
    // Forearm enters from beyond the bottom-right frame edge
    const wristPivotX = canvasW * 1.35;
    const wristPivotY = canvasH * 1.25;

    const armAngle = Math.atan2(y - wristPivotY, x - wristPivotX);
    const centerAngle = Math.atan2(canvasH * 0.5 - wristPivotY, canvasW * 0.5 - wristPivotX);

    // Subtle anatomical sweep as hand reaches across paper
    const sweepAngle = (armAngle - centerAngle) * 0.22;

    // Biomechanical micro-flexion responding to drawing motion
    const speed = Math.hypot(vx, vy);
    const strokeAngle = Math.atan2(vy, vx);
    const wristDeflection =
      speed > 6 ? Math.sin(strokeAngle - armAngle) * Math.min(0.035, speed * 0.0002) : 0;

    const targetAngle = config.baseAngle + sweepAngle + wristDeflection;
    this.currentAngle += (targetAngle - this.currentAngle) * 0.2;

    // 2. Exact Pencil Tip Locking
    // When drawing, contact is 100% locked to (x, y): zero lift offset, zero delay
    let handX: number;
    let handY: number;

    if (isDrawing) {
      this.currentLift = 0;
      handX = x;
      handY = y;
    } else {
      this.currentLift = Math.min(1.0, this.currentLift + 0.16);
      const liftOffset = this.currentLift * 14 * paperScale;
      handX = x + this.currentLift * 4 * paperScale;
      handY = y - liftOffset;
    }

    const renderScale = config.scale * paperScale;
    const wristOffsetX = config.wristX * renderScale;
    const wristOffsetY = config.wristY * renderScale;

    // Calculate rotation around wrist joint so pencil tip lands precisely at (handX, handY)
    const tipRelX = (config.tipX - config.wristX) * renderScale;
    const tipRelY = (config.tipY - config.wristY) * renderScale;

    const cosA = Math.cos(this.currentAngle);
    const sinA = Math.sin(this.currentAngle);

    const rotTipX = tipRelX * cosA - tipRelY * sinA;
    const rotTipY = tipRelX * sinA + tipRelY * cosA;

    const wristWorldX = handX - rotTipX;
    const wristWorldY = handY - rotTipY;

    // Subtle contact point shadow under pencil tip when in active contact
    if (isDrawing) {
      ctx.save();
      const dotGrad = ctx.createRadialGradient(
        handX + 1.2 * paperScale,
        handY + 1.2 * paperScale,
        0.5 * paperScale,
        handX + 1.2 * paperScale,
        handY + 1.2 * paperScale,
        4.5 * paperScale
      );
      dotGrad.addColorStop(0, 'rgba(20, 18, 16, 0.45)');
      dotGrad.addColorStop(1, 'rgba(20, 18, 16, 0)');
      ctx.fillStyle = dotGrad;
      ctx.beginPath();
      ctx.arc(handX + 1.2 * paperScale, handY + 1.2 * paperScale, 4.5 * paperScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Render the artist hand + pencil
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
