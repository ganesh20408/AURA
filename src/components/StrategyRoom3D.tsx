import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DeliveryTask, OptimizedRouteCluster, Vehicle } from '../types/logistics';
import { ChevronDown, ChevronUp, Eye, Gauge, Compass, Box } from 'lucide-react';

interface StrategyRoom3DProps {
  vehicles: Vehicle[];
  tasks: DeliveryTask[];
  clusters: OptimizedRouteCluster[];
  onTriggerOptimize: () => void;
}

// Pre-allocated scratch math helpers at module scope to guarantee zero GC in render loop
const _truckPos = new THREE.Vector3();
const _truckLook = new THREE.Vector3();
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _dummyMatrix = new THREE.Matrix4();
const _dummyColor = new THREE.Color();
const _dummyScale = new THREE.Vector3();
const _dummyQuat = new THREE.Quaternion();
const _dummyPos = new THREE.Vector3();

type CameraPreset = 'overview' | 'cryoCorridor' | 'parnassusHub' | 'topDown';

const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: [number, number, number]; look: [number, number, number]; label: string }
> = {
  overview: {
    pos: [0, 34, 46],
    look: [0, 1.5, 0],
    label: 'Isometric Table Overview',
  },
  cryoCorridor: {
    pos: [24, 15, 22],
    look: [8, 2.5, -2],
    label: 'Mission Bay Cryo Corridor',
  },
  parnassusHub: {
    pos: [-26, 16, 20],
    look: [-10, 2.5, 2],
    label: 'Parnassus & Geary Hub',
  },
  topDown: {
    pos: [0, 56, 4],
    look: [0, 0, 0],
    label: 'Strategic Planimetric View',
  },
};

/**
 * Generates a 100% procedural high-contrast architectural city tabletop grid texture.
 */
function createProceduralTabletopTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // Deep obsidian blueprint slate base
  ctx.fillStyle = '#0c1424';
  ctx.fillRect(0, 0, 1024, 1024);

  // Subtle city block sub-grid
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.10)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let i = 0; i <= 1024; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  // Major arterial avenues
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 4;
  for (let i = 128; i < 1024; i += 128) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 1024);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i);
    ctx.stroke();
  }

  // Diagonal Market Street corridor
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(160, 864);
  ctx.lineTo(896, 128);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/**
 * Generates a procedural radial contact shadow texture so structures & vehicles sit flush on the table.
 */
function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
  grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds a composite 7-part procedural Hospital / Medical Laboratory 3D structure (THREE.Group)
 * pivoted at bottom-center (y = 0) with varied roughness/metalness across parts.
 */
