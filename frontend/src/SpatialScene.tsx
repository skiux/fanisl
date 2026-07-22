import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Fog,
  Group,
  Line as ThreeLine,
  LineBasicMaterial,
  MathUtils,
  Vector3,
} from 'three'

type SpatialSceneProps = {
  progress: RefObject<number>
  reducedDensity: boolean
}

type Point3 = [number, number, number]

const palette = {
  ink: '#263029',
  sage: '#8fa074',
  lime: '#dce8b9',
  lavender: '#c7c2dc',
  peach: '#e1b9a6',
  paper: '#f4f2ea',
}

function deterministic(index: number, salt: number) {
  return ((Math.sin(index * 127.1 + salt * 311.7) * 43758.5453) % 1 + 1) % 1
}

function PathLine({ color = palette.sage, opacity = 0.25, points }: { color?: string; opacity?: number; points: Point3[] }) {
  const geometry = useMemo(
    () => new BufferGeometry().setFromPoints(points.map((point) => new Vector3(...point))),
    [points],
  )
  const material = useMemo(() => new LineBasicMaterial({ color, opacity, transparent: true }), [color, opacity])
  const line = useMemo(() => new ThreeLine(geometry, material), [geometry, material])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  return <primitive object={line} />
}

function ParticleField({ count }: { count: number }) {
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = (deterministic(index, 1) - 0.5) * 25
      values[index * 3 + 1] = (deterministic(index, 2) - 0.5) * 15
      values[index * 3 + 2] = 5 - deterministic(index, 3) * 105
    }
    return values
  }, [count])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#74806f" opacity={0.32} size={0.035} sizeAttenuation transparent />
    </points>
  )
}

function DepthArchitecture() {
  return (
    <group>
      {[-5.8, -2.2, 2.2, 5.8].map((x, index) => (
        <PathLine
          color={index % 2 ? palette.lavender : palette.lime}
          key={x}
          opacity={0.16}
          points={[[x, -4.2, 7], [x * 0.72, -3.2, -98]]}
        />
      ))}
      {[-3.1, 3.1].map((y) => (
        <PathLine key={y} opacity={0.11} points={[[-8.2, y, 6], [-5.4, y * 0.7, -98]]} />
      ))}
    </group>
  )
}

function Portal() {
  const group = useRef<Group>(null)
  useFrame((_, delta) => {
    if (!group.current) return
    group.current.rotation.z += delta * 0.025
  })

  return (
    <group ref={group} position={[0, 0, 0]}>
      <mesh rotation={[0, 0, 0.18]}>
        <torusGeometry args={[4.65, 0.018, 8, 180]} />
        <meshBasicMaterial color={palette.sage} transparent opacity={0.32} />
      </mesh>
      <mesh rotation={[0.15, -0.12, -0.42]}>
        <torusGeometry args={[3.72, 0.014, 8, 160]} />
        <meshBasicMaterial color={palette.lavender} transparent opacity={0.34} />
      </mesh>
      <mesh rotation={[-0.16, 0.2, 0.72]}>
        <torusGeometry args={[2.85, 0.012, 8, 140]} />
        <meshBasicMaterial color={palette.peach} transparent opacity={0.3} />
      </mesh>
      {Array.from({ length: 9 }, (_, index) => {
        const angle = (index / 9) * Math.PI * 2
        const radius = 3.72
        return (
          <mesh key={index} position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]}>
            <sphereGeometry args={[index % 3 === 0 ? 0.075 : 0.035, 12, 12]} />
            <meshBasicMaterial color={index % 3 === 0 ? palette.sage : palette.ink} transparent opacity={0.62} />
          </mesh>
        )
      })}
    </group>
  )
}

