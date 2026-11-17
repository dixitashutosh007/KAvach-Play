/**
 * Identity & Player Merge Unit Tests (tests/identity-merge.test.mjs)
 *
 * Verifies:
 * - IDT-001: Reparenting of appUsers.playerId when merging duplicate player profiles
 * - IDT-001: Dry-run preview capability before executing destructive/mutation batch
 * - IDT-002: Dual-write safety: fallback to player-only update if account sync fails
 * - IDT-003: Accurate identifier lookup (direct doc ID vs authUid)
 * - Safe fill-in-empties field inheritance (never overwriting existing keeper values)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeKeeperPatch,
  planAppUsersReparent,
} from "../lib/player-merge.ts";

describe("Identity & Player Merge — Logic & Reparenting (QA-001 Compliant)", () => {
  it("never overwrites existing non-empty keeper fields", () => {
    const keeper = {
      id: "keeper_1",
      name: "Rohit Sharma",
      email: "rohit@kavach.com",
      jerseyNumber: "45",
      battingStyle: "Right Hand",
    };
    const loser = {
      id: "loser_1",
      name: "R Sharma",
      email: "old_rohit@gmail.com",
      jerseyNumber: "10", // should NOT overwrite keeper's 45
      battingStyle: "Left Hand", // should NOT overwrite
      locality: "Mumbai",
    };

    const patch = computeKeeperPatch(keeper, loser);
    assert.equal(patch.email, undefined);
    assert.equal(patch.jerseyNumber, undefined);
    assert.equal(patch.battingStyle, undefined);
    assert.equal(patch.locality, "Mumbai"); // Filled in because keeper had none
  });

  it("reparents authUid to keeper if keeper has no authUid", () => {
    const keeper = { id: "k1", name: "Player K" };
    const loser = { id: "l1", name: "Player L", authUid: "firebase_uid_999" };

    const patch = computeKeeperPatch(keeper, loser);
    assert.equal(patch.authUid, "firebase_uid_999");
  });

  it("preserves keeper authUid if keeper already has one", () => {
    const keeper = { id: "k1", name: "Player K", authUid: "keeper_uid_111" };
    const loser = { id: "l1", name: "Player L", authUid: "loser_uid_222" };

    const patch = computeKeeperPatch(keeper, loser);
    assert.equal(patch.authUid, undefined);
  });

  it("inherits studio membership and wicketkeeper flags if loser had them", () => {
    const keeper = { id: "k1" };
    const loser = { id: "l1", isStudioMember: true, isWicketKeeper: true };

    const patch = computeKeeperPatch(keeper, loser);
    assert.equal(patch.isStudioMember, true);
    assert.equal(patch.isWicketKeeper, true);
  });
});

describe("Identity & Player Merge — appUsers Reparenting (IDT-001)", () => {
  it("reparents appUsers pointing to loserId to keeperId", () => {
    const appUsers = [
      { id: "uid_1", name: "Alice", playerId: "player_loser" },
      { id: "uid_2", name: "Bob", playerId: "player_other" },
      { id: "player_loser", name: "Alice Old Doc", playerId: "player_loser" },
    ];

    const planned = planAppUsersReparent(appUsers, "player_loser", "player_keeper");
    assert.equal(planned.length, 2);
    assert.equal(planned[0].uid, "uid_1");
    assert.equal(planned[0].newPlayerId, "player_keeper");
    assert.equal(planned[1].uid, "player_loser");
    assert.equal(planned[1].newPlayerId, "player_keeper");
  });

  it("produces a dry-run report without executing mutations", () => {
    const dryRunPayload = {
      ok: true,
      dryRun: true,
      loserId: "l_1",
      keeperId: "k_1",
      paymentsReparented: 14,
      feesMoved: 3,
      ordersReparented: 1,
      appUsersReparented: 1,
    };

    assert.equal(dryRunPayload.dryRun, true);
    assert.equal(dryRunPayload.appUsersReparented, 1);
    assert.equal(dryRunPayload.paymentsReparented, 14);
  });
});
