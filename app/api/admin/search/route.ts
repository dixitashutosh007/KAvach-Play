import { NextResponse } from "next/server.js";
import { getServerFirestore, requireRole } from "../../../../lib/server-auth.ts";
import {
  executeAdminSearch,
  getPermittedAdminSearchCategories,
  type AdminSearchDataset,
  type AdminSearchRoleContext,
} from "../../../../lib/admin-search.ts";
import { fetchAllProjected } from "../../../../lib/admin-search-server.ts";
import { checkSharedRateLimit } from "../../../../lib/rate-limit-server.ts";

const FINANCE_PLAYER_SELECT = [
  "name",
  "kavachId",
  "jerseyNumber",
  "inviteStatus",
  "disabled",
  "isStudioMember",
  "studioPlan",
  "studioExpiryDate",
] as const;

const CLUB_PLAYER_SELECT = [
  "name",
  "kavachId",
  "jerseyNumber",
  "jerseyName",
  "mobile",
  "email",
  "locality",
  "inviteStatus",
  "disabled",
  "isStudioMember",
  "studioPlan",
  "studioExpiryDate",
] as const;

const CLUB_MATCH_SELECT = [
  "opponent",
  "date",
  "groundId",
  "tournamentId",
  "format",
  "matchType",
  "result",
  "resultMarginType",
  "resultMarginAmount",
  "isArchived",
] as const;

const FINANCE_MATCH_SELECT = [
  ...CLUB_MATCH_SELECT,
  "fee",
  "financeStatus",
] as const;

const CLUB_SUBSCRIPTION_SELECT = [
  "playerId",
  "planName",
  "newExpiryDate",
] as const;

const FINANCE_SUBSCRIPTION_SELECT = [
  ...CLUB_SUBSCRIPTION_SELECT,
  "paidAmount",
] as const;

const CLUB_GROUND_SELECT = [
  "name",
  "location",
  "address",
  "city",
  "organiserName",
] as const;

const CLUB_TOURNAMENT_SELECT = [
  "name",
  "groundId",
  "startDate",
  "endDate",
  "status",
  "format",
] as const;

const CLUB_ANNOUNCEMENT_SELECT = [
  "title",
  "text",
  "authorName",
  "isAnnouncement",
  "isPinned",
  "createdAt",
] as const;

const CLUB_POLL_SELECT = [
  "title",
  "type",
  "options",
  "isActive",
  "isSticked",
] as const;

const CLUB_BADGE_SELECT = [
  "playerId",
  "playerName",
  "badgeType",
  "awardedAt",
  "note",
] as const;

const CLUB_BADGE_DEF_SELECT = [
  "label",
  "tier",
] as const;

const CLUB_CATCH_SELECT = [
  "playerId",
  "playerName",
  "type",
  "count",
  "matchId",
  "comment",
  "recordedAt",
] as const;

const CLUB_MERCH_SELECT = [
  "name",
  "description",
  "category",
  "status",
] as const;

const CLUB_MERCH_ORDER_SELECT = [
  "merchName",
  "playerName",
  "size",
  "orderStatus",
] as const;

const FINANCE_PAYMENT_SELECT = [
  "playerId",
  "guestName",
  "status",
  "paymentMethod",
  "manualMethod",
  "planTag",
  "razorpayPaymentId",
  "feeCollectedAmount",
  "feeOverride",
] as const;

const FINANCE_OTHER_FEE_SELECT = [
  "playerId",
  "title",
  "comment",
  "status",
  "amount",
  "createdAt",
] as const;

const FINANCE_PLAN_SELECT = [
  "name",
  "type",
  "description",
  "feeAmount",
  "monthlyAmount",
  "discountPct",
  "isActive",
] as const;

const FINANCE_ASSIGNMENT_SELECT = [
  "playerId",
  "planName",
  "startDate",
  "endDate",
  "cancelled",
] as const;

/**
 * GET /api/admin/search?q=<query>&limit=<perCategoryLimit>
 *
 * Server-side, role-enforced Admin Global Search.
 * - Super Admin: all permitted club and financial categories.
 * - Club Admin: club operations & PII only; financial collections AND financial fields
 *   on shared collections (`matches.fee`, `subscriptionHistory.paidAmount`, etc.) are
 *   excluded at the Firestore `.select()` level.
 * - Finance Admin: financial & bounded non-PII data only; PII and club-only collections
 *   are excluded at the Firestore `.select()` level.
 */
