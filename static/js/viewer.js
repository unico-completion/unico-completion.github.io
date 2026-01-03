const NORMALIZATION_BY_SAMPLE_KEY = new Map();
const GROUPS = [];
let RUNNING = false;

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

function styleMesh(object3d, options = {}) {
  const doubleSided = !!options.doubleSided;
  object3d.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.computeVertexNormals();
      child.material = new THREE.MeshStandardMaterial({
        color: 0xd8cab0,
        roughness: 0.7,
        metalness: 0.1,
        side: doubleSided ? THREE.DoubleSide : THREE.FrontSide
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

function getUpAlignmentQuaternion(datasetGroup, objectGroup) {
  const mode = (datasetGroup && datasetGroup.upAxis) || "y";
  const identity = new THREE.Quaternion();

  if (mode === "y") return identity;
  if (mode === "z") return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  if (mode !== "auto" || !objectGroup) return identity;

  resetTransform(objectGroup);
  const box = new THREE.Box3().setFromObject(objectGroup);
  const size = box.getSize(new THREE.Vector3());

  // Heuristic: if the Z extent is significantly larger than Y, assume Z-up.
  if (Number.isFinite(size.z) && Number.isFinite(size.y) && size.z > size.y * 1.25) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  }
  return identity;
}

function getMaxDim(object3d) {
  const box = new THREE.Box3().setFromObject(object3d);
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

function normalizeGroupWithNorm(objectGroup, norm) {
  if (!objectGroup || !norm) return;
  resetTransform(objectGroup);

  if (norm.quaternion) objectGroup.quaternion.copy(norm.quaternion);
  objectGroup.scale.setScalar(norm.scaleFactor);
  objectGroup.position.copy(norm.translation);

  objectGroup.userData.baseQuaternion = (norm.quaternion ? norm.quaternion.clone() : new THREE.Quaternion());
  if (!Number.isFinite(objectGroup.userData.autoRotateAngle)) objectGroup.userData.autoRotateAngle = 0;
}

function autoFrameGroupCamera(datasetGroup, referenceObject) {
  if (!datasetGroup || !datasetGroup.camera || !datasetGroup.controls || !referenceObject) return;

  const box = new THREE.Box3().setFromObject(referenceObject);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return;

  const targetHeightFactor = Number.isFinite(datasetGroup.autoFrameTargetHeightFactor)
    ? datasetGroup.autoFrameTargetHeightFactor
    : 0.35;

  // Aim a bit above the bottom so the object feels grounded.
  const target = new THREE.Vector3(center.x, box.min.y + size.y * targetHeightFactor, center.z);
  datasetGroup.controls.target.copy(target);

  // Fit bounding sphere into view.
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = Math.max(1e-6, sphere.radius);

  const fovRad = (datasetGroup.camera.fov * Math.PI) / 180;
  const distanceMultiplier = Number.isFinite(datasetGroup.autoFrameDistanceMultiplier)
    ? datasetGroup.autoFrameDistanceMultiplier
    : 1.15;

  const distance = (radius / Math.sin(fovRad / 2)) * distanceMultiplier;

  const fallbackDir = new THREE.Vector3(0.45, 0.25, 1.0);
  let dir = fallbackDir;
  const d = datasetGroup.autoFrameViewDir;
  if (d && typeof d === "object") {
    if (Array.isArray(d) && d.length >= 3) dir = new THREE.Vector3(d[0], d[1], d[2]);
    else if (Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)) dir = new THREE.Vector3(d.x, d.y, d.z);
  }
  if (!Number.isFinite(dir.lengthSq()) || dir.lengthSq() < 1e-8) dir = fallbackDir;
  dir.normalize();
  datasetGroup.camera.position.copy(target).add(dir.multiplyScalar(distance));

  datasetGroup.camera.near = Math.max(0.001, distance / 200);
  datasetGroup.camera.far = Math.max(10, distance * 50);
  datasetGroup.camera.updateProjectionMatrix();
  datasetGroup.controls.update();
}

function maybeSetReferenceScale(sampleKey, sourceObjectGroup, datasetGroup) {
  if (!sampleKey || !sourceObjectGroup) return false;
  if (NORMALIZATION_BY_SAMPLE_KEY.has(sampleKey)) return false;

  const alignToGround = !!(datasetGroup && datasetGroup.alignToGround);

  const quaternion = getUpAlignmentQuaternion(datasetGroup, sourceObjectGroup);

  resetTransform(sourceObjectGroup);
  sourceObjectGroup.quaternion.copy(quaternion);
  const box = new THREE.Box3().setFromObject(sourceObjectGroup);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scaleFactor = maxDim > 0 ? 0.9 / maxDim : 1.0;

  // Translation that centers the reference object's bbox center at origin.
  const refCenter = box.getCenter(new THREE.Vector3());
  const translation = refCenter.multiplyScalar(-scaleFactor);

  if (alignToGround) {
    // Compute ground offset for the reference object using the *same* translation.
    const tmp = sourceObjectGroup.clone(true);
    resetTransform(tmp);
    tmp.quaternion.copy(quaternion);
    tmp.scale.setScalar(scaleFactor);
    tmp.position.copy(translation);
    const box2 = new THREE.Box3().setFromObject(tmp);
    const minY = box2.min.y;
    if (Number.isFinite(minY)) translation.y += -minY;
  }

  NORMALIZATION_BY_SAMPLE_KEY.set(sampleKey, { scaleFactor, translation: translation.clone(), quaternion: quaternion.clone() });
  return true;
}

function applyNormalizationForSample(sampleKey, viewers) {
  if (!sampleKey) return;
  const norm = NORMALIZATION_BY_SAMPLE_KEY.get(sampleKey);
  if (!norm) return;

  for (const v of viewers) {
    if (!v || !v.currentObj) continue;
    normalizeGroupWithNorm(v.currentObj, norm);
  }
}

function buildCandidatePaths(datasetDir, sampleId, method) {
  // Most methods are OBJ; some (input) are PLY.
  const base = `./static/data/${datasetDir}/${sampleId}_${method}`;
  if (method === "input") return [`${base}.ply`, `${base}.obj`];
  return [`${base}.obj`, `${base}.ply`];
}

function loadColoredPointPlyInto(viewer, datasetGroup, sampleId, method) {
  if (!viewer || !viewer.scene || viewer.loading) return;
  viewer.loading = true;
  setLoading(viewer, true);
  clearObject(viewer);

  const path = `./static/data/${datasetGroup.datasetDir}/${sampleId}_${method}.ply`;

  PLY_LOADER.load(
    path,
    (geometry) => {
      geometry.computeVertexNormals?.();

      const hasColors = !!(geometry && geometry.getAttribute && geometry.getAttribute("color"));
      const material = new THREE.PointsMaterial({
        size: 0.01,
        color: hasColors ? 0xffffff : 0xd8cab0,
        vertexColors: hasColors
      });

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;

      const objectGroup = new THREE.Group();
      objectGroup.add(points);
      viewer.scene.add(objectGroup);
      viewer.currentObj = objectGroup;

      const sampleKey = `${datasetGroup.datasetDir}/${sampleId}`;
      const norm = NORMALIZATION_BY_SAMPLE_KEY.get(sampleKey);
      if (norm) {
        normalizeGroupWithNorm(objectGroup, norm);
      } else {
        resetTransform(objectGroup);
        const maxDim = getMaxDim(objectGroup);
        const tmpScale = maxDim > 0 ? 0.9 / maxDim : 1.0;
        const box = new THREE.Box3().setFromObject(objectGroup);
        const center = box.getCenter(new THREE.Vector3());
        normalizeGroupWithNorm(objectGroup, { scaleFactor: tmpScale, translation: center.multiplyScalar(-tmpScale) });
      }

      viewer.loading = false;
      setLoading(viewer, false);
    },
    undefined,
    (err) => {
      console.warn("Failed to load", path, err);
      if (viewer.loaderEl) viewer.loaderEl.innerHTML = "<div style='color:red;'>Load failed</div>";
      viewer.loading = false;
      setLoading(viewer, false);
    }
  );
}

function loadModelInto(viewer, group, sampleId, method) {
  if (!viewer || !viewer.scene || viewer.loading) return;
  viewer.loading = true;
  setLoading(viewer, true);
  clearObject(viewer);

  const candidates = buildCandidatePaths(group.datasetDir, sampleId, method);
  const sampleKey = `${group.datasetDir}/${sampleId}`;

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

          const objectGroup = new THREE.Group();
          objectGroup.add(points);
          // Normalize later using shared per-sample scale.
          viewer.scene.add(objectGroup);
          viewer.currentObj = objectGroup;

          // If we already have a reference scale, apply it; otherwise do a temporary self-scale.
          const norm = NORMALIZATION_BY_SAMPLE_KEY.get(sampleKey);
          if (norm) {
            normalizeGroupWithNorm(objectGroup, norm);
          } else {
            const quaternion = getUpAlignmentQuaternion(group, objectGroup);
            resetTransform(objectGroup);
            objectGroup.quaternion.copy(quaternion);
            const maxDim = getMaxDim(objectGroup);
            const tmpScale = maxDim > 0 ? 0.9 / maxDim : 1.0;
            const box = new THREE.Box3().setFromObject(objectGroup);
            const center = box.getCenter(new THREE.Vector3());
            normalizeGroupWithNorm(objectGroup, {
              scaleFactor: tmpScale,
              translation: center.multiplyScalar(-tmpScale),
              quaternion
            });
          }

          // Prefer GT as reference; fallback to UniCo.
          if ((viewer.role === "gt" || viewer.role === "unico") && maybeSetReferenceScale(sampleKey, objectGroup, viewer.group)) {
            applyNormalizationForSample(sampleKey, viewer.group ? viewer.group.viewers : []);
            if (viewer.group && viewer.group.autoFrame) autoFrameGroupCamera(viewer.group, objectGroup);
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
          styleMesh(obj, { doubleSided: !!group.doubleSided });
          const objectGroup = new THREE.Group();
          objectGroup.add(obj);
          viewer.scene.add(objectGroup);
          viewer.currentObj = objectGroup;

          const norm = NORMALIZATION_BY_SAMPLE_KEY.get(sampleKey);
          if (norm) {
            normalizeGroupWithNorm(objectGroup, norm);
          } else {
            const quaternion = getUpAlignmentQuaternion(group, objectGroup);
            resetTransform(objectGroup);
            objectGroup.quaternion.copy(quaternion);
            const maxDim = getMaxDim(objectGroup);
            const tmpScale = maxDim > 0 ? 0.9 / maxDim : 1.0;
            const box = new THREE.Box3().setFromObject(objectGroup);
            const center = box.getCenter(new THREE.Vector3());
            normalizeGroupWithNorm(objectGroup, {
              scaleFactor: tmpScale,
              translation: center.multiplyScalar(-tmpScale),
              quaternion
            });
          }

          if ((viewer.role === "gt" || viewer.role === "unico") && maybeSetReferenceScale(sampleKey, objectGroup, viewer.group)) {
            applyNormalizationForSample(sampleKey, viewer.group ? viewer.group.viewers : []);
            if (viewer.group && viewer.group.autoFrame) autoFrameGroupCamera(viewer.group, objectGroup);
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

function initCameraAndControls(group, domElementForControls) {
  const fov = Number.isFinite(group.cameraFov) ? group.cameraFov : 45;
  group.camera = new THREE.PerspectiveCamera(fov, 1.0, 0.1, 1000);
  // Slightly farther away so objects appear smaller by default.
  group.camera.position.set(0.5, 0.5, 1.8);
  group.camera.lookAt(0, 0, 0);

  group.controls = new THREE.OrbitControls(group.camera, domElementForControls);
  group.controls.enableDamping = true;
  group.controls.target.set(0, 0, 0);
  group.controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  group.controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  group.controls.update();
  group.controls.addEventListener("start", () => {
    group.autoRotate = false;
  });
}

function bindControlsToDom(group, domElementForControls) {
  if (!group || !group.camera || !domElementForControls) return;
  if (group.controls && group.controls.domElement === domElementForControls) return;

  const prevTarget = group.controls ? group.controls.target.clone() : new THREE.Vector3(0, 0, 0);
  const prevEnableDamping = group.controls ? group.controls.enableDamping : true;
  const prevDampingFactor = group.controls ? group.controls.dampingFactor : 0.05;
  const prevRotateSpeed = group.controls ? group.controls.rotateSpeed : 1.0;
  const prevZoomSpeed = group.controls ? group.controls.zoomSpeed : 1.0;
  const prevPanSpeed = group.controls ? group.controls.panSpeed : 1.0;

  if (group.controls) group.controls.dispose();

  group.controls = new THREE.OrbitControls(group.camera, domElementForControls);
  group.controls.enableDamping = prevEnableDamping;
  group.controls.dampingFactor = prevDampingFactor;
  group.controls.rotateSpeed = prevRotateSpeed;
  group.controls.zoomSpeed = prevZoomSpeed;
  group.controls.panSpeed = prevPanSpeed;
  group.controls.target.copy(prevTarget);
  group.controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  group.controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };
  group.controls.update();
  group.controls.addEventListener("start", () => {
    group.autoRotate = false;
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

function animateGroups() {
  if (!RUNNING) return;
  requestAnimationFrame(() => animateGroups());

  for (const group of GROUPS) {
    if (!group || !group.viewers || !group.camera) continue;

    if (group.controls) group.controls.update();

    for (const v of group.viewers) syncRendererSize(v);

    if (group.autoRotate) {
      const axisLocal = group.autoRotateAxisLocal === "z" ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);

      for (const v of group.viewers) {
        if (!v || !v.currentObj) continue;
        const obj = v.currentObj;

        const baseQ = obj.userData.baseQuaternion ? obj.userData.baseQuaternion.clone() : new THREE.Quaternion();
        const axisWorld = axisLocal.clone().applyQuaternion(baseQ).normalize();
        if (!Number.isFinite(obj.userData.autoRotateAngle)) obj.userData.autoRotateAngle = 0;
        obj.userData.autoRotateAngle += 0.01;

        const rotQ = new THREE.Quaternion().setFromAxisAngle(axisWorld, obj.userData.autoRotateAngle);
        obj.quaternion.copy(rotQ).multiply(baseQ);
      }
    }

    for (const v of group.viewers) {
      if (!v || !v.renderer || !v.scene) continue;
      const w = v.container.clientWidth;
      const h = v.container.clientHeight;
      if (w <= 0 || h <= 0) continue;
      group.camera.aspect = w / h;
      group.camera.updateProjectionMatrix();
      v.renderer.render(v.scene, group.camera);
    }
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

function bindSelectorsForGroup(group, sampleContainerId, methodContainerId) {
  const sampleContainer = document.getElementById(sampleContainerId);
  const methodContainer = document.getElementById(methodContainerId);
  if (!sampleContainer || !methodContainer) return;

  const sampleButtons = Array.from(sampleContainer.querySelectorAll("[data-sample]"));
  const methodButtons = Array.from(methodContainer.querySelectorAll("[data-method]"));

  const applyLoad = () => {
    if (!group.currentSample) return;
    loadModelInto(group.gtViewer, group, group.currentSample, "gt");
    loadModelInto(group.inputViewer, group, group.currentSample, "input");
    loadModelInto(group.unicoViewer, group, group.currentSample, "unico");
    loadModelInto(group.methodViewer, group, group.currentSample, group.currentMethod);

    if (group.unicoPointsViewer) loadColoredPointPlyInto(group.unicoPointsViewer, group, group.currentSample, "unico");
    if (group.methodPointsViewer) loadColoredPointPlyInto(group.methodPointsViewer, group, group.currentSample, group.currentMethod);
  };

  for (const btn of sampleButtons) {
    btn.addEventListener("click", () => {
      group.currentSample = btn.getAttribute("data-sample");
      setActiveButton(sampleButtons, btn);
      applyLoad();
    });
  }

  for (const btn of methodButtons) {
    btn.addEventListener("click", () => {
      group.currentMethod = btn.getAttribute("data-method") || group.currentMethod;
      setActiveButton(methodButtons, btn);
      applyLoad();
    });
  }

  const defaultSampleBtn = sampleButtons.find((b) => b.getAttribute("data-default") === "true") || sampleButtons[0];
  const defaultMethodBtn = methodButtons.find((b) => b.getAttribute("data-default") === "true") || methodButtons[0];

  if (defaultMethodBtn) defaultMethodBtn.click();
  if (defaultSampleBtn) defaultSampleBtn.click();
}

function initGroup(config) {
  const group = {
    datasetDir: config.datasetDir,
    alignToGround: !!config.alignToGround,
    upAxis: config.upAxis || "y",
    doubleSided: !!config.doubleSided,
    autoRotateAxisLocal: config.autoRotateAxisLocal || "y",
    autoFrame: config.autoFrame !== false,
    autoFrameViewDir: config.autoFrameViewDir,
    autoFrameTargetHeightFactor: Number.isFinite(config.autoFrameTargetHeightFactor) ? config.autoFrameTargetHeightFactor : undefined,
    autoFrameDistanceMultiplier: Number.isFinite(config.autoFrameDistanceMultiplier) ? config.autoFrameDistanceMultiplier : undefined,
    cameraFov: Number.isFinite(config.cameraFov) ? config.cameraFov : undefined,
    autoRotate: true,
    currentSample: null,
    currentMethod: config.defaultMethod,
    camera: null,
    controls: null,
    viewers: [],
    gtViewer: null,
    inputViewer: null,
    unicoViewer: null,
    methodViewer: null,
    unicoPointsViewer: null,
    methodPointsViewer: null
  };

  const gtViewer = makeViewer(document.getElementById(config.viewerIds.gt), config.viewerUI.gt);
  if (!gtViewer.container) return null;
  gtViewer.role = "gt";

  const inputViewer = makeViewer(document.getElementById(config.viewerIds.input), config.viewerUI.input);
  inputViewer.role = "input";

  const unicoViewer = makeViewer(document.getElementById(config.viewerIds.unico), config.viewerUI.unico);
  unicoViewer.role = "unico";

  const methodViewer = makeViewer(document.getElementById(config.viewerIds.method), config.viewerUI.method);
  methodViewer.role = "method";

  group.gtViewer = gtViewer;
  group.inputViewer = inputViewer;
  group.unicoViewer = unicoViewer;
  group.methodViewer = methodViewer;

  const viewers = [gtViewer, inputViewer, unicoViewer, methodViewer];

  if (config.viewerIds.unicoPoints && config.viewerIds.methodPoints) {
    const unicoPointsViewer = makeViewer(document.getElementById(config.viewerIds.unicoPoints), config.viewerUI.unicoPoints);
    const methodPointsViewer = makeViewer(document.getElementById(config.viewerIds.methodPoints), config.viewerUI.methodPoints);
    if (unicoPointsViewer.container && methodPointsViewer.container) {
      unicoPointsViewer.role = "unico_points";
      methodPointsViewer.role = "method_points";
      group.unicoPointsViewer = unicoPointsViewer;
      group.methodPointsViewer = methodPointsViewer;
      viewers.push(unicoPointsViewer, methodPointsViewer);
    }
  }

  group.viewers = viewers;

  // attach group reference for normalization propagation
  for (const v of viewers) v.group = group;

  initCameraAndControls(group, unicoViewer.renderer.domElement);

  for (const v of viewers) {
    const canvas = v.renderer?.domElement;
    if (!canvas) continue;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", () => bindControlsToDom(group, canvas), true);
    canvas.addEventListener("pointerenter", () => bindControlsToDom(group, canvas));
    canvas.style.touchAction = "none";
  }

  handleResize(viewers);
  requestAnimationFrame(() => handleResize(viewers));

  bindSelectorsForGroup(group, config.sampleContainerId, config.methodContainerId);

  return group;
}

window.addEventListener("DOMContentLoaded", () => {
  const abcGroup = initGroup({
    datasetDir: "abc",
    defaultMethod: "symm",
    alignToGround: false,
    autoFrame: false,
    sampleContainerId: "comparison-samples",
    methodContainerId: "comparison-methods",
    viewerIds: {
      input: "input-viewer",
      gt: "gt-viewer",
      unico: "unico-mesh-subview",
      method: "method-mesh-subview",
      unicoPoints: "unico-points-subview",
      methodPoints: "method-points-subview"
    },
    viewerUI: {
      input: { loader: "loader-input", progress: "progress-input", placeholder: "placeholder-input" },
      gt: { loader: "loader-gt", progress: "progress-gt", placeholder: "placeholder-gt" },
      unico: { loader: "loader-unico", progress: "progress-unico", placeholder: "placeholder-unico" },
      method: { loader: "loader-method", progress: "progress-method", placeholder: "placeholder-method" },
      unicoPoints: { loader: "loader-unico-points", progress: "progress-unico-points", placeholder: "placeholder-unico-points" },
      methodPoints: { loader: "loader-method-points", progress: "progress-method-points", placeholder: "placeholder-method-points" }
    }
  });
  if (abcGroup) GROUPS.push(abcGroup);

  const buildingGroup = initGroup({
    datasetDir: "building",
    defaultMethod: "paco",
    alignToGround: true,
    upAxis: "z",
    doubleSided: true,
    autoRotateAxisLocal: "z",
    cameraFov: 35,
    autoFrame: true,
    autoFrameViewDir: [0.0, 0.5, 0.5],
    autoFrameTargetHeightFactor: 0.35,
    autoFrameDistanceMultiplier: 1.1,
    sampleContainerId: "comparison-samples-building",
    methodContainerId: "comparison-methods-building",
    viewerIds: {
      input: "input-viewer-building",
      gt: "gt-viewer-building",
      unico: "unico-viewer-building",
      method: "method-viewer-building"
    },
    viewerUI: {
      input: { loader: "loader-input-building", progress: "progress-input-building", placeholder: "placeholder-input-building" },
      gt: { loader: "loader-gt-building", progress: "progress-gt-building", placeholder: "placeholder-gt-building" },
      unico: { loader: "loader-unico-building", progress: "progress-unico-building", placeholder: "placeholder-unico-building" },
      method: { loader: "loader-method-building", progress: "progress-method-building", placeholder: "placeholder-method-building" }
    }
  });
  if (buildingGroup) GROUPS.push(buildingGroup);

  if (GROUPS.length === 0) return;

  window.addEventListener("resize", () => {
    for (const g of GROUPS) handleResize(g.viewers);
  });

  RUNNING = true;
  animateGroups();
});