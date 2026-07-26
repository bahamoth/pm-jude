import { getSession } from './api';

/**
 * 서버 처리(LLM 라운드) 완료까지 대기 — 수명 규칙(#31)의 클라이언트 절반.
 * SSE를 우선 사용하고(status.processing=false 또는 round_failed가 완료 신호,
 * 서버도 처리 종료 시 스트림을 닫는다), 연결이 안 되면 조회 폴링으로 강등한다.
 * 저장소가 진실 원천이므로 어느 경로든 결과는 동일하다.
 */
export function watchProcessing(sessionId: string, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);

    const finish = () => {
      if (settled) return;
      settled = true;
      source.close();
      if (poll) clearInterval(poll);
      clearTimeout(cap);
      resolve();
    };
    const cap = setTimeout(finish, timeoutMs);

    source.addEventListener('status', (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { processing: boolean };
      if (!data.processing) finish();
    });
    source.addEventListener('round_failed', finish);
    source.onerror = () => {
      // 프록시·연결 문제 — 조회 폴링 폴백. (서버의 정상 스트림 종료는 재접속 시
      // status(processing=false)로 즉시 finish되므로 여기 오래 머물지 않는다.)
      if (!poll) {
        poll = setInterval(() => {
          getSession(sessionId)
            .then((detail) => {
              if (!detail.processing) finish();
            })
            .catch(finish);
        }, 2500);
      }
    };
  });
}
