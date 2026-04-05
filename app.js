(() => {
  window.__xyzViewerInitDone = false;

const canvas = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
const fileInput = document.getElementById("file-input");
const distanceLabel = document.getElementById("distance-label");
const selectionBoxEl = document.getElementById("selection-box");
const stageEl = document.querySelector(".stage");
const editToggle = document.getElementById("edit-toggle");
const exportButton = document.getElementById("export-button");
const rotateMoleculeToggle = document.getElementById("rotate-molecule-toggle");
const rotateToggle = document.getElementById("rotate-toggle");
const undoButton = document.getElementById("undo-button");
const toolboxEl = document.getElementById("toolbox");
const toolboxToggle = document.getElementById("toolbox-toggle");
const filePickerButton = document.getElementById("file-picker-button");
const fullscreenButton = document.getElementById("fullscreen-button");
const groupSelect = document.getElementById("group-select");
const addGroupButton = document.getElementById("add-group-button");

if (!window.THREE) {
  setStatus("THREE failed to load.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfaf7f1);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
camera.position.set(0, 0, 60);

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
if (!window.WebGLRenderingContext) {
  setStatus("WebGL not supported in this browser.");
}
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (error) {
  setStatus("WebGL init failed. Try another browser.");
}

if (renderer) {
  renderer.setPixelRatio(isIOS ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xfaf7f1, 1);
  if (renderer.getContext) {
    const gl = renderer.getContext();
    if (gl) {
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.98, 0.97, 0.95, 1.0);
    }
  }
}

function createFallbackControls(cameraInstance, domElement) {
  const target = new THREE.Vector3(0, 0, 0);
  const spherical = new THREE.Spherical();
  const pointer = { x: 0, y: 0, active: false };
  let lastTouchDistance = null;

  const updateSpherical = () => {
    const offset = new THREE.Vector3().subVectors(cameraInstance.position, target);
    spherical.setFromVector3(offset);
  };

  const applySpherical = () => {
    const offset = new THREE.Vector3().setFromSpherical(spherical);
    cameraInstance.position.copy(target).add(offset);
    cameraInstance.lookAt(target);
  };

  updateSpherical();

  const rotate = (dx, dy) => {
    spherical.theta -= dx * 0.005;
    spherical.phi -= dy * 0.005;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
    applySpherical();
  };

  const zoom = (delta) => {
    const factor = 1 + delta * 0.0015;
    spherical.radius = Math.max(2, Math.min(600, spherical.radius * factor));
    applySpherical();
  };

  domElement.addEventListener("pointerdown", (event) => {
    pointer.active = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    domElement.setPointerCapture?.(event.pointerId);
  });

  domElement.addEventListener("pointermove", (event) => {
    if (!pointer.active) return;
    rotate(event.clientX - pointer.x, event.clientY - pointer.y);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });

  domElement.addEventListener("pointerup", (event) => {
    pointer.active = false;
    domElement.releasePointerCapture?.(event.pointerId);
  });

  domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoom(event.deltaY);
    },
    { passive: false }
  );

  domElement.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length === 1) {
        const touch = event.touches[0];
        pointer.active = true;
        pointer.x = touch.clientX;
        pointer.y = touch.clientY;
      } else if (event.touches.length === 2) {
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        lastTouchDistance = Math.hypot(dx, dy);
      }
    },
    { passive: false }
  );

  domElement.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 1 && pointer.active) {
        const touch = event.touches[0];
        rotate(touch.clientX - pointer.x, touch.clientY - pointer.y);
        pointer.x = touch.clientX;
        pointer.y = touch.clientY;
        event.preventDefault();
      } else if (event.touches.length === 2) {
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const distance = Math.hypot(dx, dy);
        if (lastTouchDistance) {
          zoom(lastTouchDistance - distance);
        }
        lastTouchDistance = distance;
        event.preventDefault();
      }
    },
    { passive: false }
  );

  domElement.addEventListener(
    "touchend",
    () => {
      pointer.active = false;
      lastTouchDistance = null;
    },
    { passive: true }
  );

  return {
    target,
    update: () => {},
  };
}

const controls = renderer
  ? THREE.OrbitControls
    ? new THREE.OrbitControls(camera, renderer.domElement)
    : createFallbackControls(camera, renderer.domElement)
  : null;

if (controls && controls.enableDamping !== undefined) {
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
let bondGroup = null;
let atomMeshList = [];
let atomInfoList = [];
let selectedAtoms = [];
let editSelection = [];
let distanceLine = null;
let showBonds = true;
let bondsSkipped = false;
let editMode = false;
let rotateMoleculeMode = false;
let rotateMode = false;
let draggingAtom = null;
let dragOffset = null;
let dragPlane = null;
let dragGroup = null;
let dragStartPoint = null;
let dragInitialPositions = null;
let rotatingSelection = false;
let rotateCenter = null;
let rotateStartPositions = null;
let rotateLastPoint = null;
let rotateAccumAngle = 0;
let bondsHiddenForDrag = false;
let selecting = false;
let selectStart = null;
let addGroupMode = false;
let selectedGroupType = groupSelect?.value || "H";
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const tempVec = new THREE.Vector3();
const tempQuat = new THREE.Quaternion();
const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
const isIOSMobile = isIOSDevice && /Mobile/.test(navigator.userAgent);
const undoStack = [];
const UNDO_LIMIT = 20;
let pendingUndo = null;

function syncControlsEnabled() {
  if (!controls || controls.enabled === undefined) return;
  const allowOrbit = rotateMoleculeMode || !editMode;
  controls.enabled = allowOrbit;
  if (controls.enableRotate !== undefined) {
    controls.enableRotate = allowOrbit;
  }
  if (controls.enablePan !== undefined) {
    controls.enablePan = allowOrbit;
  }
  if (controls.enableZoom !== undefined) {
    controls.enableZoom = allowOrbit;
  }
}

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
  bondsSkipped = false;
  const group = new THREE.Group();
  const atomGroup = new THREE.Group();
  const bondGroupLocal = new THREE.Group();
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
    atomGroup.add(sphere);
    atomMeshes.push({ mesh: sphere, radius, element: atom.element });
  });

  const skipBonds = isIOS && atomMeshes.length > 1200;
  if (!skipBonds) {
    rebuildBonds(atomMeshes, bondGroupLocal, bondSegments);
  } else {
    bondsSkipped = true;
  }

  bondGroupLocal.visible = showBonds && !bondsSkipped;
  group.add(atomGroup);
  group.add(bondGroupLocal);
  bondGroup = bondGroupLocal;
  atomMeshList = atomMeshes.map((item) => item.mesh);
  atomInfoList = atomMeshes;
  return group;
}

