import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const history = await readFile(new URL("../src/pages/History.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const assessmentStyles = await readFile(new URL("../src/assessment-ui.css", import.meta.url), "utf8");

assert.match(history, /className="history-grid history-list-header"/);
assert.match(history, /className=\{`history-grid history-row consumer-history-row/);
assert.match(history, /<div className="file-cell"><span className="history-file-name"><FileJson/);
assert.match(history, /className="history-file-path" title=\{item\.filePath\}/);
assert.match(history, /to=\{`\/details\/\$\{item\.id\}`\} onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
assert.match(history, /aria-label="Remove from history" title="Remove from history" onClick=\{\(event\) => \{ event\.stopPropagation\(\); onRemove\(\); \}\}/);
assert.match(styles, /\.history-panel \{ --history-grid-columns:/);
assert.match(styles, /\.history-grid \{ display: grid; grid-template-columns: var\(--history-grid-columns\)/);
assert.match(styles, /\.file-cell \{ min-width: 0; \}/);
assert.match(styles, /\.file-cell strong \{ display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
assert.doesNotMatch(styles, /\.history-virtual-list \.history-row \{[^}]*grid-template-columns/s);
assert.doesNotMatch(assessmentStyles, /\.consumer-history-row[^}]*grid-template-columns/s);
assert.doesNotMatch(assessmentStyles, /\.consumer-history-row[^}]*display: none/s);

console.log("history layout contract tests passed");