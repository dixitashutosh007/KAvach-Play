"use client";

import React, { useState } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Bell,
  Shield,
  CreditCard,
  ChevronRight,
  Heart,
  MessageSquare,
  Share2,
  Sparkles,
  Smartphone,
  Monitor,
  X,
  ExternalLink,
  Award,
  Users,
  Trophy,
  ArrowRight,
  Search,
  Filter,
  Download,
  FileText,
  Check,
  ChevronDown
} from "lucide-react";

// -------------------------------------------------------------
// MOCK DATA FIXTURES (Decoupled from Live Firebase & Razorpay)
// -------------------------------------------------------------

const MOCK_CURRENT_PLAYER = {
  id: "player-ashutosh",
  kavachId: "KAV-007",
  name: "Ashutosh Dixit",
  role: "All-Rounder",
  battingStyle: "Right-hand bat",
  bowlingStyle: "Right-arm medium",
  jerseyNumber: "07",
  avatar: "https://picsum.photos/seed/kavach7/200/200",
  isAdmin: true,
  dues: {
    total: 1250,
    breakdown: [
      { id: "due-1", title: "Match Fee: vs Spartans CC", amount: 500, date: "17 Nov 2026", deadline: "26 Nov 2026 (Tue 23:59 IST)" },
      { id: "due-2", title: "Match Fee: vs Royal Strikers", amount: 500, date: "10 Nov 2026", deadline: "19 Nov 2026" },
      { id: "due-3", title: "Studio Nets (1 Hour Session)", amount: 250, date: "14 Nov 2026", deadline: "Immediate" },
      { id: "due-waived", title: "Match Fee: vs Stormers (Rain Abandoned)", amount: 0, originalAmount: 500, date: "03 Nov 2026", status: "Waived per Club Policy (Option A)" }
    ]
  }
};

const MOCK_MATCHES = [
  {
    id: "match-spartans-2026",
    title: "KAvach Cricket Club vs Spartans CC",
    opponent: "Spartans CC",
    format: "20 Overs T20",
    dateString: "Sunday, 24 Nov 2026",
    timeString: "07:30 AM IST",
    reportingTime: "06:45 AM IST",
    venue: "Kavach Arena Ground 1",
    venueDirectionsUrl: "https://maps.google.com",
    countdown: "3d 14h remaining",
    status: "upcoming",
    squadAnnounced: true,
    squadCount: 14,
    matchFee: 500,
    playerStatus: "Playing (XI)",
    playingXI: [
      { name: "Ashutosh Dixit", role: "All-Rounder", isCurrent: true, badge: "(VC)" },
      { name: "Vikram Sharma", role: "Batter", badge: "(C)" },
      { name: "Rahul Verma", role: "Bowler" },
      { name: "Sameer Khan", role: "Wicket-Keeper" },
      { name: "Arjun Nair", role: "Batter" },
      { name: "Deepak Joshi", role: "All-Rounder" },
      { name: "Karan Patel", role: "Bowler" },
      { name: "Rohan Gupta", role: "Batter" },
      { name: "Amitabh Sen", role: "Bowler" },
      { name: "Harish Rao", role: "Bowler" },
      { name: "Manoj Kumar", role: "Batter" }
    ],
    reserves: ["Siddharth Jain", "Pranav Reddy", "Gaurav Mehta"]
  },
  {
    id: "match-superkings-2026",
    title: "KAvach Cricket Club vs Super Kings",
    opponent: "Super Kings",
    format: "35 Overs Leather Ball",
    dateString: "Sunday, 01 Dec 2026",
    timeString: "08:00 AM IST",
    reportingTime: "07:15 AM IST",
    venue: "Skyline Turf, Ground B",
    venueDirectionsUrl: "https://maps.google.com",
    countdown: "10d remaining",
    status: "upcoming",
    squadAnnounced: false,
    squadCount: 0,
    matchFee: 600,
    playerStatus: "Pending RSVP"
  },
  {
    id: "match-royalstrikers-2026",
    title: "KAvach Cricket Club vs Royal Strikers",
    opponent: "Royal Strikers",
    format: "20 Overs T20",
    dateString: "Sunday, 10 Nov 2026",
    timeString: "07:30 AM IST",
    venue: "Kavach Arena Ground 1",
    status: "past",
    result: "KAvach won by 38 runs",
    isWin: true,
    scoreline: "KAvach: 174/5 (20.0) • Royal Strikers: 136/9 (20.0)",
    potm: "Rahul Verma (4/18 in 4 overs)",
    scorecard: {
      kavachInnings: [
        { batter: "Vikram Sharma (C)", dismissal: "c & b Patel", runs: 54, balls: 38, fours: 6, sixes: 2, sr: "142.1" },
        { batter: "Ashutosh Dixit", dismissal: "not out", runs: 46, balls: 29, fours: 4, sixes: 2, sr: "158.6" },
        { batter: "Arjun Nair", dismissal: "b Sharma", runs: 28, balls: 22, fours: 3, sixes: 0, sr: "127.3" },
        { batter: "Sameer Khan (WK)", dismissal: "run out (Khan)", runs: 18, balls: 14, fours: 2, sixes: 0, sr: "128.5" }
      ],
      opponentInnings: [
        { batter: "R. Singh", dismissal: "b Verma", runs: 32, balls: 24, fours: 4, sixes: 1, sr: "133.3" },
        { batter: "K. Malhotra", dismissal: "c Dixit b Verma", runs: 24, balls: 20, fours: 2, sixes: 1, sr: "120.0" },
        { batter: "V. Rao", dismissal: "b Dixit", runs: 15, balls: 16, fours: 1, sixes: 0, sr: "93.7" }
      ],
      catches: [
        { player: "Ashutosh Dixit", type: "Stunning Catch", description: "Diving backward catch at deep mid-wicket off Verma" },
        { player: "Sameer Khan", type: "Caught Behind", description: "Sharp low edge take standing up to medium pacer" }
      ]
    }
  },
  {
    id: "match-stormers-abandoned",
    title: "KAvach Cricket Club vs Stormers",
    opponent: "Stormers",
    format: "20 Overs T20",
    dateString: "Sunday, 03 Nov 2026",
    venue: "Valley Green Grounds",
    status: "abandoned",
    result: "Match Abandoned due to persistent rain (No Result)",
    feePolicy: "Fee Waived (Option A - No Obligation)"
  }
];

