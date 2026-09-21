export type DrawingStyle = 'pencil' | 'charcoal' | 'fineliner';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number; // 0 to 1
  speed?: number;
}

export interface DrawingStroke {
  id: string;
  phase: number; // 1 to 6
  phaseName: string;
  points: StrokePoint[];
  color: string;
  baseWidth: number;
  alpha: number;
  style: DrawingStyle;
  isHatching?: boolean;
  length: number;
}

export interface DrawingData {
  width: number;
  height: number;
  aspectRatio: number;
  strokes: DrawingStroke[];
  totalLength: number;
  phaseLengths: Record<number, number>;
  sourceImageUrl: string;
}

export interface HandMetadata {
  style: string;
  file: string;
  width: number;
  height: number;
  bbox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  tip: {
    x: number;
    y: number;
  };
}

export interface AnimationState {
  isPlaying: boolean;
  currentTime: number; // in seconds (0 to 60)
  totalDuration: number; // default 60s
  playbackRate: number;
  currentPhase: number;
  currentStrokeIndex: number;
  handPosition: { x: number; y: number; lifted: boolean; angle: number };
  isFinished: boolean;
}
