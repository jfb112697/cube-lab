import { useEffect, useMemo, useRef, type CSSProperties, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, OrbitControls, RoundedBox } from '@react-three/drei';
import { AXES, AXIS_CSS, AXIS_HEX, SPACING, notate, quatFromDir } from './core';
import { useStore, type Selection } from './store';
import type { CubeEngine, StickerUd } from './engine';

/* ------------------------------------------------------------------ cubies */

function Cubie({ engine, cubie }: { engine: CubeEngine; cubie: (typeof engine.cubies)[number] }) {
  const group = useRef<THREE.Group>(null!);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useEffect(() => {
    engine.register(cubie.id, group.current);
  }, [engine, cubie.id]);

  const stickerMeta = useMemo(
    () =>
      cubie.stickers.map((st) => ({
        ud: { cubieId: cubie.id, normal: st.n, key: st.key } as StickerUd,
        q: quatFromDir(st.n),
        pos: st.n.clone().multiplyScalar(0.5),
      })),
    [cubie],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const now = performance.now();
    const { bands, hoveredKey, activeBand, armed, celebrateT } = engine.viz;
    for (let i = 0; i < cubie.stickers.length; i++) {
      const mat = mats.current[i];
      if (!mat) continue;
      const st = cubie.stickers[i];
      let target = 0;
      let color = 0xffffff;
      for (const b of bands) {
        if (Math.round(cubie.pos[b.axis]) === b.layer) {
          target = 0.45;
          color = AXIS_HEX[b.axis];
        }
      }
      // With a selection open, the armed band owns the highlight and the
      // other candidate layer drops to a faint glow — no row/column fight.
      if (armed) {
        if (Math.round(cubie.pos[armed.axis]) === armed.layer) {
          target = 0.6;
          color = AXIS_HEX[armed.axis];
        } else if (target > 0) {
          target = 0.12;
        }
      }
      if (activeBand && Math.round(cubie.pos[activeBand.axis]) === activeBand.layer) {
        target = 0.95;
        color = AXIS_HEX[activeBand.axis];
      }
      if (hoveredKey === st.key) {
        target = 1.3;
        color = 0xffffff;
      }
      const ct = (now - celebrateT) / 1000;
      if (ct >= 0 && ct < 2.6) {
        const wave = Math.cos(ct * 3.2 - cubie.pos.length() * 1.7);
        if (wave > 0) {
          const w = wave * 0.9;
          if (w > target) {
            target = w;
            color = 0xffffff;
          }
        }
      }
      mat.emissive.setHex(color);
      mat.emissiveIntensity += (target - mat.emissiveIntensity) * Math.min(1, dt * 12);
    }
  });

  const onDown = (e: ThreeEvent<PointerEvent>, ud: StickerUd) => {
    if (e.button !== 0) return;
    // Stop the ray here: stickers behind this one along the same ray
    // (far side of the cube) must not receive the click.
    e.stopPropagation();
    const st = useStore.getState();
    if (st.phase === 'busy' || engine.anim || engine.queue.length) return;
    engine.clickSelect(ud);
  };
  const onMove = (e: ThreeEvent<PointerEvent>, ud: StickerUd) => {
    // Front-most sticker under the cursor wins; occluded stickers along the
    // ray never see the event.
    e.stopPropagation();
    engine.hover(ud);
  };
  const onOut = (ud: StickerUd) => engine.clearHover(ud.key);

  return (
    <group ref={group} position={cubie.pos.clone().multiplyScalar(SPACING)}>
      <RoundedBox args={[1, 1, 1]} radius={0.075} smoothness={4} castShadow receiveShadow>
        <meshPhysicalMaterial
          color="#0b0c11"
          roughness={0.32}
          metalness={0.08}
          clearcoat={0.6}
          clearcoatRoughness={0.35}
          envMapIntensity={0.7}
        />
      </RoundedBox>
      {cubie.stickers.map((st, i) => {
        const m = stickerMeta[i];
        return (
          <RoundedBox
            key={st.key}
            args={[0.9, 0.9, 0.07]}
            radius={0.1}
            smoothness={3}
            position={m.pos}
            quaternion={m.q}
            userData={m.ud}
            onPointerDown={(e) => onDown(e, m.ud)}
            onPointerMove={(e) => onMove(e, m.ud)}
            onPointerOut={() => onOut(m.ud)}
          >
            <meshStandardMaterial
              ref={(el) => {
                mats.current[i] = el;
              }}
              color={st.color}
              roughness={0.2}
              metalness={0.05}
              emissive={st.color}
              emissiveIntensity={0}
              envMapIntensity={0.9}
            />
          </RoundedBox>
        );
      })}
    </group>
  );
}

