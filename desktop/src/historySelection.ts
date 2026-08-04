export function reconcileHistorySelection(selected: ReadonlySet<string>, availableIds: readonly string[]): Set<string> {
  const available = new Set(availableIds);
  return new Set([...selected].filter((id) => available.has(id)));
}

export function toggleHistorySelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function toggleAllHistorySelection(selected: ReadonlySet<string>, visibleIds: readonly string[]): Set<string> {
  const visible = new Set(visibleIds);
  const allSelected = visible.size > 0 && [...visible].every((id) => selected.has(id));
  const next = new Set(selected);
  if (allSelected) visible.forEach((id) => next.delete(id));
  else visible.forEach((id) => next.add(id));
  return next;
}

export function historySelectionState(selected: ReadonlySet<string>, visibleIds: readonly string[]): { selected: number; allSelected: boolean; partiallySelected: boolean } {
  const selectedCount = visibleIds.filter((id) => selected.has(id)).length;
  return { selected: selectedCount, allSelected: visibleIds.length > 0 && selectedCount === visibleIds.length, partiallySelected: selectedCount > 0 && selectedCount < visibleIds.length };
}

export function matchesHistorySearch(values: readonly (string | undefined)[], query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || values.filter((value): value is string => Boolean(value)).join(" ").toLocaleLowerCase().includes(normalized);
}