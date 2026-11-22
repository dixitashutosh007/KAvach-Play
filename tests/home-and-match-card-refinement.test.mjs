/**
 * Player Home & Match Card refinement — focused unit / component tests
 * (`tests/home-and-match-card-refinement.test.mjs`).
 *
 * Pure functions and server-side component rendering only (react-dom/server):
 * no emulator, browser, network or database access.
 *
 * Covers venue Maps links, the shared compact header, the three-position
 * availability selector and "no response is not Out", the personalised greeting,
 * Home composition (Digital Pass / performance / shortcuts / branding removed),
 * announcement de-duplication, banner birthdays in the club timezone, and
 * per-user banner dismissal bookkeeping.
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
const moduleCache = new Map();
const resolveWithExt = (base) => {
  for (const ext of [".tsx", ".ts", ".js"]) if (fs.existsSync(base + ext)) return base + ext;
  return base;
};
function load(filePath) {
  const abs = path.resolve(filePath);
  if (moduleCache.has(abs)) return moduleCache.get(abs);
  const js = ts.transpileModule(fs.readFileSync(abs, "utf-8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  moduleCache.set(abs, mod.exports);
  const dir = path.dirname(abs);
  const r = (id) => {
    if (id === "react") return React;
    if (id.startsWith("@/lib/")) return load(resolveWithExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return load(resolveWithExt(path.resolve("components", id.slice(13))));
    if (id.startsWith("./") || id.startsWith("../")) return load(resolveWithExt(path.resolve(dir, id.replace(/\.ts$/, ""))));
    return req(id);
  };
  new Function("require", "module", "exports", js)(r, mod, mod.exports);
  moduleCache.set(abs, mod.exports);
  return mod.exports;
}

const render = (el) => ReactDOMServer.renderToStaticMarkup(el);
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

const { getVenueMapsLink, getSafeHttpUrl } = load("lib/venue-maps.ts");
const { getTimeOfDayGreeting, isPlaceholderName, resolveGreetingName, getClubHour } = load("lib/greeting.ts");
const { derivePlayerAvailability } = load("lib/personal-match-payment.ts");
const { AvailabilityButtons, toAvailabilityChoice, CHOICE_TO_STORED } = load("components/matches/AvailabilityButtons.tsx");
const { MatchCardHeader } = load("components/matches/MatchCardHeader.tsx");
const { getAnnouncementDisplay } = load("components/home/announcementDisplay.ts");
const bannerSlides = load("components/home/bannerSlides.ts");
const { PlayerHomeHeader } = load("components/home/PlayerHomeHeader.tsx");
const { HomeQuickActions } = load("components/home/HomeQuickActions.tsx");
const { CampaignHeroBanner } = load("components/home/CampaignHeroBanner.tsx");

const baseMatch = {
  id: "m1",
  opponent: "Cricmonks",
  date: "2026-12-05",
  time: "07:30",
  format: "T30",
  jerseyColor: "Scarlet Red",
  matchType: "Practice",
  result: "Pending",
};

// ─────────────────────────────────────────────────────────────────────────────
describe("Venue → Google Maps link", () => {
  it("prefers the stored ground mapUrl when it is a valid http(s) URL", () => {
    const link = getVenueMapsLink({ name: "Kotla", mapUrl: "https://maps.app.goo.gl/abc123" });
    assert.deepEqual(link, { href: "https://maps.app.goo.gl/abc123", source: "stored" });
  });
  it("rejects non-http(s) and malformed stored URLs", () => {
    assert.equal(getSafeHttpUrl("javascript:alert(1)"), null);
    assert.equal(getSafeHttpUrl("not a url"), null);
    assert.equal(getSafeHttpUrl("  "), null);
  });
  it("falls back to a URL-encoded Maps search of the venue name (no invented coordinates)", () => {
    const link = getVenueMapsLink({ name: "Sector 21 Ground & Nets", mapUrl: "javascript:void(0)" });
    assert.equal(link.source, "search");
    assert.equal(link.href, "https://www.google.com/maps/search/?api=1&query=Sector%2021%20Ground%20%26%20Nets");
    assert.ok(!/@-?\d+\.\d+,-?\d+\.\d+/.test(link.href));
  });
  it("returns null when no venue information exists", () => {
    assert.equal(getVenueMapsLink(null), null);
    assert.equal(getVenueMapsLink({ name: "  ", mapUrl: "" }), null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Shared match card body", () => {
  const ground = { id: "g1", name: "KAvach Sports Arena", mapUrl: "https://maps.google.com/?q=Arena" };

  it("identity shows format badge and jersey infographic, then 'vs' and the opponent", () => {
    const html = render(React.createElement(MatchCardHeader, { match: baseMatch, ground }));
    const rowStart = html.indexOf('data-testid="match-card-title-row-m1"');
    const rowHtml = html.slice(rowStart, html.indexOf("</div>", rowStart));
    assert.ok(rowHtml.includes(">T30<"));
    assert.ok(rowHtml.includes('data-testid="jersey-infographic"'));
    const identity = html.slice(html.indexOf('data-testid="match-card-identity-m1"'), html.indexOf('data-testid="match-card-logistics-m1"'));
    assert.ok(identity.includes(">vs<"));
    assert.ok(identity.includes(">Cricmonks</h3>"));
    assert.ok(!text(html).includes("Scarlet Red"));
  });

  it("renders the venue as a safe external Maps link that does not open the card", () => {
    const html = render(React.createElement(MatchCardHeader, { match: baseMatch, ground }));
    assert.ok(html.includes('href="https://maps.google.com/?q=Arena"'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes('aria-label="Open KAvach Sports Arena in Google Maps (opens in a new tab)"'));
    assert.match(src("components/matches/MatchCardHeader.tsx"), /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it("omits the venue when no ground exists", () => {
    const html = render(React.createElement(MatchCardHeader, { match: baseMatch, ground: null }));
    assert.ok(!html.includes("venue-link-m1"));
    assert.ok(!html.includes("venue-text-m1"));
  });

  it("logistics show time (no wrap) and 'DAY · D MON' date", () => {
    const html = render(React.createElement(MatchCardHeader, { match: baseMatch, ground }));
    const t = text(html);
    assert.match(t, /7:30 AM/);
    assert.match(t, /SAT · 5 DEC/);
    const timeTag = html.slice(html.indexOf('data-testid="match-time-m1"') - 5, html.indexOf('data-testid="match-time-m1"') + 300);
    assert.ok(timeTag.includes("whitespace-nowrap"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Availability: no response is never Out", () => {
  const player = { id: "p1", inviteStatus: "Verified" };
  const match = { ...baseMatch };

  it("records seeded at match creation (Not Playing + Pending) are awaiting response, not Out", () => {
    const info = derivePlayerAvailability(player, match, [
      { id: "x", matchId: "m1", playerId: "p1", status: "Not Playing", availability: "Pending" },
    ]);
    assert.equal(info.status, "Pending");
    assert.equal(info.isOut, false);
    assert.equal(toAvailabilityChoice(info.status), null);
  });
  it("a Not Playing record with no availability field is also not Out", () => {
    const info = derivePlayerAvailability(player, match, [
      { id: "x", matchId: "m1", playerId: "p1", status: "Not Playing" },
    ]);
    assert.equal(info.isOut, false);
  });
  it("an explicit 'No' answer is Out", () => {
    const info = derivePlayerAvailability(player, match, [
      { id: "x", matchId: "m1", playerId: "p1", status: "Not Playing", availability: "No" },
    ]);
    assert.equal(info.status, "Not Playing");
    assert.equal(toAvailabilityChoice(info.status), "Out");
  });
  it("Tentative and Confirmed map to their selector positions", () => {
    const tent = derivePlayerAvailability(player, match, [{ id: "a", matchId: "m1", playerId: "p1", status: "Not Playing", availability: "Tentative" }]);
    const conf = derivePlayerAvailability(player, match, [{ id: "b", matchId: "m1", playerId: "p1", status: "Not Playing", availability: "Confirmed" }]);
    assert.equal(toAvailabilityChoice(tent.status), "Maybe");
    assert.equal(toAvailabilityChoice(conf.status), "Playing");
  });
  it("button choices persist with the existing stored vocabulary (no schema change)", () => {
    assert.deepEqual(CHOICE_TO_STORED, { Playing: "Confirmed", Maybe: "Tentative", Out: "No" });
  });
});

describe("Availability buttons (Playing · Maybe · Out)", () => {
  const renderBtns = (value, extra = {}) =>
    render(React.createElement(AvailabilityButtons, { matchId: "m1", value, onSelect: () => {}, ...extra }));

  it("renders Playing, Maybe, Out in that order", () => {
    const html = renderBtns(null);
    const order = ["playing", "maybe", "out"].map((k) => html.indexOf(`availability-${k}-m1`));
    assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2]);
  });
  it("no response: nothing pressed", () => {
    const html = renderBtns(null);
    assert.ok(html.includes('data-value="none"'));
    assert.ok(!html.includes('aria-pressed="true"'));
  });
  it("explicit answer: exactly one pressed, with its colour", () => {
    const html = renderBtns("Out");
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
    assert.ok(/availability-out-m1"[^>]*class="[^"]*bg-rose-600/.test(html) || /class="[^"]*bg-rose-600[^"]*"[^>]*availability-out-m1/.test(html));
  });
  it("busy disables all buttons and shows a spinner on the pending one", () => {
    const html = renderBtns("Out", { busy: true, pendingChoice: "Playing" });
    assert.equal((html.match(/disabled=""/g) || []).length, 3);
    assert.ok(html.includes("animate-spin"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Personalised greeting", () => {
  it("treats placeholders as missing names", () => {
    for (const n of ["Player", "player", "Admin", "", "  ", "Player (ab12c)", "Demo Player (XYZ1)"]) {
      assert.equal(isPlaceholderName(n), true, n);
    }
    assert.equal(isPlaceholderName("Asha Rao"), false);
  });
  it("resolves the first real name in priority order", () => {
    assert.equal(resolveGreetingName("Player (ab12c)", "  Asha   Rao ", "Ravi"), "Asha Rao");
    assert.equal(resolveGreetingName("Player", null, ""), null);
  });
  it("uses the club timezone for time of day", () => {
    // 2026-11-20T20:00Z is 01:30 on 21 Nov in Asia/Kolkata
    assert.equal(getClubHour(new Date("2026-11-20T20:00:00Z")), 1);
    assert.equal(getTimeOfDayGreeting(new Date("2026-11-20T20:00:00Z")), "Good Morning");
    assert.equal(getTimeOfDayGreeting(new Date("2026-11-20T09:00:00Z")), "Good Afternoon"); // 14:30 IST
    assert.equal(getTimeOfDayGreeting(new Date("2026-11-20T13:00:00Z")), "Good Evening"); // 18:30 IST
  });
  it("header shows 'Greeting, Name' without club branding or subtitle", () => {
    const html = render(React.createElement(PlayerHomeHeader, {
      player: { id: "p1", name: "Asha Rao" }, currentUserName: "Player", searchQuery: "", onSearchChange: () => {},
    }));
    const t = text(html);
    assert.match(t, /Good (Morning|Afternoon|Evening) , Asha Rao|Good (Morning|Afternoon|Evening), Asha Rao/);
    assert.ok(!/KAvach Cricket Club/i.test(t));
    assert.ok(!/personalised club dashboard/i.test(t));
  });
  it("missing name shows the greeting alone, never 'Player'", () => {
    const t = text(render(React.createElement(PlayerHomeHeader, {
      player: { id: "p1", name: "Player (ab12c)" }, currentUserName: "Player", searchQuery: "", onSearchChange: () => {},
    })));
    assert.ok(!/Player/.test(t), t);
    assert.match(t, /Good (Morning|Afternoon|Evening)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Home composition", () => {
  const home = src("components/HomeTab.tsx");
  it("does not render the performance section (and with it the Digital Pass link)", () => {
    assert.ok(!home.includes("<CompactPerformanceSummary"));
    assert.ok(fs.existsSync("components/home/CompactPerformanceSummary.tsx"), "component retained, not deleted");
    const homeComponents = ["components/HomeTab.tsx", ...fs.readdirSync("components/home").filter((f) => f.endsWith(".tsx") && f !== "CompactPerformanceSummary.tsx").map((f) => `components/home/${f}`)];
    for (const f of homeComponents) assert.ok(!src(f).includes("Digital Pass"), f);
  });
  it("Home no longer subscribes to playerStats for the removed section", () => {
    assert.match(src("app/page.tsx"), /const STATS_TABS = new Set\(\["club"\]\)/);
  });
  it("duplicate shortcuts (Fixtures, My Finance, Studio, Leaderboard) are gone; shop shortcut only when enabled", () => {
    const on = text(render(React.createElement(HomeQuickActions, { isFeatureEnabled: () => true, onNavigate: () => {} })));
    for (const label of ["Fixtures", "My Finance", "Pay Dues", "Studio", "Leaderboard"]) assert.ok(!on.includes(label), label);
    assert.ok(on.includes("Club Shop"));
    assert.equal(render(React.createElement(HomeQuickActions, { isFeatureEnabled: (k) => k !== "shop", onNavigate: () => {} })), "");
  });
  it("player-facing navigation says 'Studio'", () => {
    assert.match(src("components/layout/MoreDrawer.tsx"), /\{ tab: "studio", label: "Studio", icon: Video, feature: "studio" \}/);
    assert.match(src("components/ClubTab.tsx"), /key: "studio", label: "Studio"/);
    assert.match(src("components/layout/AppHeader.tsx"), /studio: "Studio",/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Club announcements de-duplication", () => {
  it("drops a generic title that repeats the section heading", () => {
    const d = getAnnouncementDisplay({ title: "Club Announcement", text: "Nets cancelled on Sunday due to rain." });
    assert.equal(d.headline, null);
    assert.equal(d.summary, "Nets cancelled on Sunday due to rain.");
  });
  it("strips a leading 'Announcement:' prefix from the body", () => {
    const d = getAnnouncementDisplay({ text: "CLUB ANNOUNCEMENT: AGM on 5 Dec at the clubhouse." });
    assert.equal(d.summary, "AGM on 5 Dec at the clubhouse.");
  });
  it("never shows the same text as headline and summary", () => {
    const d = getAnnouncementDisplay({ title: "Kit collection", text: "Kit collection" });
    assert.equal(d.headline, "Kit collection");
    assert.equal(d.summary, null);
  });
  it("uses a short first line as headline when there is no title", () => {
    const d = getAnnouncementDisplay({ text: "Winter nets schedule\nTuesdays and Thursdays, 6-8 PM.", isPinned: true });
    assert.deepEqual(d, { headline: "Winter nets schedule", summary: "Tuesdays and Thursdays, 6-8 PM.", category: "Important" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Banner: birthdays in the club timezone", () => {
  const { buildBirthdaySlides, buildBannerSlides, clubDayFromParts, formatBirthdayNames } = bannerSlides;
  const players = [
    { id: "a", name: "Asha", dob: "1995-12-31" },
    { id: "b", name: "Ravi", dob: "1990-01-01" },
    { id: "c", name: "Off", dob: "1990-12-31", disabled: true },
    { id: "d", name: "Merged", dob: "1990-12-31", mergedInto: "a" },
  ];

  it("highlights today's and tomorrow's birthdays across the year boundary", () => {
    const slides = buildBirthdaySlides(players, clubDayFromParts(2026, 11, 31)); // 31 Dec 2026
    assert.equal(slides.length, 2);
    assert.equal(slides[0].kind, "birthday-today");
    assert.match(slides[0].title, /Asha/);
    assert.equal(slides[1].kind, "birthday-tomorrow");
    assert.match(slides[1].title, /Ravi/);
  });
  it("excludes disabled and merged players and exposes names only", () => {
    const [today] = buildBirthdaySlides(players, clubDayFromParts(2026, 11, 31));
    assert.ok(!today.title.includes("Off") && !today.title.includes("Merged"));
    assert.ok(!/1995|age/i.test(today.title + today.description));
  });
  it("birthday slides have no call-to-action pointing at a missing screen", () => {
    const [today] = buildBirthdaySlides(players, clubDayFromParts(2026, 11, 31));
    assert.equal(today.ctaDestination, undefined);
  });
  it("no birthdays → no birthday slides", () => {
    assert.equal(buildBirthdaySlides(players, clubDayFromParts(2026, 5, 15)).length, 0);
  });
  it("compact names for multiple people", () => {
    assert.equal(formatBirthdayNames(["A", "B", "C", "D"]), "A, B & 2 more");
    assert.equal(formatBirthdayNames(["A", "B"]), "A & B");
  });
  it("birthday slides come first; nothing to show → empty list (no fallback slide)", () => {
    const slides = buildBannerSlides({ players, isFeatureEnabled: () => false, today: clubDayFromParts(2026, 11, 31) });
    assert.deepEqual(slides.map((s) => s.kind), ["birthday-today", "birthday-tomorrow"]);
    const empty = buildBannerSlides({ isFeatureEnabled: () => false, today: clubDayFromParts(2026, 5, 15) });
    assert.deepEqual(empty, []);
  });
});

describe("Banner: no match / fixture content", () => {
  const { buildBannerSlides, clubDayFromParts } = bannerSlides;
  const today = clubDayFromParts(2026, 10, 21);
  it("tournaments and fixture links never produce slides", () => {
    const slides = buildBannerSlides({
      tournaments: [{ id: "t1", name: "Winter Cup", status: "Ongoing" }],
      announcements: [{ id: "n1", text: "Match on Sunday", isAnnouncement: true, isPinned: true, matchId: "m1" }],
      isFeatureEnabled: () => false,
      today,
    });
    assert.ok(slides.every((s) => s.kind !== "tournament" && s.kind !== "season"));
    assert.ok(slides.every((s) => s.ctaDestination !== "matches"));
    assert.ok(!slides.some((s) => /fixture|view match/i.test(`${s.ctaText} ${s.title}`)));
  });
  it("banner source contains no tournament or season slide builders", () => {
    const b = src("components/home/bannerSlides.ts");
    assert.ok(!b.includes('kind: "tournament"'));
    assert.ok(!b.includes('kind: "season"'));
    assert.ok(!b.includes("View Fixtures"));
    assert.ok(!b.includes("Explore Matches"));
  });
  it("Home no longer subscribes to tournaments for the banner", () => {
    assert.match(src("app/page.tsx"), /const TOURNAMENT_TABS = new Set\(\["matches"\]\);/);
  });
});

describe("Banner: pinned announcements only", () => {
  const { buildBannerSlides, clubDayFromParts } = bannerSlides;
  const today = clubDayFromParts(2026, 10, 21);
  it("only announcements flagged for the banner appear (max 2)", () => {
    const slides = buildBannerSlides({
      announcements: [
        { id: "p1", text: "AGM", isAnnouncement: true, isPinned: true },
        { id: "p2", text: "Kit day", isAnnouncement: true, isPinned: false },
        { id: "p3", text: "Pinned but not an announcement", isPinned: true },
        { id: "p4", text: "Nets", isAnnouncement: true, isPinned: true },
        { id: "p5", text: "Third pinned", isAnnouncement: true, isPinned: true },
      ],
      isFeatureEnabled: () => false,
      today,
    });
    assert.deepEqual(slides.map((s) => s.id), ["post-p1", "post-p4"]);
    assert.ok(slides.every((s) => s.ctaDestination === "announcements"));
  });
});

describe("Banner: per-user dismissal, undo and restore", () => {
  const { buildBannerSlides, visibleSlides, pruneDismissed, parseDismissed, dismissStorageKey, restoreDismissed, clubDayFromParts, DISMISS_RETENTION_MS } = bannerSlides;
  const today = clubDayFromParts(2026, 10, 20);
  const slides = buildBannerSlides({
    announcements: [{ id: "n1", text: "AGM", isAnnouncement: true, isPinned: true, createdAt: { seconds: 100 } }],
    isFeatureEnabled: () => true,
    today,
  });

  it("dismissing one slide hides only that slide", () => {
    const notice = slides.find((s) => s.kind === "notice");
    const visible = visibleSlides(slides, { [notice.dismissKey]: Date.now() });
    assert.equal(visible.length, slides.length - 1);
    assert.ok(!visible.includes(notice));
  });
  it("undo / restore brings dismissed slides back", () => {
    const all = Object.fromEntries(slides.map((s) => [s.dismissKey, 1]));
    assert.equal(visibleSlides(slides, all).length, 0);
    const restored = restoreDismissed(all, slides.map((s) => s.dismissKey));
    assert.equal(visibleSlides(slides, restored).length, slides.length);
    const undoOne = restoreDismissed(all, [slides[0].dismissKey]);
    assert.equal(visibleSlides(slides, undoOne).length, 1);
  });
  it("an edited announcement is a new period and reappears", () => {
    const old = slides.find((s) => s.kind === "notice").dismissKey;
    const edited = buildBannerSlides({
      announcements: [{ id: "n1", text: "AGM moved", isAnnouncement: true, isPinned: true, createdAt: { seconds: 100 }, updatedAt: { seconds: 200 } }],
      isFeatureEnabled: () => false,
      today,
    }).find((s) => s.kind === "notice").dismissKey;
    assert.notEqual(old, edited);
  });
  it("promotions are dismissed per calendar month", () => {
    assert.equal(slides.find((s) => s.id === "campaign-studio").dismissKey, "campaign-studio:2026-11");
  });
  it("storage is per user, tolerant of bad data, and pruned after the retention window", () => {
    assert.notEqual(dismissStorageKey("u1"), dismissStorageKey("u2"));
    assert.deepEqual(parseDismissed("not json"), {});
    assert.deepEqual(parseDismissed('{"a":"x","b":5}'), { b: 5 });
    const now = 10 * DISMISS_RETENTION_MS;
    assert.deepEqual(pruneDismissed({ fresh: now - 1000, stale: now - DISMISS_RETENTION_MS - 1 }, now), { fresh: now - 1000 });
  });
  it("every current slide is dismissible (the data model has no mandatory flag)", () => {
    assert.ok(slides.every((s) => s.dismissible === true));
  });
});

describe("Banner rendering", () => {
  const props = (overrides = {}) => ({
    announcements: [],
    players: [],
    currentUserId: "u1",
    isFeatureEnabled: () => false,
    onNavigate: () => {},
    ...overrides,
  });

  it("nothing to show → renders nothing", () => {
    assert.equal(render(React.createElement(CampaignHeroBanner, props())), "");
  });
  it("a single slide shows no carousel controls but keeps the dismiss button", () => {
    const html = render(React.createElement(CampaignHeroBanner, props({ isFeatureEnabled: (k) => k === "studio" })));
    assert.ok(html.includes('data-testid="banner-dismiss"'));
    assert.ok(!html.includes("banner-slide-indicator"));
    assert.ok(!html.includes("Next highlight"));
  });
  it("multiple slides show a one-line indicator, dots and desktop arrows", () => {
    const html = render(React.createElement(CampaignHeroBanner, props({ isFeatureEnabled: () => true })));
    const i = html.indexOf('data-testid="banner-slide-indicator"');
    assert.ok(html.slice(i - 200, i + 200).includes("whitespace-nowrap"));
    assert.match(text(html), /1\/2/);
    assert.ok(html.includes('aria-label="Next highlight"'));
    assert.equal((html.match(/aria-label="Show highlight \d of 2"/g) || []).length, 2);
  });
  it("dismiss never triggers navigation; undo and restore exist", () => {
    const s = src("components/home/CampaignHeroBanner.tsx");
    const fn = s.slice(s.indexOf("const dismiss ="), s.indexOf("const undoDismiss"));
    assert.ok(fn.includes("e.stopPropagation()"));
    assert.ok(!fn.includes("onNavigate"));
    assert.ok(s.includes('data-testid="banner-undo"'));
    assert.ok(s.includes('data-testid="banner-restore"'));
    assert.match(s, /Show club highlights \(\{allSlides\.length\}\)/);
  });
  it("auto-rotation pauses for hover, focus, touch, hidden tab and reduced motion", () => {
    const s = src("components/home/CampaignHeroBanner.tsx");
    assert.match(s, /isHovered \|\| isFocusWithin \|\| isDocumentHidden \|\| prefersReducedMotion === true \|\| now < touchPausedUntil/);
  });
  it("banner is not hidden on any screen size", () => {
    const home = src("components/HomeTab.tsx");
    const i = home.indexOf("<CampaignHeroBanner");
    assert.ok(!/hidden (sm|md|lg):/.test(home.slice(i - 200, i)));
  });
});

describe("Admin Match Center uses the shared card system without exposing admin controls to players", () => {
  const s = src("components/MatchesTab.tsx");
  it("admin card renders MatchCardHeader and shared surfaces", () => {
    assert.match(s, /<MatchCardHeader match=\{match\} ground=\{ground\} resultPlacement="inline" \/>/);
    assert.match(s, /getMatchCardSurfaceClass\(\{ isAlternate: isAlternateCard \}\)/);
  });
  it("duplicate / edit / delete actions are only rendered when isAdmin", () => {
    const start = s.indexOf("end={", s.indexOf("<MatchCardTopBar"));
    const block = s.slice(start, start + 200);
    assert.match(block, /isAdmin \? \(/);
  });
  it("Player Home and Player Match Center render the same PlayerMatchCard", () => {
    assert.match(src("components/home/UpcomingMatchesSection.tsx"), /<PlayerMatchCard/);
    assert.match(src("components/matches/PlayerMatchCenter.tsx"), /<PlayerMatchCard/);
    assert.match(src("components/matches/PlayerMatchCard.tsx"), /<MatchCardHeader/);
  });
});
