import type { NextConfig } from "next";
import { execSync } from "child_process";

// Authoritative branch-aware Firestore Database ID resolution during build/bundling
let currentBranch =
  process.env.AWS_BRANCH ||
  process.env.GIT_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  "";

if (!currentBranch) {
  try {
    currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    currentBranch = "";
  }
}

let resolvedDbId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || "";
if (!resolvedDbId) {
  if (currentBranch === "mig-mov") {
    resolvedDbId = "kavach-play-db-ext";
  } else if (currentBranch === "main" || currentBranch === "master") {
    resolvedDbId = "ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412";
  }
}

if (resolvedDbId && !process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID) {
  process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID = resolvedDbId;
}
if (currentBranch && !process.env.AWS_BRANCH) {
  process.env.AWS_BRANCH = currentBranch;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['firebase', 'firebase-admin', '@firebase/firestore'],
  env: {
    ...(resolvedDbId ? { NEXT_PUBLIC_FIRESTORE_DATABASE_ID: resolvedDbId } : {}),
    ...(currentBranch ? { AWS_BRANCH: currentBranch } : {}),
  },
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
        pathname: "/**", // This allows any path under the hostname
      },
      {
        protocol: "https",
        hostname: "*.googleusercontent.com",
        port: "",
        pathname: "/**",
      },
    ],
  },
  output: "standalone",
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === "true") {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
