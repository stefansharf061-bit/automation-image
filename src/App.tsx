import React, { useState } from 'react';
import { DrawingData, DrawingStyle } from './types';
import { SetupPanel } from './components/SetupPanel';
import { ArtBoardScene } from './components/ArtBoardScene';

export default function App() {
  const [drawingData, setDrawingData] = useState<DrawingData | null>(null);
  const [currentStyle, setCurrentStyle] = useState<DrawingStyle>('pencil');
  const [initialDebug, setInitialDebug] = useState<boolean>(false);

  const handleGenerateComplete = (data: DrawingData, style: DrawingStyle, debug = false) => {
    setDrawingData(data);
    setCurrentStyle(style);
    setInitialDebug(debug);
  };

  const handleBackToSetup = () => {
    setDrawingData(null);
    setInitialDebug(false);
  };

  if (drawingData) {
    return (
      <ArtBoardScene
        drawingData={drawingData}
        style={currentStyle}
        initialDebug={initialDebug}
        onBackToSetup={handleBackToSetup}
      />
    );
  }

  return <SetupPanel onGenerateComplete={handleGenerateComplete} />;
}
