import { useEffect, useState } from 'react';
import { useSpaceModuleStore } from './spaceModuleStore';
import { lastCompiled } from './syncModuleWalls';

/** 컴파일된 벽의 문/개구부 위치에 3D 표식을 오버레이 렌더 — 벽 컷아웃은 후속 스펙. */
export function OpeningMarkers() {
  const modules = useSpaceModuleStore((s) => s.modules);
  // syncModuleWalls 는 50ms debounce 후 lastCompiled 를 갱신하므로,
  // 모듈 변경 후 잠시 뒤 다시 렌더해 최신 컴파일 결과를 반영한다.
  const [, bump] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => bump((n) => n + 1), 80);
    return () => clearTimeout(timer);
  }, [modules]);

  const walls = lastCompiled.current;

  return (
    <group>
      {walls.map((wall, wi) => {
        const dx = wall.bx - wall.ax;
        const dz = wall.bz - wall.az;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len, uz = dz / len;
        const rotY = -Math.atan2(dz, dx);
        return wall.openings.map((op) => {
          const cx = wall.ax + ux * op.t;
          const cz = wall.az + uz * op.t;
          const isDoor = op.type === 'door';
          return (
            <group
              key={`${wi}-${op.openingId}`}
              position={[cx, op.height / 2, cz]}
              rotation={[0, rotY, 0]}
            >
              <mesh>
                {/* 문=갈색 프레임 박스(width×0.06×height), 개구부=하늘색 반투명 박스 */}
                <boxGeometry args={[op.width, op.height, isDoor ? 0.06 : 0.08]} />
                <meshStandardMaterial
                  color={isDoor ? '#92400e' : '#7dd3fc'}
                  transparent={!isDoor}
                  opacity={isDoor ? 1 : 0.4}
                />
              </mesh>
            </group>
          );
        });
      })}
    </group>
  );
}