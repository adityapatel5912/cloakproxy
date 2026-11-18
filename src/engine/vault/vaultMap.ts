import type {
  ClassifiedBy,
  DetectionKind,
  SourceSpan,
  SymbolClass,
  Vault,
  VaultEntry,
  VaultPrefix,
} from "../types.js";

/**
 * Stage 1C — in-memory bidirectional vault.
 * Deterministic minting, collision-safe against BOTH internal keys and the raw
 * source text. Originals never leave this object; only vault keys reach cloud.
 */

function prefixFor(category: DetectionKind, original: string): VaultPrefix {
  if (category === "IDENTIFIER") {
    // AST string literals include their quote character in the raw slice.
    return /^["'`]/.test(original) ? "str_" : "fn_";
  }
  if (category === "TOKEN_WINDOW") return "ident_";
  return "str_"; // regex / entropy / env / url / email / jwt hits
}

export class VaultMap implements Vault {
  private readonly _forward = new Map<string, string>();
  private readonly _reverse = new Map<string, VaultEntry>();
  private readonly counters: Record<VaultPrefix, number> = { fn_: 1, str_: 1, ident_: 1 };

  constructor(private readonly raw: string) {
    // Bump counters beyond any vault-key-like token already present in the raw
    // source, so a rehydration pass can never rewrite innocent source text.
    for (const prefix of ["fn_", "str_", "ident_"] as VaultPrefix[]) {
      const re = new RegExp(`${prefix}(\\d+)`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(raw)) !== null) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n >= this.counters[prefix]) {
          this.counters[prefix] = n + 1;
        }
      }
    }
  }

  forward(): ReadonlyMap<string, string> {
    return this._forward;
  }

  reverse(): ReadonlyMap<string, VaultEntry> {
    return this._reverse;
  }

  get size(): number {
    return this._forward.size;
  }

  mint(
    original: string,
    category: DetectionKind,
    classification: SymbolClass,
    planEntryId: string,
    confidence: number,
    classifiedBy: ClassifiedBy,
    occurrences: ReadonlyArray<SourceSpan>,
    safePreview: string,
  ): VaultEntry {
    const existingKey = this._forward.get(original);
    if (existingKey) {
      throw new Error(`VaultMap: original "${safePreview}" already minted as ${existingKey}`);
    }
    const prefix = prefixFor(category, original);
    let candidate = `${prefix}${this.counters[prefix]}`;
    while (this._reverse.has(candidate)) {
      this.counters[prefix] += 1;
      candidate = `${prefix}${this.counters[prefix]}`;
    }
    this.counters[prefix] += 1;

    const entry: VaultEntry = {
      vaultKey: candidate,
      planEntryId,
      originalToken: original,
      category,
      classification,
      confidence,
      classifiedBy,
      occurrences,
      safePreview,
    };
    this._forward.set(original, candidate);
    this._reverse.set(candidate, entry);
    return entry;
  }

  rehydrateToken(vaultKey: string): string | undefined {
    return this._reverse.get(vaultKey)?.originalToken;
  }

  secretOriginals(): string[] {
    return [...this._reverse.values()]
      .filter((e) => e.classification !== "SAFE")
      .map((e) => e.originalToken);
  }

  keys(): string[] {
    return [...this._reverse.keys()];
  }
}
