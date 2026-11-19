import { Match, Player, Post, Tournament, Ground } from "@/lib/types";

export interface CampaignSlide {
  id: string;
  title: string;
  subtitle?: string;
  description: string;
  badge: string;
  badgeColor?: "scarlet" | "wine" | "gold" | "emerald";
  imageUrl?: string;
  ctaText: string;
  ctaDestination: string; // Tab or action identifier
  targetId?: string;
  isExternal?: boolean;
}

export interface CompactPlayerStats {
  matchesPlayed: number;
  runs: number;
  wickets: number;
  catches: number;
  battingStyle?: string;
  bowlingStyle?: string;
  hasRecordedStats: boolean;
}

export interface ClubAnnouncement {
  id: string;
  title: string;
  content: string;
  preview: string;
  date: string;
  authorName: string;
  isPinned: boolean;
  isImportant?: boolean;
  category?: string;
}
