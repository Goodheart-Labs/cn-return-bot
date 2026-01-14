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
}

export interface PostContent {
  text: string;
  media: string[];
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
