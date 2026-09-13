import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import "./style.css";

// Relative paths so assets resolve correctly under any hosting subpath
// (e.g. GitHub Pages: https://USERNAME.github.io/REPOSITORY_NAME/)
const MODEL_PATH = "models/product-meshopt.glb";

// ============================================================================
// TEMPORARY AR DIAGNOSTICS — remove after debugging
// ============================================================================
console.log("[AR-DIAG] 1. Environment:");
console.log("[AR-DIAG]    userAgent:", navigator.userAgent);
console.log("[AR-DIAG]    protocol:", location.protocol);
console.log("[AR-DIAG]    hostname:", location.hostname);
console.log("[AR-DIAG]    isSecureContext:", window.isSecureContext);
console.log("[AR-DIAG]    navigator.xr available:", typeof navigator.xr !== "undefined");
console.log("[AR-DIAG]    document.readyState at module start:", document.readyState);
console.log("[AR-DIAG]    overlay element found:", document.getElementById("overlay") !== null);
window.addEventListener("error", (event) => {
  console.error(
    `[AR-DIAG] Uncaught JS error: "${event.message}" at ${event.filename}:${event.lineno}:${event.colno}`
  );
});
// ============================================================================

const overlay = document.getElementById("overlay") as HTMLDivElement;

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8b8b8);

// HDRI environment lighting: provides realistic ambient illumination and
// PBR reflections on glossy/metallic surfaces. The HDRI is NOT used as
// the visible background — the neutral gray background below is independent.
const HDRI_PATH = "environment/modern_bathroom_2k.hdr";

scene.environmentIntensity = 0.4;

new RGBELoader().load(
  HDRI_PATH,
  (hdrTexture) => {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmremGenerator.fromEquirectangular(hdrTexture).texture;
    hdrTexture.dispose();
    pmremGenerator.dispose();
    console.log("HDRI environment loaded");
  },
  undefined,
  (error) => {
    // The viewer keeps working: the product stays lit by the direct
    // key/fill/rim studio lights, just without HDRI reflections.
    console.error("Failed to load HDRI environment:", error);
  }
);

// Camera
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);
camera.position.set(2, 2, 5);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
controls.minDistance = 0.1;
controls.maxDistance = 100;
controls.update();

// Studio lighting -----------------------------------------------------------
// Three-point-style product setup, positioned relative to the model so it
// stays correct if the GLB is replaced by a product of a different size.

// 4. Low ambient contribution (soft, does not flatten the product)
const ambient = new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 0.35);
scene.add(ambient);

// 1. Key light: large soft main light, above and to one side, casts shadows
const keyLight = new THREE.DirectionalLight(0xffffff, 3.0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.bias = -0.0005;
keyLight.shadow.radius = 6;
scene.add(keyLight);

// 2. Fill light: opposite side, weaker, lifts shadow side
const fillLight = new THREE.DirectionalLight(0xffffff, 1.0);
scene.add(fillLight);

// 3. Rim light: behind/above, subtle, separates product from background
const rimLight = new THREE.DirectionalLight(0xffffff, 1.2);
scene.add(rimLight);

function setupStudioLighting(modelBounds: THREE.Box3): void {
  // Box3 from setFromObject() is already in world space
  const sphere = modelBounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 0.001);
  const center = sphere.center;
  const d = radius * 3;

  // Key: upper front-left
  keyLight.position.set(
    center.x - d * 0.6,
    center.y + d * 1.4,
    center.z + d * 0.9
  );
  keyLight.target.position.copy(center);
  keyLight.target.updateMatrixWorld();

  const shadowCam = keyLight.shadow.camera;
  shadowCam.left = -radius * 2;
  shadowCam.right = radius * 2;
  shadowCam.top = radius * 2;
  shadowCam.bottom = -radius * 2;
  shadowCam.near = d * 0.1;
  shadowCam.far = d * 4;
  shadowCam.updateProjectionMatrix();
  keyLight.shadow.normalBias = radius * 0.02;

  // Fill: opposite side, slightly below camera height
  fillLight.position.set(
    center.x + d * 0.8,
    center.y + d * 0.4,
    center.z + d * 0.6
  );
  fillLight.target.position.copy(center);
  fillLight.target.updateMatrixWorld();

  // Rim: behind and above
  rimLight.position.set(
    center.x + d * 0.3,
    center.y + d * 1.1,
    center.z - d * 1.0
  );
  rimLight.target.position.copy(center);
  rimLight.target.updateMatrixWorld();

  console.log("Studio lighting initialized");
}

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function showLoading(percent: number | null): void {
  if (percent !== null) {
    overlay.textContent = `Loading 3D model... ${percent}%`;
  } else {
    overlay.textContent = "Loading 3D model...";
  }
}

