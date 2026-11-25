import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const shopSrc = fs.readFileSync(
  path.join(process.cwd(), "components/ShopTab.tsx"),
  "utf8",
);

test("Player Shop does not expose Club global orders, Admin Shop, or WhatsApp report modal to non-admins", () => {
  assert.match(
    shopSrc,
    /\{isAdmin && \(\s*<button[\s\S]*?setView\("global-list"\)[\s\S]*?Club \(\{store\.merchOrders\.length\}\)/,
  );
  assert.match(shopSrc, /\{isAdmin && view === "global-list" && \(/);
  assert.match(shopSrc, /\{isAdmin && showReportModal && \(/);
});

test("Player Shop filters hidden merchandise and resets restricted views when !isAdmin", () => {
  assert.match(shopSrc, /\.filter\(\(m\) => isAdmin \|\| !m\.isHidden\)/);
  assert.match(
    shopSrc,
    /if\s*\(!isAdmin\)\s*\{\s*if\s*\(view === "admin" \|\| view === "global-list"\)\s*\{\s*setView\("catalog"\);/,
  );
});

test("Player Shop myOrders guards against undefined playerProfile/user ids", () => {
  assert.match(
    shopSrc,
    /\(Boolean\(playerProfile\?\.id\) && o\.playerId === playerProfile\?\.id\)\s*\|\|\s*\(Boolean\(user\?\.uid\) && o\.playerId === user\?\.uid\)/,
  );
});
