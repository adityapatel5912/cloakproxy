/**
 * Structured-output schemas for the hybrid calls.
 * Uses Firebase AI Logic's Schema builders from `firebase/ai` (v13+).
 * No deprecated @firebase/vertexai imports anywhere in this codebase.
 */
import { Schema } from "firebase/ai";

export const IdentifierClassificationSchema = Schema.object({
  properties: {
    classifications: Schema.array({
      minItems: 0,
      items: Schema.object({
        properties: {
          identifier: Schema.string(),
          symbolClass: Schema.string({ enum: ["SECRET", "PROPRIETARY_LOGIC", "SAFE"] }),
          confidence: Schema.number({ minimum: 0, maximum: 1 }),
          rationaleCode: Schema.string({
            enum: ["NAMING_PATTERN", "ASSIGNMENT_CONTEXT", "GENERIC", "BUSINESS_TERM"],
          }),
        },
        required: ["identifier", "symbolClass", "confidence", "rationaleCode"],
      }),
    }),
  },
  required: ["classifications"],
});

export const RedTeamProbeSchema = Schema.object({
  properties: {
    attackName: Schema.string(),
    guess: Schema.string(),
    confidence: Schema.number({ minimum: 0, maximum: 1 }),
  },
  required: ["attackName", "guess", "confidence"],
});

export const LiteTextSchema = Schema.object({
  properties: {
    text: Schema.string(),
  },
  required: ["text"],
});
