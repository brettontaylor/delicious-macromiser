/**
 * Photo capture.
 *
 * The app stores the picture and does not look at it. Analysis happens on the
 * model the user already pays for, reached through the connector they already
 * added — which is what "bring your own LLM" means for someone with a
 * subscription rather than an API key.
 *
 * Verified 2026-08-24 that an MCP client passes an `image` content block through
 * to the model, so `get_pending_captures` can hand the photo over directly and
 * no signed-URL fallback is needed.
 */

import type { Ctx } from '../db/queries.ts';
import { insertCapture, countCapturesToday } from '../db/queries.ts';
import { localDate } from '../util/date.ts';

/** Phone photos are typically 2-5 MB. Above this the base64 in a tool result
 *  gets unreasonable, and the extra pixels buy no accuracy for a plate of food. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** Per-day cap. Not rate limiting so much as a bound on an accident — a stuck
 *  upload loop should cost a few megabytes, not a bucket. */
export const MAX_PHOTOS_PER_DAY = 40;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export type PhotoOutcome =
  | { ok: true; captureId: string }
  | { ok: false; reason: 'nofile' | 'toolarge' | 'badtype' | 'dailycap' | 'nobucket' };

export async function storePhoto(
  ctx: Ctx,
  bucket: R2Bucket | undefined,
  file: File,
  note: string | null,
): Promise<PhotoOutcome> {
  if (!bucket) return { ok: false, reason: 'nobucket' };
  if (!file || file.size === 0) return { ok: false, reason: 'nofile' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, reason: 'toolarge' };

  // Some phone browsers send an empty or generic type; fall back to the
  // extension rather than refusing a real photo over a header.
  const type = ALLOWED.has(file.type)
    ? file.type
    : /\.(jpe?g)$/i.test(file.name)
      ? 'image/jpeg'
      : /\.png$/i.test(file.name)
        ? 'image/png'
        : /\.webp$/i.test(file.name)
          ? 'image/webp'
          : /\.hei[cf]$/i.test(file.name)
            ? 'image/heic'
            : null;
  if (!type) return { ok: false, reason: 'badtype' };

  const date = localDate(ctx.now, ctx.tz);
  if ((await countCapturesToday(ctx, date)) >= MAX_PHOTOS_PER_DAY) {
    return { ok: false, reason: 'dailycap' };
  }

  const key = `${ctx.userId}/${date}/${crypto.randomUUID()}`;
  await bucket.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: type },
  });

  const captureId = await insertCapture(ctx, {
    local_date: date,
    kind: 'photo',
    note,
    object_key: key,
    mime_type: type,
    bytes: file.size,
  });

  return { ok: true, captureId };
}

/**
 * ArrayBuffer to base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` blows the stack somewhere around a hundred
 * thousand arguments, which a photo comfortably exceeds. This is the boring,
 * correct version.
 */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Delete the object behind a capture. Called when its retention expires. */
export async function deletePhoto(bucket: R2Bucket | undefined, key: string): Promise<void> {
  if (!bucket) return;
  await bucket.delete(key);
}