function ContentPanel({ position, rotation, tone }: { position: Point3; rotation: Point3; tone: string }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[3.2, 2.05, 0.11]} />
        <meshStandardMaterial color={palette.paper} metalness={0.02} opacity={0.72} roughness={0.42} transparent />
      </mesh>
      <mesh position={[-0.92, 0.58, 0.075]}>
        <boxGeometry args={[0.92, 0.48, 0.025]} />
        <meshBasicMaterial color={tone} transparent opacity={0.7} />
      </mesh>
      {[0.22, -0.06, -0.34, -0.62].map((y, index) => (
        <mesh key={y} position={[-0.35 + index * 0.06, y, 0.075]}>
          <boxGeometry args={[2.05 - index * 0.22, 0.035, 0.02]} />
          <meshBasicMaterial color={palette.ink} transparent opacity={0.2} />
        </mesh>
      ))}
      <mesh position={[1.25, 0.77, 0.08]}>
        <circleGeometry args={[0.07, 18]} />
        <meshBasicMaterial color={tone} />
      </mesh>
    </group>
  )
}

function ContentField() {
  return (
    <group>
      <ContentPanel position={[-3.4, 0.65, -9]} rotation={[0.03, 0.25, -0.08]} tone={palette.sage} />
      <ContentPanel position={[3.2, -0.7, -13.5]} rotation={[-0.05, -0.26, 0.06]} tone={palette.lavender} />
      <ContentPanel position={[-2.8, -1.1, -18]} rotation={[-0.08, 0.2, 0.05]} tone={palette.peach} />
      <ContentPanel position={[2.6, 1.2, -20.5]} rotation={[0.07, -0.18, -0.04]} tone={palette.lime} />
      <PathLine color={palette.sage} opacity={0.2} points={[[-3.3, 0.2, -9.3], [-1.2, 0, -16], [0, 0, -24]]} />
      <PathLine color={palette.lavender} opacity={0.2} points={[[3.2, -0.8, -13.8], [1.4, -0.25, -19], [0, 0, -24]]} />
    </group>
  )
}

function KnowledgeUnit({ color, position, rotation }: { color: string; position: Point3; rotation: Point3 }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[1.35, 1.75, 0.15]} />
        <meshStandardMaterial color={color} metalness={0.02} opacity={0.68} roughness={0.38} transparent />
      </mesh>
      <mesh position={[0, 0, 0.1]}>
        <torusGeometry args={[0.33, 0.016, 8, 48]} />
        <meshBasicMaterial color={palette.ink} transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.11]}>
        <sphereGeometry args={[0.085, 16, 16]} />
        <meshBasicMaterial color={palette.ink} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

function UnitField() {
  return (
    <group>
      <KnowledgeUnit color={palette.peach} position={[-2.35, 0.15, -28.5]} rotation={[0.05, 0.18, -0.05]} />
      <KnowledgeUnit color={palette.lavender} position={[0, -0.45, -30]} rotation={[-0.06, -0.04, 0.03]} />
      <KnowledgeUnit color={palette.lime} position={[2.3, 0.35, -31.8]} rotation={[0.04, -0.2, 0.06]} />
      {Array.from({ length: 18 }, (_, index) => (
        <mesh
          key={index}
          position={[
            (deterministic(index, 4) - 0.5) * 7.6,
            (deterministic(index, 5) - 0.5) * 4.8,
            -25 - deterministic(index, 6) * 11,
          ]}
        >
          <sphereGeometry args={[0.025 + deterministic(index, 7) * 0.045, 10, 10]} />
          <meshBasicMaterial color={[palette.peach, palette.lavender, palette.lime][index % 3]} transparent opacity={0.62} />
        </mesh>
      ))}
      <PathLine color={palette.peach} opacity={0.2} points={[[-2.35, 0.15, -28.7], [-1.1, 0, -39], [0, 0, -45]]} />
      <PathLine color={palette.lavender} opacity={0.2} points={[[0, -0.45, -30.2], [0, -0.2, -39], [0, 0, -45]]} />
      <PathLine color={palette.lime} opacity={0.22} points={[[2.3, 0.35, -32], [1.2, 0.1, -40], [0, 0, -45]]} />
    </group>
  )
}

