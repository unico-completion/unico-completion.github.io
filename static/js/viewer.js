const unicoContainer = document.getElementById("unico-viewer");
const methodContainer = document.getElementById("method-viewer");
const gtContainer = document.getElementById("gt-viewer");
const inputContainer = document.getElementById("input-viewer");

let camera;
let controls;
let autoRotate = true;
let running = false;

let currentSample = null;
let currentMethod = "symm";

const NORMALIZATION_BY_SAMPLE = new Map();
let VIEWERS = [];

const OBJ_LOADER = new THREE.OBJLoader();
const PLY_LOADER = new THREE.PLYLoader();

function makeViewer(container, ids) {
  const viewer = {
    container,
    scene: null,
    renderer: null,
    currentObj: null,
    loading: false,
    loaderEl: document.getElementById(ids.loader),
    progressEl: document.getElementById(ids.progress),
    placeholderEl: document.getElementById(ids.placeholder)
  };

  if (!container) return viewer;

  viewer.scene = new THREE.Scene();
  viewer.scene.background = new THREE.Color(0xffffff);
  viewer.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 10, 5);
  viewer.scene.add(dirLight);

  viewer.renderer = new THREE.WebGLRenderer({ antialias: true });
  viewer.renderer.setPixelRatio(window.devicePixelRatio || 1);
  // Avoid initializing with 0x0; let sync/resize handle final CSS-driven size.
  const initW = Math.max(1, container.clientWidth);
  const initH = Math.max(1, container.clientHeight);
  viewer.renderer.setSize(initW, initH, false);
  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) oldCanvas.remove();
  viewer.renderer.domElement.style.display = "block";
  viewer.renderer.domElement.style.width = "100%";
  viewer.renderer.domElement.style.height = "100%";
  container.appendChild(viewer.renderer.domElement);

  return viewer;
}

function syncRendererSize(viewer) {
  if (!viewer || !viewer.container || !viewer.renderer) return false;
  const w = viewer.container.clientWidth;
  const h = viewer.container.clientHeight;
  if (w <= 0 || h <= 0) return false;

  const canvas = viewer.renderer.domElement;
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);

  if (canvas.width !== targetW || canvas.height !== targetH) {
    viewer.renderer.setPixelRatio(dpr);
    viewer.renderer.setSize(w, h, false);
    return true;
  }
  return false;
}

function clearObject(viewer) {
  if (!viewer || !viewer.scene || !viewer.currentObj) return;

  viewer.currentObj.traverse((child) => {
    if (child.isMesh || child.isPoints) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of materials) {
          if (m && m.dispose) m.dispose();
        }
      }
    }
  });

  viewer.scene.remove(viewer.currentObj);
  viewer.currentObj = null;
}

function setLoading(viewer, isLoading) {
  if (viewer.loaderEl) viewer.loaderEl.style.display = isLoading ? "block" : "none";
  if (viewer.progressEl) viewer.progressEl.style.width = "0%";
  if (viewer.placeholderEl) viewer.placeholderEl.style.display = isLoading ? "none" : "block";
}

function styleMesh(object3d) {
  object3d.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.computeVertexNormals();
      child.material = new THREE.MeshStandardMaterial({
        color: 0xd8cab0,
        roughness: 0.7,
        metalness: 0.1
      });
      child.frustumCulled = false;
    }
  });
}

function centerAndScale(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? 0.9 / maxDim : 1.0;
  object3d.scale.setScalar(scale);

  const box2 = new THREE.Box3().setFromObject(object3d);
  const center = box2.getCenter(new THREE.Vector3());
  object3d.position.sub(center);
}

function resetTransform(object3d) {
  object3d.position.set(0, 0, 0);
  object3d.rotation.set(0, 0, 0);
  object3d.scale.set(1, 1, 1);
}

function getMaxDim(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

function normalizeGroupWithScale(group, scaleFactor) {
  if (!group) return;
  resetTransform(group);

  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());

  group.scale.setScalar(scaleFactor);
  group.position.copy(center.multiplyScalar(-scaleFactor));
}

