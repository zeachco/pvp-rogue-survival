const SESSION_KEY = "multi-line-tower.session";
export interface SavedSession { heroId: string; username: string }

export class SessionStorage {
  load(): SavedSession | undefined {
    try { const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as SavedSession | null; return parsed?.heroId && parsed.username ? parsed : undefined; }
    catch { return undefined; }
  }
  save(session: SavedSession): void { try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* restricted */ } }
  clear(): void { localStorage.removeItem(SESSION_KEY); }
}