function Cubies({ engine }: { engine: CubeEngine }) {
  const root = useRef<THREE.Group>(null!);
  useFrame(() => {
    const k = (performance.now() - engine.viz.popT) / 450;
    const s = k >= 0 && k < 1 ? 1 + 0.1 * Math.sin(k * Math.PI) : 1;
    root.current.scale.setScalar(s);
  });
  return (
    <group ref={root}>
      {engine.cubies.map((c) => (
        <Cubie key={c.id} engine={engine} cubie={c} />
      ))}
    </group>
  );
}

/* -------------------------------------------------------------- controller */

function Controller({ engine }: { engine: CubeEngine }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    | { enabled: boolean; autoRotate: boolean; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void }
    | null;
  const intro = useRef(0);
  const endPos = useMemo(() => camera.position.clone(), [camera]);
  const startPos = useMemo(() => camera.position.clone().multiplyScalar(1.5), [camera]);
  const cursor = useRef('');

  // Any manual orbit counts as interaction (pauses idle auto-rotate).
  useEffect(() => {
    if (!controls) return;
    const bump = () => {
      engine.lastInteract = performance.now();
    };
    controls.addEventListener('start', bump);
    return () => {
      controls.removeEventListener('start', bump);
    };
  }, [controls, engine]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    engine.tick(dt);

    // Cinematic dolly-in on load.
    if (intro.current < 1) {
      intro.current = Math.min(1, intro.current + dt / 1.6);
      const k = 1 - Math.pow(1 - intro.current, 3);
      camera.position.lerpVectors(startPos, endPos, k);
      camera.lookAt(0, 0, 0);
      if (controls) controls.enabled = intro.current >= 1;
      if (intro.current >= 1 && controls) controls.update();
    }

    const st = useStore.getState();

    // Idle auto-rotate pauses on any interaction.
    if (controls && intro.current >= 1) {
      const idle =
        performance.now() - engine.lastInteract > 9000 &&
        st.phase === 'idle' &&
        !st.selection &&
        !engine.anim &&
        engine.queue.length === 0;
      controls.autoRotate = idle;
    }

    const want = st.phase === 'hover' || st.phase === 'selected' ? 'pointer' : '';
    if (want !== cursor.current) {
      cursor.current = want;
      document.body.style.cursor = want;
    }
  });
  return null;
}

/* ------------------------------------------------------------- indicators */

