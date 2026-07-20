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
  Archive,
  Shirt,
  Circle,
} from "lucide-react";
import { format, isToday, isWithinInterval, addDays, parseISO } from "date-fns";
import { motion } from "motion/react";
import { PlayerFinanceView } from "./FinanceTab";
import { PollInteraction, PollResults } from "./OpinionTab";
import { db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp, updateDoc } from "firebase/firestore";

export function HomeTab({
  store,
  isAdmin,
  currentUserId,
  currentUserName,
}: {
  store: ReturnType<typeof useStore>;
  isAdmin: boolean;
  currentUserId: string;
  currentUserName: string;
}) {
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
  const myPlayers = useMemo(() => store.players.filter(
    (p) =>
      p.id === currentUserId ||
      p.authUid === currentUserId ||
      (appUser?.mobile && p.mobile === appUser.mobile),
  ), [store.players, currentUserId, appUser?.mobile]);
  
  const mePlayer = myPlayers[0] || null;

  const hasDues = useMemo(() => {
    if (myPlayers.length === 0) return false;
    const myPayments = store.payments.filter(
      (p) =>
        myPlayers.some((mp) => mp.id === p.playerId) &&
        p.status === "Unpaid",
    );
    const otherFees = store.otherFees.filter((f) =>
      myPlayers.some((mp) => mp.id === f.playerId) && f.status === "Unpaid"
    );
    return myPayments.length > 0 || otherFees.length > 0;
  }, [store.payments, store.otherFees, myPlayers]);
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
        {/* Match Day Alert (Feed Popup) - High Priority Full Width */}
        {hasAlerts && (
          <div className="md:col-span-12 flex flex-col gap-4">
          {activeMatchAlerts.map(({ match, isStarted, diffStr }) => {
            const ground = store.grounds.find((g) => g.id === match.groundId);
            const groundName = ground?.name || 'Unknown Ground';
            const mapUrl = `/api/map-redirect?url=${encodeURIComponent(ground?.mapUrl || "")}&name=${encodeURIComponent(groundName)}`;
            return (
              <div 
                key={`alert-${match.id}`} 
                className="glass rounded-2xl p-5 border-l-4 border-l-emerald-500 relative overflow-hidden bg-gradient-to-br from-emerald-500/10 to-transparent shadow-lg"
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
                          <span className="text-white/20 mx-0.5">•</span>
                          <Circle className="w-3 h-3 fill-white text-white" />
                          <span className="text-white">White Ball</span>
                       </div>
                    )}
                    {match.jerseyColor === "Whites" && (
                       <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs font-bold text-white">
                          <Shirt className="w-3.5 h-3.5 fill-white text-white" />
                          <span>White Jersey</span>
                          <span className="text-white/20 mx-0.5">•</span>
                          <Circle className="w-3 h-3 fill-red-600 text-red-600" />
                          <span className="text-red-400">Red Ball</span>
                       </div>
                    )}
                  </div>
                  <h2 className="text-xl font-bold text-white mb-1">
                    {isStarted ? "Match has started!" : `You are playing in ${diffStr}`}
                  </h2>
                  <p className="text-sm text-white/70 mb-4 font-medium">
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

      {/* Upcoming Matches (Player View Only) */}
      {hasMatches && (
        <div className="md:col-span-12 lg:col-span-8 glass rounded-2xl border border-glass-border p-4 relative overflow-hidden h-full">
          <div className="flex justify-between items-center mb-3 px-2">
            <h3 className="text-sm font-bold text-accent uppercase tracking-widest flex items-center gap-2">
              <Calendar className="w-4 h-4" /> Upcoming Matches
            </h3>
            {upcomingMatches.length > 1 && (
              <motion.div
                animate={{ x: [0, 5, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                className="text-[10px] uppercase font-bold text-white/50 flex items-center"
              >
                Swipe <ChevronRight className="w-3 h-3 ml-0.5" />
              </motion.div>
            )}
          </div>
          <div className="relative">
            <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 px-2 no-scrollbar scroll-smooth">
              {upcomingMatches.map((match) => {
              const myPayment = store.payments.find(
                (p) => p.playerId === mePlayer.id && p.matchId === match.id
              );
              
              let effectiveAvailability = myPayment?.availability;
              if ((!effectiveAvailability || effectiveAvailability === "Pending") && myPayment && myPayment.status !== "Not Playing") {
                effectiveAvailability = "Confirmed";
              }

              const isConfirmed = effectiveAvailability === "Confirmed" || effectiveAvailability === "Yes";
              const isNo = effectiveAvailability === "No";
              const isTentative = effectiveAvailability === "Tentative";

              return (
                <div
                  key={match.id}
                  className="snap-start min-w-[280px] w-[80vw] sm:w-[320px] bg-white/5 border border-white/10 rounded-xl p-4 shrink-0 flex flex-col justify-between shadow-lg"
                >
                  <div>
                    <h4 className="font-bold text-lg text-white mb-1 truncate">
                      vs {match.opponent}
                    </h4>
                    <div className="flex flex-col gap-1.5 mb-2">
                       <p className="text-xs text-white/60">
                          {format(new Date(match.date), "MMM do, yyyy")} • {match.format}
                       </p>
                       <div className="flex items-center gap-2">
                         {match.jerseyColor === "Scarlet Red" && (
                            <div className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 border border-red-500/20 rounded text-[10px] font-bold text-red-400">
                               <Shirt className="w-3 h-3 fill-red-500 text-red-500" />
                               <span>Red</span>
                               <span className="text-white/20 mx-0.5">•</span>
                               <Circle className="w-2.5 h-2.5 fill-white text-white" />
                               <span className="text-white">White</span>
                            </div>
                         )}
                         {match.jerseyColor === "Whites" && (
                            <div className="flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] font-bold text-white">
                               <Shirt className="w-3 h-3 fill-white text-white" />
                               <span>White</span>
                               <span className="text-white/20 mx-0.5">•</span>
                               <Circle className="w-2.5 h-2.5 fill-red-600 text-red-600" />
                               <span className="text-red-400">Red</span>
                            </div>
                         )}
                       </div>
                    </div>
                    <p className="text-xs font-bold text-accent mb-4">
                       {match.matchType} • {store.grounds.find((g) => g.id === match.groundId)?.name || 'Unknown Ground'}
                    </p>
                  </div>

                  {store.appConfig?.matchConfiguration?.enablePlayerAvailability && (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase font-bold text-white/50 tracking-wide text-center">
                        Availability
                      </p>
                      <div className="flex gap-2">
                        {["Yes", "No", "Tentative"].map((avStat) => {
                          let isSelected = false;
                          if (avStat === "Yes") isSelected = isConfirmed;
                          if (avStat === "No") isSelected = isNo;
                          if (avStat === "Tentative") isSelected = isTentative;
  
                          return (
                            <button
                              key={avStat}
                              onClick={async () => {
                                let finalAvStat = avStat as any;
                                if (avStat === "Yes") finalAvStat = "Confirmed";
  
                                if (myPayment) {
                                  await store.updateMatchAvailability(
                                    myPayment.id,
                                    finalAvStat,
                                    match.id
                                  );
                                  if (
                                    finalAvStat === "Confirmed" &&
                                    myPayment.status === "Not Playing"
                                  ) {
                                    await store.updatePaymentStatus(
                                      myPayment.id,
                                      "Unpaid",
                                      match.id
                                    );
                                  } else if (
                                    (finalAvStat === "No" ||
                                      finalAvStat === "Tentative") &&
                                    myPayment.status === "Unpaid"
                                  ) {
                                    await store.updatePaymentStatus(
                                      myPayment.id,
                                      "Not Playing",
                                      match.id
                                    );
                                  }
                                } else {
                                  await store.addPaymentWithAvailability(
                                    match.id,
                                    mePlayer.id,
                                    finalAvStat
                                  );
                                }
                              }}
                              className={`flex-[1] py-2 rounded-lg font-bold text-xs border transition ${
                                isSelected
                                  ? avStat === "Yes"
                                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-md"
                                    : avStat === "No"
                                    ? "bg-red-500/20 text-red-500 border-red-500/50 shadow-md"
                                    : "bg-amber-500/20 text-amber-500 border-amber-500/50 shadow-md"
                                  : "bg-transparent text-white border-glass-border hover:bg-white/5"
                              }`}
                            >
                              {avStat}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

      {/* Due Payment Card (Only show dues) - Will fill remaining row space */}
      {!isAdmin && mePlayer && hasDues && (
        <div className={`md:col-span-6 ${hasMatches ? 'lg:col-span-4' : 'lg:col-span-12'} h-full flex flex-col`}>
           <PlayerFinanceView store={store} userId={currentUserId} showOnly="dues" />
        </div>
      )}

      {/* Main Feed Column (Left) */}
      <div className={`md:col-span-12 ${hasBirthdays ? 'lg:col-span-8' : 'lg:col-span-12'} lg:col-start-1 flex flex-col gap-6`}>
        {/* Admin Add Post Form */}
        {isAdmin && (
          <div className="glass rounded-2xl p-4 border border-glass-border flex flex-col gap-3">
          {isAddingPost ? (
            <div className="flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200">
              <textarea
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-accent resize-none placeholder:text-white/30"
                rows={3}
                placeholder="What's happening in the club?"
                value={newPostText}
                onChange={(e) => setNewPostText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setIsAddingPost(false)}
                  className="px-4 py-2 text-xs font-bold text-white/50 hover:text-white uppercase tracking-wider transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreatePost}
                  disabled={!newPostText.trim()}
                  className="px-4 py-2 text-xs font-bold bg-accent text-black rounded-xl uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition cursor-pointer flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" /> Post
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingPost(true)}
              className="w-full bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 text-left p-4 rounded-xl text-white/50 transition flex items-center gap-3 cursor-pointer"
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
            className="w-full text-sm font-bold text-white tracking-widest uppercase flex items-center justify-between cursor-pointer"
          >
            <span className="flex items-center gap-2"><PieChart className="w-4 h-4 text-accent" /> Pulse</span>
            {isPulseExpanded ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronRight className="w-4 h-4 text-white/50" />}
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
                    alert("Error voting: " + err.message);
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
                    alert("Error archiving: " + err.message);
                  }
                };

                return (
                  <div key={poll.id} className="min-w-[280px] max-w-[320px] snap-center glass rounded-2xl p-5 border border-white/10 relative shrink-0">
                    <div className="absolute top-0 right-0 bg-accent text-black text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-bl-xl">
                      Sticked
                    </div>
                    {poll.isEdited && (
                      <div className="absolute top-0 left-0 bg-white/20 text-white text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-br-xl">
                        Edited
                      </div>
                    )}
                    <h3 className={`text-sm font-bold text-white pr-12 leading-tight ${poll.isEdited ? 'mt-3' : 'mb-4'}`}>
                      {poll.title}
                    </h3>
                    
                    {myResponse ? (
                      <div className="space-y-4">
                        <PollResults poll={poll} store={store} />
                        <button onClick={handleArchive} className="w-full py-2 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold text-white/50 hover:text-white transition flex items-center justify-center gap-2">
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
          <div className="text-center text-white/40 py-8 text-sm glass rounded-2xl">
            No posts yet. Wait for club updates!
          </div>
        ) : (
          renderedPosts.map((post) => (
            <div
              key={post.id}
              className={`glass rounded-2xl border ${post.isSystem ? "border-accent/30" : "border-glass-border"} overflow-hidden flex flex-col`}
            >
              {/* Post Header */}
              <div className="p-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center font-bold text-white relative shrink-0">
                    {post.isSystem ? (
                      <Cake className="w-5 h-5 text-accent" />
                    ) : post.authorName ? (
                      post.authorName.charAt(0).toUpperCase()
                    ) : (
                      "A"
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-white/90">
                      {post.isSystem
                        ? "KAvach (Official)"
                        : post.authorName || "Admin"}
                    </p>
                    {post.createdAt && (
                      <p className="text-[10px] text-white/50">
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
                      className="p-2 text-white/40 hover:text-accent hover:bg-white/5 rounded-lg transition"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm("Delete this post?")) {
                          deletePost(post.id);
                        }
                      }}
                      className="p-2 text-white/40 hover:text-red-400 hover:bg-white/5 rounded-lg transition"
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
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-accent resize-none placeholder:text-white/30"
                      rows={3}
                      value={editPostText}
                      onChange={(e) => setEditPostText(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingPostId(null)}
                        className="px-4 py-2 text-xs font-bold text-white/50 hover:text-white uppercase tracking-wider transition cursor-pointer"
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
                        className="px-4 py-2 text-xs font-bold bg-accent text-black rounded-xl uppercase tracking-wider hover:opacity-90 disabled:opacity-50 transition cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {post.text && (
                      <p className="text-sm text-white/80 whitespace-pre-wrap">
                        {post.text}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Comments Section */}
              <div className="bg-black/20 p-4 flex flex-col gap-3 border-t border-white/5">
                {post.comments?.length > 0 && (
                  <div className="flex flex-col gap-3 mb-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-white/40 flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" /> Comments (
                      {post.comments.length})
                    </h4>
                    {post.comments.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col bg-white/5 p-3 rounded-xl"
                      >
                        <div className="flex justify-between items-end mb-1">
                          <span className="font-semibold text-xs text-white/90">
                            {c.userName}
                          </span>
                        </div>
                        <p className="text-xs text-white/70">{c.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Comment Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Write a comment..."
                    className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-white/40"
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
                    className="p-2 bg-accent text-black rounded-xl hover:opacity-90 transition disabled:opacity-50 cursor-pointer"
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
              <div className="glass rounded-2xl p-6 border-2 border-accent/40 relative overflow-hidden bg-gradient-to-br from-accent/10 to-transparent">
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
                        <div className="font-bold text-white text-lg">{p.name}</div>
                        <div className="text-xs text-white/70">
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
              <div className="glass rounded-2xl p-4 border border-glass-border relative overflow-hidden">
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
                      <span className="font-semibold text-white/90">{p.name}</span>
                      <span className="text-white/60">
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
          <div className="glass rounded-xl p-6 w-full max-w-sm flex flex-col items-center">
            <h2 className="text-xl font-bold mb-2">Complete Profile</h2>
            <p className="text-sm text-white/70 text-center mb-6">
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
                <label className="text-xs uppercase tracking-widest text-white/50 mb-1 block">Email</label>
                <input
                  type="email"
                  required
                  value={profileFormData.email}
                  onChange={(e) => setProfileFormData({ ...profileFormData, email: e.target.value })}
                  className="w-full bg-black/30 border border-white/10 rounded tracking-wider px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-white/50 mb-1 block">Date of Birth</label>
                <input
                  type="date"
                  required
                  value={profileFormData.dob}
                  onChange={(e) => setProfileFormData({ ...profileFormData, dob: e.target.value })}
                  className="w-full bg-black/30 border border-white/10 rounded tracking-wider px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-white/50 mb-1 block">Jersey Size</label>
                <select
                  required
                  value={profileFormData.chestSize}
                  onChange={(e) => setProfileFormData({ ...profileFormData, chestSize: e.target.value })}
                  className="w-full bg-black/30 border border-white/10 rounded tracking-wider px-3 py-2 text-sm text-white focus:outline-none focus:border-accent [&>option]:bg-neutral-950 font-mono"
                >
                  <option value="">Select Size</option>
                  {["36", "38", "40", "42", "44", "46", "S", "M", "L", "XL", "XXL"].map((sz) => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-widest text-white/50 mb-1 block">Jersey Number</label>
                {isAdmin ? (
                  <input
                    type="text"
                    required
                    placeholder="e.g. 7 or 18"
                    value={profileFormData.jerseyNumber}
                    onChange={(e) => setProfileFormData({ ...profileFormData, jerseyNumber: e.target.value })}
                    className="w-full bg-black/30 border border-white/10 rounded tracking-wider px-3 py-2 text-sm text-white focus:outline-none focus:border-accent font-mono"
                  />
                ) : (
                  <input
                    type="text"
                    disabled
                    placeholder="Assigned by Admin"
                    value={profileFormData.jerseyNumber || ""}
                    className="w-full bg-black/30 border border-white/10 rounded tracking-wider px-3 py-2 text-sm text-white/50 focus:outline-none opacity-50 cursor-not-allowed font-mono"
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
                  className="w-full py-2 bg-white/5 text-white/60 hover:text-white rounded font-bold uppercase tracking-widest text-xs transition border border-white/10"
                >
                  Later
                </button>
                <button
                  type="submit"
                  className="w-full py-2 bg-accent text-black rounded font-bold uppercase tracking-widest text-xs transition hover:bg-accent/90"
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
