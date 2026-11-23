"use client";

/**
 * Small presentational building blocks for the Add / Edit Match form
 * (`components/matches/MatchFormParts.tsx`): a titled section card and a
 * segmented single-choice control with 44px touch targets.
 */
import React from "react";

export function FormSection({
  icon,
  title,
  children,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface overflow-hidden" data-testid={testId}>
      <h3 className="flex items-center gap-2 px-4 py-3 bg-brand-surface/50 text-sm font-black font-heading text-brand">
        {icon}
        {title}
      </h3>
      <div className="p-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function FieldLabel({ children, required = false, htmlFor }: { children: React.ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold text-text-secondary">
      {children}
      {required && <span className="text-brand"> *</span>}
    </label>
  );
}

export const FIELD_CLASS =
  "w-full min-h-[48px] rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand/60 focus-visible:ring-2 focus-visible:ring-brand/30";

export function ChoiceGroup<T extends string>({
  name,
  options,
  value,
  onChange,
  testId,
  renderLabel,
}: {
  name: string;
  options: readonly T[];
  value: T | string | undefined;
  onChange: (value: T) => void;
  testId?: string;
  renderLabel?: (option: T) => React.ReactNode;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex gap-2" data-testid={testId}>
      {options.map((option) => {
        const active = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={`flex-1 min-w-0 min-h-[44px] px-2 rounded-xl border text-sm font-bold transition-colors motion-reduce:transition-none cursor-pointer inline-flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              active ? "bg-brand border-brand text-white" : "bg-surface border-border text-text-primary hover:border-brand/40"
            }`}
          >
            {renderLabel ? renderLabel(option) : option}
          </button>
        );
      })}
    </div>
  );
}
