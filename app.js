import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const canvas = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
const fileInput = document.getElementById("file-input");
const loadButton = document.getElementById("load-button");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfaf7f1);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(0, 0, 60);

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (error) {
  setStatus("WebGL init failed. Try another browser.");
}

if (renderer) {
  renderer.setPixelRatio(isIOS ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xfaf7f1, 1);
}

const controls = renderer ? new OrbitControls(camera, renderer.domElement) : null;
if (controls) {
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 400;
  controls.target.set(0, 0, 0);
}

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
keyLight.position.set(20, 30, 40);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
fillLight.position.set(-30, -10, 20);
scene.add(fillLight);

let moleculeGroup = null;

const elementColors = {
  H: 0xf8fafc,
  C: 0x111827,
  N: 0x2563eb,
  O: 0xdc2626,
  F: 0x14b8a6,
  P: 0xf59e0b,
  S: 0xfacc15,
  Cl: 0x22c55e,
  Br: 0xfb923c,
  I: 0xa855f7,
  Cu: 0xb45309,
  Fe: 0xdc2626,
  Zn: 0x71717a,
  Na: 0x60a5fa,
  K: 0x7c3aed,
  Ca: 0x9ca3af,
  Mg: 0x34d399,
  Si: 0x94a3b8,
};

const covalentRadii = {
  H: 0.31,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Br: 1.2,
  I: 1.39,
  Cu: 1.32,
  Fe: 1.24,
  Zn: 1.22,
  Na: 1.66,
  K: 2.03,
  Ca: 1.76,
  Mg: 1.41,
  Si: 1.11,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function parseXYZ(contents) {
  const rawLines = contents.split(/\r?\n/);
  const lines = rawLines.map((line) => line.trim()).filter((line) => line.length);
  const atoms = [];
  if (!lines.length) return atoms;

  let startIndex = 0;
  let declaredCount = null;
  const firstLineCount = Number(lines[0]);
  if (Number.isFinite(firstLineCount)) {
    declaredCount = Math.max(0, Math.floor(firstLineCount));
    startIndex = 2;
  }

  for (let i = startIndex; i < lines.length; i += 1) {
    const parts = lines[i].split(/\s+/);
    if (parts.length < 4) continue;
    const element = parts[0];
    const x = Number(parts[1]);
    const y = Number(parts[2]);
    const z = Number(parts[3]);
    if (![x, y, z].every(Number.isFinite)) continue;
    atoms.push({ element, position: new THREE.Vector3(x, y, z) });
    if (declaredCount !== null && atoms.length >= declaredCount) break;
  }

  return atoms;
}

function buildMolecule(atoms) {
  const group = new THREE.Group();
  const atomMeshes = [];
  const atomSegments = isIOS ? 16 : 32;
  const bondSegments = isIOS ? 8 : 16;
  const atomGeometry = new THREE.SphereGeometry(0.6, atomSegments, atomSegments);

  atoms.forEach((atom) => {
    const color = elementColors[atom.element] ?? 0x9ca3af;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.1,
    });
    const radius = covalentRadii[atom.element] ?? 0.9;
    const sphere = new THREE.Mesh(atomGeometry, material);
    sphere.scale.setScalar(radius * 0.7 + 0.2);
    sphere.position.copy(atom.position);
    group.add(sphere);
    atomMeshes.push({ mesh: sphere, radius, element: atom.element });
  });

  const bondMaterial = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.4,
    metalness: 0.1,
  });

  const skipBonds = isIOS && atomMeshes.length > 1200;
  if (!skipBonds) {
    for (let i = 0; i < atomMeshes.length; i += 1) {
      for (let j = i + 1; j < atomMeshes.length; j += 1) {
        const a = atomMeshes[i];
        const b = atomMeshes[j];
        const threshold = (a.radius + b.radius) * 1.2;
        const distance = a.mesh.position.distanceTo(b.mesh.position);
        if (distance > 0.1 && distance <= threshold) {
          const bond = createBond(a.mesh.position, b.mesh.position, bondMaterial, bondSegments);
          group.add(bond);
        }
      }
    }
  }

  return group;
}

function createBond(start, end, material, radialSegments = 16) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const cylinderGeometry = new THREE.CylinderGeometry(0.12, 0.12, length, radialSegments);
  const cylinder = new THREE.Mesh(cylinderGeometry, material);
  const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  cylinder.position.copy(midpoint);
  cylinder.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize()
  );
  return cylinder;
}

function centerAndFrame(group) {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  group.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 1.8 + 10;
  camera.position.set(distance, distance * 0.6, distance);
  if (controls) {
    controls.target.set(0, 0, 0);
    controls.update();
  }
}

function clearMolecule() {
  if (!moleculeGroup) return;
  scene.remove(moleculeGroup);
  moleculeGroup.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  moleculeGroup = null;
}

function loadXYZ(contents, filename = "file.xyz") {
  clearMolecule();
  const atoms = parseXYZ(contents);
  if (!atoms.length) {
    setStatus("No atoms found. Check the XYZ file format.");
    return;
  }
  moleculeGroup = buildMolecule(atoms);
  scene.add(moleculeGroup);
  centerAndFrame(moleculeGroup);
  const bondNote = isIOS && atoms.length > 1200 ? " (bonds off on iOS)" : "";
  setStatus(`Loaded ${filename} (${atoms.length} atoms)${bondNote}.`);
  hudEl.style.display = "none";
}

function handleFile(file) {
  if (!file) return;
  setStatus(`Reading ${file.name} (${file.size} bytes)...`);
  const reader = new FileReader();
  reader.onload = () => loadXYZ(reader.result, file.name);
  reader.onerror = () => setStatus("Failed to read the file.");
  reader.readAsText(file);
}

function bindFileInput() {
  const input = document.getElementById("file-input");
  const button = document.getElementById("load-button");
  if (!input) return false;
  input.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setStatus("No file selected.");
      return;
    }
    handleFile(file);
  });
  input.addEventListener("input", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      setStatus(`Selected ${file.name} (${file.size} bytes). Tap Load if needed.`);
    }
  });
  if (button) {
    button.addEventListener("click", () => {
      const file = input.files?.[0];
      if (!file) {
        setStatus("No file selected. Tap Choose File first.");
        return;
      }
      handleFile(file);
    });
  }
  return true;
}

if (!bindFileInput()) {
  window.addEventListener("DOMContentLoaded", bindFileInput, { once: true });
}


window.addEventListener("dragover", (event) => {
  event.preventDefault();
  hudEl.classList.add("dragging");
});

window.addEventListener("dragleave", () => {
  hudEl.classList.remove("dragging");
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  hudEl.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  handleFile(file);
});

function resize() {
  if (!renderer) return;
  const container = canvas.parentElement;
  const rect = container?.getBoundingClientRect();
  const width = rect?.width || window.innerWidth;
  const height = rect?.height || window.innerHeight;
  if (!width || !height) {
    requestAnimationFrame(resize);
    return;
  }
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => {
  setTimeout(resize, 250);
});
resize();

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer) renderer.render(scene, camera);
}

if (renderer) {
  animate();
}
