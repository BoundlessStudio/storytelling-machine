import * as THREE from './vendor/three.module.min.js';

/* The Living Library. All 230 covers share one atlas in the school. Only the
 * book on the desk uses its larger cover, and only nearby studies are loaded. */
const $ = id => document.getElementById(id);
const root = $('living-library');
const data = JSON.parse($('living-library-data').textContent);
const stories = data.stories;
const total = stories.length;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mobile = matchMedia('(max-width: 700px), (max-aspect-ratio: 1/1)');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => value * value * (3 - 2 * value);
const wrap = index => (index % total + total) % total;
let seed = 84323;
function random() { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }

function legacyStorySlug(url = new URL(location.href)) {
  return new URLSearchParams(url.hash.slice(1)).get('story');
}
function storySlugFromUrl() {
  const url = new URL(location.href);
  return url.searchParams.get('story') || legacyStorySlug(url);
}
function replaceStoryUrl(storyIndex) {
  const url = new URL(location.href);
  url.searchParams.set('story', stories[storyIndex].slug);
  const fragment = new URLSearchParams(url.hash.slice(1));
  if (fragment.has('story')) { fragment.delete('story'); url.hash = fragment.toString(); }
  history.replaceState(history.state, '', url);
}

const requestedSlug = storySlugFromUrl();
const requestedIndex = stories.findIndex(story => story.slug === requestedSlug);
let index = requestedIndex >= 0 ? requestedIndex : 0;
if (!requestedSlug) {
  try {
    const navigation = performance.getEntriesByType('navigation')[0];
    const saved = navigation?.type === 'back_forward' ? sessionStorage.getItem('living-library-book') : null;
    const found = stories.findIndex(story => story.slug === saved);
    if (found >= 0) index = found;
  } catch { /* Private browsing can disable storage. */ }
}
if (requestedIndex >= 0 && legacyStorySlug() !== null) replaceStoryUrl(index);
let shownIndex = index;
let paused = reducedMotion.matches;
let sceneController;
let swapTimer;
let dissolveTimer;
let wheelSum = 0;
let lastWheel = 0;
let lastSelection = -Infinity;
let photos = [];
let referenceIndex = 0;
let destroyed = false;
let ready = false;
const dialog = $('ll-lightbox');

function revealLibrary() {
  if (ready || destroyed) return;
  ready = true;
  wheelSum = 0;
  root.classList.remove('is-loading');
  root.setAttribute('aria-busy', 'false');
  $('ll-loading').inert = true;
  $('ll-loading').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('is-library-loading');
  root.dispatchEvent(new Event('library-ready'));
  sceneController?.wake();
}

function motionLabel() {
  $('ll-motion').setAttribute('aria-pressed', String(paused));
  $('ll-motion-label').textContent = paused ? 'Resume motion' : 'Pause motion';
  $('ll-motion').firstElementChild.textContent = paused ? '▷' : 'Ⅱ';
}
motionLabel();
$('ll-motion').addEventListener('click', () => { paused = !paused; motionLabel(); sceneController?.wake(); });
reducedMotion.addEventListener('change', event => { paused = event.matches; motionLabel(); sceneController?.wake(); });

function openReference(number) {
  referenceIndex = (number + photos.length) % photos.length;
  const photo = photos[referenceIndex];
  if (!photo) return;
  const img = $('ll-lightbox-image');
  img.src = photo.full;
  img.alt = `${photo.title} — ${stories[shownIndex].title}`;
  $('ll-image-title').textContent = photo.title;
  $('ll-image-prev').hidden = $('ll-image-next').hidden = photos.length < 2;
  if (!dialog.open) dialog.showModal();
}
$('ll-lightbox-close').addEventListener('click', () => dialog.close());
$('ll-image-prev').addEventListener('click', () => openReference(referenceIndex - 1));
$('ll-image-next').addEventListener('click', () => openReference(referenceIndex + 1));
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => sceneController?.wake());

function showStory(nextIndex, announce = true) {
  shownIndex = nextIndex;
  const story = stories[nextIndex];
  $('ll-story-title').textContent = story.title;
  $('ll-story-meta').textContent = `${story.rating} · Original fiction`;
  $('ll-prompt-text').textContent = story.prompt;
  fitPromptText();
  $('ll-read').href = $('ll-book-fallback').href = story.url;
  $('ll-read').setAttribute('aria-label', `Read ${story.title}`);
  $('ll-read').title = `Read ${story.title}`;
  $('ll-book-fallback').setAttribute('aria-label', `Read ${story.title}`);
  $('ll-fallback-cover').src = story.cover;
  $('ll-fallback-cover').alt = `Cover of ${story.title}`;
  $('ll-art-link').href = story.art;
  photos = story.references;
  const container = $('ll-references');
  container.replaceChildren();
  photos.forEach((photo, number) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'll-photo';
    button.setAttribute('aria-label', `View ${photo.title}, reference for ${story.title}`);
    button.setAttribute('aria-busy', 'true');
    const img = document.createElement('img');
    img.alt = photo.title;
    img.decoding = 'async';
    img.addEventListener('load', () => button.removeAttribute('aria-busy'), { once: true });
    img.addEventListener('error', () => {
      // Keep the other same-story studies usable if a remote original is offline.
      button.hidden = true;
    }, { once: true });
    img.src = photo.src;
    const caption = document.createElement('span');
    caption.textContent = photo.title;
    button.append(img, caption);
    button.addEventListener('click', () => openReference(number));
    container.append(button);
  });
  sceneController?.positionDeskContent();
  if (announce) $('ll-announcement').textContent = `${nextIndex + 1} of ${total}. ${story.title}. ${story.rating}. ${story.prompt}`;
}

function fitPromptText() {
  const text = $('ll-prompt-text');
  const paper = text.parentElement;
  text.style.fontSize = '';
  let size = parseFloat(getComputedStyle(text).fontSize);
  while (text.scrollHeight > paper.clientHeight + 1 && size > 15) {
    size -= .5;
    text.style.fontSize = `${size}px`;
  }
}
document.fonts.ready.then(fitPromptText);

function chooseStory(nextIndex, updateUrl = true) {
  nextIndex = wrap(nextIndex);
  if (!ready || nextIndex === index || dialog.open || destroyed) return;
  lastSelection = performance.now();
  index = nextIndex;
  clearTimeout(swapTimer);
  clearTimeout(dissolveTimer);
  root.classList.add('is-dissolving');
  sceneController?.select(nextIndex);
  swapTimer = setTimeout(() => {
    showStory(nextIndex);
    dissolveTimer = setTimeout(() => root.classList.remove('is-dissolving'), reducedMotion.matches ? 10 : 50);
  }, reducedMotion.matches ? 50 : 180);
  if (updateUrl) replaceStoryUrl(nextIndex);
  try { sessionStorage.setItem('living-library-book', stories[nextIndex].slug); } catch { /* Optional continuity. */ }
}
window.addEventListener('popstate', () => {
  const slug = storySlugFromUrl();
  const next = stories.findIndex(story => story.slug === slug);
  if (next >= 0) chooseStory(next, false);
});
window.addEventListener('hashchange', () => {
  const slug = legacyStorySlug();
  const next = stories.findIndex(story => story.slug === slug);
  if (next >= 0) { replaceStoryUrl(next); chooseStory(next, false); }
});

function promptCanScroll(event) {
  const pane = event.target.closest?.('.ll-prompt-scroll');
  if (!pane || pane.scrollHeight <= pane.clientHeight + 1) return false;
  return event.deltaY < 0 ? pane.scrollTop > 0 : pane.scrollTop + pane.clientHeight < pane.scrollHeight - 1;
}
window.addEventListener('wheel', event => {
  if (!ready || dialog.open || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY) || promptCanScroll(event)) return;
  event.preventDefault();
  const now = performance.now();
  if (now - lastSelection < (reducedMotion.matches ? 125 : 525)) { wheelSum = 0; lastWheel = now; return; }
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
  if (now - lastWheel > 180 || Math.sign(delta) !== Math.sign(wheelSum)) wheelSum = 0;
  lastWheel = now;
  wheelSum += delta;
  if (Math.abs(wheelSum) >= 48) { chooseStory(index + Math.sign(wheelSum)); wheelSum = 0; }
}, { passive: false });
window.addEventListener('keydown', event => {
  if (!ready) return;
  if (dialog.open) {
    if (event.key === 'ArrowLeft') { event.preventDefault(); openReference(referenceIndex - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); openReference(referenceIndex + 1); }
    return;
  }
  if (event.target.closest('select,input,textarea,button,.ll-prompt-scroll,[contenteditable]') || event.altKey || event.metaKey || event.ctrlKey) return;
  let next;
  if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(event.key)) next = index + (event.shiftKey ? -1 : 1);
  if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(event.key)) next = index - 1;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = total - 1;
  if (next !== undefined) { event.preventDefault(); chooseStory(next); }
});
let touchStart;
root.addEventListener('touchstart', event => {
  touchStart = !event.target.closest('button,a,select,.ll-prompt,dialog') && event.touches.length === 1
    ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
}, { passive: true });
root.addEventListener('touchend', event => {
  if (!touchStart || dialog.open) return;
  const dx = event.changedTouches[0].clientX - touchStart.x;
  const dy = event.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dy) > 38 && Math.abs(dy) > Math.abs(dx)) chooseStory(index - Math.sign(dy));
  touchStart = null;
}, { passive: true });
showStory(index, false);

function fallback() {
  root.classList.add('is-fallback');
  $('ll-fallback').hidden = false;
  fitPromptText();
  revealLibrary();
}

try { sceneController = createLibrary(); } catch (error) { console.warn('Reading room unavailable:', error); fallback(); }

