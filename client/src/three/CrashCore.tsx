/**
 * Dashboard hero: the "crash core".
 *
 * An icosahedral prompt core built from 80 independent shards. A few shards are
 * "faulty" (red). Clicking the core (or a periodic auto-burst) blows the shards
 * apart; while they are separated the faults heal to the brand colour, then the
 * core reassembles. That is the product loop in miniature: crash, fix, retest.
 *
 * Purely decorative: it never displays data.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useInView, usePageVisible, type ThemeName } from "./hooks";
import { damp, glowTexture, rng } from "./util";

interface Energy {
  hover: number;
  burst: number;
  explode: number;
  healed: boolean;
  healedAt: number;
  lastBurst: number;
  auto: boolean;
}

// Brown & beige: caramel-to-sand shards, deep red faults, brown wireframe and probes.
const WARM = { a: "#5a2f17", b: "#c89a68", fault: "#b0200c", wire: "#6b3e22", glow: "#f0c45a", core: "#e8b23a", p1: "#8b4a24", p2: "#c79a6b", ring: "#8b4a24", probe: "#6b3e22", emissive: "#1c0c04", blend: THREE.NormalBlending };
const PALETTES = { dark: WARM, light: WARM } as const;
type Palette = (typeof PALETTES)[ThemeName];

const RADIUS = 1.15;

/* ---------------- Shards ---------------- */

interface Face {
  c: THREE.Vector3;
  rel: THREE.Vector3[];
  dir: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  dist: number;
  mix: number;
  fault: number;
  faultTarget: number;
  phase: number;
}

function Shards({ pal, energy }: { pal: Palette; energy: MutableRefObject<Energy> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const colors = useMemo(() => ({ a: new THREE.Color(pal.a), b: new THREE.Color(pal.b), fault: new THREE.Color(pal.fault) }), [pal]);

  const { geo, faces, rand } = useMemo(() => {
    const src = new THREE.IcosahedronGeometry(RADIUS, 1).toNonIndexed();
    const p = src.getAttribute("position");
    const n = p.count / 3;
    const rand = rng(11);
    const faces: Face[] = [];
    for (let i = 0; i < n; i++) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i * 3 + k));
      const c = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
      const faulty = rand() < 0.18 ? 1 : 0;
      faces.push({
        c,
        rel: v.map((x) => x.clone().sub(c)),
        dir: c.clone().normalize(),
        axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
        spin: (rand() - 0.5) * 5,
        dist: 0.55 + rand() * 1.25,
        mix: (c.y / RADIUS + 1) / 2,
        fault: faulty,
        faultTarget: faulty,
        phase: rand() * Math.PI * 2,
      });
    }
    src.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 9), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 9), 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
    return { geo, faces, rand };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);

  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), v: new THREE.Vector3(), col: new THREE.Color() }), []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const e = energy.current;

    // A fresh manual burst resets the timer. Otherwise auto-burst every ~11 s
    // when nobody is interacting, so the loop is visible.
    if (e.burst > 1.2) e.lastBurst = t;
    else if (e.auto && e.hover === 0 && t - e.lastBurst > 11) {
      e.burst = 1.1;
      e.lastBurst = t;
    }
    e.burst *= Math.exp(-dt * 1.15);
    const target = 0.035 + Math.sin(t * 1.4) * 0.02 + e.hover * 0.2 + e.burst;
    e.explode += (target - e.explode) * damp(5, dt);

    // Heal while separated; new faults appear a while after reassembly.
    if (!e.healed && e.explode > 0.55) {
      faces.forEach((f) => (f.faultTarget = 0));
      e.healed = true;
      e.healedAt = t;
    } else if (e.healed && e.explode < 0.2 && t - e.healedAt > 6.5) {
      faces.forEach((f) => (f.faultTarget = rand() < 0.16 ? 1 : 0));
      e.healed = false;
    }

    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    const fk = damp(e.healed ? 2.2 : 0.9, dt);

    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      f.fault += (f.faultTarget - f.fault) * fk;
      const ex = e.explode * f.dist;
      tmp.q.setFromAxisAngle(f.axis, e.explode * f.spin);
      const shrink = 1 - Math.min(0.35, e.explode * 0.22);
      for (let k = 0; k < 3; k++) {
        tmp.v.copy(f.rel[k]).applyQuaternion(tmp.q).multiplyScalar(shrink).add(f.c).addScaledVector(f.dir, ex);
        const o = i * 9 + k * 3;
        P[o] = tmp.v.x;
        P[o + 1] = tmp.v.y;
        P[o + 2] = tmp.v.z;
      }
      const pulse = 0.7 + 0.3 * Math.sin(t * 4 + f.phase);
      tmp.col.copy(colors.a).lerp(colors.b, f.mix).lerp(colors.fault, f.fault * pulse);
      for (let k = 0; k < 3; k++) {
        const o = i * 9 + k * 3;
        C[o] = tmp.col.r;
        C[o + 1] = tmp.col.g;
        C[o + 2] = tmp.col.b;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    if (mesh.current) {
      mesh.current.rotation.y += dt * 0.18;
      mesh.current.rotation.x = Math.sin(t * 0.3) * 0.15;
    }
  });

  return (
    <mesh ref={mesh} geometry={geo}>
      <meshStandardMaterial vertexColors flatShading metalness={0.35} roughness={0.28} emissive={pal.emissive} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ---------------- Supporting pieces ---------------- */

/** Polished gold globe at the centre: metallic, reflecting a studio environment, with a warm inner light. */
function Core({ pal, energy, tex }: { pal: Palette; energy: MutableRefObject<Energy>; tex: THREE.Texture }) {
  const halo = useRef<THREE.Sprite>(null);
  const haloMat = useRef<THREE.SpriteMaterial>(null);
  const inner = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const gl = useThree((s) => s.gl);

  // A procedural "studio room" reflection map makes the metal read as shiny gold.
  const envMap = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return env;
  }, [gl]);
  useEffect(() => () => envMap.dispose(), [envMap]);

  useFrame(({ clock }) => {
    const e = energy.current.explode;
    const t = clock.elapsedTime;
    halo.current?.scale.setScalar(2.2 + e * 2 + Math.sin(t * 2) * 0.1);
    if (haloMat.current) haloMat.current.opacity = Math.min(0.85, 0.35 + e * 0.4 + Math.sin(t * 2.4) * 0.05);
    if (inner.current) {
      inner.current.scale.setScalar(0.9 + e * 0.45 + Math.sin(t * 3) * 0.03);
      inner.current.rotation.y = t * 0.6;
      inner.current.rotation.x = t * 0.25;
    }
    // Inner golden light: lights the shards from inside, brighter while they are blown apart.
    if (glow.current) glow.current.intensity = 2.5 + e * 9 + Math.sin(t * 2.4) * 0.4;
  });

  return (
    <>
      <sprite ref={halo}>
        <spriteMaterial ref={haloMat} map={tex} color={pal.glow} transparent depthWrite={false} blending={pal.blend} />
      </sprite>
      <mesh ref={inner}>
        <icosahedronGeometry args={[0.42, 5]} />
        <meshPhysicalMaterial
          color={pal.core}
          metalness={1}
          roughness={0.16}
          clearcoat={1}
          clearcoatRoughness={0.08}
          envMap={envMap}
          envMapIntensity={1.6}
          emissive="#8a5a00"
          emissiveIntensity={0.35}
        />
      </mesh>
      <pointLight ref={glow} color="#ffc94d" distance={4} decay={1.5} />
    </>
  );
}

