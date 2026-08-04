export type HistoryActionId = "remove-from-history" | "quarantine" | "delete-from-device";

export interface HistoryAction {
  readonly id: HistoryActionId;
  readonly label: string;
  readonly availability: "available" | "future";
  readonly unavailableDetail?: string;
}

export const historyActions: Readonly<Record<HistoryActionId, HistoryAction>> = Object.freeze({
  "remove-from-history": { id: "remove-from-history", label: "Remove from history", availability: "available" },
  quarantine: { id: "quarantine", label: "Quarantine", availability: "future", unavailableDetail: "Quarantine response is not available in the current engine version." },
  "delete-from-device": { id: "delete-from-device", label: "Delete from device", availability: "future", unavailableDetail: "Device deletion is not available in the current protection version." },
});