function createLibrary() {
  const canvas = $('ll-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile.matches ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8d9bf');
  scene.fog = new THREE.Fog('#e6d5b8', 24, 57);
  const camera = new THREE.PerspectiveCamera(43, 1, .75, 75);
  const resources = new Set();
  const keep = resource => { resources.add(resource); return resource; };
  const geometry = {
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    sphere: keep(new THREE.SphereGeometry(1, 12, 10)),
    cylinder: keep(new THREE.CylinderGeometry(1, 1, 1, 20)),
  };
  const material = (color, roughness = .65, metalness = 0) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const gold = material('#bc9252', .3, .78);
  const inlayGold = material('#ffd700', .27, .78); inlayGold.envMapIntensity = .65;
  const bronze = material('#6b4b2e', .38, .68);
  const leaf = material('#506047', .85);
  const porcelain = material('#e7ddc7', .25);
  const glow = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd89a').multiplyScalar(2.5), toneMapped: false }));
  const threadMat = keep(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .9, toneMapped: false, fog: false }));

  // A softly lit studio environment gives the stone and brass real reflections.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color('#b7a68d');
  const envPanel = (color, strength, x, y, z, sx, sy, sz) => {
    const mesh = new THREE.Mesh(geometry.box, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) }));
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); envScene.add(mesh); return mesh;
  };
  envPanel('#fff4dc', 3, 0, 10, 0, 18, 1, 18);
  envPanel('#ffcb85', 4, -8, 3, -3, 1, 7, 10);
  envPanel('#ffe6bf', 3, 8, 3, 2, 1, 7, 10);
  envPanel('#fff5df', 2, 0, 4, 9, 12, 8, 1);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = keep(pmrem.fromScene(envScene, .05, .1, 40));
  scene.environment = environment.texture;
  envScene.children.forEach(mesh => mesh.material.dispose());
  pmrem.dispose();

  // Canvas marble uses continuous branching veins, not a tiled photograph.
  function marbleTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e9e0cf'; ctx.fillRect(0, 0, 1024, 1024);
    const mineral = ctx.createImageData(1024, 1024);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const u = x / 1024 * Math.PI * 2, v = y / 1024 * Math.PI * 2;
      const phase = u + v * 2 + Math.sin(u - v) * .9 + Math.sin(u * 2 + v) * 1.1 + Math.sin(u * 5 - v * 3) * .25;
      const ridge = 1 - Math.abs(Math.sin(phase));
      const vein = Math.pow(ridge, 22) * 63 + Math.pow(ridge, 5) * 10;
      const cloud = Math.sin(u) * Math.sin(v) * 4 + Math.sin(u * 2 - v) * 2;
      const noise = (random() - .5) * 3;
      const i = (y * 1024 + x) * 4;
      mineral.data[i] = 243 + cloud + noise - vein;
      mineral.data[i + 1] = 244 + cloud + noise - vein * .94;
      mineral.data[i + 2] = 240 + cloud + noise - vein * .86;
      mineral.data[i + 3] = 255;
    }
    ctx.putImageData(mineral, 0, 0);
    const cloud = ctx.createLinearGradient(0, 0, 1024, 720);
    cloud.addColorStop(0, '#ffffff12'); cloud.addColorStop(.4, '#6d7a7d0a'); cloud.addColorStop(.7, '#f3f7f412'); cloud.addColorStop(1, '#6d7a7d08');
    ctx.fillStyle = cloud; ctx.fillRect(0, 0, 1024, 1024);
    function vein(x, y, angle, length, width, alpha, depth) {
      const path = new Path2D(); path.moveTo(x, y);
      for (let i = 0; i < length; i += 12) {
        angle += (random() - .5) * .37;
        x += Math.cos(angle) * 12; y += Math.sin(angle) * 12;
        path.lineTo(x, y);
        if (depth > 0 && random() > .955) vein(x, y, angle + (random() - .5) * 1.7, length * .28, width * .42, alpha * .72, depth - 1);
      }
      ctx.strokeStyle = `rgba(89,103,108,${alpha * 1.7})`; ctx.lineWidth = width * 1.8;
      // Wrap the branching fractures so adjacent pieces have no texture seams.
      for (const dx of [-1024, 0, 1024]) for (const dy of [-1024, 0, 1024]) {
        ctx.save(); ctx.translate(dx, dy); ctx.stroke(path); ctx.restore();
      }
    }
    for (let i = 0; i < 24; i++) vein(random() * 1200 - 100, random() * 1200 - 100, -.75 + random() * .3, 500 + random() * 700, .5 + random() * 2.5, .08 + random() * .17, 2);
    // Very fine mineral grain keeps large surfaces from appearing perfectly flat.
    for (let i = 0; i < 26000; i++) {
      ctx.fillStyle = random() > .5 ? '#ffffff0d' : '#53666a08'; ctx.fillRect(random() * 1024, random() * 1024, 1, 1);
    }
    const texture = keep(new THREE.CanvasTexture(c));
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
    return texture;
  }
  const stoneTexture = marbleTexture();
  const stone = keep(new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: .018, roughness: .24, metalness: 0, envMapIntensity: .45 }));
  const paleStone = keep(stone.clone());
  const floorMap = keep(stoneTexture.clone());
  const floorMat = keep(new THREE.MeshStandardMaterial({ map: floorMap, bumpMap: floorMap, bumpScale: .012, roughness: .22, metalness: 0, envMapIntensity: .45 }));
  const room = new THREE.Group(); scene.add(room);
  function box(w, h, d, x, y, z, mat = stone, parent = room) {
    let shape = geometry.box;
    if (mat === stone || mat === paleStone || mat === floorMat) {
      shape = keep(geometry.box.clone());
      const positions = shape.getAttribute('position'), normals = shape.getAttribute('normal'), uv = shape.getAttribute('uv');
      // Physical-scale UVs keep tall marble piers from stretching the veins.
      // World positions align the pattern across adjoining slabs and trim.
      for (let i = 0; i < uv.count; i++) {
        const px = positions.getX(i) * w + x, py = positions.getY(i) * h + y, pz = positions.getZ(i) * d + z;
        if (Math.abs(normals.getX(i)) > .5) uv.setXY(i, pz / 4.2, py / 4.2);
        else if (Math.abs(normals.getY(i)) > .5) uv.setXY(i, px / 4.2, pz / 4.2);
        else uv.setXY(i, px / 4.2, py / 4.2);
      }
    }
    const mesh = new THREE.Mesh(shape, mat);
    mesh.scale.set(w, h, d); mesh.position.set(x, y, z); mesh.receiveShadow = mesh.castShadow = true; parent.add(mesh); return mesh;
  }
  function cylinder(radius, height, x, y, z, mat = gold, parent = room) {
    const mesh = new THREE.Mesh(geometry.cylinder, mat); mesh.scale.set(radius, height, radius); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function torus(radius, tube, x, y, z, mat = gold, parent = room, arc = Math.PI * 2) {
    const mesh = new THREE.Mesh(keep(new THREE.TorusGeometry(radius, tube, 8, 72, arc)), mat); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  const inlayParts = [], inlayDiamonds = [];
  function inlay(w, h, d, x, y, z) { inlayParts.push({ w, h, d, x, y, z }); }
  box(46, .2, 52, 0, -.12, -12, floorMat);
  box(24, 17, .65, 0, 8.5, -20, paleStone);
  box(.5, 17, 29, -10.9, 8.5, -7, paleStone);
  box(.5, 17, 29, 10.9, 8.5, -7, paleStone);
  for (const side of [-1, 1]) {
    inlay(.045, .008, 32, side * 6.7, -.015, -8);
    inlay(.018, .008, 32, side * 6.51, -.015, -8);
  }
  for (const z of [-16, -11, -6, -1, 4]) {
    inlay(21, .008, .035, 0, -.015, z);
    for (const side of [-1, 1]) inlayDiamonds.push({ x: side * 6.7, y: -.009, z, w: .4, h: .4, rx: -Math.PI / 2, ry: 0 });
  }

  const sun = new THREE.DirectionalLight('#fff0d3', 1.8); sun.position.set(-3, 13, 5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 14, bottom: -12, near: .5, far: 45 });
  sun.shadow.bias = -.0003; sun.shadow.normalBias = .035; sun.shadow.radius = 3;
  sun.target.position.set(0, 1, -5); scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight('#ffefd5', '#a48b68', .85));
  const backlight = new THREE.PointLight('#ffc572', 90, 26, 2); backlight.position.set(0, 6.4, -16.5); scene.add(backlight);
  for (const side of [-1, 1]) {
    const light = new THREE.PointLight('#ffd69a', 35, 18, 2); light.position.set(side * 7.5, 5, -3); scene.add(light);
  }

  // Deep shelf bays and marble piers establish the same symmetrical hall.
  const shelfBooks = [];
  const spineBands = [];
  const shelfGaps = [];
  // Filled from the cover atlas before revealing the room. Every version of
  // a story's book uses this same binding, including its original shelf slot.
  const bindingColors = stories.map(() => new THREE.Color('#514638'));
  const bookSize = .6;
  const bookDimensions = { width: .72 * bookSize, height: 1.27 * bookSize, depth: .208 * bookSize };
  function shelfBook(w, h, d, x, y, z, side = false) {
    const storyIndex = shelfBooks.length % total;
    shelfBooks.push({ w, h, d, x, y, z, storyIndex, color: `#${bindingColors[storyIndex].getHexString()}`, tilt: (random() - .5) * .035 });
    for (const fraction of [.12, .84]) spineBands.push(side
      ? { w: .012, h: .018, d: d * .85, x: x - Math.sign(x) * w * .51, y: y - h / 2 + h * fraction, z }
      : { w: w * .85, h: .018, d: .012, x, y: y - h / 2 + h * fraction, z: z + d * .51 });
  }
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < 6; bay++) {
      const z = 4.5 - bay * 4.5;
      box(.18, 13.3, 4.15, side * 10.55, 6.9, z, stone);
      for (let row = 0; row < 7; row++) {
        const y = .55 + row * 1.8;
        box(1.4, .15, 4.25, side * 10, y, z, stone);
        inlay(.018, .032, 4.06, side * 9.294, y + .012, z);
        const openStart = z - 1.6 + random() * 2.5;
        const openEnd = openStart + .45 + random() * .35;
        const leaveOpenSpace = (bay + row) % 3 !== 0;
        let cursor = z - 1.92;
        while (cursor < z + 1.75) {
          const width = bookDimensions.depth;
          const height = bookDimensions.height;
          const depth = bookDimensions.width;
          const inOpenSpace = leaveOpenSpace && cursor + width > openStart && cursor < openEnd;
          if (!inOpenSpace && random() > .03) shelfBook(depth, height, width, side * 10.02, y + .09 + height / 2, cursor + width / 2, true);
          else if (bay >= 1 && bay <= 4 && row >= 2 && row <= 4) shelfGaps.push({ x: side * 10.02, bottom: y + .09, z: cursor + width / 2, width });
          cursor += width + .027;
        }
      }
      const pierZ = z + 2.25;
      box(.76, 14.2, .6, side * 9.54, 7.1, pierZ, paleStone);
      box(1.08, .35, .85, side * 9.54, .2, pierZ, stone);
      box(1.05, .27, .9, side * 9.54, 13.55, pierZ, stone);
      for (const edge of [-.19, .19]) inlay(.014, 12.8, .018, side * 9.152, 6.85, pierZ + edge);
      for (const y of [.45, 13.25]) inlay(.014, .022, .4, side * 9.152, y, pierZ);
      for (const y of [2.2, 6.85, 11.5]) inlayDiamonds.push({ x: side * 9.142, y, z: pierZ, w: .23, h: .5, rx: 0, ry: -side * Math.PI / 2 });
    }
    for (let row = 0; row < 7; row++) {
      const y = .55 + row * 1.8;
      box(4.9, .15, 1.05, side * 7.75, y, -19.2, stone);
      inlay(4.75, .032, .018, side * 7.75, y + .012, -18.666);
      let cursor = side * 7.75 - 2.25;
      while (cursor < side * 7.75 + 2.1) {
        const width = bookDimensions.depth; const height = bookDimensions.height;
        shelfBook(width, height, bookDimensions.width, cursor + width / 2, y + .1 + height / 2, -19.02);
        cursor += width + .04;
      }
    }
  }
  function instances(items, mat) {
    const mesh = new THREE.InstancedMesh(geometry.box, mat, items.length);
    const dummy = new THREE.Object3D(); const color = new THREE.Color();
    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y, item.z); dummy.scale.set(item.w, item.h, item.d); dummy.rotation.z = item.tilt || 0;
      dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (item.color) mesh.setColorAt(i, color.set(item.color));
    });
    mesh.receiveShadow = mesh.castShadow = true; room.add(mesh); return mesh;
  }
  const inlayMesh = instances(inlayParts, inlayGold); inlayMesh.castShadow = false;
  const diamondShape = new THREE.Shape();
  diamondShape.moveTo(0, .5); diamondShape.lineTo(-.5, 0); diamondShape.lineTo(0, -.5); diamondShape.lineTo(.5, 0); diamondShape.closePath();
  const diamondHole = new THREE.Path();
  diamondHole.moveTo(0, .39); diamondHole.lineTo(.39, 0); diamondHole.lineTo(0, -.39); diamondHole.lineTo(-.39, 0); diamondHole.closePath();
  diamondShape.holes.push(diamondHole);
  const diamondMesh = new THREE.InstancedMesh(keep(new THREE.ShapeGeometry(diamondShape)), inlayGold, inlayDiamonds.length);
  const diamondDummy = new THREE.Object3D();
  inlayDiamonds.forEach((diamond, i) => {
    diamondDummy.position.set(diamond.x, diamond.y, diamond.z); diamondDummy.scale.set(diamond.w, diamond.h, 1); diamondDummy.rotation.set(diamond.rx, diamond.ry, 0);
    diamondDummy.updateMatrix(); diamondMesh.setMatrixAt(i, diamondDummy.matrix);
  });
  room.add(diamondMesh);
  const spineMaterial = material('#ffffff', .66, .03); spineMaterial.envMapIntensity = .28;
  const shelfMesh = instances(shelfBooks, spineMaterial);
  const shelfBandMesh = instances(spineBands, material('#d8ab59', .46, .4));
  const shelfDummy = new THREE.Object3D();
  const shelfTransfers = [];
  const vacatedShelfSlots = new Set();
  const maxShelfTransfers = 6;
  const shelfCoverFadeDuration = .75;
  let nextShelfTransfer = 1.5 + random();
  let lastShelfSide = 1;
  function updateShelfSlot(slot, hidden) {
    const book = shelfBooks[slot];
    shelfDummy.position.set(book.x, book.y, book.z); shelfDummy.rotation.set(0, 0, book.tilt);
    shelfDummy.scale.set(book.w, book.h, book.d).multiplyScalar(hidden ? 0 : 1); shelfDummy.updateMatrix(); shelfMesh.setMatrixAt(slot, shelfDummy.matrix);
    for (let band = 0; band < 2; band++) {
      const stripe = spineBands[slot * 2 + band];
      shelfDummy.position.set(book.x - Math.sign(book.x) * book.w * .51, book.y - book.h / 2 + book.h * (band ? .84 : .12), book.z);
      shelfDummy.rotation.set(0, 0, 0); shelfDummy.scale.set(stripe.w, stripe.h, stripe.d).multiplyScalar(hidden ? 0 : 1); shelfDummy.updateMatrix();
      shelfBandMesh.setMatrixAt(slot * 2 + band, shelfDummy.matrix);
    }
    shelfMesh.instanceMatrix.needsUpdate = shelfBandMesh.instanceMatrix.needsUpdate = true;
  }
  function startShelfTransfer() {
    const candidates = shelfBooks.flatMap((book, i) => book.z < 1 && book.z > -17 && book.y > 4 && book.y < 9
      && Math.abs(book.x) > 9 && Math.sign(book.x) !== lastShelfSide
      && !vacatedShelfSlots.has(i)
      && i !== hero?.shelfSlot && i !== outgoing?.shelfSlot
      && book.storyIndex !== hero?.storyIndex && book.storyIndex !== outgoing?.storyIndex
      && !shelfTransfers.some(transfer => transfer.storyIndex === book.storyIndex) ? [i] : []);
    for (let attempt = 0; attempt < 30; attempt++) {
      const slot = candidates[Math.floor(random() * candidates.length)]; const source = shelfBooks[slot];
      if (!source) break;
      const gaps = shelfGaps.flatMap((gap, i) => Math.sign(gap.x) !== Math.sign(source.x) && gap.width >= source.d
        && !shelfTransfers.some(transfer => transfer.gapIndex === i) ? [i] : []);
      if (!gaps.length) continue;
      const gapIndex = gaps[Math.floor(random() * gaps.length)]; const target = shelfGaps[gapIndex];
      const group = new THREE.Group(); const cloth = material(source.color, .7, .05);
      const coverGeo = keep(new THREE.BoxGeometry(source.w, source.h, source.d * .12));
      const pageGeo = keep(new THREE.BoxGeometry(source.w * .92, source.h * .94, source.d * .78));
      for (const z of [-source.d * .46, source.d * .46]) { const cover = new THREE.Mesh(coverGeo, cloth); cover.position.z = z; group.add(cover); }
      const pages = new THREE.Mesh(pageGeo, material('#d6c5a3', .9)); pages.position.x = source.w * .015; group.add(pages);
      // Every traveling book uses the same local orientation: spine on the
      // left of its front cover. Shelf-side rotation keeps that spine outward.
      const spine = new THREE.Mesh(geometry.box, cloth); spine.position.x = -source.w * .47; spine.scale.set(source.w * .06, source.h * .99, source.d * .99); group.add(spine);
      for (const fraction of [.12, .84]) {
        const band = new THREE.Mesh(geometry.box, gold); band.position.set(-source.w * .505, source.h * (fraction - .5), 0); band.scale.set(.012, .018, source.d * .9); group.add(band);
      }
      const storyIndex = source.storyIndex;
      group.userData.storyIndex = storyIndex;
      const faceGeo = keep(new THREE.PlaneGeometry(source.h * .98 * 9 / 16, source.h * .98));
      const faceUv = faceGeo.getAttribute('uv'), tile = uvSlots.subarray(storyIndex * 4, storyIndex * 4 + 4);
      for (let i = 0; i < faceUv.count; i++) faceUv.setXY(i, tile[0] + faceUv.getX(i) * tile[2], tile[1] + faceUv.getY(i) * tile[3]);
      const faceMat = keep(shelfCoverMaterial.clone());
      const front = new THREE.Mesh(faceGeo, faceMat); front.position.z = source.d * .52 + .014; front.userData.storyIndex = storyIndex; group.add(front);
      group.position.set(source.x, source.y, source.z);
      group.rotation.set(0, source.x < 0 ? Math.PI : 0, source.x < 0 ? -source.tilt : source.tilt);
      scene.add(group); updateShelfSlot(slot, true);
      const from = group.position.clone(), to = new THREE.Vector3(target.x, target.bottom + source.h / 2, target.z);
      const duration = 4 + random() * 1.5;
      const transfer = { slot, storyIndex, gapIndex, group, front, cloth, coverGeo, pageGeo, faceGeo, faceMat, pageMat: pages.material,
        state: 'leaving', kinematic: true, start: flockTime, duration, from, to,
        flockDuration: 8 + random() * 4, returnDuration: 5.5 + random() * 1.5,
        position: group.position, quaternion: group.quaternion, velocity: new THREE.Vector3(), target: new THREE.Vector3(),
        radius: Math.hypot(source.w, source.h, source.d) * .5 + .02,
        phase: Math.sign(source.x) * Math.PI / 2 - (flockTime + duration) * .115 + (random() - .5) * .5,
        band: Math.floor(random() * 5), tilt: random() * Math.PI * 2, rotation: new THREE.Euler(),
        fromQ: group.quaternion.clone(), toQ: new THREE.Quaternion(), entry: new THREE.Vector3(),
        controlA: new THREE.Vector3(source.x * .8, source.y + .15, source.z), controlB: new THREE.Vector3() };
      flockTarget(transfer, flockTime + duration, transfer.entry);
      orientInSchool(transfer, flockTime + duration, transfer.toQ);
      transfer.controlB.set(transfer.entry.x + Math.sign(source.x) * 1.2, transfer.entry.y + .6, transfer.entry.z - 1.5);
      shelfTransfers.push(transfer); lastShelfSide = Math.sign(source.x);
      nextShelfTransfer = flockTime + 2.2 + random() * 1.2;
      return;
    }
    nextShelfTransfer = flockTime + 2;
  }
  function removeShelfTransfer(transfer, restoreSlot = true) {
    if (restoreSlot) updateShelfSlot(transfer.slot, false);
    scene.remove(transfer.group);
    for (const resource of [transfer.cloth, transfer.coverGeo, transfer.pageGeo, transfer.faceGeo, transfer.faceMat, transfer.pageMat]) { resource.dispose(); resources.delete(resource); }
    shelfTransfers.splice(shelfTransfers.indexOf(transfer), 1);
  }
  function updateShelfTransfers() {
    if (shelfTransfers.length < maxShelfTransfers && flockTime >= nextShelfTransfer) startShelfTransfer();
    for (let i = shelfTransfers.length - 1; i >= 0; i--) {
      const transfer = shelfTransfers[i];
      if (transfer.state === 'flocking') {
        if (flockTime - transfer.start < transfer.flockDuration) continue;
        transfer.state = 'returning'; transfer.kinematic = true; transfer.start = flockTime; transfer.duration = transfer.returnDuration;
        transfer.from.copy(transfer.position); transfer.fromQ.copy(transfer.quaternion);
        const book = shelfBooks[transfer.slot];
        transfer.toQ.setFromEuler(new THREE.Euler(0, transfer.to.x < 0 ? Math.PI : 0, transfer.to.x < 0 ? -book.tilt : book.tilt));
        transfer.controlA.set(transfer.from.x + Math.sign(transfer.to.x) * 1.6, transfer.from.y + .8, transfer.from.z - 1.2);
        transfer.controlB.set(transfer.to.x * .8, transfer.to.y + .15, transfer.to.z);
      }
      const elapsed = flockTime - transfer.start;
      const progress = clamp(elapsed / transfer.duration, 0, 1), t = ease(progress);
      // Artwork emerges from the plain shelf binding and fades back into it.
      // Each book has its own material; flock time also freezes fades on pause.
      const coverTime = transfer.state === 'leaving' ? elapsed : transfer.duration - elapsed;
      transfer.faceMat.opacity = ease(clamp(coverTime / shelfCoverFadeDuration, 0, 1));
      bezier(transfer.position, transfer.from, transfer.controlA, transfer.controlB, transfer.state === 'leaving' ? transfer.entry : transfer.to, t);
      transfer.quaternion.slerpQuaternions(transfer.fromQ, transfer.toQ, t);
      if (progress < 1) continue;
      if (transfer.state === 'leaving') {
        transfer.state = 'flocking'; transfer.kinematic = false; transfer.start = flockTime;
        const phase = transfer.phase + flockTime * .115;
        transfer.velocity.set(Math.cos(phase) * .6, 0, -Math.sin(phase) * .22);
        continue;
      }
      const book = shelfBooks[transfer.slot];
      shelfGaps[transfer.gapIndex] = { x: book.x, bottom: book.y - book.h / 2, z: book.z, width: book.d };
      book.x = transfer.to.x; book.y = transfer.to.y; book.z = transfer.to.z;
      removeShelfTransfer(transfer);
    }
  }

  // A monumental arch frames a brass loom and its softly luminous threads.
  function archShape(outer, inner, spring) {
    const shape = new THREE.Shape();
    shape.moveTo(-outer, 0); shape.lineTo(-outer, spring);
    shape.absarc(0, spring, outer, Math.PI, 0, true); shape.lineTo(outer, 0); shape.lineTo(inner, 0); shape.lineTo(inner, spring);
    shape.absarc(0, spring, inner, 0, Math.PI, false); shape.lineTo(-inner, 0); shape.closePath();
    return shape;
  }
  const arch = new THREE.Mesh(keep(new THREE.ExtrudeGeometry(archShape(5.2, 4.35, 8.1), { depth: .65, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .07, bevelThickness: .07, curveSegments: 48 })), paleStone);
  arch.position.set(0, 0, -18.9); room.add(arch);
  for (const side of [-1, 1]) {
    box(1.15, .5, 1.3, side * 4.8, .28, -18.35, stone);
    box(.035, 7.9, .04, side * 4.37, 4.1, -18.12, glow);
    box(.9, .28, .95, side * 4.8, 7.8, -18.4, stone);
  }
  for (let step = 0; step < 3; step++) box(8.4 - step * .65, .22, 2.8 - step * .55, 0, .11 + step * .22, -16.8 - step * .2, stone);
  for (const side of [-1, 1]) {
    cylinder(.095, 9.5, side * 2.38, 6.4, -17.35, bronze);
    cylinder(.16, .18, side * 2.38, 2.1, -17.35);
    cylinder(.17, .18, side * 2.38, 10.5, -17.35);
    const finial = new THREE.Mesh(geometry.sphere, gold); finial.scale.setScalar(.2); finial.position.set(side * 2.38, 11.25, -17.35); room.add(finial);
    box(.2, .8, .8, side * 2.38, 3.2, -17.35, bronze);
  }
  for (const y of [2.6, 4.6, 9.4]) {
    const roller = cylinder(.21, 5.3, 0, y, -17.35, bronze); roller.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) { const cap = cylinder(.3, .17, side * 2.6, y, -17.35, gold); cap.rotation.z = Math.PI / 2; }
  }
  // Jewel-colored silk and gold run through the brass loom, as on the story's
  // cover. Bundles keep their colors readable from across the room.
  const silkPalette = ['#ddb45b', '#be3548', '#842c68', '#6643a0', '#264eaa', '#2583ac', '#2e8d81', '#e6bd65', '#b93952', '#714899', '#2f64a3', '#299baf', '#dfb34f'];
  const linePositions = [], lineColors = [];
  const threadCount = 172;
  for (let i = 0; i < threadCount; i++) {
    const x = -2.12 + i / (threadCount - 1) * 4.24;
    const bundle = Math.floor(i / threadCount * silkPalette.length);
    const color = new THREE.Color(i % 17 === 0 ? '#f7d583' : silkPalette[bundle]).multiplyScalar(.84 + (i % 5) * .04);
    linePositions.push(x, 2.7, -17.3, x, 12.5 - .25 * Math.cos(x), -17.3);
    lineColors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  const threadGeometry = keep(new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    .setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3)));
  room.add(new THREE.LineSegments(threadGeometry, threadMat));
  const windings = new THREE.InstancedMesh(geometry.cylinder, material('#ffffff', .55, .12), 39 * 3);
  const windingPose = new THREE.Object3D(); windingPose.rotation.z = Math.PI / 2; windingPose.scale.set(.225, 4.24 / 39 * .88, .225);
  [2.6, 4.6, 9.4].forEach((y, row) => {
    for (let i = 0; i < 39; i++) {
      windingPose.position.set(-2.12 + (i + .5) / 39 * 4.24, y, -17.35); windingPose.updateMatrix();
      windings.setMatrixAt(row * 39 + i, windingPose.matrix);
      windings.setColorAt(row * 39 + i, new THREE.Color(silkPalette[Math.floor(i / 3)]));
    }
  });
  room.add(windings);
  const weftPositions = [];
  for (let y = 2.76; y < 4.4; y += .075) weftPositions.push(-2.12, y, -17.28, 2.12, y, -17.28);
  room.add(new THREE.LineSegments(keep(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(weftPositions, 3))),
    keep(new THREE.LineBasicMaterial({ color: '#eac779', transparent: true, opacity: .35, toneMapped: false, fog: false }))));
  torus(2.35, .025, 0, 7.4, -18.3, glow);

  function plant(x, z, scale = 1) {
    const pot = new THREE.Mesh(keep(new THREE.CylinderGeometry(.4, .29, .65, 16)), porcelain);
    pot.position.set(x, .33, z); room.add(pot);
    for (let branch = 0; branch < 20; branch++) {
      const theta = random() * Math.PI * 2; const height = .65 + random() * 1.7;
      const radius = .15 + random() * .55;
      const stem = cylinder(.012, height, x + Math.cos(theta) * radius / 2, .7 + height / 2, z + Math.sin(theta) * radius / 2, leaf);
      stem.rotation.z = Math.cos(theta) * .3; stem.rotation.x = Math.sin(theta) * .3;
      const frond = new THREE.Mesh(geometry.sphere, leaf); frond.position.set(x + Math.cos(theta) * radius, .8 + height, z + Math.sin(theta) * radius);
      frond.scale.set(.13 * scale, .5 * scale, .06 * scale); frond.rotation.set(Math.sin(theta) * .7, theta, -Math.cos(theta) * .7); room.add(frond);
    }
  }
  plant(-5.3, -15.7); plant(5.3, -15.7);

  // The foreground desk is a beveled slab; book, studies, and card share its
  // world coordinates. HTML is projected onto the paper so text stays crisp.
  const deskTop = 1.93;
  const deskWidth = 15.7, deskDepth = 5.1, deskCenterZ = 3.8;
  const deskOffsetZ = 2.1;
  const deskSetup = new THREE.Group(); deskSetup.position.z = deskOffsetZ; room.add(deskSetup);
  function walnutTexture() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d'); const pixels = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const bend = Math.sin(x * .004) * 13 + Math.sin(x * .012 + y * .006) * 3;
      const grain = Math.sin((y + bend) * .17) * 5 + Math.sin((y + bend) * .047) * 10;
      const fine = Math.sin((y + bend) * 1.7 + Math.sin(x * .02)) * 2;
      const pore = random() > .96 ? -random() * 14 : 0;
      const tone = grain + fine + pore + (random() - .5) * 4;
      const i = (y * c.width + x) * 4;
      pixels.data[i] = 111 + tone; pixels.data[i + 1] = 68 + tone * .75; pixels.data[i + 2] = 40 + tone * .5; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    const texture = keep(new THREE.CanvasTexture(c)); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8); return texture;
  }
  const walnutMap = walnutTexture();
  const walnut = keep(new THREE.MeshStandardMaterial({ map: walnutMap, roughness: .43, metalness: .02, envMapIntensity: .3 }));
  const legMap = keep(walnutMap.clone()); legMap.center.set(.5, .5); legMap.rotation = Math.PI / 2;
  const walnutLegs = keep(walnut.clone()); walnutLegs.map = legMap;
  function roundedRectangle(width, height, radius) {
    const s = new THREE.Shape(); const x = -width / 2; const y = -height / 2;
    s.moveTo(x + radius, y); s.lineTo(x + width - radius, y); s.quadraticCurveTo(x + width, y, x + width, y + radius);
    s.lineTo(x + width, y + height - radius); s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    s.lineTo(x + radius, y + height); s.quadraticCurveTo(x, y + height, x, y + height - radius);
    s.lineTo(x, y + radius); s.quadraticCurveTo(x, y, x + radius, y); return s;
  }
  const deskGeometry = keep(new THREE.ExtrudeGeometry(roundedRectangle(deskWidth, deskDepth, .55), { depth: .36, bevelEnabled: true, bevelSegments: 4, bevelSize: .1, bevelThickness: .1, steps: 1, curveSegments: 18 }));
  deskGeometry.rotateX(-Math.PI / 2);
  const deskUv = deskGeometry.getAttribute('uv'), deskPositions = deskGeometry.getAttribute('position');
  for (let i = 0; i < deskUv.count; i++) deskUv.setXY(i, deskPositions.getX(i) / deskWidth + .5, deskPositions.getZ(i) / deskDepth + .5);
  const desk = new THREE.Mesh(deskGeometry, walnut); desk.position.set(0, 1.47, deskCenterZ); desk.receiveShadow = desk.castShadow = true; deskSetup.add(desk);
  // Bring the supports close to the desk's front edge so their feet continue
  // below the frame, while still meeting the room's floor.
  for (const x of [-5.8, 5.8]) { const leg = box(.95, 1.4, 3.6, x, .69, deskCenterZ + .65, walnutLegs, deskSetup); leg.castShadow = true; }
  box(12.3, .045, .03, 0, 1.37, deskCenterZ + deskDepth / 2 - .23, gold, deskSetup);
  box(9.9, .04, .03, 0, .19, deskCenterZ + 1.1, glow, deskSetup);

  function contactShadow(w, h, x, y, z, opacity) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
    const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 63);
    gradient.addColorStop(0, `rgba(52,36,19,${opacity})`); gradient.addColorStop(.6, `rgba(52,36,19,${opacity * .6})`); gradient.addColorStop(1, 'rgba(52,36,19,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), keep(new THREE.MeshBasicMaterial({ map: keep(new THREE.CanvasTexture(c)), transparent: true, depthWrite: false, toneMapped: false })));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, z); deskSetup.add(mesh); return mesh;
  }
  contactShadow(3.5, 4.4, .1, deskTop + .008, 3.95, .32);
  contactShadow(4.5, 3.9, -3.8, deskTop + .01, 4.1, .22);
  contactShadow(3.6, 2.1, 3.8, deskTop + .01, 3.4, .28);

  const cardPose = new THREE.Object3D(); cardPose.position.set(4.2, deskTop + 2.16, 4.2); cardPose.rotation.x = -.14;
  const paper = box(3.25, 4.45, .065, 0, 0, 0, porcelain, cardPose); paper.castShadow = true; deskSetup.add(cardPose);
  const cardBase = box(3.7, .19, 1.15, 4.2, deskTop + .1, 4.65, stone, deskSetup);
  const cardClip = box(1.95, .115, .13, 4.2, deskTop + .22, 4.78, gold, deskSetup);
  const promptLabelPose = new THREE.Object3D(); promptLabelPose.position.set(4.2, deskTop + .02, 5.85); promptLabelPose.rotation.x = -Math.PI / 2;
  const scrollHintPose = new THREE.Object3D(); scrollHintPose.position.set(0, deskTop + .02, 6); scrollHintPose.rotation.x = -Math.PI / 2;
  const referenceLabelPose = new THREE.Object3D(); referenceLabelPose.position.set(-4.2, deskTop + .02, 5.85); referenceLabelPose.rotation.x = -Math.PI / 2;
  deskSetup.add(promptLabelPose, scrollHintPose, referenceLabelPose);
  const photoLayouts = [
    { width: 2.5, height: 1.82, poses: [
      { x: -4.35, z: 2.55, angle: -.18 },
      { x: -3.12, z: 3.55, angle: .13 },
      { x: -4.9, z: 4.05, angle: -.1 },
    ] },
    { width: 2.2, height: 1.6, poses: [
      { x: -6.3, compactX: -5, z: 2.1, angle: -.08 },
      { x: -3.2, compactX: -2.8, z: 2.25, angle: .07 },
      { x: -6.2, compactX: -4.95, z: 3.35, angle: .05 },
      { x: -3.1, compactX: -2.75, z: 3.45, angle: -.05 },
      { x: -6.4, compactX: -5.05, z: 4.6, angle: -.07 },
      { x: -3.2, compactX: -2.8, z: 4.65, angle: .05 },
    ] },
  ].map(layout => ({ ...layout, poses: layout.poses.map((pose, i) => {
    const object = new THREE.Object3D();
    object.position.set(pose.x, deskTop + .025 + i * .024, pose.z);
    object.rotation.set(-Math.PI / 2, 0, pose.angle);
    object.userData.referenceX = pose.x; object.userData.compactX = pose.compactX ?? pose.x;
    deskSetup.add(object); return object;
  }) }));
  // Homography maps the four paper corners into screen space. This is genuine
  // perspective, without rendering readable prompts into low-resolution maps.
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function projectPaper(element, pose, worldW, worldH, pixelW, pixelH, localZ = .04) {
    const width = canvas.clientWidth; const height = canvas.clientHeight;
    pose.updateMatrixWorld();
    const points = [[-.5, .5], [.5, .5], [.5, -.5], [-.5, -.5]];
    points.forEach(([x, y], i) => corners[i].set(x * worldW, y * worldH, localZ).applyMatrix4(pose.matrixWorld).project(camera));
    const p = corners.map(v => ({ x: (v.x + 1) * width / 2, y: (1 - v.y) * height / 2 }));
    const dx1 = p[1].x - p[2].x, dx2 = p[3].x - p[2].x, dx3 = p[0].x - p[1].x + p[2].x - p[3].x;
    const dy1 = p[1].y - p[2].y, dy2 = p[3].y - p[2].y, dy3 = p[0].y - p[1].y + p[2].y - p[3].y;
    const determinant = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / determinant;
    const h = (dx1 * dy3 - dx3 * dy1) / determinant;
    const a = p[1].x - p[0].x + g * p[1].x, b = p[3].x - p[0].x + h * p[3].x;
    const d = p[1].y - p[0].y + g * p[1].y, e = p[3].y - p[0].y + h * p[3].y;
    element.style.transform = `matrix3d(${a / pixelW},${d / pixelW},0,${g / pixelW},${b / pixelH},${e / pixelH},0,${h / pixelH},0,0,1,0,${p[0].x},${p[0].y},0,1)`;
  }
  function positionDeskContent() {
    if (mobile.matches) return;
    deskSetup.updateMatrixWorld(true);
    projectPaper($('ll-prompt'), cardPose, 3.25, 4.45, 360, 500);
    projectPaper($('ll-prompt-heading'), promptLabelPose, 2.8, .62, 300, 70);
    projectPaper($('ll-scroll-hint'), scrollHintPose, 3.5, .48, 360, 60);
    projectPaper($('ll-art-link'), referenceLabelPose, 2.8, .48, 300, 60);
    const photos = [...$('ll-references').children];
    const layout = photoLayouts[photos.length > 3 ? 1 : 0];
    const spread = clamp((camera.aspect - 1.6) / .5, 0, 1);
    photos.forEach((element, i) => {
      const pose = layout.poses[i];
      pose.position.x = THREE.MathUtils.lerp(pose.userData.compactX, pose.userData.referenceX, spread);
      projectPaper(element, pose, layout.width, layout.height, 300, 218);
    });
  }

  const textureLoader = new THREE.TextureLoader();
  const coverCache = new Map();
  function coverTexture(storyIndex) {
    const key = stories[storyIndex].cover;
    if (coverCache.has(key)) return coverCache.get(key);
    const promise = textureLoader.loadAsync(key).then(texture => {
      if (destroyed) { texture.dispose(); return null; }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
      keep(texture); return texture;
    }).catch(() => null);
    coverCache.set(key, promise);
    // A long session shouldn't retain 230 large textures. Active books and
    // their immediate neighbors are protected while older covers are evicted.
    if (coverCache.size > 9) for (const [oldKey, old] of coverCache) {
      const protectedKeys = [index, wrap(index - 1), wrap(index + 1), hero?.storyIndex, outgoing?.storyIndex].filter(n => n !== undefined).map(n => stories[n].cover);
      if (!protectedKeys.includes(oldKey)) { coverCache.delete(oldKey); old.then(texture => { if (texture) { texture.dispose(); resources.delete(texture); } }); break; }
    }
    return promise;
  }
  let atlasReady;
  const atlasPromise = new Promise(resolve => { atlasReady = resolve; });
  const atlas = textureLoader.load(data.atlasSrc, () => atlasReady(), undefined, () => atlasReady());
  keep(atlas); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  function sampleBindingColors() {
    if (!atlas.image?.width) return;
    const tileW = atlas.image.width / data.atlas.cols, tileH = atlas.image.height / data.atlas.rows;
    const sample = document.createElement('canvas'); sample.width = atlas.image.width; sample.height = atlas.image.height;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(atlas.image, 0, 0, sample.width, sample.height);
    const pixels = ctx.getImageData(0, 0, sample.width, sample.height).data;
    const shadeColor = new THREE.Color();
    stories.forEach((story, storyIndex) => {
      const col = story.slot % data.atlas.cols, row = Math.floor(story.slot / data.atlas.cols);
      const buckets = new Map();
      // The background around the heading usually carries the cover's main
      // color. Keep the native pixels so fine color details aren't blurred
      // together; a small contribution from the rest of the art breaks ties.
      for (let y = 3; y < tileH - 3; y += 2) for (let x = 3; x < tileW - 3; x += 2) {
        const p = ((row * tileH + y) * sample.width + col * tileW + x) * 4;
        const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
        const high = Math.max(r, g, b) / 255, low = Math.min(r, g, b) / 255;
        const lightness = (high + low) / 2, saturation = high ? (high - low) / high : 0;
        const regionWeight = y < tileH * .17 ? 8 : y < tileH * .3 ? 1 : .08;
        const shadowWeight = Math.max(saturation * .75, clamp((lightness - .02) / .14, .03, 1));
        const weight = regionWeight * shadowWeight * (.7 + saturation * .3);
        const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
        let bucket = buckets.get(key);
        if (!bucket) { bucket = { r: 0, g: 0, b: 0, weight: 0 }; buckets.set(key, bucket); }
        bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight; bucket.weight += weight;
      }
      const shades = [...buckets.values()];
      shades.forEach(shade => {
        shade.r /= shade.weight; shade.g /= shade.weight; shade.b /= shade.weight;
        shadeColor.setRGB(shade.r / 255, shade.g / 255, shade.b / 255, THREE.SRGBColorSpace).getHSL(shade, THREE.SRGBColorSpace);
      });
      let best, bestScore = -1;
      for (const shade of shades) {
        let r = 0, g = 0, b = 0, mass = 0;
        for (const neighbor of shades) {
          // Dark navy and dark brown are close in RGB but need separate
          // groups, otherwise both become the same muddy neutral binding.
          const hueDistance = Math.abs(shade.h - neighbor.h);
          if (Math.min(hueDistance, 1 - hueDistance) > .1 && Math.min(shade.s, neighbor.s) > .2) continue;
          const distance = Math.hypot(shade.r - neighbor.r, shade.g - neighbor.g, shade.b - neighbor.b);
          const weight = neighbor.weight * Math.max(0, 1 - distance / 48);
          r += neighbor.r * weight; g += neighbor.g * weight; b += neighbor.b * weight; mass += weight;
        }
        if (mass > bestScore) { bestScore = mass; best = [r / mass / 255, g / mass / 255, b / mass / 255]; }
      }
      if (best) {
        const color = bindingColors[storyIndex].setRGB(...best, THREE.SRGBColorSpace);
        const shade = color.getHSL({}, THREE.SRGBColorSpace);
        if (shade.l < .18) color.setHSL(shade.h, shade.s, .18, THREE.SRGBColorSpace);
      }
    });
    shelfBooks.forEach((book, slot) => {
      const color = bindingColors[book.storyIndex]; book.color = `#${color.getHexString()}`;
      shelfMesh.setColorAt(slot, color);
    });
    stories.forEach((story, i) => schoolBindings.setColorAt(i, bindingColors[i]));
    shelfMesh.instanceColor.needsUpdate = schoolBindings.instanceColor.needsUpdate = true;
    for (const book of [hero, outgoing]) if (book) book.binding.color.copy(bindingColors[book.storyIndex]);
    for (const transfer of shelfTransfers) transfer.cloth.color.copy(bindingColors[transfer.storyIndex]);
  }
  const count = total;
  const frontGeometry = keep(new THREE.PlaneGeometry(1.245 * 9 / 16, 1.245)); frontGeometry.translate(0, 0, .117);
  const uvSlots = new Float32Array(count * 4);
  const coverReveals = new Float32Array(count);
  stories.forEach((story, i) => {
    const col = story.slot % data.atlas.cols, row = Math.floor(story.slot / data.atlas.cols);
    uvSlots.set([(col + .008) / data.atlas.cols, (data.atlas.rows - 1 - row + .005) / data.atlas.rows, .984 / data.atlas.cols, .99 / data.atlas.rows], i * 4);
  });
  frontGeometry.setAttribute('aCoverUv', new THREE.InstancedBufferAttribute(uvSlots, 4));
  frontGeometry.setAttribute('aCoverReveal', new THREE.InstancedBufferAttribute(coverReveals, 1).setUsage(THREE.DynamicDrawUsage));
  const frontMat = keep(new THREE.MeshStandardMaterial({ map: atlas, transparent: true, depthWrite: false, alphaTest: .01, roughness: .74, metalness: .03, envMapIntensity: .25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const shelfCoverMaterial = keep(new THREE.MeshStandardMaterial({ map: atlas, transparent: true, opacity: 0, depthWrite: false, roughness: .74, metalness: .03, envMapIntensity: .25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  frontMat.onBeforeCompile = shader => {
    shader.vertexShader = `attribute vec4 aCoverUv;\nattribute float aCoverReveal;\nvarying float vCoverReveal;\n${shader.vertexShader}`.replace('#include <uv_vertex>', '#include <uv_vertex>\nvCoverReveal = aCoverReveal;\n#ifdef USE_MAP\nvMapUv = aCoverUv.xy + uv * aCoverUv.zw;\n#endif');
    shader.fragmentShader = `varying float vCoverReveal;\n${shader.fragmentShader}`.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vCoverReveal;');
  };
  // Separate covers and spine leave the page block exposed. The cover image
  // has a real gap above the binding rather than almost sharing its depth.
  const bindingParts = [new THREE.BoxGeometry(.72, 1.27, .028).translate(0, 0, .09), new THREE.BoxGeometry(.72, 1.27, .028).translate(0, 0, -.09), new THREE.BoxGeometry(.045, 1.27, .18).translate(-.3375, 0, 0)];
  const bindingAttributes = { position: [], normal: [], uv: [] };
  for (const part of bindingParts) {
    const expanded = part.toNonIndexed();
    for (const name of Object.keys(bindingAttributes)) bindingAttributes[name].push(...expanded.getAttribute(name).array);
    expanded.dispose(); part.dispose();
  }
  const bindingsGeometry = keep(new THREE.BufferGeometry());
  for (const [name, values] of Object.entries(bindingAttributes)) bindingsGeometry.setAttribute(name, new THREE.Float32BufferAttribute(values, name === 'uv' ? 2 : 3));
  const pagesGeometry = keep(new THREE.BoxGeometry(.675, 1.20, .152)); pagesGeometry.translate(.016, 0, 0);
  const schoolBindings = new THREE.InstancedMesh(bindingsGeometry, material('#ffffff', .77), count);
  const schoolPages = new THREE.InstancedMesh(pagesGeometry, material('#dbc9a2', .9), count);
  const schoolFronts = new THREE.InstancedMesh(frontGeometry, frontMat, count);
  const school = new THREE.Group(); school.add(schoolBindings, schoolPages, schoolFronts); scene.add(school);
  [schoolBindings, schoolPages, schoolFronts].forEach(mesh => { mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; });
  const schoolShape = { centerZ: 3, width: 4.55, height: .55, rowHeight: .33, depth: 1.55, rowDepth: .55, rowWidth: .2, wobble: .2 };
  const mouseRay = new THREE.Ray();
  const mouseTargetRay = new THREE.Ray();
  const mouseOffset = new THREE.Vector3();
  const mouseField = { radius: 2.55, force: 2.8, response: 5, follow: 8 };
  let mouseActive = false;
  let mouseStrength = 0;
  // Give every opening book its own real shelf position. Alternating the
  // shuffled sides sends small, staggered streams into the room's center.
  const arrivalShelves = [-1, 1].map(side => {
    const slots = shelfBooks.flatMap((book, i) => Math.sign(book.x) === side && Math.abs(book.x) > 9
      && book.z < 1 && book.z > -17 && book.y > 3 && book.y < 11.4 ? [i] : []);
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    return slots;
  });
  const arrivalOrder = stories.map((story, i) => i);
  for (let i = arrivalOrder.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [arrivalOrder[i], arrivalOrder[j]] = [arrivalOrder[j], arrivalOrder[i]]; }
  const arrivalRanks = new Uint32Array(count);
  arrivalOrder.forEach((storyIndex, rank) => { arrivalRanks[storyIndex] = rank; });
  let arrivalsRemaining = 0;
  const boids = stories.map((story, i) => {
    const phase = i / count * Math.PI * 2;
    const band = Math.floor(random() * 5);
    const size = bookSize;
    const rank = arrivalRanks[i], slot = arrivalShelves[rank % 2].pop();
    const source = shelfBooks[slot];
    schoolBindings.setColorAt(i, bindingColors[i]);
    if (source) { source.storyIndex = i; source.color = `#${bindingColors[i].getHexString()}`; }
    const body = { position: new THREE.Vector3(), displayScale: new THREE.Vector3(size, size, size), coverReveal: 1,
      velocity: new THREE.Vector3(), target: new THREE.Vector3(), phase, band, size, radius: size * .75, tilt: random() * Math.PI * 2,
      quaternion: new THREE.Quaternion(), rotation: new THREE.Euler(), matrix: new THREE.Matrix4() };
    if (source) {
      const start = .55 + rank / count * .7, duration = 1.55 + random() * .25;
      const from = new THREE.Vector3(source.x, source.y, source.z);
      const fromQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, source.x < 0 ? Math.PI : 0, source.x < 0 ? -source.tilt : source.tilt));
      const entry = flockTarget(body, start + duration, new THREE.Vector3());
      const entryQ = orientInSchool(body, start + duration, new THREE.Quaternion());
      body.arrival = { slot, start, duration, departed: false, from, fromQ, entry, entryQ,
        controlA: new THREE.Vector3(source.x * .8, source.y + .15, source.z),
        controlB: new THREE.Vector3(entry.x + Math.sign(source.x) * 1.5, entry.y + .6, entry.z - 1.5) };
      body.position.copy(from); body.quaternion.copy(fromQ);
      body.coverReveal = 0; body.kinematic = true; arrivalsRemaining++;
    } else flockTarget(body, 0, body.position);
    return body;
  });
  const dummy = new THREE.Object3D();
  const schoolQuaternion = new THREE.Quaternion();
  const separation = new THREE.Vector3(), alignment = new THREE.Vector3(), difference = new THREE.Vector3();
  let flockTime = 0;
  let schoolInitialized = false;
  function flockTarget(body, time, target = body.target) {
    const phase = body.phase + time * .115, lane = body.band - 2;
    return target.set(Math.sin(phase) * (schoolShape.width + lane * schoolShape.rowWidth),
      6 + Math.cos(phase * 2 + .6) * schoolShape.height + lane * schoolShape.rowHeight + Math.sin(phase * 5 + body.tilt) * schoolShape.wobble,
      schoolShape.centerZ + Math.cos(phase) * schoolShape.depth + lane * schoolShape.rowDepth);
  }
  function flockVelocity(body, time, target = body.velocity) {
    const phase = body.phase + time * .115, lane = body.band - 2;
    return target.set(Math.cos(phase) * (schoolShape.width + lane * schoolShape.rowWidth) * .115,
      -Math.sin(phase * 2 + .6) * schoolShape.height * .23 + Math.cos(phase * 5 + body.tilt) * schoolShape.wobble * .575,
      -Math.sin(phase) * schoolShape.depth * .115);
  }
  function orientInSchool(body, time, quaternion = body.quaternion) {
    const phase = body.phase + time * .115;
    body.rotation.set(Math.sin(phase + body.tilt) * .46, Math.sin(phase) * .8, Math.sin(phase * 1.7 + body.tilt) * .55);
    body.rotation.y += clamp(body.velocity.x * .18, -.18, .18);
    body.rotation.z -= clamp(body.velocity.x * .12, -.14, .14);
    quaternion.setFromEuler(body.rotation);
    return quaternion;
  }
  function vacateArrivalShelf(arrival) {
    if (arrival.departed) return;
    arrival.departed = true;
    const book = shelfBooks[arrival.slot];
    vacatedShelfSlots.add(arrival.slot); updateShelfSlot(arrival.slot, true);
    shelfGaps.push({ x: book.x, bottom: book.y - book.h / 2, z: book.z, width: book.d });
  }
  function finishBookArrival(body, snapToSchool = false) {
    if (!body.arrival) return;
    vacateArrivalShelf(body.arrival);
    if (snapToSchool) { body.position.copy(body.arrival.entry); body.quaternion.copy(body.arrival.entryQ); }
    body.arrival = null; body.kinematic = false; body.radius = body.size * .75;
    body.displayScale.setScalar(body.size); body.coverReveal = 1;
    if (--arrivalsRemaining === 0) nextShelfTransfer = flockTime + 2;
  }
  function updateBookArrivals() {
    if (reducedMotion.matches && arrivalsRemaining) {
      boids.forEach(body => finishBookArrival(body, true)); schoolInitialized = false;
      return;
    }
    for (const body of boids) {
      const arrival = body.arrival;
      if (!arrival || flockTime < arrival.start) continue;
      vacateArrivalShelf(arrival);
      const elapsed = flockTime - arrival.start, progress = clamp(elapsed / arrival.duration, 0, 1);
      // Ease out of the shelf, then meet the school's moving tangent without
      // easing to a standstill at the end of the route.
      const t = progress * progress * (2 - progress);
      bezier(body.position, arrival.from, arrival.controlA, arrival.controlB, arrival.entry, t);
      body.quaternion.slerpQuaternions(arrival.fromQ, arrival.entryQ, t);
      body.coverReveal = ease(clamp(elapsed / shelfCoverFadeDuration, 0, 1));
      if (progress >= 1) {
        finishBookArrival(body);
        body.velocity.copy(arrival.velocity);
      }
    }
  }
  function separateBooks(members, iterations) {
    for (let pass = 0; pass < iterations; pass++) for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      difference.subVectors(a.position, b.position);
      const distanceSquared = difference.lengthSq();
      // Conservative enclosing spheres cover each tilted book's full diagonal.
      const minimum = a.radius + b.radius + .035;
      if (distanceSquared >= minimum * minimum) continue;
      const distance = Math.sqrt(distanceSquared);
      if (distance < .00001) difference.set(1, 0, 0); else difference.multiplyScalar(1 / distance);
      // Shelf travelers yield slightly. Desk flights keep their smooth route
      // while the school makes room around their actual changing size.
      const aWeight = a.fixed ? 0 : a.kinematic ? .2 : 1, bWeight = b.fixed ? 0 : b.kinematic ? .2 : 1, weight = aWeight + bWeight;
      if (!weight) continue;
      const correction = minimum - distance;
      a.position.addScaledVector(difference, correction * aWeight / weight); b.position.addScaledVector(difference, -correction * bWeight / weight);
      const closing = (a.velocity.x - b.velocity.x) * difference.x + (a.velocity.y - b.velocity.y) * difference.y + (a.velocity.z - b.velocity.z) * difference.z;
      if (closing < 0) { a.velocity.addScaledVector(difference, -closing * aWeight / weight); b.velocity.addScaledVector(difference, closing * bWeight / weight); }
    }
  }
  function updateSchool(dt, elapsed = dt) {
    // Opening flights use elapsed time even on slower frames. Steering keeps
    // a bounded timestep, so the short entrance cannot stretch into a minute.
    flockTime += elapsed;
    mouseStrength += ((mouseActive ? 1 : 0) - mouseStrength) * (1 - Math.exp(-dt * mouseField.response));
    const mouseFollow = 1 - Math.exp(-dt * mouseField.follow);
    mouseRay.origin.lerp(mouseTargetRay.origin, mouseFollow);
    mouseRay.direction.lerp(mouseTargetRay.direction, mouseFollow).normalize();
    updateBookArrivals();
    if (dt > 0 && !arrivalsRemaining) updateShelfTransfers();
    // A traveler owns its story until it lands or is selected. Its ordinary
    // school instance stays hidden and out of the collision simulation.
    const travelingStories = new Set(shelfTransfers.map(transfer => transfer.storyIndex));
    const deskStories = new Set([hero?.storyIndex, outgoing?.storyIndex]);
    for (const storyIndex of deskStories) if (storyIndex !== undefined) {
      // Keep a moving destination for the return flight, without an invisible
      // duplicate taking up space in the school.
      flockTarget(boids[storyIndex], flockTime, boids[storyIndex].position);
      flockVelocity(boids[storyIndex], flockTime);
    }
    const deskFlights = flight && !reducedMotion.matches ? [hero.flightBody, outgoing.flightBody] : [];
    for (const book of [hero, outgoing]) if (book) book.flightBody.radius = Math.max(boids[book.storyIndex].radius, Math.hypot(1.79, 3.18, .36) * .5 * book.group.scale.x);
    const members = [...boids.filter((body, i) => !deskStories.has(i) && !travelingStories.has(i) && (!body.arrival || body.arrival.departed)), ...shelfTransfers, ...deskFlights];
    for (let i = 0; i < members.length; i++) {
      const b = members[i];
      if (b.kinematic) continue;
      if (arrivalsRemaining) {
        flockTarget(b, flockTime, b.position).add(b.formationOffset);
        flockVelocity(b, flockTime);
        continue;
      }
      flockTarget(b, flockTime);
      if (dt > 0) {
        separation.set(0, 0, 0); alignment.set(0, 0, 0); let neighbors = 0;
        for (let j = 0; j < members.length; j++) {
          if (i === j) continue;
          difference.subVectors(b.position, members[j].position); const dist = difference.lengthSq();
          if (dist > .00001 && dist < 1.6) { separation.addScaledVector(difference, 1 / dist); alignment.add(members[j].velocity); neighbors++; }
        }
        b.velocity.addScaledVector(difference.subVectors(b.target, b.position), dt * .75);
        if (neighbors) { b.velocity.addScaledVector(separation, dt * .13); alignment.multiplyScalar(1 / neighbors); b.velocity.lerp(alignment, dt * .13); }
        for (const traveler of deskFlights) {
          difference.subVectors(b.position, traveler.position);
          const distance = difference.length(), radius = b.radius + traveler.radius + .65;
          if (distance > .001 && distance < radius) {
            // Begin yielding before contact so the fast desk exchange opens
            // a small passage, then ordinary cohesion closes it naturally.
            const falloff = 1 - distance / radius;
            b.velocity.addScaledVector(difference, dt * 5 * falloff * falloff / distance);
          }
        }
        if (mouseStrength > .001) {
          // A soft field around the mouse ray works through the school's full
          // depth. Nearby books part gently, then cohesion brings them back.
          mouseOffset.subVectors(b.position, mouseRay.origin);
          mouseOffset.addScaledVector(mouseRay.direction, -mouseOffset.dot(mouseRay.direction));
          const distance = mouseOffset.length(), radius = mouseField.radius;
          if (distance < radius) {
            if (distance < .001) mouseOffset.set(Math.cos(b.phase), Math.sin(b.phase), 0);
            const falloff = 1 - distance / radius;
            b.velocity.addScaledVector(mouseOffset, dt * mouseField.force * mouseStrength * falloff * falloff / Math.max(distance, .1));
          }
        }
        b.velocity.multiplyScalar(Math.exp(-dt * 1.5)); b.velocity.clampLength(0, 1.55);
        b.position.addScaledVector(b.velocity, dt);
      }
    }
    // Entry poses are already spaced apart. Keep the scripted flights smooth;
    // flock forces and collision corrections take over after they all arrive.
    if (!arrivalsRemaining) {
      if (dt > 0 || !schoolInitialized) separateBooks(members, schoolInitialized ? (shelfTransfers.length || deskFlights.length || mouseStrength > .01 ? 6 : 3) : 60);
      schoolInitialized = true;
    }
    for (let i = 0; i < count; i++) {
      const b = boids[i];
      if (!b.arrival) {
        orientInSchool(b, flockTime, schoolQuaternion);
        b.quaternion.slerp(schoolQuaternion, reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 6));
        b.displayScale.setScalar(b.size);
      }
      const hidden = i === hero?.storyIndex || i === outgoing?.storyIndex || travelingStories.has(i) || (b.arrival && !b.arrival.departed);
      dummy.position.copy(b.position); dummy.quaternion.copy(b.quaternion); dummy.scale.copy(b.displayScale).multiplyScalar(hidden ? 0 : 1);
      coverReveals[i] = hidden ? 0 : b.coverReveal;
      dummy.updateMatrix(); b.matrix.copy(dummy.matrix);
      schoolBindings.setMatrixAt(i, dummy.matrix); schoolPages.setMatrixAt(i, dummy.matrix); schoolFronts.setMatrixAt(i, dummy.matrix);
    }
    shelfTransfers.forEach(transfer => { if (transfer.state === 'flocking') orientInSchool(transfer, flockTime); });
    [schoolBindings, schoolPages, schoolFronts].forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
    frontGeometry.getAttribute('aCoverReveal').needsUpdate = true;
  }

  // Spread the final poses once, before the room opens, instead of pushing
  // arriving books into place on every frame.
  const arrivalTargets = boids.map(body => ({ position: flockTarget(body, 3.2, new THREE.Vector3()),
    velocity: new THREE.Vector3(), radius: body.radius + .025, kinematic: false }));
  separateBooks(arrivalTargets, 60);
  boids.forEach((body, i) => {
    body.formationOffset = arrivalTargets[i].position.clone().sub(flockTarget(body, 3.2, new THREE.Vector3()));
    if (!body.arrival) return;
    const arrival = body.arrival;
    const end = arrival.start + arrival.duration;
    flockTarget(body, end, arrival.entry).add(body.formationOffset);
    arrival.velocity = flockVelocity(body, end, new THREE.Vector3());
    body.velocity.copy(arrival.velocity); orientInSchool(body, end, arrival.entryQ); body.velocity.set(0, 0, 0);
    arrival.controlB.copy(arrival.entry).addScaledVector(arrival.velocity, -arrival.duration / 3);
  });

  const pageCanvas = document.createElement('canvas'); pageCanvas.width = 128; pageCanvas.height = 512;
  const pageCtx = pageCanvas.getContext('2d'); pageCtx.fillStyle = '#e3d3b2'; pageCtx.fillRect(0, 0, 128, 512);
  for (let line = 0; line < 160; line++) { pageCtx.fillStyle = line % 3 ? '#c8b48c' : '#f5e9d2'; pageCtx.fillRect(0, line * 3.2, 128, .6); }
  const pagesMap = keep(new THREE.CanvasTexture(pageCanvas)); pagesMap.colorSpace = THREE.SRGBColorSpace;
  const heroPages = keep(new THREE.MeshStandardMaterial({ map: pagesMap, roughness: .9, color: '#fff7e3' }));
  const heroCoverGeometry = keep(new THREE.BoxGeometry(1.79, 3.18, .055));
  const heroPageGeometry = keep(new THREE.BoxGeometry(1.72, 3.10, .235));
  const heroFrontGeometry = keep(new THREE.PlaneGeometry(1.77, 3.146)); heroFrontGeometry.translate(0, 0, .176);
  const heroSpineGeometry = keep(new THREE.CylinderGeometry(.155, .155, 3.18, 14, 1, false, Math.PI, Math.PI)); heroSpineGeometry.translate(-.87, 0, 0);
  const deskScale = 1.18;
  const deskPosition = new THREE.Vector3(0, deskTop + .18 * deskScale, 3.85 + deskOffsetZ);
  const deskQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, -.045));
  let hero = null;
  let outgoing = null;
  let flight = null;
  function makeBook(storyIndex) {
    const group = new THREE.Group(); const binding = material(bindingColors[storyIndex], .53, .13);
    group.userData.storyIndex = storyIndex;
    const faceMat = keep(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .68, metalness: .02, envMapIntensity: .15 }));
    for (const z of [-.145, .145]) {
      const cover = new THREE.Mesh(heroCoverGeometry, binding); cover.position.z = z; cover.castShadow = cover.receiveShadow = true; group.add(cover);
    }
    const pages = new THREE.Mesh(heroPageGeometry, heroPages); pages.position.x = .02; pages.castShadow = true; group.add(pages);
    const spine = new THREE.Mesh(heroSpineGeometry, binding); group.add(spine);
    const face = new THREE.Mesh(heroFrontGeometry, faceMat); group.add(face);
    // Fine gold corner protectors read as binding, without obscuring the art.
    for (const x of [-.83, .83]) for (const y of [-1.52, 1.52]) {
      box(.12, .024, .009, x, y, .181, gold, group); box(.024, .12, .009, x, y - Math.sign(y) * .045, .181, gold, group);
    }
    scene.add(group);
    const flightBody = { position: group.position, velocity: new THREE.Vector3(), radius: 0, kinematic: true, fixed: true };
    const book = { group, storyIndex, binding, faceMat, flightBody, disposed: false };
    coverTexture(storyIndex).then(texture => { if (!book.disposed && texture) { faceMat.map = texture; faceMat.needsUpdate = true; wake(); } });
    return book;
  }
  function disposeBook(book) {
    if (!book || book.disposed) return;
    if (book.shelfSlot !== undefined) updateShelfSlot(book.shelfSlot, false);
    book.disposed = true; scene.remove(book.group); book.binding.dispose(); book.faceMat.dispose(); resources.delete(book.binding); resources.delete(book.faceMat);
  }
  hero = makeBook(index); hero.group.position.copy(deskPosition); hero.group.quaternion.copy(deskQuaternion); hero.group.scale.setScalar(deskScale);
  finishBookArrival(boids[index], true);
  function select(storyIndex) {
    const boid = boids[storyIndex];
    const transfer = shelfTransfers.find(book => book.storyIndex === storyIndex);
    const returning = outgoing?.storyIndex === storyIndex ? outgoing : null;
    const from = (transfer?.position || returning?.group.position || boid.position).clone();
    const fromQ = (transfer?.quaternion || returning?.group.quaternion || boid.quaternion).clone();
    const fromScale = transfer ? shelfBooks[transfer.slot].w / 1.79 : returning ? returning.group.scale.x : boid.displayScale.x * .7 / 1.79;
    const shelfSlot = transfer?.slot ?? returning?.shelfSlot;
    // Preserve a borrowed shelf slot when a returning book is selected again.
    if (returning) returning.shelfSlot = undefined;
    finishBookArrival(boid, true);
    root.classList.add('is-book-flying');
    disposeBook(outgoing);
    outgoing = hero;
    hero = makeBook(storyIndex);
    hero.shelfSlot = shelfSlot;
    hero.group.position.copy(from); hero.group.quaternion.copy(fromQ); hero.group.scale.setScalar(fromScale);
    if (transfer) removeShelfTransfer(transfer, false);
    // Settle the book before the next 525 ms wheel step is accepted.
    flight = { start: performance.now(), duration: reducedMotion.matches ? 90 : 500,
      from: hero.group.position.clone(), fromQ: hero.group.quaternion.clone(), fromScale: hero.group.scale.x,
      oldFrom: outgoing.group.position.clone(), oldQ: outgoing.group.quaternion.clone(), oldScale: outgoing.group.scale.x };
    preloadNeighbors(storyIndex); wake();
  }
  function preloadNeighbors(storyIndex) {
    [wrap(storyIndex - 1), wrap(storyIndex + 1)].forEach(n => {
      coverTexture(n);
      const img = new Image(); img.src = stories[n].references[0].src;
    });
  }
  preloadNeighbors(index);
  const controlA = new THREE.Vector3(), controlB = new THREE.Vector3();
  function bezier(target, p0, p1, p2, p3, t) {
    const u = 1 - t;
    target.copy(p0).multiplyScalar(u * u * u).addScaledVector(p1, 3 * u * u * t).addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t);
  }
  function updateFlight(now) {
    if (!flight) return;
    if (flight.complete) {
      // Let the school clear the final flight pose for one frame before its
      // ordinary instance returns, so the handoff keeps the same opening.
      const returned = boids[outgoing.storyIndex];
      if (!reducedMotion.matches) { returned.position.copy(outgoing.group.position); returned.quaternion.copy(outgoing.group.quaternion); }
      flockVelocity(returned, flockTime);
      disposeBook(outgoing); outgoing = null; flight = null; root.classList.remove('is-book-flying');
      return;
    }
    const progress = clamp((now - flight.start) / flight.duration, 0, 1); const t = ease(progress);
    if (reducedMotion.matches) {
      hero.group.position.copy(deskPosition); hero.group.quaternion.copy(deskQuaternion); hero.group.scale.setScalar(t * deskScale);
      outgoing.group.scale.setScalar(1 - t);
    } else {
      controlA.set(flight.from.x * .5, Math.max(flight.from.y, 7.4), THREE.MathUtils.lerp(flight.from.z, deskPosition.z, .3)); controlB.set(.65, 4.3, deskPosition.z + .25);
      bezier(hero.group.position, flight.from, controlA, controlB, deskPosition, t);
      hero.group.quaternion.slerpQuaternions(flight.fromQ, deskQuaternion, ease(clamp(t * 1.15, 0, 1)));
      hero.group.scale.setScalar(THREE.MathUtils.lerp(flight.fromScale, deskScale, t));
      const oldBoid = boids[outgoing.storyIndex];
      controlA.set(-1.6, 5.5, flight.oldFrom.z - .65); controlB.set(oldBoid.position.x * .6 - 1, oldBoid.position.y + .7, oldBoid.position.z + .8);
      bezier(outgoing.group.position, flight.oldFrom, controlA, controlB, oldBoid.position, t);
      outgoing.group.quaternion.slerpQuaternions(flight.oldQ, oldBoid.quaternion, t);
      outgoing.group.scale.setScalar(THREE.MathUtils.lerp(flight.oldScale, oldBoid.size * .7 / 1.79, t));
    }
    if (progress >= 1) flight.complete = true;
  }

  // Sparse dust catches the warm light. Its movement stops with the school.
  const dustPositions = new Float32Array(180 * 3);
  for (let i = 0; i < 180; i++) dustPositions.set([(random() - .5) * 18, 2 + random() * 11, -14 + random() * 18], i * 3);
  const dust = new THREE.Points(keep(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dustPositions, 3))), keep(new THREE.PointsMaterial({ color: '#fff4d9', size: .026, transparent: true, opacity: .6, depthWrite: false })));
  scene.add(dust);

  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  function hit(event) {
    const bounds = canvas.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // Pick the nearest complete book, so backs, page edges, and bindings do
    // not let a click pass through to an unrelated cover behind them.
    const books = [schoolBindings, schoolPages, schoolFronts, ...shelfTransfers.map(transfer => transfer.group), hero.group];
    if (outgoing) books.push(outgoing.group);
    const found = raycaster.intersectObjects(books, true)[0];
    if (found) found.storyIndex = found.instanceId ?? found.object.parent.userData.storyIndex;
    return found;
  }
  canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || dialog.open) return;
    canvas.style.cursor = hit(event) ? 'pointer' : 'default';
    if (!mouseActive && mouseStrength < .001) mouseRay.copy(raycaster.ray);
    mouseTargetRay.copy(raycaster.ray); mouseActive = true;
  });
  canvas.addEventListener('pointerleave', () => { mouseActive = false; canvas.style.cursor = 'default'; });
  canvas.addEventListener('click', event => {
    const found = hit(event);
    if (!flight && found?.object.parent === hero.group) location.assign(stories[hero.storyIndex].url);
    else if (found?.storyIndex !== undefined) chooseStory(found.storyIndex);
  });

  let frame = null;
  let startupReady = false;
  let revealFrame = null;
  let previousTime = performance.now();
  let lastDraw = 0;
  let lost = false;
  function resize() {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.fov = mobile.matches ? 49 : 43;
    if (mobile.matches) { camera.position.set(0, 9, 16.7); camera.lookAt(0, 2.9, -4.2); }
    else { camera.position.set(0, 9, 16.7); camera.lookAt(0, 1.9, -4.2); }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    // Keep the nearer desk wide enough to cover the bottom corners.
    const bottomRay = new THREE.Vector3(1, -1, .5).unproject(camera).sub(camera.position);
    const halfWidthAtDesk = Math.abs(camera.position.x + bottomRay.x * (deskTop - camera.position.y) / bottomRay.y);
    desk.scale.x = Math.max(1, (halfWidthAtDesk + .65) / (deskWidth / 2));
    cardPose.visible = cardBase.visible = cardClip.visible = !mobile.matches; positionDeskContent(); fitPromptText(); wake();
  }
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  function render(now) {
    frame = null;
    if (destroyed || lost || document.hidden) return;
    // 30 fps is sufficient for the slow school and halves battery/GPU use.
    if (now - lastDraw < 30 && !flight) { frame = requestAnimationFrame(render); return; }
    const elapsed = Math.max((now - previousTime) / 1000, 0), dt = Math.min(elapsed, .055); previousTime = now; lastDraw = now;
    const animate = ready && !paused && !dialog.open;
    updateFlight(now); updateSchool(animate ? dt : 0, animate ? elapsed : 0);
    if (animate) { dust.rotation.y += dt * .006; threadMat.opacity = .86 + Math.sin(flockTime * .7) * .04; }
    hero.group.updateMatrixWorld();
    projectPaper($('ll-read'), hero.group, 1.77, 3.146, 360, 640, .18);
    renderer.render(scene, camera);
    // Let the browser paint this fully textured frame before exposing the
    // projected HTML. This also works when reduced motion stops the loop.
    if (startupReady && !ready && revealFrame === null) revealFrame = requestAnimationFrame(() => {
      revealFrame = null;
      if (!lost && !document.hidden) revealLibrary();
    });
    if (animate || flight) frame = requestAnimationFrame(render);
  }
  function wake() { if (!frame && !destroyed && !lost) { previousTime = performance.now(); frame = requestAnimationFrame(render); } }
  function visibility() { if (document.hidden) { if (frame) cancelAnimationFrame(frame); frame = null; } else wake(); }
  document.addEventListener('visibilitychange', visibility);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; if (frame) cancelAnimationFrame(frame); frame = null; fallback(); });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; root.classList.remove('is-fallback'); $('ll-fallback').hidden = true; wake(); });
  resize();
  updateSchool(0);
  const initialStudy = $('ll-references').querySelector('img');
  $('ll-loading-detail').textContent = 'Gathering the books and preparing your desk.';
  Promise.allSettled([coverTexture(index), atlasPromise, document.fonts.ready, initialStudy?.decode()]).then(() => {
    if (destroyed || ready) return;
    sampleBindingColors();
    positionDeskContent(); fitPromptText();
    startupReady = true; wake();
  });
  return { select, wake, positionDeskContent,
    dispose() {
      if (frame) cancelAnimationFrame(frame); if (revealFrame) cancelAnimationFrame(revealFrame); resizeObserver.disconnect(); document.removeEventListener('visibilitychange', visibility);
      disposeBook(hero); disposeBook(outgoing); resources.forEach(resource => resource.dispose()); renderer.dispose();
    },
  };
}

// BFCache retains the room on reader back-navigation. A real unload releases
// the renderer and GPU textures instead of accumulating abandoned contexts.
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  destroyed = true; clearTimeout(swapTimer); clearTimeout(dissolveTimer); sceneController?.dispose();
});
window.addEventListener('pageshow', () => sceneController?.wake());
