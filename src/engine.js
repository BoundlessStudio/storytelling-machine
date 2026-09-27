import * as THREE from 'three';

const STEP = Math.PI / 6;
const RISE = 0.42;
const RADIUS = 1.79;

export function createEngine({ element, stories, onSelect, onFailure, initialIndex = 0, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: !matchMedia('(pointer: coarse)').matches, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.setAttribute('tabindex', '-1');
  element.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x111820, 11, 23);
  const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 80);
  camera.position.set(0, 0.35, 8.6);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xf7e9ce, 1.8));
  const key = new THREE.DirectionalLight(0xffd69b, 2.1);
  key.position.set(-3, 5, 7);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9bb6c7, 1.1);
  fill.position.set(4, -2, -3);
  scene.add(fill);

  const drum = new THREE.Group();
  scene.add(drum);
  const height = (stories.length - 1) * RISE + 7;
  const coreGeometry = new THREE.CylinderGeometry(1.48, 1.48, height, 32, 1, true);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0x1b242c, roughness: 0.77, metalness: 0.28, side: THREE.DoubleSide });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.position.y = -(stories.length - 1) * RISE / 2;
  drum.add(core);

  const linePoints = [];
  const addRing = y => {
    for (let segment = 0; segment < 48; segment++) {
      const a = segment / 48 * Math.PI * 2;
      const b = (segment + 1) / 48 * Math.PI * 2;
      linePoints.push(Math.sin(a) * 1.51, y, Math.cos(a) * 1.51);
      linePoints.push(Math.sin(b) * 1.51, y, Math.cos(b) * 1.51);
    }
  };
  let month = '';
  stories.forEach((story, index) => {
    const nextMonth = story.created.slice(0, 7);
    if (nextMonth !== month) {
      month = nextMonth;
      addRing(-index * RISE + RISE * 0.55);
    }
  });
  const ringGeometry = new THREE.BufferGeometry();
  ringGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
  const rings = new THREE.LineSegments(ringGeometry, new THREE.LineBasicMaterial({ color: 0x9a7544, transparent: true, opacity: 0.45 }));
  drum.add(rings);

  const cardGeometry = new THREE.BoxGeometry(1.42, 0.34, 0.028);
  const cardMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const cards = new THREE.InstancedMesh(cardGeometry, cardMaterial, stories.length);
  cards.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  cards.frustumCulled = false;
  const dummy = new THREE.Object3D();
  stories.forEach((_, index) => {
    const angle = index * STEP;
    dummy.position.set(Math.sin(angle) * RADIUS, -index * RISE, Math.cos(angle) * RADIUS);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    cards.setMatrixAt(index, dummy.matrix);
  });
  cards.instanceMatrix.needsUpdate = true;
  drum.add(cards);

  const pinGeometry = new THREE.SphereGeometry(0.025, 5, 4);
  const pinMaterial = new THREE.MeshBasicMaterial({ color: 0xd4aa69 });
  const pins = new THREE.InstancedMesh(pinGeometry, pinMaterial, stories.length);
  stories.forEach((_, index) => {
    const angle = index * STEP;
    dummy.position.set(Math.sin(angle) * (RADIUS + 0.025) - Math.cos(angle) * 0.56, -index * RISE, Math.cos(angle) * (RADIUS + 0.025) + Math.sin(angle) * 0.56);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    pins.setMatrixAt(index, dummy.matrix);
  });
  pins.instanceMatrix.needsUpdate = true;
  drum.add(pins);

  const face = document.createElement('canvas');
  face.width = 1024;
  face.height = 420;
  const ink = face.getContext('2d');
  const faceTexture = new THREE.CanvasTexture(face);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  const faceGeometry = new THREE.PlaneGeometry(3.05, 1.25);
  const faceMaterial = new THREE.MeshBasicMaterial({ map: faceTexture, side: THREE.DoubleSide });
  const pulledCard = new THREE.Mesh(faceGeometry, faceMaterial);
  pulledCard.position.z = 2.65;
  scene.add(pulledCard);

  function paintCard(index) {
    const story = stories[index];
    ink.fillStyle = '#f0e9da';
    ink.fillRect(0, 0, 1024, 420);
    ink.strokeStyle = '#b69b6b';
    ink.lineWidth = 7;
    ink.strokeRect(15, 15, 994, 390);
    ink.fillStyle = '#d5c5a7';
    ink.fillRect(176, 19, 2, 382);
    ink.fillStyle = '#a17841';
    ink.font = '600 26px "IBM Plex Mono", monospace';
    ink.fillText('STORY COMPUTING MACHINE', 214, 73);
    ink.font = '600 85px "IBM Plex Mono", monospace';
    ink.fillText(String(index + 1).padStart(3, '0'), 32, 212);
    ink.font = '500 19px "IBM Plex Mono", monospace';
    ink.fillText('INDEX', 42, 252);
    ink.fillStyle = '#222a2d';
    ink.font = '52px "Fraunces", Georgia, serif';
    const words = story.title.split(' ');
    const lines = [];
    let line = '';
    words.forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (ink.measureText(candidate).width > 750 && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    });
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((text, number) => ink.fillText(text, 214, 156 + number * 57));
    ink.fillStyle = '#84613b';
    ink.font = '500 23px "IBM Plex Mono", monospace';
    ink.fillText(`${story.created}  /  ${story.rating}`, 214, 350);
    let hash = 0;
    for (const character of story.slug) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
    for (let bit = 0; bit < 8; bit++) {
      if (hash & (1 << bit)) {
        ink.fillStyle = '#111820';
        ink.beginPath();
        ink.arc(39 + bit * 16, 373, 5, 0, Math.PI * 2);
        ink.fill();
      }
    }
    faceTexture.needsUpdate = true;
  }

  let selected = initialIndex;
  let hovered = -1;
  let matches = new Set(stories.map((_, index) => index));
  let visible = true;
  let stopped = false;
  let frame = 0;
  let targetRotation = -selected * STEP;
  let targetY = -selected * RISE;
  drum.rotation.y = targetRotation;
  camera.position.y = targetY + 0.35;
  camera.lookAt(0, targetY, 0);
  pulledCard.position.y = camera.position.y + 0.87;
  paintCard(selected);

  function recolor() {
    stories.forEach((story, index) => {
      const color = new THREE.Color(
        !matches.has(index) ? 0x384149 : index === selected ? 0xf2c77e : index === hovered ? 0xffffff :
          story.rating === 'R+' ? 0xd5ad9c : story.rating === 'YA' ? 0xd9c7a5 : 0xe5e1d3
      );
      cards.setColorAt(index, color);
    });
    cards.instanceColor.needsUpdate = true;
    requestFrame();
  }

  function render() {
    frame = 0;
    if (stopped || !visible || document.hidden) return;
    const factor = reducedMotion ? 1 : 0.15;
    drum.rotation.y += (targetRotation - drum.rotation.y) * factor;
    camera.position.y += (targetY + 0.35 - camera.position.y) * factor;
    camera.lookAt(0, camera.position.y - 0.35, 0);
    pulledCard.position.y = camera.position.y + 0.87;
    renderer.render(scene, camera);
    if (Math.abs(targetRotation - drum.rotation.y) > 0.001 || Math.abs(targetY + 0.35 - camera.position.y) > 0.001) requestFrame();
  }

  function requestFrame() {
    if (!frame && visible && !stopped && !document.hidden) frame = requestAnimationFrame(render);
  }

  function select(index, fromScene = false) {
    if (index < 0 || index >= stories.length || !matches.has(index)) return;
    const distant = Math.abs(index - selected) > 18;
    selected = index;
    paintCard(index);
    targetRotation = -index * STEP;
    targetY = -index * RISE;
    if (distant || reducedMotion) {
      drum.rotation.y = targetRotation;
      camera.position.y = targetY + 0.35;
    }
    recolor();
    if (fromScene) onSelect(index);
  }

  function step(direction) {
    let index = selected + direction;
    while (index >= 0 && index < stories.length && !matches.has(index)) index += direction;
    if (index >= 0 && index < stories.length) select(index, true);
  }

  function resize() {
    const width = Math.max(1, element.clientWidth);
    const height = Math.max(1, element.clientHeight);
    camera.aspect = width / height;
    camera.fov = width < 600 ? 47 : 39;
    pulledCard.scale.setScalar(width < 600 ? 0.8 : 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    requestFrame();
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function hit(event) {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(cards)[0]?.instanceId ?? -1;
  }

  let drag = null;
  function pointerDown(event) {
    drag = { y: event.clientY, index: selected, moved: false };
    if (event.pointerType !== 'touch') renderer.domElement.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (drag) {
      if (event.pointerType === 'touch') return;
      const delta = Math.round((drag.y - event.clientY) / 24);
      if (Math.abs(event.clientY - drag.y) > 5) drag.moved = true;
      if (delta) {
        const direction = Math.sign(delta);
        const desired = Math.max(0, Math.min(stories.length - 1, drag.index + delta));
        let index = desired;
        while (index !== selected && !matches.has(index)) index -= direction;
        if (matches.has(index) && index !== selected) select(index, true);
      }
      return;
    }
    const next = hit(event);
    if (next !== hovered) {
      hovered = next;
      renderer.domElement.style.cursor = next >= 0 && matches.has(next) ? 'pointer' : 'grab';
      recolor();
    }
  }
  function pointerUp(event) {
    if (drag && !drag.moved) {
      const index = hit(event);
      if (index >= 0 && matches.has(index)) select(index, true);
    }
    drag = null;
  }
  function wheel(event) {
    if (matchMedia('(pointer: coarse)').matches) return;
    if ((selected === 0 && event.deltaY < 0) || (selected === stories.length - 1 && event.deltaY > 0)) return;
    event.preventDefault();
    step(Math.sign(event.deltaY));
  }
  function contextLost(event) {
    event.preventDefault();
    stopped = true;
    onFailure();
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('wheel', wheel, { passive: false });
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  const observer = new ResizeObserver(resize);
  observer.observe(element);
  const visibility = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible) requestFrame();
  }, { threshold: 0.01 });
  visibility.observe(element);
  document.addEventListener('visibilitychange', requestFrame);
  recolor();
  resize();

  return {
    select,
    setMatches(indices) { matches = new Set(indices); recolor(); },
    destroy() {
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', requestFrame);
      cardGeometry.dispose();
      cardMaterial.dispose();
      pinGeometry.dispose();
      pinMaterial.dispose();
      ringGeometry.dispose();
      rings.material.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      faceGeometry.dispose();
      faceMaterial.dispose();
      faceTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
