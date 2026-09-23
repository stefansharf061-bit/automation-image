import React, { useState, useRef } from 'react';
import { DrawingData, DrawingStyle } from '../types';
import { loadImage, processImageToDrawing } from '../lib/imageProcessor';
import { Upload, Image as ImageIcon, Sparkles, Wand2, Check, Layers } from 'lucide-react';

interface SetupPanelProps {
  onGenerateComplete: (data: DrawingData, style: DrawingStyle, initialDebug?: boolean) => void;
}

export const SetupPanel: React.FC<SetupPanelProps> = ({ onGenerateComplete }) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [style, setStyle] = useState<DrawingStyle>('pencil');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processStep, setProcessStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (JPG, PNG, WebP)');
      return;
    }

    setError(null);
    setSelectedFileName(file.name);
    const url = URL.createObjectURL(file);
    setSelectedImage(url);
  };

  // Drag and drop handlers
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please drop an image file (JPG, PNG, WebP)');
      return;
    }

    setError(null);
    setSelectedFileName(file.name);
    const url = URL.createObjectURL(file);
    setSelectedImage(url);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // Developer Test Mode: Load predefined sample portrait
  const handleLoadSample = async () => {
    setError(null);
    setSelectedFileName('sample-portrait.jpg');
    setSelectedImage('/assets/sample-portrait.jpg');
  };

  // Process and Generate
  const handleGenerate = async (debug = false) => {
    if (!selectedImage) {
      setError('Please upload a photo or click "Load Sample Portrait" first.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      setProcessStep('Loading photo into browser memory...');
      // Small timeout to allow UI update
      await new Promise(r => setTimeout(r, 60));

      setProcessStep('Analyzing contours, edges, and tonal values...');
      await new Promise(r => setTimeout(r, 60));

      setProcessStep('Synthesizing 6-phase artistic hand-drawing timeline...');
      const drawingData = await processImageToDrawing(selectedImage, style);

      setProcessStep('Preparing physical art board scene...');
      await new Promise(r => setTimeout(r, 100));

      onGenerateComplete(drawingData, style, debug);
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error)?.message || 'Failed to process image');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      id="setup-panel-container"
      className="min-h-screen w-full flex items-center justify-center p-4 md:p-8 bg-[#181512] text-stone-200 selection:bg-amber-400 selection:text-stone-900"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 30%, rgba(217, 119, 6, 0.07) 0%, rgba(0, 0, 0, 0.65) 85%), url('/assets/desk.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center'
      }}
    >
      <div className="w-full max-w-xl bg-stone-900/90 backdrop-blur-xl border border-stone-800 rounded-2xl shadow-2xl p-6 md:p-8 ring-1 ring-white/5">
        {/* Title & Concept */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-mono mb-2.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Physical Art Board Engine</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-serif tracking-tight text-white font-medium">
            Hand-Drawn Artwork Animator
          </h1>
          <p className="text-xs md:text-sm text-stone-400 mt-1.5 max-w-md mx-auto">
            Transform any photo into a photorealistic 60-second animation of a real human hand drawing on physical paper.
          </p>
        </div>

        {/* Step 1: Upload Photo */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-stone-300">
              1. Upload Photo
            </label>
            <button
              id="load-sample-btn"
              type="button"
              onClick={handleLoadSample}
              className="text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 transition-colors cursor-pointer"
            >
              Use Sample Portrait (Test Mode)
            </button>
          </div>

          <div
            id="dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-xl p-5 flex flex-col items-center justify-center text-center transition-all cursor-pointer ${
              selectedImage
                ? 'border-amber-500/40 bg-stone-950/60 hover:bg-stone-950/80'
                : 'border-stone-700 hover:border-stone-500 bg-stone-950/40 hover:bg-stone-950/60'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            {selectedImage ? (
              <div className="flex items-center gap-4 w-full text-left">
                <img
                  src={selectedImage}
                  alt="Selected preview"
                  referrerPolicy="no-referrer"
                  className="w-16 h-20 object-cover rounded-md border border-stone-700 shadow-md flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">
                    {selectedFileName || 'Uploaded Photo'}
                  </p>
                  <p className="text-xs text-stone-400 mt-0.5">
                    Click to replace or drop another photo
                  </p>
                </div>
                <div className="w-8 h-8 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center flex-shrink-0">
                  <Check className="w-4 h-4" />
                </div>
              </div>
            ) : (
              <div className="py-4">
                <div className="w-12 h-12 rounded-full bg-stone-800/80 flex items-center justify-center mx-auto mb-3 text-stone-400">
                  <Upload className="w-5 h-5 text-stone-300" />
                </div>
                <p className="text-sm font-medium text-stone-200">
                  Drag & drop your photo here, or <span className="text-amber-400 underline">browse</span>
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  Supports portraits, still life, objects, animals (JPG, PNG, WebP)
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Choose Drawing Style */}
        <div className="mb-7">
          <label className="block text-xs font-semibold uppercase tracking-wider text-stone-300 mb-2.5">
            2. Choose Drawing Style
          </label>

          <div className="grid grid-cols-3 gap-2.5">
            {/* Style: Graphite Pencil */}
            <button
              id="style-pencil-btn"
              type="button"
              onClick={() => setStyle('pencil')}
              className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                style === 'pencil'
                  ? 'border-amber-400 bg-amber-400/10 text-white shadow-lg ring-1 ring-amber-400/30'
                  : 'border-stone-800 bg-stone-950/40 text-stone-400 hover:border-stone-700 hover:text-stone-200'
              }`}
            >
              <span className="text-xs font-medium text-white">Graphite Pencil</span>
              <span className="text-[11px] text-stone-400 mt-1 line-clamp-2">
                2H/4B fine graphite lines, subtle silver-grey sheen & hatching.
              </span>
              <span className="text-[10px] text-amber-400/80 font-mono mt-2">
                Default Classic
              </span>
            </button>

            {/* Style: Charcoal */}
            <button
              id="style-charcoal-btn"
              type="button"
              onClick={() => setStyle('charcoal')}
              className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                style === 'charcoal'
                  ? 'border-amber-400 bg-amber-400/10 text-white shadow-lg ring-1 ring-amber-400/30'
                  : 'border-stone-800 bg-stone-950/40 text-stone-400 hover:border-stone-700 hover:text-stone-200'
              }`}
            >
              <span className="text-xs font-medium text-white">Charcoal</span>
              <span className="text-[11px] text-stone-400 mt-1 line-clamp-2">
                Deep matte carbon darks, velvety textures & expressive strokes.
              </span>
              <span className="text-[10px] text-stone-500 font-mono mt-2">
                Dramatic Tone
              </span>
            </button>

            {/* Style: Fineliner */}
            <button
              id="style-fineliner-btn"
              type="button"
              onClick={() => setStyle('fineliner')}
              className={`flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer ${
                style === 'fineliner'
                  ? 'border-amber-400 bg-amber-400/10 text-white shadow-lg ring-1 ring-amber-400/30'
                  : 'border-stone-800 bg-stone-950/40 text-stone-400 hover:border-stone-700 hover:text-stone-200'
              }`}
            >
              <span className="text-xs font-medium text-white">Fineliner</span>
              <span className="text-[11px] text-stone-400 mt-1 line-clamp-2">
                Crisp technical micron ink, high contrast & fine cross-hatching.
              </span>
              <span className="text-[10px] text-stone-500 font-mono mt-2">
                Archival Ink
              </span>
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-950/50 border border-red-800/80 text-red-200 text-xs">
            {error}
          </div>
        )}

        {/* Processing State */}
        {isProcessing && (
          <div className="mb-4 p-3 rounded-lg bg-stone-950/80 border border-stone-800 flex items-center gap-3">
            <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin flex-shrink-0" />
            <span className="text-xs font-mono text-amber-200">{processStep}</span>
          </div>
        )}

        {/* Action Buttons Row */}
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          <button
            id="generate-animation-btn"
            type="button"
            disabled={!selectedImage || isProcessing}
            onClick={() => handleGenerate(false)}
            className={`flex-1 w-full py-3.5 px-4 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
              !selectedImage || isProcessing
                ? 'bg-stone-800 text-stone-500 cursor-not-allowed'
                : 'bg-amber-400 hover:bg-amber-300 text-stone-950 shadow-lg hover:shadow-amber-400/20 active:scale-[0.99]'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            <span>Generate 60-Second Drawing Animation</span>
          </button>

          <button
            id="verify-paths-debug-btn"
            type="button"
            disabled={!selectedImage || isProcessing}
            onClick={() => handleGenerate(true)}
            title="Inspect and verify the consolidated paths overlay color-coded per phase before the hand animation plays"
            className={`w-full sm:w-auto py-3.5 px-4 rounded-xl font-medium text-xs flex items-center justify-center gap-2 border transition-all cursor-pointer ${
              !selectedImage || isProcessing
                ? 'bg-stone-800/40 text-stone-600 border-stone-800 cursor-not-allowed'
                : 'bg-stone-900/90 hover:bg-stone-800 text-amber-300 border-amber-500/40 hover:border-amber-400 active:scale-[0.99] shadow-md'
            }`}
          >
            <Layers className="w-4 h-4 text-amber-400" />
            <span>Verify Paths (Debug)</span>
          </button>
        </div>

        {/* Subtle note about screen recording */}
        <p className="text-[11px] text-center text-stone-500 mt-3">
          The animation is rendered live in your browser. Fullscreen mode hides all controls for pristine screen-recording.
        </p>
      </div>
    </div>
  );
};
