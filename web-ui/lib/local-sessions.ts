// 브라우저 로컬 세션 목록 (#29) — 여기 담기는 것은 세션 ID 포인터뿐이다.
// 데이터는 전부 서버에 영속되므로 목록 유실은 요청 유실이 아니고, 딥링크 /s/:id로 복구된다(M-2).

const LIST_KEY = 'pmjude.sessions';
const LEGACY_KEY = 'pmjude.sessionId';

export function listSessionIds(): string[] {
  if (typeof window === 'undefined') return [];
  const ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string') ids.push(id);
    }
  } catch {
    // 손상된 목록은 버린다 — 포인터일 뿐이다
  }
  // 구버전 단일 키 마이그레이션
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (legacy && !ids.includes(legacy)) ids.unshift(legacy);
  if (legacy) {
    localStorage.removeItem(LEGACY_KEY);
    persist(ids);
  }
  return ids;
}

export function rememberSession(id: string): void {
  const ids = listSessionIds().filter((existing) => existing !== id);
  ids.unshift(id); // 최근 것이 앞
  persist(ids.slice(0, 50));
}

export function forgetSession(id: string): void {
  persist(listSessionIds().filter((existing) => existing !== id));
}

function persist(ids: string[]): void {
  localStorage.setItem(LIST_KEY, JSON.stringify(ids));
}
