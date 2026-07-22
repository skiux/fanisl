import { Html } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  BufferGeometry,
  CatmullRomCurve3,
  Group,
  InstancedMesh,
  Line as ThreeLine,
  LineBasicMaterial,
  MathUtils,
  Object3D,
  Vector3,
} from 'three'
import { chapters } from './journey'

type Point3 = [number, number, number]

type SpatialSceneProps = {
  compact: boolean
  progress: RefObject<number>
}

const palette = {
  background: '#090c0a',
  ink: '#f1efe6',
  sage: '#91a47b',
  acid: '#c9dc91',
  lavender: '#938aa8',
  copper: '#b77853',
  graphite: '#263029',
}

const stagePositions = {
  entry: [0, 0, 0] as Point3,
  source: [-1.7, 0.15, -21] as Point3,
  units: [2, -0.15, -42] as Point3,
  node: [-1.8, 0.15, -63] as Point3,
  relations: [1.5, -0.15, -84] as Point3,
  library: [0, 0, -106] as Point3,
}

const JourneyProgressContext = createContext<RefObject<number> | null>(null)

const chapterByClass = {
  'entry-world': 0,
  'source-world': 1,
  'units-world': 2,
  'node-world': 3,
  'relations-world': 4,
  'library-world': 5,
} as const

function random(index: number, salt: number) {
  return ((Math.sin(index * 127.1 + salt * 311.7) * 43758.5453) % 1 + 1) % 1
}

function smooth(start: number, end: number, value: number) {
  if (end <= start) return value >= end ? 1 : 0
  return MathUtils.smootherstep(value, start, end)
}

function chapterReveal(value: number, index: number) {
  if (index === 0) return 1
  const previous = chapters[index - 1].stop
  const stop = chapters[index].stop
  const span = stop - previous
  return smooth(previous + span * 0.36, previous + span * 0.82, value)
}

function chapterExit(value: number, index: number) {
  if (index === chapters.length - 1) return 0
  const stop = chapters[index].stop
  const next = chapters[index + 1].stop
  const span = next - stop
  return smooth(stop + span * 0.08, stop + span * 0.4, value)
}

function chapterPresence(value: number, index: number) {
  return chapterReveal(value, index) * (1 - chapterExit(value, index))
}

function easeOutBack(value: number, strength: number) {
  const offset = value - 1
  const tension = 1.70158 * strength
  return 1 + (tension + 1) * offset * offset * offset + tension * offset * offset
}

const motionSpring: Record<string, number> = {
  'card-left': 0.34,
  'card-center': 0.42,
  'card-right': 0.34,
  'node-card': 0.26,
  number: 0.22,
  pop: 0.42,
}

function PathLine({ color = palette.sage, opacity = 0.25, points }: { color?: string; opacity?: number; points: Point3[] }) {
  const geometry = useMemo(
    () => new BufferGeometry().setFromPoints(points.map((point) => new Vector3(...point))),
    [points],
  )
  const material = useMemo(() => new LineBasicMaterial({ color, depthWrite: false, opacity, transparent: true }), [color, opacity])
  const line = useMemo(() => new ThreeLine(geometry, material), [geometry, material])

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  return <primitive object={line} />
}

function DustField({ compact }: { compact: boolean }) {
  const count = compact ? 320 : 920
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3)
    for (let index = 0; index < count; index += 1) {
      const angle = random(index, 1) * Math.PI * 2
      const radius = 2.5 + random(index, 2) * 10
      values[index * 3] = Math.cos(angle) * radius + (random(index, 3) - 0.5) * 1.5
      values[index * 3 + 1] = Math.sin(angle) * radius * 0.68
      values[index * 3 + 2] = 10 - random(index, 4) * 132
    }
    return values
  }, [count])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute args={[positions, 3]} attach="attributes-position" />
      </bufferGeometry>
      <pointsMaterial color="#c6c5b6" depthWrite={false} opacity={0.26} size={0.028} sizeAttenuation transparent />
    </points>
  )
}

