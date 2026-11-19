/**
 * App-wide ambient 3D background: a receding "lab floor" grid that drifts towards
 * the viewer, floating motes, and a horizon glow. The camera reacts gently to the
 * mouse and to page scroll.
 *
 * Cost control: renders on demand at ~30 fps, stops when the tab is hidden or
 * motion is reduced (one static frame), and never captures pointer events.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { usePageVisible, type ThemeName } from "./hooks";
import { damp, glowTexture, rng } from "./util";

// Brown grid lines and floating specks on the beige page.
const WARM = { grid: "#7a4526", alpha: 0.2, mote1: "#8b4a24", mote2: "#c79a6b", glow: "#e3c7a2", glowOpacity: 0.55, blend: THREE.NormalBlending };
const THEMES = { dark: WARM, light: WARM } as const;
type Look = (typeof THEMES)[ThemeName];

const gridVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const gridFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec3 vWorld;
  float gridLine(vec2 p, float w) {
    vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
    return 1.0 - min(min(g.x, g.y) / w, 1.0);
  }
  void main() {
    vec2 p = vWorld.xz;
    p.y += uTime * 0.45;
    float fine = gridLine(p, 1.0) * 0.45;
    float major = gridLine(p * 0.2, 1.4);
    float d = length(vWorld.xz - vec2(0.0, 3.0));
    float fade = smoothstep(30.0, 4.0, d) * smoothstep(-1.0, 3.0, d);
    // a soft scanning pulse travelling across the floor
    float scan = smoothstep(0.0, 1.0, 1.0 - abs(fract((vWorld.z + uTime * 2.2) * 0.04) - 0.5) * 6.0) * 0.6;
    float a = max(fine, major) * fade * uAlpha * (1.0 + scan);
    gl_FragColor = vec4(uColor, a);
  }
`;

function Floor({ look }: { look: Look }) {
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color(look.grid) }, uAlpha: { value: look.alpha } }),
    [look],
  );
  useFrame((s) => {
    uniforms.uTime.value = s.clock.elapsedTime;
  });
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -1.9, -6]}>
      <planeGeometry args={[90, 70]} />
      <shaderMaterial vertexShader={gridVert} fragmentShader={gridFrag} uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
  );
}

function Motes({ look, tex }: { look: Look; tex: THREE.Texture }) {
  const n = 520;
  const { geo, speed } = useMemo(() => {
    const r = rng(29);
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const speed = new Float32Array(n);
    const c1 = new THREE.Color(look.mote1);
    const c2 = new THREE.Color(look.mote2);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() - 0.5) * 34;
      pos[i * 3 + 1] = -2 + r() * 11;
      pos[i * 3 + 2] = -26 + r() * 30;
      speed[i] = 0.06 + r() * 0.22;
      c.copy(c1).lerp(c2, r());
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return { geo, speed };
  }, [look]);
  useEffect(() => () => geo.dispose(), [geo]);
  useFrame((s, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    const P = attr.array as Float32Array;
    const t = s.clock.elapsedTime;
    for (let i = 0; i < n; i++) {
      P[i * 3 + 1] += speed[i] * dt;
      P[i * 3] += Math.sin(t * 0.3 + i) * 0.002;
      if (P[i * 3 + 1] > 9) P[i * 3 + 1] = -2;
    }
    attr.needsUpdate = true;
  });
  return (
    <points geometry={geo}>
      <pointsMaterial size={0.11} map={tex} vertexColors transparent opacity={0.7} depthWrite={false} blending={look.blend} sizeAttenuation />
    </points>
  );
}

function Horizon({ look, tex }: { look: Look; tex: THREE.Texture }) {
  return (
    <sprite position={[0, -0.6, -24]} scale={[60, 16, 1]}>
      <spriteMaterial map={tex} color={look.glow} transparent opacity={look.glowOpacity} depthWrite={false} blending={look.blend} />
    </sprite>
  );
}

/** Mouse + scroll parallax. Pointer is read from window because the canvas ignores events. */
function CameraRig() {
  const mouse = useRef({ x: 0, y: 0 });
  const scroll = useRef(0);
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onScroll = () => (scroll.current = window.scrollY);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  useFrame(({ camera }, dt) => {
    const k = damp(2, Math.min(dt, 0.1));
    const s = Math.min(scroll.current, 2400);
    camera.position.x += (mouse.current.x * 0.6 - camera.position.x) * k;
    camera.position.y += (1.1 - mouse.current.y * 0.25 - s * 0.0006 - camera.position.y) * k;
    camera.lookAt(0, 0.2 - s * 0.0004, -10);
  });
  return null;
}

/** Drives the demand frameloop at ~30 fps while active. */
function Ticker({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
    if (!active) return;
    const id = window.setInterval(() => invalidate(), 33);
    return () => window.clearInterval(id);
  }, [active, invalidate]);
  return null;
}

export default function BackgroundField({ theme, animate }: { theme: ThemeName; animate: boolean }) {
  const visible = usePageVisible();
  const tex = useMemo(glowTexture, []);
  useEffect(() => () => tex.dispose(), [tex]);
  const look = THEMES[theme];
  return (
    <div className="bg-canvas" aria-hidden="true">
      <Canvas dpr={[1, 1.5]} camera={{ position: [0, 1.1, 6], fov: 60 }} gl={{ antialias: false, alpha: true, powerPreference: "low-power" }} frameloop="demand">
        <Ticker active={animate && visible} />
        <CameraRig />
        <Horizon look={look} tex={tex} />
        <Floor look={look} />
        <Motes look={look} tex={tex} />
      </Canvas>
    </div>
  );
}
