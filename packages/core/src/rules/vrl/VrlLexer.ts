import type { SourceSpan } from "../Rule.js";

export type VrlTokenKind = "identifier" | "number" | "string" | "keyword" | "operator" | "bang" | "leftParen" | "rightParen" | "newline" | "eof";

export interface VrlToken {
  readonly kind: VrlTokenKind;
  readonly text: string;
  readonly span: SourceSpan;
}

const keywords = new Set(["rule", "description", "when", "score", "severity", "recommendation", "evidence", "category", "strength", "correlationGroup", "and", "or", "contains", "true", "false"]);

export class VrlLexer {
  lex(source: string): VrlToken[] {
    const tokens: VrlToken[] = [];
    let offset = 0;
    let line = 1;
    let column = 1;
    const emit = (kind: VrlTokenKind, text: string, startLine: number, startColumn: number) => tokens.push({ kind, text, span: { line: startLine, column: startColumn, length: text.length } });
    const advance = () => {
      const character = source[offset++]!;
      if (character === "\n") { line += 1; column = 1; } else column += 1;
      return character;
    };
    while (offset < source.length) {
      const character = source[offset]!;
      if (character === " " || character === "\t" || character === "\r") { advance(); continue; }
      const startLine = line;
      const startColumn = column;
      if (character === "\n") { advance(); emit("newline", "\n", startLine, startColumn); continue; }
      if (character === "#") { while (offset < source.length && source[offset] !== "\n") advance(); continue; }
      if (character === '"') {
        advance(); let text = "";
        while (offset < source.length && source[offset] !== '"') {
          const next = advance();
          text += next === "\\" && offset < source.length ? advance() : next;
        }
        if (source[offset] !== '"') throw new SyntaxError(`Unterminated string at ${startLine}:${startColumn}`);
        advance(); emit("string", text, startLine, startColumn); continue;
      }
      if (/[0-9]/.test(character) || (character === "-" && /[0-9]/.test(source[offset + 1] ?? ""))) {
        let text = character === "-" ? advance() : "";
        while (offset < source.length && /[0-9.]/.test(source[offset]!)) text += advance();
        if (!Number.isFinite(Number(text))) throw new SyntaxError(`Invalid number at ${startLine}:${startColumn}`);
        emit("number", text, startLine, startColumn); continue;
      }
      if (/[A-Za-z_]/.test(character)) {
        let text = "";
        while (offset < source.length && /[A-Za-z0-9_.-]/.test(source[offset]!)) text += advance();
        emit(keywords.has(text) ? "keyword" : "identifier", text, startLine, startColumn); continue;
      }
      if (character === "!") {
        advance();
        if (source[offset] === "=") { advance(); emit("operator", "!=", startLine, startColumn); }
        else emit("bang", "!", startLine, startColumn);
        continue;
      }
      if ("<>=".includes(character)) {
        let text = advance();
        if (source[offset] === "=") text += advance();
        if (!["==", "!=", ">", ">=", "<", "<="].includes(text)) throw new SyntaxError(`Invalid operator at ${startLine}:${startColumn}`);
        emit("operator", text, startLine, startColumn); continue;
      }
      if (character === "(") { advance(); emit("leftParen", "(", startLine, startColumn); continue; }
      if (character === ")") { advance(); emit("rightParen", ")", startLine, startColumn); continue; }
      throw new SyntaxError(`Unexpected character '${character}' at ${startLine}:${startColumn}`);
    }
    tokens.push({ kind: "eof", text: "", span: { line, column, length: 0 } });
    return tokens;
  }
}