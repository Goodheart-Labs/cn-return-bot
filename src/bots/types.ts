/**
 * Bot Types
 *
 * Defines the interface that all bots must implement.
 */

export interface PipelineResult {
  post: any;
  botId: string;
  /** Last stage the bot successfully completed */
  lastStage: string;
  searchContextResult: {
    text: string;
    searchResults: string;
    citations?: string[];
    retweetContext?: string;
  };
  noteResult: {
    note: string;
    url: string;
    status: string;
  };
  checkResult: string;
  /** If the bot failed, this contains error info */
  error?: string;
  /** Non-fatal warnings (e.g. media analysis failed but pipeline continued) */
  warnings?: string[];
}

export interface MediaItem {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: Array<{ bit_rate?: number; content_type: string; url: string }>;
  duration_ms?: number;
}

export interface PostContent {
  text: string;
  /** Image/preview URLs for passing to LLM vision (backward compat) */
  media: string[];
  /** Full media objects with type, variants, etc. for media analysis */
  mediaItems?: MediaItem[];
  retweetContext?: string;
  isRetweet: boolean;
}

export interface Bot {
  /** Unique identifier for the bot */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what makes this bot different */
  description: string;

  /** Weight for random selection (higher = more likely) */
  weight: number;

  /** Run the full pipeline for a post */
  runPipeline(post: any, content: PostContent): Promise<PipelineResult | null>;
}
