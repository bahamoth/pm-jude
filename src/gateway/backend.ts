/**
 * LLM 백엔드 경계 (F14). 게이트웨이만 이 인터페이스를 호출하며,
 * 게이트웨이 외부는 백엔드 종류(Agent SDK, 직접 API)를 모른다.
 */
export interface BackendRequest {
  /** 레지스트리에서 해석된 프롬프트 본문. */
  promptBody: string;
  /** 세션 저장소에서 조립해 무상태로 주입되는 구조화 입력. */
  input: unknown;
  /** 타임아웃·취소 전파용. 백엔드는 중단 신호를 존중해야 한다. */
  signal: AbortSignal;
}

export interface BackendUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface BackendResponse {
  /** 모델의 원문 텍스트. 파싱·스키마 검증은 게이트웨이 몫이다. */
  outputText: string;
  usage: BackendUsage;
}

export interface LlmBackend {
  run(request: BackendRequest): Promise<BackendResponse>;
}
