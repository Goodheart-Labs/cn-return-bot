export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      competing_notes: {
        Row: {
          author_participant_id: string | null
          classification: string | null
          created_at_millis: number | null
          current_status: string | null
          first_seen_date: string | null
          id: string
          last_updated_at: string | null
          note_id: string
          note_text: string | null
          our_note_id: string | null
          pipeline_run_id: string | null
          tweet_id: string
        }
        Insert: {
          author_participant_id?: string | null
          classification?: string | null
          created_at_millis?: number | null
          current_status?: string | null
          first_seen_date?: string | null
          id?: string
          last_updated_at?: string | null
          note_id: string
          note_text?: string | null
          our_note_id?: string | null
          pipeline_run_id?: string | null
          tweet_id: string
        }
        Update: {
          author_participant_id?: string | null
          classification?: string | null
          created_at_millis?: number | null
          current_status?: string | null
          first_seen_date?: string | null
          id?: string
          last_updated_at?: string | null
          note_id?: string
          note_text?: string | null
          our_note_id?: string | null
          pipeline_run_id?: string | null
          tweet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competing_notes_our_note_id_fkey"
            columns: ["our_note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
          {
            foreignKeyName: "competing_notes_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_note_origin_counts: {
        Row: {
          day: string
          helpful_other_ai: number
          helpful_ours: number
          helpful_total: number
          last_synced_at: string
        }
        Insert: {
          day: string
          helpful_other_ai: number
          helpful_ours: number
          helpful_total: number
          last_synced_at?: string
        }
        Update: {
          day?: string
          helpful_other_ai?: number
          helpful_ours?: number
          helpful_total?: number
          last_synced_at?: string
        }
        Relationships: []
      }
      everything_claims: {
        Row: {
          claim: string
          context_paragraph: string | null
          context_quote: string | null
          context_url: string | null
          created_at: string
          created_by: string | null
          end_seconds: number | null
          id: string
          image_urls: Json
          item_id: string
          judgement: string
          start_seconds: number | null
          status: string
          status_reason: string | null
          updated_quote: string | null
        }
        Insert: {
          claim: string
          context_paragraph?: string | null
          context_quote?: string | null
          context_url?: string | null
          created_at?: string
          created_by?: string | null
          end_seconds?: number | null
          id?: string
          image_urls?: Json
          item_id: string
          judgement: string
          start_seconds?: number | null
          status?: string
          status_reason?: string | null
          updated_quote?: string | null
        }
        Update: {
          claim?: string
          context_paragraph?: string | null
          context_quote?: string | null
          context_url?: string | null
          created_at?: string
          created_by?: string | null
          end_seconds?: number | null
          id?: string
          image_urls?: Json
          item_id?: string
          judgement?: string
          start_seconds?: number | null
          status?: string
          status_reason?: string | null
          updated_quote?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "everything_claims_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "everything_items"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_donations: {
        Row: {
          amount_if_helpful: number | null
          amount_if_not_helpful: number | null
          amount_usd: number | null
          charity: string
          created_at: string
          id: string
          vote_id: string
        }
        Insert: {
          amount_if_helpful?: number | null
          amount_if_not_helpful?: number | null
          amount_usd?: number | null
          charity: string
          created_at?: string
          id?: string
          vote_id: string
        }
        Update: {
          amount_if_helpful?: number | null
          amount_if_not_helpful?: number | null
          amount_usd?: number | null
          charity?: string
          created_at?: string
          id?: string
          vote_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_donations_vote_id_fkey"
            columns: ["vote_id"]
            isOneToOne: true
            referencedRelation: "everything_votes"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_events: {
        Row: {
          created_at: string
          device_id: string
          event: string
          id: string
          platform: string
          props: Json
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_id: string
          event: string
          id?: string
          platform: string
          props?: Json
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_id?: string
          event?: string
          id?: string
          platform?: string
          props?: Json
          user_id?: string | null
        }
        Relationships: []
      }
      everything_feed_schedule: {
        Row: {
          dispatched_at: string | null
          id: boolean
          next_run_at: string | null
          next_run_reason: string | null
        }
        Insert: {
          dispatched_at?: string | null
          id?: boolean
          next_run_at?: string | null
          next_run_reason?: string | null
        }
        Update: {
          dispatched_at?: string | null
          id?: boolean
          next_run_at?: string | null
          next_run_reason?: string | null
        }
        Relationships: []
      }
      everything_items: {
        Row: {
          checked_scope: string | null
          created_at: string
          error: string | null
          full_text: string | null
          id: string
          priority: number
          processed_at: string | null
          progress: Json | null
          project_id: string | null
          published_at: string | null
          request_steer: string | null
          retries: number
          skip_reason: string | null
          source: string
          started_at: string | null
          status: string
          title: string | null
          url: string
        }
        Insert: {
          checked_scope?: string | null
          created_at?: string
          error?: string | null
          full_text?: string | null
          id?: string
          priority?: number
          processed_at?: string | null
          progress?: Json | null
          project_id?: string | null
          published_at?: string | null
          request_steer?: string | null
          retries?: number
          skip_reason?: string | null
          source: string
          started_at?: string | null
          status?: string
          title?: string | null
          url: string
        }
        Update: {
          checked_scope?: string | null
          created_at?: string
          error?: string | null
          full_text?: string | null
          id?: string
          priority?: number
          processed_at?: string | null
          progress?: Json | null
          project_id?: string | null
          published_at?: string | null
          request_steer?: string | null
          retries?: number
          skip_reason?: string | null
          source?: string
          started_at?: string | null
          status?: string
          title?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "everything_follow_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "everything_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "everything_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_link_visits: {
        Row: {
          feed_url: string | null
          id: string
          item_id: string | null
          reader_hash: string | null
          url: string
          visited_at: string
        }
        Insert: {
          feed_url?: string | null
          id?: string
          item_id?: string | null
          reader_hash?: string | null
          url: string
          visited_at?: string
        }
        Update: {
          feed_url?: string | null
          id?: string
          item_id?: string | null
          reader_hash?: string | null
          url?: string
          visited_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_link_visits_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "everything_items"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_note_not_needed: {
        Row: {
          author_id: string | null
          author_name: string | null
          body: string
          claim_id: string
          created_at: string
          helpful_count: number
          id: string
          not_helpful_count: number
          somewhat_helpful_count: number
          status: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          body: string
          claim_id: string
          created_at?: string
          helpful_count?: number
          id?: string
          not_helpful_count?: number
          somewhat_helpful_count?: number
          status?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          body?: string
          claim_id?: string
          created_at?: string
          helpful_count?: number
          id?: string
          not_helpful_count?: number
          somewhat_helpful_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_note_not_needed_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "everything_claims"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_note_not_needed_votes: {
        Row: {
          created_at: string
          entry_id: string
          vote: number
          voter_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          vote: number
          voter_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          vote?: number
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_note_not_needed_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "everything_note_not_needed"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_note_requests: {
        Row: {
          client_token: string | null
          created_at: string
          feed_url: string | null
          id: string
          item_id: string | null
          page_text: string | null
          page_title: string
          page_url: string
          passage_question_id: string | null
          selection: string | null
          status: string
          status_reason: string | null
          steer: string | null
          user_id: string | null
        }
        Insert: {
          client_token?: string | null
          created_at?: string
          feed_url?: string | null
          id?: string
          item_id?: string | null
          page_text?: string | null
          page_title?: string
          page_url: string
          passage_question_id?: string | null
          selection?: string | null
          status?: string
          status_reason?: string | null
          steer?: string | null
          user_id?: string | null
        }
        Update: {
          client_token?: string | null
          created_at?: string
          feed_url?: string | null
          id?: string
          item_id?: string | null
          page_text?: string | null
          page_title?: string
          page_url?: string
          passage_question_id?: string | null
          selection?: string | null
          status?: string
          status_reason?: string | null
          steer?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "everything_note_requests_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "everything_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "everything_note_requests_passage_question_id_fkey"
            columns: ["passage_question_id"]
            isOneToOne: true
            referencedRelation: "everything_passage_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_note_sources: {
        Row: {
          created_at: string
          explanation: string | null
          id: string
          note_id: string
          quote: string | null
          sort_order: number
          url: string
        }
        Insert: {
          created_at?: string
          explanation?: string | null
          id?: string
          note_id: string
          quote?: string | null
          sort_order?: number
          url: string
        }
        Update: {
          created_at?: string
          explanation?: string | null
          id?: string
          note_id?: string
          quote?: string | null
          sort_order?: number
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_note_sources_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "everything_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_notes: {
        Row: {
          author_id: string | null
          author_name: string | null
          claim_id: string
          created_at: string
          helpful_count: number
          id: string
          improved_from_note_id: string | null
          not_helpful_count: number
          note: string
          somewhat_helpful_count: number
          status: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          claim_id: string
          created_at?: string
          helpful_count?: number
          id?: string
          improved_from_note_id?: string | null
          not_helpful_count?: number
          note: string
          somewhat_helpful_count?: number
          status?: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          claim_id?: string
          created_at?: string
          helpful_count?: number
          id?: string
          improved_from_note_id?: string | null
          not_helpful_count?: number
          note?: string
          somewhat_helpful_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_notes_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "everything_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "everything_notes_improved_from_note_id_fkey"
            columns: ["improved_from_note_id"]
            isOneToOne: false
            referencedRelation: "everything_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_passage_highlight_votes: {
        Row: {
          created_at: string
          entry_id: string
          vote: number
          voter_id: string
        }
        Insert: {
          created_at?: string
          entry_id: string
          vote: number
          voter_id: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          vote?: number
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_passage_highlight_votes_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "everything_passage_highlights"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_passage_highlights: {
        Row: {
          author_id: string | null
          author_name: string | null
          context_paragraph: string
          created_at: string
          helpful_count: number
          id: string
          item_id: string
          kind: string
          not_helpful_count: number
          probability: number | null
          quote: string
          somewhat_helpful_count: number
          statement: string
        }
        Insert: {
          author_id?: string | null
          author_name?: string | null
          context_paragraph: string
          created_at?: string
          helpful_count?: number
          id?: string
          item_id: string
          kind: string
          not_helpful_count?: number
          probability?: number | null
          quote: string
          somewhat_helpful_count?: number
          statement: string
        }
        Update: {
          author_id?: string | null
          author_name?: string | null
          context_paragraph?: string
          created_at?: string
          helpful_count?: number
          id?: string
          item_id?: string
          kind?: string
          not_helpful_count?: number
          probability?: number | null
          quote?: string
          somewhat_helpful_count?: number
          statement?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_passage_highlights_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "everything_items"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_passage_questions: {
        Row: {
          answer: string | null
          answered_at: string | null
          author_id: string
          cost_usd: number
          created_at: string
          draft: Json | null
          error: string | null
          id: string
          item_id: string
          model: string | null
          passage: string
          question: string
          started_at: string | null
          status: string
        }
        Insert: {
          answer?: string | null
          answered_at?: string | null
          author_id: string
          cost_usd?: number
          created_at?: string
          draft?: Json | null
          error?: string | null
          id?: string
          item_id: string
          model?: string | null
          passage: string
          question: string
          started_at?: string | null
          status?: string
        }
        Update: {
          answer?: string | null
          answered_at?: string | null
          author_id?: string
          cost_usd?: number
          created_at?: string
          draft?: Json | null
          error?: string | null
          id?: string
          item_id?: string
          model?: string | null
          passage?: string
          question?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_passage_questions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "everything_items"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_pipeline_runs: {
        Row: {
          ab_test_picks: Json | null
          bot_config: Json | null
          bot_name: string | null
          claim_id: string | null
          cost: number | null
          created_at: string
          final_stage: string | null
          id: string
          item_id: string | null
          kind: string
          logs: Json | null
          outcome: string | null
          outcome_reason: string | null
          work_priority: string | null
        }
        Insert: {
          ab_test_picks?: Json | null
          bot_config?: Json | null
          bot_name?: string | null
          claim_id?: string | null
          cost?: number | null
          created_at?: string
          final_stage?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          logs?: Json | null
          outcome?: string | null
          outcome_reason?: string | null
          work_priority?: string | null
        }
        Update: {
          ab_test_picks?: Json | null
          bot_config?: Json | null
          bot_name?: string | null
          claim_id?: string | null
          cost?: number | null
          created_at?: string
          final_stage?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          logs?: Json | null
          outcome?: string | null
          outcome_reason?: string | null
          work_priority?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "everything_pipeline_runs_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "everything_claims"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "everything_pipeline_runs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "everything_items"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_projects: {
        Row: {
          avatar_refreshed_at: string | null
          avatar_url: string | null
          created_at: string
          description: string | null
          feed_url: string | null
          id: string
          name: string
          priority_until: string | null
          slug: string
          sort_order: number
          top_posts_attempted_at: string | null
          top_posts_refreshed_at: string | null
        }
        Insert: {
          avatar_refreshed_at?: string | null
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          feed_url?: string | null
          id?: string
          name: string
          priority_until?: string | null
          slug: string
          sort_order?: number
          top_posts_attempted_at?: string | null
          top_posts_refreshed_at?: string | null
        }
        Update: {
          avatar_refreshed_at?: string | null
          avatar_url?: string | null
          created_at?: string
          description?: string | null
          feed_url?: string | null
          id?: string
          name?: string
          priority_until?: string | null
          slug?: string
          sort_order?: number
          top_posts_attempted_at?: string | null
          top_posts_refreshed_at?: string | null
        }
        Relationships: []
      }
      everything_rater_prefs: {
        Row: {
          show_on_leaderboard: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          show_on_leaderboard?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          show_on_leaderboard?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      everything_slack_announcements: {
        Row: {
          channel: string
          posted_at: string
          subject_id: string
        }
        Insert: {
          channel: string
          posted_at?: string
          subject_id: string
        }
        Update: {
          channel?: string
          posted_at?: string
          subject_id?: string
        }
        Relationships: []
      }
      everything_top_posts: {
        Row: {
          feed_url: string
          id: string
          popularity: number
          published_at: string | null
          rank: number
          source: string
          title: string | null
          url: string
        }
        Insert: {
          feed_url: string
          id?: string
          popularity: number
          published_at?: string | null
          rank: number
          source: string
          title?: string | null
          url: string
        }
        Update: {
          feed_url?: string
          id?: string
          popularity?: number
          published_at?: string | null
          rank?: number
          source?: string
          title?: string | null
          url?: string
        }
        Relationships: []
      }
      everything_votes: {
        Row: {
          created_at: string
          id: string
          note_id: string
          platform: string | null
          reasoning: string | null
          updated_at: string
          vote: number
          voter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note_id: string
          platform?: string | null
          reasoning?: string | null
          updated_at?: string
          vote: number
          voter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string
          platform?: string | null
          reasoning?: string | null
          updated_at?: string
          vote?: number
          voter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "everything_votes_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "everything_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      everything_youtube_channels: {
        Row: {
          channel_id: string
          feed_url: string
          listed_at: string | null
          notified_at: string | null
          subscribed_at: string | null
          title: string
          uploads: Json
        }
        Insert: {
          channel_id: string
          feed_url: string
          listed_at?: string | null
          notified_at?: string | null
          subscribed_at?: string | null
          title: string
          uploads?: Json
        }
        Update: {
          channel_id?: string
          feed_url?: string
          listed_at?: string | null
          notified_at?: string | null
          subscribed_at?: string | null
          title?: string
          uploads?: Json
        }
        Relationships: []
      }
      fact_check_usage: {
        Row: {
          count: number
          day: string
          key: string
        }
        Insert: {
          count?: number
          day: string
          key: string
        }
        Update: {
          count?: number
          day?: string
          key?: string
        }
        Relationships: []
      }
      feed_tweets: {
        Row: {
          author_description: string | null
          author_followers: number | null
          author_handle: string | null
          author_id: string | null
          author_name: string | null
          author_tweet_count: number | null
          bookmarks: number | null
          first_seen_at: string
          first_seen_feed_size: string | null
          first_seen_impressions: number | null
          has_photo: boolean | null
          has_video: boolean | null
          impressions: number | null
          last_seen_at: string
          likes: number | null
          media: Json | null
          media_count: number | null
          posted_at: string | null
          quotes: number | null
          raw_tweet: Json | null
          referenced_tweet_data: Json | null
          referenced_tweets: Json | null
          replies: number | null
          retweets: number | null
          text: string | null
          tweet_id: string
          video_duration_ms: number | null
        }
        Insert: {
          author_description?: string | null
          author_followers?: number | null
          author_handle?: string | null
          author_id?: string | null
          author_name?: string | null
          author_tweet_count?: number | null
          bookmarks?: number | null
          first_seen_at?: string
          first_seen_feed_size?: string | null
          first_seen_impressions?: number | null
          has_photo?: boolean | null
          has_video?: boolean | null
          impressions?: number | null
          last_seen_at?: string
          likes?: number | null
          media?: Json | null
          media_count?: number | null
          posted_at?: string | null
          quotes?: number | null
          raw_tweet?: Json | null
          referenced_tweet_data?: Json | null
          referenced_tweets?: Json | null
          replies?: number | null
          retweets?: number | null
          text?: string | null
          tweet_id: string
          video_duration_ms?: number | null
        }
        Update: {
          author_description?: string | null
          author_followers?: number | null
          author_handle?: string | null
          author_id?: string | null
          author_name?: string | null
          author_tweet_count?: number | null
          bookmarks?: number | null
          first_seen_at?: string
          first_seen_feed_size?: string | null
          first_seen_impressions?: number | null
          has_photo?: boolean | null
          has_video?: boolean | null
          impressions?: number | null
          last_seen_at?: string
          likes?: number | null
          media?: Json | null
          media_count?: number | null
          posted_at?: string | null
          quotes?: number | null
          raw_tweet?: Json | null
          referenced_tweet_data?: Json | null
          referenced_tweets?: Json | null
          replies?: number | null
          retweets?: number | null
          text?: string | null
          tweet_id?: string
          video_duration_ms?: number | null
        }
        Relationships: []
      }
      misinfo_monitoring_sightings: {
        Row: {
          author_name: string | null
          evaluated_at: string | null
          feed_size: string
          first_seen_at: string
          id: number
          impression_count: number | null
          needs_note: boolean | null
          processed_at: string | null
          processed_run_id: string | null
          selection_reason: string | null
          topic_id: string
          tweet_id: string
        }
        Insert: {
          author_name?: string | null
          evaluated_at?: string | null
          feed_size: string
          first_seen_at?: string
          id?: never
          impression_count?: number | null
          needs_note?: boolean | null
          processed_at?: string | null
          processed_run_id?: string | null
          selection_reason?: string | null
          topic_id: string
          tweet_id: string
        }
        Update: {
          author_name?: string | null
          evaluated_at?: string | null
          feed_size?: string
          first_seen_at?: string
          id?: never
          impression_count?: number | null
          needs_note?: boolean | null
          processed_at?: string | null
          processed_run_id?: string | null
          selection_reason?: string | null
          topic_id?: string
          tweet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "misinfo_monitoring_sightings_processed_run_id_fkey"
            columns: ["processed_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      note_rating_tag_counts: {
        Row: {
          count: number
          id: string
          last_updated_at: string
          model_name: string
          note_id: string
          rater_bucket: string
          tag_name: string
        }
        Insert: {
          count: number
          id?: string
          last_updated_at?: string
          model_name: string
          note_id: string
          rater_bucket: string
          tag_name: string
        }
        Update: {
          count?: number
          id?: string
          last_updated_at?: string
          model_name?: string
          note_id?: string
          rater_bucket?: string
          tag_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_rating_tag_counts_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      note_ratings_from_public_dump: {
        Row: {
          dump_date: string
          helpful_count: number
          helpful_tag_counts: Json
          last_synced_at: string
          not_helpful_count: number
          not_helpful_tag_counts: Json
          note_id: string
          somewhat_helpful_count: number
        }
        Insert: {
          dump_date: string
          helpful_count?: number
          helpful_tag_counts?: Json
          last_synced_at?: string
          not_helpful_count?: number
          not_helpful_tag_counts?: Json
          note_id: string
          somewhat_helpful_count?: number
        }
        Update: {
          dump_date?: string
          helpful_count?: number
          helpful_tag_counts?: Json
          last_synced_at?: string
          not_helpful_count?: number
          not_helpful_tag_counts?: Json
          note_id?: string
          somewhat_helpful_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_ratings_from_public_dump_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      note_submission_claims: {
        Row: {
          claimed_at: string
          id: string
          is_probe: boolean
          lane: string
          note_id: string | null
          reason: string | null
          resolved_at: string | null
          status: string
          tweet_id: string
        }
        Insert: {
          claimed_at?: string
          id?: string
          is_probe?: boolean
          lane: string
          note_id?: string | null
          reason?: string | null
          resolved_at?: string | null
          status?: string
          tweet_id: string
        }
        Update: {
          claimed_at?: string
          id?: string
          is_probe?: boolean
          lane?: string
          note_id?: string | null
          reason?: string | null
          resolved_at?: string | null
          status?: string
          tweet_id?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          cn_status: string | null
          data_tier: string | null
          first_seen_at: string
          first_snapshot_at: string | null
          helpful_count: number | null
          id: string
          last_reconciled_at: string | null
          not_helpful_count: number | null
          note_id: string
          note_text: string | null
          notewriter_id: string | null
          rating_count: number | null
          scrape_misses: number
          somewhat_helpful_count: number
          source_url: string | null
          submitted_at: string | null
          tweet_id: string
          view_count: number | null
        }
        Insert: {
          cn_status?: string | null
          data_tier?: string | null
          first_seen_at?: string
          first_snapshot_at?: string | null
          helpful_count?: number | null
          id?: string
          last_reconciled_at?: string | null
          not_helpful_count?: number | null
          note_id: string
          note_text?: string | null
          notewriter_id?: string | null
          rating_count?: number | null
          scrape_misses?: number
          somewhat_helpful_count?: number
          source_url?: string | null
          submitted_at?: string | null
          tweet_id: string
          view_count?: number | null
        }
        Update: {
          cn_status?: string | null
          data_tier?: string | null
          first_seen_at?: string
          first_snapshot_at?: string | null
          helpful_count?: number | null
          id?: string
          last_reconciled_at?: string | null
          not_helpful_count?: number | null
          note_id?: string
          note_text?: string | null
          notewriter_id?: string | null
          rating_count?: number | null
          scrape_misses?: number
          somewhat_helpful_count?: number
          source_url?: string | null
          submitted_at?: string | null
          tweet_id?: string
          view_count?: number | null
        }
        Relationships: []
      }
      notewriters: {
        Row: {
          created_at: string | null
          credentials_ref: string | null
          display_name: string | null
          handle: string
          id: string
          is_active: boolean | null
        }
        Insert: {
          created_at?: string | null
          credentials_ref?: string | null
          display_name?: string | null
          handle: string
          id?: string
          is_active?: boolean | null
        }
        Update: {
          created_at?: string | null
          credentials_ref?: string | null
          display_name?: string | null
          handle?: string
          id?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
      pangram_monitoring_sightings: {
        Row: {
          author_name: string | null
          checked_at: string
          feed_size: string | null
          fraction_ai: number | null
          impression_count: number | null
          is_ai: boolean
          prediction_short: string
          processed_run_id: string | null
          tweet_id: string
        }
        Insert: {
          author_name?: string | null
          checked_at?: string
          feed_size?: string | null
          fraction_ai?: number | null
          impression_count?: number | null
          is_ai: boolean
          prediction_short: string
          processed_run_id?: string | null
          tweet_id: string
        }
        Update: {
          author_name?: string | null
          checked_at?: string
          feed_size?: string | null
          fraction_ai?: number | null
          impression_count?: number | null
          is_ai?: boolean
          prediction_short?: string
          processed_run_id?: string | null
          tweet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pangram_monitoring_sightings_processed_run_id_fkey"
            columns: ["processed_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          ab_test_picks: Json | null
          bot_config: Json | null
          bot_name: string | null
          check_reasoning: string | null
          commit_sha: string | null
          cost: number | null
          created_at: string
          error_message: string | null
          final_stage: string | null
          id: string
          logs: Json | null
          note_id: string | null
          note_status: string | null
          note_text: string | null
          outcome: string
          outcome_reason: string | null
          search_results: string | null
          source_url: string | null
          tweet_id: string
          warnings: string[] | null
        }
        Insert: {
          ab_test_picks?: Json | null
          bot_config?: Json | null
          bot_name?: string | null
          check_reasoning?: string | null
          commit_sha?: string | null
          cost?: number | null
          created_at?: string
          error_message?: string | null
          final_stage?: string | null
          id?: string
          logs?: Json | null
          note_id?: string | null
          note_status?: string | null
          note_text?: string | null
          outcome: string
          outcome_reason?: string | null
          search_results?: string | null
          source_url?: string | null
          tweet_id: string
          warnings?: string[] | null
        }
        Update: {
          ab_test_picks?: Json | null
          bot_config?: Json | null
          bot_name?: string | null
          check_reasoning?: string | null
          commit_sha?: string | null
          cost?: number | null
          created_at?: string
          error_message?: string | null
          final_stage?: string | null
          id?: string
          logs?: Json | null
          note_id?: string | null
          note_status?: string | null
          note_text?: string | null
          outcome?: string
          outcome_reason?: string | null
          search_results?: string | null
          source_url?: string | null
          tweet_id?: string
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      pipeline_scores: {
        Row: {
          created_at: string
          id: string
          pipeline_run_id: string
          score_label: string | null
          score_metadata: Json | null
          score_type: string
          score_value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          pipeline_run_id: string
          score_label?: string | null
          score_metadata?: Json | null
          score_type: string
          score_value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          pipeline_run_id?: string
          score_label?: string | null
          score_metadata?: Json | null
          score_type?: string
          score_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_scores_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_state: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      public_data_snapshots: {
        Row: {
          core_note_factor1: number | null
          core_note_intercept: number | null
          created_at: string
          created_at_millis: number | null
          current_status: string | null
          id: string
          is_ours: boolean
          note_id: string
          note_text: string | null
          snapshot_date: string
          tweet_id: string
        }
        Insert: {
          core_note_factor1?: number | null
          core_note_intercept?: number | null
          created_at?: string
          created_at_millis?: number | null
          current_status?: string | null
          id?: string
          is_ours?: boolean
          note_id: string
          note_text?: string | null
          snapshot_date: string
          tweet_id: string
        }
        Update: {
          core_note_factor1?: number | null
          core_note_intercept?: number | null
          created_at?: string
          created_at_millis?: number | null
          current_status?: string | null
          id?: string
          is_ours?: boolean
          note_id?: string
          note_text?: string | null
          snapshot_date?: string
          tweet_id?: string
        }
        Relationships: []
      }
      ranking_decisions: {
        Row: {
          bar: number | null
          bar_state: string | null
          cap: number | null
          cap_source: string | null
          decided_at: string
          decision: string
          eval_score: number | null
          flags: number | null
          id: number
          pipeline_run_id: string | null
          policy: string
          remaining: number | null
          scorer: string
          scores: Json
          submit_score: number
          tweet_id: string | null
          used_24h: number | null
        }
        Insert: {
          bar?: number | null
          bar_state?: string | null
          cap?: number | null
          cap_source?: string | null
          decided_at?: string
          decision: string
          eval_score?: number | null
          flags?: number | null
          id?: number
          pipeline_run_id?: string | null
          policy: string
          remaining?: number | null
          scorer: string
          scores: Json
          submit_score: number
          tweet_id?: string | null
          used_24h?: number | null
        }
        Update: {
          bar?: number | null
          bar_state?: string | null
          cap?: number | null
          cap_source?: string | null
          decided_at?: string
          decision?: string
          eval_score?: number | null
          flags?: number | null
          id?: number
          pipeline_run_id?: string | null
          policy?: string
          remaining?: number | null
          scorer?: string
          scores?: Json
          submit_score?: number
          tweet_id?: string | null
          used_24h?: number | null
        }
        Relationships: []
      }
      review_dashboard_annotations: {
        Row: {
          comment: string | null
          failure_modes: string[]
          high_value: boolean
          id: string
          seen: boolean
          source: string
          target_id: string
          updated_at: string
        }
        Insert: {
          comment?: string | null
          failure_modes?: string[]
          high_value?: boolean
          id?: string
          seen?: boolean
          source: string
          target_id: string
          updated_at?: string
        }
        Update: {
          comment?: string | null
          failure_modes?: string[]
          high_value?: boolean
          id?: string
          seen?: boolean
          source?: string
          target_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_dashboard_failure_modes: {
        Row: {
          created_at: string
          fixed: boolean
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          fixed?: boolean
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          fixed?: boolean
          id?: string
          name?: string
        }
        Relationships: []
      }
      review_dashboard_items: {
        Row: {
          bot_id: string | null
          created_at: string
          evaluation_score: number | null
          failure_reason: string | null
          ground_truth_note: string | null
          id: string
          judge_guidance: string | null
          logs: Json | null
          needs_note: string | null
          note_status: string | null
          note_text: string | null
          original_note_text: string | null
          outcome: string | null
          result: string | null
          source_verification: string | null
          tweet_text: string | null
          upload_id: string
          url: string
        }
        Insert: {
          bot_id?: string | null
          created_at?: string
          evaluation_score?: number | null
          failure_reason?: string | null
          ground_truth_note?: string | null
          id?: string
          judge_guidance?: string | null
          logs?: Json | null
          needs_note?: string | null
          note_status?: string | null
          note_text?: string | null
          original_note_text?: string | null
          outcome?: string | null
          result?: string | null
          source_verification?: string | null
          tweet_text?: string | null
          upload_id: string
          url: string
        }
        Update: {
          bot_id?: string | null
          created_at?: string
          evaluation_score?: number | null
          failure_reason?: string | null
          ground_truth_note?: string | null
          id?: string
          judge_guidance?: string | null
          logs?: Json | null
          needs_note?: string | null
          note_status?: string | null
          note_text?: string | null
          original_note_text?: string | null
          outcome?: string | null
          result?: string | null
          source_verification?: string | null
          tweet_text?: string | null
          upload_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_dashboard_items_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "review_dashboard_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      review_dashboard_uploads: {
        Row: {
          created_at: string
          id: string
          item_count: number
          name: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          item_count?: number
          name: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          item_count?: number
          name?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      scraped_notewriter_snapshots: {
        Row: {
          cn_status: string | null
          excluded: boolean | null
          id: string
          note_id: string
          note_text: string | null
          rater_tags: string[] | null
          scraped_at: string
          shown_on_x: boolean | null
          tweet_handle: string | null
          tweet_id: string | null
          tweet_text: string | null
          tweet_time: string | null
          view_count: number | null
        }
        Insert: {
          cn_status?: string | null
          excluded?: boolean | null
          id?: string
          note_id: string
          note_text?: string | null
          rater_tags?: string[] | null
          scraped_at?: string
          shown_on_x?: boolean | null
          tweet_handle?: string | null
          tweet_id?: string | null
          tweet_text?: string | null
          tweet_time?: string | null
          view_count?: number | null
        }
        Update: {
          cn_status?: string | null
          excluded?: boolean | null
          id?: string
          note_id?: string
          note_text?: string | null
          rater_tags?: string[] | null
          scraped_at?: string
          shown_on_x?: boolean | null
          tweet_handle?: string | null
          tweet_id?: string | null
          tweet_text?: string | null
          tweet_time?: string | null
          view_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "scraped_notewriter_snapshots_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["note_id"]
          },
        ]
      }
      signal_submission_queue: {
        Row: {
          queued_at: string
          tweet_id: string
        }
        Insert: {
          queued_at?: string
          tweet_id: string
        }
        Update: {
          queued_at?: string
          tweet_id?: string
        }
        Relationships: []
      }
      trending_posts: {
        Row: {
          post_id: string
          posted_at: string
          topic: string
        }
        Insert: {
          post_id: string
          posted_at?: string
          topic: string
        }
        Update: {
          post_id?: string
          posted_at?: string
          topic?: string
        }
        Relationships: []
      }
      tweets: {
        Row: {
          author_description: string | null
          author_followers: number | null
          author_handle: string | null
          author_id: string | null
          author_name: string | null
          author_tweet_count: number | null
          bookmarks: number | null
          first_seen_at: string
          has_photo: boolean | null
          has_video: boolean | null
          impressions: number | null
          last_updated_at: string
          likes: number | null
          media: Json | null
          media_count: number | null
          posted_at: string | null
          quotes: number | null
          raw_tweet: Json | null
          referenced_tweet_data: Json | null
          referenced_tweets: Json | null
          replies: number | null
          retweets: number | null
          text: string | null
          tweet_id: string
          video_duration_ms: number | null
        }
        Insert: {
          author_description?: string | null
          author_followers?: number | null
          author_handle?: string | null
          author_id?: string | null
          author_name?: string | null
          author_tweet_count?: number | null
          bookmarks?: number | null
          first_seen_at?: string
          has_photo?: boolean | null
          has_video?: boolean | null
          impressions?: number | null
          last_updated_at?: string
          likes?: number | null
          media?: Json | null
          media_count?: number | null
          posted_at?: string | null
          quotes?: number | null
          raw_tweet?: Json | null
          referenced_tweet_data?: Json | null
          referenced_tweets?: Json | null
          replies?: number | null
          retweets?: number | null
          text?: string | null
          tweet_id: string
          video_duration_ms?: number | null
        }
        Update: {
          author_description?: string | null
          author_followers?: number | null
          author_handle?: string | null
          author_id?: string | null
          author_name?: string | null
          author_tweet_count?: number | null
          bookmarks?: number | null
          first_seen_at?: string
          has_photo?: boolean | null
          has_video?: boolean | null
          impressions?: number | null
          last_updated_at?: string
          likes?: number | null
          media?: Json | null
          media_count?: number | null
          posted_at?: string | null
          quotes?: number | null
          raw_tweet?: Json | null
          referenced_tweet_data?: Json | null
          referenced_tweets?: Json | null
          replies?: number | null
          retweets?: number | null
          text?: string | null
          tweet_id?: string
          video_duration_ms?: number | null
        }
        Relationships: []
      }
      writing_limit_probe_readings: {
        Row: {
          binding: string
          branch: string
          dn_30: number
          hours_since_last_403: number | null
          hr_100: number
          hr_14d: number
          hr_l: number
          hr_r: number
          id: number
          last_403_at: string | null
          last_403_value: number | null
          measured_at: string
          nh_10: number
          nh_5: number
          notes_total: number
          predicted_limit: number
          status_counts: Json
          stored_limit: number | null
          submitted_24h: number | null
          volume_term: number
          wl_l: number | null
        }
        Insert: {
          binding: string
          branch: string
          dn_30: number
          hours_since_last_403?: number | null
          hr_100: number
          hr_14d: number
          hr_l: number
          hr_r: number
          id?: number
          last_403_at?: string | null
          last_403_value?: number | null
          measured_at?: string
          nh_10: number
          nh_5: number
          notes_total: number
          predicted_limit: number
          status_counts: Json
          stored_limit?: number | null
          submitted_24h?: number | null
          volume_term: number
          wl_l?: number | null
        }
        Update: {
          binding?: string
          branch?: string
          dn_30?: number
          hours_since_last_403?: number | null
          hr_100?: number
          hr_14d?: number
          hr_l?: number
          hr_r?: number
          id?: number
          last_403_at?: string | null
          last_403_value?: number | null
          measured_at?: string
          nh_10?: number
          nh_5?: number
          notes_total?: number
          predicted_limit?: number
          status_counts?: Json
          stored_limit?: number | null
          submitted_24h?: number | null
          volume_term?: number
          wl_l?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      everything_follow_requests: {
        Row: {
          created_at: string | null
          feed_type: string | null
          feed_url: string | null
          id: string | null
          status: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          feed_type?: never
          feed_url?: string | null
          id?: string | null
          status?: never
          title?: string | null
          user_id?: never
        }
        Update: {
          created_at?: string | null
          feed_type?: never
          feed_url?: string | null
          id?: string | null
          status?: never
          title?: string | null
          user_id?: never
        }
        Relationships: []
      }
      everything_followed_feeds: {
        Row: {
          feed_url: string | null
        }
        Insert: {
          feed_url?: string | null
        }
        Update: {
          feed_url?: string | null
        }
        Relationships: []
      }
      review_dashboard_base_m: {
        Row: {
          ab_test_picks: Json | null
          bot_name: string | null
          failure_type: string | null
          id: string | null
          is_draft: boolean | null
          item_date: string | null
          item_kind: string | null
          outcome: string | null
          outcome_reason: string | null
          pipeline_run_id: string | null
          source_id: string | null
          topic: string | null
          tweet_id: string | null
        }
        Relationships: []
      }
      review_dashboard_items_v: {
        Row: {
          ab_test_picks: Json | null
          ann_id: string | null
          ann_updated_at: string | null
          bot_name: string | null
          comment: string | null
          failure_modes: string[] | null
          failure_type: string | null
          high_value: boolean | null
          id: string | null
          is_draft: boolean | null
          item_date: string | null
          item_kind: string | null
          outcome: string | null
          outcome_reason: string | null
          pipeline_run_id: string | null
          seen: boolean | null
          source_id: string | null
          topic: string | null
          tweet_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      cancel_signal_submission: {
        Args: { p_tweet_id: string }
        Returns: undefined
      }
      claim_note_submission: {
        Args: { p_lane?: string; p_tweet_id: string }
        Returns: Json
      }
      everything_cost_since: { Args: { since: string }; Returns: number }
      everything_creator_attention: {
        Args: { min_pages: number; since: string }
        Returns: {
          feed_url: string
          pages: number
          readers: number
          visits: number
        }[]
      }
      everything_creator_project: {
        Args: { creator_feed_url: string }
        Returns: string
      }
      everything_daily_activity: {
        Args: { window_days?: number }
        Returns: {
          day: string
          event: string
          events: number
          platform: string
        }[]
      }
      everything_dispatch_feed_run_if_due: { Args: never; Returns: boolean }
      everything_extend_priority: {
        Args: { granted: string; target_feed_url: string }
        Returns: boolean
      }
      everything_feed_pacing: {
        Args: {
          fallback_hours: number
          min_posts: number
          not_before: string
          window_hours: number
        }
        Returns: {
          db_now: string
          last_feed_started_at: string
          mean_post_cost_usd: number
          sample_hours: number
          sample_posts: number
          spent_today_usd: number
        }[]
      }
      everything_feed_slug: { Args: { feed_url: string }; Returns: string }
      everything_funnel: {
        Args: { window_days?: number }
        Returns: {
          platform: string
          stage: string
          users: number
        }[]
      }
      everything_leaderboard: {
        Args: never
        Returns: {
          name: string
          rating_count: number
        }[]
      }
      everything_metric_series: {
        Args: { granularity?: string }
        Returns: {
          active_devices: number
          bucket: string
          note_viewers: Json
          notes_seen: number
          notes_written: number
          voters: Json
          votes: number
          writers: Json
        }[]
      }
      everything_pipeline_daily: {
        Args: never
        Returns: {
          ai_note_tallies: Json
          claims_checked: number
          claims_extracted: number
          day: string
          items_processed: number
        }[]
      }
      everything_projects_by_votes: {
        Args: never
        Returns: {
          avatar_url: string
          feed_url: string
          id: string
          name: string
          note_count: number
          slug: string
          vote_score: number
        }[]
      }
      everything_reader_cost_since: { Args: { since: string }; Returns: number }
      everything_recent_posts: {
        Args: { max_posts: number; min_pages: number; window_days: number }
        Returns: {
          author_pages: number
          author_readers: number
          checked_scope: string
          claims_checked: number
          claims_extracted: number
          id: string
          notes: number
          processed_at: string
          project: string
          published_at: string
          title: string
          url: string
        }[]
      }
      everything_request_status: {
        Args: { token: string }
        Returns: {
          item_id: string
          status: string
          status_reason: string
        }[]
      }
      everything_set_feed_alarm: {
        Args: { next_at: string; reason: string }
        Returns: undefined
      }
      everything_spend_by_hour: {
        Args: { window_days?: number }
        Returns: {
          cost: number
          hour: string
          runs: number
        }[]
      }
      everything_visit_page: { Args: { url: string }; Returns: string }
      fact_check_consume: {
        Args: { p_key: string; p_limit: number }
        Returns: boolean
      }
      finish_note_submission_claim: {
        Args: {
          p_claim_id: string
          p_note_id?: string
          p_reason?: string
          p_status: string
        }
        Returns: undefined
      }
      get_note_submission_capacity: { Args: never; Returns: Json }
      queue_signal_submission: { Args: { p_tweet_id: string }; Returns: Json }
      review_dashboard_counts: { Args: { p_filters?: Json }; Returns: Json }
      review_dashboard_page: {
        Args: {
          p_cursor_date?: string
          p_cursor_id?: string
          p_filters?: Json
          p_page_size?: number
        }
        Returns: Json
      }
      review_dashboard_posting_notes: { Args: never; Returns: Json }
      review_dashboard_runs_page: {
        Args: {
          p_cursor_date?: string
          p_cursor_id?: string
          p_filters?: Json
          p_page_size?: number
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
