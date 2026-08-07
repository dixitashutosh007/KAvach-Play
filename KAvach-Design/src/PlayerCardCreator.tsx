import React, { useState, useRef } from 'react';
import { Download, ChevronLeft, Image as ImageIcon, User, Settings, Star, UserSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Header, AppMode } from './Header';
import { compressImage } from './imageUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AspectRatio = '4:5' | '9:16';

interface Stat {
  label: string;
  value: string;
}

interface PlayerCardData {
  playerName: string;
  playerRole: string; // 'Batsman', 'Bowler', 'Wicket Keeper Batsman', 'All Rounder'
  description: string;
  stats: Stat[];
  themeColor: string;
  aspectRatio: AspectRatio;
  playerImage: string | null;
  backgroundImage: string | null;
  logoImage: string | null;
  layout: 'trading-card' | 'modern-hero';
}

const THEMES = [
  { name: 'KAvach Crimson', color: '#DC143C' },
  { name: 'KAvach Gold', color: '#F27D26' },
  { name: 'Royal Blue', color: '#1E40AF' },
  { name: 'Cricket Green', color: '#15803D' },
  { name: 'Elite Red', color: '#B91C1C' },
  { name: 'Deep Purple', color: '#6D28D9' },
  { name: 'Golden Glow', color: '#EAB308' },
];

const ROLES = [
  'Batsman', 'Bowler', 'All Rounder', 'Wicket Keeper Batsman'
];

const DEFAULT_STATS: Record<string, Stat[]> = {
  'Batsman': [
    { label: 'Matches', value: '45' },
    { label: 'Runs', value: '1432' },
    { label: 'Avg', value: '42.5' },
    { label: 'SR', value: '145.2' },
  ],
  'Bowler': [
    { label: 'Matches', value: '28' },
    { label: 'Wickets', value: '45' },
    { label: 'Eco', value: '7.4' },
    { label: 'Best', value: '4/15' },
  ],
  'All Rounder': [
    { label: 'Runs', value: '850' },
    { label: 'SR', value: '135.0' },
    { label: 'Wickets', value: '32' },
    { label: 'Eco', value: '7.8' },
  ],
  'Wicket Keeper Batsman': [
    { label: 'Runs', value: '1120' },
    { label: 'SR', value: '142.5' },
    { label: 'Catches', value: '28' },
    { label: 'Stumpings', value: '12' },
  ]
};

const ASPECT_RATIOS: { id: AspectRatio; label: string; desc: string }[] = [
  { id: '4:5', label: '4:5', desc: 'Portrait' },
  { id: '9:16', label: '9:16', desc: 'Story' },
];

