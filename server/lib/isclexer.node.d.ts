
/**
 * A language supported by the isclexer module.
 */
export interface Language {
    /** The language's text-based identifier. */
    moniker: string;
    /** The language's numerical index. */
    index: number;
}

/**
 * A semantic token with source text.
 */
export interface TextSemanticToken {
    /** The numerical index of the language. */
    l: number;
    /** The index of the attribute within the array returned by `GetLanguageAttributes()`. */
    s: number;
    /** The source of the token. */
    t: string;
}

/**
 * A semantic token with position and length within the source text.
 */
export interface PositionSemanticToken {
    /** The numerical index of the language. */
    l: number;
    /** The index of the attribute within the array returned by `GetLanguageAttributes()`. */
    s: number;
    /** The starting position of this token in the source line. */
    p: number;
    /** The length of this token's source. */
    c: number;
    /** A short description of the syntax error. */
    e?: string;
}

/**
 * Get an array of all languages supported by this module.
 */
export function GetLanguages(): Language[];

/**
 * Get an array of all attributes for the given language.
 * 
 * @param moniker A language moniker returned from `GetLanguages()`.
 */
export function GetLanguageAttributes(moniker: string): string[];

/**
 * Compute the semantic tokens for `source` using the lexer for language `moniker`.
 * 
 * @param source The source code to tokenize.
 * @param moniker The language moniker of `source`. Must be a language moniker returned from `GetLanguages()`.
 * @param tokentext Return the corresponding source text for each token. Defaults to `false`. Note that setting this to `true` decreases performance.
 * @param flags Lexer flags. A positive integer or `0`. Defaults to `0`.
 * @param omitwhitespace Omit white space tokens. Defaults to `true`.
 * @returns An array of arrays of semantic tokens. The outer array corresponds to the lines of `source` and the inner array corresponds to tokens on that line.
 */
export function Tokenize(source: string, moniker: string, tokentext: false, flags?: number, omitwhitespace?: boolean): PositionSemanticToken[][];
export function Tokenize(source: string, moniker: string, tokentext: true, flags?: number, omitwhitespace?: boolean): TextSemanticToken[][];
export function Tokenize(source: string, moniker: string, tokentext?: boolean, flags?: number, omitwhitespace?: boolean): PositionSemanticToken[][];

/**
 * Print help text.
 */
export function Help(): void;
