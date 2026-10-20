"use client";

import { useState, useEffect, useMemo } from "react";
import { useStore } from "@/hooks/useStore";
import { authedFetch } from "@/lib/authed-fetch";
import {
  ClubLead,
  LeadStatus,
  LeadInterest,
  LeadSource,
  LeadNote,
  Player,
} from "@/lib/types";
import { normalizeIndianMobile } from "@/lib/utils";
import {
  Phone,
  MessageCircle,
  Plus,
  Search,
  Calendar,
  User,
  MapPin,
  Clock,
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit2,
  X,
  UserCheck,
  Send,
  MessageSquare,
  Settings,
  UserPlus,
  Bell,
  ExternalLink,
} from "lucide-react";
import { format, parseISO, isToday, isPast } from "date-fns";

interface StudioCRMViewProps {
  store: ReturnType<typeof useStore>;
  adminId: string;
  adminName: string;
}

const STATUS_CONFIG: Record<
  LeadStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  new: {
    label: "New",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/30",
  },
  contacted: {
    label: "In Discussion",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/30",
  },
  trial: {
    label: "Trial / Visit",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/30",
  },
  converted: {
    label: "Converted",
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/30",
  },
  closed: {
    label: "Closed",
    bg: "bg-gray-500/10",
    text: "text-gray-400",
    border: "border-gray-500/30",
  },
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  whatsapp: "WhatsApp",
  call: "Direct Call",
  jotform: "Jotform",
  email: "Email",
  walk_in: "Walk-in",
  other: "Other",
};

const DEFAULT_INVITE_MESSAGE = (name: string, clubName: string) =>
  `Welcome ${name} to ${clubName}! We are glad to have you as a Club member. Please register at https://play.kavachcricket.com. Make sure to provide all required details correctly before submitting. This app will help you pay match fees, Club Subscription, view match details and many other features.`;

