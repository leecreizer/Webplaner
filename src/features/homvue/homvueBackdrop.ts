import { useEffect, useState } from 'react';
import { HOMVUE_BASE } from './homvueAssets';
import { useHomvueStore } from './homvueStore';

/**
 * 언리얼 HDRIBackdrop — 평면 기본 레벨마다 하나. 창밖 배경이자 환경광(스카이라이트)이다.
 * 변환 도구가 큐브맵을 HDR(가로세로 2:1)로 꺼내고 설정을 glb/env/hdri-backdrop.json 에 남긴다.
 * 웹은 이 HDR 을 장면 환경맵·배경으로 쓴다 (App SceneEnvironment).
 */
export interface Backdrop {
  /** 창밖 배경 — 2K 로 줄인 HDR. 원본 4K 는 경로 추적이 켤 때마다 주 스레드에서 변환하느라 3.6초 멈췄다(실측) */
  url: string;
  /** 환경광 — 1K 로 줄인 HDR. 환경맵 크기가 홈플래너3 기본 환경(1K)과 같아야 평면을 열 때 미리 컴파일한
   *  재질 셰이더를 그대로 쓴다(셰이더 열쇠에 환경맵 크기가 들어간다 — 4K 면 전부 다시 컴파일). 조명엔 1K 로 충분 */
  envUrl: string;
  /** 언리얼 HDRIBackdrop Intensity (84A 2, 나머지 1) */
  intensity: number;
}

interface BackdropRow {
  cubemap?: string;
  intensity?: number;
}

let cache: Promise<Record<string, BackdropRow[]> | null> | null = null;
function load() {
  cache ??= fetch(`${HOMVUE_BASE}/glb/env/hdri-backdrop.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, BackdropRow[]>>) : null))
    .catch(() => null);
  return cache;
}

/** 띄운 평면의 배경 — 평면이 없거나 정보가 없으면 null (홈플래너3 기본 환경 그대로) */
export function useHomvueBackdrop(): Backdrop | null {
  const level = useHomvueStore((s) => s.plan?.base.level ?? null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  useEffect(() => {
    if (!level) {
      setBackdrop(null);
      return;
    }
    let alive = true;
    void load().then((table) => {
      const row = table?.[level]?.[0];
      const name = row?.cubemap?.split('.').pop();
      if (!alive) return;
      // 변환 도구가 <이름>_4k.hdr 옆에 <이름>_2k.hdr(배경)·<이름>_1k.hdr(환경광)을 만들어 둔다
      const at = (size: string) => `${HOMVUE_BASE}/glb/env/${name?.replace(/_4k$/, `_${size}`)}.hdr`;
      setBackdrop(name ? { url: at('2k'), envUrl: at('1k'), intensity: row?.intensity ?? 1 } : null);
    });
    return () => {
      alive = false;
    };
  }, [level]);
  return backdrop;
}
