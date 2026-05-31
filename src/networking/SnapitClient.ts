import type { RenderPlanSaveData } from '../saveload/PlanSaveData';

/**
 * Snapit (Flask + Gemini + YOLO) 백엔드와 통신하는 HTTP 클라이언트.
 *
 * Unity의 `NanoBananaRenderer.SnapitProxyCoroutine` 흐름을 TypeScript fetch 기반으로 옮긴 것.
 * Unity의 jslib bridge / Coroutine은 모두 표준 `async/await`로 대체된다.
 *
 * ### 사용 플로우 (Unity SnapitProxyCoroutine과 1:1)
 * 1. **(선택) 참고 이미지 N장 업로드** — `uploadOnly(bytes, { reference: true })`
 * 2. **메인 캡처 업로드** — `uploadOnly(bytes)` (서버가 YOLO 탐지 + 룸 분류 수행)
 * 3. **렌더 요청** — `process({ action: 'render', image_path, reference_image_paths, ... })`
 * 4. **결과 다운로드** — 응답의 `result_url`을 그대로 `fetch().blob()` 또는 `<img src>`로 사용
 *
 * ### Snapit 서버 측 엔드포인트 (참고)
 * - `POST /upload-only` (multipart: image + source + reference)
 * - `POST /process` (JSON body)
 * - `GET /outputs/<filename>` (결과 이미지)
 * - `GET /uploads/<filename>` (원본/참고 이미지)
 * - `GET /viewer?mode=compare|result&...` (외부 임베드용 뷰어)
 * - `GET /download/outputs/<filename>?name=...` (파일 다운로드)
 *
 * 본 클라이언트는 부모 React 호스트가 직접 import해서 호출할 수도 있고,
 * 본 프로젝트의 UI 컴포넌트가 호출할 수도 있다 (둘 다 같은 HTTP).
 */

/** 업로드 결과 응답. */
export interface SnapitUploadResponse {
  status: 'success' | string;
  image_url: string;
  source?: string;
  reference?: boolean;
  /** 메인 캡처 업로드 시에만 채워짐 — YOLO 탐지 결과(서버 비동기). */
  room_type?: string;
  room_name?: string;
  room_name_en?: string;
}

/** `/process` 요청 옵션 — `action`은 'render' 외에도 add/delete/replace/decorate가 있음. */
export interface SnapitProcessRequest {
  action:
    | 'render'
    | 'add'
    | 'delete'
    | 'delete_multi'
    | 'delete_all'
    | 'replace'
    | 'decorate';
  /** 서버에 업로드된 메인 이미지 경로 (`/upload-only` 응답의 `image_url`). */
  image_path: string;
  /** "1K" | "2K" | "4K" | "original" */
  resolution?: string;
  /** "1:1" | "16:9" | "9:16" | "4:3" | "3:4" */
  ratio?: string;
  illuminance?: number;
  color_temp?: number;
  outdoor?: string;
  environments?: string[];
  style?: string;
  user_prompt?: string;
  /** 참고 이미지 경로 배열 (각각 `/upload-only` 응답의 `image_url`). */
  reference_image_paths?: string[];
  /**
   * Unity 평면도 컨텍스트(JSON 직렬화된 `RenderPlanSaveData`).
   * Snapit 서버가 이를 Gemini 프롬프트에 주입하면 카메라 구도·평면 구조를 반영한 렌더 가능.
   *
   * TODO(server): Snapit `/process` 엔드포인트가 `plan_data` 필드를 수용하도록 확장 (현재는 무시됨).
   */
  plan_data?: RenderPlanSaveData | string;
  /** 기타 자유 필드 — 서버가 무시하지 않는 한 그대로 전달된다. */
  [key: string]: unknown;
}

/** `/process` 응답. */
export interface SnapitProcessResponse {
  status: 'success' | string;
  result_url: string;
  /** 추가 메타 (검출 결과 등). */
  [key: string]: unknown;
}

/** 업로드 옵션. */
export interface UploadOnlyOptions {
  /** 파일명 (기본: `unity_capture_<timestamp>.jpg`). */
  filename?: string;
  /** `source=unity` 등 출처 태그 (기본: `'unity'`). */
  source?: string;
  /** true면 `reference=1` 폼 필드 추가 — 탐지 스킵 + 빠른 반환. */
  reference?: boolean;
  /** AbortSignal 지원. */
  signal?: AbortSignal;
}

/**
 * Snapit HTTP 클라이언트.
 *
 * @example
 * ```ts
 * const snapit = new SnapitClient('http://127.0.0.1:5000');
 * const refUp  = await snapit.uploadOnly(refJpg,  { reference: true });
 * const mainUp = await snapit.uploadOnly(mainJpg);
 * const result = await snapit.process({
 *   action: 'render',
 *   image_path: mainUp.image_url,
 *   reference_image_paths: [refUp.image_url],
 *   resolution: '2K',
 *   ratio: '16:9',
 *   style: 'modern',
 * });
 * const pngBlob = await snapit.fetchResult(result.result_url);
 * ```
 */
export class SnapitClient {
  /** 백엔드 base URL (예: `http://127.0.0.1:5000`). 트레일링 슬래시 없음. */
  readonly baseUrl: string;

  /** 모든 fetch 호출에 적용되는 기본 timeout(ms). 개별 호출에서 AbortSignal로 덮어쓸 수 있다. */
  defaultTimeoutMs: number = 120_000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ===== /upload-only =====================================