function MergeField() {
  const group = useRef<Group>(null)
  useFrame((_, delta) => {
    if (!group.current) return
    group.current.rotation.y += delta * 0.08
    group.current.rotation.x += delta * 0.025
  })

  return (
    <group position={[0, 0, -46]} ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.28, 2]} />
        <meshStandardMaterial color={palette.sage} metalness={0.05} opacity={0.48} roughness={0.25} transparent />
      </mesh>
      <mesh scale={1.33}>
        <icosahedronGeometry args={[1.28, 1]} />
        <meshBasicMaterial color={palette.ink} opacity={0.13} transparent wireframe />
      </mesh>
      {[2.15, 2.72, 3.35].map((radius, index) => (
        <mesh key={radius} rotation={[index * 0.35, index * 0.56, index * 0.24]}>
          <torusGeometry args={[radius, 0.012, 8, 100]} />
          <meshBasicMaterial color={[palette.lime, palette.lavender, palette.peach][index]} opacity={0.32} transparent />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, index) => {
        const angle = (index / 7) * Math.PI * 2
        return (
          <mesh key={index} position={[Math.cos(angle) * 2.75, Math.sin(angle) * 1.85, Math.sin(angle * 2) * 0.7]}>
            <sphereGeometry args={[index === 0 ? 0.14 : 0.07, 14, 14]} />
            <meshBasicMaterial color={index % 2 ? palette.lavender : palette.lime} />
          </mesh>
        )
      })}
    </group>
  )
}

const relationNodes: Point3[] = [
  [0, 0, -62.5],
  [-3.1, 1.5, -64],
  [3.35, 1.2, -65.5],
  [-2.4, -2.1, -67],
  [2.15, -1.9, -68.5],
  [0.25, 2.85, -69.5],
  [4.55, -0.3, -71],
  [-4.5, -0.2, -72],
]

function RelationField() {
  return (
    <group>
      {relationNodes.map((node, index) => (
        <group key={index} position={node}>
          <mesh>
            <sphereGeometry args={[index === 0 ? 0.48 : 0.18 + (index % 3) * 0.05, 22, 22]} />
            <meshStandardMaterial
              color={[palette.sage, palette.lavender, palette.peach, palette.lime][index % 4]}
              emissive={index === 0 ? palette.sage : '#000000'}
              emissiveIntensity={index === 0 ? 0.15 : 0}
              opacity={index === 0 ? 0.92 : 0.72}
              transparent
            />
          </mesh>
          {index === 0 && (
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.78, 0.014, 8, 80]} />
              <meshBasicMaterial color={palette.sage} opacity={0.34} transparent />
            </mesh>
          )}
        </group>
      ))}
      {[1, 2, 3, 4, 5, 6, 7].map((index) => (
        <PathLine
          color={index % 3 === 0 ? palette.peach : index % 2 ? palette.sage : palette.lavender}
          key={index}
          opacity={index % 3 === 0 ? 0.34 : 0.22}
          points={[relationNodes[0], relationNodes[index]]}
        />
      ))}
      <PathLine color={palette.lavender} opacity={0.16} points={[relationNodes[1], relationNodes[5], relationNodes[2]]} />
      <PathLine color={palette.peach} opacity={0.16} points={[relationNodes[3], relationNodes[4], relationNodes[6]]} />
    </group>
  )
}

function LibraryField() {
  const group = useRef<Group>(null)
  useFrame((_, delta) => {
    if (!group.current) return
    group.current.rotation.z -= delta * 0.018
  })

  return (
    <group position={[0, 0, -84]}>
      <group ref={group}>
        <mesh>
          <torusGeometry args={[4.4, 0.055, 12, 180]} />
          <meshStandardMaterial color={palette.sage} opacity={0.42} transparent />
        </mesh>
        <mesh rotation={[0.13, -0.2, 0.4]}>
          <torusGeometry args={[5.15, 0.015, 8, 180]} />
          <meshBasicMaterial color={palette.lavender} opacity={0.3} transparent />
        </mesh>
      </group>
      <mesh position={[0, 0, -0.25]}>
        <circleGeometry args={[3.85, 100]} />
        <meshStandardMaterial color="#dfe5d7" opacity={0.32} transparent />
      </mesh>
      {[[-2.6, 1.6, 0.2], [2.65, 1.3, -0.05], [-2.35, -1.75, -0.15], [2.45, -1.65, 0.1]].map((position, index) => (
        <group key={index} position={position as Point3}>
          <mesh>
            <sphereGeometry args={[0.22 + index * 0.015, 18, 18]} />
            <meshBasicMaterial color={[palette.lime, palette.lavender, palette.peach, palette.sage][index]} />
          </mesh>
          <mesh>
            <torusGeometry args={[0.48, 0.01, 8, 48]} />
            <meshBasicMaterial color={palette.ink} opacity={0.18} transparent />
          </mesh>
        </group>
      ))}
      <PathLine color={palette.sage} opacity={0.2} points={[[0, 0, 5], [0, 0, -8]]} />
    </group>
  )
}

