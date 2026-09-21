import React, { useEffect, useRef, useState, useMemo } from 'react';
import { DrawingData, DrawingStroke } from '../types';
import {
  Play,
  Pause,
  X,
  Eye,
  EyeOff,
  Layers,
  ChevronDown,
  ChevronUp,
  Info,
  CheckCircle2,
  Sliders,
  Crosshair
} from 'lucide-react';

export interface PhaseColorDef {
  stroke: string;
  fill: string;
  glow: string;
  name: string;
}

export const PHASE_CONFIG: Record<number, PhaseColorDef> = {
  1: {
    stroke: '#00e5ff',
    fill: 'rgba(0, 229, 255, 0.15)',
    glow: 'rgba(0, 229, 255, 0.6)',
    name: 'Construction Marks'
  },
  2: {
    stroke: '#3b82f6',
    fill: 'rgba(59, 130, 246, 0.15)',
    glow: 'rgba(59, 130, 246, 0.6)',
    name: 'Major Outlines'
  },
  3: {
    stroke: '#10b981',
    fill: 'rgba(16, 185, 129, 0.15)',
    glow: 'rgba(16, 185, 129, 0.6)',
    name: 'Features & Form'
  },
  4: {
    stroke: '#f59e0b',
    fill: 'rgba(245, 158, 11, 0.15)',
    glow: 'rgba(245, 158, 11, 0.6)',
    name: 'Shading & Tones'
  },
  5: {
    stroke: '#ec4899',
    fill: 'rgba(236, 72, 153, 0.15)',
    glow: 'rgba(236, 72, 153, 0.6)',
    name: 'Deep Accents'
  },
  6: {
    stroke: '#eab308',
    fill: 'rgba(234, 179, 8, 0.15)',
    glow: 'rgba(234, 179, 8, 0.6)',
    name: 'Artist Signature'
  }
};

interface DebugPathsOverlayProps {
  drawingData: DrawingData;
  isOpen: boolean;
  onClose: () => void;
  onPlayAnimation: () => void;
  isPlaying: boolean;
}