  /**
   * 이미지 바이트를 Snapit에 업로드한다.
   *
   * Unity `NanoBananaRenderer.UploadImageToSnapit` 대응.
   *
   * @param bytes JPG/PNG 바이트
   * @param options 업로드 옵션
   */
  async uploadOnly(
    bytes: Uint8Array | Blob,
    options: UploadOnlyOptions = {},
  ): Promise<SnapitUploadResponse> {
    const filename =
      options.filename ?? `unity_capture_${SnapitClient._timestamp()}.jpg`;
    const source = options.source ?? 'unity';

    const blob =
      bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: 'image/jpeg' });
    const form = new FormData();
    form.append('image', blob, filename);
    form.append('source', source);
    if (options.reference) form.append('reference', '1');

    const url = `${this.baseUrl}/upload-only`;
    const resp = await this._fetch(url, {
      method: 'POST',
      body: form,
      signal: options.signal,
    });
    if (!resp.ok) {
      throw new SnapitError(`upload-only failed`, resp.status, await SnapitClient._safeText(resp));
    }
    const data = (await resp.json()) as SnapitUploadResponse;
    if (!data.image_url) {
      throw new SnapitError(`upload-only response missing image_url`, resp.status, JSON.stringify(data));
    }
    return data;
  }

  // ===== /process =========================================

  /**
   * 업로드된 이미지에 대해 AI 작업을 수행하도록 요청한다.
   *
   * `action` 값에 따라 렌더링/객체 추가/삭제/교체/꾸미기 등이 결정된다. 응답의 `result_url`로
   * 최종 결과 이미지를 가져올 수 있다.
   *
   * Unity `NanoBananaRenderer.BuildSnapitProcessBody` + process POST 대응.
   *
   * @param body 요청 파라미터
   * @param signal AbortSignal
   */
  async process(
    body: SnapitProcessRequest,
    signal?: AbortSignal,
  ): Promise<SnapitProcessResponse> {
    // `plan_data`가 객체 형태로 들어왔으면 문자열로 직렬화 (Snapit 서버는 두 형식 모두 수용 가능하게 둠)
    const normalized: SnapitProcessRequest = { ...body };
    if (normalized.plan_data && typeof normalized.plan_data !== 'string') {
      normalized.plan_data = JSON.stringify(normalized.plan_data);
    }

    const url = `${this.baseUrl}/process`;
    const resp = await this._fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
      signal,
    });
    if (!resp.ok) {
      throw new SnapitError(`process failed`, resp.status, await SnapitClient._safeText(resp));
    }
    const data = (await resp.json()) as SnapitProcessResponse;
    if (data.status !== 'success') {
      throw new SnapitError(`process status != success`, resp.status, JSON.stringify(data));
    }
    if (!data.result_url) {
      throw new SnapitError(`process response missing result_url`, resp.status, JSON.stringify(data));
    }
    return data;
  }

  // ===== 결과 다운로드 ===================================

  /**
   * Snapit의 결과 이미지를 Blob으로 가져온다. 상대 URL과 절대 URL 모두 지원.
   *
   * @param resultUrl `process()` 응답의 `result_url` 또는 `/outputs/<file>` 같은 경로
   * @param signal AbortSignal
   */
  async fetchResult(resultUrl: string, signal?: AbortSignal): Promise<Blob> {
    const absolute = this.toAbsoluteUrl(resultUrl);
    const resp = await this._fetch(absolute, { signal });
    if (!resp.ok) {
      throw new SnapitError(`fetchResult failed`, resp.status, await SnapitClient._safeText(resp));
    }
    return resp.blob();
  }

  /** 상대 경로를 base URL로 절대화한다 (`http`로 시작하면 그대로). */
  toAbsoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  /**
   * `/viewer` URL을 조립한다 (compare 모드 또는 result 모드).
   * Snapit 서버의 외부 임베드용 뷰어 페이지.
   */
  viewerUrl(opts: { mode: 'compare' | 'result'; original?: string; result?: string }): string {
    const u = new URL(`${this.baseUrl}/viewer`);
    u.searchParams.set('mode', opts.mode);
    if (opts.original) u.searchParams.set('original', opts.original);
    if (opts.result) u.searchParams.set('result', opts.result);
    return u.toString();
  }

  /**
   * `/download/outputs/<filename>` URL을 조립한다 (사용자가 받을 파일명 지정 가능).
   */
  downloadUrl(filename: string, downloadName?: string): string {
    const u = new URL(`${this.baseUrl}/download/outputs/${encodeURIComponent(filename)}`);
    if (downloadName) u.searchParams.set('name', downloadName);
    return u.toString();
  }

  // ===== 내부 유틸 =======================================

  /** `fetch`에 timeout 처리를 입힌 wrapper. */
  private async _fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    // 호출자가 직접 signal을 주면 그대로 사용, 없으면 timeout signal 생성
    if (init.signal) return fetch(input, init);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private static async _safeText(resp: Response): Promise<string> {
    try {
      return await resp.text();
    } catch {
      return '';
    }
  }

  private static _timestamp(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
}

/**
 * Snapit HTTP 오류. `status` 코드와 서버 응답 텍스트를 포함한다.
 */
export class SnapitError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(message: string, status: number, responseText: string) {
    super(`${message} [${status}] ${responseText}`);
    this.name = 'SnapitError';
    this.status = status;
    this.responseText = responseText;
  }
}