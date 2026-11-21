"use client";

/**
 * 16:9 announcement image picker with reposition + zoom
 * (`components/home/AnnouncementImagePicker.tsx`).
 *
 * - Choose a JPG/PNG/WebP (≤10 MB); 1600×900 recommended, other sizes accepted.
 * - Drag (mouse / touch) or use arrow keys to reposition, slider to zoom.
 * - The preview frame is exactly what members see on mobile and desktop.
 * - `exportCroppedImage` renders the crop to a compressed JPEG data URL.
 * No new dependency: plain <canvas>.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2, Move } from "lucide-react";
import {
  ANNOUNCEMENT_IMAGE_EXPORT,
  ANNOUNCEMENT_IMAGE_FALLBACK_EXPORT,
  ANNOUNCEMENT_IMAGE_MAX_STORED_CHARS,
  DEFAULT_CROP,
  computeSourceRect,
  panCrop,
  validateImageDimensions,
  validateImageFile,
  type CropState,
} from "@/lib/announcement-image";

export interface PickedImage {
  image: HTMLImageElement;
  crop: CropState;
}

/** Renders the crop to a JPEG data URL under the storage size budget, or throws. */
export function exportCroppedImage(picked: PickedImage): string {
  const attempts: Array<{ size: { width: number; height: number }; quality: number }> = [
    { size: ANNOUNCEMENT_IMAGE_EXPORT, quality: 0.85 },
    { size: ANNOUNCEMENT_IMAGE_EXPORT, quality: 0.75 },
    { size: ANNOUNCEMENT_IMAGE_EXPORT, quality: 0.65 },
    { size: ANNOUNCEMENT_IMAGE_FALLBACK_EXPORT, quality: 0.75 },
    { size: ANNOUNCEMENT_IMAGE_FALLBACK_EXPORT, quality: 0.6 },
  ];
  const { image, crop } = picked;
  const { sx, sy, sw, sh } = computeSourceRect(image.naturalWidth, image.naturalHeight, crop);
  for (const { size, quality } of attempts) {
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing is not supported in this browser.");
    ctx.fillStyle = "#ffffff"; // PNG transparency → white, not black
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size.width, size.height);
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.startsWith("data:image/jpeg") && url.length <= ANNOUNCEMENT_IMAGE_MAX_STORED_CHARS) return url;
  }
  throw new Error("This image is too detailed to store. Try a simpler or smaller image.");
}

export function AnnouncementImagePicker({
  value,
  existingUrl,
  onChange,
  onRemoveExisting,
}: {
  value: PickedImage | null;
  /** Already-saved image (edit mode). */
  existingUrl?: string | null;
  onChange: (next: PickedImage | null) => void;
  onRemoveExisting?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Draw the live preview whenever the image or crop changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { sx, sy, sw, sh } = computeSourceRect(value.image.naturalWidth, value.image.naturalHeight, value.crop);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(value.image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  }, [value]);

  const pick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setLoading(true);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const dimsProblem = validateImageDimensions(img.naturalWidth, img.naturalHeight);
      setLoading(false);
      if (dimsProblem) {
        URL.revokeObjectURL(url);
        setError(dimsProblem);
        return;
      }
      onChange({ image: img, crop: DEFAULT_CROP });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setLoading(false);
      setError("This file could not be opened as an image.");
    };
    img.src = url;
  };

  const updateCrop = useCallback(
    (fn: (c: CropState) => CropState) => {
      if (!value) return;
      onChange({ ...value, crop: fn(value.crop) });
    },
    [value, onChange],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!value) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start || !value) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    const frameWidth = frameRef.current?.clientWidth || 1;
    updateCrop((c) => panCrop(c, value.image.naturalWidth, value.image.naturalHeight, frameWidth, dx, dy));
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!value) return;
    const step = 12;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    const frameWidth = frameRef.current?.clientWidth || 1;
    updateCrop((c) => panCrop(c, value.image.naturalWidth, value.image.naturalHeight, frameWidth, delta[0], delta[1]));
  };

  const showExisting = !value && existingUrl;

  return (
    <div className="flex flex-col gap-2" data-testid="announcement-image-picker">
      <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Image (optional)</span>

      {value ? (
        <>
          <div
            ref={frameRef}
            role="application"
            tabIndex={0}
            aria-label="Image crop frame. Drag or use arrow keys to reposition."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            className="relative w-full aspect-video overflow-hidden rounded-xl border border-border bg-surface-hover cursor-grab active:cursor-grabbing touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-scarlet/50"
          >
            <canvas
              ref={canvasRef}
              width={ANNOUNCEMENT_IMAGE_EXPORT.width / 2}
              height={ANNOUNCEMENT_IMAGE_EXPORT.height / 2}
              className="w-full h-full block"
              data-testid="announcement-image-preview"
            />
            <span className="pointer-events-none absolute left-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
              <Move className="w-3 h-3" aria-hidden="true" /> Drag to reposition
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="shrink-0 font-bold">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={value.crop.zoom}
              onChange={(e) => updateCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
              className="w-full accent-[var(--brand-scarlet)]"
              aria-label="Zoom image"
            />
          </label>
          <p className="text-[11px] text-text-muted">
            Shown in this exact 16:9 frame on mobile and desktop. Recommended source: 1600×900.
          </p>
        </>
      ) : showExisting ? (
        <div className="relative w-full aspect-video overflow-hidden rounded-xl border border-border bg-surface-hover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={existingUrl as string} alt="" className="w-full h-full object-cover" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full aspect-video rounded-xl border-2 border-dashed border-border bg-surface-hover/60 flex flex-col items-center justify-center gap-1 text-xs font-bold text-text-secondary hover:border-scarlet/40 hover:text-scarlet cursor-pointer"
        >
          <ImagePlus className="w-6 h-6" aria-hidden="true" />
          {loading ? "Opening image…" : "Add a 16:9 image"}
          <span className="font-medium text-text-muted">JPG, PNG or WebP · up to 10 MB · 1600×900 recommended</span>
        </button>
      )}

      {(value || showExisting) && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="min-h-[36px] px-3 rounded-lg border border-border text-xs font-bold text-text-secondary hover:text-text-primary cursor-pointer inline-flex items-center gap-1"
          >
            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" /> Replace
          </button>
          <button
            type="button"
            onClick={() => {
              if (value) onChange(null);
              else onRemoveExisting?.();
            }}
            className="min-h-[36px] px-3 rounded-lg border border-border text-xs font-bold text-rose-700 hover:bg-rose-50 cursor-pointer inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}