function showError(message: string): void {
  overlay.textContent = message;
  overlay.classList.add("error");
}

function frameModel(model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  const distance = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.5;

  const direction = new THREE.Vector3(1, 0.6, 1).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 100, 0.001);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.minDistance = maxDim * 0.1;
  controls.maxDistance = maxDim * 20;
  controls.update();

  console.log(
    `Model dimensions: ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)}`
  );
  console.log(
    `Model center: (${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)})`
  );
}

// Render loop (renderer.setAnimationLoop is used because it also drives
// the WebXR session loop when one is active)
renderer.setAnimationLoop((time, frame) => {
  if (renderer.xr.isPresenting) {
    if (frame) {
      onXRFrame(time, frame);
    }
  } else {
    controls.update();
  }
  renderer.render(scene, camera);
});

// Load model
console.log("3D viewer initialized");
console.log(`Loading model: ${MODEL_PATH}`);

showLoading(null);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder); // Meshopt-compressed GLB support
let productModel: THREE.Object3D | null = null; // shared with AR mode
loader.load(
  MODEL_PATH,
  (gltf) => {
    const model = gltf.scene;
    productModel = model;

    let meshCount = 0;
    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        meshCount++;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(model);
    frameModel(model);

    const modelBounds = new THREE.Box3().setFromObject(model);
    setupStudioLighting(modelBounds);

    overlay.classList.add("hidden");

    console.log("3D model loaded successfully");
    console.log(`Number of meshes: ${meshCount}`);
    console.log(
      `[AR-DIAG] 3. GLB model ready: productModel is now set (meshes: ${meshCount})`
    );
    updateArButton(); // show AR button once the model is ready
    console.log(
      `[AR-DIAG]    after updateArButton(): arSupported=${arSupported}, productModel=object`
    );
  },
  (progress) => {
    if (progress.total > 0) {
      showLoading(Math.round((progress.loaded / progress.total) * 100));
    }
  },
  (error) => {
    console.error(error);
    console.error(
      "[AR-DIAG] 3. GLB LOAD FAILED — productModel stays null, AR button will NEVER show"
    );
    showError("Unable to load 3D model. Place your GLB at public/models/product.glb");
  }
);

// WebXR AR placement --------------------------------------------------------
// AR button → immersive-ar session → hit-test against real-world surfaces →
// reticle follows the surface → user taps (select) → product placed →
// user exits (session "end") → desktop viewer restored.
//
// Native Three.js WebXR support only (renderer.xr). No external AR libraries.

const arButton = document.createElement("button");
arButton.id = "ar-button";
arButton.textContent = "AR";
arButton.style.display = "none";
document.body.appendChild(arButton);

console.log(
  `[AR-DIAG] 4. AR button created: in DOM=${document.getElementById("ar-button") !== null}, parent=${arButton.parentElement?.tagName}, initial style.display="${arButton.style.display}"`
);

// Dedicated AR DOM overlay containing the "Exit AR" button (top-right).
// This container is the dom-overlay root: only its contents are visible
// and interactive inside an immersive-ar session.
const arOverlay = document.createElement("div");
arOverlay.id = "ar-overlay";
arOverlay.style.display = "none";
const arExitButton = document.createElement("button");
arExitButton.id = "ar-exit-button";
arExitButton.textContent = "Exit AR";
arOverlay.appendChild(arExitButton);
document.body.appendChild(arOverlay);

// Reticle: lightweight ring that marks the detected placement surface.
// matrixAutoUpdate = false because its pose is set directly from the hit-test.
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.085, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x4285f4 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// AR-only state
let xrSession: XRSession | null = null;
let hitTestSource: XRHitTestSource | null = null;
let xrRefSpace: XRReferenceSpace | null = null;
let placed = false; // product placed during this AR session?
const reticleMatrix = new THREE.Matrix4();
const placedPosition = new THREE.Vector3();

// AR product transformation factors (AR-only; desktop scale is untouched)
const AR_SCALE_FACTOR = 0.1; // AR product is 1/10 of its previous AR size
const AR_Y_ROTATION = Math.PI / 2; // +90° counter-clockwise around the up axis

// Saved desktop state, restored when the AR session ends.
const savedCamPos = new THREE.Vector3();
const savedCamQuat = new THREE.Quaternion();
let savedCamFov = camera.fov;
let savedBackground: THREE.Color | THREE.Texture | null = scene.background;
const savedModelScale = new THREE.Vector3(1, 1, 1); // desktop scale restore

// AR availability + button visibility ----------------------------------------
let arSupported = false;