const sparkleVert = /* glsl */ `
  attribute float aPhase;
  attribute float aSize;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vTwinkle;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.5 + 0.5 * sin(uTime * (2.2 + fract(aPhase) * 2.5) + aPhase * 6.2831);
    vTwinkle = tw * tw * tw;
    gl_PointSize = aSize * uPixelRatio * (0.35 + vTwinkle) * (260.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const sparkleFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vTwinkle;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = pow(max(0.0, 1.0 - d * 2.0), 3.0);
    // four-point star flare
    float flare = max(0.0, 1.0 - abs(c.x) * 16.0) * max(0.0, 1.0 - abs(c.y) * 2.0)
                + max(0.0, 1.0 - abs(c.y) * 16.0) * max(0.0, 1.0 - abs(c.x) * 2.0);
    float a = (core + flare * 0.7) * vTwinkle;
    if (a < 0.02) discard;
    vec3 col = mix(uColor, vec3(1.0, 0.98, 0.88), core);
    gl_FragColor = vec4(col, min(a, 1.0));
  }
`;

/** Twinkling golden glints around the globe (some inside the shell, some just outside). */
function Sparkles({ energy }: { energy: MutableRefObject<Energy> }) {
  const ref = useRef<THREE.Points>(null);
  const dpr = useThree((s) => s.viewport.dpr);
  const { geo, uniforms } = useMemo(() => {
    const n = 90;
    const r = rng(42);
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const rad = 0.5 + Math.pow(r(), 0.8) * 1.6;
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = rad * Math.cos(ph);
      pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
      phase[i] = r() * 10;
      size[i] = 0.18 + r() * 0.32;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    return { geo, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#e0a420") }, uPixelRatio: { value: 1 } } };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame(({ clock }, dt) => {
    uniforms.uTime.value = clock.elapsedTime;
    uniforms.uPixelRatio.value = dpr;
    if (ref.current) {
      ref.current.rotation.y -= Math.min(dt, 0.05) * 0.12;
      ref.current.scale.setScalar(1 + energy.current.explode * 0.6);
    }
  });
  return (
    <points ref={ref} geometry={geo}>
      <shaderMaterial vertexShader={sparkleVert} fragmentShader={sparkleFrag} uniforms={uniforms} transparent depthWrite={false} />
    </points>
  );
}

function WireShell({ pal, energy }: { pal: Palette; energy: MutableRefObject<Energy> }) {
  const ref = useRef<THREE.LineSegments>(null);
  const geo = useMemo(() => {
    const ico = new THREE.IcosahedronGeometry(1.62, 1);
    const edges = new THREE.EdgesGeometry(ico);
    ico.dispose();
    return edges;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y -= Math.min(dt, 0.05) * 0.1;
    ref.current.rotation.z += Math.min(dt, 0.05) * 0.04;
    ref.current.scale.setScalar(1 + energy.current.explode * 0.4);
  });
  return (
    <lineSegments ref={ref} geometry={geo}>
      <lineBasicMaterial color={pal.wire} transparent opacity={0.18} depthWrite={false} />
    </lineSegments>
  );
}

const ORBITS: Array<{ r: number; tilt: [number, number, number]; speed: number; probes: number }> = [
  { r: 1.95, tilt: [1.25, 0, 0.35], speed: 0.5, probes: 3 },
  { r: 2.3, tilt: [0.45, 0.35, -0.9], speed: -0.36, probes: 3 },
  { r: 2.65, tilt: [1.75, 0.8, 0.5], speed: 0.24, probes: 2 },
];

function Orbit({ r, tilt, speed, probes, pal, energy, tex }: (typeof ORBITS)[number] & { pal: Palette; energy: MutableRefObject<Energy>; tex: THREE.Texture }) {
  const spin = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (spin.current) spin.current.rotation.z += Math.min(dt, 0.05) * speed * (1 + energy.current.explode * 2.5);
  });
  return (
    <group rotation={tilt}>
      <mesh>
        <torusGeometry args={[r, 0.0045, 6, 220]} />
        <meshBasicMaterial color={pal.ring} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <group ref={spin}>
        {Array.from({ length: probes }, (_, i) => {
          const a = (i / probes) * Math.PI * 2;
          return (
            <group key={i} position={[Math.cos(a) * r, Math.sin(a) * r, 0]}>
              <mesh>
                <octahedronGeometry args={[0.065, 0]} />
                <meshBasicMaterial color={pal.probe} toneMapped={false} />
              </mesh>
              <sprite scale={0.42}>
                <spriteMaterial map={tex} color={pal.probe} transparent depthWrite={false} blending={pal.blend} opacity={0.8} />
              </sprite>
            </group>
          );
        })}
      </group>
    </group>
  );
}

