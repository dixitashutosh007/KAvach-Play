"use client";

import React, { useState, useEffect } from "react";
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
  ChevronDown,
  Plus,
  DollarSign,
  UserPlus,
  Send,
  TrendingUp,
  Settings,
  HelpCircle,
  Activity,
  Edit2,
  UserCheck,
  GitMerge,
  AlertTriangle,
  Phone,
  Shirt,
  Package,
  ShoppingBag,
  Vote,
  CalendarDays,
  Lock,
  RefreshCw,
  BarChart2,
  Target,
  Flame,
  Image,
  Copy,
  Compass,
  Eye,
  User
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
  phone: "+91 98101 23456",
  email: "ashutosh@kavachcricket.com",
  avatar: "https://picsum.photos/seed/kavach7/200/200",
  isAdmin: true,
  adminRole: "Super Admin",
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

const MOCK_ADMIN_KPIS = {
  nextMatch: {
    title: "vs Spartans CC",
    date: "Sat, 21 Nov",
    confirmedXI: 11,
    squadTarget: 14,
    pendingRsvps: 3,
    readinessPercent: 78
  },
  finance: {
    collectedMonth: 42500,
    targetMonth: 48000,
    unpaidDues: 6250,
    unpaidPlayersCount: 9,
    collectionRate: 88
  },
  roster: {
    activePlayers: 38,
    pendingApprovals: 2,
    injuredOut: 3
  },
  studio: {
    slotOccupancyPercent: 85,
    renewalsDueNext48h: 2,
    activePassHolders: 24
  }
};

const MOCK_ADMIN_ALERTS = [
  {
    id: "alert-1",
    level: "urgent",
    title: "3 Unconfirmed RSVPs for Sunday Match",
    description: "Spartans CC fixture is in 3 days. Playing XI cannot be published until remaining squad responses are received.",
    actionLabel: "Send WhatsApp Ping",
    type: "whatsapp"
  },
  {
    id: "alert-2",
    level: "warning",
    title: "New Registration: Rohan Deshmukh",
    description: "Submitted profile with mobile verification, DOB, and jersey request (#14). Awaiting Admin sign-off.",
    actionLabel: "Review & Approve",
    type: "approval"
  },
  {
    id: "alert-3",
    level: "info",
    title: "Pitch-Side Cash Collection Reconciliation",
    description: "Match Admin Vikram Sharma logged ₹2,000 cash for Metro CC match. Awaiting Finance Admin reconciliation.",
    actionLabel: "Reconcile Cash",
    type: "finance"
  }
];

