export interface RealtimeSearchGroup { readonly title: string; readonly options: readonly (readonly [string, string, string])[]; }

export function matchesRealtimeSearch(group: RealtimeSearchGroup, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || group.title.toLocaleLowerCase().includes(normalized) || group.options.some(([, label, detail]) => `${label} ${detail}`.toLocaleLowerCase().includes(normalized));
}