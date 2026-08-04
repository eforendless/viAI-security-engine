import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const styles = await readFile(new URL("../src/index.css", import.meta.url), "utf8");
const assessmentStyles = await readFile(new URL("../src/assessment-ui.css", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

assert.match(styles, /--surface-input:/);
assert.match(styles, /:root\[data-theme="dark"\].*--surface-input:/s);
assert.match(styles, /\.path-input input, \.search-box, \.history-filter.*var\(--surface-input\)/s);
assert.match(styles, /\.search-box input \{ background: transparent; color: var\(--text-primary\); \}/);
assert.match(styles, /\.mode-switch \{ background: var\(--surface-secondary\); \}/);
assert.match(styles, /\.selection-card \{ border-color: var\(--border-primary\); background: var\(--surface-secondary\); \}/);
assert.match(styles, /input:-webkit-autofill.*var\(--surface-input\)/s);
assert.match(styles, /\.dropdown-menu-list \{ border-color: var\(--border-primary\); background: var\(--surface-elevated\)/);
assert.match(styles, /\.confirm-dialog \{ background: #17253b/);
assert.match(styles, /scrollbar-color: var\(--scroll-thumb\) var\(--scroll-track\)/);
assert.match(assessmentStyles, /\.assessment-status\.safe.*var\(--status-safe-surface\)/s);
assert.match(assessmentStyles, /\.technical-details \{ border-color: var\(--border-primary\); background: var\(--surface-primary\); \}/);
assert.match(app, /background: "var\(--surface-elevated\)"/);

console.log("dark theme contract tests passed");