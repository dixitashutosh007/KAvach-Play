/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { toPng, toBlob, toCanvas } from 'html-to-image';
import html2canvas from 'html2canvas';
import { 
  Download, 
  Upload, 
  User, 
  Trophy, 
  Settings, 
  Sparkles, 
  Image as ImageIcon,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import WeeklySummaryCreator from './WeeklySummaryCreator';
import SpecialAchievementCreator from './SpecialAchievementCreator';
import PlayerCardCreator from './PlayerCardCreator';
import { Header, AppMode } from './Header';
import { compressImage } from './imageUtils';

// --- Utility ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
type PlayerType = 'batsman' | 'bowler' | 'all-rounder';
type CardType = 'potm' | 'best_batsman' | 'best_bowler';
type AspectRatio = '1:1' | '4:5' | '9:16';
type LayoutType = 'classic' | 'modern' | 'bold' | 'minimal';
type AIStyle = 'fierce' | 'stylish' | 'calm' | 'aggressive' | 'blurred' | 'ground';

interface TeamInfo {
  name: string;
  score: string;
  overs: string;
}

interface BatsmanStats {
  runs: string;
  balls: string;
  isNotOut: boolean;
}

interface BowlerStats {
  overs: string;
  runs: string;
  wickets: string;
}

interface CardData {
  playerName: string;
  playerType: PlayerType;
  batsmanStats: BatsmanStats;
  bowlerStats: BowlerStats;
  teamA: TeamInfo;
  teamB: TeamInfo;
  matchResult: string;
  themeColor: string;
  aspectRatio: AspectRatio;
  layout: LayoutType;
  cardType: CardType;
  playerImage: string | null;
  logoImage: string | null;
  aiStyle: AIStyle;
  isAIEnabled: boolean;
}

// --- Constants ---
const DEFAULT_KAVACH_LOGO = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHBhdGggZD0iTTEwMCAyMEw0MCA1MFYxMDBDNDAgMTQwIDEwMCAxODAgMTAwIDE4MEMxMDAgMTgwIDE2MCAxNDAgMTYwIDEwMFY1MEwxMDAgMjBaIiBmaWxsPSIjRjI3RDI2Ii8+CiAgPHRleHQgeD0iMTAwIiB5PSIxMTUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSI2MCIgZm9udC13ZWlnaHQ9ImJvbGQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5LPC90ZXh0Pgo8L3N2Zz4=";

const THEMES = [
  { name: 'KAvach Crimson', color: '#DC143C', secondary: '#FFFFFF' },
  { name: 'KAvach Gold', color: '#F27D26', secondary: '#000000' },
  { name: 'Royal Blue', color: '#1E40AF', secondary: '#FFFFFF' },
  { name: 'Cricket Green', color: '#15803D', secondary: '#FFFFFF' },
  { name: 'Elite Red', color: '#B91C1C', secondary: '#FFFFFF' },
  { name: 'Deep Purple', color: '#6D28D9', secondary: '#FFFFFF' },
];

const AI_STYLES: { id: AIStyle; label: string; filter: string }[] = [
  { id: 'fierce', label: 'Fierce', filter: 'contrast(1.25) saturate(1.4) drop-shadow(0 4px 12px rgba(0,0,0,0.5))' },
  { id: 'stylish', label: 'Stylish', filter: 'grayscale(0.2) contrast(1.15) brightness(1.05)' },
  { id: 'calm', label: 'Calm', filter: 'sepia(0.25) saturate(1.1) brightness(1.1) hue-rotate(-5deg)' },
  { id: 'aggressive', label: 'Aggressive', filter: 'contrast(1.35) saturate(1.6) hue-rotate(-15deg)' },
  { id: 'blurred', label: 'Soft Focus', filter: 'blur(0.5px) contrast(1.1) brightness(1.05)' },
  { id: 'ground', label: 'Vibrant', filter: 'saturate(1.3) contrast(1.15) brightness(1.05)' },
];

const LAYOUTS: { id: LayoutType; label: string; description: string; icon: React.ReactNode }[] = [
  { id: 'classic', label: 'Classic', description: 'Traditional sports card layout', icon: <ImageIcon size={14} /> },
  { id: 'modern', label: 'Modern', description: 'Clean, asymmetrical design', icon: <Sparkles size={14} /> },
  { id: 'bold', label: 'Impact', description: 'Large typography and high impact', icon: <Trophy size={14} /> },
  { id: 'minimal', label: 'Minimal', description: 'Focus on player and key stats', icon: <User size={14} /> },
];

// --- Components ---

const KAvachLogo = ({ className, sizeClass = "w-20 h-20", logoImage }: { className?: string, sizeClass?: string, logoImage?: string | null }) => (
  <div className={cn("flex flex-col items-center", className)}>
    <div className={cn("relative bg-white rounded-xl flex items-center justify-center p-1 shadow-lg border-2 border-[#F27D26] overflow-hidden", sizeClass)}>
       {logoImage ? (
         <img 
           src={logoImage} 
           alt="KAvach Logo" 
           className="w-full h-full object-contain"
           
         />
       ) : (
         <div className="w-full h-full rounded-lg bg-black flex flex-col items-center justify-center overflow-hidden p-1">
           <span className="text-[#F27D26] font-black text-2xl italic leading-none">K</span>
           <span className="text-white text-[5px] font-bold tracking-widest uppercase mt-0.5">KAvach</span>
         </div>
       )}
    </div>
  </div>
);

const ASPECT_RATIOS: { id: AspectRatio; label: string; desc: string }[] = [
  { id: '1:1', label: '1:1', desc: 'Insta Post' },
  { id: '4:5', label: '4:5', desc: 'FB/Insta Portrait' },
  { id: '9:16', label: '9:16', desc: 'Reel/Story/Status' },
];

export default function App() {
  useEffect(() => {
    document.title = "KAvach Design Studio";
  }, []);

  const [appMode, setAppMode] = useState<AppMode>('potm');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [generatingAI, setGeneratingAI] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [imageObjectPos, setImageObjectPos] = useState({ x: 50, y: 50 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDraggingImage(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingImage) return;
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;
    // Scale the dx/dy to a percentage offset. Adjust sensitivity as needed.
    const sensitivity = 0.5; 
    setImageObjectPos(prev => ({
      x: Math.max(0, Math.min(100, prev.x - dx * sensitivity)),
      y: Math.max(0, Math.min(100, prev.y - dy * sensitivity)),
    }));
    dragStartPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDraggingImage(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const [data, setData] = useState<CardData>({
    playerName: 'Suryakumar Yadav',
    playerType: 'batsman',
    batsmanStats: {
      runs: '111',
      balls: '51',
      isNotOut: true,
    },
    bowlerStats: {
      overs: '4.0',
      runs: '24',
      wickets: '3',
    },
    teamA: { name: 'KAvach', score: '191/6', overs: '20' },
    teamB: { name: 'NEW ZEALAND', score: '126', overs: '18.5' },
    matchResult: 'KAvach WON BY 65 RUNS',
    themeColor: '#DC143C',
    aspectRatio: '9:16',
    layout: 'classic',
    cardType: 'potm',
    playerImage: null,
    logoImage: DEFAULT_KAVACH_LOGO,
    aiStyle: 'stylish',
    isAIEnabled: false,
  });

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCompressing(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const compressedUrl = await compressImage(reader.result as string, 1000, 1000);
          setData(prev => ({ ...prev, playerImage: compressedUrl }));
        } catch (err) {
          console.error("Compression failed", err);
          alert("Failed to process image. If it's an iCloud photo, please wait for it to download or try again.");
        } finally {
          setCompressing(false);
          e.target.value = '';
        }
      };
      reader.onerror = () => {
        setCompressing(false);
        alert("Failed to read file. Please try again.");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCompressing(true);
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const compressedUrl = await compressImage(reader.result as string, 300, 300);
          setData(prev => ({ ...prev, logoImage: compressedUrl }));
        } catch (err) {
          console.error("Logo compression failed", err);
        } finally {
          setCompressing(false);
          e.target.value = '';
        }
      };
      reader.readAsDataURL(file);
    }
  };



  const downloadCard = async () => {
    if (!cardRef.current) return;
    setLoading(true);
    setDownloadError(null);
    try {
      // Small delay for rendering stability
      await new Promise(resolve => setTimeout(resolve, 500));

      const fileName = `KAvach_${data.playerName.replace(/\s+/g, '_')}_${data.cardType}.png`;
      
      // Fix for iOS Safari black image bug: warm up the renderer
      for(let i=0; i<3; i++) {
        try {
          await toPng(cardRef.current, { cacheBust: true, skipFonts: true });
        } catch(e) {}
      }

      // We use html-to-image instead of html2canvas because Tailwind v4 uses
      // oklch/oklab colors which html2canvas cannot parse properly.
      const dataUrl = await toPng(cardRef.current, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#F8F9FA',
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
          width: cardRef.current.offsetWidth + 'px',
          height: cardRef.current.offsetHeight + 'px'
        }
      });
      
      setGeneratedImage(dataUrl);

      try {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        // May fail in restricted iframes
      }

    } catch (err: any) {
      console.error('Download failed', err);
      setDownloadError('Download failed! ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  const renderStats = () => {
    const labelClass = "text-[7px] uppercase tracking-[0.2em] font-black opacity-40 mb-1";
    const valueClass = "text-xl font-black tracking-tighter leading-none";
    const borderClass = "border-l-2 pl-3 py-1 transition-all duration-300";

    const calculateSR = (runs: string, balls: string) => {
      const r = parseFloat(runs);
      const b = parseFloat(balls);
      if (!r || !b) return "0.0";
      return ((r / b) * 100).toFixed(1);
    };

    const calculateEconomy = (runs: string, overs: string) => {
      const r = parseFloat(runs);
      const o = parseFloat(overs);
      if (!r || !o) return "0.00";
      const fullOvers = Math.floor(o);
      const balls = Math.round((o - fullOvers) * 10);
      const totalOvers = fullOvers + (balls / 6);
      return (r / totalOvers).toFixed(2);
    };

    if (data.playerType === 'batsman') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className={cn(borderClass)} style={{ borderLeftColor: data.themeColor }}>
            <div className={labelClass}>Runs</div>
            <div className={valueClass} style={{ color: data.themeColor }}>{data.batsmanStats.runs}{data.batsmanStats.isNotOut ? '*' : ''}</div>
            <div className="text-[6px] uppercase font-bold opacity-30 mt-1">({data.batsmanStats.balls} Balls)</div>
          </div>
          <div className={cn(borderClass)} style={{ borderLeftColor: `${data.themeColor}40` }}>
            <div className={labelClass}>Strike Rate</div>
            <div className={valueClass}>{calculateSR(data.batsmanStats.runs, data.batsmanStats.balls)}</div>
            <div className="text-[6px] uppercase font-bold opacity-30 mt-1">Impact</div>
          </div>
        </div>
      );
    } else if (data.playerType === 'bowler') {
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className={cn(borderClass)} style={{ borderLeftColor: data.themeColor }}>
            <div className={labelClass}>Wickets</div>
            <div className={valueClass} style={{ color: data.themeColor }}>{data.bowlerStats.wickets}</div>
            <div className="text-[6px] uppercase font-bold opacity-30 mt-1">({data.bowlerStats.overs} Overs)</div>
          </div>
          <div className={cn(borderClass)} style={{ borderLeftColor: `${data.themeColor}40` }}>
            <div className={labelClass}>Economy</div>
            <div className={valueClass}>{calculateEconomy(data.bowlerStats.runs, data.bowlerStats.overs)}</div>
            <div className="text-[6px] uppercase font-bold opacity-30 mt-1">({data.bowlerStats.runs} Runs)</div>
          </div>
        </div>
      );
    } else {
      return (
        <div className="grid grid-cols-2 gap-4">
          <div className={cn(borderClass)} style={{ borderLeftColor: data.themeColor }}>
            <div className={labelClass}>Batting</div>
            <div className={valueClass} style={{ color: data.themeColor }}>{data.batsmanStats.runs}{data.batsmanStats.isNotOut ? '*' : ''}</div>
            <div className="text-[6px] uppercase font-bold opacity-30 mt-1">SR: {calculateSR(data.batsmanStats.runs, data.batsmanStats.balls)}</div>
          </div>
          <div className={cn(borderClass)} style={{ borderLeftColor: `${data.themeColor}40` }}>
            <div className={labelClass}>Bowling</div>
            <div className={valueClass}>{data.bowlerStats.wickets}/{data.bowlerStats.runs}</div>
            <div className="text-[6px] uppercase font-bold opacity-30 mt-1">Eco: {calculateEconomy(data.bowlerStats.runs, data.bowlerStats.overs)}</div>
          </div>
        </div>
      );
    }
  };

  if (appMode === 'weekly_summary') {
    return <WeeklySummaryCreator setAppMode={setAppMode} />;
  }
  
  if (appMode === 'achievement') {
    return <SpecialAchievementCreator setAppMode={setAppMode} />;
  }

  if (appMode === 'player_card') {
    return <PlayerCardCreator setAppMode={setAppMode} />;
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#F27D26]/30">
      {/* Processing Overlay */}
      <AnimatePresence>
        {generatedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-[110] flex flex-col items-center justify-center p-6 text-center overflow-y-auto"
          >
            <div className="bg-white/10 p-4 rounded-3xl w-full max-w-sm overflow-hidden flex flex-col items-center border border-white/20 shadow-2xl space-y-6">
              <h3 className="text-xl font-bold mt-2">Card Generated!</h3>
              <p className="text-white/60 text-sm opacity-80">
                To save, you can <span className="font-bold text-white">Long Press</span> or <span className="font-bold text-white">Right Click</span> the image below and select <span className="font-bold text-white">Save Image</span>.
              </p>
              <div className="w-full bg-black rounded-xl overflow-hidden shadow-2xl pointer-events-auto">
                <img src={generatedImage} alt="Generated Card" className="w-full h-auto object-contain" />
              </div>

              <div className="flex gap-4 w-full">
                <button 
                  onClick={() => setGeneratedImage(null)}
                  className="flex-1 border border-white/20 hover:bg-white/10 px-4 py-3 rounded-xl text-sm font-bold transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {(loading || compressing) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative">
              <div className="w-20 h-20 border-4 border-[#F27D26]/20 border-t-[#F27D26] rounded-full animate-spin" />
              <Trophy className="absolute inset-0 m-auto text-[#F27D26] w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-bold mt-6 mb-2">
              {compressing ? "Optimizing Image..." : "Generating Your Card..."}
            </h3>
            <p className="text-white/60 max-w-xs text-sm">
              {compressing 
                ? "We're making your image mobile-friendly for the best quality." 
                : "Our AI is crafting your professional Player of the Match graphic."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <Header 
        appMode={appMode}
        setAppMode={setAppMode}
        title="KAvach Design Studio"
        subtitle="Go Get Them !"
        onDownload={downloadCard}
        downloadDisabled={loading || compressing || !data.playerImage}
        step={step}
      />

      <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 p-6 lg:p-10">
        
        {/* Left: Controls */}
        <div className="lg:col-span-5 space-y-8">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
                  <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                    <User size={16} className="text-[#F27D26]" />
                    Player Information
                  </h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] uppercase text-white/40 mb-1 block">Card Type</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[
                          { id: 'potm', label: 'Player of Match' },
                          { id: 'best_batsman', label: 'Best Batsman' },
                          { id: 'best_bowler', label: 'Best Bowler' }
                        ].map((type) => (
                          <button
                            key={type.id}
                            onClick={() => setData(prev => ({ ...prev, cardType: type.id as CardType }))}
                            className={cn(
                              "py-2 rounded-lg text-[10px] uppercase font-bold border transition-all text-center",
                              data.cardType === type.id 
                                ? "bg-[#F27D26] text-black border-[#F27D26]" 
                                : "bg-transparent border-white/10 text-white/60 hover:border-white/30"
                            )}
                          >
                            {type.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase text-white/40 mb-1 block">Player Name</label>
                      <input 
                        type="text" 
                        value={data.playerName}
                        onChange={(e) => setData(prev => ({ ...prev, playerName: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus:outline-none focus:border-[#F27D26] transition-colors"
                        placeholder="Enter player name"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] uppercase text-white/40 mb-1 block">Player Class</label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {(['batsman', 'bowler', 'all-rounder'] as PlayerType[]).map((type) => (
                          <button
                            key={type}
                            onClick={() => setData(prev => ({ ...prev, playerType: type }))}
                            className={cn(
                              "py-2 rounded-lg text-[10px] uppercase font-bold border transition-all",
                              data.playerType === type 
                                ? "bg-white text-black border-white" 
                                : "bg-transparent border-white/10 text-white/60 hover:border-white/30"
                            )}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
                  <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Settings size={16} className="text-[#F27D26]" />
                    Match Stats
                  </h2>

                  <div className="space-y-6">
                    {/* Batsman Stats */}
                    {(data.playerType === 'batsman' || data.playerType === 'all-rounder') && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2 flex items-center justify-between">
                          <span className="text-[10px] uppercase text-white/60">Batting Performance</span>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={data.batsmanStats.isNotOut}
                              onChange={(e) => setData(prev => ({ ...prev, batsmanStats: { ...prev.batsmanStats, isNotOut: e.target.checked } }))}
                              className="accent-[#F27D26]"
                            />
                            <span className="text-[10px] uppercase">Not Out</span>
                          </label>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase text-white/40 ml-1">Runs</label>
                          <input 
                            type="text" placeholder="Runs"
                            value={data.batsmanStats.runs}
                            onChange={(e) => setData(prev => ({ ...prev, batsmanStats: { ...prev.batsmanStats, runs: e.target.value } }))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase text-white/40 ml-1">Balls</label>
                          <input 
                            type="text" placeholder="Balls"
                            value={data.batsmanStats.balls}
                            onChange={(e) => setData(prev => ({ ...prev, batsmanStats: { ...prev.batsmanStats, balls: e.target.value } }))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                      </div>
                    )}

                    {/* Bowler Stats */}
                    {(data.playerType === 'bowler' || data.playerType === 'all-rounder') && (
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
                        <span className="col-span-2 text-[10px] uppercase text-white/60">Bowling Performance</span>
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase text-white/40 ml-1">Wickets</label>
                          <input 
                            type="text" placeholder="Wickets"
                            value={data.bowlerStats.wickets}
                            onChange={(e) => setData(prev => ({ ...prev, bowlerStats: { ...prev.bowlerStats, wickets: e.target.value } }))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase text-white/40 ml-1">Overs</label>
                          <input 
                            type="text" placeholder="Overs"
                            value={data.bowlerStats.overs}
                            onChange={(e) => setData(prev => ({ ...prev, bowlerStats: { ...prev.bowlerStats, overs: e.target.value } }))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] uppercase text-white/40 ml-1">Runs</label>
                          <input 
                            type="text" placeholder="Runs"
                            value={data.bowlerStats.runs}
                            onChange={(e) => setData(prev => ({ ...prev, bowlerStats: { ...prev.bowlerStats, runs: e.target.value } }))}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <div className="flex justify-end">
                  <button 
                    onClick={() => setStep(2)}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-6 py-3 rounded-full text-sm font-bold transition-all"
                  >
                    Next: Style & Image <ChevronRight size={16} />
                  </button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                key="step2"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
                  <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                    <ImageIcon size={16} className="text-[#F27D26]" />
                    Branding & Assets
                  </h2>

                  <div className="space-y-6">
                    <div>
                      <span className="text-[10px] uppercase text-white/40 mb-3 block">KAvach Logo</span>
                      <div 
                        onClick={() => document.getElementById('logo-upload')?.click()}
                        className="h-24 rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#F27D26]/50 hover:bg-[#F27D26]/5 transition-all group overflow-hidden"
                      >
                        {data.logoImage ? (
                          <img src={data.logoImage} alt="Logo" className="h-full object-contain p-2" />
                        ) : (
                          <>
                            <Upload className="text-white/20 group-hover:text-[#F27D26] transition-colors" size={24} />
                            <span className="text-[10px] text-white/40 group-hover:text-white/60">Upload KAvach Logo</span>
                          </>
                        )}
                        <input id="logo-upload" type="file" hidden accept="image/*" onChange={handleLogoUpload} />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-white/5">
                      <span className="text-[10px] uppercase text-white/40 mb-3 block">Player Photo</span>
                      <div 
                        onClick={() => document.getElementById('image-upload')?.click()}
                        className="aspect-video rounded-xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#F27D26]/50 hover:bg-[#F27D26]/5 transition-all group overflow-hidden"
                      >
                        {data.playerImage ? (
                          <img src={data.playerImage} alt="Player" className="w-full h-full object-cover" />
                        ) : (
                          <>
                            <Upload className="text-white/20 group-hover:text-[#F27D26] transition-colors" size={32} />
                            <span className="text-xs text-white/40 group-hover:text-white/60">Upload Player Photo</span>
                          </>
                        )}
                        <input id="image-upload" type="file" hidden accept="image/*" onChange={handleImageUpload} />
                      </div>
                    </div>

                    {data.playerImage && (
                      <div className="space-y-4 pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between">
                          <h3 className="text-[10px] uppercase font-bold tracking-widest text-[#F27D26] flex items-center gap-2">
                            <Sparkles size={12} />
                            CSS Image Filters
                          </h3>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2">
                          {AI_STYLES.map((style) => (
                            <button
                              key={style.id}
                              onClick={() => setData(prev => ({ ...prev, aiStyle: style.id, isAIEnabled: true }))}
                              className={cn(
                                "px-2 py-2 rounded-lg text-[8px] uppercase font-bold border transition-all",
                                data.aiStyle === style.id && data.isAIEnabled
                                  ? "bg-white text-black border-white" 
                                  : "bg-transparent border-white/10 text-white/60 hover:border-white/30"
                              )}
                            >
                              {style.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
                  <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Settings size={16} className="text-[#F27D26]" />
                    Theme & Layout
                  </h2>

                  <div className="space-y-6">
                    <div>
                      <span className="text-[10px] uppercase text-white/40 mb-3 block">Color Theme</span>
                      <div className="flex flex-wrap gap-3">
                        {THEMES.map((theme) => (
                          <button
                            key={theme.name}
                            onClick={() => setData(prev => ({ ...prev, themeColor: theme.color }))}
                            className={cn(
                              "w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center",
                              data.themeColor === theme.color ? "border-white scale-110" : "border-transparent opacity-60"
                            )}
                            style={{ backgroundColor: theme.color }}
                          >
                            {data.themeColor === theme.color && <Check size={14} className="text-white" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase text-white/40 mb-3 block">Aspect Ratio</span>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {ASPECT_RATIOS.map((ratio) => (
                          <button
                            key={ratio.id}
                            onClick={() => setData(prev => ({ ...prev, aspectRatio: ratio.id }))}
                            className={cn(
                              "py-3 px-2 rounded-xl text-[10px] uppercase font-bold border transition-all flex flex-col items-center justify-center gap-1",
                              data.aspectRatio === ratio.id 
                                ? "bg-white text-black border-white" 
                                : "bg-transparent border-white/10 text-white/60 hover:bg-white/5"
                            )}
                          >
                            <span>{ratio.label}</span>
                            <span className="text-[8px] opacity-70 normal-case text-center leading-tight">{ratio.desc}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] uppercase text-white/40 mb-3 block">Card Layout</span>
                      <div className="relative group">
                        <select 
                          value={data.layout}
                          onChange={(e) => setData(prev => ({ ...prev, layout: e.target.value as LayoutType }))}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 appearance-none focus:outline-none focus:border-[#F27D26] transition-colors text-sm font-medium cursor-pointer"
                        >
                          {LAYOUTS.map((layout) => (
                            <option key={layout.id} value={layout.id} className="bg-[#1A1A1A]">
                              {layout.label} - {layout.description}
                            </option>
                          ))}
                        </select>
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-white/40 group-hover:text-[#F27D26] transition-colors">
                          <ChevronRight size={16} className="rotate-90" />
                        </div>
                      </div>
                      
                      {/* Visual Selection Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
                        {LAYOUTS.map((layout) => (
                          <button
                            key={layout.id}
                            onClick={() => setData(prev => ({ ...prev, layout: layout.id }))}
                            className={cn(
                              "aspect-square rounded-lg border transition-all flex flex-col items-center justify-center gap-1 group",
                              data.layout === layout.id 
                                ? "bg-[#F27D26] border-[#F27D26] text-black" 
                                : "bg-white/5 border-white/10 text-white/40 hover:border-white/30"
                            )}
                            title={layout.description}
                          >
                            <div className={cn(
                              "transition-transform",
                              data.layout === layout.id ? "scale-110" : "group-hover:scale-110"
                            )}>
                              {layout.icon}
                            </div>
                            <span className="text-[8px] font-bold uppercase">{layout.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <div className="flex justify-between">
                  <button 
                    onClick={() => setStep(1)}
                    className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-bold"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button 
                    onClick={() => setStep(3)}
                    className="flex items-center gap-2 bg-white/10 hover:bg-white/20 px-6 py-3 rounded-full text-sm font-bold transition-all"
                  >
                    Next: Finalize <ChevronRight size={16} />
                  </button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                key="step3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <section className="bg-white/5 rounded-2xl p-6 border border-white/10">
                  <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Trophy size={16} className="text-[#F27D26]" />
                    Match Context
                  </h2>

                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#F27D26]" />
                          <span className="text-[10px] uppercase font-bold tracking-wider text-white/60">Team A</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[9px] uppercase text-white/30 ml-1">Team Name</label>
                            <input 
                              type="text" value={data.teamA.name}
                              onChange={(e) => setData(prev => ({ ...prev, teamA: { ...prev.teamA, name: e.target.value } }))}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                              placeholder="Team A Name"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] uppercase text-white/30 ml-1">Score</label>
                            <input 
                              type="text" placeholder="e.g. 191/6"
                              value={data.teamA.score}
                              onChange={(e) => setData(prev => ({ ...prev, teamA: { ...prev.teamA, score: e.target.value } }))}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] uppercase text-white/30 ml-1">Overs</label>
                            <input 
                              type="text" placeholder="e.g. 20"
                              value={data.teamA.overs}
                              onChange={(e) => setData(prev => ({ ...prev, teamA: { ...prev.teamA, overs: e.target.value } }))}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                          <span className="text-[10px] uppercase font-bold tracking-wider text-white/60">Team B</span>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="text-[9px] uppercase text-white/30 ml-1">Team Name</label>
                            <input 
                              type="text" value={data.teamB.name}
                              onChange={(e) => setData(prev => ({ ...prev, teamB: { ...prev.teamB, name: e.target.value } }))}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                              placeholder="Team B Name"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] uppercase text-white/30 ml-1">Score</label>
                            <input 
                              type="text" placeholder="e.g. 126"
                              value={data.teamB.score}
                              onChange={(e) => setData(prev => ({ ...prev, teamB: { ...prev.teamB, score: e.target.value } }))}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] uppercase text-white/30 ml-1">Overs</label>
                            <input 
                              type="text" placeholder="e.g. 18.5"
                              value={data.teamB.overs}
                              onChange={(e) => setData(prev => ({ ...prev, teamB: { ...prev.teamB, overs: e.target.value } }))}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] uppercase text-white/40 mb-1 block">Match Result</label>
                      <input 
                        type="text" 
                        value={data.matchResult}
                        onChange={(e) => setData(prev => ({ ...prev, matchResult: e.target.value }))}
                        className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 focus:outline-none focus:border-[#F27D26] transition-colors"
                        placeholder="e.g. INDIA WON BY 65 RUNS"
                      />
                    </div>
                  </div>
                </section>

                <div className="flex justify-between items-center">
                  <button 
                    onClick={() => setStep(2)}
                    className="flex items-center gap-2 text-white/40 hover:text-white transition-colors text-sm font-bold"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                  <div className="flex flex-col items-end gap-2">
                    {downloadError && (
                      <div className="text-xs max-w-xs text-right bg-black/40 text-red-400 p-2 rounded border border-red-500/20">
                        {downloadError}
                      </div>
                    )}
                    <button 
                      onClick={downloadCard}
                      disabled={loading || compressing || generatingAI}
                      className={cn(
                        "flex items-center gap-2 text-black px-8 py-3 rounded-full text-sm font-bold transition-all",
                        (loading || compressing || generatingAI) ? "bg-white/50 cursor-not-allowed" : "bg-[#F27D26] active:scale-95 hover:brightness-110"
                      )}
                    >
                      {loading ? (
                        <>Processing... <RefreshCw size={16} className="animate-spin" /></>
                      ) : (
                        <>Download Card <Download size={16} /></>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Preview */}
        <div className="lg:col-span-7 flex flex-col items-center overflow-hidden">
          <div className="sticky top-24 w-full flex flex-col items-center">
            <div className="text-[10px] uppercase font-bold tracking-[0.2em] text-white/30 mb-4">Live Preview</div>
            
            <div className="w-full overflow-x-auto pb-8 -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex justify-center min-w-max mx-auto">
                <div 
                  ref={cardRef}
              className={cn(
                "relative overflow-hidden bg-white shadow-2xl transition-all duration-500",
                data.aspectRatio === '1:1' && "aspect-square w-full max-w-[500px]",
                data.aspectRatio === '4:5' && "aspect-[4/5] w-full max-w-[450px]",
                data.aspectRatio === '9:16' && "aspect-[9/16] w-full max-w-[400px]"
              )}
              style={{ backgroundColor: '#F8F9FA' }}
            >
              {/* Player Image Overlay - Moved to very bottom of DOM stack */}
              <div className={cn(
                "absolute inset-0 z-1 transition-all duration-700",
                data.layout === 'modern' ? "scale-105 translate-x-[10%]" : "",
                data.layout === 'bold' ? "scale-110" : ""
              )}>
                {data.playerImage ? (
                  <div className="relative w-full h-full">
                    <img 
                      src={data.playerImage} 
                      alt="Player" 
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      className="w-full h-full object-cover transition-all duration-700 cursor-move touch-none relative z-50 pointer-events-auto"
                      style={{ 
                        objectPosition: `${imageObjectPos.x}% ${imageObjectPos.y}%`,
                        filter: data.isAIEnabled 
                          ? AI_STYLES.find(s => s.id === data.aiStyle)?.filter 
                          : 'none' 
                      }}
                    />
                    {/* Gradient Overlays for better text readability */}
                    <div className={cn(
                      "absolute inset-0 transition-all duration-700 pointer-events-none",
                      data.layout === 'classic' ? "bg-gradient-to-t from-[#001F3F] via-transparent to-white/20" : 
                      data.layout === 'modern' ? "bg-gradient-to-r from-[#001F3F]/80 via-transparent to-transparent" :
                      data.layout === 'bold' ? "bg-black/30" :
                      "bg-gradient-to-t from-black/80 via-black/20 to-transparent"
                    )} />
                    {data.layout === 'classic' && <div className="absolute inset-0 bg-gradient-to-r from-white/10 via-transparent to-transparent pointer-events-none" />}
                  </div>
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                    <User size={120} className="text-gray-300" />
                  </div>
                )}
              </div>

              {/* Background Texture/Gradient */}
              <div className="absolute inset-0 opacity-10 pointer-events-none z-2">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-black/20 via-transparent to-transparent" />
              </div>

              {/* Main Content Layout */}
              <div className="relative h-full flex flex-col z-10 pointer-events-none">
                
                {data.layout === 'classic' && (
                  <>
                    {/* Top Bar: Logo & Title */}
                    <div className="flex justify-between items-start p-6 pb-0">
                      <div className="bg-white p-3 rounded-br-2xl shadow-sm border-b border-r border-black/5 -ml-6 -mt-6">
                        <h3 className="text-2xl font-black text-[#001F3F] leading-none tracking-tighter italic">
                          {data.cardType === 'potm' ? (
                            <>PLAYER <span className="text-[8px] block font-bold not-italic tracking-widest opacity-60 mt-1">OF THE</span> MATCH</>
                          ) : data.cardType === 'best_batsman' ? (
                            <>BEST <span className="text-[8px] block font-bold not-italic tracking-widest opacity-60 mt-1">BATSMAN</span></>
                          ) : (
                            <>BEST <span className="text-[8px] block font-bold not-italic tracking-widest opacity-60 mt-1">BOWLER</span></>
                          )}
                        </h3>
                        <div 
                          className="h-1 w-12 mt-1.5" 
                          style={{ backgroundColor: data.themeColor }} 
                        />
                      </div>
                      <div className="bg-white p-2 rounded-bl-2xl shadow-sm border-b border-l border-black/5 -mr-6 -mt-6">
                        <KAvachLogo logoImage={data.logoImage} sizeClass="w-14 h-14" className="text-[#001F3F]" />
                      </div>
                    </div>

                    <div className="px-6 flex-1 flex flex-col">
                      {/* Spacer for Reel/Portrait Mode to push content down */}
                      {(data.aspectRatio === '9:16' || data.aspectRatio === '4:5') && <div className="flex-1" />}

                      {/* Player Name Overlay */}
                      <div className={cn("relative z-30", (data.aspectRatio === '9:16' || data.aspectRatio === '4:5') ? "mt-0 mb-4" : "mt-8")}>
                        <h4 
                          className="relative text-xl font-black uppercase tracking-tight inline-block px-4 py-1 text-white shadow-xl transform -skew-x-12"
                          style={{ backgroundColor: data.themeColor }}
                        >
                          {data.playerName}
                        </h4>
                      </div>

                      {/* Stats Section - Compact & Semi-transparent for background visibility */}
                      <div className={cn("flex flex-col justify-center relative z-30", (data.aspectRatio === '9:16' || data.aspectRatio === '4:5') ? "mb-8" : "flex-1")}>
                        <div className="bg-white/95 p-4 rounded-xl border border-white/50 shadow-2xl max-w-[60%] text-[#001F3F]">
                            {renderStats()}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {data.layout === 'modern' && (
                  <div className="flex-1 flex flex-col p-6 relative">
                    {/* Header with Logo and Title */}
                    <div className="flex justify-between items-start relative z-30 mb-4">
                      <KAvachLogo logoImage={data.logoImage} sizeClass="w-14 h-14" />
                      <div className="text-right">
                        <h3 className="text-xs font-black tracking-[0.3em] uppercase opacity-60 text-white mb-1">
                          {data.cardType === 'potm' ? 'Player of the Match' : data.cardType === 'best_batsman' ? 'Best Batsman' : 'Best Bowler'}
                        </h3>
                        <div className="h-1 w-12 bg-white ml-auto" style={{ backgroundColor: data.themeColor }} />
                      </div>
                    </div>

                    {/* Side Title */}
                    <div className="absolute left-6 top-1/3 flex flex-col gap-0 select-none pointer-events-none z-20">
                      <h3 className="text-5xl font-black italic leading-[0.8] tracking-tighter text-white drop-shadow-2xl opacity-20">
                        {data.cardType === 'potm' ? 'PLAYER' : 'BEST'}
                      </h3>
                      <h3 className="text-6xl font-black italic leading-[0.8] tracking-tighter drop-shadow-2xl opacity-20" style={{ color: data.themeColor }}>
                        {data.cardType === 'potm' ? 'MATCH' : data.cardType === 'best_batsman' ? 'BATSMAN' : 'BOWLER'}
                      </h3>
                    </div>

                    <div className="mt-auto mb-2 relative z-30 max-w-[80%]">
                      <div className="mb-4">
                        <h4 className="text-4xl font-black uppercase tracking-tighter leading-none text-white drop-shadow-2xl mb-2">
                          {data.playerName}
                        </h4>
                        <div className="h-1 w-16" style={{ backgroundColor: data.themeColor }} />
                      </div>

                      <div className="bg-black/40 backdrop-blur-xl p-4 rounded-xl border border-white/10 inline-block min-w-[200px] shadow-2xl">
                        {renderStats()}
                      </div>
                    </div>
                  </div>
                )}

                {data.layout === 'bold' && (
                  <div className="flex-1 flex flex-col p-6 relative overflow-hidden">
                    {/* Standardized Logo Position */}
                    <div className="flex justify-between items-start relative z-30 mb-4">
                      <KAvachLogo logoImage={data.logoImage} sizeClass="w-14 h-14" />
                    </div>

                    {/* Background POTM - More subtle and moved to avoid face */}
                    <div 
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[15rem] font-black opacity-5 italic pointer-events-none select-none leading-none tracking-tighter whitespace-nowrap z-0"
                      style={{ color: data.themeColor }}
                    >
                      {data.cardType === 'potm' ? 'POTM' : data.cardType === 'best_batsman' ? 'BATSMAN' : 'BOWLER'}
                    </div>
                    
                    <div className="mt-auto text-center mb-2 relative z-30">
                      <h3 className="text-4xl font-black italic leading-none tracking-tighter text-white mb-2 drop-shadow-2xl">
                        {data.cardType === 'potm' ? (
                          <>PLAYER OF THE <span style={{ color: data.themeColor }}>MATCH</span></>
                        ) : data.cardType === 'best_batsman' ? (
                          <>BEST <span style={{ color: data.themeColor }}>BATSMAN</span></>
                        ) : (
                          <>BEST <span style={{ color: data.themeColor }}>BOWLER</span></>
                        )}
                      </h3>
                      
                      <h4 className="text-5xl font-black uppercase tracking-tighter leading-none mb-6 drop-shadow-2xl text-white">
                        {data.playerName}
                      </h4>
                      
                      <div className="flex justify-center">
                        <div className="bg-white p-4 rounded-xl shadow-2xl text-[#001F3F] min-w-[240px]">
                          {renderStats()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {data.layout === 'minimal' && (
                  <div className="flex-1 flex flex-col p-8 relative">
                    {/* Standardized Logo Position */}
                    <div className="flex justify-between items-start relative z-30 mb-8">
                      <KAvachLogo logoImage={data.logoImage} sizeClass="w-14 h-14" />
                      <div className="text-right">
                        <div className="text-[8px] font-black tracking-[0.5em] uppercase opacity-40 text-white">MVP EDITION</div>
                      </div>
                    </div>

                    <div className="text-center mb-auto relative z-30">
                      <h4 className="text-6xl font-black uppercase tracking-tighter leading-none mb-4 italic drop-shadow-xl text-white">
                        {data.playerName}
                      </h4>
                      <div className="inline-block px-6 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] bg-white text-black shadow-xl">
                        {data.cardType === 'potm' ? 'PLAYER OF THE MATCH' : data.cardType === 'best_batsman' ? 'BEST BATSMAN' : 'BEST BOWLER'}
                      </div>
                    </div>

                    <div className="flex justify-center mb-8 relative z-30">
                      <div className="bg-black/20 backdrop-blur-md p-6 rounded-3xl border border-white/5 w-full max-w-[280px] shadow-2xl">
                        {renderStats()}
                      </div>
                    </div>
                  </div>
                )}

                {/* Team Scores - Bottom Section (Common for all layouts) */}
                <div className={cn(
                  "mt-auto bg-[#001F3F] text-white p-4 shadow-2xl relative z-30 transition-all duration-500",
                  data.layout === 'minimal' ? "rounded-none bg-transparent pt-0" : "rounded-t-2xl"
                )}>
                  {data.layout === 'minimal' && <div className="h-px w-full bg-white/10 mb-6" />}
                  
                  <div className="flex justify-between items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <div className="w-5 h-5 bg-white rounded-full flex-shrink-0 flex items-center justify-center text-[7px] font-bold text-[#001F3F]">
                          {data.teamA.name.charAt(0)}
                        </div>
                        <span className="text-[9px] font-bold tracking-widest opacity-70 uppercase truncate">{data.teamA.name}</span>
                      </div>
                      <div className="text-lg font-black leading-none tracking-tighter truncate">{data.teamA.score}</div>
                      <div className="text-[7px] uppercase font-bold opacity-40 mt-0.5 truncate">{data.teamA.overs} OVERS</div>
                    </div>
                    
                    <div className="w-px h-8 bg-white/20" />

                    <div className="flex-1 min-w-0 text-right">
                      <div className="flex items-center gap-1.5 mb-0.5 justify-end">
                        <span className="text-[9px] font-bold tracking-widest opacity-70 uppercase truncate">{data.teamB.name}</span>
                        <div className="w-5 h-5 bg-white rounded-full flex-shrink-0 flex items-center justify-center text-[7px] font-bold text-[#001F3F]">
                          {data.teamB.name.charAt(0)}
                        </div>
                      </div>
                      <div className="text-lg font-black leading-none tracking-tighter truncate">{data.teamB.score}</div>
                      <div className="text-[7px] uppercase font-bold opacity-40 mt-0.5 truncate">{data.teamB.overs} OVERS</div>
                    </div>
                  </div>

                  {/* Result Banner */}
                  <div 
                    className="mt-2.5 py-1.5 px-3 text-center text-[9px] font-black uppercase tracking-[0.2em] text-white rounded-lg shadow-inner"
                    style={{ backgroundColor: data.themeColor }}
                  >
                    {data.matchResult}
                  </div>

                  {/* Footer */}
                  <div className="mt-2.5 flex justify-between items-center text-[7px] font-bold opacity-40 uppercase tracking-widest">
                    <span>kavachcricket.com</span>
                    <span>Go Get Them !</span>
                  </div>
                </div>
              </div>
              </div>
              </div>
            </div>

            <p className="mt-6 text-xs text-white/30 text-center max-w-[250px] mx-auto md:max-w-sm">
              Tip: Use AI enhancement to create a professional studio look for your player photo.
            </p>
          </div>
        </div>
      </main>

      {/* Mobile Footer */}
      <footer className="md:hidden py-6 text-center text-[#F27D26] text-[10px] font-bold uppercase tracking-[0.2em] bg-[#0A0A0A] border-t border-white/5 pb-10">
        Go Get Them !
      </footer>
    </div>
  );
}
