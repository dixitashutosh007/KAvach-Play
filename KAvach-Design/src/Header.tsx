import React, { useState } from 'react';
import { Trophy, Download, ChevronRight, Star, Calendar, UserSquare, Menu, X } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type AppMode = 'potm' | 'achievement' | 'weekly_summary' | 'player_card';

interface HeaderProps {
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  title: string;
  subtitle: string;
  onDownload: () => void;
  downloadDisabled: boolean;
  downloadLabel?: string;
  step?: number;
}

export function Header({ appMode, setAppMode, title, subtitle, onDownload, downloadDisabled, downloadLabel = "Download", step }: HeaderProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <>
      <header className="border-b border-white/10 p-4 sticky top-0 bg-[#0A0A0A]/95 backdrop-blur-xl z-[60] flex flex-col gap-4">
        {/* ROW 1: Branding & Hamburger */}
        <div className="w-full mx-auto flex items-center justify-between gap-4 max-w-[1600px]">
          <div className="flex items-center gap-4">
            <button 
              className="p-2 -ml-2 text-white/70 hover:text-white transition-colors lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={24} />
            </button>
            <div className="flex items-center gap-3">
              <button 
                className="p-2 -ml-2 text-white/70 hover:text-white transition-colors hidden lg:block"
                onClick={() => setIsSidebarOpen(true)}
              >
                <Menu size={24} />
              </button>
              <div className="w-10 h-10 bg-gradient-to-br from-[#F27D26] to-[#d66b1d] rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-[#F27D26]/20">
                <Trophy className="text-black w-6 h-6" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-xl font-black tracking-tight text-white leading-none mb-1">{title}</h1>
                <p className="text-[10px] text-[#F27D26] uppercase tracking-[0.2em] font-bold hidden md:block">{subtitle}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ROW 3 (Toolbar): Details, Style, Export Download Option */}
        <div className="w-full mx-auto max-w-[1600px] flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 min-h-[32px]">
            {step !== undefined ? (
              <div className="flex items-center gap-2 text-[10px] sm:text-xs uppercase font-bold tracking-widest text-[#F27D26]/60 pr-6 whitespace-nowrap">
                <span className={cn(step >= 1 ? "text-[#F27D26]" : "")}>1. Details</span>
                <ChevronRight size={12} className="opacity-50 mx-1" />
                <span className={cn(step >= 2 ? "text-[#F27D26]" : "")}>2. Style</span>
                <ChevronRight size={12} className="opacity-50 mx-1" />
                <span className={cn(step >= 3 ? "text-[#F27D26]" : "")}>3. Export</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[10px] sm:text-xs text-[#F27D26] uppercase font-bold tracking-widest whitespace-nowrap">
                <span>Details</span>
                <ChevronRight size={12} className="opacity-50 mx-1" />
                <span>Style</span>
                <ChevronRight size={12} className="opacity-50 mx-1" />
                <span>Export</span>
              </div>
            )}
          </div>
          
          <button 
            onClick={onDownload}
            disabled={downloadDisabled}
            className="bg-[#F27D26] hover:bg-[#F27D26]/90 disabled:opacity-50 text-black px-6 py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg hover:scale-105 active:scale-95 shrink-0 whitespace-nowrap sm:w-auto w-full"
          >
            <Download size={16} />
            {downloadLabel}
          </button>
        </div>
      </header>

      {/* SIDEBAR (Collapsible) */}
      <div 
        className={cn(
          "fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] transition-opacity duration-300",
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsSidebarOpen(false)}
      />
      
      <div className={cn(
        "fixed inset-y-0 left-0 w-72 bg-[#111111] z-[80] border-r border-white/10 transition-transform duration-300 ease-in-out py-6 px-4 flex flex-col",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center justify-between mb-8 pl-2">
          <span className="text-white font-black uppercase tracking-wider text-sm">Modules</span>
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="p-2 text-white/50 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="flex flex-col gap-2">
          <button
            onClick={() => { setAppMode('potm'); setIsSidebarOpen(false); }}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-left",
              appMode === 'potm' 
                ? "bg-gradient-to-r from-[#F27D26] to-[#d66b1d] text-black shadow-lg shadow-[#F27D26]/20" 
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <Trophy size={16} className={cn(appMode === 'potm' ? "text-black" : "text-white/40")} />
            Match POTM
          </button>
          
          <button
            onClick={() => { setAppMode('player_card'); setIsSidebarOpen(false); }}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-left",
              appMode === 'player_card' 
                ? "bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] text-white shadow-lg shadow-[#8B5CF6]/20" 
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <UserSquare size={16} className={cn(appMode === 'player_card' ? "text-white" : "text-white/40")} />
            Player Cards
          </button>
          
          <button
            onClick={() => { setAppMode('achievement'); setIsSidebarOpen(false); }}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-left",
              appMode === 'achievement' 
                ? "bg-gradient-to-r from-[#10B981] to-[#059669] text-white shadow-lg shadow-[#10B981]/20" 
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <Star size={16} className={cn(appMode === 'achievement' ? "text-white" : "text-white/40")} />
            Special Achievement
          </button>
          
          <button
            onClick={() => { setAppMode('weekly_summary'); setIsSidebarOpen(false); }}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-left",
              appMode === 'weekly_summary' 
                ? "bg-gradient-to-r from-[#3B82F6] to-[#2563EB] text-white shadow-lg shadow-[#3B82F6]/20" 
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
          >
            <Calendar size={16} className={cn(appMode === 'weekly_summary' ? "text-white" : "text-white/40")} />
            Weekly Summary
          </button>
          
          <div className="h-px bg-white/10 my-4" />
          
          <a
            href="/api/download-zip"
            download="kavach_design_studio.zip"
            onClick={() => setIsSidebarOpen(false)}
            className="flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-left text-[#F27D26] hover:text-white bg-[#F27D26]/10 hover:bg-[#F27D26]/20 border border-[#F27D26]/30"
          >
            <Download size={16} className="shrink-0" />
            <div className="flex flex-col">
              <span>Export App (ZIP)</span>
              <span className="text-[9px] text-white/40 normal-case font-normal mt-0.5">Complete code project</span>
            </div>
          </a>
        </div>
      </div>
    </>
  );
}
