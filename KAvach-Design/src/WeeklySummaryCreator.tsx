import React, { useState, useRef } from 'react';
import { Download, Upload, Trophy, Image as ImageIcon, ChevronLeft, Plus, Trash2, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toPng } from 'html-to-image';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Header, AppMode } from './Header';
import { compressImage } from './imageUtils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TeamInfo {
  name: string;
  score: string;
  overs: string;
}

interface WeeklyMatch {
  id: string;
  groundName: string;
  teamA: TeamInfo;
  teamB: TeamInfo;
  potm: string;
  result: string;
}

type AspectRatio = '1:1' | '4:5' | '9:16';

interface WeeklySummaryData {
  weekLabel: string;
  matches: WeeklyMatch[];
  themeColor: string;
  aspectRatio: AspectRatio;
  logoImage: string | null;
  backgroundImage: string | null;
}

export default function WeeklySummaryCreator({ setAppMode }: { setAppMode: (mode: AppMode) => void }) {
  const [loading, setLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const posterRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<WeeklySummaryData>({
    weekLabel: 'WEEK 4 SUMMARY',
    matches: [
      {
        id: '1',
        groundName: 'Lord\'s Cricket Ground',
        teamA: { name: 'KAvach', score: '191/6', overs: '20' },
        teamB: { name: 'Strikers', score: '175/8', overs: '20' },
        potm: 'Suryakumar Yadav',
        result: 'KAvach WON BY 16 RUNS'
      }
    ],
    themeColor: '#DC143C',
    aspectRatio: '4:5',
    logoImage: null,
    backgroundImage: null,
  });

  const THEMES = [
    { name: 'KAvach Crimson', color: '#DC143C' },
    { name: 'KAvach Gold', color: '#F27D26' },
    { name: 'Royal Blue', color: '#1E40AF' },
    { name: 'Cricket Green', color: '#15803D' },
    { name: 'Elite Red', color: '#B91C1C' },
    { name: 'Deep Purple', color: '#6D28D9' },
  ];

  const ASPECT_RATIOS: { id: AspectRatio; label: string; desc: string }[] = [
    { id: '1:1', label: '1:1', desc: 'Insta Post' },
    { id: '4:5', label: '4:5', desc: 'FB/Insta Portrait' },
    { id: '9:16', label: '9:16', desc: 'Reel/Story/Status' },
  ];

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'logoImage' | 'backgroundImage') => {
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

  const addMatch = () => {
    if (data.matches.length >= 5) return;
    setData(prev => ({
      ...prev,
      matches: [
        ...prev.matches,
        {
          id: Date.now().toString(),
          groundName: 'New Ground',
          teamA: { name: 'Team A', score: '0/0', overs: '20' },
          teamB: { name: 'Team B', score: '0/0', overs: '20' },
          potm: 'Player Name',
          result: 'Match Result'
        }
      ]
    }));
  };

  const removeMatch = (id: string) => {
    setData(prev => ({
      ...prev,
      matches: prev.matches.filter(m => m.id !== id)
    }));
  };

  const updateMatch = (id: string, field: keyof WeeklyMatch | 'teamA.name' | 'teamA.score' | 'teamA.overs' | 'teamB.name' | 'teamB.score' | 'teamB.overs', value: string) => {
    setData(prev => ({
      ...prev,
      matches: prev.matches.map(m => {
        if (m.id !== id) return m;

        if (field.includes('.')) {
          const [team, prop] = field.split('.');
          return {
            ...m,
            [team]: {
              ...(m as any)[team],
              [prop]: value
            }
          };
        }

        return { ...m, [field]: value };
      })
    }));
  };

  const downloadPoster = async () => {
    if (!posterRef.current) return;
    
    setLoading(true);
    setDownloadError(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const fileName = `KAvach_${data.weekLabel.replace(/\s+/g, '_')}.png`;
      
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
      } catch (err) {
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
              <Trophy className="absolute inset-0 m-auto text-[#F27D26] w-8 h-8 animate-pulse" />
            </div>
            <h3 className="text-xl font-bold mt-6 mb-2">Generating Poster...</h3>
          </motion.div>
        )}
      </AnimatePresence>

      <Header 
        appMode="weekly_summary"
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Controls */}
          <div className="lg:col-span-5 space-y-8">
            {/* Global Settings */}
            <section className="bg-white/5 rounded-3xl p-6 border border-white/10">
              <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                <Settings className="text-[#F27D26]" size={16} />
                Global Settings
              </h2>
              
              <div className="space-y-4">
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
                  <label className="text-[10px] uppercase text-white/40 mb-1 block">Week Label</label>
                  <input 
                    type="text" 
                    value={data.weekLabel}
                    onChange={e => setData(prev => ({ ...prev, weekLabel: e.target.value }))}
                    className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-[#F27D26]"
                  />
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

                <div className="grid grid-cols-2 gap-4">
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

            {/* Matches */}
            <section className="bg-white/5 rounded-3xl p-6 border border-white/10">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                  <Trophy className="text-[#F27D26]" size={16} />
                  Matches ({data.matches.length}/5)
                </h2>
                {data.matches.length < 5 && (
                  <button 
                    onClick={addMatch}
                    className="bg-white/10 hover:bg-white/20 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition-colors"
                  >
                    <Plus size={14} /> Add Match
                  </button>
                )}
              </div>

              <div className="space-y-6">
                {data.matches.map((match, index) => (
                  <div key={match.id} className="p-4 bg-black/30 border border-white/5 rounded-2xl relative">
                    {data.matches.length > 1 && (
                      <button 
                        onClick={() => removeMatch(match.id)}
                        className="absolute top-2 right-2 p-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/40 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <h3 className="text-xs font-bold text-white/50 mb-3 border-b border-white/10 pb-2">Match {index + 1}</h3>
                    
                    <div className="space-y-3">
                      <div>
                        <label className="text-[10px] uppercase text-white/40 block">Ground Name</label>
                        <input 
                          type="text" 
                          value={match.groundName}
                          onChange={e => updateMatch(match.id, 'groundName', e.target.value)}
                          className="w-full bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26]"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] uppercase text-white/40 block">Team A</label>
                          <input 
                            type="text" 
                            placeholder="Name"
                            value={match.teamA.name}
                            onChange={e => updateMatch(match.id, 'teamA.name', e.target.value)}
                            className="w-full bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26] mb-1"
                          />
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              placeholder="Score (e.g. 150/5)"
                              value={match.teamA.score}
                              onChange={e => updateMatch(match.id, 'teamA.score', e.target.value)}
                              className="w-2/3 bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                            <input 
                              type="text" 
                              placeholder="Ovs"
                              value={match.teamA.overs}
                              onChange={e => updateMatch(match.id, 'teamA.overs', e.target.value)}
                              className="w-1/3 bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-white/40 block">Team B</label>
                          <input 
                            type="text" 
                            placeholder="Name"
                            value={match.teamB.name}
                            onChange={e => updateMatch(match.id, 'teamB.name', e.target.value)}
                            className="w-full bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26] mb-1"
                          />
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              placeholder="Score"
                              value={match.teamB.score}
                              onChange={e => updateMatch(match.id, 'teamB.score', e.target.value)}
                              className="w-2/3 bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                            <input 
                              type="text" 
                              placeholder="Ovs"
                              value={match.teamB.overs}
                              onChange={e => updateMatch(match.id, 'teamB.overs', e.target.value)}
                              className="w-1/3 bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26]"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[10px] uppercase text-white/40 block">Result</label>
                          <input 
                            type="text" 
                            value={match.result}
                            onChange={e => updateMatch(match.id, 'result', e.target.value)}
                            className="w-full bg-transparent border-b border-white/10 px-0 py-1 text-sm text-[#F27D26] font-bold focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase text-white/40 block">Player of the Match</label>
                          <input 
                            type="text" 
                            value={match.potm}
                            onChange={e => updateMatch(match.id, 'potm', e.target.value)}
                            className="w-full bg-transparent border-b border-white/10 px-0 py-1 text-sm focus:outline-none focus:border-[#F27D26]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Preview canvas */}
          <div className="lg:col-span-7 flex justify-center sticky top-24 h-max overflow-hidden">
            <div className="w-full overflow-x-auto pb-8 -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="flex justify-center min-w-max mx-auto">
                <div 
                  ref={posterRef}
                className={cn(
                  "bg-neutral-900 relative overflow-hidden flex flex-col",
                  data.aspectRatio === '1:1' && "aspect-square w-[500px]",
                  data.aspectRatio === '4:5' && "aspect-[4/5] w-[500px]",
                  data.aspectRatio === '9:16' && "aspect-[9/16] w-[400px]"
                )}
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {/* Background */}
                {data.backgroundImage && (
                  <img src={data.backgroundImage} alt="BG" className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity" />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/40 to-black pointer-events-none" />

                {/* Content */}
                <div className="relative z-10 flex flex-col h-full p-6 lg:p-8">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-8">
                    {data.logoImage ? (
                      <div className="w-16 h-16 bg-white p-1 rounded-lg">
                        <img src={data.logoImage} alt="Logo" className="w-full h-full object-contain" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 bg-white p-1 rounded-lg flex items-center justify-center">
                        <span className="text-[#F27D26] font-black text-2xl italic leading-none">K</span>
                      </div>
                    )}
                    <div className="text-right">
                      <h1 className="text-3xl font-black uppercase tracking-tighter italic" style={{ color: data.themeColor }}>
                        {data.weekLabel}
                      </h1>
                      <div className="h-1 w-12 ml-auto mt-1 bg-white" />
                    </div>
                  </div>

                  {/* Matches List */}
                  <div className="flex-1 flex flex-col justify-center gap-4">
                    {data.matches.map((match, i) => (
                      <div key={match.id} className="bg-black/60 backdrop-blur-sm border border-white/10 rounded-xl p-4 shadow-xl">
                        <div className="flex justify-between items-center mb-3">
                          <span className="text-[10px] font-bold text-white/50 tracking-widest uppercase">{match.groundName}</span>
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-white/10" style={{ color: data.themeColor }}>
                            Match {i + 1}
                          </span>
                        </div>
                        
                        <div className="flex justify-between items-center mb-3">
                          <div className="flex-1 text-center">
                            <div className="font-black text-lg tracking-tight truncate px-1">{match.teamA.name}</div>
                            <div className="text-xl font-bold font-mono mt-1 text-white">{match.teamA.score}</div>
                            <div className="text-[9px] text-white/40 uppercase tracking-widest mt-0.5">({match.teamA.overs} ov)</div>
                          </div>
                          <div className="px-4 text-xs font-black italic opacity-30">VS</div>
                          <div className="flex-1 text-center">
                            <div className="font-black text-lg tracking-tight truncate px-1">{match.teamB.name}</div>
                            <div className="text-xl font-bold font-mono mt-1 text-white">{match.teamB.score}</div>
                            <div className="text-[9px] text-white/40 uppercase tracking-widest mt-0.5">({match.teamB.overs} ov)</div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5 pt-3 border-t border-white/10">
                          <div className="text-center text-xs font-black uppercase tracking-wider text-white">
                            {match.result}
                          </div>
                          {match.potm && (
                            <div className="text-center text-[10px] uppercase font-bold text-white/60">
                              POTM: <span style={{ color: data.themeColor }}>{match.potm}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="mt-8 text-center border-t border-white/20 pt-4">
                    <p className="text-[10px] font-bold tracking-[0.3em] uppercase opacity-50 text-white">Powered by KAvach Design Studio</p>
                  </div>
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
