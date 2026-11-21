/**
 * Announcement image helpers (`lib/announcement-image.ts`). Pure, no DOM/Firebase.
 *
 * Images are cropped client-side to a fixed 16:9 frame (recommended upload
 * 1600×900; any reasonable size is accepted) and exported as a compressed JPEG
 * data URL stored in the post's existing `imageUrl` field. Firebase Storage is
 * not configured for this project (no storage rules), so no upload service or
 * credentials are involved.
 */

export const ANNOUNCEMENT_IMAGE_ASPECT = 16 / 9;
export const ANNOUNCEMENT_IMAGE_EXPORT = { width: 1280, height: 720 } as const;
export const ANNOUNCEMENT_IMAGE_FALLBACK_EXPORT = { width: 960, height: 540 } as const;
export const ANNOUNCEMENT_IMAGE_MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB source file
/** Max stored data-URL length (chars). Keeps the post well under Firestore's 1 MiB document limit. */
export const ANNOUNCEMENT_IMAGE_MAX_STORED_CHARS = 350_000;
export const ANNOUNCEMENT_IMAGE_MIN_SIDE = 320;
export const ANNOUNCEMENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validateImageFile(file: { type: string; size: number } | null | undefined): string | null {
  if (!file) return "Please choose an image.";
  if (!(ANNOUNCEMENT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "Please choose a JPG, PNG or WebP image.";
  }
  if (file.size <= 0) return "The selected file is empty.";
  if (file.size > ANNOUNCEMENT_IMAGE_MAX_INPUT_BYTES) return "Image must be 10 MB or smaller.";
  return null;
}

export function validateImageDimensions(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "The image could not be read.";
  }
  if (width < ANNOUNCEMENT_IMAGE_MIN_SIDE || height < Math.round(ANNOUNCEMENT_IMAGE_MIN_SIDE / ANNOUNCEMENT_IMAGE_ASPECT)) {
    return "This image is too small (minimum 320×180). 1600×900 is recommended.";
  }
  return null;
}

const SAFE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Only https URLs or bounded base64 JPEG/PNG/WebP data URLs may be rendered. */
export function isSafeImageSrc(src: string | null | undefined): boolean {
  if (typeof src !== "string" || !src) return false;
  if (src.startsWith("data:")) {
    return src.length <= ANNOUNCEMENT_IMAGE_MAX_STORED_CHARS * 1.5 && SAFE_DATA_URL.test(src);
  }
  try {
    return new URL(src).protocol === "https:";
  } catch {
    return false;
  }
}

export interface CropState {
  /** Zoom ≥ 1 relative to the "cover" fit of the 16:9 frame. */
  zoom: number;
  /** Horizontal / vertical position of the visible window, 0 = left/top, 1 = right/bottom. */
  focusX: number;
  focusY: number;
}

export const DEFAULT_CROP: CropState = { zoom: 1, focusX: 0.5, focusY: 0.5 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function normalizeCrop(c: CropState): CropState {
  return {
    zoom: clamp(Number.isFinite(c.zoom) ? c.zoom : 1, 1, 4),
    focusX: clamp(Number.isFinite(c.focusX) ? c.focusX : 0.5, 0, 1),
    focusY: clamp(Number.isFinite(c.focusY) ? c.focusY : 0.5, 0, 1),
  };
}

/** Source rectangle (in image pixels) visible in the 16:9 frame for a crop state. */
export function computeSourceRect(
  imageWidth: number,
  imageHeight: number,
  crop: CropState,
): { sx: number; sy: number; sw: number; sh: number } {
  const c = normalizeCrop(crop);
  // Largest 16:9 window that fits the image ("cover"), then shrink by zoom.
  let sw = imageWidth;
  let sh = sw / ANNOUNCEMENT_IMAGE_ASPECT;
  if (sh > imageHeight) {
    sh = imageHeight;
    sw = sh * ANNOUNCEMENT_IMAGE_ASPECT;
  }
  sw /= c.zoom;
  sh /= c.zoom;
  const sx = (imageWidth - sw) * c.focusX;
  const sy = (imageHeight - sh) * c.focusY;
  return { sx, sy, sw, sh };
}

/**
 * Converts a drag of (dx, dy) frame pixels into a new focus, so the image follows
 * the pointer. `frameWidth` is the on-screen width of the 16:9 frame.
 */
export function panCrop(
  crop: CropState,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  dx: number,
  dy: number,
): CropState {
  const { sw, sh } = computeSourceRect(imageWidth, imageHeight, crop);
  const pxPerFrame = sw / Math.max(1, frameWidth);
  const spareX = imageWidth - sw;
  const spareY = imageHeight - sh;
  return normalizeCrop({
    zoom: crop.zoom,
    focusX: spareX > 0 ? crop.focusX - (dx * pxPerFrame) / spareX : 0.5,
    focusY: spareY > 0 ? crop.focusY - (dy * pxPerFrame) / spareY : 0.5,
  });
}
