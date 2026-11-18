#!/usr/bin/env node
/**
 * scripts/prepare-standalone.mjs
 *
 * Prepares the Next.js standalone build for execution:
 * 1. Copies `public` into `.next/standalone/public`
 * 2. Copies `.next/static` into `.next/standalone/.next/static`
 *
 * In Next.js standalone output mode, static assets and public directory are not
 * copied by default (as they are typically served by a CDN). When deploying or
 * testing the standalone server locally/in CI with `node .next/standalone/server.js`,
 * copying these assets ensures all CSS, JS chunks, and static assets resolve correctly.
 */

import fs from "fs";
import path from "path";

const rootDir = process.cwd();
const standaloneDir = path.join(rootDir, ".next", "standalone");
const publicSrc = path.join(rootDir, "public");
const publicDest = path.join(standaloneDir, "public");
const staticSrc = path.join(rootDir, ".next", "static");
const staticDest = path.join(standaloneDir, ".next", "static");

if (!fs.existsSync(standaloneDir)) {
  console.error("[prepare-standalone] Error: .next/standalone directory not found. Run 'npm run build' first.");
  process.exit(1);
}

// 1. Copy public directory if present
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true, force: true });
  console.log("[prepare-standalone] Copied public/ -> .next/standalone/public/");
}

// 2. Copy .next/static directory
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
  console.log("[prepare-standalone] Copied .next/static/ -> .next/standalone/.next/static/");
}

console.log("[prepare-standalone] Standalone deployment artifact ready.");
