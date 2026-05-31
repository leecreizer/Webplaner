/**
 * 캡처 해상도 프리셋.
 *
 * Unity `CameraFovController.CaptureResolutionPreset` 1:1 포팅. 사용자가 상단 툴바에서
 * 선택한 캡처 해상도가 그대로 Snapit `resolution` 파라미터로 전달된다.
 */
export enum CaptureResolutionPreset {
  /** 현재 화면 해상도 (= window.innerWidth × devicePixelRatio). */
  ScreenSize = 'ScreenSize',
  HD_1280x720 = 'HD_1280x720',
  FHD_1920x1080 = 'FHD_1920x1080',
  QHD_2560x1440 = 'QHD_2560x1440',
  UHD_3840x2160 = 'UHD_3840x2160',
  /** customWidth/customHeight 사용. */
  Custom = 'Custom',
}

/** 프리셋 → {width, height} 매핑. ScreenSize/Custom은 호출자에서 처리. */
const PRESET_DIMENSIONS: Record<
  Exclude<CaptureResolutionPreset, CaptureResolutionPreset.ScreenSize | CaptureResolutionPreset.Custom>,
  { width: number; height: number }
> = {
  [CaptureResolutionPreset.HD_1280x720]: { width: 1280, height: 720 },
  [CaptureResolutionPreset.FHD_1920x1080]: { width: 1920, height: 1080 },
  [CaptureResolutionPreset.QHD_2560x1440]: { width: 2560, height: 1440 },
  [CaptureResolutionPreset.UHD_3840x2160]: { width: 3840, height: 2160 },
};

/**
 * 캡처 프리셋과 옵션으로부터 실제 캡처 해상도(px)를 결정한다.
 *
 * Unity `CameraFovController.GetCaptureResolution(out int w, out int h)` 대응.
 *
 * @param preset 캡처 해상도 프리셋
 * @param options ScreenSize일 때 사용할 viewport / Custom일 때 사용할 사이즈
 */
export function getCaptureResolution(
  preset: CaptureResolutionPreset,
  options: {
    viewportWidth?: number;
    viewportHeight?: number;
    customWidth?: number;
    customHeight?: number;
  } = {},
): { width: number; height: number } {
  if (preset === CaptureResolutionPreset.ScreenSize) {
    return {
      width: Math.max(1, Math.round(options.viewportWidth ?? 1)),
      height: Math.max(1, Math.round(options.viewportHeight ?? 1)),
    };
  }
  if (preset === CaptureResolutionPreset.Custom) {
    return {
      width: Math.max(1, Math.round(options.customWidth ?? 1920)),
      height: Math.max(1, Math.round(options.customHeight ?? 1080)),
    };
  }
  return PRESET_DIMENSIONS[preset];
}

/** 캡처 해상도의 가로/세로 비율. */
export function getCaptureAspect(
  preset: CaptureResolutionPreset,
  options?: Parameters<typeof getCaptureResolution>[1],
): number {
  const { width, height } = getCaptureResolution(preset, options);
  return height === 0 ? 1 : width / height;
}

/**
 * Unity `Config.imageSize`(1K/2K/4K) → Snapit `/process` `resolution` 파라미터 매핑.
 * 폴백 전용 (CameraFovController가 결정 못 할 때).
 *
 * Unity `NanoBananaRenderer.MapImageSizeToSnapit` 1:1 포팅.
 */
export function mapImageSizeToSnapit(imageSize: '1K' | '2K' | '4K' | string): string {
  const u = imageSize.toUpperCase();
  if (u === '1K' || u === '4K') return u;
  return '2K';
}

/**
 * 캡처 해상도 프리셋 + viewport → Snapit `/process` `resolution` 파라미터로 매핑.
 *
 *   ScreenSize        → "original"
 *   720   이하(HD)    → "1K"
 *   1080~1440(FHD/QHD)→ "2K"
 *   2160(UHD)         → "4K"
 *
 * Unity `NanoBananaRenderer.MapCaptureResolutionToSnapit` 1:1 포팅.
 */
export function mapCaptureResolutionToSnapit(
  preset: CaptureResolutionPreset,
  options?: Parameters<typeof getCaptureResolution>[1],
  fallbackImageSize: string = '2K',
): string {
  if (preset === CaptureResolutionPreset.ScreenSize) return 'original';
  const { width, height } = getCaptureResolution(preset, options);
  const shortEdge = Math.min(width, height);
  if (shortEdge <= 0) return mapImageSizeToSnapit(fallbackImageSize);
  if (shortEdge <= 800) return '1K';
  if (shortEdge <= 1600) return '2K';
  return '4K';
}

/**
 * 캡처 aspect → Gemini `imageConfig.aspectRatio` 프리셋 문자열로 매핑.
 *
 * 후보(`1:1`, `16:9`, `9:16`, `4:3`, `3:4`) 중 가장 가까운 값을 선택한다.
 *
 * Unity `NanoBananaRenderer.ResolveAspectRatioString` 1:1 포팅.
 */
export function resolveAspectRatioString(aspect: number): '1:1' | '16:9' | '9:16' | '4:3' | '3:4' {
  const candidates: Array<{ key: '1:1' | '16:9' | '9:16' | '4:3' | '3:4'; value: number }> = [
    { key: '1:1', value: 1 },
    { key: '16:9', value: 16 / 9 },
    { key: '9:16', value: 9 / 16 },
    { key: '4:3', value: 4 / 3 },
    { key: '3:4', value: 3 / 4 },
  ];

  let bestKey: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' = '1:1';
  let bestDiff = Number.MAX_VALUE;
  for (const c of candidates) {
    const d = Math.abs(aspect - c.value);
    if (d < bestDiff) {
      bestDiff = d;
      bestKey = c.key;
    }
  }
  return bestKey;
}