const MOCK_PAYMENT_HISTORY = [
  {
    id: "tx-901",
    date: "10 Nov 2026, 09:30 AM",
    title: "Match Fee - vs Royal Strikers",
    amount: 500,
    channel: "Razorpay Online",
    channelType: "gateway",
    referenceId: "pay_Kavach982189",
    status: "Completed",
    receiptNumber: "REC-2026-1102"
  },
  {
    id: "tx-842",
    date: "27 Oct 2026, 12:45 PM",
    title: "Match Fee - vs Metro CC",
    amount: 500,
    channel: "Pitch-Side Cash",
    channelType: "cash",
    referenceId: "CASH-REC-OCT27",
    status: "Verified by Match Admin",
    receiptNumber: "REC-2026-1088"
  },
  {
    id: "tx-789",
    date: "15 Oct 2026, 06:15 PM",
    title: "Studio Monthly Nets Membership",
    amount: 1500,
    channel: "Razorpay Online",
    channelType: "gateway",
    referenceId: "pay_Kavach745120",
    status: "Completed",
    receiptNumber: "REC-2026-1045"
  }
];

const MOCK_FEED_POSTS = [
  {
    id: "post-1",
    authorName: "Vikram Sharma",
    authorRole: "Club Captain",
    authorAvatar: "https://picsum.photos/seed/vikram/100/100",
    timeAgo: "2h ago",
    badge: "Captain",
    content: "Outstanding fielding effort in yesterday's nets session, boys! Next match against Spartans is crucial for tournament seedings. Let's get our RSVPs confirmed by Wednesday evening so match admins can finalize the playing XI.",
    likesCount: 14,
    commentsCount: 3,
    isLiked: false
  },
  {
    id: "post-2",
    authorName: "KAvach Media",
    authorRole: "Club Admin",
    authorAvatar: "https://picsum.photos/seed/kavachmedia/100/100",
    timeAgo: "1d ago",
    badge: "Announcement",
    content: "🎉 Congratulations to Rahul Verma for picking up 4 wickets for 18 runs and earning Player of the Match honors last weekend! Check out the Performance tab for updated leaderboards.",
    likesCount: 28,
    commentsCount: 8,
    isLiked: true
  }
];

const MOCK_NOTIFICATIONS = [
  { id: "notif-1", title: "Squad Announced", message: "You are selected in the Playing XI vs Spartans CC!", time: "10m ago", read: false },
  { id: "notif-2", title: "Payment Receipt Generated", message: "Receipt #REC-2026-1102 for ₹500 has been verified.", time: "1d ago", read: true },
  { id: "notif-3", title: "Studio Nets Booking", message: "Your nets session is confirmed for Thursday at 6:00 PM.", time: "2d ago", read: true }
];

