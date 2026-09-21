import React, { useState } from 'react';
import { DrawingData, DrawingStyle } from './types';
import { SetupPanel } from './components/SetupPanel';
import { ArtBoardScene } from './components/ArtBoardScene';

export default function App() {
  const [drawingData, setDrawingData] = useState<DrawingData | null>(null);
  const [currentStyle, setCurrentStyle] = useState<DrawingStyle>('pencil');

  const handleGenerateComplete = (data: DrawingData, style: DrawingStyle) => {
    setDrawingData(data);
    setCurrentStyle(style);
  };

  const handleBackToSetup = () => {
    setDrawingData(null);
  };

  if (drawingData) {
    return (
      <ArtBoardScene
        drawingData={drawingData}
        style={currentStyle}
        onBackToSetup={handleBackToSetup}
      />
    );
  }

  return <SetupPanel onGenerateComplete={handleGenerateComplete} />;
}
