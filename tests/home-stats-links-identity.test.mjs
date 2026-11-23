/**
 * Announcements (links, images, permissions), pull-to-refresh, profile linking
 * and Club Statistics — unit/component tests (`tests/home-stats-links-identity.test.mjs`).
 *
 * Pure functions, server-side rendering and source inspection only:
 * no emulator, browser, network or database access.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import ReactDOMServer from "react-dom/server";

const req = createRequire(import.meta.url);
const cache = new Map();
const withExt = (b) => {
  for (const e of [".tsx", ".ts", ".js"]) if (fs.existsSync(b + e)) return b + e;
  return b;
};
let clubStatsState = { stats: null, updatedAt: null, loading: false, error: false };
const STUBS = {
  // Mutable so tests can drive the loading / empty / error states.
  "@/hooks/useClubStats": { useClubStats: () => clubStatsState },
};
function load(f) {
  const abs = path.resolve(f);
  if (cache.has(abs)) return cache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf-8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  cache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (STUBS[id]) return STUBS[id];
    if (id === "react") return React;
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return load(withExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("@/hooks/")) return load(withExt(path.resolve("hooks", id.slice(8))));
    if (id.startsWith("./") || id.startsWith("../")) return load(withExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  cache.set(abs, mod.exports);
  return mod.exports;
}
const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

const { splitTextWithLinks, toSafeHref } = load("lib/linkify.ts");
const { LinkifiedText } = load("components/ui/LinkifiedText.tsx");
const img = load("lib/announcement-image.ts");
const stats = load("lib/club-stats.ts");
const { ClubPerformanceCard, ClubPerformanceWidget } = load("components/home/ClubPerformanceWidget.tsx");
const { getProfileLinkState, availabilityBlockMessage } = load("lib/profile-link.ts");
const { resolveMyPlayers, resolvePlayerForUser } = load("lib/player-identity.ts");
const { ProfileLinkNotice } = load("components/ProfileLinkNotice.tsx");

// ─────────────────────────────────────────────────────────────────────────────
describe("Announcement links", () => {
  it("turns http(s) and www. addresses into links, keeping trailing punctuation outside", () => {
    const segs = splitTextWithLinks("Register at https://kavach.club/agm. Map: www.example.com/ground, thanks");
    const links = segs.filter((s) => s.type === "link");
    assert.deepEqual(links.map((l) => l.href), ["https://kavach.club/agm", "https://www.example.com/ground"]);
    assert.equal(segs.map((s) => s.value).join(""), "Register at https://kavach.club/agm. Map: www.example.com/ground, thanks");
  });
  it("never links unsafe schemes or malformed hosts", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,hi", "mailto:a@b.com", "ftp://x.y/z"]) {
      assert.ok(splitTextWithLinks(`see ${bad}`).every((s) => s.type === "text"), bad);
    }
    assert.equal(toSafeHref("https://localhost"), null);
  });
  it("renders safe external anchors that do not bubble to parents", () => {
    const html = render(React.createElement(LinkifiedText, { text: "Info: https://kavach.club" }));
    assert.ok(html.includes('href="https://kavach.club/"'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer nofollow"'));
    assert.match(src("components/ui/LinkifiedText.tsx"), /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });
  it("announcement detail and feed use the safe linkifier; list cards (buttons) do not nest links", () => {
    const a = src("components/home/ClubAnnouncementsSection.tsx");
    assert.match(a, /<LinkifiedText text=\{selectedAnnouncement\.text\} \/>/);
    assert.match(src("components/home/ClubFeedPreview.tsx"), /<LinkifiedText text=\{post\.text\} \/>/);
    const card = a.slice(a.indexOf("displayItems.map"), a.indexOf("announcements.length > COLLAPSED_COUNT"));
    assert.ok(!card.includes("<LinkifiedText"), "no anchors inside the card <button>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Announcement images", () => {
  it("validates type and size", () => {
    assert.equal(img.validateImageFile({ type: "image/jpeg", size: 2_000_000 }), null);
    assert.match(img.validateImageFile({ type: "image/gif", size: 1000 }), /JPG, PNG or WebP/);
    assert.match(img.validateImageFile({ type: "image/png", size: 11 * 1024 * 1024 }), /10 MB/);
    assert.match(img.validateImageFile({ type: "image/png", size: 0 }), /empty/);
  });
  it("accepts reasonable dimensions, rejects tiny ones", () => {
    assert.equal(img.validateImageDimensions(1600, 900), null);
    assert.equal(img.validateImageDimensions(1080, 1350), null, "portrait photos are accepted and cropped");
    assert.match(img.validateImageDimensions(200, 100), /too small/);
  });
  it("crop math keeps a 16:9 window inside the image", () => {
    const r = img.computeSourceRect(4000, 3000, img.DEFAULT_CROP);
    assert.ok(Math.abs(r.sw / r.sh - 16 / 9) < 1e-9);
    assert.equal(r.sw, 4000);
    assert.ok(r.sy >= 0 && r.sy + r.sh <= 3000);
    const zoomed = img.computeSourceRect(4000, 3000, { zoom: 2, focusX: 1, focusY: 0 });
    assert.equal(zoomed.sx + zoomed.sw, 4000);
    assert.equal(zoomed.sy, 0);
  });
  it("panning follows the pointer and is clamped", () => {
    const c = img.panCrop(img.DEFAULT_CROP, 4000, 3000, 400, -1000, 0);
    assert.ok(c.focusX <= 1 && c.focusX >= 0);
    const centred = img.panCrop(img.DEFAULT_CROP, 1600, 900, 400, 50, 50);
    assert.equal(centred.focusX, 0.5, "no horizontal slack at exact 16:9 and zoom 1");
  });
  it("only https or bounded base64 image data URLs are rendered", () => {
    assert.equal(img.isSafeImageSrc("https://cdn.example.com/a.jpg"), true);
    assert.equal(img.isSafeImageSrc("data:image/jpeg;base64,QUJD"), true);
    for (const bad of ["http://x.com/a.jpg", "javascript:alert(1)", "data:text/html;base64,QUJD", "data:image/svg+xml;base64,QUJD", ""]) {
      assert.equal(img.isSafeImageSrc(bad), false, bad);
    }
  });
  it("cards and detail use a fixed 16:9 frame with object-cover", () => {
    const a = src("components/home/ClubAnnouncementsSection.tsx");
    assert.ok((a.match(/aspect-video/g) || []).length >= 2);
    assert.ok((a.match(/object-cover/g) || []).length >= 2);
    assert.match(a, /isSafeImageSrc\(post\.imageUrl\)/);
  });
  it("exported images stay under the stored-size budget and preview matches the frame", () => {
    const p = src("components/home/AnnouncementImagePicker.tsx");
    assert.match(p, /url\.length <= ANNOUNCEMENT_IMAGE_MAX_STORED_CHARS/);
    assert.match(p, /aspect-video/);
    assert.ok(img.ANNOUNCEMENT_IMAGE_MAX_STORED_CHARS < 1_000_000, "well under Firestore's 1 MiB document limit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Announcement permissions", () => {
  it("UI: create/edit/delete only for super admin claim or Club Admin flag (D-16: on Admin Home)", () => {
    const home = src("components/home/AdminHomeAnnouncements.tsx");
    assert.match(home, /const canPublishAnnouncements = Boolean\(hasAdminClaim \|\| appUser\?\.isClubAdmin\);/);
    for (const fn of ["handlePublishAnnouncement", "handleUpdateAnnouncement", "handleDeleteAnnouncement"]) {
      const i = home.indexOf(`const ${fn}`);
      assert.match(home.slice(i, i + 200), /if \(!canPublishAnnouncements/, fn);
    }
    assert.ok(!home.includes('role === "admin"'));
  });
  it("server-side: Firestore rules restrict post create/update/delete to admins", () => {
    const rules = src("firestore.rules");
    const block = rules.slice(rules.indexOf("match /posts/{postId}"), rules.indexOf("match /posts/{postId}") + 220);
    assert.match(block, /allow read: if isSignedIn\(\);/);
    assert.match(block, /allow create: if isAnyAdmin\(\);/);
    assert.match(block, /allow update: if isAnyAdmin\(\);/);
    assert.match(block, /allow delete: if isAnyAdmin\(\);/);
  });
  it("players cannot grant themselves admin flags (rules protect appUsers permission fields)", () => {
    const rules = src("firestore.rules");
    const block = rules.slice(rules.indexOf("match /appUsers/{userId}"), rules.indexOf("match /appUsers/{userId}") + 1200);
    assert.match(block, /hasAny\(\['role', 'isSuperAdmin', 'isStudioAdmin', 'isMatchAdmin', 'isFinanceAdmin', 'isClubAdmin'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Profile linking", () => {
  const players = [
    { id: "old", name: "Asha (old)", authUid: "uid-1", mergedInto: "keeper" },
    { id: "keeper", name: "Asha" },
    { id: "other", name: "Ravi", authUid: "uid-2" },
  ];
  it("Home and Match Center resolve the same player, following merges", () => {
    const primary = resolvePlayerForUser(players, "uid-1", null);
    const mine = resolveMyPlayers(players, "uid-1", null);
    assert.equal(primary.id, "keeper");
    assert.equal(mine[0].id, "keeper", "resolveMyPlayers()[0] must equal resolvePlayerForUser()");
  });
  it("appUsers.playerId pointer to a merged record also resolves to the keeper", () => {
    const mine = resolveMyPlayers(players, "uid-9", { id: "uid-9", playerId: "old" });
    assert.deepEqual(mine.map((p) => p.id), ["keeper"]);
  });
  it("never links by unverified data (mobile/email) and never crosses accounts", () => {
    const list = [{ id: "p1", name: "X", mobile: "9999999999", email: "a@b.com" }];
    assert.deepEqual(resolveMyPlayers(list, "uid-x", { id: "uid-x", mobile: "9999999999", email: "a@b.com" }), []);
    assert.deepEqual(resolveMyPlayers(players, "uid-1", null).map((p) => p.id).includes("other"), false);
  });
  it("loading is not reported as 'not linked'", () => {
    assert.equal(getProfileLinkState({ playersLoaded: false, hasPlayer: false }), "loading");
    assert.equal(getProfileLinkState({ playersLoaded: true, hasPlayer: false }), "unlinked");
    assert.equal(availabilityBlockMessage({ playersLoaded: true, hasPlayer: true }), null);
    assert.match(availabilityBlockMessage({ playersLoaded: false, hasPlayer: false }), /still loading/);
  });
  it("both availability handlers use the shared check", () => {
    for (const f of ["components/HomeTab.tsx", "components/matches/PlayerMatchCenter.tsx"]) {
      const s = src(f);
      assert.match(s, /availabilityBlockMessage\(\{\s*playersLoaded: store\.playersLoaded !== false,/, f);
      assert.ok(!s.includes("Please complete or link your player profile to mark availability."), f);
    }
  });
  it("unlinked notice offers the server-verified link only for a verified phone match", () => {
    const phoneMatch = render(React.createElement(ProfileLinkNotice, { signedInWithPhone: true, candidate: { id: "p", name: "Asha" }, isLinking: false, onLink: () => {} }));
    assert.ok(phoneMatch.includes("profile-link-button"));
    const email = render(React.createElement(ProfileLinkNotice, { signedInWithPhone: false, candidate: null, isLinking: false, onLink: () => {} }));
    assert.ok(!email.includes("profile-link-button"));
    assert.match(text(email), /mobile number/);
    const page = src("app/page.tsx");
    assert.match(page, /!effectiveIsAdminMode && !player && store\.playersLoaded && \(/);
    assert.match(page, /onLink=\{handleSyncAccount\}/);
  });
  it("the server link endpoint still requires the verified phone from the ID token", () => {
    assert.match(src("app/api/player/link-account/route.ts"), /verifiedPhoneNumber: auth\.phoneNumber/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Pull-to-refresh", () => {
  const hook = src("hooks/usePullToRefresh.ts");
  it("touch-only, top-of-page only, not in modals or form controls, ignores horizontal swipes", () => {
    assert.match(hook, /\(pointer: coarse\)/);
    assert.match(hook, /!atTop\(\)/);
    assert.match(hook, /\[aria-modal="true"\]/);
    assert.match(hook, /input, textarea, select/);
    assert.match(hook, /Math\.abs\(dx\) > Math\.abs\(dy\)/);
    assert.match(hook, /el\.scrollTop > 0/);
  });
  it("one refresh at a time; in-place data refresh (no page reload)", () => {
    assert.match(hook, /busyRef\.current/);
    assert.ok(!/location\.reload/.test(hook));
    const store = src("hooks/useStore.ts");
    assert.match(store, /if \(refreshInFlightRef\.current\) return refreshInFlightRef\.current;/);
    assert.match(store, /refreshAppConfig\(\), refreshGrounds\(\)/);
    assert.match(src("app/page.tsx"), /store\.detachDomain, store\.refreshNonce[,\]]/);
  });
  it("disables the browser's own reload-on-overscroll while active", () => {
    assert.match(hook, /overscrollBehaviorY = "contain"/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Club Statistics", () => {
  it("accepts exact non-negative integers only", () => {
    assert.deepEqual(stats.validateClubStatsInput({ matchesPlayed: 350, matchesWon: 246 }), { ok: true, value: { matchesPlayed: 350, matchesWon: 246 } });
    assert.deepEqual(stats.validateClubStatsInput({ matchesPlayed: "350", matchesWon: "0" }).ok, true);
    for (const bad of ["350+", "12.5", "-1", "1e3", "", " ", null]) {
      assert.equal(stats.validateClubStatsInput({ matchesPlayed: bad, matchesWon: 0 }).ok, false, String(bad));
    }
  });
  it("won cannot exceed played; unknown fields (e.g. winRate) are rejected", () => {
    assert.match(stats.validateClubStatsInput({ matchesPlayed: 10, matchesWon: 11 }).error, /cannot be more/);
    assert.equal(stats.validateClubStatsInput({ matchesPlayed: 10, matchesWon: 5, winRate: 50 }).ok, false);
  });
  it("win rate is calculated with consistent rounding and handles zero", () => {
    assert.equal(stats.formatWinRate(stats.computeWinRate(350, 246)), "70%");
    assert.equal(stats.formatWinRate(stats.computeWinRate(3, 2)), "67%");
    assert.equal(stats.formatWinRate(stats.computeWinRate(200, 1)), "1%");
    assert.equal(stats.computeWinRate(0, 0), null);
    assert.equal(stats.formatWinRate(null), "—");
  });
  it("server route: Club Admin guard, server-side validation, environment database", () => {
    const route = src("app/api/admin/club-stats/route.ts");
    assert.match(route, /const guard = await requireClubAdmin\(req\);\s*if \(!guard\.ok\) return guard\.response;/);
    assert.match(route, /validateClubStatsInput\(body\)/);
    assert.match(route, /getServerFirestore\(\)/);
    assert.ok(!/winRate/.test(route.replace(/\/\*[\s\S]*?\*\//, "")), "win rate is never stored");
  });
  it("stored values are read defensively", () => {
    assert.deepEqual(stats.readStoredClubStats({ matchesPlayed: 5, matchesWon: 3 }), { matchesPlayed: 5, matchesWon: 3 });
    assert.equal(stats.readStoredClubStats({ matchesPlayed: 5, matchesWon: 6 }), null);
    assert.equal(stats.readStoredClubStats({ matchesPlayed: "5", matchesWon: 3 }), null);
    assert.equal(stats.readStoredClubStats(null), null);
  });
  it("admin sub-tab is visible only to Club Admins / Super Admins", () => {
    const club = src("components/ClubTab.tsx");
    assert.match(club, /\{ key: "stats", label: "Club Statistics", icon: BarChart3, visible: isClubAdmin \|\| isSuperAdmin \}/);
    assert.match(club, /subTab === "stats" && !isPlayer && \(isClubAdmin \|\| isSuperAdmin\)/);
  });
});

describe("Club Performance widget", () => {
  const html = render(React.createElement(ClubPerformanceCard, { played: 350, won: 246 }));
  const t = text(html);
  it("shows exact played / won and the calculated win rate (no '+', no losses, no branding)", () => {
    assert.match(t, /Club Performance/);
    assert.match(t, /Our journey so far/);
    assert.match(t, /350/);
    assert.match(t, /246/);
    assert.match(t, /70%/);
    assert.match(t, /Every match adds to our story\./);
    assert.ok(!t.includes("+"));
    assert.ok(!/lost|loss/i.test(t));
    assert.ok(!/KAvach|Cricket Club/i.test(t));
  });
  it("ring uses the calculated rate", () => {
    assert.ok(html.includes('data-testid="club-stats-ring"'));
    assert.ok(html.includes("stroke-dasharray"));
  });
  const widget = (state, props = {}) => {
    clubStatsState = { stats: null, updatedAt: null, loading: false, error: false, ...state };
    try {
      return render(React.createElement(ClubPerformanceWidget, props));
    } finally {
      clubStatsState = { stats: null, updatedAt: null, loading: false, error: false };
    }
  };
  it("never hides silently: no totals saved shows an empty state without sample values", () => {
    const html = widget({});
    assert.ok(html.includes('data-testid="club-performance-widget"'));
    assert.ok(html.includes('data-state="empty"'));
    assert.match(text(html), /Club statistics haven('|&#x27;)t been published yet/);
    assert.ok(!/\d/.test(text(html).replace(/&#x?[0-9a-f]+;/gi, "")), "no numbers in the empty state");
    assert.ok(!/Admin Console/.test(text(html)), "management hint is admin-only");
    const w = src("components/home/ClubPerformanceWidget.tsx");
    assert.ok(!/350|246/.test(w), "no hardcoded example statistics");
  });
  it("admins see where to publish the totals", () => {
    assert.match(text(widget({}, { canManage: true })), /Admin Console → Player Roster → Club Statistics/);
  });
  it("loading state is a skeleton, error state is explained", () => {
    const loading = widget({ loading: true });
    assert.ok(loading.includes('data-state="loading"') && loading.includes('aria-busy="true"'));
    assert.ok(!/\d/.test(text(loading).replace(/&#x?[0-9a-f]+;/gi, "")));
    const error = widget({ error: true });
    assert.ok(error.includes('data-state="error"'));
    assert.match(text(error), /couldn('|&#x27;)t be loaded/);
  });
  it("saved totals render the exact values", () => {
    const html = widget({ stats: { matchesPlayed: 120, matchesWon: 77 } });
    assert.ok(!html.includes("data-state="));
    assert.match(html, /<span class="sr-only">120<\/span>/);
    assert.match(html, /<span class="sr-only">77<\/span>/);
  });
  it("D-16: management hint only on Admin Home; Player Home widget is read-only; Club Statistics tab is easy to find", () => {
    assert.match(src("components/home/AdminHomeAnnouncements.tsx"), /<ClubPerformanceWidget canManage=\{canPublishAnnouncements\} \/>/);
    assert.match(src("components/HomeTab.tsx"), /<ClubPerformanceWidget \/>/);
    const club = src("components/ClubTab.tsx");
    const admin = club.slice(club.indexOf("const adminTabs"), club.indexOf("const visibleTabs"));
    const keys = [...admin.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(keys.slice(0, 2), ["players", "stats"], "Club Statistics is the second admin tab");
    assert.match(admin, /key: "stats", label: "Club Statistics", icon: BarChart3, visible: isClubAdmin \|\| isSuperAdmin/);
  });
  it("animation runs once, respects reduced motion, no looping effects", () => {
    const w = src("components/home/ClubPerformanceWidget.tsx");
    assert.match(w, /prefers-reduced-motion: reduce/);
    assert.match(w, /sessionStorage/);
    assert.match(w, /observer\.disconnect\(\);/);
    assert.ok(!/repeat: Infinity|animate-pulse|animate-ping/.test(w));
  });
});

describe("Profile sync popup", () => {
  const { ProfileSyncDialog, profileSyncDismissKey } = load("components/ProfileSyncDialog.tsx");
  it("shows the player's name with Sync and Not now", () => {
    const html = render(React.createElement(ProfileSyncDialog, {
      playerName: "Asha Rao", matchedBy: "google", isSyncing: false, onSync: () => {}, onDismiss: () => {},
    }));
    const t = text(html);
    assert.match(t, /Welcome back, Asha Rao!/);
    assert.match(t, /Google email/);
    assert.ok(html.includes('data-testid="profile-sync-button"'));
    assert.ok(html.includes('data-testid="profile-sync-dismiss"'));
    assert.ok(html.includes('role="dialog"') && html.includes('aria-modal="true"'));
  });
  it("mentions the mobile number for phone matches and shows progress while syncing", () => {
    const html = render(React.createElement(ProfileSyncDialog, {
      playerName: "Ravi", matchedBy: "mobile", isSyncing: true, onSync: () => {}, onDismiss: () => {},
    }));
    assert.match(text(html), /mobile number/);
    assert.match(text(html), /Syncing/);
  });
  it("opens only for unlinked logins with a verified candidate, dismissible per session", () => {
    const page = src("app/page.tsx");
    const i = page.indexOf("<ProfileSyncDialog");
    const cond = page.slice(i - 400, i);
    assert.match(cond, /!player &&/);
    assert.match(cond, /store\.playersLoaded &&/);
    assert.match(cond, /!profileSyncDismissed &&/);
    assert.match(cond, /existingPlayerWithSamePhone \|\| \(isGoogleLogin && existingPlayerWithSameEmail\)/);
    assert.match(page.slice(i, i + 500), /onSync=\{handleSyncAccount\}/);
    assert.equal(profileSyncDismissKey("u1"), "kavach:profile-sync-dismissed:u1");
    assert.match(page, /window\.sessionStorage\.setItem\(profileSyncDismissKey\(user\.uid\), "1"\)/);
  });
  it("full-screen player sync card shows the Google email for Google matches", () => {
    const prompt = src("components/onboarding/PhoneSyncPrompt.tsx");
    assert.match(prompt, /matchedBy === "google" \? user\.email : user\.phoneNumber/);
    assert.match(src("app/page.tsx"), /matchedBy=\{existingPlayerWithSamePhone \? "mobile" : "google"\}/);
  });
});
