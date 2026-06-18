/**
 * Prompt — source verifier claim extraction (claim-based flow, call 1).
 *
 * Breaks a proposed note into its distinct atomic claims. See extractClaims in
 * src/pipeline/verify/sourceVerifier.ts.
 */

import { jsonSchemaResponseFormat } from "../responseFormat";

export const CLAIM_EXTRACTION_SYSTEM_PROMPT = `Extract the distinct atomic claims made.

Output JSON: { "claims": string[] }`;

export const CLAIM_EXTRACTION_RESPONSE_FORMAT = jsonSchemaResponseFormat("note_claims", {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: { type: "string" },
      description: "The distinct factual claims asserted by the note, each a self-contained verifiable statement.",
    },
  },
  required: ["claims"],
  additionalProperties: false,
});
