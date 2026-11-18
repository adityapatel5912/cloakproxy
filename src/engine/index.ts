/** Public engine API — pure deterministic modules only. */
export * from "./types.js";
export * from "./util.js";
export * from "./policy.js";
export { scanRegex, nextMatchId, resetMatchIds } from "./detect/regexScanner.js";
export { scanEntropy } from "./detect/entropyScanner.js";
export { scanEnvAssignments, scanJsonSecrets, scanTokenWindows } from "./detect/tokenWindow.js";
export { mergeSpans, tagLanguage } from "./detect/mergeSpans.js";
export { tryParse, detectLanguage } from "./ast/astGuard.js";
export type { TryParseResult, ParseOk, ParseFail } from "./ast/astGuard.js";
export { extractAstMatches } from "./ast/astExtractor.js";
export { buildClassifierPayloads } from "./classify/classifierTypes.js";
export type { ClassifierPayloadBundle } from "./classify/classifierTypes.js";
export { reconcileVerdicts } from "./classify/verdictReconciler.js";
export type { ReconcileResult } from "./classify/verdictReconciler.js";
export { VaultMap } from "./vault/vaultMap.js";
export { swapRightToLeft } from "./vault/swapRightToLeft.js";
export { rehydrate } from "./vault/rehydrate.js";
export { assertNoLeaks } from "./vault/preflightAssert.js";
export {
  extract,
  buildPayloads,
  planVault,
  sanitize,
  syntaxIntegrity,
} from "./pipeline.js";
export { scoreRedTeam } from "./redTeamScore.js";
export { SAMPLES, SAMPLES as SAMPLE_PAYLOADS, sampleById } from "./samples.js";
export type { SamplePayload } from "./samples.js";