export default function PlayerHomePrototype() {
  // Device Frame Toggle: 'responsive' | 'mobile' | 'desktop'
  const [deviceFrame, setDeviceFrame] = useState<"responsive" | "mobile" | "desktop">("responsive");
  
  // Navigation & View States
  const [activeTab, setActiveTab] = useState<"home" | "matches" | "payments" | "performance" | "club">("home");
  
  // Matches Tab States
  const [matchFilter, setMatchFilter] = useState<"all" | "upcoming" | "past" | "abandoned">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<any | null>(null);
  const [selectedMatchSubTab, setSelectedMatchSubTab] = useState<"overview" | "scorecard" | "catches">("overview");

  // Payments Tab States
  const [duesState, setDuesState] = useState(MOCK_CURRENT_PLAYER.dues);
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Home Feed States
  const [rsvpStatus, setRsvpStatus] = useState<"available" | "tentative" | "unavailable" | null>("available");
  const [rsvpNote, setRsvpNote] = useState<string>("Ready to bat top order");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [posts, setPosts] = useState(MOCK_FEED_POSTS);

  // Filtered Matches logic
  const filteredMatches = MOCK_MATCHES.filter((m) => {
    if (matchFilter === "upcoming" && m.status !== "upcoming") return false;
    if (matchFilter === "past" && m.status !== "past") return false;
    if (matchFilter === "abandoned" && m.status !== "abandoned") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return m.title.toLowerCase().includes(q) || m.venue.toLowerCase().includes(q) || m.format.toLowerCase().includes(q);
    }
    return true;
  });

  // Toggle Like on feed
  const toggleLike = (postId: string) => {
    setPosts(prev => prev.map(p => {
      if (p.id === postId) {
        return {
          ...p,
          isLiked: !p.isLiked,
          likesCount: p.isLiked ? p.likesCount - 1 : p.likesCount + 1
        };
      }
      return p;
    }));
  };

  // Simulate mock payment
  const handlePayDues = () => {
    setPaymentSuccess(true);
    setTimeout(() => {
      setDuesState({ total: 0, breakdown: [] });
      setPaymentModalOpen(false);
      setPaymentSuccess(false);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-[#171C26] font-sans">
      {/* Top Prototype Control Bar */}
      <div className="bg-[#171C26] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs border-b border-gray-800 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#A30F2D] text-white font-bold text-[10px] uppercase tracking-wider">
            Prototype Preview
          </span>
          <span className="font-semibold text-gray-200">Phase 4: High-Fidelity Design & Prototype Sandbox</span>
        </div>

        {/* Viewport Frame Mode Controls */}
        <div className="flex items-center gap-1.5 bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setDeviceFrame("responsive")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition ${
              deviceFrame === "responsive" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            Fluid Responsive
          </button>
          <button
            onClick={() => setDeviceFrame("mobile")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition ${
              deviceFrame === "mobile" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Mobile 390px
          </button>
          <button
            onClick={() => setDeviceFrame("desktop")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition ${
              deviceFrame === "desktop" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Desktop 1280px
          </button>
        </div>
      </div>

      {/* Frame Container */}
      <div className={`mx-auto transition-all duration-300 ${
        deviceFrame === "mobile"
          ? "max-w-[410px] my-6 p-2 bg-gray-900 rounded-[48px] shadow-2xl border-4 border-gray-800"
          : deviceFrame === "desktop"
          ? "max-w-[1360px] my-6 shadow-2xl rounded-2xl overflow-hidden border border-gray-300"
          : "w-full"
      }`}>
        {/* Actual App Preview Surface */}
        <div className="min-h-[844px] bg-[#F6F7F9] flex flex-col relative overflow-hidden">
          
          {/* 1. GLOBAL HEADER */}
          <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#E5E7EB] px-4 py-3 flex items-center justify-between shadow-xs">
            {/* Left: Brand Crest & Title */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#A30F2D] to-[#D51F43] flex items-center justify-center text-white font-black text-sm shadow-sm shrink-0">
                KP
              </div>
              <div className="min-w-0">
                <h1 className="text-base font-black tracking-tight text-[#171C26] truncate uppercase leading-tight">
                  KAvach Play
                </h1>
                <p className="text-[10px] font-bold text-[#667085] tracking-wider uppercase truncate">
                  KAvach Cricket Club
                </p>
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Admin Badge (Conditional) */}
              {MOCK_CURRENT_PLAYER.isAdmin && (
                <button
                  className="min-h-[44px] px-2.5 rounded-lg border border-[#A30F2D]/20 text-[#A30F2D] bg-[#FCE8ED]/50 hover:bg-[#FCE8ED] transition flex items-center gap-1.5 text-xs font-bold"
                  title="Switch to Admin Console"
                >
                  <Shield className="w-4 h-4 text-[#A30F2D]" />
                  <span className="hidden sm:inline">Admin</span>
                </button>
              )}

              {/* Notification Bell with Badge */}
              <button
                onClick={() => setNotificationsOpen(true)}
                className="relative min-h-[44px] min-w-[44px] rounded-full hover:bg-gray-100 flex items-center justify-center text-[#667085] hover:text-[#171C26] transition"
                aria-label="View notifications"
              >
                <Bell className="w-5 h-5" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-[#D51F43] rounded-full ring-2 ring-white animate-pulse" />
              </button>

              {/* Profile Avatar */}
              <button
                onClick={() => setActiveTab("club")}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="View player profile"
              >
                <img
                  src={MOCK_CURRENT_PLAYER.avatar}
                  alt={MOCK_CURRENT_PLAYER.name}
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-[#D51F43]/20"
                />
              </button>
            </div>
          </header>

          {/* MAIN WORKSPACE CONTENT */}
          <main className="flex-1 pb-24 px-4 sm:px-6 py-5 max-w-5xl mx-auto w-full">
            
            {/* ========================================================================= */}
            {/* TAB 1: PLAYER HOME                                                        */}
            {/* ========================================================================= */}
            {activeTab === "home" && (
              <div className="space-y-6">
                
                {/* HERO UNIT: NEXT MATCH COUNTDOWN & 1-TAP RSVP */}
                <section className="bg-white rounded-2xl border border-[#E5E7EB] shadow-xs overflow-hidden">
                  <div className="bg-gradient-to-r from-[#A30F2D] to-[#D51F43] px-4 py-2.5 text-white flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Trophy className="w-3.5 h-3.5 text-amber-300" />
                      Next Fixture • {MOCK_MATCHES[0].format}
                    </span>
                    <span className="bg-white/20 px-2 py-0.5 rounded-full font-semibold text-[10px] tracking-wide">
                      {MOCK_MATCHES[0].countdown}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                      <div>
                        <h2 className="text-lg sm:text-xl font-black text-[#171C26] tracking-tight">
                          {MOCK_MATCHES[0].title}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-[#667085]">
                          <span className="flex items-center gap-1 font-medium">
                            <Calendar className="w-3.5 h-3.5 text-[#D51F43]" />
                            {MOCK_MATCHES[0].dateString}
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <Clock className="w-3.5 h-3.5 text-[#D51F43]" />
                            {MOCK_MATCHES[0].timeString}
                          </span>
                          <a
                            href={MOCK_MATCHES[0].venueDirectionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[#D51F43] font-semibold hover:underline"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            {MOCK_MATCHES[0].venue}
                          </a>
                        </div>
                      </div>

                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold self-start sm:self-auto">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>You are in Playing XI!</span>
                      </div>
                    </div>

                    {/* 1-TAP RSVP STRIP */}
                    <div className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-black uppercase tracking-wider text-[#667085]">
                          Confirm Your Availability
                        </label>
                        <button
                          onClick={() => setShowNoteInput(!showNoteInput)}
                          className="text-[11px] font-semibold text-[#D51F43] hover:underline"
                        >
                          {showNoteInput ? "Hide Note" : "+ Add Note for Captain"}
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          onClick={() => setRsvpStatus("available")}
                          className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                            rsvpStatus === "available"
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                              : "bg-emerald-50/60 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                          }`}
                        >
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>Playing</span>
                        </button>

                        <button
                          onClick={() => setRsvpStatus("tentative")}
                          className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                            rsvpStatus === "tentative"
                              ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                              : "bg-amber-50/60 text-amber-800 border-amber-200 hover:bg-amber-100"
                          }`}
                        >
                          <Clock className="w-4 h-4 shrink-0" />
                          <span>Tentative</span>
                        </button>

                        <button
                          onClick={() => setRsvpStatus("unavailable")}
                          className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                            rsvpStatus === "unavailable"
                              ? "bg-rose-600 text-white border-rose-600 shadow-sm"
                              : "bg-rose-50/60 text-rose-800 border-rose-200 hover:bg-rose-100"
                          }`}
                        >
                          <XCircle className="w-4 h-4 shrink-0" />
                          <span>Out</span>
                        </button>
                      </div>

                      {showNoteInput && (
                        <div className="mt-2.5">
                          <input
                            type="text"
                            value={rsvpNote}
                            onChange={(e) => setRsvpNote(e.target.value)}
                            placeholder="e.g. Arriving 15m early / bat top order..."
                            className="w-full text-xs px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#D51F43]/30"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                {/* OUTSTANDING DUES ALERT CARD */}
                {duesState.total > 0 ? (
                  <section className="bg-gradient-to-br from-[#FCE8ED] to-white rounded-2xl border border-[#D51F43]/20 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-[#D51F43] text-white flex items-center justify-center shrink-0 shadow-sm">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#A30F2D] uppercase tracking-wider">
                            Outstanding Club Dues
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#D51F43] text-white">
                            Due Now
                          </span>
                        </div>
                        <div className="text-2xl font-black text-[#171C26] mt-0.5">
                          ₹{duesState.total.toLocaleString("en-IN")}
                        </div>
                        <p className="text-xs text-[#667085] mt-0.5">
                          {duesState.breakdown.filter(d => d.amount > 0).length} pending obligations • Includes match fee & studio pass
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => setPaymentModalOpen(true)}
                      className="min-h-[44px] w-full sm:w-auto px-5 py-2.5 bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <span>Pay Now</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </section>
                ) : (
                  <section className="bg-emerald-50/60 rounded-2xl border border-emerald-200 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2.5 text-xs text-emerald-800 font-bold">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span>All club dues settled! Good standing for upcoming matches.</span>
                    </div>
                  </section>
                )}

                {/* CLUB FEED & ANNOUNCEMENTS */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#667085] flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-[#D51F43]" />
                      Club Announcements & Feed
                    </h3>
                  </div>

                  {posts.map((post) => (
                    <article key={post.id} className="bg-white rounded-2xl border border-[#E5E7EB] p-4 sm:p-5 shadow-xs">
                      <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={post.authorAvatar}
                            alt={post.authorName}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-black text-[#171C26]">{post.authorName}</h4>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#FCE8ED] text-[#A30F2D]">
                                {post.badge}
                              </span>
                            </div>
                            <span className="text-[11px] text-[#667085]">{post.timeAgo}</span>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs sm:text-sm text-[#171C26] leading-relaxed pt-3">
                        {post.content}
                      </p>

                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-4 text-xs font-medium text-[#667085]">
                        <button
                          onClick={() => toggleLike(post.id)}
                          className={`min-h-[44px] flex items-center gap-1.5 transition ${
                            post.isLiked ? "text-[#D51F43] font-bold" : "hover:text-[#171C26]"
                          }`}
                        >
                          <Heart className={`w-4 h-4 ${post.isLiked ? "fill-current" : ""}`} />
                          <span>{post.likesCount}</span>
                        </button>

                        <button className="min-h-[44px] flex items-center gap-1.5 hover:text-[#171C26] transition">
                          <MessageSquare className="w-4 h-4" />
                          <span>{post.commentsCount} Comments</span>
                        </button>

                        <button className="min-h-[44px] ml-auto flex items-center gap-1.5 hover:text-[#171C26] transition">
                          <Share2 className="w-4 h-4" />
                          <span className="hidden sm:inline">Share</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 2: MATCHES LISTING & DETAILS                                          */}
            {/* ========================================================================= */}
            {activeTab === "matches" && (
              <div className="space-y-5">
                
                {/* Search & Filter Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-[#E5E7EB] shadow-xs">
                  {/* Filter Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    <button
                      onClick={() => setMatchFilter("all")}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "all" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      All Matches ({MOCK_MATCHES.length})
                    </button>
                    <button
                      onClick={() => setMatchFilter("upcoming")}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "upcoming" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      Upcoming (2)
                    </button>
                    <button
                      onClick={() => setMatchFilter("past")}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "past" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      Past Results (1)
                    </button>
                    <button
                      onClick={() => setMatchFilter("abandoned")}
                      className={`min-h-[40px] px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "abandoned" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      Abandoned (1)
                    </button>
                  </div>

                  {/* Search Bar */}
                  <div className="relative min-w-[200px]">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search opponent or venue..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full text-xs pl-9 pr-3 py-2 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#D51F43]/30"
                    />
                  </div>
                </div>

                {/* Matches Card Stack */}
                <div className="space-y-4">
                  {filteredMatches.map((m) => (
                    <article
                      key={m.id}
                      onClick={() => setSelectedMatch(m)}
                      className="bg-white rounded-2xl border border-[#E5E7EB] hover:border-[#D51F43]/40 p-4 sm:p-5 shadow-xs transition hover:shadow-md cursor-pointer relative overflow-hidden"
                    >
                      {/* Left accent strip for outcome */}
                      {m.status === "past" && (
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${m.isWin ? "bg-emerald-500" : "bg-rose-500"}`} />
                      )}

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#FCE8ED] text-[#A30F2D]">
                              {m.format}
                            </span>
                            <span className="text-xs text-[#667085] font-medium flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-[#D51F43]" />
                              {m.dateString}
                            </span>
                          </div>

                          <h3 className="text-base sm:text-lg font-black text-[#171C26] mt-1.5">
                            {m.title}
                          </h3>

                          <p className="text-xs text-[#667085] flex items-center gap-1 mt-1">
                            <MapPin className="w-3.5 h-3.5 text-[#667085]" />
                            {m.venue}
                          </p>
                        </div>

                        {/* Status Pills & Actions */}
                        <div className="flex items-center gap-2 self-start sm:self-auto">
                          {m.status === "upcoming" && (
                            <span className="px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              {m.playerStatus}
                            </span>
                          )}

                          {m.status === "past" && (
                            <span className={`px-2.5 py-1 rounded-xl text-xs font-bold ${
                              m.isWin ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800"
                            }`}>
                              {m.result}
                            </span>
                          )}

                          {m.status === "abandoned" && (
                            <span className="px-2.5 py-1 rounded-xl bg-gray-100 text-gray-700 text-xs font-bold">
                              Rain Abandoned • Fee Waived
                            </span>
                          )}

                          <button className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-[#D51F43]">
                            <ChevronRight className="w-5 h-5" />
                          </button>
                        </div>
                      </div>

                      {/* Additional summary details */}
                      {m.status === "past" && (
                        <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between text-xs text-[#667085] gap-2">
                          <span className="font-semibold text-[#171C26]">{m.scoreline}</span>
                          <span className="text-amber-700 font-bold flex items-center gap-1">
                            <Trophy className="w-3.5 h-3.5 text-amber-500" />
                            POTM: {m.potm}
                          </span>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* TAB 3: PAYMENTS, DUES & RECEIPTS                                          */}
            {/* ========================================================================= */}
            {activeTab === "payments" && (
              <div className="space-y-6">
                
                {/* Outstanding Dues Card */}
                <div className="bg-gradient-to-br from-[#FCE8ED] to-white rounded-2xl border border-[#D51F43]/20 p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div>
                      <span className="text-xs font-bold text-[#A30F2D] uppercase tracking-wider">
                        Total Payable Obligations
                      </span>
                      <div className="text-3xl font-black text-[#171C26] mt-0.5">
                        ₹{duesState.total.toLocaleString("en-IN")}
                      </div>
                      <p className="text-xs text-[#667085] mt-1">
                        Settlements processed securely via Razorpay with immediate digital receipt.
                      </p>
                    </div>

                    {duesState.total > 0 && (
                      <button
                        onClick={() => setPaymentModalOpen(true)}
                        className="min-h-[48px] w-full sm:w-auto px-6 py-2.5 bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-md flex items-center justify-center gap-2"
                      >
                        <CreditCard className="w-4 h-4" />
                        <span>Pay Full Balance (₹{duesState.total})</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Line Item Breakdown */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 sm:p-5 shadow-xs space-y-3">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#667085]">
                    Current Unpaid Obligations & Policies
                  </h3>

                  <div className="space-y-2.5">
                    {duesState.breakdown.map((item) => (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-xl border border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-bold text-xs text-[#171C26]">{item.title}</div>
                          <div className="text-[11px] text-[#667085] mt-0.5">
                            {item.status ? (
                              <span className="text-emerald-700 font-semibold">{item.status}</span>
                            ) : (
                              <span>Due Date: {item.deadline}</span>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
                          {item.amount === 0 ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs line-through text-gray-400">₹{item.originalAmount}</span>
                              <span className="text-xs font-black text-emerald-700">₹0 (Waived)</span>
                            </div>
                          ) : (
                            <div className="text-sm font-black text-[#D51F43]">₹{item.amount}</div>
                          )}
                        </div>
                      </div>
                    ))}

                    {duesState.total === 0 && (
                      <div className="text-center py-6 text-xs text-emerald-800 font-bold flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span>All dues cleared! No pending financial obligations.</span>
                      </div>
                    )}
                  </div>

                  {/* Late Fee Policy Reminder (Asia/Kolkata timezone standard) */}
                  <div className="mt-3 p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Club Late Fee Rule:</span> Match fees must be settled by Tuesday 23:59 IST following the match weekend. Automatic late fee of ₹150 applies subsequently.
                    </div>
                  </div>
                </div>

                {/* Chronological Payment History */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 sm:p-5 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-[#667085]">
                      Payment History & Verified Receipts
                    </h3>
                  </div>

                  <div className="divide-y divide-gray-100">
                    {MOCK_PAYMENT_HISTORY.map((tx) => (
                      <div key={tx.id} className="py-3.5 first:pt-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-xs text-[#171C26]">{tx.title}</div>
                          <div className="text-[11px] text-[#667085] flex flex-wrap items-center gap-2 mt-0.5">
                            <span>{tx.date}</span>
                            <span>•</span>
                            <span className="font-medium text-gray-700">{tx.referenceId}</span>
                            <span>•</span>
                            <span className="px-1.5 py-0.2 rounded bg-gray-100 font-semibold text-[10px]">
                              {tx.channel}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-auto">
                          <span className="font-black text-sm text-[#171C26]">₹{tx.amount}</span>
                          <button
                            onClick={() => setSelectedReceipt(tx)}
                            className="min-h-[40px] px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-bold text-[#D51F43] hover:bg-[#FCE8ED] transition flex items-center gap-1.5"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Receipt</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

            {/* TAB PLACEHOLDERS FOR STATS & CLUB */}
            {(activeTab === "performance" || activeTab === "club") && (
              <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center mx-auto">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-base font-black uppercase text-[#171C26]">
                  {activeTab} Screen Blueprint
                </h3>
                <p className="text-xs text-[#667085] max-w-sm mx-auto">
                  Stage 1 and 2 prototype encompasses Player Navigation, Home, Matches, and Payments. Stages 3–5 will cover Administrator hubs and Player Performance leaderboards.
                </p>
                <button
                  onClick={() => setActiveTab("home")}
                  className="min-h-[44px] px-4 py-2 bg-[#D51F43] text-white text-xs font-bold rounded-xl"
                >
                  Return to Home
                </button>
              </div>
            )}
          </main>

          {/* 2. PLAYER MOBILE BOTTOM NAVIGATION (5 APPROVED ITEMS) */}
          <nav
            role="navigation"
            aria-label="Player Primary Navigation"
            className="sticky bottom-0 z-40 bg-white border-t border-[#E5E7EB] shadow-lg flex items-center justify-around h-[68px] px-2"
          >
            <button
              onClick={() => setActiveTab("home")}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-1 transition ${
                activeTab === "home" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
              }`}
            >
              <div className={`p-1 rounded-lg ${activeTab === "home" ? "bg-[#FCE8ED]" : ""}`}>
                <Calendar className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight">Home</span>
            </button>

            <button
              onClick={() => setActiveTab("matches")}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-1 transition ${
                activeTab === "matches" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
              }`}
            >
              <div className={`p-1 rounded-lg ${activeTab === "matches" ? "bg-[#FCE8ED]" : ""}`}>
                <Trophy className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight">Matches</span>
            </button>

            <button
              onClick={() => setActiveTab("payments")}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-1 transition ${
                activeTab === "payments" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
              }`}
            >
              <div className={`p-1 rounded-lg ${activeTab === "payments" ? "bg-[#FCE8ED]" : ""}`}>
                <CreditCard className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight">Payments</span>
            </button>

            <button
              onClick={() => setActiveTab("performance")}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-1 transition ${
                activeTab === "performance" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
              }`}
            >
              <div className={`p-1 rounded-lg ${activeTab === "performance" ? "bg-[#FCE8ED]" : ""}`}>
                <Award className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight">Stats</span>
            </button>

            <button
              onClick={() => setActiveTab("club")}
              className={`flex-1 h-full flex flex-col items-center justify-center gap-1 transition ${
                activeTab === "club" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
              }`}
            >
              <div className={`p-1 rounded-lg ${activeTab === "club" ? "bg-[#FCE8ED]" : ""}`}>
                <Shield className="w-5 h-5" />
              </div>
              <span className="text-[10px] tracking-tight">Club</span>
            </button>
          </nav>

          {/* ========================================================================= */}
          {/* MATCH DETAILS SLIDE-OVER DRAWER                                           */}
          {/* ========================================================================= */}
          {selectedMatch && (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
              <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col overflow-y-auto">
                {/* Header */}
                <div className="p-4 bg-[#A30F2D] text-white flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      {selectedMatch.format}
                    </span>
                    <h3 className="text-sm sm:text-base font-black truncate">{selectedMatch.title}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedMatch(null)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Subtabs inside Match Details */}
                <div className="flex border-b border-gray-100 bg-gray-50 text-xs font-bold px-4">
                  <button
                    onClick={() => setSelectedMatchSubTab("overview")}
                    className={`py-3 px-3 border-b-2 transition ${
                      selectedMatchSubTab === "overview"
                        ? "border-[#D51F43] text-[#D51F43]"
                        : "border-transparent text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    Squad & Info
                  </button>
                  {selectedMatch.scorecard && (
                    <button
                      onClick={() => setSelectedMatchSubTab("scorecard")}
                      className={`py-3 px-3 border-b-2 transition ${
                        selectedMatchSubTab === "scorecard"
                          ? "border-[#D51F43] text-[#D51F43]"
                          : "border-transparent text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      Scorecard
                    </button>
                  )}
                  {selectedMatch.scorecard?.catches && (
                    <button
                      onClick={() => setSelectedMatchSubTab("catches")}
                      className={`py-3 px-3 border-b-2 transition ${
                        selectedMatchSubTab === "catches"
                          ? "border-[#D51F43] text-[#D51F43]"
                          : "border-transparent text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      Fielding & Catches
                    </button>
                  )}
                </div>

                {/* Subtab Content */}
                <div className="p-5 space-y-5 flex-1">
                  {selectedMatchSubTab === "overview" && (
                    <>
                      {/* Venue & Time details */}
                      <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Date & Time:</span>
                          <span className="font-bold text-[#171C26]">{selectedMatch.dateString} • {selectedMatch.timeString}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Venue:</span>
                          <a
                            href={selectedMatch.venueDirectionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-[#D51F43] flex items-center gap-1 hover:underline"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            {selectedMatch.venue}
                          </a>
                        </div>
                        {selectedMatch.reportingTime && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500">Reporting Time:</span>
                            <span className="font-bold text-amber-700">{selectedMatch.reportingTime}</span>
                          </div>
                        )}
                      </div>

                      {/* Playing XI Roster */}
                      {selectedMatch.playingXI ? (
                        <div className="space-y-2.5">
                          <h4 className="text-xs font-black uppercase text-[#667085] flex items-center justify-between">
                            <span>Playing XI ({selectedMatch.playingXI.length})</span>
                            <span className="text-emerald-700 text-[10px] font-bold">Confirmed</span>
                          </h4>

                          <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl overflow-hidden bg-white">
                            {selectedMatch.playingXI.map((player: any, idx: number) => (
                              <div
                                key={idx}
                                className={`p-2.5 flex items-center justify-between text-xs ${
                                  player.isCurrent ? "bg-[#FCE8ED]/60 font-bold" : ""
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-400 font-mono w-4">{idx + 1}</span>
                                  <span>{player.name}</span>
                                  {player.badge && (
                                    <span className="text-[10px] text-[#D51F43] font-bold">{player.badge}</span>
                                  )}
                                  {player.isCurrent && (
                                    <span className="text-[9px] bg-[#D51F43] text-white px-1.5 py-0.2 rounded font-bold">
                                      YOU
                                    </span>
                                  )}
                                </div>
                                <span className="text-[10px] text-gray-500">{player.role}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="p-6 text-center text-xs text-gray-400 border border-dashed rounded-xl">
                          Squad has not been announced by the match admin yet.
                        </div>
                      )}
                    </>
                  )}

                  {selectedMatchSubTab === "scorecard" && selectedMatch.scorecard && (
                    <div className="space-y-4 text-xs">
                      <div className="font-black text-sm text-[#171C26]">1st Innings: KAvach Cricket Club (174/5)</div>
                      <div className="border border-gray-200 rounded-xl overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-gray-50 border-b border-gray-200 text-[10px] font-black uppercase text-gray-500">
                            <tr>
                              <th className="p-2.5">Batter</th>
                              <th className="p-2.5">R</th>
                              <th className="p-2.5">B</th>
                              <th className="p-2.5">4s</th>
                              <th className="p-2.5">6s</th>
                              <th className="p-2.5">SR</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-xs font-medium">
                            {selectedMatch.scorecard.kavachInnings.map((row: any, i: number) => (
                              <tr key={i}>
                                <td className="p-2.5 font-bold text-[#171C26]">{row.batter}</td>
                                <td className="p-2.5 font-black text-[#D51F43]">{row.runs}</td>
                                <td className="p-2.5 text-gray-500">{row.balls}</td>
                                <td className="p-2.5 text-gray-500">{row.fours}</td>
                                <td className="p-2.5 text-gray-500">{row.sixes}</td>
                                <td className="p-2.5 text-gray-500">{row.sr}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {selectedMatchSubTab === "catches" && selectedMatch.scorecard?.catches && (
                    <div className="space-y-3">
                      <h4 className="text-xs font-black uppercase text-[#667085]">Fielding Highlights</h4>
                      {selectedMatch.scorecard.catches.map((c: any, i: number) => (
                        <div key={i} className="p-3 bg-amber-50/60 rounded-xl border border-amber-200 text-xs">
                          <div className="font-bold text-amber-900 flex items-center gap-1.5">
                            <Trophy className="w-3.5 h-3.5 text-amber-600" />
                            {c.player} • {c.type}
                          </div>
                          <p className="text-[11px] text-gray-600 mt-1">{c.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* DIGITAL RECEIPT MODAL                                                     */}
          {/* ========================================================================= */}
          {selectedReceipt && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs">
                {/* Receipt Header */}
                <div className="bg-[#A30F2D] text-white p-4 text-center relative">
                  <button
                    onClick={() => setSelectedReceipt(null)}
                    className="absolute right-3 top-3 text-white/80 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    Official Payment Receipt
                  </div>
                  <h4 className="text-base font-black uppercase tracking-tight mt-0.5">KAvach Cricket Club</h4>
                  <div className="text-[10px] opacity-80">play.kavachcricket.com</div>
                </div>

                <div className="p-5 space-y-3">
                  <div className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Receipt No:</span>
                    <span className="font-bold text-[#171C26]">{selectedReceipt.receiptNumber}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Date:</span>
                    <span className="font-medium text-[#171C26]">{selectedReceipt.date}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Payer:</span>
                    <span className="font-bold text-[#171C26]">Ashutosh Dixit (KAV-007)</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Purpose:</span>
                    <span className="font-medium text-[#171C26]">{selectedReceipt.title}</span>
                  </div>
                  <div className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-gray-500">Channel / Ref:</span>
                    <span className="font-mono text-gray-700">{selectedReceipt.referenceId}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 text-sm font-black">
                    <span>Total Settled:</span>
                    <span className="text-[#D51F43]">₹{selectedReceipt.amount}.00</span>
                  </div>

                  <div className="pt-3 text-center">
                    <button
                      onClick={() => alert("Simulating receipt download PDF...")}
                      className="min-h-[44px] w-full bg-[#171C26] hover:bg-black text-white font-bold rounded-xl flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download PDF Receipt</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATIONS DRAWER */}
          {notificationsOpen && (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
              <div className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-5 h-5 text-[#D51F43]" />
                    <h3 className="text-sm font-black uppercase text-[#171C26]">Club Notifications</h3>
                  </div>
                  <button
                    onClick={() => setNotificationsOpen(false)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-700"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-4 divide-y divide-gray-100 flex-1 overflow-y-auto">
                  {MOCK_NOTIFICATIONS.map((n) => (
                    <div key={n.id} className="py-3 first:pt-0">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#171C26]">{n.title}</span>
                        <span className="text-[10px] text-[#667085]">{n.time}</span>
                      </div>
                      <p className="text-xs text-[#667085] mt-1">{n.message}</p>
                    </div>
                  ))}
                </div>

                <div className="p-3 border-t border-gray-100 bg-gray-50 text-center">
                  <button
                    onClick={() => setNotificationsOpen(false)}
                    className="text-xs font-bold text-[#D51F43] hover:underline"
                  >
                    Close Drawer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MOCK PAYMENT CHECKOUT MODAL */}
          {paymentModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-amber-300" />
                    <h3 className="text-sm font-black uppercase">Razorpay Secure Checkout</h3>
                  </div>
                  <button
                    onClick={() => setPaymentModalOpen(false)}
                    className="text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div className="text-center py-2 border-b border-gray-100">
                    <span className="text-xs text-[#667085] uppercase font-bold tracking-wider">Amount Payable</span>
                    <div className="text-3xl font-black text-[#171C26] mt-1">₹{duesState.total}</div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <span className="font-bold text-[#667085] uppercase tracking-wider text-[10px]">Itemized Obligations:</span>
                    {duesState.breakdown.filter(d => d.amount > 0).map(item => (
                      <div key={item.id} className="flex items-center justify-between p-2 rounded-lg bg-gray-50">
                        <div>
                          <div className="font-semibold text-[#171C26]">{item.title}</div>
                          <div className="text-[10px] text-[#667085]">{item.date}</div>
                        </div>
                        <div className="font-black text-[#D51F43]">₹{item.amount}</div>
                      </div>
                    ))}
                  </div>

                  {paymentSuccess ? (
                    <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 animate-bounce" />
                      Payment Verified & Recorded! Settling dues...
                    </div>
                  ) : (
                    <button
                      onClick={handlePayDues}
                      className="w-full min-h-[48px] bg-[#D51F43] hover:bg-[#A30F2D] text-white font-black text-xs uppercase tracking-wider rounded-xl transition shadow-md"
                    >
                      Simulate Test Payment (₹{duesState.total})
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