export const DebugPathsOverlay: React.FC<DebugPathsOverlayProps> = ({
  drawingData,
  isOpen,
  onClose,
  onPlayAnimation,
  isPlaying
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Phase visibility states (1 to 6)
  const [enabledPhases, setEnabledPhases] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true,
    6: true
  });

  // Display toggles
  const [showNodes, setShowNodes] = useState<boolean>(true);
  const [showArrows, setShowArrows] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(false);
  const [darkBackdrop, setDarkBackdrop] = useState<boolean>(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState<boolean>(false);

  // Interactive selection / hover
  const [hoveredStroke, setHoveredStroke] = useState<DrawingStroke | null>(null);
  const [selectedStroke, setSelectedStroke] = useState<DrawingStroke | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);

  // Group strokes by phase
  const strokesByPhase = useMemo(() => {
    const groups: Record<number, DrawingStroke[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (const stroke of drawingData.strokes) {
      if (groups[stroke.phase]) {
        groups[stroke.phase].push(stroke);
      }
    }
    return groups;
  }, [drawingData.strokes]);

  // Total points across consolidated paths
  const totalPoints = useMemo(() => {
    return drawingData.strokes.reduce((sum, s) => sum + s.points.length, 0);
  }, [drawingData.strokes]);

  // Check if stroke count is strictly in target 80-180 range
  const isTargetCompliant = drawingData.strokes.length >= 80 && drawingData.strokes.length <= 180;

  // Toggle single phase
  const togglePhase = (phase: number) => {
    setEnabledPhases((prev) => ({ ...prev, [phase]: !prev[phase] }));
  };

  // Toggle all phases
  const setAllPhases = (state: boolean) => {
    setEnabledPhases({
      1: state,
      2: state,
      3: state,
      4: state,
      5: state,
      6: state
    });
  };

  // Handle Canvas mouse move for path hovering
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = drawingData.width / rect.width;
    const scaleY = drawingData.height / rect.height;

    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    setHoverPos({ x: e.clientX, y: e.clientY });

    // Find nearest stroke within 14px threshold
    let nearest: DrawingStroke | null = null;
    let minDist = 14;

    for (let i = drawingData.strokes.length - 1; i >= 0; i--) {
      const s = drawingData.strokes[i];
      if (!enabledPhases[s.phase]) continue;

      for (let p = 0; p < s.points.length; p++) {
        const pt = s.points[p];
        const d = Math.hypot(pt.x - mx, pt.y - my);
        if (d < minDist) {
          minDist = d;
          nearest = s;
          break;
        }
      }
      if (nearest) break;
    }

    setHoveredStroke(nearest);
  };

  const handleCanvasMouseLeave = () => {
    setHoveredStroke(null);
    setHoverPos(null);
  };

  const handleCanvasClick = () => {
    if (hoveredStroke) {
      setSelectedStroke((prev) => (prev?.id === hoveredStroke.id ? null : hoveredStroke));
    } else {
      setSelectedStroke(null);
    }
  };

  // Redraw canvas overlay whenever settings or hover changes
  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = drawingData.width;
    canvas.height = drawingData.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Optional dark backdrop for ultra-high contrast neon visualization
    if (darkBackdrop) {
      ctx.fillStyle = 'rgba(15, 12, 10, 0.88)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw paths phase by phase
    drawingData.strokes.forEach((stroke, strokeIdx) => {
      if (!enabledPhases[stroke.phase]) return;

      const isHovered = hoveredStroke?.id === stroke.id;
      const isSelected = selectedStroke?.id === stroke.id;
      const phaseDef = PHASE_CONFIG[stroke.phase] || PHASE_CONFIG[2];

      const pts = stroke.points;
      if (pts.length < 2) return;

      ctx.save();

      // Selected or hovered path highlighting
      if (isSelected || isHovered) {
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = isSelected ? '#ffffff' : '#fef08a';
        ctx.lineWidth = isSelected ? 4.5 : 3.8;
      } else {
        ctx.shadowColor = phaseDef.glow;
        ctx.shadowBlur = 4;
        ctx.strokeStyle = phaseDef.stroke;
        ctx.lineWidth = stroke.phase === 1 ? 1.8 : stroke.isHatching ? 2.0 : 2.4;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw path curve
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
      ctx.restore();

      // Draw midpoint direction arrow
      if (showArrows && pts.length >= 4) {
        const midIdx = Math.floor(pts.length / 2);
        const p1 = pts[midIdx - 1];
        const p2 = pts[midIdx];
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

        ctx.save();
        ctx.translate(p2.x, p2.y);
        ctx.rotate(angle);
        ctx.fillStyle = isHovered || isSelected ? '#ffffff' : phaseDef.stroke;
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-4, -3);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Draw start (green) and end (red) nodes
      if (showNodes) {
        const startPt = pts[0];
        const endPt = pts[pts.length - 1];

        // Start node: Emerald / Lime
        ctx.beginPath();
        ctx.arc(startPt.x, startPt.y, isHovered || isSelected ? 5.5 : 3.8, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#052e16';
        ctx.stroke();

        // End node: Red / Crimson
        ctx.beginPath();
        ctx.arc(endPt.x, endPt.y, isHovered || isSelected ? 5.5 : 3.8, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#450a0a';
        ctx.stroke();
      }

      // Draw path index label
      if (showLabels || isHovered || isSelected) {
        const startPt = pts[0];
        const text = `#${strokeIdx + 1}`;
        ctx.font = 'bold 10px monospace';
        const metrics = ctx.measureText(text);
        const padX = 3;
        const padY = 2;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(
          startPt.x + 6,
          startPt.y - 12,
          metrics.width + padX * 2,
          13
        );
        ctx.strokeStyle = phaseDef.stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          startPt.x + 6,
          startPt.y - 12,
          metrics.width + padX * 2,
          13
        );

        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, startPt.x + 6 + padX, startPt.y - 3);
      }
    });
  }, [
    isOpen,
    drawingData,
    enabledPhases,
    showNodes,
    showArrows,
    showLabels,
    darkBackdrop,
    hoveredStroke,
    selectedStroke
  ]);

  if (!isOpen) return null;

  const activeStroke = selectedStroke || hoveredStroke;

  return (
    <>
      {/* Visual Debug Canvas Layer - Directly overlaid on the paper surface */}
      <canvas
        ref={canvasRef}
        id="debug-paths-canvas"
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
        onClick={handleCanvasClick}
        className="absolute inset-0 block w-full h-full object-contain pointer-events-auto z-35 cursor-crosshair transition-opacity duration-200"
      />

      {/* Floating Hover Tooltip (follows cursor on canvas hover) */}
      {hoveredStroke && hoverPos && !selectedStroke && (
        <div
          className="fixed pointer-events-none z-50 px-2.5 py-1.5 rounded-md bg-stone-950/95 border border-stone-700/90 text-stone-200 text-xs shadow-xl backdrop-blur-md font-mono"
          style={{
            left: `${hoverPos.x + 14}px`,
            top: `${hoverPos.y + 14}px`
          }}
        >
          <div className="flex items-center gap-1.5 font-bold">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: PHASE_CONFIG[hoveredStroke.phase]?.stroke }}
            />
            <span>{hoveredStroke.id}</span>
            <span className="text-stone-400 font-normal">
              ({hoveredStroke.isHatching ? 'Shading Gesture' : 'Contour'})
            </span>
          </div>
          <div className="text-[11px] text-stone-400 mt-0.5">
            Phase {hoveredStroke.phase}: {hoveredStroke.phaseName}
          </div>
          <div className="text-[10px] text-stone-500">
            {hoveredStroke.points.length} points · {Math.round(hoveredStroke.length)}px length
          </div>
        </div>
      )}

      {/* Floating HUD Inspector & Control Panel */}
      <div
        id="debug-hud-panel"
        className="fixed top-18 right-6 z-45 w-88 max-w-[calc(100vw-2rem)] bg-stone-950/90 backdrop-blur-xl border border-stone-800 rounded-2xl shadow-2xl ring-1 ring-white/10 text-stone-200 overflow-hidden transition-all duration-300"
      >
        {/* Panel Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-stone-900/80 border-b border-stone-800/80">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-amber-400/10 text-amber-400 border border-amber-400/20">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-stone-100 flex items-center gap-1.5">
                Consolidated Paths Debugger
              </h2>
              <div className="flex items-center gap-1.5 text-[10px] text-stone-400 font-mono">
                <span className="text-amber-300 font-bold">{drawingData.strokes.length}</span>
                <span>total paths</span>
                <span>·</span>
                <span>{totalPoints} pts</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
              className="p-1 rounded text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors cursor-pointer"
              title={isPanelCollapsed ? 'Expand Panel' : 'Collapse Panel'}
            >
              {isPanelCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded text-stone-400 hover:text-stone-100 hover:bg-stone-800 transition-colors cursor-pointer"
              title="Close Debug Overlay (D)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Panel Content (Collapsible) */}
        {!isPanelCollapsed && (
          <div className="p-3.5 space-y-3.5 max-h-[75vh] overflow-y-auto">
            {/* Target 80-180 Paths Compliance Status Card */}
            <div
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                isTargetCompliant
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                  : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <div>
                  <div className="font-semibold text-[11px]">
                    {isTargetCompliant ? 'Target Range Satisfied' : 'Path Count Advisory'}
                  </div>
                  <div className="text-[10px] opacity-80 font-mono">
                    80–180 paths target: <strong className="text-white">{drawingData.strokes.length} paths</strong>
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/40 border border-white/10">
                100% Coherent
              </span>
            </div>

            {/* Quick Action: Play Animation */}
            <button
              id="debug-play-animation-btn"
              onClick={onPlayAnimation}
              className="w-full py-2.5 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-950 font-medium text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-98 cursor-pointer"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5 fill-stone-950" />
                  <span>Pause Hand Animation</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-stone-950" />
                  <span>Play Hand Drawing Animation</span>
                </>
              )}
            </button>

            {/* Phase Matrix & Filters */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-mono uppercase tracking-wider text-stone-400">
                  Phases & Color Key
                </span>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    onClick={() => setAllPhases(true)}
                    className="text-stone-400 hover:text-stone-200 hover:underline cursor-pointer"
                  >
                    All
                  </button>
                  <span className="text-stone-700">|</span>
                  <button
                    onClick={() => setAllPhases(false)}
                    className="text-stone-400 hover:text-stone-200 hover:underline cursor-pointer"
                  >
                    None
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5, 6].map((phaseNum) => {
                  const def = PHASE_CONFIG[phaseNum];
                  const count = strokesByPhase[phaseNum]?.length || 0;
                  const isVisible = enabledPhases[phaseNum];

                  return (
                    <div
                      key={phaseNum}
                      onClick={() => togglePhase(phaseNum)}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer transition-all ${
                        isVisible
                          ? 'bg-stone-900/90 border-stone-800 hover:border-stone-700'
                          : 'bg-stone-950/40 border-stone-900 text-stone-600 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 shadow-sm"
                          style={{
                            backgroundColor: def.stroke,
                            boxShadow: isVisible ? `0 0 8px ${def.stroke}` : 'none'
                          }}
                        />
                        <span className="font-mono text-[11px] truncate">
                          Phase {phaseNum}: {def.name}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0 font-mono text-[10px]">
                        <span className="text-stone-400 font-semibold">{count}</span>
                        {isVisible ? (
                          <Eye className="w-3.5 h-3.5 text-stone-400 hover:text-stone-200" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-stone-600" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Display Options */}
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-stone-400 mb-2 flex items-center gap-1.5">
                <Sliders className="w-3 h-3" />
                <span>Display Toggles</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                <button
                  onClick={() => setShowNodes(!showNodes)}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    showNodes
                      ? 'bg-stone-800 border-stone-700 text-stone-200'
                      : 'bg-stone-900/50 border-stone-800 text-stone-500'
                  }`}
                >
                  <span className="text-[11px]">Start/End Nodes</span>
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  </div>
                </button>

                <button
                  onClick={() => setShowArrows(!showArrows)}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    showArrows
                      ? 'bg-stone-800 border-stone-700 text-stone-200'
                      : 'bg-stone-900/50 border-stone-800 text-stone-500'
                  }`}
                >
                  <span className="text-[11px]">Direction Arrows</span>
                  <span className="text-stone-400">→</span>
                </button>

                <button
                  onClick={() => setShowLabels(!showLabels)}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    showLabels
                      ? 'bg-stone-800 border-stone-700 text-stone-200'
                      : 'bg-stone-900/50 border-stone-800 text-stone-500'
                  }`}
                >
                  <span className="text-[11px]">Index # Labels</span>
                  <span className="text-stone-400">#</span>
                </button>

                <button
                  onClick={() => setDarkBackdrop(!darkBackdrop)}
                  className={`p-2 rounded-lg border text-left flex items-center justify-between transition-colors cursor-pointer ${
                    darkBackdrop
                      ? 'bg-amber-400/20 border-amber-400/40 text-amber-200'
                      : 'bg-stone-900/50 border-stone-800 text-stone-500'
                  }`}
                >
                  <span className="text-[11px]">Dark Backdrop</span>
                  <span className="text-[10px]">Neon</span>
                </button>
              </div>
            </div>

            {/* Selected or Hovered Path Inspector Detail */}
            {activeStroke && (
              <div className="p-2.5 rounded-xl bg-stone-900/90 border border-stone-700 text-xs font-mono space-y-1.5">
                <div className="flex items-center justify-between border-b border-stone-800 pb-1">
                  <div className="flex items-center gap-1.5 font-bold text-stone-100">
                    <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                    <span>{activeStroke.id}</span>
                  </div>
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-bold"
                    style={{
                      backgroundColor: PHASE_CONFIG[activeStroke.phase]?.fill,
                      color: PHASE_CONFIG[activeStroke.phase]?.stroke
                    }}
                  >
                    Phase {activeStroke.phase}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-stone-400 pt-0.5">
                  <div>
                    <span className="text-stone-500 block text-[10px]">Type</span>
                    <span className="text-stone-200 font-medium">
                      {activeStroke.isHatching ? 'Grouped Shading' : 'Contour Path'}
                    </span>
                  </div>
                  <div>
                    <span className="text-stone-500 block text-[10px]">Points Count</span>
                    <span className="text-stone-200 font-medium">{activeStroke.points.length} pts</span>
                  </div>
                  <div>
                    <span className="text-stone-500 block text-[10px]">Arc Length</span>
                    <span className="text-stone-200 font-medium">{Math.round(activeStroke.length)} px</span>
                  </div>
                  <div>
                    <span className="text-stone-500 block text-[10px]">Base Width</span>
                    <span className="text-stone-200 font-medium">{activeStroke.baseWidth.toFixed(1)} px</span>
                  </div>
                </div>
              </div>
            )}

            {/* Quick Tips */}
            <div className="flex items-start gap-2 p-2 rounded-lg bg-stone-900/40 border border-stone-800/60 text-[10px] text-stone-400">
              <Info className="w-3.5 h-3.5 text-stone-500 flex-shrink-0 mt-0.5" />
              <span>
                Hover paths on the canvas to inspect points and tangents. Press <kbd className="px-1 py-0.5 rounded bg-stone-800 text-stone-300">D</kbd> to toggle this overlay.
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