function ArchiveTunnel({ compact }: { compact: boolean }) {
  const ringMesh = useRef<InstancedMesh>(null)
  const plateMesh = useRef<InstancedMesh>(null)
  const ribbonGroup = useRef<Group>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const ringCount = compact ? 30 : 54
  const plateCount = compact ? 58 : 128
  const rings = useMemo(() => Array.from({ length: ringCount }, (_, index) => ({
    phase: random(index, 20) * Math.PI * 2,
    radius: 6.1 + random(index, 21) * 2.7,
    speed: 0.035 + random(index, 22) * 0.045,
    x: (random(index, 23) - 0.5) * 1.4,
    y: (random(index, 24) - 0.5) * 1.1,
    z: 8 - index * (128 / ringCount),
  })), [ringCount])
  const plates = useMemo(() => Array.from({ length: plateCount }, (_, index) => ({
    angle: random(index, 30) * Math.PI * 2,
    depth: 8 - random(index, 31) * 130,
    height: 0.35 + random(index, 32) * 1.05,
    phase: random(index, 33) * Math.PI * 2,
    radius: 7.4 + random(index, 34) * 3.6,
    width: 0.1 + random(index, 35) * 0.34,
  })), [plateCount])
  const ribbons = useMemo(() => Array.from({ length: compact ? 3 : 6 }, (_, ribbonIndex) => {
    const phase = ribbonIndex * (Math.PI * 2 / (compact ? 3 : 6))
    const points = Array.from({ length: 24 }, (_, index) => {
      const z = 10 - index * 5.6
      const radius = 7.3 + Math.sin(index * 0.6 + phase) * 0.75
      const angle = phase + index * 0.34
      return new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.68, z)
    })
    return new CatmullRomCurve3(points, false, 'catmullrom', 0.35)
  }), [compact])

  useLayoutEffect(() => {
    rings.forEach((ring, index) => {
      dummy.position.set(ring.x, ring.y, ring.z)
      dummy.rotation.set(Math.sin(ring.phase) * 0.08, Math.cos(ring.phase) * 0.08, ring.phase)
      dummy.scale.set(ring.radius, ring.radius * (0.68 + Math.sin(ring.phase) * 0.04), 1)
      dummy.updateMatrix()
      ringMesh.current?.setMatrixAt(index, dummy.matrix)
    })
    plates.forEach((plate, index) => {
      dummy.position.set(Math.cos(plate.angle) * plate.radius, Math.sin(plate.angle) * plate.radius * 0.68, plate.depth)
      dummy.rotation.set(0, -plate.angle * 0.08, plate.angle + Math.PI / 2)
      dummy.scale.set(plate.width, plate.height, 0.08)
      dummy.updateMatrix()
      plateMesh.current?.setMatrixAt(index, dummy.matrix)
    })
    if (ringMesh.current) ringMesh.current.instanceMatrix.needsUpdate = true
    if (plateMesh.current) plateMesh.current.instanceMatrix.needsUpdate = true
  }, [dummy, plates, rings])

  useFrame(({ clock }) => {
    const time = clock.elapsedTime
    if (ringMesh.current) {
      rings.forEach((ring, index) => {
        const breathe = 1 + Math.sin(time * 0.18 + ring.phase) * 0.025
        dummy.position.set(ring.x + Math.sin(time * 0.07 + ring.phase) * 0.1, ring.y, ring.z)
        dummy.rotation.set(Math.sin(ring.phase) * 0.08, Math.cos(ring.phase) * 0.08, ring.phase + time * ring.speed)
        dummy.scale.set(ring.radius * breathe, ring.radius * (0.68 + Math.sin(ring.phase) * 0.04) * breathe, 1)
        dummy.updateMatrix()
        ringMesh.current?.setMatrixAt(index, dummy.matrix)
      })
      ringMesh.current.instanceMatrix.needsUpdate = true
    }
    if (plateMesh.current) {
      plates.forEach((plate, index) => {
        const angle = plate.angle + time * 0.003 * (index % 2 ? 1 : -1)
        const float = Math.sin(time * 0.16 + plate.phase) * 0.08
        dummy.position.set(Math.cos(angle) * plate.radius, Math.sin(angle) * plate.radius * 0.68 + float, plate.depth)
        dummy.rotation.set(0, -angle * 0.08, angle + Math.PI / 2)
        dummy.scale.set(plate.width, plate.height, 0.08)
        dummy.updateMatrix()
        plateMesh.current?.setMatrixAt(index, dummy.matrix)
      })
      plateMesh.current.instanceMatrix.needsUpdate = true
    }
    if (ribbonGroup.current) ribbonGroup.current.rotation.z = Math.sin(time * 0.055) * 0.035
  })

  return (
    <group>
      <instancedMesh args={[undefined, undefined, ringCount]} frustumCulled={false} ref={ringMesh}>
        <torusGeometry args={[1, 0.008, 4, 72]} />
        <meshBasicMaterial color={palette.copper} depthWrite={false} opacity={0.24} transparent />
      </instancedMesh>
      <instancedMesh args={[undefined, undefined, plateCount]} frustumCulled={false} ref={plateMesh}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={palette.graphite} emissive="#111712" emissiveIntensity={0.42} metalness={0.18} roughness={0.68} />
      </instancedMesh>
      <group ref={ribbonGroup}>
        {ribbons.map((curve, index) => (
          <mesh key={index}>
            <tubeGeometry args={[curve, 220, index % 2 ? 0.012 : 0.018, 5, false]} />
            <meshBasicMaterial color={index % 3 === 0 ? palette.sage : index % 3 === 1 ? palette.lavender : palette.copper} depthWrite={false} opacity={0.18} transparent />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function KnowledgeSeed() {
  const seed = useRef<Group>(null)
  const nodePositions = useMemo<Point3[]>(() => Array.from({ length: 11 }, (_, index) => {
    const angle = index * (Math.PI * 2 / 11)
    const radius = 2.4 + (index % 3) * 0.28
    return [Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72, Math.sin(angle * 2) * 0.55]
  }), [])

  useFrame(({ clock }, delta) => {
    if (!seed.current) return
    seed.current.rotation.y += delta * 0.045
    seed.current.rotation.z = Math.sin(clock.elapsedTime * 0.15) * 0.07
    seed.current.children.forEach((child, index) => {
      if (index < 2) return
      const pulse = 1 + Math.sin(clock.elapsedTime * 0.42 + index * 0.8) * 0.07
      child.scale.setScalar(pulse)
    })
  })

  return (
    <group position={[3.9, 0.15, -2.2]} ref={seed}>
      <mesh rotation={[0.3, 0.2, 0.1]}>
        <torusKnotGeometry args={[1.25, 0.21, 180, 24, 2, 3]} />
        <meshPhysicalMaterial clearcoat={0.35} color="#51614e" metalness={0.42} roughness={0.3} />
      </mesh>
      <mesh rotation={[0.1, -0.3, 0.2]}>
        <icosahedronGeometry args={[2.15, 2]} />
        <meshBasicMaterial color={palette.sage} depthWrite={false} opacity={0.18} transparent wireframe />
      </mesh>
      {nodePositions.map((position, index) => (
        <mesh key={index} position={position}>
          <sphereGeometry args={[index % 4 === 0 ? 0.11 : 0.065, 14, 14]} />
          <meshBasicMaterial color={index % 3 === 0 ? palette.copper : palette.acid} />
        </mesh>
      ))}
    </group>
  )
}

function SourceFragments({ progress }: { progress: RefObject<number> }) {
  const fragments = useRef<InstancedMesh>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const count = 18
  const data = useMemo(() => Array.from({ length: count }, (_, index) => ({
    x: (index % 2 ? -1 : 1) * (2.6 + random(index, 40) * 3.2),
    y: (random(index, 41) - 0.5) * 6,
    z: (random(index, 42) - 0.5) * 8,
    rx: (random(index, 43) - 0.5) * 0.35,
    ry: (random(index, 44) - 0.5) * 0.55,
    scale: 0.45 + random(index, 45) * 0.46,
  })), [])

  useLayoutEffect(() => {
    data.forEach((item, index) => {
      dummy.position.set(item.x * 0.18, item.y * 0.18, item.z * 0.18)
      dummy.rotation.set(0, 0, (index % 2 ? -1 : 1) * 0.5)
      dummy.scale.set(item.scale * 0.2, item.scale * 0.128, 0.045)
      dummy.updateMatrix()
      fragments.current?.setMatrixAt(index, dummy.matrix)
    })
    if (fragments.current) fragments.current.instanceMatrix.needsUpdate = true
  }, [data, dummy])

  useFrame(({ clock }) => {
    if (!fragments.current) return
    const reveal = chapterReveal(progress.current, 1)
    const spread = 0.18 + reveal * 0.82
    data.forEach((item, index) => {
      const delay = Math.min(0.7, index * 0.035)
      const itemReveal = smooth(delay, Math.min(1, delay + 0.32), reveal)
      dummy.position.set(item.x * spread, item.y * spread + Math.sin(clock.elapsedTime * 0.2 + index) * 0.06, item.z * spread)
      dummy.rotation.set(item.rx * itemReveal, item.ry * itemReveal, (index % 2 ? -1 : 1) * (1 - itemReveal) * 0.5)
      dummy.scale.set(item.scale * (0.2 + itemReveal * 0.8), item.scale * 0.64 * (0.2 + itemReveal * 0.8), 0.045)
      dummy.updateMatrix()
      fragments.current?.setMatrixAt(index, dummy.matrix)
    })
    fragments.current.instanceMatrix.needsUpdate = true
  })

  return (
    <group position={[stagePositions.source[0] + 0.4, stagePositions.source[1], stagePositions.source[2] - 1.5]}>
      <instancedMesh args={[undefined, undefined, count]} frustumCulled={false} ref={fragments}>
        <boxGeometry args={[2.05, 1.32, 1]} />
        <meshStandardMaterial color="#3b4037" emissive="#171b16" emissiveIntensity={0.35} metalness={0.08} roughness={0.78} />
      </instancedMesh>
    </group>
  )
}

function UnitConstellation() {
  const constellation = useRef<Group>(null)
  const units = [
    { color: palette.copper, position: [-4.2, -2.6, -1] as Point3 },
    { color: palette.lavender, position: [0.2, 2.8, -2.2] as Point3 },
    { color: palette.sage, position: [4.5, -1.7, -3.2] as Point3 },
  ]

  useFrame(({ clock }, delta) => {
    if (!constellation.current) return
    constellation.current.rotation.z = Math.sin(clock.elapsedTime * 0.09) * 0.045
    constellation.current.children.forEach((child, index) => {
      child.rotation.x += delta * (0.035 + index * 0.008)
      child.rotation.y += delta * (0.05 - index * 0.006)
      child.position.y = units[index].position[1] + Math.sin(clock.elapsedTime * 0.28 + index * 1.7) * 0.12
    })
  })

  return (
    <group position={[stagePositions.units[0], stagePositions.units[1], stagePositions.units[2] - 2]} ref={constellation}>
      {units.map((unit, index) => (
        <group key={unit.color} position={unit.position}>
          <mesh>
            <dodecahedronGeometry args={[0.58 + index * 0.08, 1]} />
            <meshPhysicalMaterial clearcoat={0.22} color={unit.color} metalness={0.32} roughness={0.38} />
          </mesh>
          <mesh rotation={[index * 0.4, index * 0.2, index * 0.6]}>
            <torusGeometry args={[1.05 + index * 0.1, 0.014, 6, 72]} />
            <meshBasicMaterial color={unit.color} depthWrite={false} opacity={0.48} transparent />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function MergeCore({ progress }: { progress: RefObject<number> }) {
  const mechanism = useRef<Group>(null)
  const startPositions = useMemo(() => [new Vector3(-4.4, 2.5, 0.5), new Vector3(4.2, 2.1, -0.6), new Vector3(0, -3.5, -1.2)], [])
  const target = useMemo(() => new Vector3(0, 0, 0), [])

  useFrame(({ clock }, delta) => {
    if (!mechanism.current) return
    const reveal = chapterReveal(progress.current, 3)
    const merge = smooth(0.18, 0.82, reveal)
    mechanism.current.rotation.y += delta * 0.035
    startPositions.forEach((start, index) => {
      const child = mechanism.current?.children[index]
      if (!child) return
      child.position.lerpVectors(start, target, merge * 0.68)
      child.position.y += Math.sin(clock.elapsedTime * 0.3 + index * 2) * 0.08
      child.rotation.z += delta * (index % 2 ? -0.08 : 0.07)
      child.scale.setScalar(0.72 + merge * 0.28)
    })
    const core = mechanism.current.children[3]
    if (core) {
      core.scale.setScalar(0.45 + merge * 0.55)
      core.rotation.z -= delta * 0.06
    }
  })

  return (
    <group position={[stagePositions.node[0] + 5.6, stagePositions.node[1] + 0.25, stagePositions.node[2] - 2]} ref={mechanism} scale={0.76}>
      {[palette.copper, palette.lavender, palette.sage].map((color, index) => (
        <group key={color} position={startPositions[index]}>
          <mesh>
            <octahedronGeometry args={[0.46, 1]} />
            <meshStandardMaterial color={color} metalness={0.38} roughness={0.36} />
          </mesh>
          <mesh rotation={[index * 0.4, index * 0.5, 0]}>
            <torusGeometry args={[0.8, 0.012, 5, 64]} />
            <meshBasicMaterial color={color} depthWrite={false} opacity={0.4} transparent />
          </mesh>
        </group>
      ))}
      <group>
        <mesh>
          <icosahedronGeometry args={[1.15, 3]} />
          <meshPhysicalMaterial clearcoat={0.28} color="#667b5b" metalness={0.46} roughness={0.28} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[1.7, 2]} />
          <meshBasicMaterial color={palette.acid} depthWrite={false} opacity={0.2} transparent wireframe />
        </mesh>
      </group>
    </group>
  )
}

const relationNodes: Point3[] = [
  [0, 0, 0],
  [-4.6, 2.4, -1.2],
  [4.2, 2.1, -2.3],
  [-4.1, -2.9, -3.3],
  [4.4, -2.5, -4.5],
  [0.2, 4, -5.5],
  [5.7, 0.2, -6.4],
  [-5.8, -0.1, -7.2],
]

function RelationNetwork({ progress }: { progress: RefObject<number> }) {
  const network = useRef<Group>(null)

  useFrame(({ clock }, delta) => {
    if (!network.current) return
    const reveal = chapterReveal(progress.current, 4)
    network.current.rotation.y = (1 - reveal) * -0.34 + Math.sin(clock.elapsedTime * 0.08) * 0.04
    network.current.rotation.z += delta * 0.008
    network.current.children.slice(0, relationNodes.length).forEach((child, index) => {
      const itemReveal = smooth(index * 0.045, 0.5 + index * 0.04, reveal)
      const target = relationNodes[index]
      child.position.set(target[0] * itemReveal, target[1] * itemReveal, target[2] * itemReveal)
      child.scale.setScalar(0.35 + itemReveal * 0.65 + Math.sin(clock.elapsedTime * 0.35 + index) * 0.025)
    })
  })

  return (
    <group position={[stagePositions.relations[0], stagePositions.relations[1], stagePositions.relations[2] - 2]} ref={network}>
      {relationNodes.map((_, index) => (
        <mesh key={index} position={[0, 0, 0]}>
          <sphereGeometry args={[index === 0 ? 0.5 : 0.12 + (index % 3) * 0.045, 18, 18]} />
          <meshStandardMaterial color={[palette.sage, palette.copper, palette.lavender, palette.acid][index % 4]} metalness={0.25} roughness={0.42} />
        </mesh>
      ))}
      {relationNodes.slice(1).map((node, index) => (
        <PathLine color={index % 3 === 0 ? palette.copper : index % 2 ? palette.lavender : palette.sage} key={index} opacity={0.42} points={[relationNodes[0], node]} />
      ))}
    </group>
  )
}

function ArchiveVault({ progress }: { progress: RefObject<number> }) {
  const vault = useRef<InstancedMesh>(null)
  const core = useRef<Group>(null)
  const dummy = useMemo(() => new Object3D(), [])
  const count = 48
  const spines = useMemo(() => Array.from({ length: count }, (_, index) => ({
    angle: -1.65 + index * (3.3 / (count - 1)),
    height: 1.5 + random(index, 70) * 3,
    radius: 5.4 + (index % 4) * 0.55,
    width: 0.12 + random(index, 71) * 0.18,
  })), [])

  useLayoutEffect(() => {
    spines.forEach((spine, index) => {
      const radius = spine.radius + 4
      dummy.position.set(Math.sin(spine.angle) * radius, -2.8 + spine.height * 0.5, Math.cos(spine.angle) * radius - 1)
      dummy.rotation.set(0, spine.angle, 0)
      dummy.scale.set(spine.width, 0, 0.35)
      dummy.updateMatrix()
      vault.current?.setMatrixAt(index, dummy.matrix)
    })
    if (vault.current) vault.current.instanceMatrix.needsUpdate = true
  }, [dummy, spines])

  useFrame(({ clock }, delta) => {
    if (vault.current) {
      const reveal = chapterReveal(progress.current, 5)
      spines.forEach((spine, index) => {
        const itemReveal = smooth(index * 0.012, 0.4 + index * 0.012, reveal)
        const radius = spine.radius + (1 - itemReveal) * 4
        dummy.position.set(Math.sin(spine.angle) * radius, -2.8 + spine.height * 0.5, Math.cos(spine.angle) * radius - 1)
        dummy.rotation.set(0, spine.angle, Math.sin(clock.elapsedTime * 0.08 + index) * 0.018)
        dummy.scale.set(spine.width, spine.height * itemReveal, 0.35)
        dummy.updateMatrix()
        vault.current?.setMatrixAt(index, dummy.matrix)
      })
      vault.current.instanceMatrix.needsUpdate = true
    }
    if (core.current) {
      core.current.rotation.y += delta * 0.025
      core.current.rotation.z -= delta * 0.012
    }
  })

  return (
    <group position={[stagePositions.library[0] + 2.5, stagePositions.library[1], stagePositions.library[2] - 1]}>
      <instancedMesh args={[undefined, undefined, count]} frustumCulled={false} ref={vault}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#354238" emissive="#151b16" emissiveIntensity={0.38} metalness={0.22} roughness={0.62} />
      </instancedMesh>
      <group position={[0, 0.2, -1.2]} ref={core}>
        <mesh>
          <sphereGeometry args={[1.15, 42, 42]} />
          <meshPhysicalMaterial clearcoat={0.5} color="#718664" metalness={0.48} roughness={0.24} />
        </mesh>
        {[1.65, 2.2, 2.85].map((radius, index) => (
          <mesh key={radius} rotation={[index * 0.55, index * 0.35, index * 0.8]}>
            <torusGeometry args={[radius, index === 0 ? 0.025 : 0.012, 6, 96]} />
            <meshBasicMaterial color={[palette.acid, palette.copper, palette.lavender][index]} depthWrite={false} opacity={0.42} transparent />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function WorldSection({ children, className, position, rotation = [0, 0, 0] }: {
  children: ReactNode
  className: string
  position: Point3
  rotation?: Point3
}) {
  const panel = useRef<HTMLElement>(null)
  const motionElements = useRef<HTMLElement[]>([])
  const introElapsed = useRef(0)
  const journeyProgress = useContext(JourneyProgressContext)
  const compact = useThree((state) => state.size.width <= 760)
  const chapterIndex = chapterByClass[className as keyof typeof chapterByClass]

  useFrame(({ clock }, delta) => {
    if (!panel.current || !journeyProgress) return
    introElapsed.current = Math.min(3.6, introElapsed.current + delta)
    const value = journeyProgress.current
    const presence = chapterPresence(value, chapterIndex)
    const exit = chapterExit(value, chapterIndex)
    let reveal = chapterReveal(value, chapterIndex)
    if (chapterIndex === 0) reveal *= smooth(0, 3.1, introElapsed.current)

    panel.current.style.opacity = presence.toFixed(4)
    panel.current.style.setProperty('--section-exit', exit.toFixed(4))

    if (motionElements.current.length === 0) {
      motionElements.current = Array.from(panel.current.querySelectorAll<HTMLElement>('[data-motion]'))
    }
    motionElements.current.forEach((element, index) => {
      const motion = element.dataset.motion ?? ''
      const delay = Number(element.dataset.motionDelay ?? Math.min(0.64, index * 0.052))
      const duration = Number(element.dataset.motionDuration ?? 0.32)
      const phase = MathUtils.clamp((reveal - delay) / duration, 0, 1)
      const eased = smooth(0, 1, phase)
      const spring = Number(element.dataset.motionSpring ?? motionSpring[motion] ?? 0)
      const movement = spring ? easeOutBack(phase, spring) : eased
      const idle = Number(element.dataset.motionIdle ?? 0)
      const settled = smooth(0.82, 1, eased) * (1 - exit)
      element.style.setProperty('--motion', movement.toFixed(4))
      element.style.setProperty('--motion-inverse', (1 - movement).toFixed(4))
      element.style.setProperty('--motion-exit', exit.toFixed(4))
      element.style.setProperty('--motion-opacity', eased.toFixed(4))
      element.style.setProperty('--drift-x', `${(Math.sin(clock.elapsedTime * 0.22 + index * 1.4) * idle * settled).toFixed(3)}px`)
      element.style.setProperty('--drift-y', `${(Math.cos(clock.elapsedTime * 0.18 + index * 0.9) * idle * 0.62 * settled).toFixed(3)}px`)
      element.style.setProperty('--drift-r', `${(Math.sin(clock.elapsedTime * 0.16 + index) * idle * 0.04 * settled).toFixed(4)}deg`)
    })
  })

  return (
    <group position={position} rotation={rotation}>
      <Html center distanceFactor={compact || className === 'entry-world' ? 6 : 4.7} transform wrapperClass="world-html" zIndexRange={[60, 0]}>
        <section className={`world-panel ${className}`} ref={panel}>{children}</section>
      </Html>
    </group>
  )
}

function EntryWorld() {
  return (
    <WorldSection className="entry-world" position={stagePositions.entry}>
      <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.02" data-motion-duration="0.22"><span>FANISL</span> · INVESTMENT KNOWLEDGE ENGINE</p>
      <h1>
        <span data-motion="line" data-motion-delay="0.08" data-motion-duration="0.34">内容不断流过。</span>
        <span data-motion="line" data-motion-delay="0.18" data-motion-duration="0.38"><em>知识留在这里。</em></span>
      </h1>
      <div className="entry-footer">
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.31" data-motion-duration="0.34">保存逐字证据，拆出判断、方法与认知，记录它们如何被重申、修正、反驳，并在到期后接受市场裁决。</p>
        <div className="entry-ledger" data-motion="ledger" data-motion-delay="0.4" data-motion-duration="0.42">
          <span data-motion="cell" data-motion-delay="0.48"><b>18</b>内容</span>
          <span data-motion="cell" data-motion-delay="0.54"><b>247</b>知识单元</span>
          <span data-motion="cell" data-motion-delay="0.6"><b>105</b>知识节点</span>
        </div>
      </div>
    </WorldSection>
  )
}

function SourceWorld() {
  return (
    <WorldSection className="source-world" position={stagePositions.source} rotation={[0, 0.08, -0.012]}>
      <div className="world-copy">
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.06">01 · CONTENT / IMMUTABLE</p>
        <h2><span data-motion="line" data-motion-delay="0.12">知识的第一层，</span><span data-motion="line" data-motion-delay="0.22">不是总结，是证据。</span></h2>
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.34">一期内容完整保留转录、画面信息、发布时间与信源。后面的任何结论，都能沿路径退回这段原文。</p>
      </div>
      <article className="evidence-sheet" data-motion="sheet" data-motion-delay="0.22" data-motion-duration="0.5" data-motion-idle="0.45">
        <header data-motion="rail" data-motion-delay="0.39"><span>CONTENT 018</span><small>16:42 · 逐字证据</small></header>
        <div className="evidence-title"><span data-motion="line" data-motion-delay="0.46">AI 与百年前的</span><strong data-motion="line" data-motion-delay="0.53">电力革命</strong></div>
        <blockquote data-motion="quote" data-motion-delay="0.61">真正改变生产率的，不是基础设施建成的那一天，而是组织方式开始随之变化。</blockquote>
        <footer data-motion="rail" data-motion-delay="0.72"><span>13,657 字转录</span><span>12 条画面笔记</span><span>原文不可变</span></footer>
      </article>
    </WorldSection>
  )
}

function UnitsWorld() {
  return (
    <WorldSection className="units-world" position={stagePositions.units} rotation={[0, -0.08, 0.012]}>
      <header className="world-heading">
        <div><p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">02 · EXTRACT / L1</p><h2><span data-motion="line" data-motion-delay="0.11">同一篇内容，</span><span data-motion="line" data-motion-delay="0.2">分流成三种知识。</span></h2></div>
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.3">每一条都携带逐字引文与出处，但进入不同的长期结构。</p>
      </header>
      <div className="unit-grid">
        <article className="claim" data-motion="card-left" data-motion-delay="0.3" data-motion-duration="0.42" data-motion-idle="0.5"><span>01 / CLAIM</span><strong data-motion="number" data-motion-delay="0.43">135</strong><b data-motion="rise" data-motion-delay="0.5">判断</b><p data-motion="paragraph" data-motion-delay="0.58">有方向、期限和冻结判据；到期后接受机械评分。</p></article>
        <article className="method" data-motion="card-center" data-motion-delay="0.39" data-motion-duration="0.45" data-motion-idle="0.72"><span>02 / METHOD</span><strong data-motion="number" data-motion-delay="0.51">23</strong><b data-motion="rise" data-motion-delay="0.58">方法</b><p data-motion="paragraph" data-motion-delay="0.66">可复述、执行和测试的研究规则。</p></article>
        <article className="concept" data-motion="card-right" data-motion-delay="0.48" data-motion-duration="0.43" data-motion-idle="0.56"><span>03 / CONCEPT</span><strong data-motion="number" data-motion-delay="0.6">89</strong><b data-motion="rise" data-motion-delay="0.67">认知</b><p data-motion="paragraph" data-motion-delay="0.74">可以跨越一次行情反复调用的理解。</p></article>
      </div>
    </WorldSection>
  )
}

function NodeWorld() {
  return (
    <WorldSection className="node-world" position={stagePositions.node} rotation={[0, 0.08, -0.01]}>
      <div className="world-copy">
        <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">03 · MERGE / EVOLUTION</p>
        <h2><span data-motion="line" data-motion-delay="0.12">表达会变化，</span><span data-motion="line" data-motion-delay="0.21">知识不丢失历史。</span></h2>
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.32">重申、细化、修正和反驳依次挂回同一节点；当前表述更新，旧证据仍然保留。</p>
      </div>
      <article className="node-card" data-motion="node-card" data-motion-delay="0.23" data-motion-duration="0.51" data-motion-idle="0.42">
        <header data-motion="rail" data-motion-delay="0.4"><span>NODE 005 · 认知</span><small>当前规范表述</small></header>
        <p><span data-motion="line" data-motion-delay="0.47">软件定价从席位制，</span><span data-motion="line" data-motion-delay="0.54">经过按量收费，</span><strong data-motion="quote" data-motion-delay="0.62">最终转向按结果收费。</strong></p>
        <div className="node-timeline" data-motion="rail" data-motion-delay="0.7">
          <span><i />05.31 首次提及</span><b>修正取代</b><span><i />06.21 更新节点</span>
        </div>
      </article>
    </WorldSection>
  )
}

function RelationsWorld() {
  return (
    <WorldSection className="relations-world" position={stagePositions.relations} rotation={[0, -0.07, 0.01]}>
      <header className="world-heading">
        <div><p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.05">04 · DISCOVER / RELATIONS</p><h2><span data-motion="line" data-motion-delay="0.12">不是更多摘要，</span><span data-motion="line" data-motion-delay="0.21">而是新的研究结构。</span></h2></div>
        <p className="world-summary" data-motion="paragraph" data-motion-delay="0.31">关系把不能同时成立的解释、可以互补的知识和跨信源共识推到视野中央。</p>
      </header>
      <div className="relation-stack">
        <article data-motion="relation-left" data-motion-delay="0.32"><i className="conflict" data-motion="pop" data-motion-delay="0.44" /><div><span>CONFLICTS</span><strong>对立</strong></div><p>数字地租已经改变周期<br />周期性涨法仍然存在</p><b>唯一一组</b></article>
        <article data-motion="relation-right" data-motion-delay="0.46"><i className="relates" data-motion="pop" data-motion-delay="0.58" /><div><span>RELATES</span><strong>互补</strong></div><p>不同尺度的知识拼合<br />读其一，应同时看另一</p><b>5 组</b></article>
        <article data-motion="relation-left" data-motion-delay="0.59"><i className="consensus" data-motion="pop" data-motion-delay="0.7" /><div><span>CROSS-SOURCE</span><strong>共识</strong></div><p>相同结构被不同信源<br />独立重复表达</p><b>持续发现</b></article>
      </div>
    </WorldSection>
  )
}

function LibraryWorld() {
  return (
    <WorldSection className="library-world" position={stagePositions.library}>
      <p className="world-eyebrow" data-motion="eyebrow" data-motion-delay="0.04">05 · THE LIBRARY / GROWING</p>
      <h2><span data-motion="line" data-motion-delay="0.1">库很小。</span><span data-motion="line" data-motion-delay="0.2"><em>但每一条都来路清楚。</em></span></h2>
      <p className="world-summary" data-motion="paragraph" data-motion-delay="0.33">它从 2 位信源、18 篇内容开始。规模不被夸大，证据、演进、关系与市场裁决共同决定一条知识能否留下。</p>
      <div className="library-ledger" data-motion="ledger" data-motion-delay="0.42" data-motion-duration="0.46">
        <span data-motion="cell" data-motion-delay="0.5"><b>2</b>信源</span><span data-motion="cell" data-motion-delay="0.57"><b>18</b>内容</span><span data-motion="cell" data-motion-delay="0.64"><b>247</b>单元</span><span data-motion="cell" data-motion-delay="0.71"><b>105</b>节点</span><span data-motion="cell" data-motion-delay="0.78"><b>62</b>已到期时点</span>
      </div>
      <footer data-motion="rise" data-motion-delay="0.82">逐字证据 · 冻结判据 · 演进历史 · 关系发现</footer>
    </WorldSection>
  )
}

function World({ compact, progress }: SpatialSceneProps) {
  const smoothProgress = useRef(0)
  const cameraCurve = useMemo(() => new CatmullRomCurve3([
    new Vector3(0, 0, 14),
    new Vector3(-1, 0.15, -8),
    new Vector3(1.2, -0.08, -29),
    new Vector3(-1.1, 0.18, -50),
    new Vector3(0.9, -0.12, -71),
    new Vector3(0, 0.12, -93),
    new Vector3(0, 0, -99),
  ], false, 'catmullrom', 0.38), [])
  const desiredPosition = useRef(new Vector3())
  const desiredTarget = useRef(new Vector3())
  const tangent = useRef(new Vector3())

  useFrame(({ camera, pointer }, delta) => {
    smoothProgress.current = MathUtils.damp(smoothProgress.current, progress.current, 4.5, delta)
    const value = MathUtils.clamp(smoothProgress.current, 0, 1)
    cameraCurve.getPointAt(value, desiredPosition.current)
    cameraCurve.getTangentAt(Math.min(0.999, value + 0.002), tangent.current)
    desiredTarget.current.copy(desiredPosition.current).addScaledVector(tangent.current, 8.5)
    desiredPosition.current.x += pointer.x * (compact ? 0.06 : 0.18)
    desiredPosition.current.y += pointer.y * (compact ? 0.04 : 0.11)
    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 5.4))
    camera.up.set(Math.sin(Math.sin(value * Math.PI * 5) * 0.025), 1, 0).normalize()
    camera.lookAt(desiredTarget.current)
  })

  return (
    <JourneyProgressContext.Provider value={progress}>
      <ambientLight color="#98a28e" intensity={0.7} />
      <directionalLight color="#d7c2a2" intensity={2.4} position={[4, 7, 8]} />
      <directionalLight color="#7f7891" intensity={1.1} position={[-6, -3, -38]} />
      <pointLight color="#a56f4c" distance={32} intensity={18} position={[4, -1, -66]} />
      <pointLight color="#8ca47a" distance={38} intensity={22} position={[-3, 2, -103]} />
      <DustField compact={compact} />
      <ArchiveTunnel compact={compact} />
      <KnowledgeSeed />
      <SourceFragments progress={progress} />
      <UnitConstellation />
      <MergeCore progress={progress} />
      <RelationNetwork progress={progress} />
      <ArchiveVault progress={progress} />
      <EntryWorld />
      <SourceWorld />
      <UnitsWorld />
      <NodeWorld />
      <RelationsWorld />
      <LibraryWorld />
    </JourneyProgressContext.Provider>
  )
}

export default function SpatialScene(props: SpatialSceneProps) {
  return (
    <Canvas
      aria-label="Fanisl 知识形成空间"
      camera={{ far: 170, fov: 43, near: 0.1, position: [0, 0, 14] }}
      dpr={[1, props.compact ? 1.15 : 1.55]}
      gl={{ alpha: false, antialias: true, powerPreference: 'high-performance' }}
    >
      <color args={[palette.background]} attach="background" />
      <fog args={[palette.background, 13, 46]} attach="fog" />
      <Suspense fallback={null}>
        <World {...props} />
      </Suspense>
    </Canvas>
  )
}
