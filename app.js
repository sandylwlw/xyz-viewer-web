(() => {
  window.__xyzViewerInitDone = false;

const canvas = document.getElementById("viewer");
const statusEl = document.getElementById("status");
const hudEl = document.getElementById("hud");
const fileInput = document.getElementById("file-input");
const loadButton = document.getElementById("load-button");
const distanceLabel = document.getElementById("distance-label");
const stageEl = document.querySelector(".stage");
const demoButton = document.getElementById("demo-button");
const resetButton = document.getElementById("reset-button");
const clearMeasureButton = document.getElementById("measure-clear");
const snapshotButton = document.getElementById("snapshot-button");
const bondToggle = document.getElementById("bond-toggle");
const editToggle = document.getElementById("edit-toggle");
let selectedFile = null;
let selectedFileName = "";

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
let distanceLine = null;
let showBonds = true;
let bondsSkipped = false;
let editMode = false;
let draggingAtom = null;
let dragOffset = null;
let dragPlane = null;
let bondsHiddenForDrag = false;
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

const demoXYZ = `12
Demo: formamide
C  0.0000  0.0000  0.0000
O  1.2000  0.0000  0.0000
N -1.2000  0.0000  0.0000
H -1.6000  0.9000  0.0000
H -1.6000 -0.9000  0.0000
H  0.0000  0.0000  1.0500
C  2.4000  0.0000  0.0000
H  2.8000  0.9000  0.0000
H  2.8000 -0.9000  0.0000
H  2.4000  0.0000  1.0500
H -2.4000  0.0000  0.0000
H -2.8000  0.0000  0.9000
`;

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
  if (bondToggle) {
    bondToggle.checked = showBonds && !bondsSkipped;
    bondToggle.disabled = bondsSkipped;
  }
  const bondNote = bondsSkipped ? " (bonds off on iOS)" : "";
  setStatus(`Loaded ${filename} (${atoms.length} atoms)${bondNote}.`);
  hudEl.style.display = "none";
  if (renderer) {
    renderer.render(scene, camera);
  }
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
  setStatus("Ready. File input bound.");
  const checkSelection = () => {
    const file = input.files?.[0];
    if (file && file.name !== selectedFileName) {
      selectedFile = file;
      selectedFileName = file.name;
      setStatus(`Selected ${file.name} (${file.size} bytes).`);
      handleFile(file);
    }
  };
  input.addEventListener("click", () => {
    setStatus("Choose a file in the picker...");
  });
  input.addEventListener("focus", () => {
    setTimeout(checkSelection, 50);
  });
  input.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setStatus("No file selected.");
      return;
    }
    selectedFile = file;
    selectedFileName = file.name;
    handleFile(file);
  });
  input.addEventListener("input", (event) => {
    const file = event.target.files?.[0];
    if (file) {
      selectedFile = file;
      selectedFileName = file.name;
      setStatus(`Selected ${file.name} (${file.size} bytes).`);
      handleFile(file);
    }
  });
  if (button) {
    button.addEventListener("click", () => {
      const file = selectedFile || input.files?.[0];
      if (!file) {
        setStatus("No file selected. Tap Choose File first.");
        return;
      }
      handleFile(file);
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      setTimeout(checkSelection, 50);
    }
  });
  window.addEventListener("focus", () => {
    setTimeout(checkSelection, 50);
  });
  return true;
}

if (!bindFileInput()) {
  window.addEventListener("DOMContentLoaded", bindFileInput, { once: true });
}

if (bondToggle) {
  bondToggle.checked = showBonds;
}

function toggleBonds(nextState = !showBonds) {
  showBonds = nextState;
  if (bondToggle) {
    bondToggle.checked = showBonds && !bondsSkipped;
  }
  if (bondGroup) {
    bondGroup.visible = showBonds && !bondsSkipped;
  }
  if (bondsSkipped && showBonds) {
    setStatus("Bonds disabled for performance on iOS.");
  }
}

function loadDemo() {
  loadXYZ(demoXYZ, "demo.xyz");
}

function resetView() {
  if (!moleculeGroup) {
    setStatus("Load a molecule first.");
    return;
  }
  centerAndFrame(moleculeGroup);
  setStatus("View reset.");
}

function clearMeasurementAction() {
  clearMeasurement();
  setStatus("Measurement cleared.");
}

function saveSnapshot() {
  if (!renderer) {
    setStatus("Renderer not ready.");
    return;
  }
  const canvasEl = renderer.domElement;
  const download = (blob) => {
    if (!blob) {
      setStatus("Snapshot failed.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xyz-viewer-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("Saved PNG snapshot.");
  };
  if (canvasEl.toBlob) {
    canvasEl.toBlob(download, "image/png");
  } else {
    const dataUrl = canvasEl.toDataURL("image/png");
    fetch(dataUrl)
      .then((res) => res.blob())
      .then(download)
      .catch(() => setStatus("Snapshot failed."));
  }
}

if (bondToggle) {
  bondToggle.addEventListener("change", () => {
    toggleBonds(bondToggle.checked);
  });
}

if (editToggle) {
  editToggle.checked = editMode;
  editToggle.addEventListener("change", () => {
    editMode = editToggle.checked;
    setStatus(editMode ? "Edit mode on. Drag atoms to move." : "Edit mode off.");
  });
}

if (demoButton) {
  demoButton.addEventListener("click", loadDemo);
}

if (resetButton) {
  resetButton.addEventListener("click", resetView);
}

if (clearMeasureButton) {
  clearMeasureButton.addEventListener("click", clearMeasurementAction);
}

if (snapshotButton) {
  snapshotButton.addEventListener("click", saveSnapshot);
}

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  ) {
    return;
  }
  const key = event.key.toLowerCase();
  if (key === "r") resetView();
  if (key === "c") clearMeasurementAction();
  if (key === "b") toggleBonds();
  if (key === "s") saveSnapshot();
  if (key === "d") loadDemo();
});

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

let downPoint = null;
renderer?.domElement.addEventListener(
  "pointerdown",
  (event) => {
  downPoint = { x: event.clientX, y: event.clientY };
  if (!editMode) return;
  const hit = pickAtomForDrag(event.clientX, event.clientY);
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  draggingAtom = hit;
  const normal = new THREE.Vector3();
  camera.getWorldDirection(normal);
  dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.position);
  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, intersection);
  dragOffset = hit.position.clone().sub(intersection);
  if (controls && controls.enabled !== undefined) {
    controls.enabled = false;
  }
  if (bondGroup && bondGroup.visible) {
    bondGroup.visible = false;
    bondsHiddenForDrag = true;
  }
  },
  { capture: true }
);
renderer?.domElement.addEventListener("pointermove", (event) => {
  if (!draggingAtom || !dragPlane) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNDC, camera);
  const intersection = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(dragPlane, intersection)) {
    draggingAtom.position.copy(intersection.add(dragOffset));
    const info = atomInfoList.find((item) => item.mesh === draggingAtom);
    if (info) {
      info.mesh.position.copy(draggingAtom.position);
    }
    updateMeasurementLine();
  }
});
renderer?.domElement.addEventListener("pointerup", (event) => {
  if (!downPoint) return;
  if (draggingAtom) {
    draggingAtom = null;
    dragPlane = null;
    dragOffset = null;
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