function updateArButton(): void {
  if (xrSession !== null) {
    // Active AR session — the bottom AR button is hidden; exiting is done
    // via the dedicated "Exit AR" button in the AR DOM overlay.
    arButton.style.display = "none";
  } else {
    arButton.style.display = arSupported && productModel !== null ? "block" : "none";
    arButton.textContent = "AR";
  }
  // [AR-DIAG] 5. Button computed state after each update
  const computed = window.getComputedStyle(arButton);
  console.log(
    `[AR-DIAG] 5. updateArButton(): display="${arButton.style.display}" | computed.display="${computed.display}" | computed.visibility="${computed.visibility}" | computed.opacity="${computed.opacity}" | arSupported=${arSupported} | productModel=${productModel !== null ? "loaded" : "null"}`
  );
}

if (navigator.xr) {
  console.log("[AR-DIAG] 2. navigator.xr exists — checking immersive-ar support...");
  navigator.xr
    .isSessionSupported("immersive-ar")
    .then((supported) => {
      arSupported = supported;
      console.log(
        `[AR-DIAG] 2. isSessionSupported("immersive-ar") resolved: ${supported}`
      );
      updateArButton();
      if (supported) {
        console.log("WebXR immersive-ar available");
      } else {
        console.warn(
          "[AR-DIAG]    immersive-ar NOT supported by this browser/device — button stays hidden"
        );
      }
    })
    .catch((error) => {
      // Detection failed — button stays hidden, desktop viewer unaffected
      console.warn("WebXR availability check failed:", error);
      console.warn(
        `[AR-DIAG] 2. isSessionSupported("immersive-ar") REJECTED:`,
        error
      );
    });
} else {
  console.warn(
    "[AR-DIAG] 2. navigator.xr is UNDEFINED — this browser does not expose WebXR at all (button stays hidden)"
  );
}

// Prevent taps on overlay buttons from also triggering a session "select"
// (which would place the product) while the DOM overlay is active.
arButton.addEventListener("beforexrselect", (event) => {
  event.preventDefault();
});
arOverlay.addEventListener("beforexrselect", (event) => {
  event.preventDefault();
});

// Exit AR — dedicated handler on the overlay's Exit button ONLY.
// The XR "select" event is never used for exiting.
arExitButton.addEventListener("click", () => {
  if (xrSession === null) return;
  xrSession.end().catch((error) => {
    console.error("Failed to end AR session:", error);
  });
});

// Start AR — the bottom button's only job is entering the session.
// Exiting is done ONLY via the dedicated Exit AR button in the overlay.
arButton.addEventListener("click", () => {
  if (xrSession !== null) return; // already in AR

  if (!navigator.xr) {
    alert("WebXR is not available in this browser.");
    return;
  }

  navigator.xr
    .requestSession("immersive-ar", {
      requiredFeatures: ["hit-test", "local-floor"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: arOverlay },
    })
    .then(onSessionStarted)
    .catch((error) => {
      // Covers: permission denied, session creation failure, unsupported device
      console.error("Failed to start AR session:", error);
      alert("Unable to start AR. Check permissions and device support.");
    });
});

async function onSessionStarted(session: XRSession): Promise<void> {
  xrSession = session;
  placed = false;
  reticle.visible = false;

  // The product must NOT appear until the user places it: hide it for the
  // whole session (shown again in onSelect / on session end).
  if (productModel) {
    productModel.visible = false;

    // Apply the AR-only scale factor once per session (saved for restore on
    // exit) so it never compounds across reposition taps or sessions.
    savedModelScale.copy(productModel.scale);
    productModel.scale.multiplyScalar(AR_SCALE_FACTOR);
    productModel.updateMatrixWorld(true);
  }

  // Show the AR DOM overlay (Exit AR button) for the session duration
  arOverlay.style.display = "block";
  updateArButton();

  // Save desktop camera state (XR overwrites position/quaternion/fov/projection)
  savedCamPos.copy(camera.position);
  savedCamQuat.copy(camera.quaternion);
  savedCamFov = camera.fov;

  // Suspend OrbitControls for the AR duration
  controls.enabled = false;

  // Make the background transparent so the camera feed stays visible.
  // The HDRI environment keeps lighting the model; only the visible
  // background color is suppressed (renderer created with alpha:true).
  savedBackground = scene.background;
  scene.background = null;

  await renderer.xr.setSession(session);

  session.addEventListener("end", onSessionEnded);

  // Hit-test setup: one persistent viewer-space source, from the camera ray
  try {
    const viewerSpace = await session.requestReferenceSpace("viewer");
    if (session.requestHitTestSource) {
      const source = await session.requestHitTestSource({
        space: viewerSpace,
        entityTypes: ["plane", "point", "mesh"],
      });
      if (source) {
        hitTestSource = source;
      } else {
        console.warn("WebXR hit-test not available on this device");
      }
    } else {
      console.warn("WebXR hit-test not available on this device");
    }
  } catch (error) {
    console.error("Hit-test setup failed:", error);
  }

  xrRefSpace = renderer.xr.getReferenceSpace();

  // "select" = user tap on phone screen / controller trigger
  session.addEventListener("select", onSelect);
}

