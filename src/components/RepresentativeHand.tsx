import React, { useMemo } from 'react';
import { DrawingStyle } from '../types';

interface RepresentativeHandProps {
  x: number; // Pencil tip X in paper coordinates
  y: number; // Pencil tip Y in paper coordinates
  isDrawing: boolean;
  lift?: number; // 0 = touching paper, 1 = lifted
  angle?: number; // Dynamic wrist angle in radians
  style?: DrawingStyle;
  paperWidth: number;
  paperHeight: number;
}

export const RepresentativeHand: React.FC<RepresentativeHandProps> = ({
  x,
  y,
  isDrawing,
  lift = 0,
  angle = 0,
  style = 'pencil',
  paperWidth,
  paperHeight
}) => {
  // Lift offset: when lifted, hand pulls up and slightly to the right
  const liftHeight = (isDrawing ? 0 : Math.max(0.1, lift)) * 26;
  const liftShadowBlur = 6 + liftHeight * 0.9;
  const liftShadowOpacity = Math.max(0.08, 0.45 - (liftHeight / 26) * 0.28);
  const tipContactShadowOpacity = isDrawing ? 0.75 : Math.max(0, 0.45 - (liftHeight / 26) * 0.45);

  // Dynamic wrist rotation + natural tilt based on canvas position
  // When reaching top-left, wrist extends slightly; when bottom-right, wrist curls
  const posAngleOffset = useMemo(() => {
    if (!paperWidth || !paperHeight) return 0;
    const normX = (x / paperWidth) - 0.5;
    const normY = (y / paperHeight) - 0.5;
    return normX * 0.08 - normY * 0.05;
  }, [x, y, paperWidth, paperHeight]);

  const totalAngleDeg = ((angle + posAngleOffset) * 180) / Math.PI;

  // Tool specific colors and accents
  const toolColors = useMemo(() => {
    switch (style) {
      case 'charcoal':
        return {
          barrelPrimary: '#262422',
          barrelSecondary: '#151413',
          barrelHighlight: '#3d3b38',
          woodCollar: '#524338',
          woodGrain: '#382e26',
          coreTip: '#0f0e0d',
          band: '#403c38'
        };
      case 'fineliner':
        return {
          barrelPrimary: '#1a1a1c',
          barrelSecondary: '#0d0d0e',
          barrelHighlight: '#2e2e33',
          woodCollar: '#9e9ea6', // metallic ferrule
          woodGrain: '#7a7a82',
          coreTip: '#050505',
          band: '#d4af37' // gold accent ring
        };
      case 'pencil':
      default:
        return {
          barrelPrimary: '#d97706', // classic yellow cedar
          barrelSecondary: '#b45309',
          barrelHighlight: '#fbbf24',
          woodCollar: '#e6c89c', // carved wood cone
          woodGrain: '#caa174',
          coreTip: '#2b2927', // graphite lead
          band: '#9ca3af' // silver ferrule
        };
    }
  }, [style]);

  return (
    <div
      id="representative-hand-container"
      className="absolute top-0 left-0 pointer-events-none z-30"
      style={{
        transform: `translate3d(${x}px, ${y - liftHeight}px, 0)`,
        transformOrigin: '0px 0px',
        transition: 'transform 0.04s linear'
      }}
    >
      {/* ----------------------------------------------------------------- */}
      {/* 1. SEPARATE DYNAMIC CONTACT SHADOW (Directly on paper at (0, 0))   */}
      {/* ----------------------------------------------------------------- */}
      <div
        id="pencil-contact-shadow"
        className="absolute rounded-full pointer-events-none"
        style={{
          width: isDrawing ? '7px' : '16px',
          height: isDrawing ? '4px' : '9px',
          left: `${2 + liftHeight * 0.4}px`,
          top: `${liftHeight + 1}px`,
          backgroundColor: '#171412',
          opacity: tipContactShadowOpacity,
          filter: `blur(${isDrawing ? '1.2px' : '4px'})`,
          transform: 'translate(-50%, -50%)',
          transition: 'all 0.08s ease-out'
        }}
      />

      {/* ----------------------------------------------------------------- */}
      {/* 2. LAYERED REPRESENTATIVE HAND & PENCIL SVG                      */}
      {/* Anchor point: (0, 0) is locked exactly to the pencil tip point!  */}
      {/* ----------------------------------------------------------------- */}
      <div
        id="representative-hand-body"
        style={{
          transform: `rotate(${totalAngleDeg}deg)`,
          transformOrigin: '0px 0px'
        }}
      >
        <svg
          width="760"
          height="640"
          viewBox="0 0 760 640"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="overflow-visible"
          style={{
            filter: `drop-shadow(${10 + liftHeight * 0.5}px ${14 + liftHeight * 0.6}px ${liftShadowBlur}px rgba(22, 16, 12, ${liftShadowOpacity}))`
          }}
        >
          <defs>
            {/* Skin Tone Gradients (Soft warm studio lamp from top-left) */}
            <linearGradient id="skinBaseGrad" x1="120" y1="20" x2="380" y2="400" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#f7d3ba" />
              <stop offset="35%" stopColor="#e8b492" />
              <stop offset="70%" stopColor="#cf9672" />
              <stop offset="100%" stopColor="#ad6f4c" />
            </linearGradient>

            <linearGradient id="skinHighlightGrad" x1="100" y1="50" x2="300" y2="200" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#fff2e8" stopOpacity="0.75" />
              <stop offset="60%" stopColor="#f3ccb0" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#cf9672" stopOpacity="0" />
            </linearGradient>

            <linearGradient id="armExtensionGrad" x1="280" y1="180" x2="720" y2="580" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#d69c76" />
              <stop offset="45%" stopColor="#bf855e" />
              <stop offset="85%" stopColor="#965f3d" />
              <stop offset="100%" stopColor="#6e4125" />
            </linearGradient>

            {/* Pencil Gradients */}
            <linearGradient id="pencilWoodGrad" x1="0" y1="0" x2="48" y2="36" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={toolColors.woodCollar} />
              <stop offset="50%" stopColor={toolColors.woodGrain} />
              <stop offset="100%" stopColor={toolColors.woodCollar} />
            </linearGradient>

            <linearGradient id="pencilBarrelFacet1" x1="40" y1="10" x2="220" y2="180" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={toolColors.barrelHighlight} />
              <stop offset="60%" stopColor={toolColors.barrelPrimary} />
              <stop offset="100%" stopColor={toolColors.barrelSecondary} />
            </linearGradient>

            <linearGradient id="pencilBarrelFacet2" x1="40" y1="30" x2="240" y2="200" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor={toolColors.barrelPrimary} />
              <stop offset="100%" stopColor={toolColors.barrelSecondary} />
            </linearGradient>

            {/* Nail Gradient */}
            <linearGradient id="nailGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fdeee6" />
              <stop offset="80%" stopColor="#f3c8b4" />
              <stop offset="100%" stopColor="#e2a68e" />
            </linearGradient>

            {/* Subtle Knuckle Crease Filter */}
            <filter id="creaseShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="1" dy="1" stdDeviation="1.5" floodColor="#7a4628" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* ------------------------------------------------------------- */}
          {/* PENCIL: Sharpened tip at (0, 0), angled up and to the right   */}
          {/* ------------------------------------------------------------- */}
          <g id="pencil-group">
            {/* The Graphite / Charcoal / Fineliner Core Tip (0,0) to (12, 9) */}
            <polygon
              points="0,0 12,5 9,11"
              fill={toolColors.coreTip}
            />

            {/* Sharpened Wood Cone (from graphite tip to hexagonal barrel) */}
            <polygon
              points="12,5 46,20 38,38 9,11"
              fill="url(#pencilWoodGrad)"
              stroke="#b58a5c"
              strokeWidth="0.5"
            />
            {/* Wood Grain notches */}
            <path
              d="M 22,12 Q 24,18 20,23 M 32,16 Q 34,24 30,30"
              stroke="#8c6239"
              strokeWidth="0.8"
              fill="none"
              opacity="0.6"
            />

            {/* Hexagonal Pencil Barrel - Upper facet (Highlight) */}
            <polygon
              points="46,20 220,105 212,120 42,29"
              fill="url(#pencilBarrelFacet1)"
            />
            {/* Hexagonal Pencil Barrel - Lower facet (Shadow) */}
            <polygon
              points="42,29 212,120 204,136 38,38"
              fill="url(#pencilBarrelFacet2)"
            />

            {/* Pencil Ridge lines */}
            <line x1="46" y1="20" x2="220" y2="105" stroke="#fef08a" strokeWidth="0.75" opacity="0.7" />
            <line x1="42" y1="29" x2="212" y2="120" stroke="#78350f" strokeWidth="0.75" opacity="0.6" />
            <line x1="38" y1="38" x2="204" y2="136" stroke="#451a03" strokeWidth="0.75" opacity="0.8" />
          </g>

          {/* ------------------------------------------------------------- */}
          {/* FOREARM & ARM EXTENSION (Seamlessly extends out to bottom-right) */}
          {/* ------------------------------------------------------------- */}
          <g id="arm-extension-group">
            {/* Massive natural forearm extending past 760px to edge of viewport */}
            <path
              d="M 280,180 
                 C 360,220 450,270 540,325 
                 C 620,375 700,435 780,490 
                 L 780,640 
                 L 440,640 
                 C 380,560 320,470 260,390 
                 C 220,335 200,285 215,240 
                 Z"
              fill="url(#armExtensionGrad)"
            />

            {/* Soft Ambient Shadow on lower forearm flank */}
            <path
              d="M 260,390 
                 C 320,470 380,560 440,640 
                 L 780,640 
                 L 760,570 
                 C 620,490 480,400 360,320 
                 Z"
              fill="#522b13"
              opacity="0.35"
            />
          </g>

          {/* ------------------------------------------------------------- */}
          {/* HAND, PALM & FINGERS (Realistic artist tripod grip)          */}
          {/* ------------------------------------------------------------- */}
          <g id="hand-grip-group">
            {/* Palm Base & Hypothenar Eminence (resting side of hand) */}
            <path
              d="M 175,170 
                 C 210,185 245,215 270,255 
                 C 290,290 280,345 250,380 
                 C 220,410 180,405 150,370 
                 C 130,345 125,305 135,260 
                 C 142,225 155,190 175,170 Z"
              fill="url(#skinBaseGrad)"
            />

            {/* Middle Finger (Supporting pencil from underneath) */}
            <path
              d="M 75,95 
                 C 70,85 80,72 95,78 
                 C 115,86 135,108 145,130 
                 C 152,145 145,160 132,152 
                 C 118,144 95,125 82,108 Z"
              fill="#b97c55"
              stroke="#935b37"
              strokeWidth="0.75"
            />

            {/* Ring & Pinky Fingers (Curled naturally in toward palm) */}
            <path
              d="M 120,165 
                 C 110,185 105,215 125,235 
                 C 140,250 165,245 175,225 
                 C 185,205 180,180 160,168 Z"
              fill="#c68b64"
            />
            <path
              d="M 140,225 
                 C 135,245 132,270 150,285 
                 C 165,295 185,285 190,265 
                 C 195,245 185,225 170,220 Z"
              fill="#b0734c"
            />

            {/* Thumb (Securing the pencil from the side) */}
            <path
              d="M 68,52 
                 C 58,45 68,32 82,38 
                 C 105,48 135,78 152,112 
                 C 168,145 175,185 160,205 
                 C 148,220 132,210 128,185 
                 C 122,150 95,95 76,64 Z"
              fill="url(#skinBaseGrad)"
              stroke="#9b613c"
              strokeWidth="0.5"
            />

            {/* Thumb Fingernail */}
            <path
              d="M 72,42 C 70,38 76,34 82,37 C 86,39 88,44 85,47 C 80,49 74,47 72,42 Z"
              fill="url(#nailGrad)"
              stroke="#d49c82"
              strokeWidth="0.5"
            />

            {/* Index Finger (The main finger arched over the pencil collar) */}
            {/* Proximal & Intermediate Phalanges */}
            <path
              d="M 85,32 
                 C 105,22 135,25 165,42 
                 C 195,60 225,95 240,140 
                 C 250,170 235,195 210,185 
                 C 190,175 175,140 150,105 
                 C 125,72 100,50 82,42 Z"
              fill="url(#skinBaseGrad)"
            />

            {/* Index Finger Distal Phalanx & Tip curving around pencil */}
            <path
              d="M 48,34 
                 C 40,24 52,14 66,18 
                 C 82,24 102,38 115,55 
                 C 112,68 95,65 82,54 
                 C 68,44 55,40 48,34 Z"
              fill="url(#skinBaseGrad)"
              stroke="#9b613c"
              strokeWidth="0.5"
            />

            {/* Index Fingernail */}
            <path
              d="M 52,24 C 50,19 56,16 63,18 C 67,20 68,25 65,28 C 60,30 54,28 52,24 Z"
              fill="url(#nailGrad)"
              stroke="#d49c82"
              strokeWidth="0.5"
            />

            {/* Knuckle Creases and Skin Texture Lines */}
            <g opacity="0.65">
              <path d="M 105,42 Q 112,46 110,54" stroke="#7a4628" strokeWidth="0.8" fill="none" />
              <path d="M 145,72 Q 155,78 152,90" stroke="#7a4628" strokeWidth="0.9" fill="none" />
              <path d="M 188,115 Q 200,122 195,138" stroke="#7a4628" strokeWidth="1.1" fill="none" />
              <path d="M 194,122 Q 206,128 201,144" stroke="#7a4628" strokeWidth="0.9" fill="none" />
              <path d="M 102,95 Q 112,102 108,114" stroke="#7a4628" strokeWidth="0.8" fill="none" />
            </g>

            {/* Top-Left Lighting Highlight on Hand & Tendons */}
            <path
              d="M 85,32 
                 C 105,22 135,25 165,42 
                 C 195,60 225,95 240,140 
                 C 230,120 205,85 175,60 
                 C 145,38 115,30 85,32 Z"
              fill="url(#skinHighlightGrad)"
            />

            {/* Wrist Tendon Accent */}
            <path
              d="M 215,160 Q 255,190 290,225"
              stroke="#fff2e8"
              strokeWidth="2.5"
              strokeLinecap="round"
              opacity="0.3"
              fill="none"
            />
          </g>
        </svg>
      </div>
    </div>
  );
};
