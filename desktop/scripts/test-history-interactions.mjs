import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { historySelectionState, matchesHistorySearch, reconcileHistorySelection, toggleAllHistorySelection, toggleHistorySelection } = await vite.ssrLoadModule("/src/historySelection.ts");
const { historyActions } = await vite.ssrLoadModule("/src/historyActions.ts");

const visible = ["assessment-a", "assessment-b", "assessment-c"];
let selected = toggleHistorySelection(new Set(), "assessment-a");
selected = toggleHistorySelection(selected, "assessment-c");
assert.deepEqual([...selected].sort(), ["assessment-a", "assessment-c"]);
assert.deepEqual(historySelectionState(selected, visible), { selected: 2, allSelected: false, partiallySelected: true });
selected = toggleAllHistorySelection(selected, visible);
assert.deepEqual(historySelectionState(selected, visible), { selected: 3, allSelected: true, partiallySelected: false });
selected = toggleAllHistorySelection(selected, visible);
assert.equal(selected.size, 0);
assert.deepEqual([...reconcileHistorySelection(new Set(["assessment-a", "removed-record"]), ["assessment-a", "assessment-b"])], ["assessment-a"]);
assert.equal(matchesHistorySearch(["Install VALORANT.exe", "Needs investigation"], "valorant"), true);
assert.equal(matchesHistorySearch(["Install VALORANT.exe"], "document"), false);
assert.equal(historyActions["remove-from-history"].availability, "available");
assert.equal(historyActions.quarantine.availability, "future");
assert.equal(historyActions["delete-from-device"].availability, "future");
assert.equal("execute" in historyActions.quarantine, false);
assert.equal("execute" in historyActions["delete-from-device"], false);

await vite.close();
console.log("history selection and search interaction tests passed");