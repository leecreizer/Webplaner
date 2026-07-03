import { useEffect, useState } from 'react';
import { Edges, Html } from '@react-three/drei';
import { useSpaceModuleStore, MODULE_PRESETS } from './spaceModuleStore';

const KIND_COLOR: Record<string, string> = {
  bedroom: '#93c5fd', living: '#fcd34d', kitchen: '#86efac',
  bath: '#a5f3fc', entrance: '#d8b4fe', corridor: '#e5e7eb', custom: '#f9a8d4',
};

/** 공간 모듈 배치/표시/선택 — Canvas 내부 전용. */
export function ModulePlacement() {
  const modules = useSpaceModuleStore((s) => s.modules);
  const selectedId = useSpaceModuleStore((s) => s.selectedId);
  const pendingKind = useSpaceModuleStore((s) => s.pendingKind);
  const [ghost, setGhost] = useState<[number, number] | null>(null);

  // ESC 로 배치 취소
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSpaceModuleStore.getState().setPendingKind(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <group>
      {/* 배치 모드: 투명 바닥 캐처 + 고스트 */}
      {pendingKind && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          onPointerMove={(e) => { e.stopPropagation(); setGhost([e.point.x, e.point.z]); }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            const s = useSpaceModuleStore.getState();
            s.add(pendingKind, e.point.x, e.point.z);
            s.setPendingKind(null);
            setGhost(null);
          }}
        >
          <planeGeometry args={[200, 200]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
      {pendingKind && ghost && (
        <mesh position={[ghost[0], 0.02, ghost[1]]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[MODULE_PRESETS[pendingKind].w, MODULE_PRESETS[pendingKind].d]} />
          <meshBasicMaterial color="#a78bfa" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}

      {/* 모듈 바닥 슬래브 + 라벨 + 선택 */}
      {modules.map((m) => {
        const rotY = (-m.ry * Math.PI) / 180;
        const sel = m.id === selectedId;
        return (
          <group key={m.id} position={[m.x, 0, m.z]} rotation={[0, rotY, 0]}>
            <mesh
              rotation={[-Math.PI / 2, 0, 0]}
              position={[0, 0.015, 0]}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                useSpaceModuleStore.getState().select(m.id);
              }}
            >
              <planeGeometry args={[m.w, m.d]} />
              <meshBasicMaterial
                color={KIND_COLOR[m.kind]}
                transparent opacity={sel ? 0.4 : 0.18} depthWrite={false}
              />
              {sel && <Edges scale={1.001} color="#a78bfa" />}
            </mesh>
            <Html center position={[0, 0.05, 0]} style={{ pointerEvents: 'none', fontSize: 11, color: '#334155', fontWeight: 600, textShadow: '0 0 3px #fff' }}>
              {m.name}
            </Html>
          </group>
        );
      })}
    </group>
  );
}
