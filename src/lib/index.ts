/**
 * Lib 레이어 공공 API — 순수 수학/유틸 함수. 의존성 0 (three 제외, React 금지).
 *
 * 어떤 레이어에서도 import 가능. 다른 프로젝트에 패키지로 추출하기 가장 쉬운 부분.
 */

// Math
export * from './math/Math';
export * from './math/Geometry';
export * from './math/Triangulator';
export * from './math/QuadTree';
export * from './math/VectorExtensions';
export * from './math/LineSegmentIntersection';

// Constants
export * from './constants/Constants';
