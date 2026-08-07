import React, { useState, useRef } from 'react';
import { Download, ChevronLeft, Image as ImageIcon, Trophy, Settings, Star, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Header, AppMode } from './Header';
import { compressImage } from './imageUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type AspectRatio = '1:1' | '4:5' | '9:16';

interface AchievementData {
  type: 'achievement' | 'milestone';
  category: string;
  playerName: string;
  highlightText: string;
  description: string;
  themeColor: string;
  aspectRatio: AspectRatio;
  playerImage: string | null;
  backgroundImage: string | null;
  logoImage: string | null;
  layout: 'impact' | 'elegant';
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

const ACHIEVEMENTS = [
  'Hat Trick', 'Century', 'Tough Fifty', 'Special Bowling Spell', 'Spectacular Catch', 'Match Winning Knock', 'Other'
];

const MILESTONES = [
  '5000 Runs', '100 Wickets', '100 Catches', '200 Sixes', 'Debut Match', '100 Matches', 'Other'
];

const ASPECT_RATIOS: { id: AspectRatio; label: string; desc: string }[] = [
  { id: '1:1', label: '1:1', desc: 'Insta Post' },
  { id: '4:5', label: '4:5', desc: 'FB/Insta Portrait' },
  { id: '9:16', label: '9:16', desc: 'Reel/Story/Status' },
];

export default function SpecialAchievementCreator({ setAppMode }: { setAppMode: (mode: AppMode) => void }) {
  const [loading, setLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);

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

  const [data, setData] = useState<AchievementData>({
    type: 'achievement',
    category: 'Hat Trick',
    playerName: 'Suryakumar Yadav',
    highlightText: 'MAGICAL SPELL',
    description: '3 Wickets in 3 Balls to turn the match around!',
    themeColor: '#DC143C',
    aspectRatio: '4:5',
    playerImage: null,
    backgroundImage: null,
    logoImage: null,
    layout: 'impact',
  });

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
      await new Promise(resolve => setTimeout(resolve, 500)); // small delay for re-rendering

      const fileName = `KAvach_${data.playerName.replace(/\s+/g, '_')}_${data.category.replace(/\s+/g, '_')}.png`;

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

      // Trigger actual download window
      try {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        // Fallback or ignore
      }
    } catch (err: any) {
      console.error('Download failed', err);
      setDownloadError('Download failed! ' + (err?.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

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
            <div className="bg-white/10 p-4 rounded-3xl w-full max-w-lg overflow-hidden flex flex-col items-center border border-white/20 shadow-2xl space-y-6">
              <h3 className="text-xl font-bold mt-2">Poster Generated!</h3>
              <div className="w-full bg-black rounded-xl overflow-hidden shadow-2xl pointer-events-auto max-h-[60vh] overflow-y-auto">
                <img src={generatedImage} alt="Generated Poster" className="w-full h-auto object-contain" />
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
              <Star className="absolute inset-0 m-auto text-[#F27D26] w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-bold mt-6 mb-2">Generating Poster...</h3>
          </motion.div>
        )}
      </AnimatePresence>

      <Header 
        appMode="achievement"
        setAppMode={setAppMode}
        title="KAvach Design Studio"
        subtitle="Go Get Them !"
        onDownload={downloadPoster}
        downloadDisabled={loading}
        downloadLabel="Export Poster"
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
                <Settings className="text-[#F27D26]" size={16} />
                Global Settings
              </h2>
              
              <div className="space-y-6">
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
                  <label className="text-[10px] uppercase text-white/40 mb-2 block">Poster Type</label>
                  <div className="flex bg-black/50 p-1 rounded-xl">
                    {(['achievement', 'milestone'] as const).map(type => (
                      <button
                        key={type}
                        onClick={() => {
                          setData(prev => ({ 
                            ...prev, 
                            type, 
                            category: type === 'achievement' ? ACHIEVEMENTS[0] : MILESTONES[0],
                          }));
                        }}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all flex items-center justify-center gap-2",
                          data.type === type ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"
                        )}
                      >
                        {type === 'achievement' ? <Star size={14} /> : <Zap size={14} />}
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-2 block">Category</label>
                  <input 
                    type="text"
                    list="category-suggestions"
                    value={data.category}
                    onChange={e => setData(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26] text-white"
                    placeholder="Enter or select category"
                  />
                  <datalist id="category-suggestions">
                    {(data.type === 'achievement' ? ACHIEVEMENTS : MILESTONES).map(cat => (
                      <option key={cat} value={cat} />
                    ))}
                  </datalist>
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
                    <div className="relative w-8 h-8 rounded-full border-2 border-white/20 overflow-hidden flex items-center justify-center bg-gradient-to-tr from-purple-500 via-red-500 to-yellow-500">
                      <input 
                        type="color" 
                        value={data.themeColor}
                        onChange={(e) => setData(prev => ({ ...prev, themeColor: e.target.value }))}
                        className="absolute inset-0 w-[200%] h-[200%] -top-1/2 -left-1/2 cursor-pointer opacity-0"
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-2 block">Layout Style</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setData(prev => ({ ...prev, layout: 'impact' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl border text-xs font-bold uppercase transition-all",
                        data.layout === 'impact' ? "border-[#F27D26] bg-[#F27D26]/10 text-[#F27D26]" : "border-white/10 text-white/40 hover:bg-white/5"
                      )}
                    >
                      High Impact
                    </button>
                    <button
                      onClick={() => setData(prev => ({ ...prev, layout: 'elegant' }))}
                      className={cn(
                        "flex-1 py-3 rounded-xl border text-xs font-bold uppercase transition-all",
                        data.layout === 'elegant' ? "border-[#F27D26] bg-[#F27D26]/10 text-[#F27D26]" : "border-white/10 text-white/40 hover:bg-white/5"
                      )}
                    >
                      Elegant
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
                  <div>
                    <label className="text-[10px] uppercase text-white/40 mb-1 block">Background Image (Optional)</label>
                    <div className="relative h-24 bg-black/50 border border-white/10 rounded-xl overflow-hidden flex items-center justify-center group cursor-pointer hover:border-[#F27D26]/50">
                      {data.backgroundImage ? (
                        <img src={data.backgroundImage} alt="BG" className="w-full h-full object-cover opacity-50" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <ImageIcon className="text-white/20 mb-1" size={20} />
                          <span className="text-[10px] text-white/40">Upload BG</span>
                        </div>
                      )}
                      <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={e => handleImageUpload(e, 'backgroundImage')} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-white/40 mb-1 block">Logo Image (Optional)</label>
                    <div className="relative h-24 bg-black/50 border border-white/10 rounded-xl overflow-hidden flex items-center justify-center group cursor-pointer hover:border-[#F27D26]/50">
                      {data.logoImage ? (
                        <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain p-2" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <ImageIcon className="text-white/20 mb-1" size={20} />
                          <span className="text-[10px] text-white/40">Upload Logo</span>
                        </div>
                      )}
                      <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={e => handleImageUpload(e, 'logoImage')} />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-white/5 rounded-3xl p-6 border border-white/10">
              <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                <Trophy className="text-[#F27D26]" size={16} />
                Content Details
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
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Highlight Text (e.g. MAGICAL SPELL)</label>
                  <input 
                    type="text" 
                    value={data.highlightText}
                    onChange={e => setData(prev => ({ ...prev, highlightText: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26]"
                  />
                </div>

                <div>
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Description / Stats</label>
                  <textarea 
                    value={data.description}
                    onChange={e => setData(prev => ({ ...prev, description: e.target.value }))}
                    rows={3}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26] resize-none"
                    placeholder="e.g. 5 Wickets in 4 Overs..."
                  />
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
                  "bg-neutral-900 relative overflow-hidden flex flex-col items-center",
                  data.aspectRatio === '1:1' && "aspect-square w-[500px]",
                  data.aspectRatio === '4:5' && "aspect-[4/5] w-[500px]",
                  data.aspectRatio === '9:16' && "aspect-[9/16] w-[400px]",
                  data.layout === 'elegant' ? 'justify-end pb-12' : 'justify-between pt-12'
                )}
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {/* Backgrounds */}
                {data.backgroundImage ? (
                  <img src={data.backgroundImage} alt="BG" className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-luminosity" />
                ) : (
                  <div className="absolute inset-0 opacity-20" style={{ background: `radial-gradient(circle at center, ${data.themeColor} 0%, transparent 70%)` }} />
                )}
                
                {/* Layout specific gradients and textures */}
                {data.layout === 'impact' && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/40 to-transparent pointer-events-none z-10" />
                    <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/80 to-transparent pointer-events-none z-10" />
                  </>
                )}
                {data.layout === 'elegant' && (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/90 via-[#0A0A0A]/20 to-[#0A0A0A] pointer-events-none z-10" />
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black to-transparent pointer-events-none z-10" />
                  </>
                )}

                {/* Player Image */}
                {data.playerImage && (
                  <img 
                    src={data.playerImage} 
                    alt="Player" 
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className={cn(
                      "absolute inset-0 w-full h-full object-cover opacity-90 transition-all duration-700 cursor-move touch-none z-[5] pointer-events-auto",
                      data.layout === 'elegant' ? "scale-105" : "scale-100"
                    )}
                    style={{ objectPosition: `${imageObjectPos.x}% ${imageObjectPos.y}%` }}
                  />
                )}

                {/* Decorator graphic */}
                <div 
                  className={cn(
                    "absolute -left-20 top-1/3 w-64 h-64 rounded-full blur-3xl opacity-20 outline-none pointer-events-none",
                  )}
                  style={{ backgroundColor: data.themeColor }}
                />

                {/* Impact Layout Content */}
                {data.layout === 'impact' && (
                  <>
                    <div className="absolute top-4 right-4 z-20">
                      {data.logoImage && (
                        <div className="w-14 h-14 bg-white/10 backdrop-blur-md p-1.5 rounded-xl border border-white/20 shadow-2xl">
                          <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                      )}
                    </div>
                    
                    <div className="relative z-20 w-full px-8 pb-10 text-center flex flex-col items-center justify-end h-full pointer-events-none">
                      <div 
                        className="inline-block px-5 py-2 backdrop-blur-md rounded-full mb-6 border shadow-2xl"
                        style={{ backgroundColor: `${data.themeColor}30`, borderColor: `${data.themeColor}50` }}
                      >
                        <h2 className="text-[10px] font-black text-white uppercase tracking-[0.3em]">{data.category}</h2>
                      </div>
                      
                      <h1 className="text-5xl font-black uppercase tracking-tighter leading-none italic mb-4 drop-shadow-[0_5px_15px_rgba(0,0,0,0.8)] transform -skew-x-6" style={{ color: data.themeColor }}>
                        {data.highlightText}
                      </h1>
                      
                      <div className="w-full relative mt-2 mb-4">
                        <div className="absolute inset-0 flex items-center justify-center blur-md opacity-50" style={{ color: data.themeColor }}>
                          <h3 className="text-3xl font-black uppercase tracking-tight leading-none">{data.playerName}</h3>
                        </div>
                        <h3 className="text-3xl font-black text-white uppercase tracking-tight leading-none relative drop-shadow-md">
                          {data.playerName}
                        </h3>
                      </div>
                      
                      <div className="relative mt-2">
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                        <p className="text-sm font-medium text-white/90 pt-5 px-4 inline-block drop-shadow-xl max-w-sm">
                          {data.description}
                        </p>
                      </div>
                    </div>
                  </>
                )}

                {/* Elegant Layout Content */}
                {data.layout === 'elegant' && (
                  <>
                    <div className="absolute top-6 left-6 z-20">
                      {data.logoImage && (
                        <div className="w-14 h-14 bg-white p-1 rounded-xl shadow-xl">
                          <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain" />
                        </div>
                      )}
                    </div>
                    
                    <div className="absolute top-8 right-6 z-20 text-right">
                      <h2 className="text-xs font-bold text-white/60 uppercase tracking-[0.2em]">{data.type}</h2>
                      <div className="w-8 h-0.5 ml-auto mt-2" style={{ backgroundColor: data.themeColor }} />
                    </div>

                    <div className="relative z-20 w-full px-8 pt-32 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/90 to-transparent pointer-events-none">
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-white/10 border border-white/20 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]">
                          {data.type === 'achievement' ? <Star size={14} fill="currentColor" /> : <Zap size={14} fill="currentColor" />}
                        </div>
                        <h2 className="text-sm font-bold text-white tracking-widest uppercase" style={{ color: data.themeColor }}>
                          {data.category}
                        </h2>
                      </div>
                      
                      <h3 className="text-4xl font-black text-white uppercase tracking-tighter leading-[0.9] mb-4 drop-shadow-md">
                        {data.playerName}
                      </h3>
                      
                      <div className="bg-white/5 backdrop-blur-md border justify-center border-white/10 rounded-2xl p-4 shadow-xl">
                        <h1 className="text-2xl font-black uppercase tracking-tight italic mb-2 break-words" style={{ color: '#FFF' }}>
                          {data.highlightText}
                        </h1>
                        <p className="text-xs font-medium text-white/70">
                          {data.description}
                        </p>
                      </div>
                    </div>
                  </>
                )}
                
                {/* Global Footer */}
                <div className="absolute bottom-4 z-20 w-full text-center">
                  <p className="text-[8px] font-bold tracking-[0.3em] uppercase opacity-40 text-white">Powered by KAvach Design Studio</p>
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