function rebuildBonds(atomMeshes, bondGroupLocal, bondSegments = 16) {
  if (!bondGroupLocal) return;
  bondGroupLocal.children.forEach((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
  bondGroupLocal.clear();
  const bondMaterial = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.4,
    metalness: 0.1,
  });
  for (let i = 0; i < atomMeshes.length; i += 1) {
    for (let j = i + 1; j < atomMeshes.length; j += 1) {
      const a = atomMeshes[i];
      const b = atomMeshes[j];
      const threshold = (a.radius + b.radius) * 1.2;
      const distance = a.mesh.position.distanceTo(b.mesh.position);
      if (distance > 0.1 && distance <= threshold) {
        const bond = createBond(a.mesh.position, b.mesh.position, bondMaterial, bondSegments);
        bondGroupLocal.add(bond);
      }
    }
  }
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
  } else {
    camera.lookAt(0, 0, 0);
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
  bondGroup = null;
  atomMeshList = [];
  atomInfoList = [];
  clearMeasurement();
}

function clearMeasurement() {
  if (distanceLine && moleculeGroup) {
    moleculeGroup.remove(distanceLine);
    distanceLine.geometry.dispose();
    distanceLine.material.dispose();
  }
  distanceLine = null;
  selectedAtoms.forEach((mesh) => {
    if (mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(0x000000);
    }
  });
  selectedAtoms = [];
  if (distanceLabel) {
    distanceLabel.style.display = "none";
  }
}

function clearEditSelection() {
  editSelection.forEach((mesh) => {
    if (mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(0x000000);
    }
  });
  editSelection = [];
}

function setEditSelection(meshes) {
  clearEditSelection();
  meshes.forEach((mesh) => {
    if (mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(0x0f766e);
    }
  });
  editSelection = meshes;
}

function addToEditSelection(meshes) {
  const next = [...editSelection];
  meshes.forEach((mesh) => {
    if (next.includes(mesh)) return;
    if (mesh.material && mesh.material.emissive) {
      mesh.material.emissive.setHex(0x0f766e);
    }
    next.push(mesh);
  });
  editSelection = next;
}

function removeFromEditSelection(mesh) {
  if (!editSelection.includes(mesh)) return;
  if (mesh.material && mesh.material.emissive) {
    mesh.material.emissive.setHex(0x000000);
  }
  editSelection = editSelection.filter((item) => item !== mesh);
}

function pushUndoSnapshot(snapshot) {
  if (!snapshot) return;
  if (snapshot.type !== "add-group" && !snapshot.atoms?.length) return;
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_LIMIT) {
    undoStack.shift();
  }
}

function finalizeUndoSnapshot() {
  if (!pendingUndo) return;
  const { atoms, before } = pendingUndo;
  const after = atoms.map((mesh) => mesh.position.clone());
  const changed = after.some((pos, index) => pos.distanceTo(before[index]) > 1e-6);
  if (changed) {
    pushUndoSnapshot({ atoms, before, after });
  }
  pendingUndo = null;
}

function undoMove() {
  const snapshot = undoStack.pop();
  if (!snapshot) {
    setStatus("Nothing to undo.");
    return;
  }
  if (snapshot.type === "add-group") {
    snapshot.added.forEach((info) => {
      moleculeGroup.remove(info.mesh);
      info.mesh.geometry?.dispose();
      info.mesh.material?.dispose();
    });
    atomInfoList = atomInfoList.filter((info) => !snapshot.added.includes(info));
    atomMeshList = atomMeshList.filter((mesh) => !snapshot.added.some((info) => info.mesh === mesh));
    const anchorInfo = atomInfoList[snapshot.anchorIndex];
    if (anchorInfo) {
      anchorInfo.element = snapshot.anchorElement;
      anchorInfo.radius = snapshot.anchorRadius ?? anchorInfo.radius;
      if (snapshot.anchorPosition) {
        anchorInfo.mesh.position.copy(snapshot.anchorPosition);
      }
      applyAtomStyle(anchorInfo.mesh, anchorInfo.element);
    }
  } else {
    snapshot.atoms.forEach((mesh, index) => {
      mesh.position.copy(snapshot.before[index]);
    });
  }
  if (bondGroup && showBonds && !bondsSkipped) {
    rebuildBonds(atomInfoList, bondGroup, isIOS ? 8 : 16);
    bondGroup.visible = true;
  }
  updateMeasurementLine();
  setStatus("Undo complete.");
}