function SpatialWorld({ progress, reducedDensity }: SpatialSceneProps) {
  const smoothProgress = useRef(0)
  const cameraCurve = useMemo(
    () => new CatmullRomCurve3([
      new Vector3(0, 0, 14),
      new Vector3(0.25, 0.12, 2),
      new Vector3(-0.8, 0.12, -13),
      new Vector3(0.9, -0.18, -29),
      new Vector3(-0.45, 0.16, -45),
      new Vector3(0.72, 0.05, -62),
      new Vector3(0, 0.08, -78),
    ]),
    [],
  )
  const targetCurve = useMemo(
    () => new CatmullRomCurve3([
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -8),
      new Vector3(0, 0, -21),
      new Vector3(0, 0, -37),
      new Vector3(0, 0, -53),
      new Vector3(0, 0, -70),
      new Vector3(0, 0, -90),
    ]),
    [],
  )
  const desiredPosition = useRef(new Vector3())
  const desiredTarget = useRef(new Vector3())
  const paper = useMemo(() => new Color('#f3f1e9'), [])
  const sage = useMemo(() => new Color('#e4e8de'), [])
  const mixedBackground = useRef(new Color())

  useFrame(({ camera, pointer, scene }, delta) => {
    smoothProgress.current = MathUtils.damp(smoothProgress.current, progress.current, 4.8, delta)
    const value = MathUtils.clamp(smoothProgress.current, 0, 1)
    cameraCurve.getPointAt(value, desiredPosition.current)
    targetCurve.getPointAt(value, desiredTarget.current)
    desiredPosition.current.x += pointer.x * 0.24
    desiredPosition.current.y += pointer.y * 0.16
    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 6))
    camera.lookAt(desiredTarget.current)

    mixedBackground.current.lerpColors(paper, sage, MathUtils.smoothstep(value, 0.66, 1))
    if (scene.background instanceof Color) scene.background.copy(mixedBackground.current)
    if (scene.fog instanceof Fog) scene.fog.color.copy(mixedBackground.current)
  })

  return (
    <>
      <ambientLight intensity={1.55} />
      <directionalLight color="#fffdf6" intensity={2.2} position={[4, 7, 10]} />
      <directionalLight color={palette.lavender} intensity={0.65} position={[-5, -2, -35]} />
      <ParticleField count={reducedDensity ? 280 : 620} />
      <DepthArchitecture />
      <Portal />
      <ContentField />
      <UnitField />
      <MergeField />
      <RelationField />
      <LibraryField />
    </>
  )
}

export default function SpatialScene(props: SpatialSceneProps) {
  return (
    <Canvas
      camera={{ far: 150, fov: 43, near: 0.1, position: [0, 0, 14] }}
      dpr={[1, props.reducedDensity ? 1.25 : 1.65]}
      fallback={<div className="webgl-fallback" />}
      gl={{ alpha: false, antialias: true, powerPreference: 'high-performance' }}
    >
      <color args={['#f3f1e9']} attach="background" />
      <fog args={['#f3f1e9', 13, 58]} attach="fog" />
      <Suspense fallback={null}>
        <SpatialWorld {...props} />
      </Suspense>
    </Canvas>
  )
}
