#!/usr/bin/env node
/**
 * Cross-platform runner for Firebase Emulator security rules tests.
 * Resolves Java runtime portably without hardcoded Unix-only shell assumptions.
 */

import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

function findJavaBin() {
  // 1. Check if java is already in PATH
  const check = spawnSync("java", ["-version"], { stdio: "ignore" });
  if (check.status === 0) {
    return null; // Already in PATH
  }

  // 2. Check JAVA_HOME
  if (process.env.JAVA_HOME) {
    const javaFromHome = path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(javaFromHome)) {
      return path.dirname(javaFromHome);
    }
  }

  // 3. Common macOS Homebrew / Linux locations
  const candidates = [
    "/opt/homebrew/opt/openjdk@21/bin",
    "/opt/homebrew/opt/openjdk/bin",
    "/usr/local/opt/openjdk@21/bin",
    "/usr/local/opt/openjdk/bin",
    "/usr/lib/jvm/java-21-openjdk-amd64/bin",
    "/usr/lib/jvm/java-17-openjdk-amd64/bin",
    "/usr/lib/jvm/default-java/bin",
  ];

  for (const dir of candidates) {
    const candidateBin = path.join(dir, process.platform === "win32" ? "java.exe" : "java");
    if (fs.existsSync(candidateBin)) {
      return dir;
    }
  }

  return null;
}

const env = { ...process.env };
env.NODE_ENV = "test";
env.KAVACH_TEST_AUTH_BYPASS = "true";
const javaDir = findJavaBin();
if (javaDir) {
  env.PATH = `${javaDir}${path.delimiter}${env.PATH || ""}`;
}

console.log("[emulator-runner] Starting Firebase Local Firestore Emulator...");
const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "firebase",
    "emulators:exec",
    "--only",
    "firestore",
    "node --test tests/*emulator*.test.mjs tests/firestore-rules.test.mjs",
  ],
  {
    stdio: "inherit",
    env,
  },
);

process.exit(result.status ?? 1);