function updateDistanceLabel() {
  if (!distanceLine || !distanceLabel || !moleculeGroup) return;
  const positions = distanceLine.geometry.attributes.position.array;
  const midpoint = new THREE.Vector3(
    (positions[0] + positions[3]) / 2,
    (positions[1] + positions[4]) / 2,
    (positions[2] + positions[5]) / 2
  );
  const worldMid = moleculeGroup.localToWorld(midpoint.clone());
  const projected = worldMid.project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  const x = (projected.x * 0.5 + 0.5) * rect.width + rect.left;
  const y = (-projected.y * 0.5 + 0.5) * rect.height + rect.top;
  distanceLabel.style.transform = `translate(${x}px, ${y}px)`;
}

function updateMeasurementLine() {
  if (!distanceLine || selectedAtoms.length !== 2) return;
  const [a, b] = selectedAtoms;
  const positions = distanceLine.geometry.attributes.position.array;
  positions[0] = a.position.x;
  positions[1] = a.position.y;
  positions[2] = a.position.z;
  positions[3] = b.position.x;
  positions[4] = b.position.y;
  positions[5] = b.position.z;
  distanceLine.geometry.attributes.position.needsUpdate = true;
  const distance = a.position.distanceTo(b.position);
  if (distanceLabel) {
    distanceLabel.textContent = `${distance.toFixed(2)} A`;
  }
  updateDistanceLabel();
}


function selectAtom(mesh) {
  if (selectedAtoms.includes(mesh)) return;
  if (selectedAtoms.length === 2) {
    clearMeasurement();
  }
  if (mesh.material && mesh.material.emissive) {
    mesh.material.emissive.setHex(0x0f766e);
  }
  selectedAtoms.push(mesh);
  if (selectedAtoms.length === 2) {
    const [a, b] = selectedAtoms;
    const geometry = new THREE.BufferGeometry().setFromPoints([a.position, b.position]);
    const material = new THREE.LineBasicMaterial({ color: 0x0f766e });
    distanceLine = new THREE.Line(geometry, material);
    moleculeGroup.add(distanceLine);
    const distance = a.position.distanceTo(b.position);
    if (distanceLabel) {
      distanceLabel.textContent = `${distance.toFixed(2)} A`;
      distanceLabel.style.display = "block";
    }
    updateDistanceLabel();
  }
}

function pickAtom(clientX, clientY) {
  if (!renderer || !atomMeshList.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const intersections = raycaster.intersectObjects(atomMeshList, false);
  if (intersections.length) {
    selectAtom(intersections[0].object);
  }
}

function pickAtomForDrag(clientX, clientY) {
  if (!renderer || !atomMeshList.length) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const intersections = raycaster.intersectObjects(atomMeshList, false);
  return intersections.length ? intersections[0].object : null;
}

function getScreenPosition(mesh) {
  const rect = renderer.domElement.getBoundingClientRect();
  mesh.getWorldPosition(tempVec);
  tempVec.project(camera);
  return {
    x: (tempVec.x * 0.5 + 0.5) * rect.width,
    y: (-tempVec.y * 0.5 + 0.5) * rect.height,
  };
}

function getSelectionCenter() {
  if (!editSelection.length) return null;
  const center = new THREE.Vector3();
  editSelection.forEach((mesh) => {
    center.add(mesh.position);
  });
  center.divideScalar(editSelection.length);
  return center;
}

function getPointerAngle(clientX, clientY, centerWorld) {
  const rect = renderer.domElement.getBoundingClientRect();
  const centerScreen = centerWorld.clone().project(camera);
  const centerX = (centerScreen.x * 0.5 + 0.5) * rect.width;
  const centerY = (-centerScreen.y * 0.5 + 0.5) * rect.height;
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  return Math.atan2(py - centerY, px - centerX);
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
  resize();
  centerAndFrame(moleculeGroup);
  const bondNote = bondsSkipped ? " (bonds off on iOS)" : "";
  setStatus(`Loaded ${filename} (${atoms.length} atoms)${bondNote}.`);
  hudEl.style.display = "none";
  if (renderer) {
    renderer.render(scene, camera);
  }
}

function exportXYZ() {
  if (!atomInfoList.length) {
    setStatus("No atoms to export.");
    return;
  }
  const lines = [];
  lines.push(String(atomInfoList.length));
  lines.push("Exported from XYZ Viewer");
  atomInfoList.forEach((atom) => {
    const { element, mesh } = atom;
    const pos = mesh.position;
    lines.push(
      `${element} ${pos.x.toFixed(6)} ${pos.y.toFixed(6)} ${pos.z.toFixed(6)}`
    );
  });
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "export.xyz";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus("Exported XYZ file.");
}

function applyAtomStyle(mesh, element) {
  const color = elementColors[element] ?? 0x9ca3af;
  if (mesh.material && mesh.material.color) {
    mesh.material.color.setHex(color);
  }
  const radius = covalentRadii[element] ?? 0.9;
  mesh.scale.setScalar(radius * 0.7 + 0.2);
}

function createAtomMesh(element, position) {
  const segments = isIOS ? 16 : 32;
  const geometry = new THREE.SphereGeometry(0.6, segments, segments);
  const material = new THREE.MeshStandardMaterial({
    color: elementColors[element] ?? 0x9ca3af,
    roughness: 0.35,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  applyAtomStyle(mesh, element);
  return mesh;
}

const bondLengthMap = {
  "C-H": 1.09,
  "H-C": 1.09,
  "N-H": 1.03,
  "H-N": 1.03,
  "O-H": 0.98,
  "H-O": 0.98,
  "C-C": 1.54,
  "C-N": 1.47,
  "N-C": 1.47,
  "C-O": 1.43,
  "O-C": 1.43,
};

function getBondLength(elementA, elementB) {
  const key = `${elementA}-${elementB}`;
  if (bondLengthMap[key]) return bondLengthMap[key];
  const ra = covalentRadii[elementA] ?? 0.9;
  const rb = covalentRadii[elementB] ?? 0.9;
  return (ra + rb) * 1.1;
}

const groupTemplates = {
  H: { anchorElement: "H", atoms: [] },
  OH: {
    anchorElement: "O",
    atoms: [{ element: "H", position: new THREE.Vector3(0, 0, 0.98) }],
  },
  NH2: {
    anchorElement: "N",
    atoms: (() => {
      const bond = 1.03;
      const theta = (107 * Math.PI) / 360;
      return [
        { element: "H", position: new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta)).multiplyScalar(bond) },
        { element: "H", position: new THREE.Vector3(-Math.sin(theta), 0, Math.cos(theta)).multiplyScalar(bond) },
      ];
    })(),
  },
  CH3: {
    anchorElement: "C",
    atoms: (() => {
      const bond = 1.09;
      const dirs = [
        new THREE.Vector3(1, 1, 1),
        new THREE.Vector3(-1, -1, 1),
        new THREE.Vector3(-1, 1, -1),
      ];
      return dirs.map((dir) => ({
        element: "H",
        position: dir.normalize().multiplyScalar(bond),
      }));
    })(),
  },
  COOH: {
    anchorElement: "C",
    atoms: [
      { element: "O", position: new THREE.Vector3(0, 0, 1.23) },
      { element: "O", position: new THREE.Vector3(1.36, 0, -0.2) },
      { element: "H", position: new THREE.Vector3(1.36, 0, 0.78) },
    ],
  },
  Ph: {
    anchorElement: "C",
    atoms: (() => {
      const radius = 1.4;
      const hBond = 1.09;
      const atoms = [];
      const anchor = new THREE.Vector3(radius, 0, 0);
      for (let i = 1; i < 6; i += 1) {
        const angle = (i * Math.PI) / 3;
        const ringPos = new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0);
        const pos = ringPos.clone().sub(anchor);
        atoms.push({ element: "C", position: pos });
        const hPos = ringPos
          .clone()
          .normalize()
          .multiplyScalar(radius + hBond)
          .sub(anchor);
        atoms.push({ element: "H", position: hPos });
      }
      return atoms;
    })(),
  },
  Cyclohexyl: {
    anchorElement: "C",
    atoms: (() => {
      const radius = 1.54;
      const atoms = [];
      const anchor = new THREE.Vector3(radius, 0, 0);
      for (let i = 1; i < 6; i += 1) {
        const angle = (i * Math.PI) / 3;
        const pos = new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0).sub(anchor);
        atoms.push({ element: "C", position: pos });
      }
      return atoms;
    })(),
  },
  Cyclopentyl: {
    anchorElement: "C",
    atoms: (() => {
      const radius = 1.54;
      const atoms = [];
      const anchor = new THREE.Vector3(radius, 0, 0);
      for (let i = 1; i < 5; i += 1) {
        const angle = (i * 2 * Math.PI) / 5;
        const pos = new THREE.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 0).sub(anchor);
        atoms.push({ element: "C", position: pos });
      }
      return atoms;
    })(),
  },
};