function Dust({ pal, tex }: { pal: Palette; tex: THREE.Texture }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = 650;
    const r = rng(3);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const c1 = new THREE.Color(pal.p1);
    const c2 = new THREE.Color(pal.p2);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const rad = 2.1 + Math.pow(r(), 0.7) * 3.2;
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      pos[i * 3] = rad * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = rad * Math.cos(ph) * 0.7;
      pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
      c.copy(c1).lerp(c2, r());
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, [pal]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += Math.min(dt, 0.05) * 0.03;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.06} map={tex} vertexColors transparent opacity={0.85} depthWrite={false} blending={pal.blend} sizeAttenuation />
    </points>
  );
}

/** Tilts the whole scene towards the pointer. */
function Rig({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((s, dt) => {
    if (!g.current) return;
    const k = damp(3, Math.min(dt, 0.05));
    g.current.rotation.x += (-s.pointer.y * 0.28 - g.current.rotation.x) * k;
    g.current.rotation.y += (s.pointer.x * 0.45 - g.current.rotation.y) * k;
  });
  return <group ref={g}>{children}</group>;
}

/* ---------------- Canvas ---------------- */

export default function CrashCore({ theme, animate }: { theme: ThemeName; animate: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const inView = useInView(wrap);
  const visible = usePageVisible();
  const energy = useRef<Energy>({ hover: 0, burst: 0, explode: 0, healed: false, healedAt: 0, lastBurst: 2, auto: animate });
  energy.current.auto = animate;
  const tex = useMemo(glowTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const pal = PALETTES[theme];
  const running = animate && inView && visible;

  const crash = () => {
    energy.current.burst = 1.3; // the frame loop resets the auto-burst timer
  };

  return (
    <div
      ref={wrap}
      className="hero-canvas"
      role="button"
      tabIndex={0}
      aria-label="Decorative 3D prompt core. Activate to crash it."
      onPointerEnter={() => (energy.current.hover = 1)}
      onPointerLeave={() => (energy.current.hover = 0)}
      onClick={crash}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          crash();
        }
      }}
    >
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0, 0, 5.6], fov: 42 }}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        frameloop={running ? "always" : "demand"}
      >
        {/* Soft, low lighting so the brown shards keep their colour on the beige page. */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 4, 5]} intensity={1.1} color="#fff1dc" />
        <pointLight position={[-3, -1.5, 2.5]} intensity={5} color={pal.b} />
        <pointLight position={[2.5, 2, 2]} intensity={4} color="#ffd9a8" />
        <Rig>
          <Core pal={pal} energy={energy} tex={tex} />
          <Shards pal={pal} energy={energy} />
          <Sparkles energy={energy} />
          <WireShell pal={pal} energy={energy} />
          {ORBITS.map((o, i) => (
            <Orbit key={i} {...o} pal={pal} energy={energy} tex={tex} />
          ))}
          <Dust pal={pal} tex={tex} />
        </Rig>
      </Canvas>
    </div>
  );
}
