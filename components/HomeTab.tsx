/**
 * Social Dashboard / Club Feed (`components/HomeTab.tsx`)
 *
 * Provides the main "Home" experience for the application. It aggregates a feed of
 * user posts, system announcements (like birthdays), and general club news. Allows
 * creating, editing, deleting, and commenting on posts. Additionally, it calculates
 * and prominently displays upcoming player birthdays based on stored dates.
 */
import { useState, useMemo, useEffect } from "react";
import { useStore } from "@/hooks/useStore";
import { Post, Player } from "@/lib/types";
import { normalizeIndianMobile } from "@/lib/utils";
import { resolveMyPlayers } from "@/lib/player-identity";
import { calculatePlayerDues } from "@/lib/player-dues";
import {
  MessageSquare,
  MapPin,
  Clock,
  Image as ImageIcon,
  Send,
  Cake,
  Trash2,
  Edit,
  Calendar,
  ChevronRight,
  ChevronDown,
  X,
  PieChart,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CreditCard,
  ArrowRight,
  Trophy,
  Archive,
  Shirt,
  Circle,
} from "lucide-react";
import { format, isToday, isWithinInterval, addDays, parseISO } from "date-fns";
import { motion } from "motion/react";
import { isMatchBillable } from "@/lib/matchBillable";
import { PlayerFinanceView } from "./FinanceTab";
import { PollInteraction, PollResults } from "./OpinionTab";
import {
  IndependenceDayBanner,
  isIndependenceDayWindow,
} from "./festive/IndependenceDay";
import { db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function HomeTab({
  store,
  isAdmin,
  currentUserId,
  currentUserName,
  onNavigateToMatch,
  onNavigateToPayments,
}: {
  store: ReturnType<typeof useStore>;
  isAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
  onNavigateToMatch?: (matchId: string) => void;
  onNavigateToPayments?: () => void;
}) {
  const { toast } = useToast();
  const { confirm: confirmAction } = useConfirm();
  const [newPostText, setNewPostText] = useState("");
  const [isAddingPost, setIsAddingPost] = useState(false);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostText, setEditPostText] = useState("");
  const [commentText, setCommentText] = useState<{ [postId: string]: string }>(
    {},
  );
  const [isPulseExpanded, setIsPulseExpanded] = useState(false);

  const { posts, players, addPost, updatePost, deletePost, addComment } = store;

  // Compute upcoming birthdays
  const { upcomingBirthdays, todayBirthdays } = useMemo(() => {
    const today = new Date();
    const nextWeek = addDays(today, 7);
    const todayStr = format(today, "MM-dd");

    let upcoming: Player[] = [];
    let todayBdays: Player[] = [];

    players.forEach((p) => {
      if (!p.dob) return;
      try {
        const dobDate = new Date(p.dob);
        const dobMonthDay = format(dobDate, "MM-dd");

        if (dobMonthDay === todayStr) {
          todayBdays.push(p);
        } else {
          // Check if upcoming in next 7 days
          // We need to set the year of dob to current year and see if it's within interval
          const currentYearBday = new Date(
            today.getFullYear(),
            dobDate.getMonth(),
            dobDate.getDate(),
          );
          if (
            isWithinInterval(currentYearBday, { start: today, end: nextWeek })
          ) {
            upcoming.push(p);
          } else {
            // Also check next year (if we are in late Dec and bday is early Jan)
            const nextYearBday = new Date(
              today.getFullYear() + 1,
              dobDate.getMonth(),
              dobDate.getDate(),
            );
            if (
              isWithinInterval(nextYearBday, { start: today, end: nextWeek })
            ) {
              upcoming.push(p);
            }
          }
        }
      } catch (e) {
        // ignore invalid dates
      }
    });

    // sort upcoming
    upcoming.sort((a, b) => {
      const aDate = new Date(a.dob!);
      const bDate = new Date(b.dob!);
      return (
        aDate.getMonth() - bDate.getMonth() || aDate.getDate() - bDate.getDate()
      );
    });

    return { upcomingBirthdays: upcoming, todayBirthdays: todayBdays };
  }, [players]);

  const systemDateSeconds = useMemo(
    () => new Date().setHours(10, 0, 0, 0) / 1000,
    [],
  );

  // Inject birthday posts
  const renderedPosts = useMemo(() => {
    let finalPosts = [...posts];

    // For each birthday today, if there isn't already a post today, inject one
    // Actually, it's easier to just push purely synthetic posts for today
    todayBirthdays.forEach((p) => {
      finalPosts.push({
        id: `birthday-${p.id}`,
        text: `🎉 Happy Birthday to ${p.name}! Wishing you a fantastic day ahead! 🎂`,
        comments: [],
        isSystem: true,
        createdAt: { seconds: systemDateSeconds }, // Fixed value for the day
      });
    });

    return finalPosts.sort((a, b) => {
      const dateA = a.createdAt?.seconds || 0;
      const dateB = b.createdAt?.seconds || 0;
      return dateB - dateA;
    });
  }, [posts, todayBirthdays, systemDateSeconds]);

  const handleCreatePost = async () => {
    if (!newPostText.trim()) return;
    await addPost({
      text: newPostText,
      authorName: currentUserName,
      authorId: currentUserId,
    });
    setNewPostText("");
    setIsAddingPost(false);
  };

  const handleAddComment = async (postId: string) => {
    const text = commentText[postId];
    if (!text?.trim()) return;
    await addComment(postId, currentUserId, currentUserName, text);
    setCommentText((prev) => ({ ...prev, [postId]: "" }));
  };

  const appUser = store.appUsers.find((u) => u.id === currentUserId);
  const myPlayers = useMemo(
    () => resolveMyPlayers(store.players, currentUserId, appUser),
    [store.players, currentUserId, appUser],
  );
  
  const mePlayer = myPlayers[0] || null;

  const duesSummary = useMemo(
    () => calculatePlayerDues(myPlayers, store.payments, store.matches, store.otherFees),
    [myPlayers, store.payments, store.matches, store.otherFees],
  );
  const hasDues = duesSummary.hasDues;
  const { totalDue, dueCount } = duesSummary;
  const upcomingMatches = useMemo(() => {
    if (!mePlayer) return [];
    return store.matches
      .filter((m) => {
        if (m.isTentative) return false;
        let matchDateObj = new Date(m.date);
        if (m.time) {
          const [hours, minutes] = m.time.split(":");
          if (hours && minutes) {
             matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
          }
        } else {
             // Default to end of day if no time specified, to not hide it prematurely
             matchDateObj.setHours(23, 59, 59, 999);
        }
        
        const isPast =
          matchDateObj.getTime() < new Date().getTime() ||
          (m.result && m.result !== "Pending");
        return !isPast;
      })
      .sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );
  }, [store.matches, mePlayer]);

  const activeMatchAlerts = useMemo(() => {
    if (!mePlayer) return [];
    const now = new Date().getTime();
    
    return store.matches.filter(m => {
        if (m.isTentative) return false;
        const myPay = store.payments.find(p => p.playerId === mePlayer.id && p.matchId === m.id);
        const isPlaying = myPay && myPay.status !== "Not Playing" && (myPay.availability === "Confirmed" || myPay.availability === "Yes");
        if (!isPlaying) return false;
        
        let matchDateObj = new Date(m.date);
        if (m.time) {
          const [hours, minutes] = m.time.split(":");
          if (hours && minutes) {
             matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
          }
        } else {
             matchDateObj.setHours(23, 59, 59, 999);
        }
        
        const msDiff = matchDateObj.getTime() - now;
        const hoursBefore = store.appConfig?.matchConfiguration?.directionsHoursBefore ?? 18;
        const hoursAfter = store.appConfig?.matchConfiguration?.directionsHoursAfter ?? 2;
        const msBefore = hoursBefore * 3600000;
        const msAfter = -hoursAfter * 3600000;
        
        return msDiff <= msBefore && msDiff > msAfter && (!m.result || m.result === "Pending");
    }).sort((a, b) => {
        let aDate = new Date(a.date);
        let bDate = new Date(b.date);
        if (a.time) {
          const [h,m] = a.time.split(":");
          aDate.setHours(parseInt(h), parseInt(m), 0, 0);
        }
        if (b.time) {
          const [h,m] = b.time.split(":");
          bDate.setHours(parseInt(h), parseInt(m), 0, 0);
        }
        return aDate.getTime() - bDate.getTime();
    }).map(m => {
        let matchDateObj = new Date(m.date);
        if (m.time) {
          const [hours, minutes] = m.time.split(":");
          matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
        }
        const msDiff = matchDateObj.getTime() - now;
        // if diff is negative, it already started
        const isStarted = msDiff < 0;
        let diffStr = "";
        if (!isStarted) {
            const h = Math.floor(msDiff / 3600000);
            const r = msDiff % 3600000;
            const min = Math.floor(r / 60000);
            if (h > 0) diffStr = `${h}h ${min}m`;
            else diffStr = `${min}m`;
        }
        return { match: m, isStarted, diffStr };
    });
  }, [store.matches, store.payments, mePlayer]);

  const hasAlerts = !isAdmin && activeMatchAlerts.length > 0;
  const hasMatches = !isAdmin && mePlayer && upcomingMatches.length > 0;
  const hasTodayBdays = todayBirthdays.length > 0;
  const hasUpcomingBdays = upcomingBirthdays.length > 0;
  const hasBirthdays = hasTodayBdays || hasUpcomingBdays;

  const heroMatch = upcomingMatches[0] || null;
  const otherUpcomingMatches = upcomingMatches.slice(1);
  const heroGround = heroMatch ? store.grounds.find((g) => g.id === heroMatch.groundId) : null;
  const heroPayment = heroMatch && mePlayer ? store.payments.find((p) => p.playerId === mePlayer.id && p.matchId === heroMatch.id) : null;

  let heroEffectiveAvailability = heroPayment?.availability;
  if ((!heroEffectiveAvailability || heroEffectiveAvailability === "Pending") && heroPayment && heroPayment.status !== "Not Playing") {
    heroEffectiveAvailability = "Confirmed";
  }
  const heroIsPlaying = heroEffectiveAvailability === "Confirmed" || heroEffectiveAvailability === "Yes";
  const heroIsTentative = heroEffectiveAvailability === "Tentative";
  const heroIsOut = heroEffectiveAvailability === "No";

  const [showRsvpNote, setShowRsvpNote] = useState(false);
  const [rsvpNote, setRsvpNote] = useState("");

  useEffect(() => {
    if (heroPayment?.tacticalNote) {
      setRsvpNote(heroPayment.tacticalNote);
    }
  }, [heroPayment?.tacticalNote]);

  const getCountdownString = (matchDateStr: string, matchTimeStr?: string) => {
    const matchDateObj = new Date(matchDateStr);
    if (matchTimeStr) {
      const [hours, minutes] = matchTimeStr.split(":");
      if (hours && minutes) {
        matchDateObj.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      }
    } else {
      matchDateObj.setHours(9, 0, 0, 0);
    }
    const msDiff = matchDateObj.getTime() - Date.now();
    if (msDiff < 0) return "Match Day / In Progress";
    const days = Math.floor(msDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((msDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    if (days > 0) return `Starts in ${days}d ${hours}h`;
    const mins = Math.floor((msDiff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `Starts in ${hours}h ${mins}m`;
    return `Starts in ${mins}m`;
  };

  const heroCountdown = heroMatch ? getCountdownString(heroMatch.date, heroMatch.time) : "";

  const handleRsvp = async (matchId: string, availability: "Confirmed" | "Tentative" | "No", note?: string) => {
    if (!mePlayer) return;
    const payment = store.payments.find((p) => p.playerId === mePlayer.id && p.matchId === matchId);
    try {
      if (payment) {
        await store.updateMatchAvailability(payment.id, availability, matchId, note);
        if (availability === "Confirmed" && payment.status === "Not Playing") {
          await store.updatePaymentStatus(payment.id, "Unpaid", matchId);
        } else if ((availability === "No" || availability === "Tentative") && payment.status === "Unpaid") {
          await store.updatePaymentStatus(payment.id, "Not Playing", matchId);
        }
      } else {
        await store.addPaymentWithAvailability(matchId, mePlayer.id, availability, note);
      }
      toast(`Availability updated to ${availability === "Confirmed" ? "Playing" : availability}`, "success");
    } catch (e) {
      console.error("Failed to update availability:", e);
      toast("Failed to update availability", "error");
    }
  };

  const [showProfilePrompt, setShowProfilePrompt] = useState(false);
  const [profileFormData, setProfileFormData] = useState({
    email: "",
    dob: "",
    chestSize: "",
    jerseyNumber: "",
  });

  useEffect(() => {
    if (mePlayer && !isAdmin) {
      if (!mePlayer.email || !mePlayer.dob || !mePlayer.chestSize || !mePlayer.jerseyNumber) {
        setProfileFormData({
           email: mePlayer.email || appUser?.email || "",
           dob: mePlayer.dob || "",
           chestSize: mePlayer.chestSize || "",
           jerseyNumber: mePlayer.jerseyNumber || "",
        });
        const hasDismissed = localStorage.getItem(`profilePromptDismissed_${mePlayer.id}`);
        if (!hasDismissed) {
          setShowProfilePrompt(true);
        }
      }
    }
  }, [mePlayer, isAdmin, appUser]);

  return (
    <div className="p-4 max-w-6xl mx-auto w-full pb-24 flex flex-col gap-6 items-center">
      <div className="w-full max-w-7xl grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-max items-start">
        {/* Independence Day greeting — date-gated (13–16 Aug), dismissible */}
        {isIndependenceDayWindow() && (
          <IndependenceDayBanner clubName={store.appConfig?.clubName} />
        )}

        {/* KAvach Identity Card */}
        {mePlayer?.kavachId && (
          <div className="md:col-span-12 flex items-center gap-3 bg-surface rounded-xl px-4 py-2.5 border border-border">
            <div className="w-8 h-8 rounded-full bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center shrink-0">
              <span className="text-yellow-400 font-black text-[10px]">K</span>
            </div>
            <div className="min-w-0">
              <p className="text-text-primary font-bold text-sm truncate">{mePlayer.name}</p>
              <p className="text-yellow-400 font-mono text-xs font-bold tracking-wider">{mePlayer.kavachId}</p>
            </div>
          </div>
        )}

        {/* Match Day Alert (Feed Popup) - High Priority Full Width */}
        {hasAlerts && (
          <div className="md:col-span-12 flex flex-col gap-4">
          {activeMatchAlerts.map(({ match, isStarted, diffStr }) => {
            const ground = store.grounds.find((g) => g.id === match.groundId);
            const groundName = ground?.name || 'Unknown Ground';
            const mapUrl = ground?.mapUrl || "";
            return (
              <div 
                key={`alert-${match.id}`} 
                className="bg-surface rounded-2xl p-5 border-l-4 border-l-emerald-500 relative overflow-hidden bg-gradient-to-br from-emerald-500/10 to-transparent shadow-lg"
              >
                <div className="absolute -top-4 -right-4 p-3 opacity-10">
                  <Clock className="w-24 h-24 text-emerald-400" />
                </div>
                <div className="relative z-10">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className="inline-block px-3 py-1 bg-emerald-500/20 text-emerald-400 text-xs font-black uppercase tracking-widest rounded-full">
                      Match Day
                    </span>
                    {match.jerseyColor === "Scarlet Red" && (
                       <div className="flex items-center gap-1.5 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-xs font-bold text-red-400">
                          <Shirt className="w-3.5 h-3.5 fill-red-500 text-red-500" />
                          <span>Red Jersey</span>
                          <span className="text-text-primary/20 mx-0.5">•</span>
                          <Circle className="w-3 h-3 fill-white text-text-primary" />
                          <span className="text-text-primary">White Ball</span>
                       </div>
                    )}
                    {match.jerseyColor === "Whites" && (
                       <div className="flex items-center gap-1.5 px-3 py-1 bg-surface-hover border border-border rounded-full text-xs font-bold text-text-primary">
                          <Shirt className="w-3.5 h-3.5 fill-white text-text-primary" />
                          <span>White Jersey</span>
                          <span className="text-text-primary/20 mx-0.5">•</span>
                          <Circle className="w-3 h-3 fill-red-600 text-red-600" />
                          <span className="text-red-400">Red Ball</span>
                       </div>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-text-primary mb-1">
                    {isStarted ? "Match has started!" : `You are playing in ${diffStr}`}
                  </h2>
                  <p className="text-sm text-text-secondary mb-4 font-medium">
                    vs {match.opponent} • {groundName} • {match.time ? format(parseISO(`${match.date}T${match.time}`), "h:mm a") : "Time TBD"}
                  </p>
                  
                  <a 
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-full sm:w-auto items-center justify-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 py-2.5 px-4 rounded-xl transition text-sm font-bold border border-emerald-500/30"
                  >
                    <MapPin className="w-4 h-4" />
                    Get Directions to {groundName}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Hero Next Match (MOD-02A & MOD-02B) */}
      {!isAdmin && heroMatch && (
        <section
          data-testid={`match-card-${heroMatch.id}`}
          className="md:col-span-12 bg-surface rounded-2xl border border-border shadow-xs overflow-hidden"
        >
          <div className="bg-gradient-to-r from-brand to-accent px-4 py-2.5 text-white flex items-center justify-between text-xs">
            <span className="font-bold uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-300" />
              Next Fixture • {heroMatch.format} {heroMatch.matchType}
            </span>
            <span className="bg-white/20 px-2 py-0.5 rounded-full font-semibold text-[10px] tracking-wide">
              {heroCountdown}
            </span>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  {heroMatch.jerseyColor === "Scarlet Red" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] font-bold text-red-500">
                      <Shirt className="w-3 h-3 fill-red-500" /> Scarlet Jersey • White Ball
                    </span>
                  )}
                  {heroMatch.jerseyColor === "Whites" && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-hover border border-border rounded text-[10px] font-bold text-text-primary">
                      <Shirt className="w-3 h-3 fill-white" /> White Jersey • Red Ball
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-text-primary tracking-tight">
                  vs {heroMatch.opponent}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1 font-medium">
                    <Calendar className="w-3.5 h-3.5 text-accent" />
                    {format(new Date(heroMatch.date), "EEE, MMM do, yyyy")}
                  </span>
                  <span className="flex items-center gap-1 font-medium">
                    <Clock className="w-3.5 h-3.5 text-accent" />
                    {heroMatch.time ? format(parseISO(`${heroMatch.date}T${heroMatch.time}`), "h:mm a") : "Time TBD"}
                  </span>
                  {heroGround && (
                    <a
                      href={heroGround.mapUrl || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] min-w-[44px] inline-flex items-center gap-1 text-accent font-semibold hover:underline px-1"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      {heroGround.name}
                    </a>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:items-end gap-2">
                {heroIsPlaying ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold self-start sm:self-auto">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>You are in Playing XI!</span>
                  </div>
                ) : heroIsTentative ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold self-start sm:self-auto">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <span>RSVP Tentative</span>
                  </div>
                ) : heroIsOut ? (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold self-start sm:self-auto">
                    <XCircle className="w-4 h-4 text-rose-600" />
                    <span>Unavailable</span>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-hover border border-border text-text-muted text-xs font-bold self-start sm:self-auto">
                    <AlertCircle className="w-4 h-4 text-accent" />
                    <span>RSVP Needed</span>
                  </div>
                )}

                <button
                  data-testid="view-details-link"
                  onClick={() => onNavigateToMatch?.(heroMatch.id)}
                  className="min-h-[44px] px-2 py-1 text-xs font-bold text-accent hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>View Match Details</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 1-Tap RSVP (MOD-02B) */}
            <div className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-black uppercase tracking-wider text-text-secondary">
                  Confirm Your Availability
                </label>
                <button
                  type="button"
                  aria-expanded={showRsvpNote}
                  onClick={() => setShowRsvpNote(!showRsvpNote)}
                  className="min-h-[44px] px-2 py-1 flex items-center text-xs font-semibold text-accent hover:underline cursor-pointer"
                >
                  {showRsvpNote ? "Hide Note" : "+ Add Note for Captain"}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  aria-pressed={heroIsPlaying}
                  aria-label="Confirm attendance as Playing"
                  onClick={() => handleRsvp(heroMatch.id, "Confirmed", rsvpNote)}
                  className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    heroIsPlaying
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                      : "bg-emerald-50/60 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                  }`}
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Playing</span>
                </button>

                <button
                  type="button"
                  aria-pressed={heroIsTentative}
                  aria-label="Set attendance as Tentative"
                  onClick={() => handleRsvp(heroMatch.id, "Tentative", rsvpNote)}
                  className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    heroIsTentative
                      ? "bg-amber-600 text-white border-amber-600 shadow-sm"
                      : "bg-amber-50/60 text-amber-800 border-amber-200 hover:bg-amber-100"
                  }`}
                >
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>Tentative</span>
                </button>

                <button
                  type="button"
                  aria-pressed={heroIsOut}
                  aria-label="Set attendance as Out / Unavailable"
                  onClick={() => handleRsvp(heroMatch.id, "No", rsvpNote)}
                  className={`min-h-[48px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                    heroIsOut
                      ? "bg-rose-600 text-white border-rose-600 shadow-sm"
                      : "bg-rose-50/60 text-rose-800 border-rose-200 hover:bg-rose-100"
                  }`}
                >
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>Out</span>
                </button>
              </div>

              {showRsvpNote && (
                <div className="mt-2.5 flex items-center gap-2">
                  <input
                    type="text"
                    value={rsvpNote}
                    onChange={(e) => setRsvpNote(e.target.value)}
                    placeholder="e.g. Arriving 15m early / bat top order..."
                    aria-label="Tactical note for captain"
                    className="flex-1 min-h-[44px] text-xs px-3 py-2 rounded-lg border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                  />
                  <button
                    type="button"
                    aria-label="Save tactical note for captain"
                    onClick={() => {
                      const currentAvail = heroIsPlaying ? "Confirmed" : heroIsTentative ? "Tentative" : heroIsOut ? "No" : "Confirmed";
                      handleRsvp(heroMatch.id, currentAvail, rsvpNote);
                    }}
                    className="min-h-[44px] px-4 py-2 bg-accent text-text-accent text-xs font-bold rounded-lg hover:opacity-90 transition cursor-pointer shrink-0"
                  >
                    Save Note
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Dues Summary Alert Card */}
      {!isAdmin && mePlayer && (
        <div className="md:col-span-12">
          {totalDue > 0 ? (
            <section className="bg-gradient-to-br from-brand-surface to-surface rounded-2xl border border-accent/20 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-accent text-text-accent flex items-center justify-center shrink-0 shadow-sm">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-brand uppercase tracking-wider">
                      Outstanding Club Dues
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-accent text-text-accent">
                      Due Now
                    </span>
                  </div>
                  <div className="text-2xl font-black text-text-primary mt-0.5">
                    ₹{totalDue.toLocaleString("en-IN")}
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {dueCount} pending obligation{dueCount !== 1 ? "s" : ""} • Includes match fee & studio dues
                  </p>
                </div>
              </div>

              <button
                type="button"
                aria-label="Pay outstanding club dues"
                onClick={() => onNavigateToPayments?.()}
                className="min-h-[44px] w-full sm:w-auto px-5 py-2.5 bg-accent hover:bg-brand text-text-accent font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Pay Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </section>
          ) : (
            <section className="bg-emerald-50/60 rounded-2xl border border-emerald-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-xs text-emerald-800 font-bold">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>All club dues settled! Good standing for upcoming matches.</span>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Additional Upcoming Matches (if more than 1 scheduled) */}
      {!isAdmin && otherUpcomingMatches.length > 0 && (
        <div className="md:col-span-12 bg-surface rounded-2xl border border-border p-4 relative overflow-hidden">
          <div className="flex justify-between items-center mb-3 px-2">
            <h3 className="text-sm font-bold text-accent uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-4 h-4" /> More Upcoming Fixtures
            </h3>
            {otherUpcomingMatches.length > 1 && (
              <div className="text-[10px] uppercase font-bold text-text-muted flex items-center">
                Swipe <ChevronRight className="w-3 h-3 ml-0.5" />
              </div>
            )}
          </div>
          <div className="relative">
            <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 px-2 no-scrollbar scroll-smooth">
              {otherUpcomingMatches.map((match) => {
                const myPayment = store.payments.find(
                  (p) => p.playerId === mePlayer?.id && p.matchId === match.id
                );
                const ground = store.grounds.find((g) => g.id === match.groundId);

                return (
                  <div
                    key={match.id}
                    data-testid={`match-card-${match.id}`}
                    className="snap-start min-w-[280px] w-[80vw] sm:w-[320px] bg-surface-hover border border-border rounded-xl p-4 shrink-0 flex flex-col justify-between shadow-xs cursor-pointer hover:bg-surface-hover transition"
                    onClick={() => onNavigateToMatch?.(match.id)}
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-brand-surface text-brand">
                          {match.format}
                        </span>
                        <span className="text-xs text-text-secondary font-medium">
                          {format(new Date(match.date), "MMM do, yyyy")}
                        </span>
                      </div>
                      <h4 className="font-bold text-base text-text-primary mb-1 truncate">
                        vs {match.opponent}
                      </h4>
                      <p className="text-xs text-accent font-medium mb-3">
                        {match.matchType} • {ground?.name || "Ground TBD"}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/50 text-xs font-bold text-accent">
                      <span>View Details</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Catch Stats Cards */}
      {mePlayer && ((mePlayer.stunningCatches ?? 0) > 0 || (mePlayer.droppedCatches ?? 0) > 0) && (
        <div className="md:col-span-12 lg:col-span-12">
          <div className="grid grid-cols-2 gap-3">
            {(mePlayer.stunningCatches ?? 0) > 0 && (
              <div className="bg-surface rounded-2xl p-4 border border-emerald-500/30 bg-emerald-500/5 flex items-center gap-3">
                <span className="text-3xl">🧤</span>
                <div>
                  <p className="text-2xl font-black text-emerald-400">{mePlayer.stunningCatches}</p>
                  <p className="text-[10px] text-emerald-300/70 font-bold uppercase tracking-wider">Stunning Catches</p>
                </div>
              </div>
            )}
            {(mePlayer.droppedCatches ?? 0) > 0 && (
              <div className="bg-surface rounded-2xl p-4 border border-red-500/30 bg-red-500/5 flex items-center gap-3">
                <span className="text-3xl">🫳</span>
                <div>
                  <p className="text-2xl font-black text-red-400">{mePlayer.droppedCatches}</p>
                  <p className="text-[10px] text-red-300/70 font-bold uppercase tracking-wider">Dropped Catches</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Feed Column (Left) */}
      <div className={`md:col-span-12 ${hasBirthdays ? 'lg:col-span-8' : 'lg:col-span-12'} lg:col-start-1 flex flex-col gap-6`}>
        {/* Admin Add Post Form */}
        {isAdmin && (
          <div className="bg-surface rounded-2xl p-4 border border-border flex flex-col gap-3">
          {isAddingPost ? (
            <div className="flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200">
              <textarea
                className="w-full bg-surface-hover border border-border rounded-xl p-3 text-sm text-text-primary focus:outline-none focus:border-accent resize-none placeholder:text-text-primary/30"
                rows={3}
                placeholder="What's happening in the club?"
                value={newPostText}
                onChange={(e) => setNewPostText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAddingPost(false)}
                  className="px-4 py-2 text-xs font-bold text-text-muted hover:text-text-primary uppercase tracking-wider transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePost}
                  disabled={!newPostText.trim()}
                  className="px-4 py-2 text-xs font-bold bg-accent text-text-accent rounded-xl uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition cursor-pointer flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" /> Post
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingPost(true)}
              className="w-full bg-surface-hover hover:bg-surface-hover border border-transparent hover:border-border text-left p-4 rounded-xl text-text-muted transition flex items-center gap-3 cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                <Edit className="w-4 h-4 text-accent" />
              </div>
              <span className="text-sm">Write a new post...</span>
            </button>
          )}
        </div>
      )}

      {/* Sticked Polls Section */}
      {store.polls?.filter((p: any) => {
        if (!p.isSticked || !p.isActive) return false;
        const myResponse = store.pollResponses?.find((r: any) => r.pollId === p.id && r.playerId === currentUserId);
        if (!myResponse) return true;
        if (myResponse.isArchived) return false;
        const createdAtMs = myResponse.createdAt?.toMillis ? myResponse.createdAt.toMillis() : (myResponse.createdAt?.seconds ? myResponse.createdAt.seconds * 1000 : Date.now());
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        return Date.now() - createdAtMs < ONE_DAY_MS;
      }).length > 0 && (
        <div className="space-y-3">
          <button 
            onClick={() => setIsPulseExpanded(!isPulseExpanded)}
            className="w-full text-sm font-bold text-text-primary tracking-widest uppercase flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2"><PieChart className="w-4 h-4 text-accent" /> Pulse</span>
            {isPulseExpanded ? <ChevronDown className="w-4 h-4 text-text-muted" /> : <ChevronRight className="w-4 h-4 text-text-muted" />}
          </button>
          {isPulseExpanded && (
            <div className="flex overflow-x-auto gap-4 pb-2 -mx-2 px-2 snap-x hide-scrollbar">
            {store.polls
              .filter((p: any) => {
                if (!p.isSticked || !p.isActive) return false;
                const myResponse = store.pollResponses?.find((r: any) => r.pollId === p.id && r.playerId === currentUserId);
                if (!myResponse) return true;
                if (myResponse.isArchived) return false;
                const createdAtMs = myResponse.createdAt?.toMillis ? myResponse.createdAt.toMillis() : (myResponse.createdAt?.seconds ? myResponse.createdAt.seconds * 1000 : Date.now());
                const ONE_DAY_MS = 24 * 60 * 60 * 1000;
                return Date.now() - createdAtMs < ONE_DAY_MS;
              })
              .map((poll: any) => {
                const myResponse = store.pollResponses?.find((r: any) => r.pollId === poll.id && r.playerId === currentUserId);
                const handleVote = async (val: any) => {
                  if (!currentUserId) return;
                  const responseId = poll.id + "_" + currentUserId;
                  try {
                    await setDoc(doc(db, "pollResponses", responseId), {
                      pollId: poll.id,
                      playerId: currentUserId,
                      response: val,
                      isArchived: false,
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                    });
                  } catch (err: any) {
                    toast("Error voting: " + err.message, "error");
                  }
                };

                const handleArchive = async () => {
                  if (!myResponse) return;
                  try {
                    await updateDoc(doc(db, "pollResponses", myResponse.id), {
                      isArchived: true,
                      updatedAt: serverTimestamp(),
                    });
                  } catch (err: any) {
                    toast("Error archiving: " + err.message, "error");
                  }
                };

                return (
                  <div key={poll.id} className="min-w-[280px] max-w-[320px] snap-center bg-surface rounded-2xl p-5 border border-border relative shrink-0">
                    <div className="absolute top-0 right-0 bg-accent text-text-accent text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-bl-xl">
                      Sticked
                    </div>
                    {poll.isEdited && (
                      <div className="absolute top-0 left-0 bg-surface-hover text-text-primary text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-br-xl">
                        Edited
                      </div>
                    )}
                    <h3 className={`text-sm font-bold text-text-primary pr-12 leading-tight ${poll.isEdited ? 'mt-3' : 'mb-4'}`}>
                      {poll.title}
                    </h3>
                    
                    {myResponse ? (
                      <div className="space-y-4">
                        <PollResults poll={poll} store={store} />
                        <button onClick={handleArchive} className="w-full py-2 bg-surface-hover hover:bg-surface-hover rounded-xl text-xs font-bold text-text-muted hover:text-text-primary transition flex items-center justify-center gap-2">
                          <Archive className="w-4 h-4" /> Archive to Profile
                        </button>
                      </div>
                    ) : (
                      <PollInteraction poll={poll} onVote={handleVote} />
                    )}
                  </div>
                );
              })}
          </div>
          )}
        </div>
      )}

      {/* Feed */}
      <div className="flex flex-col gap-4">
        {renderedPosts.length === 0 ? (
          <div className="text-center text-text-muted py-8 text-sm bg-surface rounded-2xl">
            No posts yet. Wait for club updates!
          </div>
        ) : (
          renderedPosts.map((post) => (
            <div
              key={post.id}
              className={`bg-surface rounded-2xl border ${post.isSystem ? "border-accent/30" : "border-border"} overflow-hidden flex flex-col`}
            >
              {/* Post Header */}
              <div className="p-4 flex items-center justify-between border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-surface-hover flex items-center justify-center font-bold text-text-primary relative shrink-0">
                    {post.isSystem ? (
                      <Cake className="w-5 h-5 text-accent" />
                    ) : post.authorName ? (
                      post.authorName.charAt(0).toUpperCase()
                    ) : (
                      "A"
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-text-primary">
                      {post.isSystem
                        ? "KAvach (Official)"
                        : post.authorName || "Admin"}
                    </p>
                    {post.createdAt && (
                      <p className="text-[10px] text-text-muted">
                        {format(
                          new Date(post.createdAt.seconds * 1000),
                          "MMM d, yyyy • h:mm a",
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {isAdmin && !post.isSystem && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => {
                        setEditingPostId(post.id);
                        setEditPostText(post.text);
                      }}
                      className="p-2 text-text-muted hover:text-accent hover:bg-surface-hover rounded-lg transition"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={async () => {
                        if (await confirmAction({ message: "Delete this post?", destructive: true })) {
                          deletePost(post.id);
                        }
                      }}
                      className="p-2 text-text-muted hover:text-red-400 hover:bg-surface-hover rounded-lg transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Post Content */}
              <div className="p-4 flex flex-col gap-3">
                {editingPostId === post.id ? (
                  <div className="flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200">
                    <textarea
                      className="w-full bg-surface-hover border border-border rounded-xl p-3 text-sm text-text-primary focus:outline-none focus:border-accent resize-none placeholder:text-text-primary/30"
                      rows={3}
                      value={editPostText}
                      onChange={(e) => setEditPostText(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingPostId(null)}
                        className="px-4 py-2 text-xs font-bold text-text-muted hover:text-text-primary uppercase tracking-wider transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={async () => {
                          if (!editPostText.trim()) return;
                          await updatePost(post.id, editPostText);
                          setEditingPostId(null);
                        }}
                        disabled={!editPostText.trim()}
                        className="px-4 py-2 text-xs font-bold bg-accent text-text-accent rounded-xl uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {post.text && (
                      <p className="text-sm text-text-primary whitespace-pre-wrap">
                        {post.text}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Comments Section */}
              <div className="bg-surface-hover p-4 flex flex-col gap-3 border-t border-border">
                {post.comments?.length > 0 && (
                  <div className="flex flex-col gap-3 mb-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" /> Comments (
                      {post.comments.length})
                    </h4>
                    {post.comments.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col bg-surface-hover p-3 rounded-xl"
                      >
                        <div className="flex justify-between items-end mb-1">
                          <span className="font-semibold text-xs text-text-primary">
                            {c.userName}
                          </span>
                        </div>
                        <p className="text-xs text-text-secondary">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Comment Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Write a comment..."
                    className="flex-1 bg-surface-hover rounded-xl px-3 py-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
                    value={commentText[post.id] || ""}
                    onChange={(e) =>
                      setCommentText({
                        ...commentText,
                        [post.id]: e.target.value,
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddComment(post.id);
                    }}
                  />
                  <button
                    onClick={() => handleAddComment(post.id)}
                    disabled={!commentText[post.id]?.trim()}
                    className="p-2 bg-accent text-text-accent rounded-xl hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
        </div>
      </div>

      {/* Right Column for Sidebar Widgets */}
      {hasBirthdays && (
         <div className="md:col-span-12 lg:col-span-4 lg:col-start-9 flex flex-col gap-6">
            {/* Birthday Player of the Day */}
            {hasTodayBdays && (
              <div className="bg-surface rounded-2xl p-6 border-2 border-accent/40 relative overflow-hidden bg-gradient-to-br from-accent/10 to-transparent">
                <div className="absolute -top-4 -right-4 p-3 opacity-20">
                  <Cake className="w-24 h-24 text-accent" />
                </div>
                <h3 className="text-sm font-black text-accent uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <Cake className="w-4 h-4 animate-bounce" /> Birthday Player of the Day
                </h3>
                <div className="flex flex-col gap-3">
                  {todayBirthdays.map((p) => (
                    <div key={p.id} className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center font-bold text-accent text-xl shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-text-primary text-lg">{p.name}</div>
                        <div className="text-xs text-text-secondary">
                          Wishing you a fantastic day ahead! 🎉
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upcoming Birthdays Panel */}
            {hasUpcomingBdays && (
              <div className="bg-surface rounded-2xl p-4 border border-border relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                  <Cake className="w-12 h-12" />
                </div>
                <h3 className="text-sm font-bold text-accent uppercase tracking-widest mb-3 flex items-center gap-2">
                  <Cake className="w-4 h-4" /> Upcoming Birthdays
                </h3>
                <div className="flex flex-col gap-2">
                  {upcomingBirthdays.map((p) => (
                    <div
                      key={p.id}
                      className="flex justify-between items-center text-sm"
                    >
                      <span className="font-semibold text-text-primary">{p.name}</span>
                      <span className="text-text-secondary">
                        {p.dob ? format(new Date(p.dob), "MMM do") : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
         </div>
      )}

      </div>

      {showProfilePrompt && mePlayer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface rounded-xl p-6 w-full max-w-sm flex flex-col items-center">
            <h2 className="text-xl font-bold mb-2">Complete Profile</h2>
            <p className="text-sm text-text-secondary text-center mb-6">
              Please provide essential details to help us manage the team better.
            </p>
            <form
              className="w-full flex md:flex-col flex-col gap-4"
              onSubmit={async (e) => {
                e.preventDefault();
                await store.updatePlayer(mePlayer.id, {
                  email: profileFormData.email,
                  dob: profileFormData.dob,
                  chestSize: profileFormData.chestSize,
                  jerseyNumber: profileFormData.jerseyNumber,
                });
                setShowProfilePrompt(false);
              }}
            >
              <div>
                <label className="text-xs uppercase tracking-widest text-text-muted mb-1 block">Email</label>
                <input
                  type="email"
                  required
                  value={profileFormData.email}
                  onChange={(e) => setProfileFormData({ ...profileFormData, email: e.target.value })}
                  className="w-full bg-surface-hover border border-border rounded tracking-wider px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-text-muted mb-1 block">Date of Birth</label>
                <input
                  type="date"
                  required
                  value={profileFormData.dob}
                  onChange={(e) => setProfileFormData({ ...profileFormData, dob: e.target.value })}
                  className="w-full bg-surface-hover border border-border rounded tracking-wider px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-text-muted mb-1 block">Jersey Size</label>
                <select
                  required
                  value={profileFormData.chestSize}
                  onChange={(e) => setProfileFormData({ ...profileFormData, chestSize: e.target.value })}
                  className="w-full bg-surface-hover border border-border rounded tracking-wider px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent [&>option]:bg-surface font-mono"
                >
                  <option value="">Select Size</option>
                  {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-text-muted mb-1 block">Jersey Number</label>
                {isAdmin ? (
                  <input
                    type="text"
                    required
                    placeholder="e.g. 7 or 18"
                    value={profileFormData.jerseyNumber}
                    onChange={(e) => setProfileFormData({ ...profileFormData, jerseyNumber: e.target.value })}
                    className="w-full bg-surface-hover border border-border rounded tracking-wider px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent font-mono"
                  />
                ) : (
                  <input
                    type="text"
                    disabled
                    placeholder="Assigned by Admin"
                    value={profileFormData.jerseyNumber || ""}
                    className="w-full bg-surface-hover border border-border rounded tracking-wider px-3 py-2 text-sm text-text-muted focus:outline-none opacity-50 cursor-not-allowed font-mono"
                    title="Jersey number can only be assigned or edited by administrators."
                  />
                )}
              </div>
              
              <div className="flex gap-3 justify-end mt-4">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(`profilePromptDismissed_${mePlayer.id}`, "true");
                    setShowProfilePrompt(false);
                  }}
                  className="w-full py-2 bg-surface-hover text-text-secondary hover:text-text-primary rounded font-bold uppercase tracking-widest text-xs transition border border-border"
                >
                  Later
                </button>
                <button
                  type="submit"
                  className="w-full py-2 bg-accent text-text-accent rounded font-bold uppercase tracking-widest text-xs transition hover:bg-accent/90"
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
