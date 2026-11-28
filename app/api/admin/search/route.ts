import { NextResponse } from "next/server.js";
import { getServerFirestore, requireRole } from "../../../../lib/server-auth.ts";
import {
  executeAdminSearch,
  getPermittedAdminSearchCategories,
  type AdminSearchDataset,
  type AdminSearchRoleContext,
} from "../../../../lib/admin-search.ts";
import { fetchAllProjected, getOrLoadRoleScopedDataset } from "../../../../lib/admin-search-server.ts";
import { checkSharedRateLimit } from "../../../../lib/rate-limit-server.ts";

const FINANCE_PLAYER_SELECT = [
  "name",
  "kavachId",
  "jerseyNumber",
  "inviteStatus",
  "disabled",
  "mergedInto",
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
  "mergedInto",
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
    const startedAt = Date.now();
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

    const bypassCache = process.env.NODE_ENV === "test";
    const { dataset, cacheHit } = await getOrLoadRoleScopedDataset(
      roles,
      async () => {
        const nextDataset: AdminSearchDataset = {};
        const tasks: Array<Promise<void>> = [];

        if (permitted.has("players") || permitted.has("finance") || permitted.has("noShows") || permitted.has("studio")) {
          const fields = canSeeClub ? CLUB_PLAYER_SELECT : FINANCE_PLAYER_SELECT;
          tasks.push(
            fetchAllProjected(db.collection("players").select(...fields), { orderByDocId: true }).then((rows) => {
              nextDataset.players = rows;
            }),
          );
        }

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
              nextDataset.matches = rows;
            }),
          );
          if (canSeeClub) {
            tasks.push(
              fetchAllProjected(db.collection("grounds").select(...CLUB_GROUND_SELECT), { orderByDocId: true }).then((rows) => {
                nextDataset.grounds = rows;
              }),
            );
            tasks.push(
              fetchAllProjected(db.collection("tournaments").select(...CLUB_TOURNAMENT_SELECT), { orderByDocId: true }).then((rows) => {
                nextDataset.tournaments = rows;
              }),
            );
          }
        }

        if (canSeeClub) {
          if (permitted.has("announcements") || permitted.has("feedPosts")) {
            tasks.push(
              fetchAllProjected(
                db.collection("posts").select(...CLUB_ANNOUNCEMENT_SELECT),
                { orderByDocId: true },
              ).then((rows) => {
                nextDataset.announcements = rows;
              }),
            );
          }

          if (permitted.has("pulse")) {
            tasks.push(
              fetchAllProjected(db.collection("polls").select(...CLUB_POLL_SELECT)).then((rows) => {
                nextDataset.polls = rows;
              }),
            );
          }

          if (permitted.has("badges")) {
            tasks.push(
              fetchAllProjected(db.collection("badges").select(...CLUB_BADGE_SELECT)).then((rows) => {
                nextDataset.badges = rows;
              }),
            );
            tasks.push(
              fetchAllProjected(db.collection("badgeTypes").select(...CLUB_BADGE_DEF_SELECT)).then((rows) => {
                nextDataset.badgeTypeDefs = rows;
              }),
            );
          }

          if (permitted.has("catches")) {
            tasks.push(
              fetchAllProjected(db.collection("catchLog").select(...CLUB_CATCH_SELECT)).then((rows) => {
                nextDataset.catches = rows;
              }),
            );
          }

          if (permitted.has("shop")) {
            tasks.push(
              fetchAllProjected(db.collection("merchandises").select(...CLUB_MERCH_SELECT)).then((rows) => {
                nextDataset.merchandises = rows;
              }),
            );
            tasks.push(
              fetchAllProjected(db.collection("merchOrders").select(...CLUB_MERCH_ORDER_SELECT)).then((rows) => {
                nextDataset.merchOrders = rows;
              }),
            );
          }
        }

        if (permitted.has("studio")) {
          const subFields = canSeeFinance ? FINANCE_SUBSCRIPTION_SELECT : CLUB_SUBSCRIPTION_SELECT;
          tasks.push(
            fetchAllProjected(db.collection("subscriptionHistory").select(...subFields)).then((rows) => {
              nextDataset.subscriptionHistory = rows;
            }),
          );
        }

        if (canSeeFinance) {
          if (permitted.has("finance")) {
            tasks.push(
              fetchAllProjected(
                db.collectionGroup("payments").select(...FINANCE_PAYMENT_SELECT),
                { extra: (doc) => ({ matchId: doc.ref.parent.parent?.id || "" }) },
              ).then((rows) => {
                nextDataset.matchPayments = rows;
              }),
            );
            tasks.push(
              fetchAllProjected(db.collection("feePlans").select(...FINANCE_PLAN_SELECT), { orderByDocId: true }).then((rows) => {
                nextDataset.feePlans = rows;
              }),
            );
            tasks.push(
              fetchAllProjected(
                db.collection("financePlanAssignments").select(...FINANCE_ASSIGNMENT_SELECT),
                { orderByDocId: true },
              ).then((rows) => {
                nextDataset.feePlanAssignments = rows;
              }),
            );
          }

          if (permitted.has("finance") || permitted.has("noShows")) {
            tasks.push(
              fetchAllProjected(
                db.collectionGroup("otherFees").select(...FINANCE_OTHER_FEE_SELECT),
                { extra: (doc) => ({ playerId: doc.data()?.playerId || doc.ref.parent.parent?.id || "" }) },
              ).then((rows) => {
                nextDataset.otherFees = rows;
              }),
            );
          }
        }

        await Promise.all(tasks);
        return nextDataset;
      },
      bypassCache,
    );

    const results = executeAdminSearch(dataset, rawQuery, roles, perCategoryLimit);
    return NextResponse.json({
      ...results,
      meta: { cacheHit, durationMs: Date.now() - startedAt },
    });
  } catch (err) {
    console.error("[admin-search] failed:", err);
    return NextResponse.json(
      { error: "Unable to complete admin search right now." },
      { status: 500 },
    );
  }
}