function buildProceduralHospitalGroup(
  accentHex: number,
  heightScale: number,
  shadowTex: THREE.Texture,
  isSoftwareGl: boolean
): THREE.Group {
  const group = new THREE.Group();

  // 1. Contact Shadow Disc (flush with ground + 0.015)
  const shadowGeo = new THREE.CircleGeometry(3.4, 24);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.015;
  group.add(shadowMesh);

  // 2. Architectural Podium Base (matte concrete, roughness 0.8)
  const podiumGeo = new THREE.BoxGeometry(3.8, 0.7, 3.4);
  const podiumMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.82,
    metalness: 0.15,
  });
  const podium = new THREE.Mesh(podiumGeo, podiumMat);
  podium.position.y = 0.35;
  podium.castShadow = !isSoftwareGl;
  podium.receiveShadow = !isSoftwareGl;
  group.add(podium);

  // 3. Primary Beveled Clinical Tower (ExtrudeGeometry with bevels, metallic glass curtain wall, roughness 0.22)
  const towerShape = new THREE.Shape();
  const tw = 1.9;
  const td = 1.9;
  towerShape.moveTo(-tw / 2, -td / 2);
  towerShape.lineTo(tw / 2, -td / 2);
  towerShape.lineTo(tw / 2, td / 2);
  towerShape.lineTo(-tw / 2, td / 2);
  towerShape.closePath();

  const towerHeight = 3.8 * heightScale;
  const towerGeo = new THREE.ExtrudeGeometry(towerShape, {
    depth: towerHeight,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.12,
    bevelThickness: 0.12,
  });
  towerGeo.rotateX(-Math.PI / 2);

  const towerMat = new THREE.MeshPhysicalMaterial({
    color: 0x334155,
    roughness: 0.22,
    metalness: 0.78,
    clearcoat: 0.6,
  });
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.set(-0.45, 0.7, -0.2);
  tower.castShadow = !isSoftwareGl;
  tower.receiveShadow = !isSoftwareGl;
  group.add(tower);

  // 4. Secondary Diagnostic Lab Wing (brushed composite cladding, roughness 0.52)
  const wingH = 2.2 * heightScale;
  const wingGeo = new THREE.BoxGeometry(1.6, wingH, 2.2);
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.52,
    metalness: 0.42,
  });
  const wing = new THREE.Mesh(wingGeo, wingMat);
  wing.position.set(1.0, 0.7 + wingH / 2, 0.25);
  wing.castShadow = !isSoftwareGl;
  group.add(wing);

  // 5. Twin External Liquid Nitrogen (LN2) Cryo-Storage Silos (polished steel, metalness 0.9, roughness 0.18)
  const tankGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.6, 16);
  const tankMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.18,
    metalness: 0.9,
  });
  const tank1 = new THREE.Mesh(tankGeo, tankMat);
  tank1.position.set(1.25, 0.7 + 0.8, -1.05);
  const tank2 = new THREE.Mesh(tankGeo, tankMat);
  tank2.position.set(0.55, 0.7 + 0.8, -1.05);
  group.add(tank1, tank2);

  // 6. Rooftop Helipad Pad & Glowing Medical Cross Emblem
  const roofY = 0.7 + towerHeight + 0.14;
  const padGeo = new THREE.CylinderGeometry(0.85, 0.92, 0.12, 24);
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.6,
    metalness: 0.3,
  });
  const helipad = new THREE.Mesh(padGeo, padMat);
  helipad.position.set(-0.45, roofY, -0.2);
  group.add(helipad);

  const crossMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.85,
    roughness: 0.25,
  });
  const crossBar1 = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.22), crossMat);
  const crossBar2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.75), crossMat);
  crossBar1.position.set(-0.45, roofY + 0.07, -0.2);
  crossBar2.position.set(-0.45, roofY + 0.07, -0.2);
  group.add(crossBar1, crossBar2);

  // 7. Rooftop Telemetry Spire & Accent Halo Ring
  const spireGeo = new THREE.CylinderGeometry(0.04, 0.08, 1.1, 8);
  const spire = new THREE.Mesh(spireGeo, tankMat);
  spire.position.set(0.2, roofY + 0.55, -0.8);
  group.add(spire);

  const beaconOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 12),
    crossMat
  );
  beaconOrb.position.set(0.2, roofY + 1.12, -0.8);
  group.add(beaconOrb);

  return group;
}

/**
 * Builds a composite 8-part procedural Medical Courier Vehicle (THREE.Group)
 * with glowing telemetry beacon node, pivoted at bottom-center flush with the road (y = 0).
 */
