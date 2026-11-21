/**
 * Clickable announcement banner + mobile Upcoming Matches carousel
 * (`tests/home-banner-link-carousel.test.mjs`).
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
    if (id === "react") return React;
    if (id.startsWith("@/lib/")) return load(withExt(path.resolve("lib", id.slice(6).replace(/\.ts$/, ""))));
    if (id.startsWith("@/components/")) return load(withExt(path.resolve("components", id.slice(13))));
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

const { toSafeHttpsHref, firstHttpsLink } = load("lib/linkify.ts");
const { buildBannerSlides, clubDayFromParts } = load("components/home/bannerSlides.ts");
const { CampaignHeroBanner } = load("components/home/CampaignHeroBanner.tsx");
const { validateAnnouncementDraft } = load("components/home/AnnouncementComposer.tsx");
const { UpcomingMatchesSection } = load("components/home/UpcomingMatchesSection.tsx");

const today = clubDayFromParts(2026, 10, 21);
const notice = (over = {}) => ({ id: "n1", text: "AGM on Sunday.", isAnnouncement: true, isPinned: true, comments: [], ...over });
const slidesFor = (post) => buildBannerSlides({ announcements: [post], isFeatureEnabled: () => false, today });

// ─────────────────────────────────────────────────────────────────────────────
describe("Banner destination URL", () => {
  it("only HTTPS destinations are accepted", () => {
    assert.equal(toSafeHttpsHref("https://kavach.club/agm"), "https://kavach.club/agm");
    for (const bad of ["http://kavach.club", "javascript:alert(1)", "data:text/html,x", "ftp://x.y", "kavach", "", null]) {
      assert.equal(toSafeHttpsHref(bad), null, String(bad));
    }
  });
  it("uses the announcement's link field when valid", () => {
    const [s] = slidesFor(notice({ linkUrl: "https://kavach.club/agm" }));
    assert.equal(s.href, "https://kavach.club/agm");
  });
  it("falls back to the first HTTPS link in the text (existing announcements)", () => {
    assert.equal(firstHttpsLink("See http://a.com and https://b.com/x."), "https://b.com/x");
    const [s] = slidesFor(notice({ text: "Register: https://forms.example.com/agm. Thanks" }));
    assert.equal(s.href, "https://forms.example.com/agm");
  });
  it("unsafe or missing destinations leave the banner non-navigating", () => {
    assert.equal(slidesFor(notice({ linkUrl: "javascript:alert(1)" }))[0].href, undefined);
    assert.equal(slidesFor(notice({ linkUrl: "http://insecure.example.com" }))[0].href, undefined);
    assert.equal(slidesFor(notice())[0].href, undefined);
  });
  it("birthday and promo slides never get a destination URL", () => {
    const slides = buildBannerSlides({
      players: [{ id: "a", name: "Asha", dob: "1995-11-21" }],
      isFeatureEnabled: () => true,
      today,
    });
    assert.ok(slides.length >= 3);
    assert.ok(slides.every((s) => s.href === undefined));
  });
});

describe("Composer link validation", () => {
  it("accepts empty or https links, rejects others", () => {
    const base = { title: "", text: "Hello", isPinned: true };
    assert.equal(validateAnnouncementDraft({ ...base, linkUrl: "" }), null);
    assert.equal(validateAnnouncementDraft({ ...base, linkUrl: "https://kavach.club" }), null);
    assert.match(validateAnnouncementDraft({ ...base, linkUrl: "http://kavach.club" }), /https:\/\//);
    assert.match(validateAnnouncementDraft({ ...base, linkUrl: "javascript:alert(1)" }), /https:\/\//);
  });
});

describe("Clickable banner rendering", () => {
  const props = (announcements) => ({
    announcements,
    players: [],
    currentUserId: "u1",
    isFeatureEnabled: () => false,
    onNavigate: () => {},
  });

  it("with a destination: whole-banner safe link with an accessible name", () => {
    const html = render(React.createElement(CampaignHeroBanner, props([notice({ title: "AGM", linkUrl: "https://kavach.club/agm" })])));
    assert.ok(html.includes('data-testid="banner-link"'));
    assert.ok(html.includes('href="https://kavach.club/agm"'));
    assert.ok(html.includes('target="_blank"'));
    assert.ok(html.includes('rel="noopener noreferrer"'));
    assert.ok(html.includes('aria-label="Open link: AGM (opens in a new tab)"'));
    assert.match(text(html), /Open link/);
  });
  it("dismiss stays an independent control above the link", () => {
    const html = render(React.createElement(CampaignHeroBanner, props([notice({ title: "AGM", linkUrl: "https://kavach.club/agm" })])));
    const dismiss = html.slice(html.indexOf('data-testid="banner-dismiss"') - 300, html.indexOf('data-testid="banner-dismiss"') + 300);
    assert.ok(dismiss.includes("pointer-events:auto"));
    const s = src("components/home/CampaignHeroBanner.tsx");
    const fn = s.slice(s.indexOf("const dismiss ="), s.indexOf("const undoDismiss"));
    assert.ok(fn.includes("e.preventDefault()") && fn.includes("e.stopPropagation()"));
    // the link is not an ancestor of the controls (no nested interactive elements)
    assert.match(s, /<a\s+href=\{activeSlide\.href\}[\s\S]*?\/>/);
  });
  it("swipes do not open the link", () => {
    const s = src("components/home/CampaignHeroBanner.tsx");
    assert.match(s, /suppressLinkClickRef\.current = moved;/);
    assert.match(s, /if \(suppressLinkClickRef\.current\) \{\s*e\.preventDefault\(\);/);
  });
  it("without a destination: no link, existing behaviour", () => {
    const html = render(React.createElement(CampaignHeroBanner, props([notice({ title: "AGM" })])));
    assert.ok(!html.includes('data-testid="banner-link"'));
    assert.ok(html.includes('data-testid="hero-campaign-cta"'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Upcoming Matches: mobile carousel, desktop grid", () => {
  const mk = (id, date) => ({ id, opponent: `Opp ${id}`, date, time: "07:00", format: "T20", jerseyColor: "Whites", matchType: "Practice", result: "Pending" });
  const renderSection = (matches) =>
    render(React.createElement(UpcomingMatchesSection, {
      matches, grounds: [], payments: [], player: { id: "p1" },
      onRsvp: async () => {}, onNavigateToMatch: () => {}, onNavigateToAllMatches: () => {},
    }));

  it("multiple matches: snap carousel on mobile that becomes the 2-column grid at md", () => {
    const html = renderSection([mk("a", "2026-12-01"), mk("b", "2026-12-02"), mk("c", "2026-12-03")]);
    const track = html.slice(html.indexOf('data-testid="upcoming-matches-track"'), html.indexOf('data-testid="upcoming-matches-track"') + 600);
    assert.ok(track.includes('data-layout="carousel"'));
    for (const c of ["flex", "overflow-x-auto", "snap-x", "snap-mandatory", "overscroll-x-contain", "md:grid", "md:grid-cols-2", "md:overflow-visible", "md:snap-none"]) {
      assert.ok(track.includes(c), c);
    }
    assert.equal((html.match(/shrink-0 w-\[86%\] sm:w-\[70%\] snap-start md:w-auto/g) || []).length, 3, "next card peeks (86%)");
  });
  it("order is preserved and every card keeps the shared match card", () => {
    const html = renderSection([mk("a", "2026-12-01"), mk("b", "2026-12-02")]);
    assert.ok(html.indexOf("player-match-card-a") < html.indexOf("player-match-card-b"));
    assert.ok(html.includes("availability-buttons-a") && html.includes("availability-buttons-b"));
    assert.ok(html.includes('data-category="practice"'));
    assert.ok(html.includes('data-format-tone="t20"'));
  });
  it("swipe hint: mobile only, compact, with one dot per match", () => {
    const html = renderSection([mk("a", "2026-12-01"), mk("b", "2026-12-02"), mk("c", "2026-12-03")]);
    const hint = html.slice(html.indexOf('data-testid="upcoming-swipe-hint"') - 120);
    assert.ok(hint.includes("md:hidden"));
    assert.match(text(hint), /Swipe to explore/);
    assert.equal((html.match(/aria-label="Show match \d of 3"/g) || []).length, 3);
  });
  it("single match: no carousel affordance or hint", () => {
    const html = renderSection([mk("a", "2026-12-01")]);
    assert.ok(html.includes('data-layout="single"'));
    assert.ok(!html.includes("upcoming-swipe-hint"));
    assert.ok(!html.includes("snap-x"));
  });
  it("no matches: existing empty state", () => {
    const html = renderSection([]);
    assert.match(text(html), /No Upcoming Fixtures Scheduled/);
    assert.ok(!html.includes("upcoming-matches-track"));
  });
  it("scrolling to a dot never moves the page vertically; scrollbar utility exists", () => {
    assert.match(src("components/home/UpcomingMatchesSection.tsx"), /inline: "start", block: "nearest"/);
    assert.match(src("app/globals.css"), /@utility no-scrollbar \{/);
  });
});
