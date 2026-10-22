# lightbaker (외부 코드)

three.js 포크 `zalo/three.js` 커밋 `e2f7119e43f7c04f278b24c283c62f4c3be84a63` 의 `examples/jsm` 중
`lighting/LightBaker.js` 와 그 상대 경로 의존 파일(18개)을 그대로 가져왔다. 라이선스는 three.js 와 같은 MIT.

공식 three.js 0.186 에 맞춘 수정:

- `tsl/lighting/DirectionalLightMapNode.js` — `specularColorBlended`(포크 전용) → `specularColor`
- `lighting/LightProbeGrid.js` — 포크 본체의 `Light.registerNode` 가 공식엔 없어 있을 때만 호출
  (공식은 `renderer.library.addLight( LightProbeGridNode, LightProbeGrid )`)

`poc.js` 는 시험 코드(앱에 연결하지 않음) — Homvue 59C 거실을 굽고 WebGPU 캔버스에 그린다.
2026-10-23 실측: 메시 682·삼각형 395만(라이트맵 대상 171만), 준비 55초 + 굽기 42초(4096px 5장, 노이즈 1.9%).
