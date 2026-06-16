/**
 * Shared builder for OpenAI-style strict `json_schema` response formats.
 *
 * Every JSON pipeline stage wraps its schema in the same
 * `{ type: "json_schema", json_schema: { name, strict: true, schema } }`
 * envelope; this centralizes that boilerplate so each prompt file declares
 * only the part that differs — the schema name and its object schema.
 */

export interface JsonObjectSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export function jsonSchemaResponseFormat(name: string, schema: JsonObjectSchema) {
  return {
    type: "json_schema" as const,
    json_schema: { name, strict: true as const, schema },
  };
}