function BandShell({ axis, layer, strong }: { axis: 'x' | 'y' | 'z'; layer: number; strong: boolean }) {
  const mountT = useRef(performance.now());
  const meshMat = useRef<THREE.MeshBasicMaterial>(null!);
  const lineMat = useRef<THREE.LineBasicMaterial>(null!);
  const group = useRef<THREE.Group>(null!);
  const size: [number, number, number] =
    axis === 'x' ? [1.16, 3.32, 3.32] : axis === 'y' ? [3.32, 1.16, 3.32] : [3.32, 3.32, 1.16];
  const edgeGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), [size]);
  const pos = useMemo(() => AXES[axis].clone().multiplyScalar(layer * SPACING), [axis, layer]);

  useFrame(({ clock }) => {
    const fade = Math.min(1, (performance.now() - mountT.current) / 0.12);
    const pulse = 0.8 + 0.2 * Math.sin(clock.elapsedTime * 3.2);
    if (meshMat.current) meshMat.current.opacity = (strong ? 0.085 : 0.05) * pulse * fade;
    if (lineMat.current) lineMat.current.opacity = (strong ? 0.9 : 0.45) * pulse * fade;
  });

  return (
    <group ref={group} position={pos}>
      <mesh renderOrder={5}>
        <boxGeometry args={size} />
        <meshBasicMaterial
          ref={meshMat}
          color={AXIS_HEX[axis]}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={edgeGeo} renderOrder={6}>
        <lineBasicMaterial
          ref={lineMat}
          color={AXIS_HEX[axis]}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

const ARC_R = 2.95;
const HALF_SPAN = 1.05;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const PLUS_Z = new THREE.Vector3(0, 0, 1);

function HalfArc({
  engine,
  band,
  sign,
  interactive,
  targetRef,
}: {
  engine: CubeEngine;
  band: { axis: 'x' | 'y' | 'z'; layer: number };
  sign: 1 | -1;
  interactive: boolean;
  targetRef: MutableRefObject<number>;
}) {
  const mountT = useRef(performance.now());
  const tubeMat = useRef<THREE.MeshBasicMaterial>(null!);
  const headMat = useRef<THREE.MeshBasicMaterial>(null!);
  const group = useRef<THREE.Group>(null!);
  const head = useRef<THREE.Mesh>(null!);

  const center = sign > 0 ? 0 : Math.PI;
  const start = center - HALF_SPAN;
  const headAngle = sign > 0 ? center + HALF_SPAN : center - HALF_SPAN;
  const headPos = useMemo(
    () => new THREE.Vector3(Math.cos(headAngle) * ARC_R, Math.sin(headAngle) * ARC_R, 0),
    [headAngle],
  );
  const headQuat = useMemo(() => {
    const t = new THREE.Vector3(
      sign > 0 ? -Math.sin(headAngle) : Math.sin(headAngle),
      sign > 0 ? Math.cos(headAngle) : -Math.cos(headAngle),
      0,
    ).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t);
  }, [headAngle, sign]);
  const color = AXIS_HEX[band.axis];

  useFrame(({ clock }) => {
    const fade = Math.min(1, (performance.now() - mountT.current) / 0.15);
    const ease = 1 - Math.pow(1 - fade, 3);
    const t = targetRef.current;
    const pulse = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 4);
    if (tubeMat.current) tubeMat.current.opacity = (0.3 + 0.7 * t) * pulse * ease;
    if (headMat.current) headMat.current.opacity = (0.45 + 0.55 * t) * pulse * ease;
    if (head.current) {
      const s = (0.9 + 0.35 * t) * ease;
      head.current.scale.setScalar(s);
    }
    if (group.current) group.current.scale.setScalar(0.75 + 0.25 * ease);
  });

  return (
    <group ref={group}>
      {/* visible arc */}
      <mesh rotation-z={start} raycast={() => null}>
        <torusGeometry args={[ARC_R, 0.05, 10, 64, HALF_SPAN * 2]} />
        <meshBasicMaterial
          ref={tubeMat}
          color={color}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* arrowhead */}
      <mesh ref={head} position={headPos} quaternion={headQuat} raycast={() => null}>
        <coneGeometry args={[0.115, 0.32, 12]} />
        <meshBasicMaterial
          ref={headMat}
          color={color}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* fat invisible collider for hover/click — only on the armed ring */}
      {interactive && (
        <mesh
          rotation-z={start + 0.06}
          onPointerOver={(e) => {
            e.stopPropagation();
            engine.setPreview(band, sign);
          }}
          onPointerOut={() => engine.clearPreview(band, sign)}
          onPointerDown={(e) => {
            e.stopPropagation();
            engine.commitFromPreview();
          }}
        >
          <torusGeometry args={[ARC_R, 0.3, 6, 28, HALF_SPAN * 2 - 0.12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

function ArcRing({ engine, band, armed }: { engine: CubeEngine; band: { axis: 'x' | 'y' | 'z'; layer: number }; armed: boolean }) {
  const group = useRef<THREE.Group>(null!);
  const plusT = useRef(0.15);
  const minusT = useRef(0.15);
  const trackMat = useRef<THREE.MeshBasicMaterial>(null!);

  const f = useMemo(() => new THREE.Vector3(), []);
  const right = useMemo(() => new THREE.Vector3(), []);
  const rhat = useMemo(() => new THREE.Vector3(), []);
  const lx = useMemo(() => new THREE.Vector3(), []);
  const ly = useMemo(() => new THREE.Vector3(), []);
  const align = useMemo(() => new THREE.Quaternion(), []);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const u = AXES[band.axis];
    // Orient the ring's halves toward the camera.
    camera.getWorldDirection(f);
    right.crossVectors(f, WORLD_UP);
    if (right.lengthSq() < 1e-6) right.crossVectors(f, u);
    right.normalize();
    rhat.copy(right).addScaledVector(u, -right.dot(u));
    if (rhat.lengthSq() > 1e-4) {
      rhat.normalize();
      align.setFromUnitVectors(PLUS_Z, u);
      lx.set(1, 0, 0).applyQuaternion(align);
      ly.crossVectors(u, lx).normalize();
      const spin = Math.atan2(rhat.dot(ly), rhat.dot(lx));
      group.current.quaternion.setFromAxisAngle(u, spin).multiply(align);
    }
    group.current.position.copy(u).multiplyScalar(band.layer * SPACING);
    if (trackMat.current) trackMat.current.opacity = armed ? 0.24 : 0.07;

    // Glow targets: the armed ring reacts to preview hover; the inert ring
    // stays dim so the two candidates never compete for attention.
    const p = engine.preview;
    const match = (sign: number) =>
      armed && p && p.target !== 0 && p.band.axis === band.axis && p.band.layer === band.layer && p.sign === sign
        ? 1
        : armed
          ? 0.14
          : 0.04;
    plusT.current += (match(1) - plusT.current) * 0.25;
    minusT.current += (match(-1) - minusT.current) * 0.25;
  });

  return (
    <group ref={group}>
      <mesh raycast={() => null}>
        <torusGeometry args={[ARC_R, 0.016, 6, 96]} />
        <meshBasicMaterial
          ref={trackMat}
          color={AXIS_HEX[band.axis]}
          transparent
          opacity={0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <HalfArc engine={engine} band={band} sign={1} interactive={armed} targetRef={plusT} />
      <HalfArc engine={engine} band={band} sign={-1} interactive={armed} targetRef={minusT} />
    </group>
  );
}

/**
 * The layer switch, pinned to the face of the clicked cubie. Each segment
 * names one overall-cube layer crossing that sticker (notation letter + axis
 * color); the active segment is the layer the ring arrows will spin.
 */
function FaceSwitch({ engine, selection }: { engine: CubeEngine; selection: Selection }) {
  const wrap = useRef<HTMLDivElement>(null!);
  const pos = useMemo(
    () => new THREE.Vector3(selection.anchor.x, selection.anchor.y, selection.anchor.z),
    [selection],
  );
  const normal = useMemo(
    () => new THREE.Vector3(selection.anchor.nx, selection.anchor.ny, selection.anchor.nz),
    [selection],
  );
  const camera = useThree((s) => s.camera);
  const dir = useMemo(() => new THREE.Vector3(), []);

  // Fade the switch out when its face turns away from the camera.
  useFrame(() => {
    if (!wrap.current) return;
    dir.copy(pos).sub(camera.position).normalize();
    const facing = normal.dot(dir) < -0.12;
    wrap.current.style.opacity = facing ? '1' : '0';
    wrap.current.style.pointerEvents = facing ? 'auto' : 'none';
  });

  return (
    <Html position={pos} center zIndexRange={[3, 0]}>
      <div ref={wrap} className="face-switch" style={{ opacity: 0 }}>
        {selection.bands.map((b, i) => (
          <button
            key={b.axis + b.layer}
            className={`face-switch-btn${i === selection.armed ? ' is-active' : ''}`}
            style={{ '--axis': AXIS_CSS[b.axis] } as CSSProperties}
            onClick={(e) => {
              e.stopPropagation();
              engine.armBand(i);
            }}
          >
            <i />
            {notate(b.axis, b.layer, 1)}
          </button>
        ))}
      </div>
    </Html>
  );
}

function Indicators({ engine }: { engine: CubeEngine }) {
  const hoverBands = useStore((s) => s.hoverBands);
  const selection = useStore((s) => s.selection);
  const phase = useStore((s) => s.phase);

  if (phase === 'busy') return null;
  const bands = selection ? selection.bands : hoverBands ?? [];

  return (
    <group>
      {bands.map((b, i) => (
        <BandShell
          key={`sh-${b.axis}${b.layer}`}
          axis={b.axis}
          layer={b.layer}
          strong={!!selection && i === selection.armed}
        />
      ))}
      {selection?.bands.map((b, i) => (
        <ArcRing key={`ar-${b.axis}${b.layer}`} engine={engine} band={b} armed={i === selection.armed} />
      ))}
      {selection && <FaceSwitch engine={engine} selection={selection} />}
    </group>
  );
}

/* -------------------------------------------------------------------- scene */

export default function Scene({ engine }: { engine: CubeEngine }) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [4.9, 4.0, 5.9], fov: 36 }}
      onPointerMissed={() => {
        const st = useStore.getState();
        if (st.phase === 'selected') engine.cancelSelection();
      }}
    >
      <ambientLight intensity={0.55} />
      <directionalLight position={[6, 9, 4]} intensity={1.3} />
      <directionalLight position={[-7, 3, -5]} intensity={0.35} color="#8fb4ff" />
      <pointLight position={[0, -5, 3]} intensity={12} color="#ffd9a0" distance={10} decay={2} />

      <Environment resolution={128}>
        <Lightformer form="rect" intensity={1.6} position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[9, 9, 1]} color="#cfe0ff" />
        <Lightformer form="rect" intensity={1.2} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[7, 3, 1]} color="#ffffff" />
        <Lightformer form="rect" intensity={0.9} position={[5, -1, -1]} rotation-y={-Math.PI / 2} scale={[7, 3, 1]} color="#ffe9d0" />
        <Lightformer form="circle" intensity={1.4} position={[0, 0, 6]} scale={[3, 3, 1]} color="#ffffff" />
      </Environment>

      <Controller engine={engine} />
      <Cubies engine={engine} />
      <Indicators engine={engine} />

      <ContactShadows position={[0, -2.95, 0]} opacity={0.6} scale={11} blur={2.6} far={4.5} resolution={512} color="#000000" />

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        minDistance={5.5}
        maxDistance={14}
        minPolarAngle={0.12}
        maxPolarAngle={Math.PI - 0.35}
        rotateSpeed={0.85}
        autoRotateSpeed={0.7}
      />
    </Canvas>
  );
}
