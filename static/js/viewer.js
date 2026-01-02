const container = document.getElementById("shared-viewer");
let scene, camera, renderer, controls;
let currentObj = null;
let activeIndex = null;
let autoRotate = true;
let running = false;
let loading = false;

const cols = 7;
const rows = 6;
const total = 42;

const models = [
  // ---------- Airplane Row 1 ----------
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/00_draco.glb",
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/89b42bde2332e5c067c5e3041553656b_draco.glb",
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/equiv_89b42bde2332e5c067c5e3041553656b_draco.glb",
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/ada_89b42bde2332e5c067c5e3041553656b_draco.glb",
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/escape_89b42bde2332e5c067c5e3041553656b_draco.glb",
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/equivpcn_89b42bde2332e5c067c5e3041553656b_draco.glb",
  "./static/data/airplane/89b42bde2332e5c067c5e3041553656b/scarp_89b42bde2332e5c067c5e3041553656b_draco.glb",

  // ---------- Airplane Row 2 ----------
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/00_draco.glb",
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/48996e27f430ce286f67a5681eaf4d9f_draco.glb",
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/equiv_48996e27f430ce286f67a5681eaf4d9f_draco.glb",
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/ada_48996e27f430ce286f67a5681eaf4d9f_draco.glb",
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/escape_48996e27f430ce286f67a5681eaf4d9f_draco.glb",
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/equivpcn_48996e27f430ce286f67a5681eaf4d9f_draco.glb",
  "./static/data/airplane/48996e27f430ce286f67a5681eaf4d9f/scarp_48996e27f430ce286f67a5681eaf4d9f_draco.glb",

  // ---------- Lamp Row 1 ----------
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/00_draco.glb",
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/846ae34d173c06d828e0b580c4eee0e6_draco.glb",
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/equiv_846ae34d173c06d828e0b580c4eee0e6_draco.glb",
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/ada_846ae34d173c06d828e0b580c4eee0e6_draco.glb",
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/escape_846ae34d173c06d828e0b580c4eee0e6_draco.glb",
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/equivpcn_846ae34d173c06d828e0b580c4eee0e6_draco.glb",
  "./static/data/lamp/846ae34d173c06d828e0b580c4eee0e6/scarp_846ae34d173c06d828e0b580c4eee0e6_draco.glb",

  // ---------- Lamp Row 2 ----------
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/00_draco.glb",
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/ced76fc046191db3fe5c8ffd0f5eba47_draco.glb",
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/equiv_ced76fc046191db3fe5c8ffd0f5eba47_draco.glb",
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/ada_ced76fc046191db3fe5c8ffd0f5eba47_draco.glb",
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/escape_ced76fc046191db3fe5c8ffd0f5eba47_draco.glb",
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/equivpcn_ced76fc046191db3fe5c8ffd0f5eba47_draco.glb",
  "./static/data/lamp/ced76fc046191db3fe5c8ffd0f5eba47/scarp_ced76fc046191db3fe5c8ffd0f5eba47_draco.glb",

  // ---------- Table Row 1 ----------
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/00_draco.glb",
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/5bcb0976657fe6df37b2bb75885cfc44_draco.glb",
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/equiv_5bcb0976657fe6df37b2bb75885cfc44_draco.glb",
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/ada_5bcb0976657fe6df37b2bb75885cfc44_draco.glb",
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/escape_5bcb0976657fe6df37b2bb75885cfc44_draco.glb",
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/equivpcn_5bcb0976657fe6df37b2bb75885cfc44_draco.glb",
  "./static/data/table/5bcb0976657fe6df37b2bb75885cfc44/scarp_5bcb0976657fe6df37b2bb75885cfc44_draco.glb",

  // ---------- Table Row 2 ----------
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/00_draco.glb",
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/d31b0d2a41051f2c7b79156a61ad4c01_draco.glb",
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/equiv_d31b0d2a41051f2c7b79156a61ad4c01_draco.glb",
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/ada_d31b0d2a41051f2c7b79156a61ad4c01_draco.glb",
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/escape_d31b0d2a41051f2c7b79156a61ad4c01_draco.glb",
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/equivpcn_d31b0d2a41051f2c7b79156a61ad4c01_draco.glb",
  "./static/data/table/d31b0d2a41051f2c7b79156a61ad4c01/scarp_d31b0d2a41051f2c7b79156a61ad4c01_draco.glb"
];

// ========== Loader ==========
const loader = new THREE.GLTFLoader();
const dracoLoader = new THREE.DRACOLoader();
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/v1/decoders/");
loader.setDRACOLoader(dracoLoader);

// ========== Utility functions ==========
function clearCurrentObj() {
  if (currentObj) {
    currentObj.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    scene.remove(currentObj);
    currentObj = null;
  }
}

