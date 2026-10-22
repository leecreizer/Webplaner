import { HOMVUE_BASE, type PlanData } from './homvueAssets';

/**
 * 상담 신청 — 언리얼 UHVGameInstance::RequestConsultation · WB_PhoneNumInput · WB_AgreementPopup · WB_SelectStore.
 *
 * 언리얼은 한샘 게이트웨이 상담 API(UHVWebRequest::ConsultationURL, Homvue.ini 의 JWT 로 인증)로 보내 고객 휴대폰에
 * VR 링크 버튼이 달린 문자를 실제로 발송하고, 결과를 키오스크 폴더의 RecordUserInfo_Success/Fail.csv 에 남긴다.
 *
 * 웹은 아직 발송을 연결하지 않았다 — 인증 토큰을 브라우저에 둘 수 없고(서버 중계 필요), 실제 고객에게 나가는 발송이라
 * 담당 확인 후 연결한다. 지금은 화면 흐름과 기록(이 기기)만 동작하고 결과는 「NotSent」로 남긴다.
 */

/** WB_AgreementPopup 문구 그대로 (에셋에서 추출). 표의 행 배치는 위젯 문구 순서로 맞춘 것 */
export const AGREEMENTS = [
  {
    id: 'collect',
    title: '개인정보 수집 및 이용 동의(필수)',
    lead: '상담신청을 위해 아래와 같이 개인정보를 수집 및 이용하고자 합니다.\n개인정보 수집 및 이용에 동의하지 않을 수 있으나 동의하지 않을 경우 상담 신청이 불가합니다.',
    rows: [
      ['수집 항목', '휴대전화번호'],
      ['처리 목적', '상담신청, 해피콜, 상담 매장 및 영업사원 배정, 고객상담 서비스 제공'],
      ['보유 및 이용 기간', '1개월'],
    ],
  },
  {
    id: 'thirdParty',
    title: '개인정보 제3자 제공 동의(필수)',
    lead: '상담신청을 위해 아래와 같이 개인정보를 제3자에게 제공하고자 합니다.\n제3자 제공에 동의하지 않을 수 있으나 동의하지 않을 경우 상담 신청이 불가합니다.',
    rows: [
      ['제공받는 자', '한샘 대리점'],
      ['제공 목적', '상담서비스 이행'],
      ['제공 항목', '휴대전화번호'],
      ['보유 및 이용 기간', '1개월'],
    ],
  },
] as const;

export const SELECT_STORE_TITLE = '혜택 지급 매장 선택(필수)';

/** 매장 목록 — 언리얼 원본에서 확인된 것은 기본값 「방배점」 하나뿐이라 설정 파일(manifest/stores.json)로 받는다 */
export async function fetchStores(): Promise<string[]> {
  try {
    const res = await fetch(`${HOMVUE_BASE}/manifest/stores.json`);
    const j = (await res.json()) as { stores?: string[] };
    return j.stores?.length ? j.stores : ['방배점'];
  } catch {
    return ['방배점'];
  }
}

/** 휴대전화번호 — 숫자만, 010 으로 시작 10~11자리 */
export const normalizePhone = (s: string) => s.replace(/\D/g, '');
export const isValidPhone = (s: string) => /^01[016789]\d{7,8}$/.test(normalizePhone(s));

/** RecordUserInfo CSV 한 줄과 같은 항목 (No 는 목록 순번) */
export interface ConsultationRecord {
  phone: string;
  apt: string;
  plan: string;
  lifeStyle: string;
  date: string;
  time: string;
  homeplannerURL: string;
  result: 'Success' | 'Fail' | 'NotSent';
  admin: 'Y' | 'N';
  vrURL: string;
  store: string;
}

export function makeRecord(plan: PlanData, phone: string, store: string, style: string): ConsultationRecord {
  const now = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    phone: normalizePhone(phone),
    apt: plan.apt.name,
    plan: `${plan.alias ?? ''}${plan.planName}`,
    lifeStyle: style,
    date: `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`,
    time: `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`,
    homeplannerURL: plan.homeplannerURL?.[style] ?? '',
    result: 'NotSent',
    admin: 'N',
    vrURL: plan.coohomVRURL ?? '',
    store,
  };
}

/** 발송 — 연결 전. 실제 연결 시 이 함수만 서버 중계 호출로 바꾼다 */
export async function sendConsultation(record: ConsultationRecord): Promise<ConsultationRecord> {
  return { ...record, result: 'NotSent' };
}

const KEY = 'homvue:consultations';

export function appendRecord(r: ConsultationRecord): boolean {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as ConsultationRecord[];
    list.push(r);
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
