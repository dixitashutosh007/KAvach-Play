import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { resolvePlayerForUser } from "../lib/player-identity.ts";

const root = process.cwd();

test("resolvePlayerForUser resolves Google SSO user via appUsers.playerId without uid === playerId", () => {
  const players = [
    { id: "player-kav-12", name: "Arjun Sharma", email: "arjun@example.com", phone: "9876543210" },
  ];
  // Before linking: appUsers doc has not been populated yet -> unresolved
  assert.equal(
    resolvePlayerForUser(players, "google-uid-999", null),
    null,
  );

  // After applyLinkedPlayerId updates appUsers in store state -> resolves immediately
  const linked = resolvePlayerForUser(
    players,
    "google-uid-999",
    { id: "google-uid-999", email: "arjun@example.com", role: "player", playerId: "player-kav-12" },
  );
  assert.equal(linked?.id, "player-kav-12");
});

test("app/page.tsx waits for selfAppUserStatus and updates store in-memory instead of reload loop", () => {
  const pageSrc = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
  assert.match(
    pageSrc,
    /if\s*\(\s*!store\.isLoaded\s*\|\|\s*!store\.playersLoaded\s*\|\|\s*store\.selfAppUserStatus\s*===\s*"loading"\s*\)/,
  );
  assert.match(pageSrc, /store\.applyLinkedPlayerId\(user\.uid,\s*data\.playerId\s*\|\|\s*existingMatch\.id\)/);
  assert.doesNotMatch(pageSrc, /handleSyncAccount[\s\S]*?window\.location\.reload\(\)/);
});

test("hooks/useStore.ts provides applyLinkedPlayerId and initializes selfAppUserStatus in synthetic store", () => {
  const storeSrc = fs.readFileSync(path.join(root, "hooks/useStore.ts"), "utf8");
  assert.match(storeSrc, /const applyLinkedPlayerId = useCallback\(/);
  assert.match(storeSrc, /setSelfAppUserStatus\("present"\)/);
  assert.match(
    storeSrc,
    /setSelfAppUserStatus\(ts\.selfAppUserStatus \|\| \(ts\.appUsers \? "present" : "missing"\)\)/,
  );
});