function buildProceduralCourierTruck(
  routeColorHex: number,
  shadowTex: THREE.Texture
): THREE.Group {
  const truck = new THREE.Group();

  // 1. Contact Shadow
  const shadowGeo = new THREE.PlaneGeometry(2.2, 3.4);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.y = 0.02;
  truck.add(shadow);

  // 2. Lower Chassis Frame (matte dark alloy, roughness 0.75)
  const chassisMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.75,
    metalness: 0.4,
  });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.22, 2.5), chassisMat);
  chassis.position.set(0, 0.26, 0);
  truck.add(chassis);

  // 3. Insulated Cryo/Reefer Cargo Container (glossy clean white composite, roughness 0.2)
  const cargoShape = new THREE.Shape();
  cargoShape.moveTo(-0.56, -0.45);
  cargoShape.lineTo(0.56, -0.45);
  cargoShape.lineTo(0.56, 0.45);
  cargoShape.lineTo(-0.56, 0.45);
  cargoShape.closePath();

  const cargoGeo = new THREE.ExtrudeGeometry(cargoShape, {
    depth: 1.55,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.05,
    bevelThickness: 0.05,
  });
  const cargoMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    roughness: 0.18,
    metalness: 0.15,
    clearcoat: 0.8,
  });
  const cargoBox = new THREE.Mesh(cargoGeo, cargoMat);
  cargoBox.position.set(0, 0.82, -1.15);
  truck.add(cargoBox);

  // 4. Aerodynamic Forward Cab (metallic finish, roughness 0.45)
  const cabMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.45,
    metalness: 0.65,
  });
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.68, 0.72), cabMat);
  cab.position.set(0, 0.71, 0.82);
  truck.add(cab);

  // 5. Thermal Condenser / LN2 Cryo Unit on Front of Cargo Box
  const condenserMat = new THREE.MeshStandardMaterial({
    color: routeColorHex,
    emissive: routeColorHex,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.5,
  });
  const condenser = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.28, 0.35),
    condenserMat
  );
  condenser.position.set(0, 1.22, 0.38);
  truck.add(condenser);

  // 6. Glowing Active Telemetry Node Sphere on Roof (as requested in Module 4)
  const nodeGeo = new THREE.SphereGeometry(0.32, 16, 16);
  const nodeMat = new THREE.MeshStandardMaterial({
    color: routeColorHex,
    emissive: routeColorHex,
    emissiveIntensity: 1.35,
    roughness: 0.1,
  });
  const glowingNode = new THREE.Mesh(nodeGeo, nodeMat);
  glowingNode.position.set(0, 1.65, -0.35);
  truck.add(glowingNode);

  // 7. Telemetry Halo Ring around the node
  const haloGeo = new THREE.TorusGeometry(0.52, 0.04, 12, 28);
  haloGeo.rotateX(Math.PI / 2);
  const haloRing = new THREE.Mesh(haloGeo, condenserMat);
  haloRing.position.set(0, 1.65, -0.35);
  truck.add(haloRing);

  // 8. Four Wheel Assemblies
  const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.18, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelPositions: Array<[number, number, number]> = [
    [-0.58, 0.24, 0.75],
    [0.58, 0.24, 0.75],
    [-0.58, 0.24, -0.65],
    [0.58, 0.24, -0.65],
  ];
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, chassisMat);
    wheel.position.set(wx, wy, wz);
    truck.add(wheel);
  }

  return truck;
}