function computeNeighborDirection(anchorIndex) {
  const anchorPos = atomInfoList[anchorIndex].mesh.position;
  const neighbors = atomInfoList
    .map((info, idx) => ({ idx, mesh: info.mesh }))
    .filter((item) => item.idx !== anchorIndex)
    .map((item) => ({
      idx: item.idx,
      distance: item.mesh.position.distanceTo(anchorPos),
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = neighbors[0];
  if (!nearest) {
    return {
      direction: camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-1).normalize(),
      neighborIndex: null,
      neighborCount: 0,
      neighborIndices: [],
    };
  }
  const direction = anchorPos.clone().sub(atomInfoList[nearest.idx].mesh.position).normalize();
  const neighborIndices = neighbors.slice(0, 3).map((item) => item.idx);
  return { direction, neighborIndex: nearest.idx, neighborCount: neighborIndices.length, neighborIndices };
}

function computeNeighborPlaneNormal(anchorIndex, neighborIndices) {
  if (neighborIndices.length < 2) return null;
  const anchorPos = atomInfoList[anchorIndex].mesh.position;
  const v1 = atomInfoList[neighborIndices[0]].mesh.position.clone().sub(anchorPos).normalize();
  let normal = null;
  for (let i = 1; i < neighborIndices.length; i += 1) {
    const v2 = atomInfoList[neighborIndices[i]].mesh.position.clone().sub(anchorPos).normalize();
    const cross = v1.clone().cross(v2);
    if (cross.length() > 1e-3) {
      normal = cross.normalize();
      break;
    }
  }
  return normal;
}

function evaluatePlacement(templateAtoms, anchorPos, rotation, anchorIndex) {
  let collisions = 0;
  let minDistance = Infinity;
  const rotatedPositions = templateAtoms.map((atom) =>
    atom.position.clone().applyQuaternion(rotation).add(anchorPos)
  );
  rotatedPositions.forEach((pos) => {
    atomInfoList.forEach((info, idx) => {
      if (idx === anchorIndex) return;
      const distance = pos.distanceTo(info.mesh.position);
      if (distance < minDistance) minDistance = distance;
      if (distance < 0.8) collisions += 1;
    });
  });
  return { collisions, minDistance, rotatedPositions };
}

function findBestRotation(templateAtoms, baseQuat, axis, anchorPos, anchorIndex) {
  let best = null;
  for (let i = 0; i < 12; i += 1) {
    const angle = (i * Math.PI) / 6;
    const spin = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const rotation = spin.multiply(baseQuat.clone());
    const score = evaluatePlacement(templateAtoms, anchorPos, rotation, anchorIndex);
    if (!best || score.collisions < best.collisions || (score.collisions === best.collisions && score.minDistance > best.minDistance)) {
      best = { rotation, positions: score.rotatedPositions, collisions: score.collisions, minDistance: score.minDistance };
    }
  }
  return best;
}

function addGroupAtAtom(mesh) {
  if (!moleculeGroup || !atomInfoList.length) {
    setStatus("Load a molecule first.");
    return;
  }
  const template = groupTemplates[selectedGroupType] || groupTemplates.H;
  const anchorIndex = atomInfoList.findIndex((info) => info.mesh === mesh);
  if (anchorIndex < 0) return;
  const anchorInfo = atomInfoList[anchorIndex];
  const prevElement = anchorInfo.element;
  const prevRadius = anchorInfo.radius;
  const prevPosition = anchorInfo.mesh.position.clone();
  anchorInfo.element = template.anchorElement;
  anchorInfo.radius = covalentRadii[anchorInfo.element] ?? anchorInfo.radius;
  applyAtomStyle(anchorInfo.mesh, anchorInfo.element);
  const neighborData = computeNeighborDirection(anchorIndex);
  const neighborIndex = neighborData.neighborIndex;
  const direction = neighborData.direction;

  if (neighborIndex !== null) {
    const targetLength = selectedGroupType === "Ph" ? 1.5 : getBondLength(anchorInfo.element, atomInfoList[neighborIndex].element);
    const newPos = atomInfoList[neighborIndex].mesh.position.clone().add(direction.clone().multiplyScalar(targetLength));
    anchorInfo.mesh.position.copy(newPos);
  }

  const isRing = ["Ph", "Cyclohexyl", "Cyclopentyl"].includes(selectedGroupType);
  let normal = null;
  if (isRing) {
    if (neighborData.neighborCount >= 2) {
      normal = computeNeighborPlaneNormal(anchorIndex, neighborData.neighborIndices);
    }
    if (!normal) {
      const axis = Math.abs(direction.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      normal = direction.clone().cross(axis).normalize();
      if (normal.length() < 1e-3) {
        normal = direction.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
      }
    }
  }

  let templateAtoms = template.atoms;
  let baseQuat = isRing && normal
    ? new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal)
    : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  let axis = isRing && normal ? normal.clone() : direction.clone();
  if (selectedGroupType === "CH3") {
    const bond = 1.09;
    const tetra = [
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(1, -1, -1),
      new THREE.Vector3(-1, 1, -1),
      new THREE.Vector3(-1, -1, 1),
    ].map((v) => v.normalize());
    const targetDir = direction.clone().negate();
    let reserved = tetra[0];
    let maxDot = reserved.dot(targetDir);
    tetra.forEach((vec) => {
      const dot = vec.dot(targetDir);
      if (dot > maxDot) {
        maxDot = dot;
        reserved = vec;
      }
    });
    baseQuat = new THREE.Quaternion().setFromUnitVectors(reserved, targetDir);
    axis = targetDir.clone();
    templateAtoms = tetra
      .filter((vec) => vec !== reserved)
      .map((vec) => ({ element: "H", position: vec.clone().multiplyScalar(bond) }));
  }
  if (selectedGroupType === "NH2") {
    const bond = 1.03;
    const theta = (107 * Math.PI) / 180;
    const cosTheta = Math.cos(theta);
    const cosBetaSquared = (cosTheta + 0.5) / 1.5;
    const cosBeta = Math.sqrt(Math.max(0, cosBetaSquared));
    const beta = Math.acos(cosBeta);
    const betaOpp = Math.PI - beta;
    const phi = Math.PI / 3;
    const makeVector = (angle) =>
      new THREE.Vector3(
        Math.sin(betaOpp) * Math.cos(angle),
        Math.sin(betaOpp) * Math.sin(angle),
        Math.cos(betaOpp)
      );
    const v1 = makeVector(phi);
    const v2 = makeVector(-phi);
    baseQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    axis = direction.clone();
    templateAtoms = [
      { element: "H", position: v1.clone().multiplyScalar(bond) },
      { element: "H", position: v2.clone().multiplyScalar(bond) },
    ];
  }
  const anchorPos = anchorInfo.mesh.position;
  const best = findBestRotation(templateAtoms, baseQuat, axis, anchorPos, anchorIndex);

  const added = [];
  const positions = best?.positions || templateAtoms.map((atom) => atom.position.clone().applyQuaternion(baseQuat).add(anchorPos));
  templateAtoms.forEach((atom, idx) => {
    const atomMesh = createAtomMesh(atom.element, positions[idx]);
    moleculeGroup.add(atomMesh);
    const info = { mesh: atomMesh, radius: covalentRadii[atom.element] ?? 0.9, element: atom.element };
    atomInfoList.push(info);
    atomMeshList.push(atomMesh);
    added.push(info);
  });

  if (bondGroup && showBonds && !bondsSkipped) {
    rebuildBonds(atomInfoList, bondGroup, isIOS ? 8 : 16);
    bondGroup.visible = true;
  }
  pushUndoSnapshot({
    type: "add-group",
    anchorIndex,
    anchorElement: prevElement,
    anchorRadius: prevRadius,
    anchorPosition: prevPosition,
    added,
  });
  setStatus(`Added ${selectedGroupType}.`);
}

function handleFile(file) {
  if (!file) return;
  setStatus(`Reading ${file.name} (${file.size} bytes)...`);
  const reader = new FileReader();
  reader.onload = () => loadXYZ(reader.result, file.name);
  reader.onerror = () => setStatus("Failed to read the file.");
  reader.readAsText(file);
}

function toggleBonds(nextState = !showBonds) {
  showBonds = nextState;
  if (bondGroup) {
    bondGroup.visible = showBonds && !bondsSkipped;
  }
  if (bondsSkipped && showBonds) {
    setStatus("Bonds disabled for performance on iOS.");
  }
}

if (editToggle) {
  editToggle.checked = editMode;
  editToggle.addEventListener("change", () => {
    editMode = editToggle.checked;
    if (editMode) {
      clearMeasurement();
      syncControlsEnabled();
      setStatus("Edit mode on. Drag to move, or drag a box to select.");
    } else {
      clearEditSelection();
      rotateMoleculeMode = false;
      if (rotateMoleculeToggle) rotateMoleculeToggle.checked = false;
      rotateMode = false;
      if (rotateToggle) rotateToggle.checked = false;
      syncControlsEnabled();
      setStatus("Edit mode off.");
    }
  });
}

if (rotateMoleculeToggle) {
  rotateMoleculeToggle.checked = rotateMoleculeMode;
  rotateMoleculeToggle.addEventListener("change", () => {
    rotateMoleculeMode = rotateMoleculeToggle.checked;
    if (rotateMoleculeMode && !editMode) {
      editMode = true;
      if (editToggle) editToggle.checked = true;
      clearMeasurement();
    }
    selecting = false;
    if (selectionBoxEl) selectionBoxEl.style.display = "none";
    syncControlsEnabled();
    setStatus(rotateMoleculeMode ? "Spin molecule enabled." : "Spin molecule disabled.");
  });
}

if (rotateToggle) {
  rotateToggle.checked = rotateMode;
  rotateToggle.addEventListener("change", () => {
    rotateMode = rotateToggle.checked;
    if (rotateMode && !editMode) {
      editMode = true;
      if (editToggle) editToggle.checked = true;
      setStatus("Edit mode on. Rotate selection enabled.");
      clearMeasurement();
      return;
    }
    syncControlsEnabled();
    setStatus(rotateMode ? "Rotate selection enabled." : "Rotate selection disabled.");
  });
}

if (toolboxToggle && toolboxEl) {
  toolboxToggle.addEventListener("click", () => {
    const collapsed = toolboxEl.classList.toggle("collapsed");
    toolboxToggle.textContent = collapsed ? "Show" : "Hide";
  });
}

if (exportButton) {
  exportButton.addEventListener("click", exportXYZ);
}

if (undoButton) {
  undoButton.addEventListener("click", undoMove);
}


if (filePickerButton && fileInput) {
  filePickerButton.addEventListener("click", () => {
    fileInput.click();
  });
}

if (fileInput) {
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  });
}