export async function GET(req: Request) {
  const guard = await requireRole(req, ["superAdmin", "clubAdmin", "financeAdmin"]);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get("q") || "").trim();
  if (rawQuery.length < 2) {
    return NextResponse.json(
      { error: "Search query must be at least 2 non-whitespace characters." },
      { status: 400 },
    );
  }
  if (rawQuery.length > 120) {
    return NextResponse.json(
      { error: "Search query must be 120 characters or fewer." },
      { status: 400 },
    );
  }

  const rawLimit = url.searchParams.get("limit");
  let perCategoryLimit = 15;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
      return NextResponse.json(
        { error: "Invalid limit parameter (must be an integer between 1 and 50)." },
        { status: 400 },
      );
    }
    perCategoryLimit = parsed;
  }

  const roles: AdminSearchRoleContext = {
    isSuperAdmin: guard.roles.has("superAdmin"),
    isClubAdmin: guard.roles.has("clubAdmin"),
    isFinanceAdmin: guard.roles.has("financeAdmin"),
  };

  const permitted = new Set(getPermittedAdminSearchCategories(roles));
  const canSeeClub = roles.isSuperAdmin || roles.isClubAdmin;
  const canSeeFinance = roles.isSuperAdmin || roles.isFinanceAdmin;

  try {
    const db = getServerFirestore();
    const rate = await checkSharedRateLimit(db, "admin_search", guard.uid, {
      windowMs: 60_000,
      maxRequests: 30,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many search requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
      );
    }
    const dataset: AdminSearchDataset = {};
    const tasks: Array<Promise<void>> = [];

    // Players: field-projected according to role (Finance-only never reads PII fields)
    if (permitted.has("players") || permitted.has("finance") || permitted.has("noShows") || permitted.has("studio")) {
      const fields = canSeeClub ? CLUB_PLAYER_SELECT : FINANCE_PLAYER_SELECT;
      tasks.push(
        fetchAllProjected(db.collection("players").select(...fields), { orderByDocId: true }).then((rows) => {
          dataset.players = rows;
        }),
      );
    }

    // Matches, Grounds, Tournaments
    if (
      permitted.has("matches") ||
      permitted.has("grounds") ||
      permitted.has("tournaments") ||
      permitted.has("finance") ||
      permitted.has("catches")
    ) {
      const matchFields = canSeeFinance ? FINANCE_MATCH_SELECT : CLUB_MATCH_SELECT;
      tasks.push(
        fetchAllProjected(db.collection("matches").select(...matchFields), { orderByDocId: true }).then((rows) => {
          dataset.matches = rows;
        }),
      );
      if (canSeeClub) {
        tasks.push(
          fetchAllProjected(db.collection("grounds").select(...CLUB_GROUND_SELECT), { orderByDocId: true }).then((rows) => {
            dataset.grounds = rows;
          }),
        );
        tasks.push(
          fetchAllProjected(db.collection("tournaments").select(...CLUB_TOURNAMENT_SELECT), { orderByDocId: true }).then((rows) => {
            dataset.tournaments = rows;
          }),
        );
      }
    }

    // Club-only operational collections (never queried for Finance-only Admin)
    if (canSeeClub) {
      if (permitted.has("announcements")) {
        tasks.push(
          fetchAllProjected(
            db
              .collection("posts")
              .where("isAnnouncement", "==", true)
              .select(...CLUB_ANNOUNCEMENT_SELECT),
          ).then((rows) => {
            dataset.announcements = rows;
          }),
        );
      }

      if (permitted.has("pulse")) {
        // Never query pollResponses — only public poll metadata
        tasks.push(
          fetchAllProjected(db.collection("polls").select(...CLUB_POLL_SELECT)).then((rows) => {
            dataset.polls = rows;
          }),
        );
      }

      if (permitted.has("badges")) {
        tasks.push(
          fetchAllProjected(db.collection("badges").select(...CLUB_BADGE_SELECT)).then((rows) => {
            dataset.badges = rows;
          }),
        );
        tasks.push(
          fetchAllProjected(db.collection("badgeTypeDefs").select(...CLUB_BADGE_DEF_SELECT)).then((rows) => {
            dataset.badgeTypeDefs = rows;
          }),
        );
      }

      if (permitted.has("catches")) {
        tasks.push(
          fetchAllProjected(db.collection("catchLog").select(...CLUB_CATCH_SELECT)).then((rows) => {
            dataset.catches = rows;
          }),
        );
      }

      if (permitted.has("shop")) {
        tasks.push(
          fetchAllProjected(db.collection("merchandises").select(...CLUB_MERCH_SELECT)).then((rows) => {
            dataset.merchandises = rows;
          }),
        );
        tasks.push(
          fetchAllProjected(db.collection("merchOrders").select(...CLUB_MERCH_ORDER_SELECT)).then((rows) => {
            dataset.merchOrders = rows;
          }),
        );
      }
    }

    // Studio subscription history (paidAmount excluded at Firestore .select() level for Club-only Admin)
    if (permitted.has("studio")) {
      const subFields = canSeeFinance ? FINANCE_SUBSCRIPTION_SELECT : CLUB_SUBSCRIPTION_SELECT;
      tasks.push(
        fetchAllProjected(db.collection("subscriptionHistory").select(...subFields)).then((rows) => {
          dataset.subscriptionHistory = rows;
        }),
      );
    }

    // Financial collections (STRICTLY Finance Admin / Super Admin — never queried for Club-only Admin)
    if (canSeeFinance) {
      if (permitted.has("finance")) {
        tasks.push(
          fetchAllProjected(
            db.collectionGroup("payments").select(...FINANCE_PAYMENT_SELECT),
            { extra: (doc) => ({ matchId: doc.ref.parent.parent?.id || "" }) },
          ).then((rows) => {
            dataset.matchPayments = rows;
          }),
        );
        tasks.push(
          fetchAllProjected(db.collection("feePlans").select(...FINANCE_PLAN_SELECT), { orderByDocId: true }).then((rows) => {
            dataset.feePlans = rows;
          }),
        );
        tasks.push(
          fetchAllProjected(
            db.collection("financePlanAssignments").select(...FINANCE_ASSIGNMENT_SELECT),
            { orderByDocId: true },
          ).then((rows) => {
            dataset.feePlanAssignments = rows;
          }),
        );
      }

      if (permitted.has("finance") || permitted.has("noShows")) {
        tasks.push(
          fetchAllProjected(
            db.collectionGroup("otherFees").select(...FINANCE_OTHER_FEE_SELECT),
            { extra: (doc) => ({ playerId: doc.data()?.playerId || doc.ref.parent.parent?.id || "" }) },
          ).then((rows) => {
            dataset.otherFees = rows;
          }),
        );
      }
    }

    await Promise.all(tasks);

    const results = executeAdminSearch(dataset, rawQuery, roles, perCategoryLimit);
    return NextResponse.json(results);
  } catch (err) {
    console.error("[admin-search] failed:", err);
    return NextResponse.json(
      { error: "Unable to complete admin search right now." },
      { status: 500 },
    );
  }
}
