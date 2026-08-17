export interface MediaVariant {
  bit_rate?: number;
  content_type: string;
  url: string;
}

/**
 * Picks the best URL to download or link for an X media item. A photo carries a
 * direct url, so we use that. A video or a gif has no url in the API payload. It
 * only has a preview_image_url, which is the thumbnail, and a list of variants.
 * For those we take the mp4 variant with the highest bit rate. If there is no mp4
 * we take any variant, and with no variants at all we fall back to the thumbnail.
 */
export function getBestMediaUrl(item: {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: MediaVariant[];
}): string | undefined {
  if (item.type === "photo") return item.url || item.preview_image_url;

  if (item.variants?.length) {
    const mp4s = item.variants
      .filter((v) => v.content_type === "video/mp4")
      .sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0));
    if (mp4s[0]) return mp4s[0].url;
    return item.variants[0]?.url;
  }

  return item.url || item.preview_image_url;
}
