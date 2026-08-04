export type NotificationTarget =
  | { readonly route: "history-detail"; readonly assessmentId: string }
  | { readonly route: "history" }
  | { readonly route: "device-security"; readonly deviceId?: string }
  | { readonly route: "full-scan"; readonly scanId?: string }
  | { readonly route: "realtime" };

export interface WindowsNotificationRequest {
  readonly category: "assessment" | "device" | "scan" | "protection";
  readonly setting: string;
  readonly title: string;
  readonly body: string;
  readonly target: NotificationTarget;
  readonly dedupeKey: string;
  readonly dedupeWindowMs?: number;
}

export interface NativeNotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly silent: boolean;
  readonly target: NotificationTarget;
}

export type NotificationDecision = { readonly delivered: true } | { readonly delivered: false; readonly reason: "unsupported" | "user-setting" | "duplicate" };

export interface WindowsNotificationServiceOptions {
  readonly supported: () => boolean;
  readonly deliver: (payload: NativeNotificationPayload) => void;
  readonly now?: () => number;
  readonly diagnostic?: (message: string) => void;
}

export class WindowsNotificationService {
  private readonly options: WindowsNotificationServiceOptions;
  private readonly emitted = new Map<string, number>();
  private readonly now: () => number;
  private readonly diagnostic: (message: string) => void;

  constructor(options: WindowsNotificationServiceOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.diagnostic = options.diagnostic ?? (() => undefined);
  }

  notify(settings: Record<string, unknown>, request: WindowsNotificationRequest): NotificationDecision {
    if (!this.options.supported()) return this.suppress("unsupported", request);
    if (settings.windowsNotifications !== true || settings[request.setting] !== true) return this.suppress("user-setting", request);
    const now = this.now();
    const previous = this.emitted.get(request.dedupeKey);
    const windowMs = request.dedupeWindowMs ?? 30_000;
    if (previous !== undefined && now - previous < windowMs) return this.suppress("duplicate", request);
    this.emitted.set(request.dedupeKey, now);
    this.prune(now, Math.max(windowMs, 60_000));
    this.options.deliver({ title: request.title, body: request.body, silent: settings.soundNotifications !== true, target: request.target });
    this.diagnostic(`notification emitted category=${request.category} key=${request.dedupeKey}`);
    return { delivered: true };
  }

  private suppress(reason: Exclude<NotificationDecision, { readonly delivered: true }> ["reason"], request: WindowsNotificationRequest): NotificationDecision {
    this.diagnostic(`notification suppressed reason=${reason} category=${request.category} key=${request.dedupeKey}`);
    return { delivered: false, reason };
  }

  private prune(now: number, retentionMs: number): void {
    for (const [key, emittedAt] of this.emitted) if (now - emittedAt > retentionMs) this.emitted.delete(key);
  }
}

export function isNotificationTarget(value: unknown): value is NotificationTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as { route?: unknown; assessmentId?: unknown; deviceId?: unknown; scanId?: unknown };
  if (target.route === "history-detail") return validId(target.assessmentId);
  if (target.route === "history" || target.route === "realtime") return true;
  if (target.route === "device-security") return target.deviceId === undefined || validId(target.deviceId);
  if (target.route === "full-scan") return target.scanId === undefined || validId(target.scanId);
  return false;
}

export function notificationPath(target: NotificationTarget): string {
  if (target.route === "history-detail") return `/details/${encodeURIComponent(target.assessmentId)}`;
  if (target.route === "history") return "/history";
  if (target.route === "device-security") return "/device-security";
  if (target.route === "full-scan") return "/full-scan";
  return "/realtime";
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}