function maybeSetReferenceScale(sampleId, sourceGroup) {
  if (!sampleId || !sourceGroup) return false;
  if (NORMALIZATION_BY_SAMPLE.has(sampleId)) return false;

  resetTransform(sourceGroup);
  const maxDim = getMaxDim(sourceGroup);
  const scaleFactor = maxDim > 0 ? 0.9 / maxDim : 1.0;
  NORMALIZATION_BY_SAMPLE.set(sampleId, { scaleFactor });
  return true;
}

function applyNormalizationForCurrentSample() {
  if (!currentSample) return;
  const norm = NORMALIZATION_BY_SAMPLE.get(currentSample);
  if (!norm) return;

  for (const v of VIEWERS) {
    if (!v || !v.currentObj) continue;
    normalizeGroupWithScale(v.currentObj, norm.scaleFactor);
  }
}

function buildCandidatePaths(sampleId, method) {
  // Most methods are OBJ; some (input, some pointr) are PLY.
  const base = `./static/data/${sampleId}_${method}`;
  if (method === "input") return [`${base}.ply`, `${base}.obj`];
  return [`${base}.obj`, `${base}.ply`];
}

function loadModelInto(viewer, sampleId, method) {
  if (!viewer || !viewer.scene || viewer.loading) return;
  viewer.loading = true;
  setLoading(viewer, true);
  clearObject(viewer);

  const candidates = buildCandidatePaths(sampleId, method);

  const tryLoad = (idx) => {
    if (idx >= candidates.length) {
      console.error(`No loadable asset found for ${sampleId}_${method}`);
      if (viewer.loaderEl) viewer.loaderEl.innerHTML = "<div style='color:red;'>Load failed</div>";
      viewer.loading = false;
      setLoading(viewer, false);
      return;
    }

    const path = candidates[idx];
    const isPLY = path.toLowerCase().endsWith(".ply");

    const onError = (err) => {
      console.warn("Failed to load", path, err);
      tryLoad(idx + 1);
    };

    if (isPLY) {
      PLY_LOADER.load(
        path,
        (geometry) => {
          geometry.computeVertexNormals?.();
          const material = new THREE.PointsMaterial({
            size: 0.01,
            color: 0xd8cab0
          });
          const points = new THREE.Points(geometry, material);

          const group = new THREE.Group();
          group.add(points);
          // Normalize later using shared per-sample scale.
          viewer.scene.add(group);
          viewer.currentObj = group;

          // If we already have a reference scale, apply it; otherwise do a temporary self-scale.
          const norm = NORMALIZATION_BY_SAMPLE.get(sampleId);
          if (norm) {
            normalizeGroupWithScale(group, norm.scaleFactor);
          } else {
            resetTransform(group);
            const maxDim = getMaxDim(group);
            const tmpScale = maxDim > 0 ? 0.9 / maxDim : 1.0;
            normalizeGroupWithScale(group, tmpScale);
          }

          // Prefer GT as reference; fallback to UniCo.
          if ((viewer.role === "gt" || viewer.role === "unico") && maybeSetReferenceScale(sampleId, group)) {
            applyNormalizationForCurrentSample();
          }

          viewer.loading = false;
          setLoading(viewer, false);
        },
        undefined,
        onError
      );
    } else {
      OBJ_LOADER.load(
        path,
        (obj) => {
          styleMesh(obj);
          const group = new THREE.Group();
          group.add(obj);
          viewer.scene.add(group);
          viewer.currentObj = group;

          const norm = NORMALIZATION_BY_SAMPLE.get(sampleId);
          if (norm) {
            normalizeGroupWithScale(group, norm.scaleFactor);
          } else {
            resetTransform(group);
            const maxDim = getMaxDim(group);
            const tmpScale = maxDim > 0 ? 0.9 / maxDim : 1.0;
            normalizeGroupWithScale(group, tmpScale);
          }

          if ((viewer.role === "gt" || viewer.role === "unico") && maybeSetReferenceScale(sampleId, group)) {
            applyNormalizationForCurrentSample();
          }

          viewer.loading = false;
          setLoading(viewer, false);
        },
        undefined,
        onError
      );
    }
  };

  tryLoad(0);
}