if (groupSelect) {
  groupSelect.addEventListener("change", () => {
    selectedGroupType = groupSelect.value;
  });
}

if (addGroupButton) {
  addGroupButton.addEventListener("click", () => {
    addGroupMode = !addGroupMode;
    addGroupButton.classList.toggle("active", addGroupMode);
    if (addGroupMode) {
      if (!editMode) {
        editMode = true;
        if (editToggle) editToggle.checked = true;
        syncControlsEnabled();
      }
      rotateMoleculeMode = false;
      if (rotateMoleculeToggle) rotateMoleculeToggle.checked = false;
      setStatus(`Click an atom to replace with ${selectedGroupType}.`);
    } else {
      setStatus("Add group cancelled.");
    }
  });
}

function handleUndoShortcut(event) {
  if (isIOSMobile) return;
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key?.toLowerCase();
  if (key !== "z" && event.code !== "KeyZ") return;
  const target = event.target;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  undoMove();
}

document.addEventListener("keydown", handleUndoShortcut, { capture: true });
window.addEventListener("keydown", handleUndoShortcut, { capture: true });

function toggleCheckbox(el) {
  if (!el) return;
  el.checked = !el.checked;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

window.addEventListener("keydown", (event) => {
  if (isIOSMobile) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  const key = event.key?.toLowerCase();
  if (key === "e") {
    event.preventDefault();
    toggleCheckbox(editToggle);
  }
  if (key === "s") {
    event.preventDefault();
    toggleCheckbox(rotateMoleculeToggle);
  }
  if (key === "r") {
    event.preventDefault();
    toggleCheckbox(rotateToggle);
  }
});

document.addEventListener(
  "beforeinput",
  (event) => {
    if (isIOSMobile) return;
    if (event.inputType !== "historyUndo") return;
    const target = event.target;
    if (
      target &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    undoMove();
  },
  { capture: true }
);

function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function isPseudoFullscreen() {
  return document.body.classList.contains("pseudo-fullscreen");
}

function setPseudoFullscreen(enabled) {
  document.body.classList.toggle("pseudo-fullscreen", enabled);
  resize();
}

function requestFullscreen(target) {
  const el = target || document.documentElement;
  return (
    el.requestFullscreen?.() ||
    el.webkitRequestFullscreen?.() ||
    el.mozRequestFullScreen?.() ||
    el.msRequestFullscreen?.()
  );
}

function exitFullscreen() {
  return (
    document.exitFullscreen?.() ||
    document.webkitExitFullscreen?.() ||
    document.mozCancelFullScreen?.() ||
    document.msExitFullscreen?.()
  );
}

function updateFullscreenButton() {
  if (!fullscreenButton) return;
  const active = isFullscreen() || isPseudoFullscreen();
  fullscreenButton.textContent = active ? "Exit" : "Full screen";
}

if (fullscreenButton) {
  fullscreenButton.addEventListener("click", () => {
    if (isIOSDevice) {
      if (isPseudoFullscreen()) {
        setPseudoFullscreen(false);
      } else {
        setPseudoFullscreen(true);
      }
      updateFullscreenButton();
      return;
    }
    const requestFullscreenFn =
      document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen ||
      document.documentElement.mozRequestFullScreen ||
      document.documentElement.msRequestFullscreen;
    if (isFullscreen() || isPseudoFullscreen()) {
      if (isPseudoFullscreen()) {
        setPseudoFullscreen(false);
        updateFullscreenButton();
      } else {
        exitFullscreen();
      }
    } else if (requestFullscreenFn) {
      try {
        const result = requestFullscreen(document.documentElement);
        if (result && typeof result.catch === "function") {
          result.catch(() => {
            setPseudoFullscreen(true);
            updateFullscreenButton();
          });
        }
      } catch (error) {
        setPseudoFullscreen(true);
        updateFullscreenButton();
      }
    } else {
      setPseudoFullscreen(true);
      updateFullscreenButton();
    }
  });
  document.addEventListener("fullscreenchange", updateFullscreenButton);
  document.addEventListener("webkitfullscreenchange", updateFullscreenButton);
  document.addEventListener("mozfullscreenchange", updateFullscreenButton);
  document.addEventListener("MSFullscreenChange", updateFullscreenButton);
  updateFullscreenButton();
}

window.__xyzViewerInitDone = true;
window.__xyzViewerLoaded = true;


window.addEventListener("dragover", (event) => {
  event.preventDefault();
  hudEl.classList.add("dragging");
  stageEl?.classList.add("dragging");
});

window.addEventListener("dragleave", () => {
  hudEl.classList.remove("dragging");
  stageEl?.classList.remove("dragging");
});

window.addEventListener("drop", (event) => {
  event.preventDefault();
  hudEl.classList.remove("dragging");
  stageEl?.classList.remove("dragging");
  const file = event.dataTransfer.files[0];
  if (file) {
    handleFile(file);
  } else {
    setStatus("Drop a .xyz file to load.");
  }
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
  if (renderer) {
    renderer.render(scene, camera);
    updateDistanceLabel();
    const gl = renderer.getContext?.();
    if (gl) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        setStatus(`WebGL error: ${error}`);
      }
    }
  }
}

if (renderer) {
  animate();
}

if (canvas) {
  canvas.addEventListener("pointerdown", () => {
    canvas.focus({ preventScroll: true });
  });
}

renderer?.domElement.addEventListener(
  "touchstart",
  (event) => {
    if (editMode && !rotateMoleculeMode) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
  },
  { passive: false, capture: true }
);

renderer?.domElement.addEventListener(
  "touchmove",
  (event) => {
    if (editMode && !rotateMoleculeMode) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
  },
  { passive: false, capture: true }
);

let downPoint = null;
renderer?.domElement.addEventListener(
  "pointerdown",
  (event) => {
    downPoint = { x: event.clientX, y: event.clientY };
    if (!editMode) return;
    const hit = pickAtomForDrag(event.clientX, event.clientY);
    if (rotateMoleculeMode) {
      return;
    }
    if (addGroupMode && hit) {
      addGroupAtAtom(hit);
      addGroupMode = false;
      if (addGroupButton) addGroupButton.classList.remove("active");
      downPoint = null;
      return;
    }
    if (addGroupMode && !hit) {
      setStatus("Click an atom to add the group.");
      downPoint = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    if (event.shiftKey && hit) {
      if (editSelection.includes(hit)) {
        removeFromEditSelection(hit);
        setStatus(`Selected ${editSelection.length} atoms.`);
      } else {
        addToEditSelection([hit]);
        setStatus(`Selected ${editSelection.length} atoms.`);
      }
      downPoint = null;
      return;
    }
    if (rotateMode && editSelection.length) {
      rotatingSelection = true;
      rotateCenter = getSelectionCenter();
      rotateStartPositions = editSelection.map((mesh) => mesh.position.clone());
      rotateLastPoint = { x: event.clientX, y: event.clientY };
      rotateAccumAngle = 0;
      pendingUndo = {
        atoms: [...editSelection],
        before: editSelection.map((mesh) => mesh.position.clone()),
      };
      if (controls && controls.enabled !== undefined) {
        controls.enabled = false;
      }
      if (bondGroup && bondGroup.visible) {
        bondGroup.visible = false;
        bondsHiddenForDrag = true;
      }
      return;
    }
    if (hit) {
      if (!editSelection.includes(hit)) {
        setEditSelection([hit]);
      }
      dragGroup = editSelection.length ? [...editSelection] : [hit];
      draggingAtom = hit;
      pendingUndo = {
        atoms: [...dragGroup],
        before: dragGroup.map((mesh) => mesh.position.clone()),
      };
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.position);
      const intersection = new THREE.Vector3();
      raycaster.ray.intersectPlane(dragPlane, intersection);
      dragStartPoint = intersection.clone();
      dragInitialPositions = dragGroup.map((mesh) => mesh.position.clone());
      if (controls && controls.enabled !== undefined) {
        controls.enabled = false;
      }
      if (bondGroup && bondGroup.visible) {
        bondGroup.visible = false;
        bondsHiddenForDrag = true;
      }
      return;
    }

    selecting = true;
    const selectRect = renderer.domElement.getBoundingClientRect();
    selectStart = {
      x: event.clientX - selectRect.left,
      y: event.clientY - selectRect.top,
    };
    selectStart.additive = event.shiftKey;
    if (selectionBoxEl) {
      selectionBoxEl.style.display = "block";
      selectionBoxEl.style.left = `${selectStart.x}px`;
      selectionBoxEl.style.top = `${selectStart.y}px`;
      selectionBoxEl.style.width = "0px";
      selectionBoxEl.style.height = "0px";
    }
    if (controls && controls.enabled !== undefined) {
      controls.enabled = false;
    }
  },
  { capture: true }
);
renderer?.domElement.addEventListener("pointermove", (event) => {
  if (rotatingSelection && rotateCenter && rotateStartPositions && rotateLastPoint) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const dx = event.clientX - rotateLastPoint.x;
    const dy = event.clientY - rotateLastPoint.y;
    rotateLastPoint = { x: event.clientX, y: event.clientY };
    rotateAccumAngle += (dx + dy * 0.3) * 0.01;
    const axis = new THREE.Vector3();
    camera.getWorldDirection(axis);
    tempQuat.setFromAxisAngle(axis, rotateAccumAngle);
    editSelection.forEach((mesh, index) => {
      const startPos = rotateStartPositions[index];
      const offset = startPos.clone().sub(rotateCenter);
      offset.applyQuaternion(tempQuat);
      mesh.position.copy(rotateCenter).add(offset);
    });
    updateMeasurementLine();
    return;
  }
  if (dragGroup && dragPlane && dragStartPoint && dragInitialPositions) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
      const delta = intersection.sub(dragStartPoint);
      dragGroup.forEach((mesh, index) => {
        const startPos = dragInitialPositions[index];
        mesh.position.copy(startPos).add(delta);
      });
      updateMeasurementLine();
    }
    return;
  }
  if (selecting && selectStart) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    const selectRect = renderer.domElement.getBoundingClientRect();
    const currentX = event.clientX - selectRect.left;
    const currentY = event.clientY - selectRect.top;
    const left = Math.min(selectStart.x, currentX);
    const top = Math.min(selectStart.y, currentY);
    const width = Math.abs(selectStart.x - currentX);
    const height = Math.abs(selectStart.y - currentY);
    if (selectionBoxEl) {
      selectionBoxEl.style.left = `${left}px`;
      selectionBoxEl.style.top = `${top}px`;
      selectionBoxEl.style.width = `${width}px`;
      selectionBoxEl.style.height = `${height}px`;
    }
  }
});
renderer?.domElement.addEventListener("pointerup", (event) => {
  if (!downPoint) return;
  if (rotatingSelection) {
    rotatingSelection = false;
    rotateCenter = null;
    rotateStartPositions = null;
    rotateLastPoint = null;
    rotateAccumAngle = 0;
    finalizeUndoSnapshot();
    if (controls && controls.enabled !== undefined) {
      controls.enabled = true;
    }
    if (bondsHiddenForDrag && bondGroup && showBonds && !bondsSkipped) {
      rebuildBonds(atomInfoList, bondGroup, isIOS ? 8 : 16);
      bondGroup.visible = true;
      bondsHiddenForDrag = false;
    }
    updateMeasurementLine();
    downPoint = null;
    return;
  }
  if (dragGroup) {
    draggingAtom = null;
    dragPlane = null;
    dragOffset = null;
    dragGroup = null;
    dragStartPoint = null;
    dragInitialPositions = null;
    finalizeUndoSnapshot();
    if (controls && controls.enabled !== undefined) {
      controls.enabled = true;
    }
    if (bondsHiddenForDrag && bondGroup && showBonds && !bondsSkipped) {
      rebuildBonds(atomInfoList, bondGroup, isIOS ? 8 : 16);
      bondGroup.visible = true;
      bondsHiddenForDrag = false;
    }
    updateMeasurementLine();
    downPoint = null;
    return;
  }
  if (selecting) {
    selecting = false;
    const selectRect = renderer.domElement.getBoundingClientRect();
    const currentX = event.clientX - selectRect.left;
    const currentY = event.clientY - selectRect.top;
    const dx = currentX - (selectStart?.x ?? currentX);
    const dy = currentY - (selectStart?.y ?? currentY);
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    if (selectionBoxEl) {
      selectionBoxEl.style.display = "none";
    }
    if (controls && controls.enabled !== undefined) {
      controls.enabled = true;
    }
    if (width < 5 && height < 5) {
      if (!selectStart?.additive) {
        clearEditSelection();
      }
      downPoint = null;
      return;
    }
    const left = Math.min(selectStart?.x ?? 0, currentX);
    const right = Math.max(selectStart?.x ?? 0, currentX);
    const top = Math.min(selectStart?.y ?? 0, currentY);
    const bottom = Math.max(selectStart?.y ?? 0, currentY);
    const selected = atomMeshList.filter((mesh) => {
      const screen = getScreenPosition(mesh);
      return screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom;
    });
    if (selected.length) {
      if (selectStart?.additive) {
        addToEditSelection(selected);
      } else {
        setEditSelection(selected);
      }
      setStatus(`Selected ${editSelection.length} atoms.`);
    } else {
      if (!selectStart?.additive) {
        clearEditSelection();
        setStatus("No atoms selected.");
      }
    }
    downPoint = null;
    return;
  }
  const dx = event.clientX - downPoint.x;
  const dy = event.clientY - downPoint.y;
  if (Math.hypot(dx, dy) < 6) {
    if (!editMode) {
      pickAtom(event.clientX, event.clientY);
    }
  }
  downPoint = null;
});
renderer?.domElement.addEventListener("touchend", (event) => {
  if (event.changedTouches.length === 1) {
    const touch = event.changedTouches[0];
    if (!editMode) {
      pickAtom(touch.clientX, touch.clientY);
    }
  }
});
})();
