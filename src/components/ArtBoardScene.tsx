import React, { useEffect, useRef, useState } from 'react';
import { DrawingData, DrawingStyle } from '../types';
import { animationController, TimelineState } from '../lib/animationController';
import { soundEngine } from '../lib/soundEngine';
import { ControlsOverlay } from './ControlsOverlay';

interface ArtBoardSceneProps {
  drawingData: DrawingData;
  style: DrawingStyle;
  onBackToSetup: () => void;
}

export const ArtBoardScene: React.FC<ArtBoardSceneProps> = ({
  drawingData,
  style,
  onBackToSetup
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const paperCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const [timelineState, setTimelineState] = useState<TimelineState>({
    currentTime: 0,
    totalDuration: 60,
    isPlaying: false,
    isFinished: false,
    currentPhase: 1,
    phaseName: 'Curiosity & Construction Marks',
    progress: 0,
    handPos: { x: 0, y: 0, isDrawing: false, vx: 0, vy: 0 }
  });

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(soundEngine.getMuted());
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [hideControlsInFullscreen, setHideControlsInFullscreen] = useState<boolean>(false);
  const hideTimerRef = useRef<number | null>(null);

  // Initialize canvases & animation controller
  useEffect(() => {
    if (!paperCanvasRef.current || !overlayCanvasRef.current) return;

    paperCanvasRef.current.width = drawingData.width;
    paperCanvasRef.current.height = drawingData.height;
    overlayCanvasRef.current.width = drawingData.width;
    overlayCanvasRef.current.height = drawingData.height;

    animationController.setCanvases(paperCanvasRef.current, overlayCanvasRef.current);
    animationController.setCallback((state) => {
      setTimelineState(state);
    });
    animationController.loadDrawing(drawingData, style);

    // Auto-play after 400ms for immediate lifelike cinematic start
    const timer = setTimeout(() => {
      animationController.play();
    }, 450);

    return () => {
      clearTimeout(timer);
      animationController.destroy();
    };
  }, [drawingData, style]);

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

  // Keyboard shortcuts (Space = play/pause, R = restart, F = fullscreen, M = mute)
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
          className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/70 via-black/40 to-transparent"
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

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-stone-900/60 border border-stone-800 text-stone-400">
              Phase {timelineState.currentPhase}/6: {timelineState.phaseName}
            </span>
          </div>
        </header>
      )}

      {/* Physical Drawing Board & Paper Container */}
      <div className="relative z-20 flex items-center justify-center w-full h-full p-4 md:p-8 max-h-[92vh]">
        {/* Wooden Drafting Art Board */}
        <div
          id="drafting-board"
          className="relative flex items-center justify-center p-6 md:p-10 rounded-xl shadow-2xl transition-all duration-300"
          style={{
            backgroundColor: '#4a3728',
            backgroundImage: `linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(0, 0, 0, 0.35) 100%)`,
            boxShadow: '0 25px 65px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08) inset'
          }}
        >
          {/* Paper Corner Masking Tape accents */}
          <div className="absolute -top-3 left-4 w-12 h-6 bg-amber-100/70 border border-amber-200/40 rotate-[-12deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />
          <div className="absolute -top-3 right-4 w-12 h-6 bg-amber-100/70 border border-amber-200/40 rotate-[10deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />
          <div className="absolute -bottom-3 left-6 w-12 h-6 bg-amber-100/70 border border-amber-200/40 rotate-[6deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />
          <div className="absolute -bottom-3 right-6 w-12 h-6 bg-amber-100/70 border border-amber-200/40 rotate-[-8deg] shadow-md z-30 pointer-events-none rounded-[1px] backdrop-blur-[1px]" />

          {/* Drawing Sheet Area with Realistic Heavy Paper Drop Shadow & Bevel */}
          <div
            id="paper-sheet"
            className="relative overflow-hidden rounded-[2px] bg-[#fcf9f2] shadow-[0_12px_32px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.25)] ring-1 ring-stone-300/40"
            style={{
              aspectRatio: `${drawingData.width} / ${drawingData.height}`,
              maxHeight: isFullscreen ? '94vh' : '78vh',
              maxWidth: '92vw'
            }}
          >
            {/* The Paper Drawing Canvas (Graphite / Charcoal / Ink layer) */}
            <canvas
              ref={paperCanvasRef}
              id="paper-canvas"
              className="block w-full h-full object-contain"
            />

            {/* The Overlay Canvas (Moving Hand, Pencil tip, dynamic Contact Shadows) */}
            <canvas
              ref={overlayCanvasRef}
              id="overlay-canvas"
              className="absolute inset-0 block w-full h-full object-contain pointer-events-none z-20"
            />
          </div>
        </div>
      </div>

      {/* Floating Interactive Controls (Screen-Recording Ready) */}
      <ControlsOverlay
        timeline={timelineState}
        isFullscreen={isFullscreen}
        hideControls={hideControlsInFullscreen}
        isMuted={isMuted}
        playbackRate={playbackRate}
        onPlayPause={togglePlay}
        onRestart={handleRestart}
        onSeek={handleSeek}
        onToggleFullscreen={toggleFullscreen}
        onToggleMute={toggleMute}
        onSpeedChange={handleSpeedChange}
      />
    </div>
  );
};
