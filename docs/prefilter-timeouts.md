# Prefilter deadlines

The X tweet checker uses two cheap gates before the full research and writing
pipeline. Both now have budgets that include request-body reading, provider
retries, JSON repair and retry backoff.

| Gate | Budget | When it cannot finish |
|---|---|---|
| Blocked topics | DeepSeek: 30 seconds; Gemini Flash fallback: 20 seconds | Try the fallback after an error, invalid verdict or timeout. If neither returns a valid verdict, fail the post's check. Never assume it clears the excluded topics. |
| Note needed | 60 seconds for all steps combined | Cancel outstanding work and pass the post to the full bot for research. |

The note-needed budget includes satire detection, query writing, Serper searches,
research analysis and the note-needed judge. A timely negative verdict still
rejects the post. Other errors still surface normally. Passing this gate only
authorizes further research: source verification, writer abstention, evaluation,
materiality and submission limits still decide whether a note can be posted.

The timeout aborts the underlying HTTP request and stops subsequent attempts and
searches. The cancellation scope belongs to one gate on one post; it does not
cancel other posts or the full bot after fail-open. The bounded Gemini fallback
uses OpenRouter because the native free-key adapter does not yet support this
cancellation scope.

## Observability and tradeoff

`note_prefilter_steps.timeout` records the budget, stalled stage and `fail_open`
action. `note_prefilter_steps.elapsedMs` records elapsed time. Completed step logs
and costs survive both timeouts and errors, and fail-open adds a pipeline warning.
`topic_filter.attempts` records each model, budget, duration and response/error;
`topic_filter.fallbackReason` records why Gemini was needed.

During a slowdown, more posts can reach the expensive research pipeline. Watch
fail-open frequency and spend alongside throughput. These are local deadlines:
they release our HTTP connections and checking-service work, but do not guarantee
that an upstream provider cancels generation or charges nothing for an aborted
call.

The constants live in `src/pipeline/prefilter/noteNeededPrefilter.ts` and
`blockedTopicFilter.ts`. They take effect when the updated claim-check service is
deployed; no database migration or new secret is required.