export function StudioCRMView({
  store,
  adminId,
  adminName,
}: StudioCRMViewProps) {
  useEffect(() => {
    store.ensureLeads?.();
  }, [store]);

  const leads = store.leads || [];
  const players = store.players || [];
  const clubName = store.appConfig?.clubName || "KAvach Cricket Club";
  const crmTeamIds: string[] = store.appConfig?.crmTeamPlayerIds || [];

  const crmTeamPlayers = useMemo(
    () => players.filter((p) => crmTeamIds.includes(p.id) && !p.disabled),
    [players, crmTeamIds],
  );

  // Filter and Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [interestFilter, setInterestFilter] = useState<LeadInterest | "all">(
    "all",
  );
  const [dueTodayOnly, setDueTodayOnly] = useState(false);

  // Modal states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<ClubLead | null>(null);
  const [expandedNotesLeadId, setExpandedNotesLeadId] = useState<string | null>(
    null,
  );
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});

  // WhatsApp quick-action popover state
  const [activeWhatsAppLead, setActiveWhatsAppLead] = useState<ClubLead | null>(
    null,
  );

  // Convert to player modal state
  const [convertingLead, setConvertingLead] = useState<ClubLead | null>(null);

  // CRM Team settings panel
  const [showTeamSettings, setShowTeamSettings] = useState(false);
  const [teamSearchQuery, setTeamSearchQuery] = useState("");

  // Assign dropdown state (which lead card has the assign dropdown open)
  const [assignDropdownLeadId, setAssignDropdownLeadId] = useState<string | null>(null);

  // Notify assignee modal
  const [notifyTarget, setNotifyTarget] = useState<{
    lead: ClubLead;
    player: Player;
  } | null>(null);
  const [notifyMessage, setNotifyMessage] = useState("");

  // Metrics
  const metrics = useMemo(() => {
    const total = leads.length;
    const newCount = leads.filter((l) => l.status === "new").length;
    const convertedCount = leads.filter((l) => l.status === "converted").length;
    const dueTodayCount = leads.filter((l) => {
      if (!l.nextFollowUpDate || l.status === "converted" || l.status === "closed")
        return false;
      try {
        const d = parseISO(l.nextFollowUpDate);
        return isToday(d) || isPast(d);
      } catch {
        return false;
      }
    }).length;

    return { total, newCount, convertedCount, dueTodayCount };
  }, [leads]);

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = lead.name?.toLowerCase().includes(q);
        const matchesMobile = lead.mobile?.includes(q);
        const matchesArea = lead.area?.toLowerCase().includes(q);
        const matchesQuery = lead.queryText?.toLowerCase().includes(q);
        if (!matchesName && !matchesMobile && !matchesArea && !matchesQuery) {
          return false;
        }
      }

      if (statusFilter !== "all" && lead.status !== statusFilter) {
        return false;
      }

      if (interestFilter !== "all") {
        if (interestFilter === "studio" && lead.interest !== "studio" && lead.interest !== "both")
          return false;
        if (interestFilter === "matches" && lead.interest !== "matches" && lead.interest !== "both")
          return false;
        if (interestFilter === "both" && lead.interest !== "both")
          return false;
      }

      if (dueTodayOnly) {
        if (!lead.nextFollowUpDate || lead.status === "converted" || lead.status === "closed")
          return false;
        try {
          const d = parseISO(lead.nextFollowUpDate);
          if (!isToday(d) && !isPast(d)) return false;
        } catch {
          return false;
        }
      }

      return true;
    });
  }, [leads, searchQuery, statusFilter, interestFilter, dueTodayOnly]);

  // Handlers
  const handleOpenAddForm = () => {
    setEditingLead(null);
    setIsFormOpen(true);
  };

  const handleOpenEditForm = (lead: ClubLead) => {
    setEditingLead(lead);
    setIsFormOpen(true);
  };

  const handleAddNote = async (leadId: string) => {
    const text = (noteInputs[leadId] || "").trim();
    if (!text) return;
    try {
      await store.addLeadNote?.(leadId, text);
      setNoteInputs((prev) => ({ ...prev, [leadId]: "" }));
    } catch (err: any) {
      alert(`Failed to add note: ${err?.message || "Unknown error"}`);
    }
  };

  const handleStatusChange = async (leadId: string, newStatus: LeadStatus) => {
    try {
      await store.updateLead?.(leadId, { status: newStatus });
    } catch (err: any) {
      alert(`Failed to update status: ${err?.message || "Unknown error"}`);
    }
  };

  const handleDeleteLead = async (lead: ClubLead) => {
    if (
      window.confirm(
        `Are you sure you want to delete enquiry for "${lead.name}"? This cannot be undone.`,
      )
    ) {
      try {
        await store.deleteLead?.(lead.id);
      } catch (err: any) {
        alert(`Failed to delete enquiry: ${err?.message || "Unknown error"}`);
      }
    }
  };

  // WhatsApp Link Builder
  const getWhatsAppUrl = (mobile: string, customMessage: string) => {
    const cleanNumber = mobile.replace(/\D/g, "");
    const encoded = encodeURIComponent(customMessage);
    return `https://wa.me/${cleanNumber}?text=${encoded}`;
  };

  // CRM Team Management
  const handleToggleCrmTeamMember = async (playerId: string) => {
    const updated = crmTeamIds.includes(playerId)
      ? crmTeamIds.filter((id) => id !== playerId)
      : [...crmTeamIds, playerId];
    try {
      await store.updateAppConfig?.({ crmTeamPlayerIds: updated });
    } catch (err: any) {
      alert(`Failed to update CRM team: ${err?.message || "Unknown error"}`);
    }
  };

  // Lead Assignment
  const handleToggleAssignment = async (leadId: string, playerId: string) => {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead) return;
    const currentAssigned = lead.assignedTo || [];
    const updated = currentAssigned.includes(playerId)
      ? currentAssigned.filter((id) => id !== playerId)
      : [...currentAssigned, playerId];
    try {
      await store.updateLead?.(leadId, { assignedTo: updated });
      const assignee = players.find((p) => p.id === playerId);
      const action = currentAssigned.includes(playerId) ? "unassigned" : "assigned";
      if (assignee) {
        await store.addLeadNote?.(
          leadId,
          `${action === "assigned" ? "Assigned" : "Unassigned"} ${assignee.name} ${action === "assigned" ? "to" : "from"} this lead.`,
        );
      }
    } catch (err: any) {
      alert(`Failed to update assignment: ${err?.message || "Unknown error"}`);
    }
  };

  // Notify Assignee (opens wa.me)
  const handleOpenNotify = (lead: ClubLead, player: Player) => {
    const msg = `Hi ${player.name.split(" ")[0]}, you have been assigned a new lead to follow up on:\n\nName: ${lead.name}\nNumber: ${lead.mobile}${lead.area ? `\nArea: ${lead.area}` : ""}${lead.queryText ? `\nQuery: ${lead.queryText}` : ""}\n\nPlease reach out to them at the earliest.`;
    setNotifyTarget({ lead, player });
    setNotifyMessage(msg);
  };

  const handleSendNotify = () => {
    if (!notifyTarget) return;
    const url = getWhatsAppUrl(notifyTarget.player.mobile, notifyMessage);
    window.open(url, "_blank");
    setNotifyTarget(null);
    setNotifyMessage("");
  };

  // Convert Lead Handler — sends invite instead of creating player
  const handleConfirmConvert = async () => {
    if (!convertingLead) return;
    try {
      // Send invite via Meta WhatsApp Business API
      const res = await authedFetch("/api/whatsapp/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: convertingLead.mobile,
          playerName: convertingLead.name,
        }),
      });

      let apiSuccess = false;
      if (res.ok) {
        apiSuccess = true;
      } else {
        const errData = await res.json().catch(() => ({}));
        console.warn("WhatsApp API invite failed, falling back to wa.me:", errData);
      }

      // Mark lead converted
      await store.updateLead?.(convertingLead.id, { status: "converted" });

      // Add audit note
      await store.addLeadNote?.(
        convertingLead.id,
        apiSuccess
          ? `Sent club invite via WhatsApp API to ${convertingLead.name}. Registration link shared.`
          : `Converted lead. WhatsApp API not available — opened invite via wa.me instead.`,
      );

      if (!apiSuccess) {
        const msg = DEFAULT_INVITE_MESSAGE(convertingLead.name, clubName);
        const url = getWhatsAppUrl(convertingLead.mobile, msg);
        window.open(url, "_blank");
      }

      setConvertingLead(null);
      alert(
        apiSuccess
          ? `Invite sent to ${convertingLead.name} via WhatsApp!`
          : `Lead converted. Invite opened in WhatsApp for manual send.`,
      );
    } catch (err: any) {
      alert(`Conversion failed: ${err?.message || "Unknown error"}`);
    }
  };

  // Helper: get assigned player names for a lead
  const getAssignedPlayers = (lead: ClubLead) =>
    (lead.assignedTo || [])
      .map((id) => players.find((p) => p.id === id))
      .filter((p): p is Player => !!p && !p.disabled);

  return (
    <div className="space-y-6">
      {/* Metrics Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border p-3.5 rounded-xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Total Enquiries
          </div>
          <div className="text-2xl font-black text-white mt-1">
            {metrics.total}
          </div>
        </div>

        <div className="bg-card border border-emerald-500/20 p-3.5 rounded-xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            New / Uncontacted
          </div>
          <div className="text-2xl font-black text-emerald-300 mt-1">
            {metrics.newCount}
          </div>
        </div>

        <div
          onClick={() => setDueTodayOnly(!dueTodayOnly)}
          className={`cursor-pointer border p-3.5 rounded-xl transition ${
            dueTodayOnly
              ? "bg-amber-500/20 border-amber-400 ring-2 ring-amber-400/40"
              : "bg-card border-amber-500/20 hover:border-amber-500/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Due / Overdue
            </div>
            {dueTodayOnly && (
              <span className="text-[10px] font-bold text-amber-300 bg-amber-500/30 px-1.5 py-0.5 rounded">
                Active Filter
              </span>
            )}
          </div>
          <div className="text-2xl font-black text-amber-300 mt-1">
            {metrics.dueTodayCount}
          </div>
        </div>

        <div className="bg-card border border-purple-500/20 p-3.5 rounded-xl">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">
            Converted
          </div>
          <div className="text-2xl font-black text-purple-300 mt-1">
            {metrics.convertedCount}
          </div>
        </div>
      </div>

      {/* Action & Filter Controls */}
      <div className="bg-card border border-border p-4 rounded-xl space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              placeholder="Search by name, phone, area, or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-black/40 border border-border rounded-lg text-sm text-white placeholder-white/40 focus:outline-none focus:border-accent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTeamSettings(!showTeamSettings)}
              className={`flex items-center gap-1.5 border font-semibold px-3 py-2.5 rounded-lg text-sm transition shrink-0 ${
                showTeamSettings
                  ? "bg-white/15 border-white/30 text-white"
                  : "bg-white/5 border-border text-white/70 hover:text-white hover:bg-white/10"
              }`}
              title="Manage CRM Team"
            >
              <Settings className="w-4 h-4" /> CRM Team
              {crmTeamPlayers.length > 0 && (
                <span className="text-[10px] bg-accent text-black font-bold px-1.5 py-0.5 rounded-full ml-0.5">
                  {crmTeamPlayers.length}
                </span>
              )}
            </button>

            <button
              onClick={handleOpenAddForm}
              className="flex items-center justify-center gap-2 bg-accent text-black font-bold px-4 py-2.5 rounded-lg text-sm hover:opacity-90 transition shrink-0 shadow-sm"
            >
              <Plus className="w-4 h-4" /> New Enquiry
            </button>
          </div>
        </div>

        {/* CRM Team Settings Panel */}
        {showTeamSettings && (
          <div className="border border-white/10 bg-black/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-white/60">
                CRM Team Members
              </div>
              <span className="text-[11px] text-white/40">
                These players can be assigned to follow up on leads
              </span>
            </div>

            {/* Current team */}
            {crmTeamPlayers.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {crmTeamPlayers.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1.5 bg-accent/15 border border-accent/30 text-accent text-xs font-semibold px-2.5 py-1 rounded-lg"
                  >
                    {p.name}
                    <button
                      onClick={() => handleToggleCrmTeamMember(p.id)}
                      className="text-accent/60 hover:text-red-400 transition"
                      title="Remove from CRM team"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-white/40 italic">
                No team members added yet. Search and add players below.
              </div>
            )}

            {/* Search and add players */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              <input
                type="text"
                placeholder="Search players to add to CRM team..."
                value={teamSearchQuery}
                onChange={(e) => setTeamSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-black/40 border border-border rounded-lg text-xs text-white placeholder-white/40 focus:outline-none focus:border-accent"
              />
            </div>
            {teamSearchQuery.trim() && (
              <div className="max-h-40 overflow-y-auto space-y-1">
                {players
                  .filter((p) => {
                    if (p.disabled) return false;
                    const q = teamSearchQuery.toLowerCase();
                    return (
                      p.name.toLowerCase().includes(q) ||
                      p.mobile?.includes(q) ||
                      p.email?.toLowerCase().includes(q)
                    );
                  })
                  .slice(0, 10)
                  .map((p) => {
                    const isInTeam = crmTeamIds.includes(p.id);
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleToggleCrmTeamMember(p.id)}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs cursor-pointer transition ${
                          isInTeam
                            ? "bg-accent/15 border border-accent/30"
                            : "bg-white/5 hover:bg-white/10 border border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white">
                            {p.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-white font-medium">{p.name}</span>
                          {p.mobile && (
                            <span className="text-white/40">{p.mobile}</span>
                          )}
                        </div>
                        {isInTeam ? (
                          <span className="text-accent font-bold text-[10px]">IN TEAM</span>
                        ) : (
                          <span className="text-white/40 text-[10px]">+ Add</span>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Status filters */}
          <div className="flex flex-wrap items-center gap-1.5 mr-2">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-white/40 mr-1">
              Status:
            </span>
            {(
              [
                "all",
                "new",
                "contacted",
                "trial",
                "converted",
                "closed",
              ] as const
            ).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
                  statusFilter === st
                    ? "bg-accent text-black font-bold"
                    : "bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {st === "all"
                  ? "All"
                  : STATUS_CONFIG[st as LeadStatus]?.label || st}
              </button>
            ))}
          </div>

          {/* Interest filter */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-white/40 mr-1">
              Interest:
            </span>
            {(["all", "studio", "matches", "both"] as const).map((it) => (
              <button
                key={it}
                onClick={() => setInterestFilter(it)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition ${
                  interestFilter === it
                    ? "bg-white/20 text-white font-bold"
                    : "bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
                }`}
              >
                {it === "all"
                  ? "All"
                  : it === "studio"
                  ? "Studio Nets"
                  : it === "matches"
                  ? "Matches"
                  : "Both"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Leads List */}
      <div className="space-y-3">
        {filteredLeads.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-10 text-center">
            <User className="w-10 h-10 text-white/20 mx-auto mb-3" />
            <div className="text-white/80 font-bold text-base">
              No enquiries match your search or filters.
            </div>
            <div className="text-white/40 text-xs mt-1">
              Click &quot;New Enquiry&quot; to log a new enquiry from WhatsApp, Call, or Jotform.
            </div>
          </div>
        ) : (
          filteredLeads.map((lead) => {
            const statusMeta =
              STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
            const isNotesExpanded = expandedNotesLeadId === lead.id;
            const noteCount = lead.notes?.length || 0;
            const assignedPlayers = getAssignedPlayers(lead);
            const isAssignDropdownOpen = assignDropdownLeadId === lead.id;

            let isFollowUpDue = false;
            let followUpLabel = "";
            if (lead.nextFollowUpDate) {
              try {
                const parsed = parseISO(lead.nextFollowUpDate);
                if (isToday(parsed)) {
                  isFollowUpDue = true;
                  followUpLabel = "Follow-up Due Today!";
                } else if (isPast(parsed)) {
                  isFollowUpDue = true;
                  followUpLabel = `Overdue: ${format(parsed, "dd MMM")}`;
                } else {
                  followUpLabel = `Follow-up: ${format(parsed, "dd MMM yyyy")}`;
                }
              } catch {
                followUpLabel = lead.nextFollowUpDate;
              }
            }

            return (
              <div
                key={lead.id}
                className="bg-card border border-border hover:border-white/20 transition rounded-xl p-4 space-y-3 shadow-sm"
              >
                {/* Top Row: Name, Source, Status */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-base font-bold text-white tracking-wide">
                      {lead.name}
                    </span>

                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-white/10 text-white/70">
                      {SOURCE_LABELS[lead.source] || lead.source}
                    </span>

                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        lead.interest === "studio"
                          ? "bg-blue-500/20 text-blue-300"
                          : lead.interest === "matches"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-emerald-500/20 text-emerald-300"
                      }`}
                    >
                      {lead.interest === "studio"
                        ? "Studio Nets"
                        : lead.interest === "matches"
                        ? "Matches"
                        : "Studio + Matches"}
                    </span>
                  </div>

                  {/* Status + Locality */}
                  <div className="flex items-center gap-2">
                    {lead.area && (
                      <span className="text-xs text-white/50 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-white/40" /> {lead.area}
                      </span>
                    )}

                    <select
                      value={lead.status}
                      onChange={(e) =>
                        handleStatusChange(
                          lead.id,
                          e.target.value as LeadStatus,
                        )
                      }
                      className={`text-xs font-bold px-2.5 py-1 rounded-md border appearance-none cursor-pointer focus:outline-none ${statusMeta.bg} ${statusMeta.text} ${statusMeta.border}`}
                    >
                      <option value="new" className="bg-neutral-900 text-emerald-400">
                        New
                      </option>
                      <option value="contacted" className="bg-neutral-900 text-amber-400">
                        In Discussion
                      </option>
                      <option value="trial" className="bg-neutral-900 text-blue-400">
                        Trial / Visit
                      </option>
                      <option value="converted" className="bg-neutral-900 text-purple-400">
                        Converted
                      </option>
                      <option value="closed" className="bg-neutral-900 text-gray-400">
                        Closed
                      </option>
                    </select>
                  </div>
                </div>

                {/* Assigned Players Row */}
                {(assignedPlayers.length > 0 || crmTeamPlayers.length > 0) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
                      Assigned:
                    </span>
                    {assignedPlayers.length > 0 ? (
                      assignedPlayers.map((p) => (
                        <span
                          key={p.id}
                          className="flex items-center gap-1 bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 text-[11px] font-semibold px-2 py-0.5 rounded-lg"
                        >
                          {p.name.split(" ")[0]}
                          <button
                            onClick={() => handleOpenNotify(lead, p)}
                            className="text-cyan-400/70 hover:text-emerald-400 transition ml-0.5"
                            title={`Notify ${p.name} via WhatsApp`}
                          >
                            <Bell className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleToggleAssignment(lead.id, p.id)}
                            className="text-cyan-400/50 hover:text-red-400 transition"
                            title="Unassign"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))
                    ) : (
                      <span className="text-[11px] text-white/30 italic">
                        None
                      </span>
                    )}
                    <div className="relative">
                      <button
                        onClick={() =>
                          setAssignDropdownLeadId(isAssignDropdownOpen ? null : lead.id)
                        }
                        className="flex items-center gap-1 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 text-[11px] font-semibold px-2 py-0.5 rounded-lg transition"
                      >
                        <UserPlus className="w-3 h-3" /> Assign
                      </button>
                      {isAssignDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 z-30 bg-neutral-900 border border-white/15 rounded-lg shadow-xl p-2 min-w-[180px] space-y-1">
                          {crmTeamPlayers.length === 0 ? (
                            <div className="text-[11px] text-white/40 p-2">
                              No CRM team set up. Use the &quot;CRM Team&quot; button above.
                            </div>
                          ) : (
                            crmTeamPlayers.map((p) => {
                              const isAssigned = (lead.assignedTo || []).includes(
                                p.id,
                              );
                              return (
                                <div
                                  key={p.id}
                                  onClick={() => {
                                    handleToggleAssignment(lead.id, p.id);
                                    setAssignDropdownLeadId(null);
                                  }}
                                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition ${
                                    isAssigned
                                      ? "bg-cyan-500/15 text-cyan-300"
                                      : "hover:bg-white/10 text-white/80"
                                  }`}
                                >
                                  <span className="font-medium">{p.name}</span>
                                  {isAssigned && (
                                    <span className="text-[10px] text-cyan-400 font-bold">
                                      ASSIGNED
                                    </span>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Middle: Query summary and follow up status */}
                <div className="text-xs text-white/70 bg-black/30 p-2.5 rounded-lg space-y-1.5">
                  {lead.queryText ? (
                    <div className="leading-relaxed">
                      <span className="font-semibold text-white/90">Query: </span>
                      {lead.queryText}
                    </div>
                  ) : (
                    <div className="text-white/40 italic">No query text recorded.</div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5 text-[11px]">
                    <div className="text-white/40">
                      Logged:{" "}
                      {lead.createdAt?.seconds
                        ? format(
                            new Date(lead.createdAt.seconds * 1000),
                            "dd MMM yyyy, h:mm a",
                          )
                        : "Recent"}
                    </div>

                    {followUpLabel && (
                      <div
                        className={`flex items-center gap-1 font-semibold ${
                          isFollowUpDue ? "text-amber-400" : "text-white/60"
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {followUpLabel}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Row: WhatsApp, Call, Notes Toggle, Menu */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveWhatsAppLead(lead)}
                      className="flex items-center gap-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-semibold px-3 py-1.5 rounded-lg text-xs transition"
                    >
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </button>

                    <a
                      href={`tel:${lead.mobile}`}
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/90 border border-white/10 font-semibold px-3 py-1.5 rounded-lg text-xs transition"
                    >
                      <Phone className="w-3.5 h-3.5 text-white/60" /> Call {lead.mobile}
                    </a>

                    <button
                      onClick={() =>
                        setExpandedNotesLeadId(
                          isNotesExpanded ? null : lead.id,
                        )
                      }
                      className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 px-2.5 py-1.5 rounded-lg text-xs transition font-medium"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-white/60" />
                      {noteCount > 0 ? `${noteCount} Notes` : "Add Note"}
                      {isNotesExpanded ? (
                        <ChevronUp className="w-3 h-3 text-white/40" />
                      ) : (
                        <ChevronDown className="w-3 h-3 text-white/40" />
                      )}
                    </button>
                  </div>

                  {/* Secondary Actions: Convert, Edit, Delete */}
                  <div className="flex items-center gap-1.5">
                    {lead.status !== "converted" && (
                      <button
                        onClick={() => setConvertingLead(lead)}
                        className="flex items-center gap-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition"
                        title="Send invite to register on Play App"
                      >
                        <UserCheck className="w-3.5 h-3.5" /> Convert
                      </button>
                    )}

                    <button
                      onClick={() => handleOpenEditForm(lead)}
                      className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition"
                      title="Edit Enquiry"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => handleDeleteLead(lead)}
                      className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                      title="Delete Enquiry"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Collapsible Notes Timeline & Input */}
                {isNotesExpanded && (
                  <div className="pt-3 border-t border-white/10 space-y-3 bg-black/20 p-3 rounded-lg">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-white/40">
                      Conversation History &amp; Notes
                    </div>

                    {lead.notes && lead.notes.length > 0 ? (
                      <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                        {lead.notes.map((note) => (
                          <div
                            key={note.id}
                            className="bg-card border border-white/5 rounded-lg p-2.5 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between text-[11px] text-white/40">
                              <span className="font-semibold text-accent">
                                {note.adminName}
                              </span>
                              <span>
                                {note.createdAt
                                  ? format(
                                      new Date(note.createdAt),
                                      "dd MMM yyyy, h:mm a",
                                    )
                                  : ""}
                              </span>
                            </div>
                            <div className="text-white/80 leading-relaxed">
                              {note.text}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-white/40 italic">
                        No conversation notes yet. Add what was discussed below.
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        placeholder="Add a conversation update (e.g. Spoke to him, interested in 3M nets plan)..."
                        value={noteInputs[lead.id] || ""}
                        onChange={(e) =>
                          setNoteInputs((prev) => ({
                            ...prev,
                            [lead.id]: e.target.value,
                          }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddNote(lead.id);
                          }
                        }}
                        className="flex-1 bg-black/40 border border-border rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-accent"
                      />
                      <button
                        onClick={() => handleAddNote(lead.id)}
                        disabled={!(noteInputs[lead.id] || "").trim()}
                        className="bg-accent disabled:opacity-30 text-black font-bold px-3 py-1.5 rounded-lg text-xs transition"
                      >
                        Post Note
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Modal: Add or Edit Enquiry Form                               */}
      {/* ------------------------------------------------------------- */}
      {isFormOpen && (
        <LeadFormModal
          isOpen={isFormOpen}
          initialData={editingLead}
          adminId={adminId}
          adminName={adminName}
          onClose={() => {
            setIsFormOpen(false);
            setEditingLead(null);
          }}
          onSave={async (formData) => {
            if (editingLead) {
              await store.updateLead?.(editingLead.id, formData);
            } else {
              await store.addLead?.(formData);
            }
            setIsFormOpen(false);
            setEditingLead(null);
          }}
        />
      )}

      {/* ------------------------------------------------------------- */}
      {/* Modal: WhatsApp Message Template Launcher                     */}
      {/* ------------------------------------------------------------- */}
      {activeWhatsAppLead && (
        <WhatsAppTemplateModal
          lead={activeWhatsAppLead}
          clubName={clubName}
          onClose={() => setActiveWhatsAppLead(null)}
          onSend={(msg) => {
            const url = getWhatsAppUrl(activeWhatsAppLead.mobile, msg);
            window.open(url, "_blank");
            setActiveWhatsAppLead(null);
          }}
        />
      )}

      {/* ------------------------------------------------------------- */}
      {/* Modal: Convert Lead — Send Invite to Register                */}
      {/* ------------------------------------------------------------- */}
      {convertingLead && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-purple-400 font-bold text-base">
              <UserCheck className="w-5 h-5" /> Convert Lead — Send Invite
            </div>

            <div className="text-xs text-white/80 leading-relaxed space-y-2">
              <p>
                This will send a <strong className="text-white">WhatsApp welcome message</strong>{" "}
                to <strong className="text-white">{convertingLead.name}</strong> with{" "}
                the Play App registration link and mark this lead as converted.
              </p>
              <div className="bg-black/30 rounded-lg p-3 border border-white/5 text-white/60 leading-relaxed">
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1.5">
                  Message Preview
                </div>
                {DEFAULT_INVITE_MESSAGE(convertingLead.name, clubName)}
              </div>
              <p className="text-white/50 text-[11px]">
                The message will be sent via WhatsApp Business API if configured.
                Otherwise, it opens in your personal WhatsApp for manual send.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setConvertingLead(null)}
                className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmConvert}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg text-xs transition"
              >
                <Send className="w-3.5 h-3.5" /> Send Invite &amp; Convert
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* Modal: Notify Assignee via WhatsApp                          */}
      {/* ------------------------------------------------------------- */}
      {notifyTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-base">
                <Bell className="w-5 h-5" /> Notify {notifyTarget.player.name}
              </div>
              <button
                onClick={() => setNotifyTarget(null)}
                className="text-white/40 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-white/60">
              This will open WhatsApp with a pre-filled message about the lead{" "}
              <strong className="text-white">{notifyTarget.lead.name}</strong>.
              You can edit the message before sending.
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-white/70 mb-1">
                Message to {notifyTarget.player.name}
              </label>
              <textarea
                rows={5}
                value={notifyMessage}
                onChange={(e) => setNotifyMessage(e.target.value)}
                className="w-full bg-black/40 border border-border rounded-lg p-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-cyan-500 leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setNotifyTarget(null)}
                className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleSendNotify}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition shadow-sm"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open in WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Internal Modal: Add / Edit Lead
// ------------------------------------------------------------------
function LeadFormModal({
  isOpen,
  initialData,
  adminId,
  adminName,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  initialData: ClubLead | null;
  adminId: string;
  adminName: string;
  onClose: () => void;
  onSave: (data: any) => Promise<void>;
}) {
  const [name, setName] = useState(initialData?.name || "");
  const [mobile, setMobile] = useState(initialData?.mobile || "");
  const [email, setEmail] = useState(initialData?.email || "");
  const [area, setArea] = useState(initialData?.area || "");
  const [source, setSource] = useState<LeadSource>(
    initialData?.source || "whatsapp",
  );
  const [interest, setInterest] = useState<LeadInterest>(
    initialData?.interest || "both",
  );
  const [queryText, setQueryText] = useState(initialData?.queryText || "");
  const [status, setStatus] = useState<LeadStatus>(
    initialData?.status || "new",
  );
  const [nextFollowUpDate, setNextFollowUpDate] = useState(
    initialData?.nextFollowUpDate || "",
  );
  const [initialNote, setInitialNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !mobile.trim()) {
      alert("Name and contact number are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      const normalizedPhone = normalizeIndianMobile(mobile.trim());
      const payload: any = {
        name: name.trim(),
        mobile: normalizedPhone,
        email: email.trim() || undefined,
        area: area.trim() || undefined,
        source,
        interest,
        queryText: queryText.trim(),
        status,
        nextFollowUpDate: nextFollowUpDate || undefined,
      };

      if (!initialData && initialNote.trim()) {
        payload.notes = [
          {
            id: `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            text: initialNote.trim(),
            adminId,
            adminName,
            createdAt: new Date().toISOString(),
          },
        ];
      }

      await onSave(payload);
    } catch (err: any) {
      alert(err?.message || "Failed to save enquiry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="font-bold text-base text-white">
            {initialData ? "Edit Enquiry Details" : "Record New Enquiry"}
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          {/* Name & Mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Player / Contact Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rahul Sharma"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Mobile Number *
              </label>
              <input
                type="tel"
                required
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="e.g. 9876543210"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-accent"
              />
              <span className="text-[10px] text-white/40 mt-0.5 block">
                Auto-normalizes to +91XXXXXXXXXX
              </span>
            </div>
          </div>

          {/* Area & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Locality / Area
              </label>
              <input
                type="text"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. Indiranagar, HSR, Whitefield"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Email Address (Optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. rahul@gmail.com"
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Source & Stage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Enquiry Source
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as LeadSource)}
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-accent"
              >
                <option value="whatsapp" className="bg-neutral-900">WhatsApp</option>
                <option value="call" className="bg-neutral-900">Direct Call</option>
                <option value="jotform" className="bg-neutral-900">Jotform</option>
                <option value="email" className="bg-neutral-900">Email</option>
                <option value="walk_in" className="bg-neutral-900">Walk-in</option>
                <option value="other" className="bg-neutral-900">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Lead Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-accent"
              >
                <option value="new" className="bg-neutral-900">New / Uncontacted</option>
                <option value="contacted" className="bg-neutral-900">In Discussion</option>
                <option value="trial" className="bg-neutral-900">Trial / Visit Scheduled</option>
                <option value="converted" className="bg-neutral-900">Converted</option>
                <option value="closed" className="bg-neutral-900">Closed / Not Interested</option>
              </select>
            </div>
          </div>

          {/* Interest Checkboxes */}
          <div>
            <label className="block text-white/70 font-semibold mb-1.5">
              Interest Area
            </label>
            <div className="flex items-center gap-4 bg-black/40 border border-border rounded-lg p-2.5">
              <label className="flex items-center gap-2 cursor-pointer text-white">
                <input
                  type="checkbox"
                  checked={interest === "studio" || interest === "both"}
                  onChange={(e) => {
                    const studioChecked = e.target.checked;
                    const matchesChecked =
                      interest === "matches" || interest === "both";
                    if (studioChecked && matchesChecked) setInterest("both");
                    else if (studioChecked) setInterest("studio");
                    else if (matchesChecked) setInterest("matches");
                    else setInterest("studio");
                  }}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Studio Nets / Bowling Machine</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-white">
                <input
                  type="checkbox"
                  checked={interest === "matches" || interest === "both"}
                  onChange={(e) => {
                    const matchesChecked = e.target.checked;
                    const studioChecked =
                      interest === "studio" || interest === "both";
                    if (studioChecked && matchesChecked) setInterest("both");
                    else if (matchesChecked) setInterest("matches");
                    else if (studioChecked) setInterest("studio");
                    else setInterest("matches");
                  }}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Weekend Matches</span>
              </label>
            </div>
          </div>

          {/* Query Text */}
          <div>
            <label className="block text-white/70 font-semibold mb-1">
              Enquiry Query / Requirements
            </label>
            <textarea
              rows={2}
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="What did they ask about? (e.g. weekday morning slots, 3-month membership, weekend squad availability)"
              className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Next Follow-Up Date */}
          <div>
            <label className="block text-white/70 font-semibold mb-1 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-accent" /> Next Follow-up Date
            </label>
            <input
              type="date"
              value={nextFollowUpDate}
              onChange={(e) => setNextFollowUpDate(e.target.value)}
              className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white focus:outline-none focus:border-accent"
            />
          </div>

          {/* Initial Note (only for new lead) */}
          {!initialData && (
            <div>
              <label className="block text-white/70 font-semibold mb-1">
                Initial Discussion Note (Optional)
              </label>
              <input
                type="text"
                value={initialNote}
                onChange={(e) => setInitialNote(e.target.value)}
                placeholder="e.g. Sent pricing catalog on WhatsApp, requested morning slot."
                className="w-full bg-black/40 border border-border rounded-lg px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:border-accent"
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-accent disabled:opacity-50 text-black font-bold rounded-lg text-xs hover:opacity-90 transition"
            >
              {isSubmitting ? "Saving..." : initialData ? "Update Enquiry" : "Save Enquiry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Internal Modal: WhatsApp Message Preset Picker
// ------------------------------------------------------------------
function WhatsAppTemplateModal({
  lead,
  clubName,
  onClose,
  onSend,
}: {
  lead: ClubLead;
  clubName: string;
  onClose: () => void;
  onSend: (msg: string) => void;
}) {
  const firstName = lead.name.split(" ")[0];

  const templates = [
    {
      title: "Studio Nets & Booking Info",
      badge: "Studio",
      body: `Hi ${firstName}, thank you for contacting ${clubName}! We offer indoor nets, high-quality bowling machines, and regular net practice sessions. Are you looking for a trial session or monthly membership?`,
    },
    {
      title: "Weekend Match Squad Info",
      badge: "Matches",
      body: `Hi ${firstName}, thanks for reaching out to ${clubName}! We play practice & tournament matches every Saturday and Sunday. Would you like to join our upcoming weekend match squad?`,
    },
    {
      title: "Friendly Follow-Up Nudge",
      badge: "Follow-up",
      body: `Hi ${firstName}, following up regarding your enquiry with ${clubName}. Let us know if you'd like to drop by for a session this week or have any questions!`,
    },
    {
      title: "Blank / Custom Message",
      badge: "Custom",
      body: `Hi ${firstName}, `,
    },
  ];

  const [selectedText, setSelectedText] = useState(templates[0].body);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl p-5 max-w-md w-full space-y-4 shadow-xl">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-base">
            <MessageCircle className="w-5 h-5" /> WhatsApp to {lead.name}
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-white/60">
          Select a template or edit the message before opening in personal WhatsApp:
        </div>

        {/* Templates */}
        <div className="space-y-2">
          {templates.map((tpl, i) => (
            <div
              key={i}
              onClick={() => setSelectedText(tpl.body)}
              className={`p-2.5 rounded-lg border cursor-pointer transition text-xs ${
                selectedText === tpl.body
                  ? "bg-emerald-500/20 border-emerald-500/50 text-white"
                  : "bg-black/30 border-white/5 text-white/70 hover:bg-white/5"
              }`}
            >
              <div className="font-bold flex items-center justify-between">
                <span>{tpl.title}</span>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400">
                  {tpl.badge}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Editable Message Box */}
        <div>
          <label className="block text-[11px] font-semibold text-white/70 mb-1">
            Message Preview
          </label>
          <textarea
            rows={4}
            value={selectedText}
            onChange={(e) => setSelectedText(e.target.value)}
            className="w-full bg-black/40 border border-border rounded-lg p-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-emerald-500 leading-relaxed"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => onSend(selectedText)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition shadow-sm"
          >
            <Send className="w-3.5 h-3.5" /> Launch WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