export default function PlayerCardCreator({ setAppMode }: { setAppMode: (mode: AppMode) => void }) {
  const [loading, setLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);

  const [imageObjectPos, setImageObjectPos] = useState({ x: 50, y: 30 }); // Default face somewhat top
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

  const [data, setData] = useState<PlayerCardData>({
    playerName: 'Suryakumar Yadav',
    playerRole: 'Batsman',
    description: 'Mr. 360 - Innovative stroke maker',
    stats: DEFAULT_STATS['Batsman'],
    themeColor: '#DC143C',
    aspectRatio: '4:5',
    playerImage: null,
    backgroundImage: null,
    logoImage: null,
    layout: 'trading-card',
  });

  const handleRoleChange = (role: string) => {
    setData(prev => ({
      ...prev,
      playerRole: role,
      stats: DEFAULT_STATS[role] || DEFAULT_STATS['Batsman']
    }));
  };

  const handleStatChange = (index: number, field: 'label' | 'value', value: string) => {
    setData(prev => {
      const newStats = [...prev.stats];
      newStats[index] = { ...newStats[index], [field]: value };
      return { ...prev, stats: newStats };
    });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'playerImage' | 'backgroundImage' | 'logoImage') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const maxSize = field === 'logoImage' ? 300 : 1000;
          const compressedUrl = await compressImage(reader.result as string, maxSize, maxSize);
          setData(prev => ({ ...prev, [field]: compressedUrl }));
        } catch (err) {
          console.error("Image compression failed", err);
          setData(prev => ({ ...prev, [field]: reader.result as string })); // fallback
        } finally {
          e.target.value = '';
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const downloadPoster = async () => {
    if (!posterRef.current) return;
    
    setLoading(true);
    setDownloadError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const fileName = `KAvach_Card_${data.playerName.replace(/\s+/g, '_')}.png`;
      
      // Fix for iOS Safari black image bug: warm up the renderer
      for(let i=0; i<3; i++) {
        try {
          await toPng(posterRef.current, { cacheBust: true, skipFonts: true });
        } catch(e) {}
      }
      
      const dataUrl = await toPng(posterRef.current, { 
        quality: 1.0,
        pixelRatio: 2,
        cacheBust: true,
      });
      
      setGeneratedImage(dataUrl);

      try {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) { }
    } catch (err: any) {
      console.error('Download failed', err);
      setDownloadError('Download failed! ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white font-sans selection:bg-[#F27D26]/30">
      <AnimatePresence>
        {generatedImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-md z-[110] flex flex-col items-center justify-center p-6 text-center overflow-y-auto"
          >
            <div className="bg-white/10 p-4 rounded-3xl w-full max-w-lg overflow-hidden flex flex-col items-center border border-white/20 shadow-2xl space-y-6">
              <h3 className="text-xl font-bold mt-2">Player Card Generated!</h3>
              <div className="w-full bg-black rounded-xl overflow-hidden shadow-2xl pointer-events-auto max-h-[60vh] overflow-y-auto">
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

        {loading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-6 text-center"
          >
            <div className="relative">
              <div className="w-20 h-20 border-4 border-[#F27D26]/20 border-t-[#F27D26] rounded-full animate-spin" />
              <UserSquare className="absolute inset-0 m-auto text-[#F27D26] w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-bold mt-6 mb-2">Generating Card...</h3>
          </motion.div>
        )}
      </AnimatePresence>

      <Header 
        appMode="player_card"
        setAppMode={setAppMode}
        title="KAvach Design Studio"
        subtitle="Go Get Them !"
        onDownload={downloadPoster}
        downloadDisabled={loading || !data.playerImage}
        downloadLabel="Export Card"
      />

      <main className="max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
        {downloadError && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
            {downloadError}
          </div>
        )}

        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-8">
            <section className="bg-white/5 rounded-3xl p-6 border border-white/10">
              <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                <User className="text-[#F27D26]" size={16} />
                Player Information
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Player Image</label>
                  <div className="relative h-32 bg-black/50 border border-white/10 rounded-xl overflow-hidden flex items-center justify-center group cursor-pointer hover:border-[#F27D26]/50">
                    {data.playerImage ? (
                      <img src={data.playerImage} alt="Player" className="w-full h-full object-cover object-top" />
                    ) : (
                      <div className="flex flex-col items-center">
                        <ImageIcon className="text-white/20 mb-1" size={24} />
                        <span className="text-xs text-white/40">Upload Player Photo</span>
                      </div>
                    )}
                    <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={e => handleImageUpload(e, 'playerImage')} />
                  </div>
                  <p className="text-[8px] text-white/40 mt-1 uppercase tracking-wider text-center">Drag image in preview to adjust face position</p>
                </div>

                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Player Name</label>
                  <input 
                    type="text" 
                    value={data.playerName}
                    onChange={e => setData(prev => ({ ...prev, playerName: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26]"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-2 block">Player Profile</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ROLES.map(role => (
                      <button
                        key={role}
                        onClick={() => handleRoleChange(role)}
                        className={cn(
                          "py-2 px-2 rounded-lg text-[10px] font-bold uppercase transition-all flex items-center justify-center text-center",
                          data.playerRole === role ? "bg-white/10 text-white border border-white/20" : "bg-black/30 border border-transparent text-white/40 hover:text-white/60"
                        )}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Short Description</label>
                  <input 
                    type="text" 
                    value={data.description}
                    onChange={e => setData(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26]"
                    placeholder="e.g. Elegant Stroke Maker..."
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-2 block mt-4">Key Stats</label>
                  <div className="space-y-2">
                    {data.stats.map((stat, i) => (
                      <div key={i} className="flex gap-2">
                        <input 
                          type="text"
                          value={stat.label}
                          onChange={e => handleStatChange(i, 'label', e.target.value)}
                          className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#F27D26]"
                          placeholder="Stat Label"
                        />
                        <input 
                          type="text"
                          value={stat.value}
                          onChange={e => handleStatChange(i, 'value', e.target.value)}
                          className="w-24 font-bold bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[#F27D26]"
                          placeholder="Value"
                        />
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </section>

            <section className="bg-white/5 rounded-3xl p-6 border border-white/10">
              <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                <Settings className="text-[#F27D26]" size={16} />
                Card Style
              </h2>
              
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-2 block">Card Layout</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setData(prev => ({ ...prev, layout: 'trading-card' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl border text-[10px] font-bold uppercase transition-all",
                        data.layout === 'trading-card' ? "border-[#F27D26] bg-[#F27D26]/10 text-[#F27D26]" : "border-white/10 text-white/40 hover:bg-white/5"
                      )}
                    >
                      Classic Trading Card
                    </button>
                    <button
                      onClick={() => setData(prev => ({ ...prev, layout: 'modern-hero' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl border text-[10px] font-bold uppercase transition-all",
                        data.layout === 'modern-hero' ? "border-[#F27D26] bg-[#F27D26]/10 text-[#F27D26]" : "border-white/10 text-white/40 hover:bg-white/5"
                      )}
                    >
                      Modern Hero
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-[10px] uppercase text-white/40 mb-3 block">Orientation</span>
                  <div className="grid grid-cols-2 gap-2">
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
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Theme Color</label>
                  <div className="flex flex-wrap gap-2">
                    {THEMES.map((theme) => (
                      <button
                        key={theme.name}
                        onClick={() => setData(prev => ({ ...prev, themeColor: theme.color }))}
                        className={cn(
                          "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110",
                          data.themeColor === theme.color ? "border-white scale-110" : "border-transparent"
                        )}
                        style={{ backgroundColor: theme.color }}
                        title={theme.name}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
                  <div>
                    <label className="text-[10px] uppercase text-white/40 mb-1 block">Team Logo</label>
                    <div className="relative h-20 bg-black/50 border border-white/10 rounded-xl overflow-hidden flex items-center justify-center group cursor-pointer hover:border-[#F27D26]/50">
                      {data.logoImage ? (
                        <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain p-2" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <ImageIcon className="text-white/20 mb-1" size={16} />
                          <span className="text-[10px] text-white/40">Upload</span>
                        </div>
                      )}
                      <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={e => handleImageUpload(e, 'logoImage')} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-white/40 mb-1 block">Background</label>
                    <div className="relative h-20 bg-black/50 border border-white/10 rounded-xl overflow-hidden flex items-center justify-center group cursor-pointer hover:border-[#F27D26]/50">
                      {data.backgroundImage ? (
                        <img src={data.backgroundImage} alt="BG" className="w-full h-full object-cover opacity-50" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <ImageIcon className="text-white/20 mb-1" size={16} />
                          <span className="text-[10px] text-white/40">Upload bg</span>
                        </div>
                      )}
                      <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={e => handleImageUpload(e, 'backgroundImage')} />
                    </div>
                  </div>
                </div>

              </div>
            </section>
          </div>

          {/* Preview Canvas */}
          <div className="lg:col-span-7 flex justify-center sticky top-24 h-max overflow-hidden">
            <div className="w-full overflow-x-auto pb-8 -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex justify-center min-w-max mx-auto">
                <div 
                  ref={posterRef}
                  className={cn(
                    "bg-[#0a0a0a] relative overflow-hidden flex flex-col items-center",
                    data.aspectRatio === '4:5' && "aspect-[4/5] w-[500px]",
                    data.aspectRatio === '9:16' && "aspect-[9/16] w-[400px]",
                  )}
                  style={{ fontFamily: 'Inter, sans-serif' }}
                >
                  {/* Background Layer */}
                  {data.backgroundImage ? (
                    <img src={data.backgroundImage} alt="BG" className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity grayscale" />
                  ) : (
                    <div className="absolute inset-x-0 top-0 h-1/2 opacity-30" style={{ background: `linear-gradient(to bottom, ${data.themeColor}, transparent)` }} />
                  )}
                  
                  {/* Background Texture/Accents */}
                  <div className="absolute inset-0 outline-none pointer-events-none z-[1]" style={{ 
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\\"20\\" height=\\"20\\" viewBox=\\"0 0 20 20\\" xmlns=\\"http://www.w3.org/2000/svg\\"%3E%3Cg fill=\\"%23ffffff\\" fill-opacity=\\"0.05\\" fill-rule=\\"evenodd\\"%3E%3Ccircle cx=\\"3\\" cy=\\"3\\" r=\\"3\\"/>%3Ccircle cx=\\"13\\" cy=\\"13\\" r=\\"3\\"/>%3C/g%3E%3C/svg%3E")',
                  }} />

                  {/* Player Image */}
                  {data.playerImage && (
                    <img 
                      src={data.playerImage} 
                      alt="Player" 
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerUp}
                      className="absolute inset-0 w-full h-full object-cover z-[5] cursor-move touch-none pointer-events-auto"
                      style={{ objectPosition: `${imageObjectPos.x}% ${imageObjectPos.y}%` }}
                    />
                  )}

                  {/* Safegaurd Gradient for Text visibility - ALWAYS AT BOTTOM */}
                  <div className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-[10]" />
                  <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black via-black/90 to-transparent pointer-events-none z-[11]" />

                  {/* Layout Specific Rendering */}
                  {data.layout === 'trading-card' && (
                    <div className="absolute inset-0 z-20 pointer-events-none p-6 flex flex-col">
                      {/* Top Header */}
                      <div className="flex justify-between items-start w-full">
                         {data.logoImage && (
                          <div className="w-16 h-16 bg-[#111111]/80 backdrop-blur-md p-1.5 rounded-full border border-white/20 shadow-lg">
                            <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain" />
                          </div>
                        )}
                        <div className="bg-black/50 backdrop-blur-md border border-white/20 px-4 py-1.5 rounded-full shadow-lg ml-auto">
                           <span className="text-white/80 text-[10px] font-bold uppercase tracking-widest">{data.playerRole}</span>
                        </div>
                      </div>

                      {/* Bottom Content Area */}
                      <div className="mt-auto w-full">
                        <div className="flex bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-5 w-full flex-col shadow-2xl relative overflow-hidden">
                           <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: data.themeColor }} />
                           
                           <h1 className="text-3xl font-black text-white uppercase tracking-tighter leading-none mb-1">
                             {data.playerName}
                           </h1>
                           {data.description && (
                             <p className="text-[10px] text-white/60 font-medium tracking-wide mb-5 uppercase">
                               {data.description}
                             </p>
                           )}

                           {/* Stats Grid */}
                           <div className="grid grid-cols-4 gap-2 pt-4 border-t border-white/10">
                             {data.stats.map((stat, i) => (
                               <div key={i} className="flex flex-col items-center justify-center p-2 rounded-xl bg-white/5 border border-white/5">
                                 <span className="text-xl font-bold text-white leading-none mb-1" style={{ color: data.themeColor }}>{stat.value}</span>
                                 <span className="text-[7px] text-white/50 uppercase tracking-widest font-bold text-center">{stat.label}</span>
                               </div>
                             ))}
                           </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {data.layout === 'modern-hero' && (
                    <div className="absolute inset-0 z-20 pointer-events-none p-8 flex flex-col justify-end text-center">
                      {/* Top Header */}
                      <div className="absolute top-6 inset-x-0 flex justify-center w-full">
                         {data.logoImage && (
                          <div className="w-14 h-14 bg-white/10 backdrop-blur p-1 rounded-xl shadow-lg border border-white/10">
                            <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain" />
                          </div>
                        )}
                      </div>

                      <div className="relative pb-6">
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] mb-3" style={{ color: data.themeColor }}>{data.playerRole}</p>
                        <h1 className="text-4xl sm:text-5xl font-black text-white uppercase tracking-tighter leading-[0.9] mb-4 drop-shadow-[0_4px_20px_rgba(0,0,0,0.8)]">
                          {data.playerName}
                        </h1>

                        <div className="inline-flex backdrop-blur-lg bg-white/10 border border-white/20 rounded-full px-5 py-3 shadow-2xl mb-6">
                          <div className="flex items-center gap-6 divide-x divide-white/20">
                            {data.stats.slice(0, 3).map((stat, i) => (
                               <div key={i} className={cn("flex flex-col items-center px-2", i === 0 && "pl-0", i === 2 && "pr-0")}>
                                 <span className="text-[8px] text-white/60 uppercase tracking-widest font-bold mb-1">{stat.label}</span>
                                 <span className="text-lg font-bold text-white leading-none">{stat.value}</span>
                               </div>
                             ))}
                          </div>
                        </div>
                        
                        {data.description && (
                          <p className="text-xs text-white/50 max-w-sm mx-auto font-medium">
                            {data.description}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Global Footer */}
                  <div className="absolute bottom-3 z-30 w-full text-center">
                    <p className="text-[7px] font-bold tracking-[0.3em] uppercase opacity-40 text-white">Powered by KAvach Design Studio</p>
                  </div>

                </div>
              </div>
            </div>
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
