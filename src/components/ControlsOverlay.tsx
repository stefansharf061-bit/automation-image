import React from 'react';
import { TimelineState } from '../lib/animationController';
import { Play, Pause, RotateCcw, Maximize2, Minimize2, Volume2, VolumeX, Layers } from 'lucide-react';

interface ControlsOverlayProps {
  timeline: TimelineState;
  isFullscreen: boolean;
  hideControls: boolean;
  isMuted: boolean;
  playbackRate: number;
  showDebugOverlay?: boolean;
  onPlayPause: () => void;
  onRestart: () => void;
  onSeek: (time: number) => void;
  onToggleFullscreen: () => void;
  onToggleMute: () => void;
  onSpeedChange: (rate: number) => void;
  onToggleDebug?: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export const ControlsOverlay: React.FC<ControlsOverlayProps> = ({
  timeline,
  isFullscreen,
  hideControls,
  isMuted,
  playbackRate,
  showDebugOverlay,
  onPlayPause,
  onRestart,
  onSeek,
  onToggleFullscreen,
  onToggleMute,
  onSpeedChange,
  onToggleDebug
}) => {
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    onSeek(val);
  };

  return (
    <div
      id="controls-overlay"
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-2xl transition-all duration-300 ${
        hideControls ? 'opacity-0 pointer-events-none translate-y-4' : 'opacity-100'
      }`}
    >
      <div className="flex flex-col gap-2 p-3.5 bg-stone-950/85 backdrop-blur-xl border border-stone-800/80 rounded-2xl shadow-2xl ring-1 ring-white/5">
        {/* Progress Bar & Timestamp */}
        <div className="flex items-center gap-3 px-1">
          <span className="text-xs font-mono text-stone-300 min-w-[42px]">
            {formatTime(timeline.currentTime)}
          </span>

          <div className="relative flex-1 flex items-center group">
            <input
              id="timeline-scrubber"
              type="range"
              min="0"
              max={timeline.totalDuration}
              step="0.1"
              value={timeline.currentTime}
              onChange={handleScrubberChange}
              className="w-full h-1.5 bg-stone-800 rounded-lg appearance-none cursor-pointer accent-amber-400 hover:h-2 transition-all focus:outline-none"
            />
          </div>

          <span className="text-xs font-mono text-stone-400 min-w-[42px]">
            {formatTime(timeline.totalDuration)}
          </span>
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between pt-1">
          {/* Left: Play / Pause / Restart */}
          <div className="flex items-center gap-2">
            <button
              id="play-pause-btn"
              onClick={onPlayPause}
              title={timeline.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-400 hover:bg-amber-300 text-stone-950 font-medium transition-all shadow-md active:scale-95 cursor-pointer"
            >
              {timeline.isPlaying ? (
                <Pause className="w-4 h-4 fill-stone-950" />
              ) : (
                <Play className="w-4 h-4 fill-stone-950 ml-0.5" />
              )}
            </button>

            <button
              id="restart-btn"
              onClick={onRestart}
              title="Restart from beginning (R)"
              className="flex items-center justify-center w-8 h-8 rounded-full text-stone-400 hover:text-stone-100 hover:bg-stone-800/60 transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              id="mute-btn"
              onClick={onToggleMute}
              title={isMuted ? 'Unmute paper sound' : 'Mute paper sound'}
              className="flex items-center justify-center w-8 h-8 rounded-full text-stone-400 hover:text-stone-100 hover:bg-stone-800/60 transition-all cursor-pointer"
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          {/* Center: Current Phase Label */}
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-stone-400 font-mono">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span>Phase {timeline.currentPhase}:</span>
            <span className="text-stone-200">{timeline.phaseName}</span>
          </div>

          {/* Right: Speed & Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Speed Selector */}
            <div className="flex items-center bg-stone-900 border border-stone-800 rounded-lg p-0.5">
              {[1.0, 1.5, 2.0].map((rate) => (
                <button
                  key={rate}
                  id={`speed-btn-${rate}x`}
                  onClick={() => onSpeedChange(rate)}
                  className={`px-2 py-0.5 text-[11px] font-mono rounded transition-all cursor-pointer ${
                    playbackRate === rate
                      ? 'bg-amber-400 text-stone-950 font-bold'
                      : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Debug Paths Overlay Toggle */}
            {onToggleDebug && (
              <button
                id="controls-debug-overlay-btn"
                onClick={onToggleDebug}
                title={showDebugOverlay ? 'Hide Debug Paths Overlay (D)' : 'Show Debug Paths Overlay (D)'}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border cursor-pointer ${
                  showDebugOverlay
                    ? 'bg-amber-400 text-stone-950 font-bold border-amber-300 shadow-md ring-1 ring-amber-400/40'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border-stone-700/60'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Debug</span>
              </button>
            )}

            {/* Fullscreen Button */}
            <button
              id="fullscreen-btn"
              onClick={onToggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen (F / Esc)' : 'Fullscreen for Screen Recording (F)'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 transition-all border border-stone-700/60 cursor-pointer"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">Exit</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Fullscreen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Screen-Recording Hint in Fullscreen */}
      {isFullscreen && !hideControls && (
        <div className="mt-2 text-center">
          <span className="text-[11px] text-stone-400/80 bg-black/60 px-3 py-1 rounded-full backdrop-blur-sm border border-stone-800/50">
            Screen-recording mode: controls auto-hide in 2s. Move mouse to reveal.
          </span>
        </div>
      )}
    </div>
  );
};