export const StrategyRoom3D: React.FC<StrategyRoom3DProps> = ({
  vehicles,
  tasks,
  clusters,
  onTriggerOptimize,
}) => {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);
  const [activePreset, setActivePreset] = useState<CameraPreset>('overview');
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [visibleThermals, setVisibleThermals] = useState<{
    Frozen: boolean;
    Refrigerated: boolean;
    Ambient: boolean;
  }>({
    Frozen: true,
    Refrigerated: true,
    Ambient: true,
  });

  // Mutable refs read inside the Three.js animation loop without re-mounting WebGLRenderer
  const speedRef = useRef<number>(1);
  const visibleThermalsRef = useRef(visibleThermals);
  const cameraTransitionRef = useRef<{
    active: boolean;
    targetPos: THREE.Vector3;
    targetLook: THREE.Vector3;
  }>({
    active: false,
    targetPos: new THREE.Vector3(...CAMERA_PRESETS.overview.pos),
    targetLook: new THREE.Vector3(...CAMERA_PRESETS.overview.look),
  });

  useEffect(() => {
    speedRef.current = speedMultiplier;
  }, [speedMultiplier]);

  useEffect(() => {
    visibleThermalsRef.current = visibleThermals;
  }, [visibleThermals]);

  // Keyboard shortcut 'H' to toggle Cinema / Zen Mode collapsible dock
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() === 'h' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        setIsDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSelectCameraPreset = (preset: CameraPreset) => {
    setActivePreset(preset);
    const cfg = CAMERA_PRESETS[preset];
    cameraTransitionRef.current.targetPos.set(...cfg.pos);
    cameraTransitionRef.current.targetLook.set(...cfg.look);
    cameraTransitionRef.current.active = true;
  };

  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software-WebGL detection from GPU renderer string
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 2. Scene, Camera, Fog & Studio Renderer Setup
    const scene = new THREE.Scene();
    const horizonHex = 0x09101d;
    scene.background = new THREE.Color(horizonHex);
    scene.fog = new THREE.FogExp2(horizonHex, 0.0085);

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.5, 220);
    camera.position.set(...CAMERA_PRESETS.overview.pos);
    camera.lookAt(...CAMERA_PRESETS.overview.look);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // 3. Studio Environment Reflection (RoomEnvironment + PMREMGenerator)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // 4. Warm Key Light + Cool Hemisphere Fill
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.85);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(28, 44, 24);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 5;
    keyLight.shadow.camera.far = 110;
    const d = 38;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rimLight.position.set(-30, 22, -28);
    scene.add(rimLight);

    // 5. OrbitControls with cancel-on-user-interaction for camera presets
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.minDistance = 12;
    controls.maxDistance = 85;
    controls.target.set(...CAMERA_PRESETS.overview.look);
    controls.addEventListener('start', () => {
      cameraTransitionRef.current.active = false;
    });

    // 6. Procedural Tabletop Base Pedestal & Grid Surface
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const tabletopTex = createProceduralTabletopTexture(maxAnisotropy);
    const contactShadowTex = createContactShadowTexture();

    const tableBaseGeo = new THREE.BoxGeometry(64, 1.4, 48);
    const tableBaseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.35,
    });
    const tableBase = new THREE.Mesh(tableBaseGeo, tableBaseMat);
    tableBase.position.y = -0.72;
    tableBase.receiveShadow = !isSoftwareGl;
    scene.add(tableBase);

    const gridTopGeo = new THREE.PlaneGeometry(62, 46);
    gridTopGeo.rotateX(-Math.PI / 2);
    const gridTopMat = new THREE.MeshStandardMaterial({
      map: tabletopTex,
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.2,
    });
    const gridTop = new THREE.Mesh(gridTopGeo, gridTopMat);
    gridTop.position.y = 0.0;
    gridTop.receiveShadow = !isSoftwareGl;
    scene.add(gridTop);

    // Metallic bevel rim around tabletop
    const rimBorderGeo = new THREE.BoxGeometry(64.6, 0.35, 48.6);
    const rimBorderMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.3,
      metalness: 0.8,
    });
    const rimBorder = new THREE.Mesh(rimBorderGeo, rimBorderMat);
    rimBorder.position.y = -0.18;
    scene.add(rimBorder);

    // 7. Surrounding Urban Context Blocks via InstancedMesh (> 20 instances, clear of avenue corridors)
    const contextBlockCoords: Array<[number, number, number, number]> = [];
    const avenueX = [-16, -15, -6, -3, 1, 5, 9, 11, 15, 18];
    const avenueZ = [-12, -10, -8, -6, -5, 5, 9, 13];
    for (let gx = -27; gx <= 27; gx += 4.5) {
      for (let gz = -18; gz <= 18; gz += 4.5) {
        const onRoadCorridor =
          avenueX.some((ax) => Math.abs(gx - ax) < 1.9) ||
          avenueZ.some((az) => Math.abs(gz - az) < 1.9);
        const nearHospital =
          (Math.abs(gx - 15) < 4.2 && Math.abs(gz - 5) < 4.2) ||
          (Math.abs(gx - 11) < 4.2 && Math.abs(gz - 13) < 4.2) ||
          (Math.abs(gx - -15) < 4.2 && Math.abs(gz - 5) < 4.2) ||
          (Math.abs(gx - -16) < 4.2 && Math.abs(gz - -6) < 4.2) ||
          (Math.abs(gx - 1) < 4.2 && Math.abs(gz - -5) < 4.2) ||
          (Math.abs(gx - -6) < 4.2 && Math.abs(gz - -8) < 4.2) ||
          (Math.abs(gx - 5) < 4.2 && Math.abs(gz - -10) < 4.2) ||
          (Math.abs(gx - 9) < 4.2 && Math.abs(gz - -12) < 4.2);
        if (!onRoadCorridor && !nearHospital) {
          const h = 0.65 + ((Math.abs(Math.round(gx * 7 + gz * 13)) % 10) / 10) * 1.75;
          contextBlockCoords.push([gx, gz, h, 0.78 + ((Math.abs(Math.round(gx + gz)) % 3) * 0.08)]);
        }
      }
    }

    const unitBoxGeo = new THREE.BoxGeometry(2.4, 1.0, 2.2);
    // Shift geometry so pivot is at bottom-center (y = 0)
    unitBoxGeo.translate(0, 0.5, 0);
    const instancedBlockMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.25,
    });
    const instancedCityBlocks = new THREE.InstancedMesh(
      unitBoxGeo,
      instancedBlockMat,
      contextBlockCoords.length
    );
    instancedCityBlocks.castShadow = !isSoftwareGl;
    instancedCityBlocks.receiveShadow = !isSoftwareGl;

    contextBlockCoords.forEach(([bx, bz, bh, bScale], idx) => {
      _dummyPos.set(bx, 0, bz);
      _dummyQuat.identity();
      _dummyScale.set(bScale, bh, bScale);
      _dummyMatrix.compose(_dummyPos, _dummyQuat, _dummyScale);
      instancedCityBlocks.setMatrixAt(idx, _dummyMatrix);

      const shade = 0.14 + (idx % 5) * 0.025;
      _dummyColor.setRGB(shade * 0.85, shade, shade * 1.35);
      instancedCityBlocks.setColorAt(idx, _dummyColor);
    });
    instancedCityBlocks.instanceMatrix.needsUpdate = true;
    if (instancedCityBlocks.instanceColor) {
      instancedCityBlocks.instanceColor.needsUpdate = true;
    }
    instancedCityBlocks.computeBoundingSphere();
    scene.add(instancedCityBlocks);

    // 8. Eight 7-Part Composite Hospital & Clinical Lab Landmarks
    const hospitalNodes: Array<{
      name: string;
      pos: [number, number];
      accent: number;
      scale: number;
    }> = [
      { name: 'UCSF Mission Bay Bio-Hub', pos: [15, 5], accent: 0x0284c7, scale: 1.25 },
      { name: 'Zuckerberg SF General Trauma', pos: [11, 13], accent: 0x38bdf8, scale: 1.1 },
      { name: 'UCSF Parnassus Central Lab', pos: [-15, 5], accent: 0x0d9488, scale: 1.3 },
      { name: 'Kaiser Geary Medical Center', pos: [-16, -6], accent: 0x14b8a6, scale: 1.05 },
      { name: 'CPMC Van Ness Campus', pos: [1, -5], accent: 0x6366f1, scale: 1.2 },
      { name: 'UCSF Helen Diller Oncology', pos: [-6, -8], accent: 0x0284c7, scale: 1.1 },
      { name: 'Saint Francis Memorial', pos: [5, -10], accent: 0x2dd4bf, scale: 0.95 },
      { name: 'Chinese Hospital SF', pos: [9, -12], accent: 0x818cf8, scale: 0.9 },
    ];

    hospitalNodes.forEach((h) => {
      const hGroup = buildProceduralHospitalGroup(
        h.accent,
        h.scale,
        contactShadowTex,
        isSoftwareGl
      );
      hGroup.position.set(h.pos[0], 0, h.pos[1]);
      scene.add(hGroup);
    });

    // 9. Mathematical Spline Route Paths & Active Courier Trucks
    const routeConfigs: Array<{
      temp: 'Frozen' | 'Refrigerated' | 'Ambient';
      colorHex: number;
      waypoints: THREE.Vector3[];
    }> = [
      {
        temp: 'Frozen',
        colorHex: 0x0284c7, // Sky Blue (-80C Cryo)
        waypoints: [
          new THREE.Vector3(15, 0.08, 5),
          new THREE.Vector3(15, 0.08, 13),
          new THREE.Vector3(11, 0.08, 13),
          new THREE.Vector3(1, 0.08, 13),
          new THREE.Vector3(1, 0.08, -8),
          new THREE.Vector3(-6, 0.08, -8),
          new THREE.Vector3(-6, 0.08, 5),
          new THREE.Vector3(15, 0.08, 5),
        ],
      },
      {
        temp: 'Refrigerated',
        colorHex: 0x14b8a6, // Teal (2-8C Reefer)
        waypoints: [
          new THREE.Vector3(-15, 0.08, 5),
          new THREE.Vector3(-16, 0.08, -6),
          new THREE.Vector3(-3, 0.08, -6),
          new THREE.Vector3(5, 0.08, -10),
          new THREE.Vector3(5, 0.08, 5),
          new THREE.Vector3(-15, 0.08, 5),
        ],
      },
      {
        temp: 'Ambient',
        colorHex: 0x6366f1, // Indigo (18-24C Ambient)
        waypoints: [
          new THREE.Vector3(1, 0.08, -5),
          new THREE.Vector3(9, 0.08, -12),
          new THREE.Vector3(18, 0.08, -12),
          new THREE.Vector3(18, 0.08, 9),
          new THREE.Vector3(1, 0.08, 9),
          new THREE.Vector3(1, 0.08, -5),
        ],
      },
    ];

    const activeTruckActors: Array<{
      temp: 'Frozen' | 'Refrigerated' | 'Ambient';
      curve: THREE.CatmullRomCurve3;
      truckGroup: THREE.Group;
      tubeMesh: THREE.Mesh;
      progress: number;
      speed: number;
    }> = [];

    routeConfigs.forEach((rc, idx) => {
      const curve = new THREE.CatmullRomCurve3(rc.waypoints, true, 'catmullrom', 0.18);
      const tubeGeo = new THREE.TubeGeometry(curve, 96, 0.12, 8, true);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: rc.colorHex,
        emissive: rc.colorHex,
        emissiveIntensity: 0.75,
        roughness: 0.25,
        metalness: 0.3,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      tubeMesh.position.y = 0.06;
      scene.add(tubeMesh);

      const truckGroup = buildProceduralCourierTruck(rc.colorHex, contactShadowTex);
      scene.add(truckGroup);

      activeTruckActors.push({
        temp: rc.temp,
        curve,
        truckGroup,
        tubeMesh,
        progress: idx * 0.31,
        speed: 0.048 + idx * 0.006,
      });
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 10. Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 11. Lossless Animation Loop with Software-WebGL afterDraw Pacing
    let frameId = 0;
    let isDisposed = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (isDisposed) return;
      const dt = Math.min(clock.getDelta(), 0.1);

      // Smooth exponential camera damping when preset transition is active
      if (cameraTransitionRef.current.active) {
        const alpha = 1 - Math.exp(-5.5 * dt);
        _camTargetPos.copy(cameraTransitionRef.current.targetPos);
        _camTargetLook.copy(cameraTransitionRef.current.targetLook);

        camera.position.lerp(_camTargetPos, alpha);
        controls.target.lerp(_camTargetLook, alpha);

        if (
          camera.position.distanceToSquared(_camTargetPos) < 0.04 &&
          controls.target.distanceToSquared(_camTargetLook) < 0.04
        ) {
          cameraTransitionRef.current.active = false;
        }
      }

      controls.update();

      // Advance courier vehicles along closed mathematical spline trajectories
      const vis = visibleThermalsRef.current;
      for (const actor of activeTruckActors) {
        const isVisible = vis[actor.temp];
        actor.truckGroup.visible = isVisible;
        actor.tubeMesh.visible = isVisible;

        if (isVisible) {
          actor.progress = (actor.progress + dt * actor.speed * speedRef.current) % 1;
          const nextT = (actor.progress + 0.012) % 1;

          actor.curve.getPointAt(actor.progress, _truckPos);
          actor.curve.getPointAt(nextT, _truckLook);

          actor.truckGroup.position.set(_truckPos.x, 0, _truckPos.z);
          _truckLook.y = 0;
          actor.truckGroup.lookAt(_truckLook);
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      tabletopTex.dispose();
      contactShadowTex.dispose();
      renderer.dispose();
    };
  }, []);

  const optimizedCount = tasks.filter((t) => t.status === 'Optimized').length;
  const statCount = tasks.filter((t) => t.priority === 'STAT').length;

  return (
    <div className="relative w-full h-[calc(100vh-57px)] bg-[#09101d] overflow-hidden select-none">
      {/* Dedicated WebGL Mount Container (100% Unobstructed Center) */}
      <div
        ref={canvasMountRef}
        data-testid="strategy-room-canvas"
        className="w-full h-full"
      />

      {/* Minimal Top-Left Spec Badge (No side-panel clutter, solid rgba surface, zero backdrop-filter) */}
      <div className="absolute top-4 left-4 z-10 bg-[#0f172a]/95 border border-slate-700/80 rounded-lg px-4 py-3 text-slate-100 shadow-lg max-w-md pointer-events-auto">
        <div className="flex items-center gap-2 text-xs font-mono text-sky-400">
          <Box className="w-3.5 h-3.5" />
          <span>DIGITAL TWIN TABLETOP · SAN FRANCISCO BIO-GRID</span>
        </div>
        <h2 className="text-sm font-bold text-white mt-1">
          Real-Time Multi-Stop Cold-Chain Spatial Telemetry
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-300 font-mono tabular-nums">
          <span>{vehicles.length} Active Courier Units</span>
          <span aria-hidden="true">·</span>
          <span>{tasks.length} Specimen Orders ({statCount} STAT)</span>
          <span aria-hidden="true">·</span>
          <span>{optimizedCount} Routed</span>
        </div>
      </div>

      {/* Unified Collapsible Bottom Control Dock (<= 15% viewport footprint, solid rgba surface) */}
      <div
        style={{
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: 'min(920px, 94vw)',
        }}
        className="fixed z-20 w-full pointer-events-auto flex flex-col items-center"
      >
        {/* Collapse / Expand Toggle Button */}
        <button
          type="button"
          onClick={() => setIsDockCollapsed((prev) => !prev)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#0f172a] hover:bg-slate-800 text-slate-200 border border-b-0 border-slate-700 rounded-t-lg text-xs font-medium transition-colors cursor-pointer"
        >
          {isDockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
              <span>▴ Show Controls (H)</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 text-sky-400" />
              <span>▾ Hide Controls (H)</span>
            </>
          )}
        </button>

        {/* Dock Body */}
        {!isDockCollapsed && (
          <div className="w-full bg-[#0f172a]/95 border border-slate-700 rounded-xl p-3.5 shadow-2xl text-slate-200 flex flex-wrap items-center justify-between gap-4">
            {/* Camera View Presets */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400 flex items-center gap-1 mr-1">
                <Compass className="w-3.5 h-3.5 text-sky-400" />
                Camera:
              </span>
              {(Object.keys(CAMERA_PRESETS) as CameraPreset[]).map((presetKey) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => handleSelectCameraPreset(presetKey)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    activePreset === presetKey
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {CAMERA_PRESETS[presetKey].label}
                </button>
              ))}
            </div>

            {/* Thermal Corridor Layer Toggles */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-400 flex items-center gap-1 mr-1">
                <Eye className="w-3.5 h-3.5 text-teal-400" />
                Corridors:
              </span>
              {(['Frozen', 'Refrigerated', 'Ambient'] as const).map((tier) => {
                const active = visibleThermals[tier];
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() =>
                      setVisibleThermals((prev) => ({ ...prev, [tier]: !prev[tier] }))
                    }
                    className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-slate-800 border-sky-500/70 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}
                  >
                    {tier}
                  </button>
                );
              })}
            </div>

            {/* Speed Multiplier & Sync Action */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
                <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                Speed:
              </span>
              {[0.5, 1, 2].map((spd) => (
                <button
                  key={spd}
                  type="button"
                  onClick={() => setSpeedMultiplier(spd)}
                  className={`px-2 py-1 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    speedMultiplier === spd
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {spd}x
                </button>
              ))}

              {clusters.length === 0 && (
                <button
                  type="button"
                  onClick={onTriggerOptimize}
                  className="ml-2 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Sync Solver Routes
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