function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (currentObj && autoRotate) currentObj.rotation.y += 0.01;
  renderer.render(scene, camera);
}

function startRenderLoop() {
  if (!running) {
    running = true;
    animate();
  }
}

// ========== Initialize Viewer ==========
function initViewer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    1000
  );
  camera.position.set(0.5, 0.5, 0.6);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);

  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) oldCanvas.remove();
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.addEventListener("start", () => {
    autoRotate = false;
  });

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);

  startRenderLoop();
}

// ========== Load Model ==========
function loadModel(glbPath, index) {
  if (loading) return;
  loading = true;

  // 1. Clear old object
  clearCurrentObj();

  // 2. Show loader bar
  const loaderDiv = document.getElementById("loader");
  const progressDiv = document.getElementById("progress");
  loaderDiv.style.display = "block";
  progressDiv.style.width = "0%";

  const thisIndex = index; // Capture index to avoid race condition

  loader.load(
    glbPath,
    (gltf) => {
      if (activeIndex !== thisIndex) {
        loading = false;
        return; // If user already clicked another model, discard
      }

      currentObj = gltf.scene;
      currentObj.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.computeVertexNormals();
          child.material.color.setHex(0xd8cab0);
          child.material.roughness = 0.7;
          child.material.metalness = 0.1;

          // Optimization for point clouds
          child.frustumCulled = false;
          if (child.material.size !== undefined) {
            child.material.size = 0.01;
          }
        }
      });

      // Center and scale
      const box = new THREE.Box3().setFromObject(currentObj);
      currentObj.scale.set(0.7, 0.7, 0.7);

      box.setFromObject(currentObj);
      const center = box.getCenter(new THREE.Vector3());
      currentObj.position.sub(center);

      scene.add(currentObj);

      // Reset camera and controls each time a new model loads
      camera.position.set(0.5, 0.5, 0.6);
      camera.lookAt(0, 0, 0);
      controls.target.set(0, 0, 0);
      controls.update();

      loaderDiv.style.display = "none";
      loading = false;
    },
    (xhr) => {
      if (xhr.lengthComputable) {
        const percent = (xhr.loaded / xhr.total) * 100;
        progressDiv.style.width = percent + "%";
      }
    },
    (error) => {
      console.error("Failed to load model:", error);
      loaderDiv.innerHTML = "<div style='color:red;'>Load failed</div>";
      loading = false;
    }
  );
}

// ========== Highlighter ==========
const highlightBox = document.createElement("div");
highlightBox.style.position = "absolute";
highlightBox.style.border = "2px solid #4CAF50";   // 蓝色边框
highlightBox.style.borderRadius = "12px";          // 圆角
// highlightBox.style.boxShadow = "0 0 8px rgba(0,123,255,0.6)"; // 蓝色发光阴影
highlightBox.style.pointerEvents = "none";
highlightBox.style.display = "none";

const gallery = document.getElementById("gallery");
gallery.parentElement.style.position = "relative"; // 父容器作为定位基准
gallery.parentElement.appendChild(highlightBox);

// 偏移量，可手动调节
const offsetX = +40;  // 往右挪 (+)，往左挪 (-)
const offsetY = +100;  // 往下挪 (+)，往上挪 (-)

function moveHighlight(index) {
  const thumbW = gallery.clientWidth / cols -7;
  const thumbH = gallery.clientHeight / rows -12;

  const col = index % cols;
  const row = Math.floor(index / cols);

  highlightBox.style.display = "block";
  highlightBox.style.width = (thumbW) + "px";
  highlightBox.style.height = (thumbH) + "px";

  highlightBox.style.left = (col * thumbW + offsetX) + "px";
  highlightBox.style.top  = (row * thumbH + offsetY) + "px";
}

// ========== Handle thumbnail click ==========
gallery.addEventListener("click", (e) => {
  const rect = gallery.getBoundingClientRect();
  const x = e.clientX - rect.left - 2;  // captionOffsetX
  const y = e.clientY - rect.top - 30; // captionOffsetY

  const thumbW = gallery.clientWidth / cols;
  const thumbH = gallery.clientHeight / rows;

  const col = Math.floor(x / thumbW);
  const row = Math.floor(y / thumbH);
  const index = row * cols + col;

  if (index >= total || index < 0) return;

  moveHighlight(index); // ✅ 直接用 index

  if (!scene) initViewer();
  activeIndex = index;
  autoRotate = true;
  loadModel(models[index], index);
});

// ========== Page initialization ==========
window.addEventListener("DOMContentLoaded", () => {
  initViewer();
  activeIndex = 9;
  autoRotate = true;
  loadModel(models[9], 9);

  moveHighlight(9); // ✅ 默认高亮第10个格子
});