function initCameraAndControls(domElementForControls) {
  camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 1000);
  camera.position.set(0.5, 0.5, 0.6);
  camera.lookAt(0, 0, 0);

  controls = new THREE.OrbitControls(camera, domElementForControls);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  controls.update();
  controls.addEventListener("start", () => {
    autoRotate = false;
  });
}

function bindControlsToDom(domElementForControls) {
  if (!camera || !domElementForControls) return;
  if (controls && controls.domElement === domElementForControls) return;

  const prevTarget = controls ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
  const prevEnableDamping = controls ? controls.enableDamping : true;
  const prevDampingFactor = controls ? controls.dampingFactor : 0.05;
  const prevRotateSpeed = controls ? controls.rotateSpeed : 1.0;
  const prevZoomSpeed = controls ? controls.zoomSpeed : 1.0;
  const prevPanSpeed = controls ? controls.panSpeed : 1.0;

  if (controls) controls.dispose();

  controls = new THREE.OrbitControls(camera, domElementForControls);
  controls.enableDamping = prevEnableDamping;
  controls.dampingFactor = prevDampingFactor;
  controls.rotateSpeed = prevRotateSpeed;
  controls.zoomSpeed = prevZoomSpeed;
  controls.panSpeed = prevPanSpeed;
  controls.target.copy(prevTarget);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  controls.update();
  controls.addEventListener("start", () => {
    autoRotate = false;
  });
}

function handleResize(viewers) {
  for (const v of viewers) {
    if (!v || !v.container || !v.renderer) continue;
    const w = v.container.clientWidth;
    const h = v.container.clientHeight;
    if (w <= 0 || h <= 0) continue;
    v.renderer.setSize(w, h, false);
  }
}

function animate(viewers) {
  if (!running) return;
  requestAnimationFrame(() => animate(viewers));

  if (controls) controls.update();

  // Ensure canvases match CSS-driven layout sizes (aspect-ratio, grid, etc.)
  for (const v of viewers) syncRendererSize(v);

  // Keep both models rotating equally until user interacts.
  if (autoRotate) {
    for (const v of viewers) {
      if (v && v.currentObj) v.currentObj.rotation.y += 0.01;
    }
  }

  // Render both scenes with the same camera (aligned perspective)
  for (const v of viewers) {
    if (!v || !v.renderer || !v.scene || !camera) continue;
    const w = v.container.clientWidth;
    const h = v.container.clientHeight;
    if (w <= 0 || h <= 0) continue;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    v.renderer.render(v.scene, camera);
  }
}

function setActiveButton(buttons, activeBtn) {
  for (const b of buttons) {
    b.classList.remove("is-primary");
    b.classList.remove("is-light");
  }
  if (activeBtn) {
    activeBtn.classList.add("is-primary");
    activeBtn.classList.add("is-light");
  }
}

function bindSelectors(unicoViewer, methodViewer) {
  const sampleContainer = document.getElementById("comparison-samples");
  const methodContainer = document.getElementById("comparison-methods");
  if (!sampleContainer || !methodContainer) return;

  const sampleButtons = Array.from(sampleContainer.querySelectorAll("[data-sample]"));
  const methodButtons = Array.from(methodContainer.querySelectorAll("[data-method]"));

  const applyLoad = () => {
    if (!currentSample) return;
    loadModelInto(gtViewer, currentSample, "gt");
    loadModelInto(inputViewer, currentSample, "input");
    loadModelInto(unicoViewer, currentSample, "unico");
    loadModelInto(methodViewer, currentSample, currentMethod);
  };

  for (const btn of sampleButtons) {
    btn.addEventListener("click", () => {
      currentSample = btn.getAttribute("data-sample");
      setActiveButton(sampleButtons, btn);
      applyLoad();
    });
  }

  for (const btn of methodButtons) {
    btn.addEventListener("click", () => {
      currentMethod = btn.getAttribute("data-method") || "symm";
      setActiveButton(methodButtons, btn);
      applyLoad();
    });
  }

  // Defaults
  const defaultSampleBtn = sampleButtons.find((b) => b.getAttribute("data-default") === "true") || sampleButtons[0];
  const defaultMethodBtn = methodButtons.find((b) => b.getAttribute("data-default") === "true") || methodButtons[0];

  if (defaultMethodBtn) defaultMethodBtn.click();
  if (defaultSampleBtn) defaultSampleBtn.click();
}