const MOCK_MATCHES = [
  {
    id: "match-spartans-2026",
    title: "KAvach Cricket Club vs Spartans CC",
    opponent: "Spartans CC",
    format: "20 Overs T20",
    dateString: "Saturday, 21 Nov 2026",
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
      { id: "p-2", name: "Ashutosh Dixit", role: "All-Rounder", isCurrent: true, badge: "(VC)", attendance: "Present", feePaid: false },
      { id: "p-1", name: "Vikram Sharma", role: "Batter", badge: "(C)", attendance: "Present", feePaid: true },
      { id: "p-3", name: "Rahul Verma", role: "Bowler", attendance: "Present", feePaid: true },
      { id: "p-4", name: "Sameer Khan", role: "Wicket-Keeper", attendance: "Late", feePaid: false },
      { id: "p-5", name: "Arjun Nair", role: "Batter", attendance: "Present", feePaid: false },
      { id: "p-7", name: "Deepak Joshi", role: "All-Rounder", attendance: "Absent", feePaid: false },
      { id: "p-8", name: "Karan Patel", role: "Bowler", attendance: "Present", feePaid: true },
      { id: "p-9", name: "Rohan Gupta", role: "Batter", attendance: "Present", feePaid: true },
      { id: "p-10", name: "Amitabh Sen", role: "Bowler", attendance: "Present", feePaid: false },
      { id: "p-11", name: "Harish Rao", role: "Bowler", attendance: "Present", feePaid: true },
      { id: "p-12", name: "Manoj Kumar", role: "Batter", attendance: "Present", feePaid: false }
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

const MOCK_ROSTER_PLAYERS = [
  {
    id: "p-1",
    kavachId: "KAV-001",
    name: "Vikram Sharma",
    role: "Batter",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm off-spin",
    jerseyNumber: "18",
    status: "active",
    phone: "+91 98765 43210",
    roles: ["clubAdmin", "matchAdmin"],
    tshirtSize: "L",
    trouserSize: "32"
  },
  {
    id: "p-2",
    kavachId: "KAV-007",
    name: "Ashutosh Dixit",
    role: "All-Rounder",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm medium",
    jerseyNumber: "07",
    status: "active",
    phone: "+91 98111 22334",
    roles: ["superAdmin"],
    tshirtSize: "XL",
    trouserSize: "34"
  },
  {
    id: "p-3",
    kavachId: "KAV-012",
    name: "Rahul Verma",
    role: "Bowler",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm fast",
    jerseyNumber: "99",
    status: "active",
    phone: "+91 98222 33445",
    roles: [],
    tshirtSize: "M",
    trouserSize: "30"
  },
  {
    id: "p-4",
    kavachId: "KAV-018",
    name: "Sameer Khan",
    role: "Wicket-Keeper",
    battingStyle: "Left-hand bat",
    bowlingStyle: "None",
    jerseyNumber: "23",
    status: "active",
    phone: "+91 98333 44556",
    roles: ["isDesigner"],
    tshirtSize: "L",
    trouserSize: "32"
  },
  {
    id: "p-pending-1",
    kavachId: "PENDING",
    name: "Rohan Deshmukh",
    role: "Batter",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm medium",
    jerseyNumber: "14",
    status: "pending",
    phone: "+91 98444 55667",
    roles: [],
    tshirtSize: "M",
    trouserSize: "32"
  },
  {
    id: "p-pending-2",
    kavachId: "PENDING",
    name: "Aditya Chopra",
    role: "All-Rounder",
    battingStyle: "Left-hand bat",
    bowlingStyle: "Left-arm orthodox",
    jerseyNumber: "33",
    status: "pending",
    phone: "+91 98555 66778",
    roles: [],
    tshirtSize: "L",
    trouserSize: "34"
  },
  {
    id: "p-injured-1",
    kavachId: "KAV-025",
    name: "Deepak Joshi",
    role: "All-Rounder",
    battingStyle: "Right-hand bat",
    bowlingStyle: "Right-arm off-spin",
    jerseyNumber: "45",
    status: "injured",
    phone: "+91 98666 77889",
    roles: [],
    tshirtSize: "XL",
    trouserSize: "36"
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

// --- STAGE 5 MOCK DATA ---

const MOCK_ADMIN_FINANCE_RECORDS = [
  {
    id: "fin-101",
    playerId: "p1",
    playerName: "Rohan Mehta",
    kavachId: "KAV-007",
    category: "Match Fee",
    title: "Match Fee - vs Spartans CC",
    amount: 500,
    dueDate: "15 Nov 2026",
    status: "overdue_recent", // 1-14 days
    channel: null,
    collectedBy: null,
    receiptNo: null
  },
  {
    id: "fin-102",
    playerId: "p2",
    playerName: "Kunal Roy",
    kavachId: "KAV-021",
    category: "Club Levy",
    title: "Annual Kit & Practice Gear",
    amount: 1200,
    dueDate: "20 Oct 2026",
    status: "overdue_urgent", // >14 days
    channel: null,
    collectedBy: null,
    receiptNo: null
  },
  {
    id: "fin-103",
    playerId: "p3",
    playerName: "Devendra Joshi",
    kavachId: "KAV-033",
    category: "Penalty",
    title: "Match Late-Withdrawal Penalty",
    amount: 200,
    dueDate: "28 Oct 2026",
    status: "overdue_urgent",
    channel: null,
    collectedBy: null,
    receiptNo: null
  },
  {
    id: "fin-104",
    playerId: "p4",
    playerName: "Sameer Khan",
    kavachId: "KAV-018",
    category: "Match Fee",
    title: "Match Fee - vs Titan CC",
    amount: 500,
    dueDate: "18 Nov 2026",
    status: "pending",
    channel: null,
    collectedBy: null,
    receiptNo: null
  },
  {
    id: "fin-105",
    playerId: "p5",
    playerName: "Ashutosh Dixit",
    kavachId: "KAV-002",
    category: "Match Fee",
    title: "Match Fee - vs Royal Strikers",
    amount: 500,
    dueDate: "10 Nov 2026",
    status: "paid",
    channel: "Razorpay Online",
    collectedBy: "Automated Gateway",
    receiptNo: "REC-2026-1102"
  },
  {
    id: "fin-106",
    playerId: "p6",
    playerName: "Vikram Sharma",
    kavachId: "KAV-001",
    category: "Match Fee",
    title: "Match Fee - vs Metro CC",
    amount: 500,
    dueDate: "27 Oct 2026",
    status: "paid",
    channel: "Pitch-Side Cash",
    collectedBy: "Rahul Verma (Match Admin)",
    receiptNo: "REC-2026-1088"
  },
  {
    id: "fin-107",
    playerId: "p7",
    playerName: "Amit Patel",
    kavachId: "KAV-015",
    category: "Match Fee",
    title: "Match Fee - vs Super Kings (Rain Abandoned)",
    amount: 500,
    dueDate: "03 Nov 2026",
    status: "waived",
    channel: "Option A Auto-Waiver",
    collectedBy: "System (Policy A)",
    receiptNo: "VOID-ABANDONED-SK"
  }
];

const MOCK_NETS_SCHEDULE = [
  {
    id: "net-slot-1",
    time: "06:00 AM - 07:00 AM",
    lane1: { status: "booked", bookedBy: "Vikram Sharma (KAV-001)", type: "Fast Bowling Lane" },
    lane2: { status: "booked", bookedBy: "Rahul Verma (KAV-012)", type: "Spin / Multi-Turf" },
    lane3: { status: "coaching", bookedBy: "Coach Coach Academy", type: "Bowling Machine" }
  },
  {
    id: "net-slot-2",
    time: "07:00 AM - 08:00 AM",
    lane1: { status: "available", bookedBy: null, type: "Fast Bowling Lane" },
    lane2: { status: "booked", bookedBy: "Sameer Khan (KAV-018)", type: "Spin / Multi-Turf" },
    lane3: { status: "available", bookedBy: null, type: "Bowling Machine" }
  },
  {
    id: "net-slot-3",
    time: "06:00 PM - 07:00 PM",
    lane1: { status: "booked", bookedBy: "Ashutosh Dixit (KAV-002)", type: "Fast Bowling Lane" },
    lane2: { status: "available", bookedBy: null, type: "Spin / Multi-Turf" },
    lane3: { status: "booked", bookedBy: "Kunal Roy (KAV-021)", type: "Bowling Machine" }
  },
  {
    id: "net-slot-4",
    time: "07:00 PM - 08:00 PM",
    lane1: { status: "available", bookedBy: null, type: "Fast Bowling Lane" },
    lane2: { status: "available", bookedBy: null, type: "Spin / Multi-Turf" },
    lane3: { status: "available", bookedBy: null, type: "Bowling Machine" }
  }
];

const MOCK_STUDIO_PASSES = [
  { id: "pass-1", playerName: "Ashutosh Dixit", kavachId: "KAV-002", plan: "10-Session Pass", remaining: 7, total: 10, expiry: "15 Dec 2026" },
  { id: "pass-2", playerName: "Rohan Mehta", kavachId: "KAV-007", plan: "Monthly Unlimited", remaining: 18, total: 30, expiry: "30 Nov 2026" },
  { id: "pass-3", playerName: "Devendra Joshi", kavachId: "KAV-033", plan: "5-Session Pass", remaining: 1, total: 5, expiry: "22 Nov 2026" }
];

const MOCK_STUDIO_LEADS = [
  { id: "lead-1", name: "Ankit Gupta", phone: "+91 98210 11223", stage: "Trial Attended", interest: "Fast Bowling Machine", date: "Yesterday" },
  { id: "lead-2", name: "Prateek Shah", phone: "+91 97112 44556", stage: "Trial Requested", interest: "Weekend Net Pass", date: "Today" }
];

const MOCK_MERCH_ORDERS = [
  { id: "ORD-1092", playerName: "Rohan Mehta", kavachId: "KAV-007", item: "Match Jersey (Pro Fit)", size: "L", qty: 1, total: 850, status: "New Order", date: "16 Nov 2026" },
  { id: "ORD-1091", playerName: "Sameer Khan", kavachId: "KAV-018", item: "Club Cap & Training Polo", size: "M", qty: 2, total: 1200, status: "In Production", date: "14 Nov 2026" },
  { id: "ORD-1088", playerName: "Vikram Sharma", kavachId: "KAV-001", item: "Scarlet Match Jersey", size: "XL", qty: 1, total: 850, status: "Ready for Pickup", date: "10 Nov 2026" },
  { id: "ORD-1075", playerName: "Ashutosh Dixit", kavachId: "KAV-002", item: "Training Trousers", size: "34", qty: 1, total: 750, status: "Delivered", date: "02 Nov 2026" }
];

const MOCK_POLLS = [
  {
    id: "poll-1",
    title: "2027 Pre-Season Cricket Tour Destination",
    desc: "Vote for the club pre-season weekend tournament location.",
    totalVotes: 32,
    options: [
      { id: "opt-1", label: "Goa Cricket Festival (Beach + Leather Ball)", votes: 18, percentage: 56 },
      { id: "opt-2", label: "Bangalore Turf Grounds Invitational", votes: 10, percentage: 31 },
      { id: "opt-3", label: "Sri Lanka Colombo Club Series", votes: 4, percentage: 13 }
    ]
  }
];

const MOCK_RBAC_RULES = [
  {
    role: "Super Admin",
    desc: "Full root authority. Grants role permissions, executes player merges, overrides financial settings.",
    caps: ["Match Fixtures & Squads", "Record Cash & Dues", "Financial Reports", "Studio Bookings", "Merchandise Orders", "User Roles & RBAC"]
  },
  {
    role: "Club Admin",
    desc: "Operations leader. Manages roster, schedules fixtures, coordinates kit production and polls.",
    caps: ["Match Fixtures & Squads", "Record Cash & Dues", "Studio Bookings", "Merchandise Orders"]
  },
  {
    role: "Match Admin",
    desc: "Pitch-side match official. Updates live toss/scorecard, records cash payments for assigned match.",
    caps: ["Match Fixtures & Squads", "Record Cash (Pitch-side only)"]
  },
  {
    role: "Finance Admin",
    desc: "Club treasurer. Oversees bank reconciliations, levies fees, audits debtor aging, exports reports.",
    caps: ["Record Cash & Dues", "Financial Reports", "Levy Ad-Hoc Fees"]
  },
  {
    role: "Studio Admin",
    desc: "Facility manager. Manages net bookings, bowling machine slots, pass renewals and trials.",
    caps: ["Studio Bookings", "Manage Passes", "Studio CRM"]
  },
  {
    role: "Designer",
    desc: "Creative producer. Designs social media matchday graphics, score banners, and digital cards.",
    caps: ["Graphic Banners & Studio Canvas"]
  }
];

const MOCK_PERFORMANCE_METRICS = {
  summary: {
    matches: 24,
    innings: 22,
    runs: 384,
    battingAvg: 32.0,
    strikeRate: 138.4,
    highestScore: "104*",
    fifties: 2,
    hundreds: 1,
    wickets: 14,
    bowlingAvg: 18.2,
    economy: 6.8,
    bestBowling: "5/22",
    catches: 8
  },
  milestoneBadges: [
    { id: "b1", title: "Centurion Club", desc: "104* vs Titans CC", tier: "Gold", earnedDate: "12 Oct 2026" },
    { id: "b2", title: "Five-Wicket Haul", desc: "5/22 vs Royal Strikers", tier: "Gold", earnedDate: "03 Sep 2026" },
    { id: "b3", title: "Safe Hands", desc: "8 Catches in 2026 Season", tier: "Silver", earnedDate: "27 Oct 2026" },
    { id: "b4", title: "Player of the Match", desc: "64* & 1/32 vs Spartans CC", tier: "Gold", earnedDate: "10 Nov 2026" },
    { id: "b5", title: "Hat-trick Club", desc: "3 in 3 vs Metro CC", tier: "Platinum", earnedDate: "18 Aug 2026" }
  ],
  leaderboard: {
    batting: [
      { rank: 1, name: "Vikram Sharma", kavachId: "KAV-001", inngs: 24, runs: 482, avg: 48.2, sr: 142.6, hs: "88" },
      { rank: 2, name: "Ashutosh Dixit", kavachId: "KAV-002", inngs: 22, runs: 384, avg: 32.0, sr: 138.4, hs: "104*" },
      { rank: 3, name: "Rohan Mehta", kavachId: "KAV-007", inngs: 20, runs: 310, avg: 31.0, sr: 125.0, hs: "62" },
      { rank: 4, name: "Kunal Roy", kavachId: "KAV-021", inngs: 18, runs: 245, avg: 27.2, sr: 118.0, hs: "51*" }
    ],
    bowling: [
      { rank: 1, name: "Rahul Verma", kavachId: "KAV-012", overs: 48, wkts: 22, avg: 14.2, econ: 5.8, bb: "4/18" },
      { rank: 2, name: "Sameer Khan", kavachId: "KAV-018", overs: 44, wkts: 18, avg: 16.5, econ: 6.1, bb: "3/15" },
      { rank: 3, name: "Ashutosh Dixit", kavachId: "KAV-002", overs: 36, wkts: 14, avg: 18.2, econ: 6.8, bb: "5/22" },
      { rank: 4, name: "Devendra Joshi", kavachId: "KAV-033", overs: 30, wkts: 11, avg: 21.0, econ: 7.2, bb: "2/19" }
    ],
    fielding: [
      { rank: 1, name: "Rahul Verma", kavachId: "KAV-012", matches: 24, catches: 11, runOuts: 3 },
      { rank: 2, name: "Ashutosh Dixit", kavachId: "KAV-002", matches: 24, catches: 8, runOuts: 2 },
      { rank: 3, name: "Vikram Sharma", kavachId: "KAV-001", matches: 24, catches: 7, runOuts: 4 },
      { rank: 4, name: "Rohan Mehta", kavachId: "KAV-007", matches: 20, catches: 5, runOuts: 1 }
    ]
  },
  matchForm: [
    { match: "vs Royal Strikers", date: "10 Nov 2026", runs: "42 (28b)", bowling: "2/18 (4 ov)", result: "Won by 18 runs", potm: false },
    { match: "vs Metro CC", date: "27 Oct 2026", runs: "18 (14b)", bowling: "3/24 (4 ov)", result: "Won by 4 wkts", potm: false },
    { match: "vs Spartans CC", date: "12 Oct 2026", runs: "64* (41b)", bowling: "1/32 (4 ov)", result: "Won by 22 runs", potm: true },
    { match: "vs Titan CC", date: "28 Sep 2026", runs: "28 (20b)", bowling: "1/28 (3 ov)", result: "Lost by 12 runs", potm: false },
    { match: "vs Super Kings", date: "15 Sep 2026", runs: "DNB", bowling: "0/12 (2 ov)", result: "Rain Abandoned (Option A)", potm: false }
  ]
};

const MOCK_CLUB_SHOP_ITEMS = [
  {
    id: "shop-1",
    title: "Official Match Jersey (Scarlet)",
    price: 850,
    category: "Apparel",
    description: "Pro-Dry breathable fabric with sublimated KAvach crest, personalized player name and jersey number.",
    sizes: ["S", "M", "L", "XL", "XXL"],
    badge: "Official Matchwear"
  },
  {
    id: "shop-2",
    title: "Club Training Polo",
    price: 650,
    category: "Apparel",
    description: "Lightweight moisture-wicking polo for nets, fitness training and off-field club events.",
    sizes: ["S", "M", "L", "XL", "XXL"],
    badge: "Bestseller"
  },
  {
    id: "shop-3",
    title: "Embroidered Cricket Cap",
    price: 350,
    category: "Accessories",
    description: "Deep scarlet cap with 3D gold-embroidered KAvach emblem and adjustable brass buckle.",
    sizes: ["One Size Fits All"],
    badge: "Accessories"
  },
  {
    id: "shop-4",
    title: "Match Turf Trousers",
    price: 750,
    category: "Apparel",
    description: "Stretch performance white trousers with reinforced knee pads and elasticated waistband.",
    sizes: ["30", "32", "34", "36", "38"],
    badge: "Matchwear"
  }
];

const MOCK_GROUNDS_LIST = [
  { id: "g1", name: "Kavach Arena Ground 1", pitch: "Natural Turf", boundary: "68m", lights: "Yes (Full Match Ready)", address: "Sector 62 Sports Complex, Noida" },
  { id: "g2", name: "Kavach Arena Ground 2", pitch: "AstroTurf / Multi-pitch", boundary: "60m", lights: "Yes (Training)", address: "Sector 62 Sports Complex, Noida" },
  { id: "g3", name: "City Oval Turf Ground", pitch: "Hard Leather Ball Turf", boundary: "72m", lights: "No (Day Match)", address: "Greater Noida Expressway Grounds" }
];

const MOCK_TOURNAMENTS_LIST = [
  { id: "t1", name: "Premier Cricket League 2026", format: "T20 Leather Ball", status: "In Progress", matchesPlayed: "4 of 6", clubRank: "2nd (3 Wins, 1 Loss)", prize: "₹1,50,000" },
  { id: "t2", name: "Delhi-NCR Pre-Season Cup", format: "35 Overs One Day", status: "Completed", matchesPlayed: "5 of 5", clubRank: "Champions 🏆", prize: "₹75,000" }
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
  
  // Persona Toggle: 'player' | 'admin'
  const [persona, setPersona] = useState<"player" | "admin">("player");

  // Navigation & View States
  const [activeTab, setActiveTab] = useState<"home" | "matches" | "payments" | "performance" | "club">("home");
  const [adminHub, setAdminHub] = useState<"overview" | "matches" | "people" | "finance" | "studio" | "design" | "settings">("overview");

  // Matches Tab States
  const [matchFilter, setMatchFilter] = useState<"all" | "upcoming" | "past" | "abandoned">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMatch, setSelectedMatch] = useState<any | null>(null);
  const [selectedMatchSubTab, setSelectedMatchSubTab] = useState<"overview" | "scorecard" | "catches">("overview");

  // Admin Match Management Drawer
  const [adminMatchSquadDrawer, setAdminMatchSquadDrawer] = useState<any | null>(null);

  // Admin Roster & Profile Drawer States
  const [rosterList, setRosterList] = useState(MOCK_ROSTER_PLAYERS);
  const [rosterFilter, setRosterFilter] = useState<"all" | "pending" | "active" | "injured">("all");
  const [rosterSearch, setRosterSearch] = useState("");
  const [selectedPlayerProfile, setSelectedPlayerProfile] = useState<any | null>(null);
  const [jerseyValidationWarning, setJerseyValidationWarning] = useState<string | null>(null);
  const [mergeModalOpen, setMergeModalOpen] = useState(false);

  // Payments Tab States
  const [duesState, setDuesState] = useState(MOCK_CURRENT_PLAYER.dues);
  const [selectedReceipt, setSelectedReceipt] = useState<any | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  // Admin Quick Action Modals
  const [createMatchModalOpen, setCreateMatchModalOpen] = useState(false);
  const [recordCashModalOpen, setRecordCashModalOpen] = useState(false);
  const [adminAlerts, setAdminAlerts] = useState(MOCK_ADMIN_ALERTS);

  // Stage 5 Admin Finance States
  const [financeRecords, setFinanceRecords] = useState(MOCK_ADMIN_FINANCE_RECORDS);
  const [financeFilter, setFinanceFilter] = useState<"all" | "unpaid" | "urgent" | "paid" | "waived">("all");
  const [financeSearch, setFinanceSearch] = useState("");
  const [adHocFeeModalOpen, setAdHocFeeModalOpen] = useState(false);
  const [selectedAuditTx, setSelectedAuditTx] = useState<any | null>(null);

  // Stage 5 Studio & Nets States
  const [netsSchedule, setNetsSchedule] = useState(MOCK_NETS_SCHEDULE);
  const [selectedStudioDate, setSelectedStudioDate] = useState<"Today" | "Tomorrow" | "Saturday" | "Sunday">("Today");
  const [bookSlotModalOpen, setBookSlotModalOpen] = useState(false);

  // Stage 5 Club Operations States
  const [merchOrders, setMerchOrders] = useState(MOCK_MERCH_ORDERS);
  const [merchFilter, setMerchFilter] = useState<"all" | "new" | "production" | "ready" | "delivered">("all");
  const [pollData, setPollData] = useState(MOCK_POLLS[0]);
  const [selectedPollOption, setSelectedPollOption] = useState<string | null>(null);
  const [hasVotedPoll, setHasVotedPoll] = useState(false);

  // Stage 5 Settings & RBAC States
  const [activeRoleName, setActiveRoleName] = useState("Super Admin");

  // Performance Tab States
  const [perfSubTab, setPerfSubTab] = useState<"overview" | "leaderboard" | "badges" | "timeline">("overview");
  const [leaderboardCategory, setLeaderboardCategory] = useState<"batting" | "bowling" | "fielding">("batting");

  // Club Experience Tab States
  const [clubSubTab, setClubSubTab] = useState<"card" | "studio" | "shop" | "info">("card");
  const [shopItemOrderModal, setShopItemOrderModal] = useState<any | null>(null);
  const [selectedShopSize, setSelectedShopSize] = useState<string>("M");

  // Design Studio Interactive Canvas Generator States
  const [designStudioModal, setDesignStudioModal] = useState(false);
  const [designTemplate, setDesignTemplate] = useState<"matchday" | "potm" | "squad" | "result">("matchday");
  const [designMatch, setDesignMatch] = useState("KAvach Cricket Club vs Spartans CC");
  const [designPlayer, setDesignPlayer] = useState("Ashutosh Dixit");

  // Admin Match Hub Sub-tab (Fixtures, Grounds, Tournaments)
  const [adminMatchHubTab, setAdminMatchHubTab] = useState<"fixtures" | "grounds" | "tournaments">("fixtures");

  // Prototype Simulation Toast Banner
  const [simulationToast, setSimulationToast] = useState<string | null>(null);
  const showSimulationToast = (msg: string) => {
    setSimulationToast(msg);
    setTimeout(() => {
      setSimulationToast((curr) => (curr === msg ? null : curr));
    }, 4500);
  };

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

  // Filtered Roster logic
  const filteredRoster = rosterList.filter((p) => {
    if (rosterFilter === "pending" && p.status !== "pending") return false;
    if (rosterFilter === "active" && p.status !== "active") return false;
    if (rosterFilter === "injured" && p.status !== "injured") return false;
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.kavachId.toLowerCase().includes(q) || p.jerseyNumber.includes(q);
    }
    return true;
  });

  // Keyboard Accessibility: Close active modal or drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (paymentModalOpen) setPaymentModalOpen(false);
        else if (selectedMatch) setSelectedMatch(null);
        else if (selectedReceipt) setSelectedReceipt(null);
        else if (createMatchModalOpen) setCreateMatchModalOpen(false);
        else if (recordCashModalOpen) setRecordCashModalOpen(false);
        else if (mergeModalOpen) setMergeModalOpen(false);
        else if (adHocFeeModalOpen) setAdHocFeeModalOpen(false);
        else if (selectedAuditTx) setSelectedAuditTx(null);
        else if (bookSlotModalOpen) setBookSlotModalOpen(false);
        else if (shopItemOrderModal) setShopItemOrderModal(null);
        else if (selectedPlayerProfile) setSelectedPlayerProfile(null);
        else if (adminMatchSquadDrawer) setAdminMatchSquadDrawer(null);
        else if (notificationsOpen) setNotificationsOpen(false);
        else if (designStudioModal) setDesignStudioModal(false);
        else if (simulationToast) setSimulationToast(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    paymentModalOpen,
    selectedMatch,
    selectedReceipt,
    createMatchModalOpen,
    recordCashModalOpen,
    mergeModalOpen,
    adHocFeeModalOpen,
    selectedAuditTx,
    bookSlotModalOpen,
    shopItemOrderModal,
    selectedPlayerProfile,
    adminMatchSquadDrawer,
    notificationsOpen,
    designStudioModal,
    simulationToast,
  ]);

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

  // Resolve admin alert
  const dismissAlert = (alertId: string) => {
    setAdminAlerts(prev => prev.filter(a => a.id !== alertId));
  };

  // Approve pending player
  const handleApprovePlayer = (playerId: string) => {
    setRosterList(prev => prev.map(p => {
      if (p.id === playerId) {
        return {
          ...p,
          status: "active",
          kavachId: `KAV-0${Math.floor(Math.random() * 80 + 30)}`
        };
      }
      return p;
    }));
    setSimulationToast("[PROTOTYPE SIMULATION] Member approved locally; sequential KAvach ID generated (no backend mutation).");
  };

  // Toggle match attendance
  const handleToggleAttendance = (matchPlayerName: string) => {
    if (!adminMatchSquadDrawer) return;
    setAdminMatchSquadDrawer((prev: any) => ({
      ...prev,
      playingXI: prev.playingXI.map((pl: any) => {
        if (pl.name === matchPlayerName) {
          const next = pl.attendance === "Present" ? "Late" : pl.attendance === "Late" ? "Absent" : "Present";
          return { ...pl, attendance: next };
        }
        return pl;
      })
    }));
  };

  // Real-time jersey validation in profile editor
  const handleJerseyChange = (val: string) => {
    if (selectedPlayerProfile) {
      setSelectedPlayerProfile({ ...selectedPlayerProfile, jerseyNumber: val });
      if (val === "10") {
        setJerseyValidationWarning("Jersey #10 is reserved (Club Honor). Please select an alternate number.");
      } else if (val && isNaN(Number(val))) {
        setJerseyValidationWarning("Jersey must be a numeric value.");
      } else {
        setJerseyValidationWarning(null);
      }
    }
  };

  // Filtered Finance Records
  const filteredFinanceRecords = financeRecords.filter((rec) => {
    if (financeFilter === "unpaid" && !["overdue_recent", "overdue_urgent", "pending"].includes(rec.status)) return false;
    if (financeFilter === "urgent" && rec.status !== "overdue_urgent") return false;
    if (financeFilter === "paid" && rec.status !== "paid") return false;
    if (financeFilter === "waived" && rec.status !== "waived") return false;
    if (financeSearch.trim()) {
      const q = financeSearch.toLowerCase();
      return (
        rec.playerName.toLowerCase().includes(q) ||
        rec.kavachId.toLowerCase().includes(q) ||
        rec.title.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filtered Merch Orders
  const filteredMerchOrders = merchOrders.filter((ord) => {
    if (merchFilter === "new" && ord.status !== "New Order") return false;
    if (merchFilter === "production" && ord.status !== "In Production") return false;
    if (merchFilter === "ready" && ord.status !== "Ready for Pickup") return false;
    if (merchFilter === "delivered" && ord.status !== "Delivered") return false;
    return true;
  });

  // Advance Merch Order Status
  const handleAdvanceOrderStatus = (orderId: string) => {
    setMerchOrders(prev => prev.map(o => {
      if (o.id === orderId) {
        const nextStatus = 
          o.status === "New Order" ? "In Production" :
          o.status === "In Production" ? "Ready for Pickup" :
          o.status === "Ready for Pickup" ? "Delivered" : "Delivered";
        return { ...o, status: nextStatus };
      }
      return o;
    }));
  };

  // Submit Poll Vote
  const handleVotePoll = () => {
    if (!selectedPollOption) return;
    setPollData(prev => {
      const updated = prev.options.map(opt => {
        if (opt.id === selectedPollOption) {
          return { ...opt, votes: opt.votes + 1 };
        }
        return opt;
      });
      const newTotal = prev.totalVotes + 1;
      return {
        ...prev,
        totalVotes: newTotal,
        options: updated.map(opt => ({
          ...opt,
          percentage: Math.round((opt.votes / newTotal) * 100)
        }))
      };
    });
    setHasVotedPoll(true);
    setSimulationToast("[PROTOTYPE SIMULATION] Member vote recorded locally on test tally (no backend mutation).");
  };

  // Record Manual Payment (Cash / Pitch UPI)
  const handleRecordManualPayment = (recordId: string, method: string, collector: string) => {
    setFinanceRecords(prev => prev.map(r => {
      if (r.id === recordId) {
        return {
          ...r,
          status: "paid",
          channel: method,
          collectedBy: collector,
          receiptNo: `REC-2026-${Math.floor(1000 + Math.random() * 9000)}`
        };
      }
      return r;
    }));
    setSimulationToast(`[PROTOTYPE SIMULATION] Pitch payment simulated via ${method} by ${collector} (no live ledger mutation).`);
  };

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-[#171C26] font-sans">
      {/* Top Prototype Control Bar */}
      <div className="bg-[#171C26] text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs border-b border-gray-800 sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#A30F2D] text-white font-bold text-[10px] uppercase tracking-wider">
            Prototype Preview
          </span>
          <span className="font-semibold text-gray-200">Phase 4: Complete UX Blueprint & Navigable Prototypes (Remediated)</span>
        </div>

        {/* Viewport Frame Mode Controls & Prominent Persona Switcher */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Explicit Dual Persona Switcher */}
          <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-xl border border-gray-700">
            <button
              onClick={() => setPersona("player")}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                persona === "player" ? "bg-[#D51F43] text-white shadow-xs" : "text-gray-300 hover:text-white"
              }`}
              title="Switch to Player View"
            >
              <User className="w-4 h-4" />
              <span>View Player</span>
            </button>
            <button
              onClick={() => setPersona("admin")}
              className={`min-h-[44px] px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                persona === "admin" ? "bg-[#A30F2D] text-white shadow-xs" : "text-gray-300 hover:text-white"
              }`}
              title="Switch to Admin Console"
            >
              <Shield className="w-4 h-4" />
              <span>View Admin (Console)</span>
            </button>
          </div>

          {/* Viewport Device Frames */}
          <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-xl">
            <button
              onClick={() => setDeviceFrame("responsive")}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1 transition ${
                deviceFrame === "responsive" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Fluid Responsive
            </button>
            <button
              onClick={() => setDeviceFrame("mobile")}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                deviceFrame === "mobile" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              <Smartphone className="w-4 h-4" />
              Mobile 390px
            </button>
            <button
              onClick={() => setDeviceFrame("desktop")}
              className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1.5 transition ${
                deviceFrame === "desktop" ? "bg-[#D51F43] text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              <Monitor className="w-4 h-4" />
              Desktop 1280px
            </button>
          </div>
        </div>
      </div>

      {/* Floating Prototype Simulation Toast */}
      {simulationToast && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full px-4 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="bg-[#171C26] text-white px-4 py-3 rounded-2xl shadow-2xl border border-[#D51F43]/50 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded bg-[#D51F43] text-white font-mono text-[9px] font-black uppercase shrink-0">
                Simulation
              </span>
              <span className="text-gray-200 font-medium truncate">{simulationToast}</span>
            </div>
            <button
              onClick={() => setSimulationToast(null)}
              aria-label="Dismiss notification toast"
              className="text-gray-400 hover:text-white shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

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
              {/* Persona Switcher Shield Button */}
              {MOCK_CURRENT_PLAYER.isAdmin && (
                <button
                  onClick={() => setPersona(persona === "player" ? "admin" : "player")}
                  className={`min-h-[44px] px-3 rounded-xl border transition flex items-center gap-1.5 text-xs font-bold ${
                    persona === "admin"
                      ? "bg-[#A30F2D] text-white border-[#A30F2D] shadow-xs"
                      : "bg-[#FCE8ED]/50 hover:bg-[#FCE8ED] text-[#A30F2D] border-[#A30F2D]/20"
                  }`}
                  title={persona === "admin" ? "Switch to Player View" : "Enter Admin Console"}
                >
                  <Shield className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {persona === "admin" ? "Switch: View Player" : "Switch: Admin Console"}
                  </span>
                  <span className="sm:hidden">{persona === "admin" ? "To Player" : "To Admin"}</span>
                </button>
              )}

              {/* Notification Bell */}
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
                onClick={() => {
                  setPersona("player");
                  setActiveTab("club");
                }}
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

          {/* ADMIN CONTEXT BANNER & HUB SELECTOR (Rendered only when persona === "admin") */}
          {persona === "admin" && (
            <div className="bg-[#A30F2D] text-white shadow-md z-30">
              <div className="px-4 py-2.5 flex items-center justify-between border-b border-white/10 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Shield className="w-4 h-4 text-amber-300 shrink-0" />
                  <span className="font-black uppercase tracking-wider text-[11px] truncate">
                    Operations: {adminHub.toUpperCase()} COMMAND HUB
                  </span>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold hidden sm:inline">
                    {MOCK_CURRENT_PLAYER.adminRole}
                  </span>
                </div>

                <button
                  onClick={() => setPersona("player")}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white font-bold text-xs flex items-center gap-1.5 transition shrink-0"
                >
                  <span>Return to Player View</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 7 Admin Command Hub Selector */}
              <nav role="navigation" aria-label="Admin Hub Navigation" className="px-3 py-2 flex items-center gap-1.5 overflow-x-auto text-xs font-bold scrollbar-none">
                {[
                  { key: "overview", label: "Overview", icon: Activity },
                  { key: "matches", label: "Match Centre", icon: Trophy },
                  { key: "people", label: "Player Roster", icon: Users },
                  { key: "finance", label: "Finance & Dues", icon: CreditCard },
                  { key: "studio", label: "Studio & Nets", icon: Sparkles },
                  { key: "design", label: "Club Operations", icon: Award },
                  { key: "settings", label: "Settings", icon: Settings }
                ].map((hub) => {
                  const Icon = hub.icon;
                  const isActive = adminHub === hub.key;
                  return (
                    <button
                      key={hub.key}
                      onClick={() => setAdminHub(hub.key as any)}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl flex items-center gap-1.5 whitespace-nowrap transition ${
                        isActive
                          ? "bg-white text-[#A30F2D] shadow-sm font-black"
                          : "text-white/80 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{hub.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

          {/* DESKTOP FLEX LAYOUT CONTAINER */}
          <div className="flex-1 flex w-full overflow-hidden">
            {/* 1. DESKTOP SIDEBAR NAVIGATION (Visible on Desktop / Large screens) */}
            <aside
              className={`w-64 bg-white border-r border-[#E5E7EB] shrink-0 p-4 flex-col justify-between hidden ${
                deviceFrame === "desktop" ? "!flex" : deviceFrame === "responsive" ? "lg:flex" : ""
              }`}
            >
              <div className="space-y-6">
                {/* Brand / Mode badge */}
                <div className="flex items-center gap-2.5 px-2">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#A30F2D] to-[#D51F43] flex items-center justify-center text-white font-black text-xs shadow-xs">
                    {persona === "player" ? "KP" : "OPS"}
                  </div>
                  <div>
                    <h2 className="text-xs font-black uppercase text-[#171C26]">
                      {persona === "player" ? "KAvach Player" : "Admin Operations"}
                    </h2>
                    <span className="text-[10px] text-gray-500 font-medium">
                      {persona === "player" ? "Squad Member" : MOCK_CURRENT_PLAYER.adminRole}
                    </span>
                  </div>
                </div>

                {/* Navigation Links */}
                {persona === "player" ? (
                  <nav className="space-y-1" aria-label="Desktop Player Navigation">
                    {[
                      { key: "home", label: "Home Feed", icon: Calendar },
                      { key: "matches", label: "Matches & Fixtures", icon: Trophy },
                      { key: "payments", label: "Dues & Payments", icon: CreditCard },
                      { key: "performance", label: "Performance & Stats", icon: TrendingUp },
                      { key: "club", label: "Club & Membership", icon: Shield }
                    ].map((tab) => {
                      const Icon = tab.icon;
                      const isActive = activeTab === tab.key;
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setActiveTab(tab.key as any)}
                          className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                            isActive
                              ? "bg-[#D51F43] text-white shadow-xs font-black"
                              : "text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </nav>
                ) : (
                  <nav className="space-y-1" aria-label="Desktop Admin Navigation">
                    {[
                      { key: "overview", label: "Overview", icon: Activity },
                      { key: "matches", label: "Match Centre", icon: Trophy },
                      { key: "people", label: "Player Roster", icon: Users },
                      { key: "finance", label: "Finance & Dues", icon: CreditCard },
                      { key: "studio", label: "Studio & Nets", icon: Sparkles },
                      { key: "design", label: "Club Operations", icon: Award },
                      { key: "settings", label: "Settings & Access", icon: Settings }
                    ].map((hub) => {
                      const Icon = hub.icon;
                      const isActive = adminHub === hub.key;
                      return (
                        <button
                          key={hub.key}
                          onClick={() => setAdminHub(hub.key as any)}
                          className={`w-full min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-3 transition ${
                            isActive
                              ? "bg-[#A30F2D] text-white shadow-xs font-black"
                              : "text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span>{hub.label}</span>
                        </button>
                      );
                    })}
                  </nav>
                )}
              </div>

              {/* Bottom Card / Mode Switcher */}
              <div className="pt-4 border-t border-gray-100 space-y-3">
                <button
                  onClick={() => setPersona(persona === "player" ? "admin" : "player")}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition ${
                    persona === "player"
                      ? "bg-[#FCE8ED] text-[#A30F2D] hover:bg-[#FCE8ED]/80"
                      : "bg-gray-900 text-white hover:bg-black"
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  <span>{persona === "player" ? "Switch: Admin Console" : "Switch: View Player"}</span>
                </button>

                <div className="flex items-center gap-2.5 p-2 rounded-xl bg-gray-50 border border-gray-100">
                  <img
                    src={MOCK_CURRENT_PLAYER.avatar}
                    alt={MOCK_CURRENT_PLAYER.name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-[#171C26] truncate">{MOCK_CURRENT_PLAYER.name}</div>
                    <div className="font-mono text-[10px] text-gray-500">#{MOCK_CURRENT_PLAYER.jerseyNumber} • {MOCK_CURRENT_PLAYER.kavachId}</div>
                  </div>
                </div>
              </div>
            </aside>

            {/* 2. CENTRAL WORKSPACE CONTENT */}
            <main className="flex-1 pb-24 px-4 sm:px-6 py-5 max-w-5xl mx-auto w-full overflow-y-auto">
            
            {/* ========================================================================= */}
            {/* ADMIN HUB 1: OVERVIEW COMMAND HUB                                         */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "overview" && (
              <div className="space-y-6">
                {/* Quick Actions */}
                <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-[#E5E7EB] shadow-xs flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-black uppercase tracking-wider text-[#667085] mr-1 hidden sm:inline">
                    Quick Launch:
                  </span>
                  <button
                    onClick={() => setCreateMatchModalOpen(true)}
                    className="min-h-[44px] px-3.5 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Match</span>
                  </button>
                  <button
                    onClick={() => setRecordCashModalOpen(true)}
                    className="min-h-[44px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs"
                  >
                    <DollarSign className="w-4 h-4" />
                    <span>Record Pitch Cash</span>
                  </button>
                  <button
                    onClick={() => setSimulationToast("[PROTOTYPE SIMULATION] Member invite link copied to clipboard: https://play.kavachcricket.com/join")}
                    className="min-h-[44px] px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-[#171C26] text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                  >
                    <UserPlus className="w-4 h-4 text-gray-600" />
                    <span>Invite Member</span>
                  </button>
                  <button
                    onClick={() => setSimulationToast("[PROTOTYPE SIMULATION] Broadcast announcement modal triggered (simulation only).")}
                    className="min-h-[44px] px-3.5 py-2 bg-gray-100 hover:bg-gray-200 text-[#171C26] text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                  >
                    <Send className="w-4 h-4 text-gray-600" />
                    <span>Broadcast Feed</span>
                  </button>
                </div>

                {/* 4 Operations KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-[#667085] font-semibold">
                        <span>Next Match Readiness</span>
                        <Trophy className="w-4 h-4 text-[#D51F43]" />
                      </div>
                      <div className="text-xl font-black text-[#171C26] mt-2">
                        {MOCK_ADMIN_KPIS.nextMatch.confirmedXI} / {MOCK_ADMIN_KPIS.nextMatch.squadTarget} Playing
                      </div>
                      <p className="text-xs text-[#667085] mt-0.5">
                        {MOCK_ADMIN_KPIS.nextMatch.title} • {MOCK_ADMIN_KPIS.nextMatch.date}
                      </p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px]">
                      <span className="text-amber-700 font-bold">
                        {MOCK_ADMIN_KPIS.nextMatch.pendingRsvps} RSVPs Pending
                      </span>
                      <button
                        onClick={() => setAdminHub("matches")}
                        className="min-h-[44px] px-2 font-bold text-[#D51F43] hover:underline flex items-center"
                      >
                        Manage Squad
                      </button>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-[#667085] font-semibold">
                        <span>Collections (Nov)</span>
                        <CreditCard className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="text-xl font-black text-emerald-700 mt-2">
                        ₹{MOCK_ADMIN_KPIS.finance.collectedMonth.toLocaleString("en-IN")}
                      </div>
                      <p className="text-xs text-[#667085] mt-0.5">
                        {MOCK_ADMIN_KPIS.finance.collectionRate}% of monthly budget
                      </p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px]">
                      <span className="text-rose-700 font-bold">
                        ₹{MOCK_ADMIN_KPIS.finance.unpaidDues} Overdue ({MOCK_ADMIN_KPIS.finance.unpaidPlayersCount}p)
                      </span>
                      <button
                        onClick={() => setAdminHub("finance")}
                        className="min-h-[44px] px-2 font-bold text-[#D51F43] hover:underline flex items-center"
                      >
                        Dues Ledger
                      </button>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-[#667085] font-semibold">
                        <span>Active Player Roster</span>
                        <Users className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="text-xl font-black text-[#171C26] mt-2">
                        {MOCK_ADMIN_KPIS.roster.activePlayers} Players
                      </div>
                      <p className="text-xs text-[#667085] mt-0.5">
                        {MOCK_ADMIN_KPIS.roster.injuredOut} currently out of play
                      </p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px]">
                      <span className="text-amber-700 font-bold">
                        {MOCK_ADMIN_KPIS.roster.pendingApprovals} Pending Approval
                      </span>
                      <button
                        onClick={() => setAdminHub("people")}
                        className="min-h-[44px] px-2 font-bold text-[#D51F43] hover:underline flex items-center"
                      >
                        Review Roster
                      </button>
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between text-xs text-[#667085] font-semibold">
                        <span>Studio & Nets</span>
                        <Sparkles className="w-4 h-4 text-purple-600" />
                      </div>
                      <div className="text-xl font-black text-[#171C26] mt-2">
                        {MOCK_ADMIN_KPIS.studio.slotOccupancyPercent}% Occupancy
                      </div>
                      <p className="text-xs text-[#667085] mt-0.5">
                        {MOCK_ADMIN_KPIS.studio.activePassHolders} active facility passes
                      </p>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px]">
                      <span className="text-[#667085] font-medium">
                        {MOCK_ADMIN_KPIS.studio.renewalsDueNext48h} renewals in 48h
                      </span>
                      <button
                        onClick={() => setAdminHub("studio")}
                        className="min-h-[44px] px-2 font-bold text-[#D51F43] hover:underline flex items-center"
                      >
                        Manage Slots
                      </button>
                    </div>
                  </div>
                </div>

                {/* Urgent Operations Alerts */}
                <section className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-[#667085] flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-[#D51F43]" />
                    Urgent Operations Queue ({adminAlerts.length})
                  </h3>

                  <div className="space-y-3">
                    {adminAlerts.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl border border-gray-100 bg-gray-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${
                              item.level === "urgent" ? "bg-rose-500" : item.level === "warning" ? "bg-amber-500" : "bg-blue-500"
                            }`} />
                            <h4 className="font-bold text-xs text-[#171C26]">{item.title}</h4>
                          </div>
                          <p className="text-xs text-[#667085] mt-1 pl-4">
                            {item.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 self-start sm:self-auto pl-4 sm:pl-0">
                          <button
                            onClick={() => {
                              setSimulationToast(`[PROTOTYPE SIMULATION] Admin action simulated: ${item.actionLabel}`);
                              dismissAlert(item.id);
                            }}
                            className="min-h-[44px] px-3.5 py-2 bg-[#A30F2D] hover:bg-[#D51F43] text-white text-xs font-bold rounded-xl transition"
                          >
                            {item.actionLabel}
                          </button>
                          <button
                            onClick={() => dismissAlert(item.id)}
                            className="min-h-[44px] px-3.5 py-2 text-gray-400 hover:text-gray-700 text-xs font-medium"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {/* ========================================================================= */}
            {/* ADMIN HUB 2: MATCH CENTRE (Stage 4 Core Deliverable)                      */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "matches" && (
              <div className="space-y-5">
                {/* Hub Header & Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs">
                  <div>
                    <h2 className="text-base font-black text-[#171C26] uppercase tracking-tight flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-[#D51F43]" />
                      Match Centre & Squad Operations
                    </h2>
                    <p className="text-xs text-[#667085] mt-0.5">
                      Schedule fixtures, coordinate squad availability, announce Playing XIs, manage grounds and log pitch-side cash.
                    </p>
                  </div>

                  <button
                    onClick={() => setCreateMatchModalOpen(true)}
                    className="min-h-[44px] px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Schedule New Match</span>
                  </button>
                </div>

                {/* Sub-Tabs: Fixtures | Grounds & Venues | Tournaments */}
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                  {[
                    { key: "fixtures", label: "Fixtures & Squads" },
                    { key: "grounds", label: "Grounds & Venues (MOD-10)" },
                    { key: "tournaments", label: "Tournaments & Leagues (MOD-17)" }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => setAdminMatchHubTab(tab.key as any)}
                      className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                        adminMatchHubTab === tab.key
                          ? "bg-[#D51F43] text-white shadow-xs font-black"
                          : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab 1: Fixtures & Squads */}
                {adminMatchHubTab === "fixtures" && (
                  <div className="space-y-4">
                    {MOCK_MATCHES.map((m) => (
                      <div
                        key={m.id}
                        className="bg-white rounded-2xl border border-[#E5E7EB] p-4 sm:p-5 shadow-xs space-y-3"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
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
                            <h3 className="text-base font-black text-[#171C26] mt-1">{m.title}</h3>
                            <p className="text-xs text-[#667085] flex items-center gap-1 mt-0.5">
                              <MapPin className="w-3.5 h-3.5" />
                              {m.venue}
                            </p>
                          </div>

                          {/* Action buttons with Role badges */}
                          <div className="flex flex-wrap items-center gap-2">
                            {m.playingXI && (
                              <button
                                onClick={() => setAdminMatchSquadDrawer(m)}
                                className="min-h-[44px] px-3.5 py-1.5 bg-[#FCE8ED] hover:bg-[#A30F2D] hover:text-white text-[#A30F2D] text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                              >
                                <Users className="w-3.5 h-3.5" />
                                <span>Squad & Attendance ({m.playingXI.length})</span>
                                <span className="font-mono text-[9px] uppercase px-1 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-200 ml-1">
                                  Match Admin
                                </span>
                              </button>
                            )}

                            <button
                              onClick={() => setRecordCashModalOpen(true)}
                              className="min-h-[44px] px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                            >
                              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Pitch Cash</span>
                              <span className="font-mono text-[9px] uppercase px-1 py-0.2 rounded bg-emerald-100 text-emerald-900 border border-emerald-200 ml-1">
                                Assigned Match
                              </span>
                            </button>
                          </div>
                        </div>

                        {/* Squad readiness bar */}
                        {m.playingXI && (
                          <div className="flex items-center justify-between text-xs text-[#667085]">
                            <span>Confirmed Squad: 11 / 14 Players</span>
                            <span className="text-emerald-700 font-bold">XI Published</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tab 2: Grounds & Venues (MOD-10) */}
                {adminMatchHubTab === "grounds" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {MOCK_GROUNDS_LIST.map((g) => (
                        <div key={g.id} className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{g.id.toUpperCase()}</span>
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">{g.lights}</span>
                          </div>
                          <h4 className="font-bold text-sm text-[#171C26]">{g.name}</h4>
                          <p className="text-xs text-gray-600">Pitch: <span className="font-semibold">{g.pitch}</span> • Boundary: {g.boundary}</p>
                          <p className="text-[11px] text-gray-400">{g.address}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tab 3: Tournaments & Leagues (MOD-17) */}
                {adminMatchHubTab === "tournaments" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {MOCK_TOURNAMENTS_LIST.map((t) => (
                        <div key={t.id} className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#FCE8ED] text-[#A30F2D]">{t.format}</span>
                            <span className="text-xs font-bold text-emerald-700">{t.status}</span>
                          </div>
                          <h4 className="font-black text-base text-[#171C26]">{t.name}</h4>
                          <div className="text-xs text-gray-600 space-y-1">
                            <div>Matches: <span className="font-bold text-[#171C26]">{t.matchesPlayed}</span></div>
                            <div>Current Club Standing: <span className="font-black text-[#D51F43]">{t.clubRank}</span></div>
                            <div>Prize Pool: <span className="font-bold text-amber-700">{t.prize}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* ADMIN HUB 3: PLAYER ROSTER (Stage 4 Core Deliverable)                     */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "people" && (
              <div className="space-y-5">
                {/* Header & Filter Controls */}
                <div className="bg-white p-4 rounded-2xl border border-[#E5E7EB] shadow-xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-black text-[#171C26] uppercase tracking-tight flex items-center gap-2">
                        <Users className="w-5 h-5 text-[#D51F43]" />
                        Club Player Roster & Memberships
                      </h2>
                      <p className="text-xs text-[#667085] mt-0.5">
                        Manage player profiles, member approvals, granular permissions, and identity mergers.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setMergeModalOpen(true)}
                        className="min-h-[44px] px-3.5 py-2 border border-gray-300 hover:bg-gray-100 text-[#171C26] text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                      >
                        <GitMerge className="w-4 h-4 text-gray-600" />
                        <span>Merge Duplicate</span>
                      </button>
                      <button
                        onClick={() => setSimulationToast("[PROTOTYPE SIMULATION] Member invitation generator triggered (simulation only).")}
                        className="min-h-[44px] px-3.5 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Invite Player</span>
                      </button>
                    </div>
                  </div>

                  {/* Filter Pills & Search */}
                  <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                      <button
                        onClick={() => setRosterFilter("all")}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          rosterFilter === "all" ? "bg-[#A30F2D] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                        }`}
                      >
                        All Members ({rosterList.length})
                      </button>
                      <button
                        onClick={() => setRosterFilter("pending")}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          rosterFilter === "pending" ? "bg-amber-600 text-white shadow-xs" : "bg-amber-50 text-amber-800 hover:bg-amber-100"
                        }`}
                      >
                        Pending Review ({rosterList.filter(p => p.status === "pending").length})
                      </button>
                      <button
                        onClick={() => setRosterFilter("active")}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          rosterFilter === "active" ? "bg-emerald-600 text-white shadow-xs" : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                        }`}
                      >
                        Active ({rosterList.filter(p => p.status === "active").length})
                      </button>
                      <button
                        onClick={() => setRosterFilter("injured")}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                          rosterFilter === "injured" ? "bg-rose-600 text-white shadow-xs" : "bg-rose-50 text-rose-800 hover:bg-rose-100"
                        }`}
                      >
                        Injured / Out ({rosterList.filter(p => p.status === "injured").length})
                      </button>
                    </div>

                    <div className="relative min-w-[200px]">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search name, KAV-ID, jersey..."
                        value={rosterSearch}
                        onChange={(e) => setRosterSearch(e.target.value)}
                        className="w-full text-xs pl-9 pr-3 py-2 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Roster List Cards */}
                <div className="space-y-3">
                  {filteredRoster.map((player) => (
                    <div
                      key={player.id}
                      className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#FCE8ED] text-[#A30F2D] font-black text-sm flex items-center justify-center shrink-0">
                          #{player.jerseyNumber}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-sm text-[#171C26]">{player.name}</h4>
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-gray-100 text-gray-700">
                              {player.kavachId}
                            </span>
                            {player.status === "pending" && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                Pending Approval
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#667085] flex flex-wrap items-center gap-2 mt-0.5">
                            <span>{player.role}</span>
                            <span>•</span>
                            <span>{player.battingStyle}</span>
                            <span>•</span>
                            <span className="text-gray-500">{player.phone}</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 self-start sm:self-auto">
                        {player.status === "pending" ? (
                          <button
                            onClick={() => handleApprovePlayer(player.id)}
                            className="min-h-[44px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                          >
                            <UserCheck className="w-4 h-4" />
                            <span>Approve & Assign ID</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedPlayerProfile(player);
                              setJerseyValidationWarning(null);
                            }}
                            className="min-h-[44px] px-3.5 py-2 border border-gray-200 text-[#171C26] text-xs font-bold rounded-xl hover:bg-gray-50 transition flex items-center gap-1.5"
                          >
                            <Edit2 className="w-4 h-4 text-[#D51F43]" />
                            <span>Edit Profile & Roles</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* ADMIN HUB 4: FINANCE & DUES COMMAND HUB                                   */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "finance" && (
              <div className="space-y-6">
                {/* Header & Quick Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black uppercase text-[#171C26] flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-[#D51F43]" />
                      Finance & Collections Command
                    </h2>
                    <p className="text-xs text-[#667085]">
                      Authoritative ledger, debtor aging analysis, and Option A abandoned match reconciliation.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRecordCashModalOpen(true)}
                      className="min-h-[44px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
                    >
                      <DollarSign className="w-4 h-4" />
                      <span>Record Cash/UPI</span>
                    </button>
                    <button
                      onClick={() => setAdHocFeeModalOpen(true)}
                      className="min-h-[44px] px-3.5 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Levy Ad-hoc Fee</span>
                    </button>
                  </div>
                </div>

                {/* 4 Financial Metric Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Total Liquid Collected</span>
                    <div className="text-2xl font-black text-emerald-600 mt-1">₹68,450</div>
                    <span className="text-[10px] text-gray-500 font-medium">Gateway + Verified Cash</span>
                  </div>
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Actionable Dues</span>
                    <div className="text-2xl font-black text-[#D51F43] mt-1">₹2,400</div>
                    <span className="text-[10px] text-rose-600 font-semibold">4 pending member obligations</span>
                  </div>
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Option A Waived</span>
                    <div className="text-2xl font-black text-gray-700 mt-1">₹500</div>
                    <span className="text-[10px] text-emerald-700 font-semibold">Rain Abandoned (Preserved)</span>
                  </div>
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                    <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Debtor Aging (&gt;14d)</span>
                    <div className="text-2xl font-black text-amber-600 mt-1">2 Urgent</div>
                    <span className="text-[10px] text-amber-700 font-semibold">Immediate collection queue</span>
                  </div>
                </div>

                {/* Search & Filter Toolbar */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-3 shadow-xs space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-bold scrollbar-none">
                      {[
                        { key: "all", label: "All Ledger" },
                        { key: "unpaid", label: "Unpaid / Overdue" },
                        { key: "urgent", label: "Urgent (>14d)" },
                        { key: "paid", label: "Settled (Paid)" },
                        { key: "waived", label: "Option A Waived" }
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          onClick={() => setFinanceFilter(tab.key as any)}
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl transition whitespace-nowrap text-xs font-bold ${
                            financeFilter === tab.key
                              ? "bg-[#D51F43] text-white shadow-xs font-black"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search player, KAV-ID, title..."
                        value={financeSearch}
                        onChange={(e) => setFinanceSearch(e.target.value)}
                        className="w-full min-h-[44px] text-xs pl-9 pr-3 py-2 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Ledger Cards */}
                <div className="space-y-3">
                  {filteredFinanceRecords.map((rec) => (
                    <div
                      key={rec.id}
                      className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 ${
                          rec.status === "paid" ? "bg-emerald-100 text-emerald-800" :
                          rec.status === "waived" ? "bg-gray-100 text-gray-600" :
                          rec.status === "overdue_urgent" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                        }`}>
                          {rec.status === "paid" ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> :
                           rec.status === "waived" ? <FileText className="w-5 h-5 text-gray-600" /> :
                           <AlertCircle className="w-5 h-5 text-rose-600" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-sm text-[#171C26]">{rec.playerName}</h4>
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-gray-100 text-gray-700">
                              {rec.kavachId}
                            </span>
                            {rec.status === "overdue_urgent" && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800">
                                Overdue (&gt;14d)
                              </span>
                            )}
                            {rec.status === "waived" && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-gray-100 text-gray-800">
                                Waived (Option A)
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[#667085] flex flex-wrap items-center gap-2 mt-0.5">
                            <span>{rec.title}</span>
                            <span>•</span>
                            <span className="font-semibold">{rec.category}</span>
                            <span>•</span>
                            <span>Due: {rec.dueDate}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-auto">
                        <div className="text-right">
                          <div className="font-black text-sm text-[#171C26]">₹{rec.amount}</div>
                          <span className="text-[10px] font-bold text-gray-500">
                            {rec.channel ? rec.channel : "Pending Payment"}
                          </span>
                        </div>

                        {rec.status !== "paid" && rec.status !== "waived" ? (
                          <button
                            onClick={() => handleRecordManualPayment(rec.id, "Pitch-Side Cash", "Rahul Verma (Admin)")}
                            className="min-h-[44px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                          >
                            <DollarSign className="w-4 h-4" />
                            <span>Collect Cash</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => setSelectedAuditTx(rec)}
                            className="min-h-[44px] px-3.5 py-2 border border-gray-200 text-[#171C26] text-xs font-bold rounded-xl hover:bg-gray-50 transition flex items-center gap-1.5"
                          >
                            <FileText className="w-4 h-4 text-[#D51F43]" />
                            <span>Audit Trail</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* ADMIN HUB 5: STUDIO & NETS COMMAND HUB                                    */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "studio" && (
              <div className="space-y-6">
                {/* Header & Quick Action Buttons */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black uppercase text-[#171C26] flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-[#D51F43]" />
                      Studio & Nets Command
                    </h2>
                    <p className="text-xs text-[#667085]">
                      Lane timetable, multi-turf slots, bowling machine scheduling, and pass management.
                    </p>
                  </div>
                  <button
                    onClick={() => setBookSlotModalOpen(true)}
                    className="min-h-[44px] px-3.5 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Book Net Slot</span>
                  </button>
                </div>

                {/* Day Selection Bar */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-3 shadow-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-[#D51F43]" />
                    <span className="text-xs font-bold text-gray-700">Select Date:</span>
                    {(["Today", "Tomorrow", "Saturday", "Sunday"] as const).map((day) => (
                      <button
                        key={day}
                        onClick={() => setSelectedStudioDate(day)}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition ${
                          selectedStudioDate === day
                            ? "bg-[#D51F43] text-white shadow-xs font-black"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <div className="text-xs font-mono font-bold text-gray-500 hidden sm:block">
                    Asia/Kolkata (IST)
                  </div>
                </div>

                {/* Nets Timetable Grid */}
                <div className="space-y-3">
                  {netsSchedule.map((slot) => (
                    <div key={slot.id} className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                      <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-3">
                        <span className="font-black text-xs text-[#A30F2D] flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {slot.time}
                        </span>
                        <span className="text-[10px] font-bold text-gray-400 uppercase">3 Lanes Online</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Lane 1 */}
                        <div className={`p-3 rounded-xl border ${
                          slot.lane1.status === "booked" ? "bg-amber-50/60 border-amber-200" : "bg-emerald-50/60 border-emerald-200"
                        }`}>
                          <div className="flex items-center justify-between text-xs font-bold mb-1">
                            <span>Lane 1: Fast Bowling</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-black ${
                              slot.lane1.status === "booked" ? "bg-amber-200 text-amber-900" : "bg-emerald-200 text-emerald-900"
                            }`}>
                              {slot.lane1.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 font-medium">
                            {slot.lane1.bookedBy || "Available for Reservation"}
                          </div>
                        </div>

                        {/* Lane 2 */}
                        <div className={`p-3 rounded-xl border ${
                          slot.lane2.status === "booked" ? "bg-amber-50/60 border-amber-200" : "bg-emerald-50/60 border-emerald-200"
                        }`}>
                          <div className="flex items-center justify-between text-xs font-bold mb-1">
                            <span>Lane 2: Spin / Turf</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-black ${
                              slot.lane2.status === "booked" ? "bg-amber-200 text-amber-900" : "bg-emerald-200 text-emerald-900"
                            }`}>
                              {slot.lane2.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 font-medium">
                            {slot.lane2.bookedBy || "Available for Reservation"}
                          </div>
                        </div>

                        {/* Lane 3 */}
                        <div className={`p-3 rounded-xl border ${
                          slot.lane3.status === "coaching" ? "bg-purple-50/60 border-purple-200" :
                          slot.lane3.status === "booked" ? "bg-amber-50/60 border-amber-200" : "bg-emerald-50/60 border-emerald-200"
                        }`}>
                          <div className="flex items-center justify-between text-xs font-bold mb-1">
                            <span>Lane 3: Bowling Machine</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded font-black ${
                              slot.lane3.status === "coaching" ? "bg-purple-200 text-purple-900" :
                              slot.lane3.status === "booked" ? "bg-amber-200 text-amber-900" : "bg-emerald-200 text-emerald-900"
                            }`}>
                              {slot.lane3.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 font-medium">
                            {slot.lane3.bookedBy || "Available for Reservation"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Studio Passes & CRM Leads */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Passes Ledger */}
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs space-y-3">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-[#171C26] flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-[#D51F43]" />
                      Active Pass Holders
                    </h3>
                    <div className="space-y-2">
                      {MOCK_STUDIO_PASSES.map((pass) => (
                        <div key={pass.id} className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-bold text-[#171C26]">{pass.playerName} <span className="font-mono text-[10px] text-gray-500">({pass.kavachId})</span></div>
                            <div className="text-[10px] text-gray-500">{pass.plan} • Expires: {pass.expiry}</div>
                          </div>
                          <div className="text-right">
                            <span className="font-black text-[#D51F43]">{pass.remaining} / {pass.total}</span>
                            <span className="block text-[9px] text-gray-400">sessions left</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* CRM Leads */}
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs space-y-3">
                    <h3 className="font-bold text-xs uppercase tracking-wider text-[#171C26] flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-emerald-600" />
                      Studio Trial Inquiries
                    </h3>
                    <div className="space-y-2">
                      {MOCK_STUDIO_LEADS.map((lead) => (
                        <div key={lead.id} className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-bold text-[#171C26]">{lead.name}</div>
                            <div className="text-[10px] text-gray-500">{lead.phone} • {lead.interest}</div>
                          </div>
                          <button
                            onClick={() => setSimulationToast(`[PROTOTYPE SIMULATION] Simulated follow-up contact for lead ${lead.name} (${lead.phone}).`)}
                            className="min-h-[44px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition"
                          >
                            Follow Up
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* ADMIN HUB 6: CLUB OPERATIONS COMMAND HUB                                  */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "design" && (
              <div className="space-y-6">
                {/* Header */}
                <div>
                  <h2 className="text-lg font-black uppercase text-[#171C26] flex items-center gap-2">
                    <Award className="w-5 h-5 text-[#D51F43]" />
                    Club Operations & Member Hub
                  </h2>
                  <p className="text-xs text-[#667085]">
                    Merchandise fulfillment queue, member feedback polls, and matchday creative studio.
                  </p>
                </div>

                {/* Section 1: Shop & Merchandise Fulfillment */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-100 pb-3">
                    <div>
                      <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                        <ShoppingBag className="w-4 h-4 text-[#D51F43]" />
                        Merchandise Order Pipeline
                      </h3>
                      <p className="text-[11px] text-gray-500">Track kit orders from placement to pitch-side collection.</p>
                    </div>
                    {/* Size distribution pills */}
                    <div className="flex items-center gap-1 text-[10px] font-bold">
                      <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">S: 2</span>
                      <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">M: 8</span>
                      <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">L: 14</span>
                      <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">XL: 6</span>
                    </div>
                  </div>

                  {/* Orders List */}
                  <div className="space-y-3">
                    {filteredMerchOrders.map((ord) => (
                      <div
                        key={ord.id}
                        className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-xs text-[#171C26]">{ord.id}</span>
                            <span className="font-bold text-[#171C26]">{ord.playerName}</span>
                            <span className="font-mono text-[10px] text-gray-500">({ord.kavachId})</span>
                            <span className={`text-[10px] font-black px-1.5 py-0.2 rounded ${
                              ord.status === "New Order" ? "bg-amber-100 text-amber-800" :
                              ord.status === "In Production" ? "bg-blue-100 text-blue-800" :
                              ord.status === "Ready for Pickup" ? "bg-purple-100 text-purple-800" : "bg-emerald-100 text-emerald-800"
                            }`}>
                              {ord.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-600 mt-0.5">
                            {ord.item} • Size: <span className="font-bold">{ord.size}</span> • Ordered: {ord.date}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="font-black text-sm text-[#171C26]">₹{ord.total}</div>
                          {ord.status !== "Delivered" && (
                            <button
                              onClick={() => handleAdvanceOrderStatus(ord.id)}
                              className="min-h-[44px] px-3.5 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs rounded-xl transition"
                            >
                              {ord.status === "New Order" ? "Send to Production" :
                               ord.status === "In Production" ? "Mark Ready" : "Mark Delivered"}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 2: Member Polls & Community Voting */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                  <div className="border-b border-gray-100 pb-3">
                    <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                      <Vote className="w-4 h-4 text-[#D51F43]" />
                      Member Decision Poll
                    </h3>
                    <p className="text-[11px] text-gray-500">{pollData.title}</p>
                  </div>

                  <div className="space-y-3">
                    {pollData.options.map((opt) => (
                      <div
                        key={opt.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Vote for ${opt.label}, currently ${opt.percentage}% with ${opt.votes} votes`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (!hasVotedPoll) setSelectedPollOption(opt.id);
                          }
                        }}
                        onClick={() => !hasVotedPoll && setSelectedPollOption(opt.id)}
                        className={`p-3 min-h-[44px] rounded-xl border transition cursor-pointer flex flex-col justify-center focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 ${
                          selectedPollOption === opt.id
                            ? "border-[#D51F43] bg-rose-50/50"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                          <span className="text-[#171C26]">{opt.label}</span>
                          <span className="font-mono text-[#D51F43]">{opt.percentage}% ({opt.votes} votes)</span>
                        </div>
                        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#A30F2D] to-[#D51F43] transition-all duration-500"
                            style={{ width: `${opt.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {!hasVotedPoll ? (
                    <button
                      onClick={handleVotePoll}
                      disabled={!selectedPollOption}
                      className="min-h-[44px] px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition"
                    >
                      Submit Member Vote
                    </button>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Your vote has been counted in real time!
                    </div>
                  )}
                </div>

                {/* Section 3: Interactive Design Studio & Matchday Graphic Generator (MOD-13) */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded bg-[#FCE8ED] text-[#A30F2D]">
                          MOD-13 • Creative Engine
                        </span>
                        <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-purple-100 text-purple-900 font-bold">
                          Designer Hub
                        </span>
                      </div>
                      <h3 className="font-black text-sm uppercase text-[#171C26] mt-1 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#D51F43]" />
                        Matchday Banner & Canvas Graphic Generator
                      </h3>
                      <p className="text-[11px] text-gray-500">Produce official, brand-compliant social media graphics with live SVG canvas rendering.</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDesignStudioModal(!designStudioModal)}
                        className="min-h-[44px] px-3.5 py-1.5 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl transition flex items-center gap-1.5"
                      >
                        <Image className="w-4 h-4" />
                        <span>{designStudioModal ? "Hide Generator" : "Open Studio Generator"}</span>
                      </button>
                    </div>
                  </div>

                  {designStudioModal && (
                    <div className="space-y-4 pt-2">
                      {/* Template Selector */}
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1.5">
                          1. Select Matchday Template:
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          {[
                            { key: "matchday", label: "Matchday Fixture" },
                            { key: "potm", label: "Player of Match (POTM)" },
                            { key: "squad", label: "Playing XI Lineup" },
                            { key: "result", label: "Final Scorecard" }
                          ].map((tmpl) => (
                            <button
                              key={tmpl.key}
                              onClick={() => setDesignTemplate(tmpl.key as any)}
                              className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold border transition text-center ${
                                designTemplate === tmpl.key
                                  ? "bg-[#D51F43] text-white border-[#D51F43] shadow-xs font-black"
                                  : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                              }`}
                            >
                              {tmpl.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Customization Controls */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <label className="font-bold text-gray-700 block mb-1">Target Match Fixture</label>
                          <select
                            value={designMatch}
                            onChange={(e) => setDesignMatch(e.target.value)}
                            className="w-full min-h-[44px] p-2.5 rounded-xl border border-gray-300 bg-white"
                          >
                            <option>KAvach Cricket Club vs Spartans CC</option>
                            <option>KAvach Cricket Club vs Royal Strikers</option>
                            <option>KAvach Cricket Club vs Metro CC</option>
                          </select>
                        </div>
                        <div>
                          <label className="font-bold text-gray-700 block mb-1">Featured Player Spotlight</label>
                          <select
                            value={designPlayer}
                            onChange={(e) => setDesignPlayer(e.target.value)}
                            className="w-full min-h-[44px] p-2.5 rounded-xl border border-gray-300 bg-white"
                          >
                            <option>Ashutosh Dixit (#07 • All-Rounder)</option>
                            <option>Vikram Sharma (#18 • Captain)</option>
                            <option>Rahul Verma (#24 • Bowler)</option>
                          </select>
                        </div>
                      </div>

                      {/* LIVE SVG CANVAS BANNER RENDER */}
                      <div className="rounded-2xl overflow-hidden border border-amber-400/40 shadow-xl bg-gray-950 p-2">
                        <svg viewBox="0 0 800 450" className="w-full h-auto rounded-xl">
                          <defs>
                            <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="#A30F2D" />
                              <stop offset="60%" stopColor="#C4193B" />
                              <stop offset="100%" stopColor="#D51F43" />
                            </linearGradient>
                            <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#D6A52B" />
                              <stop offset="50%" stopColor="#F5D061" />
                              <stop offset="100%" stopColor="#D6A52B" />
                            </linearGradient>
                          </defs>

                          {/* Background */}
                          <rect width="800" height="450" fill="url(#brandGrad)" />
                          <circle cx="750" cy="50" r="180" fill="#FFFFFF" opacity="0.04" />
                          <circle cx="50" cy="400" r="140" fill="#000000" opacity="0.15" />

                          {/* Outer Gold Frame */}
                          <rect x="20" y="20" width="760" height="410" fill="none" stroke="url(#goldGrad)" strokeWidth="3" rx="16" />

                          {/* Crest & Header */}
                          <rect x="50" y="45" width="48" height="48" rx="12" fill="#FFFFFF" />
                          <text x="74" y="78" fill="#A30F2D" fontSize="22" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">KP</text>

                          <text x="110" y="66" fill="#FCE8ED" fontSize="13" fontWeight="900" letterSpacing="3" fontFamily="sans-serif">OFFICIAL MATCHDAY MEDIA</text>
                          <text x="110" y="86" fill="#FFFFFF" fontSize="18" fontWeight="900" letterSpacing="1" fontFamily="sans-serif">KAVACH CRICKET CLUB</text>

                          {/* Template Header Badge */}
                          <rect x="560" y="45" width="190" height="34" rx="17" fill="#000000" opacity="0.3" />
                          <text x="655" y="67" fill="#F5D061" fontSize="11" fontWeight="800" textAnchor="middle" fontFamily="sans-serif" letterSpacing="1">
                            {designTemplate === "matchday" ? "MATCHDAY 12 • T20" :
                             designTemplate === "potm" ? "PLAYER OF THE MATCH 🏅" :
                             designTemplate === "squad" ? "PLAYING XI SQUAD" : "OFFICIAL RESULT"}
                          </text>

                          {/* Dynamic Middle Banner Content */}
                          {designTemplate === "potm" ? (
                            <>
                              <text x="50" y="160" fill="#F5D061" fontSize="16" fontWeight="900" letterSpacing="2" fontFamily="sans-serif">OUTSTANDING PERFORMANCE</text>
                              <text x="50" y="210" fill="#FFFFFF" fontSize="38" fontWeight="900" fontFamily="sans-serif">{designPlayer.split(" ")[0].toUpperCase()} {designPlayer.split(" ")[1]?.toUpperCase()}</text>
                              <text x="50" y="250" fill="#FCE8ED" fontSize="20" fontWeight="700" fontFamily="sans-serif">64* (41 balls) • 1/32 (4 overs)</text>
                              <rect x="50" y="280" width="320" height="44" rx="12" fill="#FFFFFF" opacity="0.15" />
                              <text x="70" y="308" fill="#FFFFFF" fontSize="14" fontWeight="800" fontFamily="sans-serif">Won by 22 runs vs Spartans CC</text>
                            </>
                          ) : (
                            <>
                              <text x="50" y="155" fill="#F5D061" fontSize="15" fontWeight="900" letterSpacing="2" fontFamily="sans-serif">UPCOMING PREMIER FIXTURE</text>
                              <text x="50" y="210" fill="#FFFFFF" fontSize="36" fontWeight="900" fontFamily="sans-serif">{designMatch.toUpperCase()}</text>
                              <text x="50" y="250" fill="#FCE8ED" fontSize="18" fontWeight="700" fontFamily="sans-serif">Saturday, 21 Nov 2026 • 07:30 AM IST</text>
                              <rect x="50" y="275" width="420" height="44" rx="12" fill="#FFFFFF" opacity="0.15" />
                              <text x="70" y="303" fill="#FFFFFF" fontSize="14" fontWeight="800" fontFamily="sans-serif">Venue: Kavach Arena Ground 1 (Natural Turf)</text>
                            </>
                          )}

                          {/* Footer */}
                          <line x1="50" y1="365" x2="750" y2="365" stroke="#FFFFFF" strokeOpacity="0.2" strokeWidth="1" />
                          <text x="50" y="395" fill="#FFFFFF" fillOpacity="0.8" fontSize="12" fontWeight="700" fontFamily="sans-serif">play.kavachcricket.com • Delhi-NCR League</text>
                          <text x="750" y="395" fill="#F5D061" fontSize="12" fontWeight="800" textAnchor="end" fontFamily="sans-serif">#KAvachCricket #PlayWithHonor</text>
                        </svg>
                      </div>

                      {/* Export Actions */}
                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                          onClick={() => showSimulationToast("[PROTOTYPE SIMULATION] High-resolution Matchday Graphic exported locally. Ready for social media distribution.")}
                          className="min-h-[44px] px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl transition flex items-center gap-2"
                        >
                          <Download className="w-4 h-4" />
                          <span>Download High-Res Graphic (PNG)</span>
                        </button>
                        <button
                          onClick={() => showSimulationToast("[PROTOTYPE SIMULATION] Image token copied to clipboard for WhatsApp squad group.")}
                          className="min-h-[44px] px-4 py-2 bg-gray-100 hover:bg-gray-200 text-[#171C26] text-xs font-bold rounded-xl transition flex items-center gap-2"
                        >
                          <Copy className="w-4 h-4 text-gray-600" />
                          <span>Copy Image to Clipboard</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* ADMIN HUB 7: SETTINGS & RBAC COMMAND HUB                                  */}
            {/* ========================================================================= */}
            {persona === "admin" && adminHub === "settings" && (
              <div className="space-y-6">
                {/* Header */}
                <div>
                  <h2 className="text-lg font-black uppercase text-[#171C26] flex items-center gap-2">
                    <Settings className="w-5 h-5 text-[#D51F43]" />
                    Governance, RBAC & Club Settings
                  </h2>
                  <p className="text-xs text-[#667085]">
                    Granular 6-role permission matrix, business rules, and financial timezone configuration.
                  </p>
                </div>

                {/* RBAC Role Matrix */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                  <div className="border-b border-gray-100 pb-3">
                    <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-[#D51F43]" />
                      Granular RBAC Roles & Capabilities
                    </h3>
                    <p className="text-[11px] text-gray-500">
                      Enforcing strict role boundaries (SEC-001/002/003) — client self-writes to role fields strictly forbidden.
                    </p>
                  </div>

                  {/* Role Selector Tabs */}
                  <div className="flex items-center gap-1.5 overflow-x-auto text-xs font-bold scrollbar-none pb-1">
                    {MOCK_RBAC_RULES.map((r) => (
                      <button
                        key={r.role}
                        onClick={() => setActiveRoleName(r.role)}
                        className={`min-h-[44px] px-3.5 py-2 rounded-xl transition whitespace-nowrap text-xs font-bold ${
                          activeRoleName === r.role
                            ? "bg-[#D51F43] text-white shadow-xs font-black"
                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                      >
                        {r.role}
                      </button>
                    ))}
                  </div>

                  {/* Selected Role Capabilities Card */}
                  {(() => {
                    const selectedRole = MOCK_RBAC_RULES.find((r) => r.role === activeRoleName);
                    if (!selectedRole) return null;
                    return (
                      <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="font-black text-sm text-[#171C26]">{selectedRole.role}</h4>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            Authoritative RBAC
                          </span>
                        </div>
                        <p className="text-xs text-[#667085]">{selectedRole.desc}</p>
                        <div>
                          <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-1.5">
                            Granted Capabilities:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {selectedRole.caps.map((cap) => (
                              <div key={cap} className="flex items-center gap-1.5 text-xs text-[#171C26] font-medium bg-white p-2 rounded-lg border border-gray-100">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                <span>{cap}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* System Policies & Timezone Enforcement */}
                <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                  <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-emerald-600" />
                    Enforced Club Business Policies
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                      <div className="font-bold text-[#171C26] flex items-center gap-1.5 mb-1">
                        <Check className="w-4 h-4 text-emerald-600" />
                        Match Abandonment: Option A Enforced
                      </div>
                      <p className="text-[11px] text-[#667085]">
                        Rain or abandoned fixtures auto-waive pending obligations while preserving historical collections.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                      <div className="font-bold text-[#171C26] flex items-center gap-1.5 mb-1">
                        <Check className="w-4 h-4 text-emerald-600" />
                        Club Timezone: Asia/Kolkata
                      </div>
                      <p className="text-[11px] text-[#667085]">
                        All late-fee deadlines and matches compute against IST time to prevent local clock tampering (FIN-006).
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                      <div className="font-bold text-[#171C26] flex items-center gap-1.5 mb-1">
                        <Check className="w-4 h-4 text-emerald-600" />
                        Jersey Honor: #10 Retired
                      </div>
                      <p className="text-[11px] text-[#667085]">
                        Jersey #10 is reserved for club honors. Duplicate jersey numbers are actively prevented across the roster.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                      <div className="font-bold text-[#171C26] flex items-center gap-1.5 mb-1">
                        <Check className="w-4 h-4 text-emerald-600" />
                        Guest Surcharge: +20% Match Fee
                      </div>
                      <p className="text-[11px] text-[#667085]">
                        Unlinked or guest players are billed a standard +20% premium on match participation.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================================= */}
            {/* PLAYER VIEW MODE (HOME, MATCHES, PAYMENTS)                                */}
            {/* ========================================================================= */}
            {persona === "player" && activeTab === "home" && (
              <div className="space-y-6">
                {/* Hero Next Match */}
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

                    {/* 1-Tap RSVP */}
                    <div className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-black uppercase tracking-wider text-[#667085]">
                          Confirm Your Availability
                        </label>
                        <button
                          onClick={() => setShowNoteInput(!showNoteInput)}
                          className="min-h-[44px] px-2 py-1 flex items-center text-xs font-semibold text-[#D51F43] hover:underline"
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

                {/* Dues Alert Card */}
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

                {/* Club Feed */}
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

                      <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 sm:gap-4 text-xs font-medium text-[#667085]">
                        <button
                          onClick={() => toggleLike(post.id)}
                          aria-label={`Like post, currently ${post.likesCount} likes`}
                          className={`min-h-[44px] min-w-[44px] px-2 flex items-center justify-center gap-1.5 transition ${
                            post.isLiked ? "text-[#D51F43] font-bold" : "hover:text-[#171C26]"
                          }`}
                        >
                          <Heart className={`w-4 h-4 ${post.isLiked ? "fill-current" : ""}`} />
                          <span>{post.likesCount}</span>
                        </button>

                        <button
                          aria-label={`View comments, currently ${post.commentsCount} comments`}
                          className="min-h-[44px] min-w-[44px] px-2 flex items-center justify-center gap-1.5 hover:text-[#171C26] transition"
                        >
                          <MessageSquare className="w-4 h-4" />
                          <span>{post.commentsCount} Comments</span>
                        </button>

                        <button
                          aria-label="Share post"
                          className="min-h-[44px] min-w-[44px] px-2 ml-auto flex items-center justify-center gap-1.5 hover:text-[#171C26] transition"
                        >
                          <Share2 className="w-4 h-4" />
                          <span className="hidden sm:inline">Share</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              </div>
            )}

            {persona === "player" && activeTab === "matches" && (
              /* MATCHES TAB */
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-[#E5E7EB] shadow-xs">
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                    <button
                      onClick={() => setMatchFilter("all")}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "all" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      All Matches ({MOCK_MATCHES.length})
                    </button>
                    <button
                      onClick={() => setMatchFilter("upcoming")}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "upcoming" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      Upcoming (2)
                    </button>
                    <button
                      onClick={() => setMatchFilter("past")}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "past" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      Past Results (1)
                    </button>
                    <button
                      onClick={() => setMatchFilter("abandoned")}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition ${
                        matchFilter === "abandoned" ? "bg-[#D51F43] text-white shadow-xs" : "bg-gray-100 text-[#667085] hover:bg-gray-200"
                      }`}
                    >
                      Abandoned (1)
                    </button>
                  </div>

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

                <div className="space-y-4">
                  {filteredMatches.map((m) => (
                    <article
                      key={m.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`View match details: ${m.title}, format ${m.format}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedMatch(m);
                        }
                      }}
                      onClick={() => setSelectedMatch(m)}
                      className="bg-white rounded-2xl border border-[#E5E7EB] hover:border-[#D51F43]/40 p-4 sm:p-5 shadow-xs transition hover:shadow-md cursor-pointer relative overflow-hidden focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40"
                    >
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

            {persona === "player" && activeTab === "payments" && (
              /* PAYMENTS TAB */
              <div className="space-y-6">
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

                  <div className="mt-3 p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                    <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Club Late Fee Rule:</span> Match fees must be settled by Tuesday 23:59 IST following the match weekend. Automatic late fee of ₹150 applies subsequently.
                    </div>
                  </div>
                </div>

                {/* Payment History */}
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
                            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-gray-200 text-xs font-bold text-[#D51F43] hover:bg-[#FCE8ED] transition flex items-center gap-1.5"
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

            {/* ========================================================================= */}
            {/* PLAYER VIEW: PERFORMANCE & STATISTICS TAB                                 */}
            {/* ========================================================================= */}
            {persona === "player" && activeTab === "performance" && (
              <div className="space-y-6">
                {/* Header & Sub-tab switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black uppercase text-[#171C26] flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-[#D51F43]" />
                      Player Performance & Career Stats
                    </h2>
                    <p className="text-xs text-[#667085]">
                      Official season stats, milestone achievements, club leaderboards, and recent match form.
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                    {[
                      { key: "overview", label: "Overview" },
                      { key: "leaderboard", label: "Club Leaderboard" },
                      { key: "badges", label: "Badges & Honors" },
                      { key: "timeline", label: "Match Form" }
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setPerfSubTab(tab.key as any)}
                        className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                          perfSubTab === tab.key
                            ? "bg-[#D51F43] text-white shadow-xs font-black"
                            : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sub-view 1: Overview */}
                {perfSubTab === "overview" && (
                  <div className="space-y-5">
                    {/* Key Stats Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Season Runs</span>
                        <div className="text-2xl font-black text-[#171C26] mt-1">{MOCK_PERFORMANCE_METRICS.summary.runs}</div>
                        <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                          Avg: <span className="font-bold text-gray-700">{MOCK_PERFORMANCE_METRICS.summary.battingAvg}</span> • SR: <span className="font-bold text-gray-700">{MOCK_PERFORMANCE_METRICS.summary.strikeRate}</span>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Wickets Taken</span>
                        <div className="text-2xl font-black text-[#A30F2D] mt-1">{MOCK_PERFORMANCE_METRICS.summary.wickets}</div>
                        <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                          Avg: <span className="font-bold text-gray-700">{MOCK_PERFORMANCE_METRICS.summary.bowlingAvg}</span> • Econ: <span className="font-bold text-gray-700">{MOCK_PERFORMANCE_METRICS.summary.economy}</span>
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Highest Score</span>
                        <div className="text-2xl font-black text-amber-600 mt-1">{MOCK_PERFORMANCE_METRICS.summary.highestScore}</div>
                        <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                          {MOCK_PERFORMANCE_METRICS.summary.hundreds} x 100 • {MOCK_PERFORMANCE_METRICS.summary.fifties} x 50
                        </div>
                      </div>

                      <div className="bg-white rounded-2xl border border-[#E5E7EB] p-4 shadow-xs">
                        <span className="text-[10px] font-black uppercase tracking-wider text-[#667085]">Catches & Field</span>
                        <div className="text-2xl font-black text-emerald-600 mt-1">{MOCK_PERFORMANCE_METRICS.summary.catches}</div>
                        <div className="text-[10px] text-gray-500 font-medium mt-0.5">
                          Rank #2 in Club Fielding
                        </div>
                      </div>
                    </div>

                    {/* Milestone Badges Teaser */}
                    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                          <Award className="w-4 h-4 text-[#D51F43]" />
                          Milestone Badges & Club Honors
                        </h3>
                        <button
                          onClick={() => setPerfSubTab("badges")}
                          className="min-h-[44px] text-xs font-bold text-[#D51F43] hover:underline"
                        >
                          View All 5 Badges →
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {MOCK_PERFORMANCE_METRICS.milestoneBadges.slice(0, 3).map((badge) => (
                          <div key={badge.id} className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center font-black shrink-0">
                              <Trophy className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                              <div className="font-bold text-xs text-[#171C26]">{badge.title}</div>
                              <div className="text-[10px] text-gray-500">{badge.desc}</div>
                              <span className="font-mono text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded mt-0.5 inline-block">
                                {badge.tier} Tier
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Recent Match Form Teaser */}
                    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                          <Activity className="w-4 h-4 text-[#D51F43]" />
                          Recent Match Performance Form
                        </h3>
                        <button
                          onClick={() => setPerfSubTab("timeline")}
                          className="min-h-[44px] text-xs font-bold text-[#D51F43] hover:underline"
                        >
                          Full Timeline →
                        </button>
                      </div>
                      <div className="space-y-2">
                        {MOCK_PERFORMANCE_METRICS.matchForm.slice(0, 3).map((f, i) => (
                          <div key={i} className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between text-xs">
                            <div>
                              <div className="font-bold text-[#171C26] flex items-center gap-2">
                                <span>{f.match}</span>
                                {f.potm && (
                                  <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 text-[9px] font-black rounded uppercase">
                                    POTM 🏅
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-gray-500 mt-0.5">{f.date} • {f.result}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-[#171C26]">{f.runs}</div>
                              <div className="text-[10px] text-gray-500">{f.bowling}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-view 2: Club Leaderboard */}
                {perfSubTab === "leaderboard" && (
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
                      <div>
                        <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                          <Trophy className="w-4 h-4 text-amber-500" />
                          2026 Season Club Leaderboards
                        </h3>
                        <p className="text-[11px] text-gray-500">Live rankings compiled from official verified match scorecards.</p>
                      </div>

                      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
                        {(["batting", "bowling", "fielding"] as const).map((cat) => (
                          <button
                            key={cat}
                            onClick={() => setLeaderboardCategory(cat)}
                            className={`min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold transition capitalize ${
                              leaderboardCategory === cat ? "bg-[#D51F43] text-white shadow-xs font-black" : "text-gray-600 hover:text-black"
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Batting Leaderboard Table */}
                    {leaderboardCategory === "batting" && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 text-gray-500 uppercase text-[10px] font-black">
                              <th className="py-2.5 px-3">Rank</th>
                              <th className="py-2.5 px-3">Batsman</th>
                              <th className="py-2.5 px-3">Innings</th>
                              <th className="py-2.5 px-3 text-right">Runs</th>
                              <th className="py-2.5 px-3 text-right">Avg</th>
                              <th className="py-2.5 px-3 text-right">SR</th>
                              <th className="py-2.5 px-3 text-right">HS</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {MOCK_PERFORMANCE_METRICS.leaderboard.batting.map((row) => (
                              <tr key={row.rank} className={row.kavachId === "KAV-002" ? "bg-rose-50/50 font-bold" : ""}>
                                <td className="py-2.5 px-3 font-mono font-black">#{row.rank}</td>
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-[#171C26]">{row.name}</div>
                                  <div className="font-mono text-[9px] text-gray-400">{row.kavachId}</div>
                                </td>
                                <td className="py-2.5 px-3">{row.inngs}</td>
                                <td className="py-2.5 px-3 text-right font-black text-[#A30F2D]">{row.runs}</td>
                                <td className="py-2.5 px-3 text-right">{row.avg}</td>
                                <td className="py-2.5 px-3 text-right">{row.sr}</td>
                                <td className="py-2.5 px-3 text-right">{row.hs}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Bowling Leaderboard Table */}
                    {leaderboardCategory === "bowling" && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 text-gray-500 uppercase text-[10px] font-black">
                              <th className="py-2.5 px-3">Rank</th>
                              <th className="py-2.5 px-3">Bowler</th>
                              <th className="py-2.5 px-3">Overs</th>
                              <th className="py-2.5 px-3 text-right">Wickets</th>
                              <th className="py-2.5 px-3 text-right">Avg</th>
                              <th className="py-2.5 px-3 text-right">Econ</th>
                              <th className="py-2.5 px-3 text-right">Best</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {MOCK_PERFORMANCE_METRICS.leaderboard.bowling.map((row) => (
                              <tr key={row.rank} className={row.kavachId === "KAV-002" ? "bg-rose-50/50 font-bold" : ""}>
                                <td className="py-2.5 px-3 font-mono font-black">#{row.rank}</td>
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-[#171C26]">{row.name}</div>
                                  <div className="font-mono text-[9px] text-gray-400">{row.kavachId}</div>
                                </td>
                                <td className="py-2.5 px-3">{row.overs}</td>
                                <td className="py-2.5 px-3 text-right font-black text-[#A30F2D]">{row.wkts}</td>
                                <td className="py-2.5 px-3 text-right">{row.avg}</td>
                                <td className="py-2.5 px-3 text-right">{row.econ}</td>
                                <td className="py-2.5 px-3 text-right">{row.bb}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Fielding Leaderboard Table */}
                    {leaderboardCategory === "fielding" && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-gray-200 text-gray-500 uppercase text-[10px] font-black">
                              <th className="py-2.5 px-3">Rank</th>
                              <th className="py-2.5 px-3">Fielder</th>
                              <th className="py-2.5 px-3">Matches</th>
                              <th className="py-2.5 px-3 text-right">Catches</th>
                              <th className="py-2.5 px-3 text-right">Run Outs</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 font-medium">
                            {MOCK_PERFORMANCE_METRICS.leaderboard.fielding.map((row) => (
                              <tr key={row.rank} className={row.kavachId === "KAV-002" ? "bg-rose-50/50 font-bold" : ""}>
                                <td className="py-2.5 px-3 font-mono font-black">#{row.rank}</td>
                                <td className="py-2.5 px-3">
                                  <div className="font-bold text-[#171C26]">{row.name}</div>
                                  <div className="font-mono text-[9px] text-gray-400">{row.kavachId}</div>
                                </td>
                                <td className="py-2.5 px-3">{row.matches}</td>
                                <td className="py-2.5 px-3 text-right font-black text-[#A30F2D]">{row.catches}</td>
                                <td className="py-2.5 px-3 text-right">{row.runOuts}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Sub-view 3: Badges & Achievements */}
                {perfSubTab === "badges" && (
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                    <div className="border-b border-gray-100 pb-3">
                      <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-[#D51F43]" />
                        Official Club Badges & Accolades
                      </h3>
                      <p className="text-[11px] text-gray-500">Badges are awarded automatically based on verified match scorecards and tenure.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {MOCK_PERFORMANCE_METRICS.milestoneBadges.map((badge) => (
                        <div key={badge.id} className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 flex items-start gap-3">
                          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A30F2D] to-[#D51F43] text-white flex items-center justify-center font-black shrink-0 shadow-xs">
                            <Trophy className="w-6 h-6 text-amber-300" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-sm text-[#171C26]">{badge.title}</h4>
                              <span className="font-mono text-[9px] font-black uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                                {badge.tier}
                              </span>
                            </div>
                            <p className="text-xs text-[#667085] mt-0.5">{badge.desc}</p>
                            <span className="text-[10px] text-gray-400 block mt-1">Earned on {badge.earnedDate}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub-view 4: Timeline Form */}
                {perfSubTab === "timeline" && (
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                    <div className="border-b border-gray-100 pb-3">
                      <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                        <Clock className="w-4 h-4 text-[#D51F43]" />
                        2026 Match Form Timeline
                      </h3>
                      <p className="text-[11px] text-gray-500">Detailed performance ledger from the 2026 cricket season.</p>
                    </div>

                    <div className="space-y-3">
                      {MOCK_PERFORMANCE_METRICS.matchForm.map((f, i) => (
                        <div key={i} className="p-4 rounded-xl border border-gray-200 bg-white shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-[#171C26]">{f.match}</span>
                              {f.potm && (
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black rounded uppercase">
                                  POTM 🏅
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-gray-500 mt-0.5">{f.date} • {f.result}</div>
                          </div>
                          <div className="flex items-center gap-4 bg-gray-50 px-3 py-2 rounded-xl">
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase font-bold block">Batting</span>
                              <span className="font-bold text-[#171C26]">{f.runs}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-gray-400 uppercase font-bold block">Bowling</span>
                              <span className="font-bold text-[#171C26]">{f.bowling}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========================================================================= */}
            {/* PLAYER VIEW: CLUB EXPERIENCE & MEMBER SERVICES TAB                        */}
            {/* ========================================================================= */}
            {persona === "player" && activeTab === "club" && (
              <div className="space-y-6">
                {/* Header & Sub-tab switcher */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-black uppercase text-[#171C26] flex items-center gap-2">
                      <Shield className="w-5 h-5 text-[#D51F43]" />
                      Club Experience & Member Services
                    </h2>
                    <p className="text-xs text-[#667085]">
                      Digital player card, studio training passes, merchandise shop, member polls, and club details.
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
                    {[
                      { key: "card", label: "Player Card" },
                      { key: "studio", label: "Nets Pass" },
                      { key: "shop", label: "Merch Shop" },
                      { key: "info", label: "Club & Polls" }
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setClubSubTab(tab.key as any)}
                        className={`min-h-[44px] px-3.5 py-1.5 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                          clubSubTab === tab.key
                            ? "bg-[#D51F43] text-white shadow-xs font-black"
                            : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sub-tab 1: Digital Player Card */}
                {clubSubTab === "card" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Visual Digital Card */}
                    <div className="bg-gradient-to-br from-[#A30F2D] via-[#B81538] to-[#D51F43] text-white rounded-3xl p-6 shadow-xl relative overflow-hidden flex flex-col justify-between min-h-[320px]">
                      {/* Watermark Crest */}
                      <div className="absolute -right-8 -bottom-8 opacity-10 text-[180px] font-black pointer-events-none">
                        KP
                      </div>

                      {/* Card Top */}
                      <div className="flex items-start justify-between relative z-10">
                        <div>
                          <div className="text-[10px] font-mono tracking-widest uppercase text-amber-300 font-bold">
                            Official Player Card
                          </div>
                          <h3 className="text-xl font-black uppercase tracking-tight mt-0.5">
                            KAvach Cricket Club
                          </h3>
                        </div>
                        <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center font-black text-xl text-amber-300 border border-white/20">
                          #{MOCK_CURRENT_PLAYER.jerseyNumber}
                        </div>
                      </div>

                      {/* Card Middle */}
                      <div className="flex items-center gap-4 my-4 relative z-10">
                        <img
                          src={MOCK_CURRENT_PLAYER.avatar}
                          alt={MOCK_CURRENT_PLAYER.name}
                          className="w-16 h-16 rounded-2xl object-cover ring-4 ring-white/30 shadow-md"
                        />
                        <div>
                          <h4 className="text-lg font-black uppercase">{MOCK_CURRENT_PLAYER.name}</h4>
                          <span className="font-mono text-xs font-bold bg-white/20 px-2 py-0.5 rounded-md text-amber-200">
                            {MOCK_CURRENT_PLAYER.kavachId}
                          </span>
                          <div className="text-xs text-white/80 mt-1">
                            {MOCK_CURRENT_PLAYER.role} • {MOCK_CURRENT_PLAYER.battingStyle}
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom */}
                      <div className="pt-4 border-t border-white/20 flex items-center justify-between text-xs relative z-10">
                        <div>
                          <span className="text-[10px] text-white/60 uppercase block">Membership Tier</span>
                          <span className="font-bold text-amber-300">Active Squad Member</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-white/60 uppercase block">Affiliation</span>
                          <span className="font-bold">Delhi-NCR League</span>
                        </div>
                      </div>
                    </div>

                    {/* Member Services & Profile Management */}
                    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                      <h3 className="font-black text-sm uppercase text-[#171C26]">Member Profile Details</h3>
                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-[#667085]">Phone (Registered):</span>
                          <span className="font-mono font-bold text-[#171C26]">{MOCK_CURRENT_PLAYER.phone}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-[#667085]">Email:</span>
                          <span className="font-bold text-[#171C26]">{MOCK_CURRENT_PLAYER.email}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-[#667085]">Bowling Style:</span>
                          <span className="font-bold text-[#171C26]">{MOCK_CURRENT_PLAYER.bowlingStyle}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b border-gray-100">
                          <span className="text-[#667085]">Account Status:</span>
                          <span className="font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            Verified Player
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => showSimulationToast("[PROTOTYPE SIMULATION] Profile edit requested. Local prototype state active.")}
                        className="w-full min-h-[44px] border border-gray-200 text-[#171C26] font-bold text-xs rounded-xl hover:bg-gray-50 transition"
                      >
                        Request Profile Detail Update
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub-tab 2: Studio & Nets Membership */}
                {clubSubTab === "studio" && (
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
                      <div>
                        <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-[#D51F43]" />
                          Indoor Studio & Nets Training Pass
                        </h3>
                        <p className="text-[11px] text-gray-500">Access multi-turf training lanes and automated bowling machine sessions.</p>
                      </div>

                      <button
                        onClick={() => setBookSlotModalOpen(true)}
                        className="min-h-[44px] px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold text-xs rounded-xl shadow-xs transition"
                      >
                        Reserve Net Slot
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60">
                        <span className="text-[10px] text-gray-500 uppercase font-black">Active Package</span>
                        <div className="font-bold text-base text-[#171C26] mt-0.5">10-Session Training Pass</div>
                        <span className="text-xs text-gray-500">Expires: 15 Dec 2026</span>
                      </div>

                      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60">
                        <span className="text-[10px] text-gray-500 uppercase font-black">Credits Remaining</span>
                        <div className="font-black text-2xl text-[#D51F43] mt-0.5">7 of 10</div>
                        <span className="text-xs text-emerald-700 font-medium">Valid for all 3 lanes</span>
                      </div>

                      <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/60 flex flex-col justify-between">
                        <span className="text-[10px] text-gray-500 uppercase font-black">Quick Action</span>
                        <button
                          onClick={() => showSimulationToast("[PROTOTYPE SIMULATION] Pass renewal simulated. No real transaction occurred.")}
                          className="min-h-[44px] mt-2 px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-lg transition"
                        >
                          Renew / Add 10 Sessions (₹2,000)
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub-tab 3: Official Merchandise Shop */}
                {clubSubTab === "shop" && (
                  <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                    <div className="border-b border-gray-100 pb-3">
                      <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                        <ShoppingBag className="w-4 h-4 text-[#D51F43]" />
                        Official Club Merchandise & Kit Store
                      </h3>
                      <p className="text-[11px] text-gray-500">Order customized matchwear and training gear directly to your ground.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {MOCK_CLUB_SHOP_ITEMS.map((item) => (
                        <div key={item.id} className="p-4 rounded-2xl border border-gray-200 bg-white flex flex-col justify-between shadow-xs">
                          <div>
                            <div className="w-full h-32 rounded-xl bg-[#FCE8ED]/40 flex items-center justify-center text-[#A30F2D] mb-3">
                              <Shirt className="w-12 h-12" />
                            </div>
                            <span className="font-mono text-[9px] font-black uppercase px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                              {item.badge}
                            </span>
                            <h4 className="font-bold text-sm text-[#171C26] mt-2">{item.title}</h4>
                            <p className="text-[11px] text-[#667085] mt-1 line-clamp-2">{item.description}</p>
                          </div>

                          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                            <span className="font-black text-base text-[#171C26]">₹{item.price}</span>
                            <button
                              onClick={() => setShopItemOrderModal(item)}
                              className="min-h-[44px] px-3.5 py-1.5 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl transition"
                            >
                              Order Kit
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sub-tab 4: Club Info & Polls */}
                {clubSubTab === "info" && (
                  <div className="space-y-5">
                    {/* Member Decision Poll */}
                    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                      <div className="border-b border-gray-100 pb-3">
                        <h3 className="font-black text-sm uppercase text-[#171C26] flex items-center gap-1.5">
                          <Vote className="w-4 h-4 text-[#D51F43]" />
                          Member Democratic Decision Poll
                        </h3>
                        <p className="text-[11px] text-gray-500">{pollData.title}</p>
                      </div>

                      <div className="space-y-3">
                        {pollData.options.map((opt) => (
                          <div
                            key={opt.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`Vote for ${opt.label}, currently ${opt.percentage}% with ${opt.votes} votes`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                if (!hasVotedPoll) setSelectedPollOption(opt.id);
                              }
                            }}
                            onClick={() => !hasVotedPoll && setSelectedPollOption(opt.id)}
                            className={`p-3.5 min-h-[44px] rounded-xl border transition cursor-pointer flex flex-col justify-center focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 ${
                              selectedPollOption === opt.id ? "border-[#D51F43] bg-rose-50/50" : "border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                              <span className="text-[#171C26]">{opt.label}</span>
                              <span className="font-mono text-[#D51F43]">{opt.percentage}% ({opt.votes} votes)</span>
                            </div>
                            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-[#A30F2D] to-[#D51F43] transition-all duration-500"
                                style={{ width: `${opt.percentage}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>

                      {!hasVotedPoll ? (
                        <button
                          onClick={handleVotePoll}
                          disabled={!selectedPollOption}
                          className="min-h-[44px] px-4 py-2 bg-[#D51F43] hover:bg-[#A30F2D] disabled:opacity-50 text-white font-bold text-xs rounded-xl transition"
                        >
                          Submit Member Vote
                        </button>
                      ) : (
                        <div className="p-3 rounded-xl bg-emerald-50 text-emerald-800 text-xs font-bold flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          [PROTOTYPE SIMULATION] Your vote has been counted in real time!
                        </div>
                      )}
                    </div>

                    {/* Club Governance & Grounds */}
                    <div className="bg-white rounded-2xl border border-[#E5E7EB] p-5 shadow-xs space-y-4">
                      <h3 className="font-black text-sm uppercase text-[#171C26]">Club Operations & Ground Venues</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                          <span className="font-bold text-[#171C26] block">Home Ground</span>
                          <span className="text-gray-600 block mt-0.5">Kavach Arena Ground 1 (Natural Turf, Floodlit)</span>
                          <span className="text-[10px] text-gray-400">Sector 62 Sports Complex, Noida</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-100">
                          <span className="font-bold text-[#171C26] block">Executive Committee</span>
                          <span className="text-gray-600 block mt-0.5">Captain: Vikram Sharma • Match Admin: Rahul Verma</span>
                          <span className="text-[10px] text-gray-400">Affiliated to Delhi-NCR Cricket Association</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            </main>

            {/* 3. DESKTOP RIGHT CONTEXTUAL PANEL (Visible on Desktop in Player View) */}
            {persona === "player" && (
              <aside
                className={`w-80 bg-white border-l border-[#E5E7EB] shrink-0 p-5 space-y-5 overflow-y-auto hidden ${
                  deviceFrame === "desktop" ? "!flex flex-col" : deviceFrame === "responsive" ? "xl:flex flex-col" : ""
                }`}
              >
                {/* Next Fixture Widget */}
                <div className="p-4 rounded-2xl bg-gradient-to-br from-[#A30F2D] to-[#D51F43] text-white space-y-3 shadow-xs">
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className="text-[10px] font-black uppercase tracking-wider text-amber-300">Next Fixture</span>
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px]">{MOCK_MATCHES[0].countdown}</span>
                  </div>
                  <div>
                    <h3 className="font-black text-sm uppercase">{MOCK_MATCHES[0].title}</h3>
                    <p className="text-xs text-white/80 mt-0.5">{MOCK_MATCHES[0].dateString}</p>
                  </div>
                  <div className="pt-2 border-t border-white/20 flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-200">Playing XI Confirmed</span>
                    <button
                      onClick={() => setActiveTab("matches")}
                      className="min-h-[44px] px-3 py-1 bg-white text-[#A30F2D] text-xs font-bold rounded-lg hover:bg-gray-100 transition"
                    >
                      Match Centre →
                    </button>
                  </div>
                </div>

                {/* Outstanding Dues Widget */}
                <div className="p-4 rounded-2xl border border-gray-200 bg-gray-50/50 space-y-2">
                  <span className="text-[10px] text-gray-500 font-black uppercase">Outstanding Balance</span>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-[#D51F43]">₹{duesState.total}</span>
                    <button
                      onClick={() => {
                        setActiveTab("payments");
                        setPaymentModalOpen(true);
                      }}
                      className="min-h-[44px] px-3.5 py-1.5 bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold rounded-xl"
                    >
                      Pay Now
                    </button>
                  </div>
                  <span className="text-[10px] text-gray-500 block">3 active obligations pending settlement</span>
                </div>

                {/* Nets Credits Widget */}
                <div className="p-4 rounded-2xl border border-gray-200 bg-gray-50/50 space-y-2">
                  <span className="text-[10px] text-gray-500 font-black uppercase">Indoor Training Pass</span>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[#171C26]">7 Credits Remaining</span>
                    <button
                      onClick={() => setBookSlotModalOpen(true)}
                      className="min-h-[44px] px-3 py-1 bg-gray-900 hover:bg-black text-white text-xs font-bold rounded-lg transition"
                    >
                      Book Net
                    </button>
                  </div>
                  <span className="text-[10px] text-emerald-700 font-medium block">Valid until 15 Dec 2026</span>
                </div>
              </aside>
            )}
          </div>

          {/* 2. PLAYER MOBILE BOTTOM NAVIGATION (Hidden in Admin Mode & on Desktop) */}
          {persona === "player" && (
            <nav
              role="navigation"
              aria-label="Player Primary Navigation"
              className={`sticky bottom-0 z-40 bg-white border-t border-[#E5E7EB] shadow-lg flex items-center justify-around h-[68px] px-2 ${
                deviceFrame === "desktop" ? "hidden" : "lg:hidden"
              }`}
            >
              <button
                onClick={() => setActiveTab("home")}
                className={`flex-1 h-full min-h-[44px] min-w-[44px] flex flex-col items-center justify-center gap-1 transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 rounded-lg ${
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
                className={`flex-1 h-full min-h-[44px] min-w-[44px] flex flex-col items-center justify-center gap-1 transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 rounded-lg ${
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
                className={`flex-1 h-full min-h-[44px] min-w-[44px] flex flex-col items-center justify-center gap-1 transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 rounded-lg ${
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
                className={`flex-1 h-full min-h-[44px] min-w-[44px] flex flex-col items-center justify-center gap-1 transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 rounded-lg ${
                  activeTab === "performance" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
                }`}
              >
                <div className={`p-1 rounded-lg ${activeTab === "performance" ? "bg-[#FCE8ED]" : ""}`}>
                  <Award className="w-5 h-5" />
                </div>
                <span className="text-[10px] tracking-tight">Performance</span>
              </button>

              <button
                onClick={() => setActiveTab("club")}
                className={`flex-1 h-full min-h-[44px] min-w-[44px] flex flex-col items-center justify-center gap-1 transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 rounded-lg ${
                  activeTab === "club" ? "text-[#D51F43] font-black" : "text-[#667085] font-medium"
                }`}
              >
                <div className={`p-1 rounded-lg ${activeTab === "club" ? "bg-[#FCE8ED]" : ""}`}>
                  <Shield className="w-5 h-5" />
                </div>
                <span className="text-[10px] tracking-tight">Club</span>
              </button>
            </nav>
          )}

          {/* ========================================================================= */}
          {/* SQUAD & ATTENDANCE MANAGEMENT DRAWER (Admin Match Centre)                 */}
          {/* ========================================================================= */}
          {adminMatchSquadDrawer && (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
              <div
                className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col overflow-y-auto text-xs"
                role="dialog"
                aria-modal="true"
                aria-labelledby="squad-drawer-title"
              >
                <div className="p-4 bg-[#A30F2D] text-white flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      Match Centre Squad Management
                    </span>
                    <h3 id="squad-drawer-title" className="text-sm sm:text-base font-black truncate">{adminMatchSquadDrawer.title}</h3>
                  </div>
                  <button
                    onClick={() => setAdminMatchSquadDrawer(null)}
                    aria-label="Close squad management"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 flex-1">
                  <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 text-amber-900 text-xs flex items-center justify-between">
                    <span>Playing XI Confirmed ({adminMatchSquadDrawer.playingXI.length} Players)</span>
                    <span className="font-bold text-[#A30F2D]">Fee: ₹{adminMatchSquadDrawer.matchFee} / player</span>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-bold text-gray-700 uppercase tracking-wider text-[11px]">
                      Pitch Attendance & Match Fee Status:
                    </h4>

                    <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden bg-white">
                      {adminMatchSquadDrawer.playingXI.map((pl: any, idx: number) => (
                        <div key={idx} className="p-3 flex items-center justify-between">
                          <div>
                            <div className="font-bold text-sm text-[#171C26]">{pl.name}</div>
                            <div className="text-[11px] text-[#667085] flex items-center gap-2 mt-0.5">
                              <span>{pl.role}</span>
                              <span>•</span>
                              <span className={pl.feePaid ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                                {pl.feePaid ? "Fee Paid" : "Fee Unpaid"}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleAttendance(pl.name)}
                              aria-label={`Toggle attendance for ${pl.name}, currently ${pl.attendance}`}
                              className={`min-h-[44px] min-w-[76px] px-3.5 py-2 rounded-lg text-xs font-bold flex items-center justify-center transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 ${
                                pl.attendance === "Present"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : pl.attendance === "Late"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {pl.attendance}
                            </button>

                            {!pl.feePaid && (
                              <button
                                onClick={() => setRecordCashModalOpen(true)}
                                aria-label={`Collect pitch cash for ${pl.name}`}
                                className="min-h-[44px] min-w-[68px] px-3.5 py-2 rounded-lg bg-[#D51F43] hover:bg-[#A30F2D] text-white text-xs font-bold flex items-center justify-center transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40"
                              >
                                Collect
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setSimulationToast("[PROTOTYPE SIMULATION] Playing XI WhatsApp broadcast preview generated (no real WhatsApp message sent).");
                      setAdminMatchSquadDrawer(null);
                    }}
                    className="w-full min-h-[44px] bg-[#A30F2D] hover:bg-[#D51F43] text-white font-bold rounded-xl"
                  >
                    Save & Broadcast Squad Announcement
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* PLAYER PROFILE & ROLE ASSIGNMENT DRAWER (Admin Roster)                    */}
          {/* ========================================================================= */}
          {selectedPlayerProfile && (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
              <div
                className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col overflow-y-auto text-xs"
                role="dialog"
                aria-modal="true"
                aria-label="Edit Player Profile & Roles"
              >
                <div className="p-4 bg-[#A30F2D] text-white flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      Edit Player Profile & Roles
                    </span>
                    <h3 className="text-sm sm:text-base font-black truncate">{selectedPlayerProfile.name}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedPlayerProfile(null)}
                    aria-label="Close player profile"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 flex-1">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Full Name</label>
                    <input
                      type="text"
                      defaultValue={selectedPlayerProfile.name}
                      className="w-full text-xs p-2.5 rounded-xl border border-gray-300"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">
                      Jersey Number (Real-Time Validation)
                    </label>
                    <input
                      type="text"
                      value={selectedPlayerProfile.jerseyNumber}
                      onChange={(e) => handleJerseyChange(e.target.value)}
                      className={`w-full text-xs p-2.5 rounded-xl border ${
                        jerseyValidationWarning ? "border-rose-500 bg-rose-50/30" : "border-gray-300"
                      }`}
                    />
                    {jerseyValidationWarning && (
                      <p className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{jerseyValidationWarning}</span>
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-gray-700 block mb-1">Batting Style</label>
                      <select
                        defaultValue={selectedPlayerProfile.battingStyle}
                        className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white"
                      >
                        <option>Right-hand bat</option>
                        <option>Left-hand bat</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-gray-700 block mb-1">Kit T-Shirt</label>
                      <select
                        defaultValue={selectedPlayerProfile.tshirtSize}
                        className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white"
                      >
                        <option>M</option>
                        <option>L</option>
                        <option>XL</option>
                        <option>XXL</option>
                      </select>
                    </div>
                  </div>

                  {/* Granular Roles Checkboxes (SEC-001 Compliant) */}
                  <div className="pt-2 border-t border-gray-200">
                    <label className="font-bold text-gray-800 uppercase tracking-wider text-[11px] block mb-2">
                      Granular Capability Permissions:
                    </label>
                    <div className="space-y-2">
                      {[
                        { role: "matchAdmin", label: "Match Admin (Fixtures, Squads, Pitch Cash)" },
                        { role: "financeAdmin", label: "Finance Admin (Accounting, Debtor Ledger)" },
                        { role: "studioAdmin", label: "Studio Admin (Nets Passes, Extensions)" },
                        { role: "isDesigner", label: "Designer (Social Canvas Graphics)" }
                      ].map((item) => {
                        const hasRole = selectedPlayerProfile.roles.includes(item.role);
                        return (
                          <label key={item.role} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-200 cursor-pointer">
                            <input
                              type="checkbox"
                              defaultChecked={hasRole}
                              className="rounded text-[#D51F43] focus:ring-[#D51F43]"
                            />
                            <span className="text-xs font-semibold text-gray-700">{item.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-200 bg-gray-50">
                  <button
                    onClick={() => {
                      if (jerseyValidationWarning) {
                        setSimulationToast("[VALIDATION ERROR] Cannot save profile while jersey validation collision exists!");
                        return;
                      }
                      setSimulationToast("[PROTOTYPE SIMULATION] Player profile & granular permissions updated locally.");
                      setSelectedPlayerProfile(null);
                    }}
                    className="w-full min-h-[44px] bg-[#A30F2D] hover:bg-[#D51F43] text-white font-bold rounded-xl"
                  >
                    Save Changes & Update Claims
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* DUPLICATE PLAYER MERGE MODAL (Admin Roster IDT-001)                       */}
          {/* ========================================================================= */}
          {mergeModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs max-h-[90vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="merge-modal-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <GitMerge className="w-4 h-4 text-amber-300" />
                    <h3 id="merge-modal-title" className="text-sm font-black uppercase">Merge Duplicate Players</h3>
                  </div>
                  <button
                    onClick={() => setMergeModalOpen(false)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-[11px]">
                    <span className="font-bold">IDT-001 Safeguard:</span> Merging reparents all matches, scorecards, and payments from the duplicate player to the primary player, and updates <code className="font-mono bg-white px-1 rounded">appUsers.playerId</code>.
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Source Duplicate Player (To be disabled)</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Ashutosh D (Ghost Profile - No KAV-ID)</option>
                      <option>Vikram S (Unverified)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Target Primary Player (Preserved Record)</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Ashutosh Dixit (KAV-007) - Authoritative</option>
                      <option>Vikram Sharma (KAV-001)</option>
                    </select>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-gray-700 space-y-1 text-[11px]">
                    <div className="font-bold text-[#171C26]">Dry-Run Summary:</div>
                    <div>• 14 Matches will be reparented</div>
                    <div>• 8 Payment records will be reparented</div>
                    <div>• 1 Firebase User link updated to KAV-007</div>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setSimulationToast("[PROTOTYPE SIMULATION] Dry-run merge preview executed: references reparented in memory (no database mutation).");
                        setMergeModalOpen(false);
                      }}
                      className="w-full min-h-[44px] bg-[#A30F2D] hover:bg-[#D51F43] text-white font-bold rounded-xl"
                    >
                      Execute Relational Merge
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CREATE MATCH MODAL */}
          {createMatchModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs max-h-[90vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-match-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-300" />
                    <h3 id="create-match-title" className="text-sm font-black uppercase">Schedule New Match</h3>
                  </div>
                  <button
                    onClick={() => setCreateMatchModalOpen(false)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Opposition Club Name</label>
                    <input
                      type="text"
                      defaultValue="Titan CC"
                      className="w-full text-xs p-2.5 rounded-xl border border-gray-300"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-gray-700 block mb-1">Match Format</label>
                      <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                        <option>20 Overs T20</option>
                        <option>35 Overs Leather Ball</option>
                        <option>Net Practice Match</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-gray-700 block mb-1">Match Fee / Player</label>
                      <input
                        type="number"
                        defaultValue="500"
                        className="w-full text-xs p-2.5 rounded-xl border border-gray-300"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Venue / Ground</label>
                    <input
                      type="text"
                      defaultValue="Kavach Arena Ground 1"
                      className="w-full text-xs p-2.5 rounded-xl border border-gray-300"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setSimulationToast("[PROTOTYPE SIMULATION] Match fixture created locally (no database mutation).");
                        setCreateMatchModalOpen(false);
                      }}
                      className="w-full min-h-[44px] bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold rounded-xl"
                    >
                      Publish Fixture & Notify Squad
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RECORD CASH MODAL */}
          {recordCashModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs max-h-[90vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="record-cash-title"
              >
                <div className="bg-emerald-700 text-white p-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-white" />
                    <h3 id="record-cash-title" className="text-sm font-black uppercase">Record Pitch-Side Cash</h3>
                  </div>
                  <button
                    onClick={() => setRecordCashModalOpen(false)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto flex-1">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Select Player</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Vikram Sharma (KAV-001)</option>
                      <option>Rahul Verma (KAV-012)</option>
                      <option>Sameer Khan (KAV-018)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Amount Received (Cash / Pitch UPI)</label>
                    <input
                      type="number"
                      defaultValue="500"
                      className="w-full text-xs p-2.5 rounded-xl border border-gray-300 text-sm font-black"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setSimulationToast("[PROTOTYPE SIMULATION] Pitch-side cash collection recorded locally (no financial ledger mutation).");
                        setRecordCashModalOpen(false);
                      }}
                      className="w-full min-h-[44px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
                    >
                      Confirm Cash Collection
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MATCH DETAILS SLIDE-OVER DRAWER */}
          {selectedMatch && (
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex justify-end">
              <div
                className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col overflow-y-auto"
                role="dialog"
                aria-modal="true"
                aria-labelledby="match-details-title"
              >
                <div className="p-4 bg-[#A30F2D] text-white flex items-center justify-between sticky top-0 z-10">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      {selectedMatch.format}
                    </span>
                    <h3 id="match-details-title" className="text-sm sm:text-base font-black truncate">{selectedMatch.title}</h3>
                  </div>
                  <button
                    onClick={() => setSelectedMatch(null)}
                    aria-label="Close match details"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex border-b border-gray-100 bg-gray-50 text-xs font-bold px-4">
                  <button
                    onClick={() => setSelectedMatchSubTab("overview")}
                    className={`min-h-[44px] px-3 border-b-2 flex items-center justify-center transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 ${
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
                      className={`min-h-[44px] px-3 border-b-2 flex items-center justify-center transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 ${
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
                      className={`min-h-[44px] px-3 border-b-2 flex items-center justify-center transition focus:outline-hidden focus:ring-2 focus:ring-[#D51F43]/40 ${
                        selectedMatchSubTab === "catches"
                          ? "border-[#D51F43] text-[#D51F43]"
                          : "border-transparent text-gray-500 hover:text-gray-900"
                      }`}
                    >
                      Fielding & Catches
                    </button>
                  )}
                </div>

                <div className="p-5 space-y-5 flex-1">
                  {selectedMatchSubTab === "overview" && (
                    <>
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

          {/* DIGITAL RECEIPT MODAL */}
          {selectedReceipt && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs"
                role="dialog"
                aria-modal="true"
                aria-labelledby="receipt-modal-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 text-center relative">
                  <button
                    onClick={() => setSelectedReceipt(null)}
                    aria-label="Close Receipt Modal"
                    className="min-h-[44px] min-w-[44px] absolute right-2 top-2 flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                    Digital Payment Receipt (Prototype Simulation)
                  </div>
                  <h4 className="text-base font-black uppercase tracking-tight mt-0.5">KAvach Cricket Club</h4>
                  <div className="text-[10px] opacity-80">play.kavachcricket.com</div>
                </div>

                <div className="p-5 space-y-3">
                  <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-bold text-center">
                    [PROTOTYPE SIMULATION] Simulated club receipt preview. Real financial records untouched.
                  </div>
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
                      onClick={() => setSimulationToast("[PROTOTYPE SIMULATION] PDF receipt download initiated (mock export).")}
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
              <div
                className="w-full max-w-sm bg-white h-full shadow-2xl flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="notifications-drawer-title"
              >
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-5 h-5 text-[#D51F43]" />
                    <h3 id="notifications-drawer-title" className="text-sm font-black uppercase text-[#171C26]">Club Notifications</h3>
                  </div>
                  <button
                    onClick={() => setNotificationsOpen(false)}
                    aria-label="Close notifications"
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
                    className="w-full min-h-[44px] text-xs font-bold text-[#D51F43] hover:underline flex items-center justify-center"
                  >
                    Close Drawer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 5: LEVY AD-HOC FEE MODAL */}
          {adHocFeeModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs"
                role="dialog"
                aria-modal="true"
                aria-labelledby="adhoc-fee-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-white" />
                    <h3 id="adhoc-fee-title" className="text-sm font-black uppercase">Levy Member Ad-hoc Fee</h3>
                  </div>
                  <button
                    onClick={() => setAdHocFeeModalOpen(false)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Select Player</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Rohan Mehta (KAV-007)</option>
                      <option>Kunal Roy (KAV-021)</option>
                      <option>Devendra Joshi (KAV-033)</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Fee Category</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Late-Withdrawal Penalty</option>
                      <option>Practice Gear / Equipment Damage</option>
                      <option>Custom Kit Printing Levy</option>
                      <option>Annual Club Membership Dues</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Fee Amount (₹)</label>
                    <input
                      type="number"
                      defaultValue="300"
                      className="w-full text-xs p-2.5 rounded-xl border border-gray-300 font-bold"
                    />
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Due Date</label>
                    <input
                      type="date"
                      defaultValue="2026-11-25"
                      className="w-full text-xs p-2.5 rounded-xl border border-gray-300"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setSimulationToast("[PROTOTYPE SIMULATION] Ad-hoc fee obligation levied locally (no database mutation).");
                        setAdHocFeeModalOpen(false);
                      }}
                      className="w-full min-h-[44px] bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold rounded-xl"
                    >
                      Issue Obligation & Notify Member
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 5: FINANCIAL AUDIT TRAIL MODAL */}
          {selectedAuditTx && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs"
                role="dialog"
                aria-modal="true"
                aria-labelledby="audit-record-title"
              >
                <div className="bg-[#171C26] text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    <h3 id="audit-record-title" className="text-sm font-black uppercase">Transaction Audit Record</h3>
                  </div>
                  <button
                    onClick={() => setSelectedAuditTx(null)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-3">
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Record ID:</span>
                      <span className="font-mono font-bold">{selectedAuditTx.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Member:</span>
                      <span className="font-bold">{selectedAuditTx.playerName} ({selectedAuditTx.kavachId})</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Description:</span>
                      <span className="font-bold">{selectedAuditTx.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Amount:</span>
                      <span className="font-black text-emerald-600">₹{selectedAuditTx.amount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Payment Channel:</span>
                      <span className="font-bold">{selectedAuditTx.channel || "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Authorized By:</span>
                      <span className="font-bold">{selectedAuditTx.collectedBy || "System"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 font-medium">Receipt / Audit Token:</span>
                      <span className="font-mono font-bold text-gray-700">{selectedAuditTx.receiptNo || "N/A"}</span>
                    </div>
                  </div>

                  <div className="p-2.5 rounded-xl bg-blue-50 text-blue-900 text-[11px]">
                    <span className="font-bold">Authoritative Ledger Guarantee:</span> This record is cryptographically bound to the server payment intent and cannot be modified via client-side requests.
                  </div>

                  <button
                    onClick={() => setSelectedAuditTx(null)}
                    className="w-full min-h-[44px] bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition"
                  >
                    Close Audit Log
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STAGE 5: BOOK NET SLOT MODAL */}
          {bookSlotModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs"
                role="dialog"
                aria-modal="true"
                aria-labelledby="reserve-lane-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <h3 id="reserve-lane-title" className="text-sm font-black uppercase">Reserve Net Lane</h3>
                  </div>
                  <button
                    onClick={() => setBookSlotModalOpen(false)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Select Lane</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Lane 1: Fast Bowling Turf</option>
                      <option>Lane 2: Spin / Multi-Turf</option>
                      <option>Lane 3: Bowling Machine</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Time Slot (60 min)</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>06:00 AM - 07:00 AM</option>
                      <option>07:00 AM - 08:00 AM</option>
                      <option>06:00 PM - 07:00 PM</option>
                      <option>07:00 PM - 08:00 PM</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Book For Member</label>
                    <select className="w-full text-xs p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Ashutosh Dixit (KAV-002) - Active Pass (7 credits)</option>
                      <option>Rohan Mehta (KAV-007) - Monthly Unlimited</option>
                      <option>Kunal Roy (KAV-021) - Drop-in Voucher</option>
                    </select>
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setSimulationToast("[PROTOTYPE SIMULATION] Net practice lane reserved locally; session credit deducted from mock balance.");
                        setBookSlotModalOpen(false);
                      }}
                      className="w-full min-h-[44px] bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold rounded-xl"
                    >
                      Confirm Net Reservation
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MOCK PAYMENT CHECKOUT MODAL */}
          {paymentModalOpen && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden max-h-[90vh] flex flex-col"
                role="dialog"
                aria-modal="true"
                aria-labelledby="checkout-modal-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-amber-300" />
                    <h3 id="checkout-modal-title" className="text-sm font-black uppercase">Payment Checkout — Prototype Simulation</h3>
                  </div>
                  <button
                    onClick={() => setPaymentModalOpen(false)}
                    aria-label="Close Checkout"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto flex-1">
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
                    <div className="p-3.5 rounded-xl bg-emerald-50 text-emerald-900 text-xs font-bold text-center flex items-center justify-center gap-2 border border-emerald-200">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <div className="font-mono text-[9px] font-black uppercase text-emerald-800">[PROTOTYPE SIMULATION]</div>
                        <div>Test payment of ₹{duesState.total} completed locally. Real Razorpay & Firebase states untouched.</div>
                      </div>
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

          {/* STAGE 6 REMEDIATION: CLUB SHOP ITEM ORDER MODAL */}
          {shopItemOrderModal && (
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
              <div
                className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden text-xs"
                role="dialog"
                aria-modal="true"
                aria-labelledby="shop-item-modal-title"
              >
                <div className="bg-[#A30F2D] text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="w-4 h-4 text-white" />
                    <h3 id="shop-item-modal-title" className="text-sm font-black uppercase">Order Club Merchandise</h3>
                  </div>
                  <button
                    onClick={() => setShopItemOrderModal(null)}
                    aria-label="Close modal"
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center text-white/80 hover:text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#FCE8ED] text-[#A30F2D] flex items-center justify-center font-black">
                      <Shirt className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#171C26]">{shopItemOrderModal.title}</h4>
                      <span className="font-black text-sm text-[#D51F43]">₹{shopItemOrderModal.price}</span>
                    </div>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Select Size</label>
                    <div className="grid grid-cols-5 gap-2">
                      {shopItemOrderModal.sizes.map((sz: string) => (
                        <button
                          key={sz}
                          onClick={() => setSelectedShopSize(sz)}
                          className={`min-h-[44px] rounded-xl font-bold text-xs border transition ${
                            selectedShopSize === sz
                              ? "bg-[#D51F43] text-white border-[#D51F43]"
                              : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="font-bold text-gray-700 block mb-1">Collection Preference</label>
                    <select className="w-full min-h-[44px] p-2.5 rounded-xl border border-gray-300 bg-white">
                      <option>Pitch-Side Collection (Next Fixture)</option>
                      <option>Studio Front Desk Pickup (Noida Sector 62)</option>
                      <option>Courier Delivery (+₹100)</option>
                    </select>
                  </div>

                  <div className="p-2.5 rounded-xl bg-amber-50 text-amber-900 text-[11px] border border-amber-200">
                    <span className="font-bold">[PROTOTYPE SIMULATION]:</span> Placing this order adds a simulated order record to local prototype state. No real payment or production dispatch occurs.
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setMerchOrders(prev => [
                          {
                            id: `ORD-${Math.floor(1100 + Math.random() * 900)}`,
                            playerName: MOCK_CURRENT_PLAYER.name,
                            kavachId: MOCK_CURRENT_PLAYER.kavachId,
                            item: shopItemOrderModal.title,
                            size: selectedShopSize,
                            qty: 1,
                            total: shopItemOrderModal.price,
                            status: "New Order",
                            date: "Today"
                          },
                          ...prev
                        ]);
                        showSimulationToast(`[PROTOTYPE SIMULATION] Kit order for ${shopItemOrderModal.title} (Size: ${selectedShopSize}) placed in local memory.`);
                        setShopItemOrderModal(null);
                      }}
                      className="w-full min-h-[48px] bg-[#D51F43] hover:bg-[#A30F2D] text-white font-bold rounded-xl"
                    >
                      Confirm Simulated Order (₹{shopItemOrderModal.price})
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
