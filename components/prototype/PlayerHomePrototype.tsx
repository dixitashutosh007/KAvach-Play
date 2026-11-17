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
  ArrowRight
} from "lucide-react";

// Mock Data Fixtures (Decoupled from Live Firebase)
const MOCK_CURRENT_PLAYER = {
  id: "player-ashutosh",
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
      { id: "due-1", title: "Match Fee: vs Spartans CC", amount: 500, date: "17 Nov 2026" },
      { id: "due-2", title: "Match Fee: vs Royal Strikers", amount: 500, date: "10 Nov 2026" },
      { id: "due-3", title: "Studio Nets (1 Hour Session)", amount: 250, date: "14 Nov 2026" }
    ]
  }
};

const MOCK_NEXT_MATCH = {
  id: "match-spartans-2026",
  title: "KAvach Cricket Club vs Spartans CC",
  format: "20 Overs T20",
  dateString: "Sunday, 24 Nov 2026",
  timeString: "07:30 AM IST",
  venue: "Kavach Arena Ground 1",
  venueDirectionsUrl: "https://maps.google.com",
  countdown: "3d 14h remaining",
  squadAnnounced: true,
  squadCount: 14,
  matchFee: 500
};

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
  { id: "notif-2", title: "Payment Receipt Generated", message: "Receipt #KAV-982 for ₹500 has been verified.", time: "1d ago", read: true },
  { id: "notif-3", title: "Studio Nets Booking", message: "Your nets session is confirmed for Thursday at 6:00 PM.", time: "2d ago", read: true }
];

export default function PlayerHomePrototype() {
  // Device Frame Toggle: 'responsive' | 'mobile' | 'desktop'
  const [deviceFrame, setDeviceFrame] = useState<"responsive" | "mobile" | "desktop">("responsive");
  
  // Interactive Journey States
  const [activeTab, setActiveTab] = useState<"home" | "matches" | "payments" | "performance" | "club">("home");
  const [rsvpStatus, setRsvpStatus] = useState<"available" | "tentative" | "unavailable" | null>("available");
  const [rsvpNote, setRsvpNote] = useState<string>("Ready to bat top order");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [duesState, setDuesState] = useState(MOCK_CURRENT_PLAYER.dues);
  const [posts, setPosts] = useState(MOCK_FEED_POSTS);

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
          <span className="font-semibold text-gray-200">Phase 4 Stage 1: Player Navigation & Home Blueprint</span>
        </div>

        {/* Viewport Frame Mode Controls */}
        <div className="flex items-center gap-1.5 bg-gray-800 p-1 rounded-lg">
          <button
            onClick={() => setDeviceFrame("responsive")}
            className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition ${
              deviceFrame === "responsive" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            Responsive (Fluid)
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
            {activeTab === "home" && (
              <div className="space-y-6">
                
                {/* HERO UNIT: NEXT MATCH COUNTDOWN & 1-TAP RSVP */}
                <section className="bg-white rounded-2xl border border-[#E5E7EB] shadow-xs overflow-hidden">
                  {/* Card Header Strip */}
                  <div className="bg-gradient-to-r from-[#A30F2D] to-[#D51F43] px-4 py-2.5 text-white flex items-center justify-between text-xs">
                    <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                      <Trophy className="w-3.5 h-3.5 text-amber-300" />
                      Next Fixture • {MOCK_NEXT_MATCH.format}
                    </span>
                    <span className="bg-white/20 px-2 py-0.5 rounded-full font-semibold text-[10px] tracking-wide">
                      {MOCK_NEXT_MATCH.countdown}
                    </span>
                  </div>

                  {/* Fixture Details */}
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100">
                      <div>
                        <h2 className="text-lg sm:text-xl font-black text-[#171C26] tracking-tight">
                          {MOCK_NEXT_MATCH.title}
                        </h2>
                        <div className="mt-2 flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-[#667085]">
                          <span className="flex items-center gap-1 font-medium">
                            <Calendar className="w-3.5 h-3.5 text-[#D51F43]" />
                            {MOCK_NEXT_MATCH.dateString}
                          </span>
                          <span className="flex items-center gap-1 font-medium">
                            <Clock className="w-3.5 h-3.5 text-[#D51F43]" />
                            {MOCK_NEXT_MATCH.timeString}
                          </span>
                          <a
                            href={MOCK_NEXT_MATCH.venueDirectionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[#D51F43] font-semibold hover:underline"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            {MOCK_NEXT_MATCH.venue}
                          </a>
                        </div>
                      </div>

                      {/* Squad Announcement Chip */}
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
                        {/* Option: Available */}
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

                        {/* Option: Tentative */}
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

                        {/* Option: Unavailable */}
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

                      {/* Optional Note Field */}
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
                          {duesState.breakdown.length} pending obligations • Includes match fee & studio pass
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
                      {/* Post Header */}
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

                      {/* Post Body */}
                      <p className="text-xs sm:text-sm text-[#171C26] leading-relaxed pt-3">
                        {post.content}
                      </p>

                      {/* Post Footer Actions */}
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

            {/* TAB PLACEHOLDERS FOR BREADTH DEMO */}
            {activeTab !== "home" && (
              <div className="bg-white rounded-2xl border border-[#E5E7EB] p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center mx-auto">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-base font-black uppercase text-[#171C26]">
                  {activeTab} Screen
                </h3>
                <p className="text-xs text-[#667085] max-w-sm mx-auto">
                  Stage 1 establishes the primary Player Navigation & Home feed. Stages 2–5 will demonstrate full high-fidelity workflows for {activeTab}.
                </p>
                <button
                  onClick={() => setActiveTab("home")}
                  className="min-h-[44px] px-4 py-2 bg-[#D51F43] text-white text-xs font-bold rounded-xl"
                >
                  Return to Player Home
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
            {/* Home */}
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

            {/* Matches */}
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

            {/* Payments */}
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

            {/* Performance */}
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

            {/* Club */}
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

          {/* SLIDE-OVER NOTIFICATIONS DRAWER */}
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
                    {duesState.breakdown.map(item => (
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
