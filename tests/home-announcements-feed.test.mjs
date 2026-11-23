/**
 * Club Announcements vs Club Feed separation (`tests/home-announcements-feed.test.mjs`).
 *
 * Pure functions and server-side component rendering only: no emulator,
 * browser, network or database access.
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
const src = (f) => fs.readFileSync(path.resolve(f), "utf-8");

const { isAnnouncementPost, announcementPosts, feedPosts, pinnedAnnouncements } = load("components/home/postKinds.ts");
const { validateAnnouncementDraft, ANNOUNCEMENT_TEXT_MAX, ANNOUNCEMENT_TITLE_MAX } = load("components/home/AnnouncementComposer.tsx");
const { ClubAnnouncementsSection } = load("components/home/ClubAnnouncementsSection.tsx");
const { ClubFeedPreview } = load("components/home/ClubFeedPreview.tsx");

const posts = [
  { id: "a1", text: "AGM on Sunday at the clubhouse.", title: "AGM", isAnnouncement: true, isPinned: true, comments: [], createdAt: { seconds: 300 } },
  { id: "a2", text: "Kit collection Saturday.", isAnnouncement: true, comments: [], createdAt: { seconds: 200 } },
  { id: "f1", text: "🏆 BADGE UNLOCKED! Ravi earned a badge", authorName: "KAvach Badges", comments: [], createdAt: { seconds: 250 } },
  { id: "f2", text: "Important notice about the nets — just kidding, a fun post", comments: [], createdAt: { seconds: 100 } },
];

describe("Post classification", () => {
  it("only explicitly flagged posts are announcements (no keyword guessing)", () => {
    assert.equal(isAnnouncementPost(posts[0]), true);
    assert.equal(isAnnouncementPost(posts[3]), false, "text containing 'notice' is not an announcement");
    assert.equal(isAnnouncementPost({ isPinned: true }), false, "pinned alone is not an announcement");
  });
  it("announcements and feed never overlap and together cover every post", () => {
    const a = announcementPosts(posts).map((p) => p.id);
    const f = feedPosts(posts).map((p) => p.id);
    assert.deepEqual(a, ["a1", "a2"]);
    assert.deepEqual(f, ["f1", "f2"]);
    assert.equal(a.filter((id) => f.includes(id)).length, 0);
  });
  it("only pinned announcements are banner candidates", () => {
    assert.deepEqual(pinnedAnnouncements(posts).map((p) => p.id), ["a1"]);
  });
});

describe("Club Announcements section", () => {
  it("shows only announcements", () => {
    const html = render(React.createElement(ClubAnnouncementsSection, { posts }));
    assert.ok(html.includes("announcement-item-a1"));
    assert.ok(html.includes("announcement-item-a2"));
    assert.ok(!html.includes("announcement-item-f1"));
    assert.ok(!html.includes("announcement-item-f2"));
  });
  it("no announcements → empty state, never falls back to feed posts", () => {
    const html = render(React.createElement(ClubAnnouncementsSection, { posts: posts.filter((p) => !p.isAnnouncement) }));
    assert.ok(html.includes('data-testid="announcements-empty"'));
    assert.ok(!html.includes("announcement-item-"));
  });
  it("publish button only for permitted admins", () => {
    const player = render(React.createElement(ClubAnnouncementsSection, { posts, canPublish: false, onPublish: async () => true }));
    assert.ok(!player.includes("new-announcement-button"));
    const admin = render(React.createElement(ClubAnnouncementsSection, { posts, canPublish: true, onPublish: async () => true }));
    assert.ok(admin.includes("new-announcement-button"));
  });
  it("more than three announcements collapse behind 'Show all'", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, text: `Notice ${i}`, isAnnouncement: true, comments: [] }));
    const html = render(React.createElement(ClubAnnouncementsSection, { posts: many }));
    assert.equal((html.match(/announcement-item-x/g) || []).length, 3);
    assert.ok(html.includes("Show all (5)"));
  });
});

describe("Club Feed", () => {
  it("excludes announcements", () => {
    const html = render(React.createElement(ClubFeedPreview, { posts }));
    assert.ok(html.includes("feed-post-f1"));
    assert.ok(html.includes("feed-post-f2"));
    assert.ok(!html.includes("feed-post-a1"));
    assert.ok(!html.includes("feed-post-a2"));
  });
  it("empty feed does not invite players to post (they cannot yet)", () => {
    const html = render(React.createElement(ClubFeedPreview, { posts: [] }));
    assert.ok(!/be the first/i.test(html));
  });
});

describe("Announcement composer", () => {
  it("requires a message and enforces length limits", () => {
    assert.match(validateAnnouncementDraft({ title: "", text: "   ", isPinned: false }), /message/i);
    assert.match(validateAnnouncementDraft({ title: "x".repeat(ANNOUNCEMENT_TITLE_MAX + 1), text: "ok", isPinned: false }), /Title/);
    assert.match(validateAnnouncementDraft({ title: "", text: "x".repeat(ANNOUNCEMENT_TEXT_MAX + 1), isPinned: false }), /Message/);
    assert.equal(validateAnnouncementDraft({ title: "AGM", text: "Sunday 10am", isPinned: true }), null);
  });
  it("D-16: Admin Home publishes through the existing post workflow, gated to super/club admins; Player Home cannot publish", () => {
    const admin = src("components/home/AdminHomeAnnouncements.tsx");
    assert.match(admin, /await store\.addPost\(\{/);
    assert.match(admin, /isAnnouncement: true,/);
    const page = src("app/page.tsx");
    // Mounted only in the Admin persona Home branch, for Super Admin claim or Club Admin.
    const adminHome = page.slice(page.indexOf("isSuperAdmin || isClubAdmin ? ("), page.indexOf("isSuperAdmin || isClubAdmin ? (") + 1200);
    assert.match(adminHome, /<AdminHomeAnnouncements/);
    assert.match(page, /const isClubAdmin = isSuperAdmin \|\| appUser\?\.isClubAdmin;/);
    assert.match(page, /const isSuperAdmin = !!hasAdminClaim;/);
    // Player Home has no publishing path at all.
    const home = src("components/HomeTab.tsx");
    for (const re of [/addPost/, /updateAnnouncement/, /deleteAnnouncement/, /canPublish/, /hasAdminClaim/]) {
      assert.doesNotMatch(home, re);
    }
  });
  it("Firestore rules still restrict post creation to admins (unchanged)", () => {
    const rules = src("firestore.rules");
    const block = rules.slice(rules.indexOf("match /posts/{postId}"), rules.indexOf("match /posts/{postId}") + 220);
    assert.match(block, /allow create: if isAnyAdmin\(\);/);
  });
});

describe("Home links no longer point at a missing 'feed' tab", () => {
  it("announcements / feed navigation is handled on Home", () => {
    const home = src("components/HomeTab.tsx");
    assert.match(home, /if \(tab === "announcements"\)/);
    assert.match(home, /if \(tab === "feed"\)/);
    assert.ok(!home.includes("onNavigateToFeed"));
  });
});
