export interface MediaVariant {
  bit_rate?: number;
  content_type: string;
  url: string;
}

/**
 * Best downloadable/linkable URL for an X media item. Photos use the direct
 * url. Videos/gifs have no `url` in the API payload — only `preview_image_url`
 * (the thumbnail) and `variants` — so pick the highest-bitrate mp4 variant,
 * falling back to any variant, then the thumbnail.
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