function onSelect(): void {
  if (!reticle.visible || !productModel) return;

  // The WebXR hit-test pose convention: +Y of the pose is the surface's
  // outward normal. Extract it in world space.
  const poseQuat = new THREE.Quaternion();
  reticleMatrix.decompose(placedPosition, poseQuat, new THREE.Vector3());
  const surfaceNormal = new THREE.Vector3(0, 1, 0).applyQuaternion(poseQuat);

  // Upright facing direction: on a vertical wall the model stays upright
  // (world up) with its front (+Z) facing out of the wall; on a horizontal
  // surface it simply stands upright. This avoids "lying flat" placements.
  const forward = new THREE.Vector3();
  if (Math.abs(surfaceNormal.y) < 0.7) {
    // vertical surface (wall)
    forward.copy(surfaceNormal);
    forward.y = 0;
    forward.normalize();
  } else {
    // horizontal surface (floor/table)
    forward.set(0, 0, 1);
  }

  productModel.position.copy(placedPosition);
  productModel.up.set(0, 1, 0);
  productModel.lookAt(placedPosition.clone().add(forward));

  // Additional AR-only +90° counter-clockwise yaw around the model's up
  // (vertical Y) axis. Applied AFTER the wall-facing orientation above, as
  // a premultiplied local rotation, so it integrates with the wall-facing
  // direction instead of replacing it — the model stays upright and flush.
  const yawOffset = new THREE.Quaternion().setFromAxisAngle(
    productModel.up,
    AR_Y_ROTATION
  );
  productModel.quaternion.premultiply(yawOffset);

  productModel.visible = true; // reveal the (already placed) product
  productModel.updateMatrixWorld(true);

  // Push the model out along the surface normal so its back rests flush on
  // the surface instead of being half-embedded in it.
  const bounds = new THREE.Box3().setFromObject(productModel);
  const backDir = surfaceNormal.clone().negate();
  let maxDepth = 0;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      i & 1 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y,
      i & 4 ? bounds.max.z : bounds.min.z
    ).sub(placedPosition);
    maxDepth = Math.max(maxDepth, corner.dot(backDir));
  }
  productModel.position.addScaledVector(surfaceNormal, maxDepth);
  productModel.updateMatrixWorld(true);

  // Re-fit shadow camera + light targets to the new product position
  setupStudioLighting(new THREE.Box3().setFromObject(productModel));
  console.log(placed ? "Product repositioned in AR" : "Product placed in AR");
  placed = true;
}

function onSessionEnded(): void {
  if (xrSession) {
    xrSession.removeEventListener("select", onSelect);
    xrSession.removeEventListener("end", onSessionEnded);
  }
  if (hitTestSource) {
    hitTestSource.cancel();
    hitTestSource = null;
  }
  xrSession = null;
  xrRefSpace = null;
  reticle.visible = false;
  placed = false;

  // Hide the AR overlay (Exit AR button) and restore the desktop AR button
  arOverlay.style.display = "none";
  updateArButton();

  // Restore the product's visibility and DESKTOP scale for the normal
  // viewer — done before the light/framing refit below so it is computed
  // with the original scale.
  if (productModel) {
    productModel.visible = true;
    productModel.scale.copy(savedModelScale);
    productModel.updateMatrixWorld(true);
  }

  // Restore desktop viewer state
  scene.background = savedBackground;
  controls.enabled = true;

  // Restore camera pose (XR overwrote it). Position/quaternion were saved;
  // fov is handled by frameModel-esque restore below.
  camera.position.copy(savedCamPos);
  camera.quaternion.copy(savedCamQuat);
  camera.fov = savedCamFov;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  controls.update();

  // Re-fit lights/shadows to the model's new AR world position
  if (productModel) {
    const bounds = new THREE.Box3().setFromObject(productModel);
    setupStudioLighting(bounds);
    // Re-frame the desktop camera around the moved model
    frameModel(productModel);
  }

  console.log("AR session ended — viewer restored");
}

// Per-frame AR logic ---------------------------------------------------------
function onXRFrame(time: number, frame: XRFrame): void {
  void time;

  if (hitTestSource === null || xrRefSpace === null) return;

  // Track the most recent valid hit every frame — both before and after
  // placement, so the reticle always marks the next possible placement
  // position (first tap = place, later taps = reposition).
  const results = frame.getHitTestResults(hitTestSource);
  if (results.length > 0) {
    const pose = results[0].getPose(xrRefSpace);
    if (pose) {
      reticleMatrix.fromArray(pose.transform.matrix);
      reticle.matrix.copy(reticleMatrix);
      reticle.visible = true;
    }
  } else {
    reticle.visible = false;
  }
}
