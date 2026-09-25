import React, { useEffect, useRef, useState } from 'react';
import { DrawingData, DrawingStyle } from '../types';
import { animationController, TimelineState } from '../lib/animationController';
import { soundEngine } from '../lib/soundEngine';
import { ControlsOverlay } from './ControlsOverlay';
import { RepresentativeHand } from './RepresentativeHand';
import { DebugPathsOverlay } from './DebugPathsOverlay';
import { Layers, Image as ImageIcon } from 'lucide-react';

interface ArtBoardSceneProps {
  drawingData: DrawingData;
  style: DrawingStyle;
  initialDebug?: boolean;
  onBackToSetup: () => void;
}

export const ArtBoardScene: React.FC<ArtBoardSceneProps> = ({
  drawingData,
  style,
  initialDebug = false,
  onBackToSetup
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraFrameRef = useRef<HTMLDivElement>(null);
  const paperSheetRef = useRef<HTMLDivElement>(null);
  const paperCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [sheetDimensions, setSheetDimensions] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0
  });

  const [timelineState, setTimelineState] = useState<TimelineState>({
    currentTime: 0,
    totalDuration: 60,
    isPlaying: false,
    isFinished: false,
    currentPhase: 1,
    phaseName: 'Curiosity & Construction Marks',
    progress: 0,
    handPos: { x: 0, y: 0, isDrawing: false, vx: 0, vy: 0, lift: 1.0, angle: 0 },
    handMode: 'sprite'
  });

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(soundEngine.getMuted());
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [hideControlsInFullscreen, setHideControlsInFullscreen] = useState<boolean>(false);
  const [showDebugOverlay, setShowDebugOverlay] = useState<boolean>(initialDebug);
  const [showStaticSketch, setShowStaticSketch] = useState<boolean>(false);
  const hideTimerRef = useRef<number | null>(null);

  // Update exact screen geometry and coordinate mapping between paper and overlay canvas
  const updateCanvasesGeometry = () => {
    const frameEl = cameraFrameRef.current || containerRef.current;
    if (!frameEl || !paperSheetRef.current || !overlayCanvasRef.current) return;
    const containerRect = frameEl.getBoundingClientRect();
    const paperRect = paperSheetRef.current.getBoundingClientRect();

    if (containerRect.width > 0 && containerRect.height > 0) {
      const targetW = Math.round(containerRect.width);
      const targetH = Math.round(containerRect.height);
      if (
        overlayCanvasRef.current.width !== targetW ||
        overlayCanvasRef.current.height !== targetH
      ) {
        overlayCanvasRef.current.width = targetW;
        overlayCanvasRef.current.height = targetH;
      }

      if (paperRect.width > 0 && drawingData.width > 0) {
        setSheetDimensions({ width: paperRect.width, height: paperRect.height });
        const offsetX = paperRect.left - containerRect.left;
        const offsetY = paperRect.top - containerRect.top;
        const scale = paperRect.width / drawingData.width;
        animationController.setOverlayTransform(offsetX, offsetY, scale);
      }
    }
  };

  // Resize observer to track exact paper sheet & container display dimensions
  useEffect(() => {
    updateCanvasesGeometry();
    const observer = new ResizeObserver(() => {
      updateCanvasesGeometry();
    });

    if (containerRef.current) observer.observe(containerRef.current);
    if (cameraFrameRef.current) observer.observe(cameraFrameRef.current);
    if (paperSheetRef.current) observer.observe(paperSheetRef.current);
    window.addEventListener('resize', updateCanvasesGeometry);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateCanvasesGeometry);
    };
  }, [drawingData]);

  // Initialize canvases & animation controller
  useEffect(() => {
    if (!paperCanvasRef.current || !overlayCanvasRef.current) return;

    paperCanvasRef.current.width = drawingData.width;
    paperCanvasRef.current.height = drawingData.height;

    animationController.setCanvases(paperCanvasRef.current, overlayCanvasRef.current);
    animationController.setCallback((state) => {
      setTimelineState(state);
    });
    animationController.loadDrawing(drawingData, style);

    // Initial transform sync
    setTimeout(updateCanvasesGeometry, 50);

    // Auto-play after 450ms for immediate start, unless in initial debug verification mode
    let timer: NodeJS.Timeout | null = null;
    if (!initialDebug) {
      timer = setTimeout(() => {
        animationController.play();
      }, 450);
    }

    return () => {
      if (timer) clearTimeout(timer);
      animationController.destroy();
    };
  }, [drawingData, style, initialDebug]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (active) {
        setHideControlsInFullscreen(true);
      } else {
        setHideControlsInFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleDebugOverlay = () => {
    setShowDebugOverlay((prev) => !prev);
  };

  // Keyboard shortcuts (Space = play/pause, R = restart, F = fullscreen, M = mute, D = debug)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'KeyR') {
        e.preventDefault();
        handleRestart();
      } else if (e.code === 'KeyF') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'KeyD') {
        e.preventDefault();
        toggleDebugOverlay();
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        setShowStaticSketch((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timelineState.isPlaying]);

  // Mouse activity auto-hide in fullscreen mode
  const handleMouseMove = () => {
    if (isFullscreen) {
      setHideControlsInFullscreen(false);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        setHideControlsInFullscreen(true);
      }, 2500);
    }
  };

  const togglePlay = () => {
    if (timelineState.isPlaying) {
      animationController.pause();
    } else {
      animationController.play();
    }
  };

  const handleRestart = () => {
    animationController.restart();
  };

  const handleSeek = (time: number) => {
    animationController.seek(time);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  };

  const toggleMute = () => {
    const muted = soundEngine.toggleMute();
    setIsMuted(muted);
  };

  const handleSpeedChange = (rate: number) => {
    setPlaybackRate(rate);
    animationController.setPlaybackRate(rate);
  };

  const toggleHandMode = () => {
    const nextMode = timelineState.handMode === 'representative' ? 'sprite' : 'representative';
    animationController.setHandMode(nextMode);
  };

  // Compute scale from internal coordinates to display pixels
  const scaleX = sheetDimensions.width > 0 ? sheetDimensions.width / drawingData.width : 1;
  const scaleY = sheetDimensions.height > 0 ? sheetDimensions.height / drawingData.height : 1;

  const handRenderX = timelineState.handPos.x * scaleX;
  const handRenderY = timelineState.handPos.y * scaleY;

  return (
    <div
      ref={containerRef}
      id="artboard-container"
      onMouseMove={handleMouseMove}
      className={`relative w-full h-screen overflow-hidden select-none flex flex-col items-center justify-center bg-[#171411] transition-colors duration-300 ${
        isFullscreen ? 'cursor-none hover:cursor-default' : ''
      }`}
      style={{
        backgroundImage: `radial-gradient(circle at 35% 25%, rgba(255, 235, 205, 0.08) 0%, rgba(0, 0, 0, 0.45) 80%), url('/assets/desk.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      {/* Subtle Studio Desk Ambient Glow (Warm directional art lamp at top-left) */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background: 'radial-gradient(ellipse at 25% 15%, rgba(255, 240, 210, 0.18) 0%, rgba(0, 0, 0, 0.35) 75%)',
          mixBlendMode: 'screen'
        }}
      />

      {/* Top Header Bar (hidden in recording fullscreen) */}
      {!isFullscreen && (
        <header
          id="scene-header"
          className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/70 via-black/40 to-transparent"
        >
          <div className="flex items-center gap-3">
            <button
              id="back-setup-btn"
              onClick={onBackToSetup}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-stone-300 hover:text-white bg-stone-900/70 hover:bg-stone-800/90 border border-stone-700/60 rounded-md transition-all shadow-sm backdrop-blur-md cursor-pointer"
            >
              ← Change Photo / Style
            </button>
            <div className="h-4 w-[1px] bg-stone-700/60" />
            <span className="text-xs uppercase tracking-wider text-stone-400 font-mono">
              Style:{' '}
              <strong className="text-amber-200 capitalize">{style}</strong>
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Stage 1: Clean Static Sketch Toggle */}
            {drawingData.staticSketchUrl && (
              <button
                id="toggle-static-sketch-btn"
                onClick={() => setShowStaticSketch((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border transition-colors cursor-pointer ${
                  showStaticSketch
                    ? 'bg-emerald-400 text-stone-950 font-bold border-emerald-300 shadow-md ring-1 ring-emerald-400/40'
                    : 'bg-stone-900/70 hover:bg-stone-800 border-stone-700/60 text-stone-300'
                }`}
                title="View Stage 1 Generated Clean Static Sketch"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Static Sketch (S)</span>
              </button>
            )}

            {/* Debug Paths Overlay Toggle */}
            <button
              id="toggle-debug-overlay-btn"
              onClick={toggleDebugOverlay}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border transition-colors cursor-pointer ${
                showDebugOverlay
                  ? 'bg-amber-400 text-stone-950 font-bold border-amber-300 shadow-md ring-1 ring-amber-400/40'
                  : 'bg-stone-900/70 hover:bg-stone-800 border-stone-700/60 text-stone-300'
              }`}
              title="Toggle Consolidated Paths Debug Overlay (D)"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Paths Debug (D)</span>
            </button>

            {/* Hand Mode Toggle */}
            <button
              id="toggle-hand-mode-btn"
              onClick={toggleHandMode}
              className="px-2.5 py-1 text-xs font-mono rounded bg-stone-900/70 hover:bg-stone-800 border border-stone-700/60 text-stone-300 transition-colors cursor-pointer"
              title="Toggle Hand Renderer"
            >
              Hand:{' '}
              <span className="text-amber-400 font-semibold">
                {timelineState.handMode === 'representative' ? 'Representative (Vector/CSS)' : 'Photo Sprite'}
              </span>
            </button>

            <span className="text-xs font-mono px-2.5 py-1 rounded bg-stone-900/60 border border-stone-800 text-stone-400">
              Phase {timelineState.currentPhase}/6: {timelineState.phaseName}
            </span>
          </div>
        </header>
      )}

      {/* Studio Camera Frame: Intimately frames the drafting board & paper with clean viewport cropping */}
      <div
        ref={cameraFrameRef}
        id="studio-camera-frame"
        className="relative z-20 flex items-center justify-center w-full max-w-[780px] h-full max-h-[92vh] overflow-hidden p-3 md:p-4"
      >
        {/* Wooden Drafting Art Board */}
        <div
          id="drafting-board"
          className="relative flex items-center justify-center p-4 md:p-6 rounded-xl shadow-2xl transition-all duration-300"
          style={{
            backgroundColor: '#3d2c1e',
            backgroundImage: `linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(0, 0, 0, 0.42) 100%)`,
            boxShadow: '0 25px 65px -12px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.08) inset'
          }}
        >
          {/* Paper Corner Masking Tape accents */}
          <div className="absolute -top-3 left-4 w-12 h-6 bg-amber-100/75 border border-amber-200/50 rotate-[-12deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />
          <div className="absolute -top-3 right-4 w-12 h-6 bg-amber-100/75 border border-amber-200/50 rotate-[10deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />
          <div className="absolute -bottom-3 left-6 w-12 h-6 bg-amber-100/75 border border-amber-200/50 rotate-[6deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />
          <div className="absolute -bottom-3 right-6 w-12 h-6 bg-amber-100/75 border border-amber-200/50 rotate-[-8deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />

          {/* Paper Surface Wrapper with Unclipped Layered Hand Container */}
          <div
            id="paper-surface-wrapper"
            className="relative"
            style={{
              aspectRatio: `${drawingData.width} / ${drawingData.height}`,
              maxHeight: isFullscreen ? '94vh' : '78vh',
              maxWidth: '90vw'
            }}
          >
            {/* The Paper Sheet (Graphite Drawing Canvas) */}
            <div
              id="paper-sheet"
              ref={paperSheetRef}
              className="relative w-full h-full overflow-hidden rounded-[2px] bg-[#fbf7ee] shadow-[0_2px_8px_rgba(0,0,0,0.18),0_14px_36px_rgba(0,0,0,0.45)] ring-1 ring-stone-300/60"
            >
              <canvas
                ref={paperCanvasRef}
                id="paper-canvas"
                className="block w-full h-full object-contain"
              />
            </div>

            {/* Consolidated Paths Visual Debug Overlay Layer */}
            <DebugPathsOverlay
              drawingData={drawingData}
              isOpen={showDebugOverlay}
              onClose={() => setShowDebugOverlay(false)}
              onPlayAnimation={togglePlay}
              isPlaying={timelineState.isPlaying}
            />

            {/* The Representative Hand Component Layered Over Drawing Surface */}
            {timelineState.handMode === 'representative' &&
              sheetDimensions.width > 0 &&
              !(showDebugOverlay && !timelineState.isPlaying) && (
                <RepresentativeHand
                  x={handRenderX}
                  y={handRenderY}
                  isDrawing={timelineState.handPos.isDrawing}
                  lift={timelineState.handPos.lift}
                  angle={timelineState.handPos.angle}
                  style={style}
                  paperWidth={sheetDimensions.width}
                  paperHeight={sheetDimensions.height}
                />
              )}
          </div>
        </div>

        {/* Photographic Hand Sprite Overlay Canvas (Clipped to camera frame so forearm naturally enters from off-screen edge) */}
        <canvas
          ref={overlayCanvasRef}
          id="overlay-canvas"
          className={`absolute inset-0 w-full h-full pointer-events-none z-30 transition-opacity duration-200 ${
            showDebugOverlay && !timelineState.isPlaying ? 'opacity-0' : 'opacity-100'
          }`}
        />
      </div>

      {/* Floating Interactive Controls (Screen-Recording Ready) */}
      <ControlsOverlay
        timeline={timelineState}
        isFullscreen={isFullscreen}
        hideControls={hideControlsInFullscreen}
        isMuted={isMuted}
        playbackRate={playbackRate}
        showDebugOverlay={showDebugOverlay}
        onPlayPause={togglePlay}
        onRestart={handleRestart}
        onSeek={handleSeek}
        onToggleFullscreen={toggleFullscreen}
        onToggleMute={toggleMute}
        onSpeedChange={handleSpeedChange}
        onToggleDebug={toggleDebugOverlay}
      />
    </div>
  );
};