window.addEventListener("DOMContentLoaded", () => {
  if (!unicoContainer || !methodContainer || !gtContainer || !inputContainer) return;

  const gtViewer = makeViewer(gtContainer, {
    loader: "loader-gt",
    progress: "progress-gt",
    placeholder: "placeholder-gt"
  });
  gtViewer.role = "gt";

  const inputViewer = makeViewer(inputContainer, {
    loader: "loader-input",
    progress: "progress-input",
    placeholder: "placeholder-input"
  });
  inputViewer.role = "input";

  const unicoViewer = makeViewer(unicoContainer, {
    loader: "loader-unico",
    progress: "progress-unico",
    placeholder: "placeholder-unico"
  });
  unicoViewer.role = "unico";
  const methodViewer = makeViewer(methodContainer, {
    loader: "loader-method",
    progress: "progress-method",
    placeholder: "placeholder-method"
  });
  methodViewer.role = "method";

  // Attach controls initially, then re-bind to whichever canvas the user interacts with.
  initCameraAndControls(unicoViewer.renderer.domElement);

  const canvases = [
    inputViewer.renderer?.domElement,
    gtViewer.renderer?.domElement,
    unicoViewer.renderer?.domElement,
    methodViewer.renderer?.domElement
  ].filter(Boolean);

  for (const canvas of canvases) {
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", () => bindControlsToDom(canvas), true);
    canvas.addEventListener("pointerenter", () => bindControlsToDom(canvas));
    canvas.style.touchAction = "none";
  }

  const viewers = [gtViewer, inputViewer, unicoViewer, methodViewer];
  VIEWERS = viewers;
  // Layout may not be finalized at DOMContentLoaded (fonts/CSS grid/aspect-ratio).
  // Do an initial resize now and again on the next frame.
  handleResize(viewers);
  requestAnimationFrame(() => handleResize(viewers));
  window.addEventListener("resize", () => handleResize(viewers));

  // Pass required viewers via closures inside bindSelectors
  // eslint-disable-next-line no-inner-declarations
  function bindSelectorsWithFixedViewers() {
    const sampleContainer = document.getElementById("comparison-samples");
    const methodContainerEl = document.getElementById("comparison-methods");
    if (!sampleContainer || !methodContainerEl) return;

    const sampleButtons = Array.from(sampleContainer.querySelectorAll("[data-sample]"));
    const methodButtons = Array.from(methodContainerEl.querySelectorAll("[data-method]"));

    const applyLoad = () => {
      if (!currentSample) return;
      loadModelInto(gtViewer, currentSample, "gt");
      loadModelInto(inputViewer, currentSample, "input");
      loadModelInto(unicoViewer, currentSample, "unico");
      loadModelInto(methodViewer, currentSample, currentMethod);
    };

    for (const btn of sampleButtons) {
      btn.addEventListener("click", () => {
        currentSample = btn.getAttribute("data-sample");
        setActiveButton(sampleButtons, btn);
        applyLoad();
      });
    }

    for (const btn of methodButtons) {
      btn.addEventListener("click", () => {
        currentMethod = btn.getAttribute("data-method") || "symm";
        setActiveButton(methodButtons, btn);
        applyLoad();
      });
    }

    const defaultSampleBtn = sampleButtons.find((b) => b.getAttribute("data-default") === "true") || sampleButtons[0];
    const defaultMethodBtn = methodButtons.find((b) => b.getAttribute("data-default") === "true") || methodButtons[0];

    if (defaultMethodBtn) defaultMethodBtn.click();
    if (defaultSampleBtn) defaultSampleBtn.click();
  }

  bindSelectorsWithFixedViewers();

  running = true;
  animate(viewers);
});