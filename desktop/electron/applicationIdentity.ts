export const APPLICATION_NAME = "viAI Security";
export const APPLICATION_ID = "com.eforendless.viai";

export interface ApplicationIdentityTarget {
  setName(name: string): void;
  setAppUserModelId(identifier: string): void;
}

const routeTitles: Readonly<Record<string, string>> = {
  "/": "Dashboard",
  "/quick-scan": "Quick Scan",
  "/full-scan": "Full Scan",
  "/realtime": "Realtime Protection",
  "/device-security": "Device Security",
  "/history": "History",
  "/scan-reports": "Scan Reports",
  "/settings": "Settings",
  "/about": "About",
  "/legal/terms": "Terms of Service",
  "/legal/privacy": "Privacy Policy",
};

export function configureApplicationIdentity(target: ApplicationIdentityTarget): void {
  target.setName(APPLICATION_NAME);
  target.setAppUserModelId(APPLICATION_ID);
}

export function windowTitleForPath(pathname: string): string {
  const pageTitle = pathname.startsWith("/details/") ? "File Details" : pathname.startsWith("/scan-reports/") ? "Scan Report" : routeTitles[pathname];
  return pageTitle ? `${pageTitle} — ${APPLICATION_NAME}` : APPLICATION_NAME;
}