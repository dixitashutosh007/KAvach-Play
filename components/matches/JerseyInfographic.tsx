"use client";

import React from "react";
import { Shirt } from "lucide-react";

export interface JerseyInfographicProps {
  color?: string | null;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export interface JerseyDetails {
  label: string;
  isWhite: boolean;
  isRed: boolean;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

/**
 * Normalizes and resolves visual attributes and accessible semantic labels for jersey colors.
 */
export function getJerseyDetails(color?: string | null): JerseyDetails | null {
  const normalized = (color || "").trim().toLowerCase();
  if (!normalized) return null;

  const isWhite = normalized.includes("white");
  const isRed = normalized.includes("red") || normalized.includes("scarlet");

  if (isWhite) {
    return {
      label: "White jersey",
      isWhite: true,
      isRed: false,
      fillColor: "#FFFFFF",
      strokeColor: "#374151", // High-contrast charcoal outline
      strokeWidth: 2.2,
    };
  }

  if (isRed) {
    return {
      label: "Red jersey",
      isWhite: false,
      isRed: true,
      fillColor: "#D51F43", // Canonical KAvach scarlet
      strokeColor: "#881337", // Deep wine border
      strokeWidth: 1.5,
    };
  }

  // Safe fallback for unexpected or non-standard custom colors
  return {
    label: `${color} jersey`,
    isWhite: false,
    isRed: false,
    fillColor: "#64748B",
    strokeColor: "#334155",
    strokeWidth: 1.5,
  };
}

/**
 * Reusable visual jersey infographic communicating kit color through design rather than text.
 * Meets accessibility criteria with semantic role and aria-label.
 */
export function JerseyInfographic({
  color,
  className = "",
  size = "sm",
}: JerseyInfographicProps) {
  const details = getJerseyDetails(color);
  if (!details) return null;

  const sizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const containerPadding = {
    sm: "p-1 rounded-md",
    md: "p-1.5 rounded-lg",
    lg: "p-2 rounded-xl",
  };

  return (
    <span
      role="img"
      aria-label={details.label}
      title={details.label}
      data-testid="jersey-infographic"
      className={`inline-flex items-center justify-center shrink-0 border shadow-2xs transition-transform ${
        containerPadding[size]
      } ${
        details.isWhite
          ? "bg-slate-50 border-slate-300"
          : details.isRed
          ? "bg-scarlet/5 border-scarlet/25"
          : "bg-surface-hover border-border"
      } ${className}`}
    >
      <Shirt
        className={`${sizeClasses[size]} shrink-0`}
        fill={details.fillColor}
        stroke={details.strokeColor}
        strokeWidth={details.strokeWidth}
      />
    </span>
  );
}
