/*
 * The Long Horizon — a scroll-driven WebGL exhibition of the Story Computing Machine.
 *
 * I.   The Mosaic: one landscape painting assembled from every cover in the collection.
 *      Scrolling releases the tiles and the camera flies through them.
 * II.  The Passage: recent stories plus ten older stops along one horizon. Landscape
 *      shards rise from the book directly into a screen-filling painting, then return
 *      to the pages as the camera passes. Each story's cover rises with its art.
 * III. Night: the covers of this walk hang beside the curator's note.
 */
import * as THREE from './vendor/three.module.min.js';

const root = document.getElementById('horizon');
const source = document.getElementById('horizon-data');
if (root && source) start(JSON.parse(source.textContent));

function start(data) {
  'use strict';
  const $ = id => document.getElementById(id);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const STORE = 'long-horizon:v4';
  const RANDOM_STOPS = 10;
  const FRESH_MS = 48 * 60 * 60 * 1000;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const lum = hex => {
    const n = parseInt(String(hex).slice(1), 16);
    return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  const shuffle = list => {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  const roman = n => {
    let out = '';
    for (const [value, glyph] of [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (n >= value) { out += glyph; n -= value; }
    return out;
  };
  const dateLabel = iso => {
    const date = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(date.getTime()) ? iso :
      date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const ago = iso => {
    const hours = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 3600000));
    return hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago` : 'yesterday';
  };

  const now = Date.now();
  const freshStories = data.stories.filter(story => {
    const created = Date.parse(story.createdAt);
    return Number.isFinite(created) && now - created >= 0 && now - created < FRESH_MS;
  });

  /* ------------------------------------------------------------------ choose today's walk */
  function chooseWalk() {
    const bySlug = new Map(data.pool.map(stop => [stop.slug, stop]));
    const stops = freshStories.map(story => {
      const pooled = bySlug.get(story.slug);
      return pooled ? { ...pooled, fresh: true, createdAt: story.createdAt }
        : { ...story, fresh: true, land: null };
    });
    const freshSlugs = new Set(freshStories.map(story => story.slug));
    const olderStories = shuffle(data.stories.filter(story => !freshSlugs.has(story.slug)));
    stops.push(...olderStories.slice(0, RANDOM_STOPS).map(story => {
      const pooled = bySlug.get(story.slug);
      return pooled ? { ...pooled } : { ...story, land: null };
    }));
    for (const stop of stops) {
      stop.land = { ...data.locations[stop.slug] };
    }
    const used = new Set(stops.map(stop => stop.slug));
    const spare = shuffle(data.pool.filter(stop => !used.has(stop.slug)));
    stops.sort((a, b) => lum(b.land.sky) - lum(a.land.sky));
    const bright = spare.filter(stop => lum(stop.land.sky) > 0.5);
    const heroes = bright.length ? bright : spare;
    const hero = heroes.length ? heroes[Math.floor(Math.random() * heroes.length)].land : stops[0].land;
    return { stops, hero };
  }
  function restoreWalk() {
    try {
      const nav = performance.getEntriesByType('navigation')[0];
      const saved = JSON.parse(sessionStorage.getItem(STORE) || 'null');
      if (!saved || !nav || nav.type !== 'back_forward' || Date.now() - saved.time > 7200000) return null;
      return saved;
    } catch { return null; }
  }
  const restored = restoreWalk();
  const walk = restored ? restored.walk : chooseWalk();
  const stops = walk.stops;
  const N = stops.length;
  const randomCoverPoint = side => [side * (0.48 + (Math.random() - 0.5) * 0.24), (Math.random() - 0.5) * 0.44];
  for (const stop of stops) {
    if (!Array.isArray(stop.coverEntry)) stop.coverEntry = randomCoverPoint(Math.random() < 0.5 ? -1 : 1);
    if (!Array.isArray(stop.coverExit)) {
      let exit = randomCoverPoint(Math.random() < 0.5 ? -1 : 1);
      if (Math.hypot(exit[0] - stop.coverEntry[0], exit[1] - stop.coverEntry[1]) < 0.3) {
        exit = randomCoverPoint(-Math.sign(stop.coverEntry[0]));
      }
      stop.coverExit = exit;
    }
  }

  /* ------------------------------------------------------------------ DOM */
  const canvas = $('hz-canvas');
  const track = $('hz-track');
  const intro = $('hz-intro');
  const label = $('hz-label');
  const end = $('hz-end');
  const tip = $('hz-tip');
  const ticks = $('hz-ticks');
  const marker = $('hz-marker');
  const counter = $('hz-counter');
  const place = $('hz-place');
  const list = $('hz-stops');
  const loader = $('hz-loading');
  const loadBar = $('hz-load-bar');

  $('hz-count').textContent = `${N} highlighted stories`;
  const freshCount = stops.filter(stop => stop.fresh).length;
  if (freshCount) {
    $('hz-fresh').hidden = false;
    $('hz-fresh').textContent = `${freshCount} added recently`;
  }
  stops.forEach((stop, index) => {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = `hz-tick${stop.fresh ? ' is-fresh' : ''}`;
    tick.dataset.index = String(index);
    tick.setAttribute('aria-label', `Travel to ${stop.title}`);
    const tipText = document.createElement('span');
    tipText.className = 'hz-tick-tip';
    tipText.textContent = stop.title;
    tick.append(tipText);
    ticks.append(tick);
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = stop.url;
    link.dataset.index = String(index);
    link.textContent = `${stop.title} — ${stop.prompt}`;
    item.append(link);
    list.append(item);
  });

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    root.classList.add('is-fallback');
    $('hz-fallback').hidden = false;
    loader.hidden = true;
    return;
  }
  THREE.ColorManagement.enabled = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.5 : 1.75));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  /* ------------------------------------------------------------------ textures */
  const loaderT = new THREE.TextureLoader();
  let pending = 0;
  let settled = 0;
  function texture(src, onLoad) {
    pending += 1;
    const tex = loaderT.load(src, loaded => {
      settled += 1;
      loadBar.style.transform = `scaleX(${clamp(settled / Math.max(pending, 1), 0, 1)})`;
      if (onLoad) onLoad(loaded);
    }, undefined, () => { settled += 1; });
    tex.colorSpace = THREE.NoColorSpace;
    tex.anisotropy = Math.min(8, maxAniso);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }

  /* ------------------------------------------------------------------ shared GLSL */
  const ROT = `vec3 rot(vec3 v, vec3 axis, float a){ axis = normalize(axis + 1e-4); float c = cos(a), s = sin(a);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c); }`;
  const fog = { uFogColor: { value: new THREE.Color('#15110d') }, uFogNear: { value: 30 }, uFogFar: { value: 110 } };

  /* A screen-fixed open book replaces the sky behind every moving story. */
  const backdropUniforms = {
    uWide: { value: null }, uTall: { value: null },
    uWideReady: { value: 0 }, uTallReady: { value: 0 },
    uWideAspect: { value: 2 }, uTallAspect: { value: 0.563 },
    uViewportAspect: { value: 1 }, uPortrait: { value: 0 }, uVisible: { value: 0 },
  };
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: backdropUniforms, depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`,
    fragmentShader: `uniform sampler2D uWide, uTall;
      uniform float uWideReady, uTallReady, uWideAspect, uTallAspect, uViewportAspect, uPortrait, uVisible; varying vec2 vUv;
      void main(){
        vec3 col = vec3(0.082, 0.067, 0.052);
        bool tall = uPortrait > 0.5 && uTallReady > 0.5;
        float artAspect = tall ? uTallAspect : uWideAspect;
        vec2 cover = vec2(min(1.0, uViewportAspect / artAspect), min(1.0, artAspect / uViewportAspect));
        vec2 uv = (vUv - 0.5) * cover / 1.32 + 0.5;
        float edgeShade = max(1.0 - smoothstep(0.0, 0.28, vUv.y), smoothstep(0.72, 1.0, vUv.y));
        float brightness = mix(0.62, 0.34, edgeShade);
        if (tall) col = mix(col, texture2D(uTall, uv).rgb * brightness, uVisible);
        else if (uWideReady > 0.5) col = mix(col, texture2D(uWide, uv).rgb * brightness, uVisible);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  backdrop.frustumCulled = false;
  backdrop.renderOrder = -1;
  scene.add(backdrop);
  backdropUniforms.uWide.value = texture(`${data.base}open-book-pages-wide.webp`, loaded => {
    backdropUniforms.uWideAspect.value = loaded.image.width / loaded.image.height;
    backdropUniforms.uWideReady.value = 1;
  });
  backdropUniforms.uTall.value = texture(`${data.base}open-book-pages-tall.webp`, loaded => {
    backdropUniforms.uTallAspect.value = loaded.image.width / loaded.image.height;
    backdropUniforms.uTallReady.value = 1;
  });

  /* ------------------------------------------------------------------ I. the mosaic */
  const atlas = data.atlas;
  const freshSlugs = new Set(freshStories.map(story => story.slug));
  const coverSlots = new Map(atlas.tiles.flatMap(([slug, kind], slot) => kind === 'cover' ? [[slug, slot]] : []));
  const coverSlotIndices = shuffle([...coverSlots.values()]);
  const freshCoverSlots = freshStories.map(story => coverSlots.get(story.slug)).filter(slot => slot !== undefined);
  const tileCount = coverSlotIndices.length;
  const MOS_COLS = 25;
  const MOS_ROWS = Math.ceil(tileCount / MOS_COLS);
  const MOS_W = 30;
  const tileW = MOS_W / MOS_COLS;
  const tileH = tileW / 0.5625;
  const MOS_H = MOS_ROWS * tileH;
  // Spread recent covers across the upper rows without duplicating any cover.
  const centralCells = [];
  const topEdgeCells = [];
  const otherCells = [];
  const visibleWidth = Math.min(MOS_W, MOS_H * innerWidth / innerHeight) * 0.96;
  const centralSpan = Math.min(10, Math.max(3, Math.floor(visibleWidth / tileW) - 1));
  const centralStart = Math.floor((MOS_COLS - centralSpan) / 2);
  const firstRow = Math.floor(Math.random() * 2);
  const primeCells = [];
  if (MOS_ROWS >= 3) {
    if (centralSpan >= 5) {
      shuffle([0, 1, 2, 3, 4]).forEach((band, number) => {
        const start = Math.floor(band * centralSpan / 5);
        const end = Math.floor((band + 1) * centralSpan / 5);
        const col = centralStart + start + Math.floor(Math.random() * (end - start));
        primeCells.push((1 + (number + firstRow) % 2) * MOS_COLS + col);
      });
    } else {
      const narrowCells = [];
      for (let row = 1; row <= 2; row += 1) {
        for (let col = centralStart; col < centralStart + centralSpan; col += 1) narrowCells.push(row * MOS_COLS + col);
      }
      primeCells.push(...shuffle(narrowCells).slice(0, 5));
    }
  }
  const visiblePrimeCells = primeCells.filter(i => i < tileCount);
  const primeSet = new Set(visiblePrimeCells);
  for (let i = 0; i < tileCount; i += 1) {
    const col = i % MOS_COLS;
    const row = Math.floor(i / MOS_COLS);
    if (primeSet.has(i)) continue;
    if (row <= 2 && col >= centralStart && col < centralStart + centralSpan) centralCells.push(i);
    else if (row <= 2) topEdgeCells.push(i);
    else otherCells.push(i);
  }
  const featuredCells = [...visiblePrimeCells, ...shuffle(centralCells), ...shuffle(topEdgeCells), ...shuffle(otherCells)];
  freshCoverSlots.forEach((slot, number) => {
    const target = featuredCells[number];
    if (target === undefined) return;
    const current = coverSlotIndices.indexOf(slot);
    [coverSlotIndices[target], coverSlotIndices[current]] = [coverSlotIndices[current], coverSlotIndices[target]];
  });
  const mosaicGeo = new THREE.InstancedBufferGeometry();
  const baseTile = new THREE.PlaneGeometry(tileW, tileH);
  mosaicGeo.index = baseTile.index;
  mosaicGeo.setAttribute('position', baseTile.getAttribute('position'));
  mosaicGeo.setAttribute('uv', baseTile.getAttribute('uv'));
  const aGrid = new Float32Array(tileCount * 3);
  const aScatter = new Float32Array(tileCount * 3);
  const aTile = new Float32Array(tileCount * 2);
  const aFresh = new Float32Array(tileCount);
  const aHover = new Float32Array(tileCount);
  const aTarget = new Float32Array(tileCount * 3).fill(0.5);
  const aRand = new Float32Array(tileCount * 4);
  const tileSlot = new Uint16Array(tileCount);
  for (let i = 0; i < tileCount; i += 1) {
    const col = i % MOS_COLS;
    const row = Math.floor(i / MOS_COLS);
    const rowLength = Math.min(MOS_COLS, tileCount - row * MOS_COLS);
    aGrid.set([-rowLength * tileW / 2 + (col + 0.5) * tileW, MOS_H / 2 - (row + 0.5) * tileH, 0], i * 3);
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.6 + Math.pow(Math.random(), 0.7) * 17;
    aScatter.set([Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7, 8 - Math.random() * 28], i * 3);
    const slot = coverSlotIndices[i];
    tileSlot[i] = slot;
    aTile.set([slot % atlas.cols, atlas.rows - 1 - Math.floor(slot / atlas.cols)], i * 2);
    aFresh[i] = Number(freshSlugs.has(atlas.tiles[slot][0]));
    aRand.set([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random()], i * 4);
  }
  mosaicGeo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(aGrid, 3));
  mosaicGeo.setAttribute('aScatter', new THREE.InstancedBufferAttribute(aScatter, 3));
  mosaicGeo.setAttribute('aTile', new THREE.InstancedBufferAttribute(aTile, 2));
  mosaicGeo.setAttribute('aFresh', new THREE.InstancedBufferAttribute(aFresh, 1));
  const hoverAttr = new THREE.InstancedBufferAttribute(aHover, 1);
  hoverAttr.setUsage(THREE.DynamicDrawUsage);
  mosaicGeo.setAttribute('aHover', hoverAttr);
  const targetAttr = new THREE.InstancedBufferAttribute(aTarget, 3);
  mosaicGeo.setAttribute('aTarget', targetAttr);
  mosaicGeo.setAttribute('aRand', new THREE.InstancedBufferAttribute(aRand, 4));
  mosaicGeo.instanceCount = tileCount;
  const mosaicMat = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: null }, uStep: { value: new THREE.Vector2(1 / atlas.cols, 1 / atlas.rows) },
      uExplode: { value: 1 }, uTint: { value: 1 }, uTime: { value: 0 }, uReady: { value: 0 },
      uMosaicZ: { value: 23 }, uMosaicHalfView: { value: new THREE.Vector2(15, 10) },
      uTileHalf: { value: new THREE.Vector2(tileW / 2, tileH / 2) },
      ...fog,
    },
    vertexShader: `
      attribute vec3 aGrid; attribute vec3 aScatter; attribute vec2 aTile; attribute float aFresh, aHover; attribute vec3 aTarget; attribute vec4 aRand;
      uniform vec2 uStep, uMosaicHalfView, uTileHalf; uniform float uExplode, uTime, uFogNear, uFogFar, uMosaicZ;
      varying vec2 vUv, vTileUv; varying vec3 vTarget; varying float vFog, vHover, vFresh;
      ${ROT}
      void main(){
        float e = clamp(uExplode * 1.35 - aRand.w * 0.35, 0.0, 1.0);
        e = e * e * (3.0 - 2.0 * e);
        float hov = aHover;
        vec3 local = position * (0.955 + hov * 0.7);
        local = rot(local, aRand.xyz, e * 7.0 * (aRand.w - 0.5) * 2.0 + sin(uTime * 0.5 + aRand.w * 40.0) * 0.4 * e);
        vec3 world = mix(aGrid, aScatter, e) + local;
        float hoverDepth = hov * 1.2;
        float frontScale = 1.0 - hoverDepth / uMosaicZ;
        vec2 halfCard = uTileHalf * (0.955 + hov * 0.7);
        vec2 screenLimit = max(vec2(0.0), uMosaicHalfView * frontScale - halfCard - vec2(0.12));
        vec2 projectedCenter = aGrid.xy * frontScale;
        vec2 anchoredCenter = mix(projectedCenter, clamp(projectedCenter, -screenLimit, screenLimit), smoothstep(0.0, 0.2, hov));
        world.xy += (anchoredCenter - aGrid.xy) * (1.0 - e);
        world.z += hoverDepth;
        world.y += sin(uTime * 0.7 + aRand.w * 50.0) * 0.25 * e;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        vTileUv = uv;
        vUv = (aTile + uv) * uStep;
        vTarget = aTarget;
        vHover = hov;
        vFresh = aFresh;
        vFog = smoothstep(uFogNear, uFogFar, -mv.z);
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform float uTint, uReady; uniform vec3 uFogColor;
      varying vec2 vUv, vTileUv; varying vec3 vTarget; varying float vFog, vHover, vFresh;
      void main(){
        vec3 c = texture2D(uAtlas, vUv).rgb;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        vec3 tinted = vTarget * (0.78 + 0.5 * l) * 1.08;
        vec3 col = mix(c, tinted, uTint * 0.93 * (1.0 - vHover));
        vec3 vivid = mix(vec3(l), c, 1.35) * 1.25 + vec3(0.045, 0.025, 0.0);
        float edge = min(min(vTileUv.x, 1.0 - vTileUv.x), min(vTileUv.y, 1.0 - vTileUv.y));
        float warmEdge = 1.0 - smoothstep(0.0, 0.065, edge);
        col = mix(col, mix(vivid, vec3(1.0, 0.74, 0.33), warmEdge * 0.8), vFresh * (1.0 - vHover));
        col = mix(vTarget, col, uReady);
        gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.0);
      }`,
  });
  const mosaic = new THREE.Mesh(mosaicGeo, mosaicMat);
  mosaic.frustumCulled = false;
  scene.add(mosaic);
  mosaicMat.uniforms.uAtlas.value = texture(data.atlasSrc, () => { mosaicMat.uniforms.uReady.value = 1; });

  /* The hero painting sets each tile's colour, so the covers read as one landscape. */
  let heroReady = false;
  const heroImage = new Image();
  heroImage.decoding = 'async';
  pending += 1;
  heroImage.onload = () => {
    settled += 1;
    const sample = document.createElement('canvas');
    sample.width = MOS_COLS;
    sample.height = MOS_ROWS;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(heroImage, 0, 0, MOS_COLS, MOS_ROWS);
    const pixels = ctx.getImageData(0, 0, MOS_COLS, MOS_ROWS).data;
    for (let i = 0; i < tileCount; i += 1) {
      aTarget[i * 3] = pixels[i * 4] / 255;
      aTarget[i * 3 + 1] = pixels[i * 4 + 1] / 255;
      aTarget[i * 3 + 2] = pixels[i * 4 + 2] / 255;
    }
    targetAttr.needsUpdate = true;
    heroReady = true;
  };
  heroImage.onerror = () => { settled += 1; heroReady = true; };
  heroImage.src = walk.hero.src;

  /* ------------------------------------------------------------------ II. the passage */
  const PAINT_W = 24;
  const PAINT_H = 16;
  const FIRST_Z = -46;
  const SPACING = 50;
  const stationX = i => Math.sin(i * 1.7 + 0.6) * 7;
  const stationZ = i => FIRST_Z - i * SPACING;
  const shardGeometry = (() => {
    const gx = 16;
    const gy = 11;
    const pts = [];
    for (let y = 0; y <= gy; y += 1) {
      for (let x = 0; x <= gx; x += 1) {
        const jitter = x > 0 && x < gx && y > 0 && y < gy ? 0.38 : 0;
        pts.push([(x + (Math.random() - 0.5) * jitter * 2) / gx, (y + (Math.random() - 0.5) * jitter * 2) / gy]);
      }
    }
    const pos = [];
    const uv = [];
    const center = [];
    const depth = [];
    const rand = [];
    const tri = (a, b, c) => {
      const cx = (a[0] + b[0] + c[0]) / 3;
      const cy = (a[1] + b[1] + c[1]) / 3;
      const d = (0.5 - cy) * 7 + (Math.random() - 0.5) * 4.5;
      const r = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random()];
      for (const p of [a, b, c]) {
        pos.push((p[0] - 0.5) * PAINT_W, (p[1] - 0.5) * PAINT_H, 0);
        uv.push(p[0], p[1]);
        center.push((cx - 0.5) * PAINT_W, (cy - 0.5) * PAINT_H);
        depth.push(d);
        rand.push(...r);
      }
    };
    for (let y = 0; y < gy; y += 1) {
      for (let x = 0; x < gx; x += 1) {
        const p00 = pts[y * (gx + 1) + x];
        const p10 = pts[y * (gx + 1) + x + 1];
        const p01 = pts[(y + 1) * (gx + 1) + x];
        const p11 = pts[(y + 1) * (gx + 1) + x + 1];
        if ((x + y) % 2) { tri(p00, p10, p11); tri(p00, p11, p01); } else { tri(p00, p10, p01); tri(p10, p11, p01); }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aCenter', new THREE.Float32BufferAttribute(center, 2));
    geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    geo.setAttribute('aRand', new THREE.Float32BufferAttribute(rand, 4));
    return geo;
  })();
  const shardVertex = `
    attribute vec2 aCenter; attribute float aDepth; attribute vec4 aRand;
    uniform vec3 uEye, uOrigin; uniform float uDs, uAssemble, uWorldLock, uBurst, uTime, uFogNear, uFogFar;
    uniform vec3 uPageEye, uPageRight, uPageUp, uPageForward;
    uniform vec2 uPageHalfView; uniform float uPageDepth;
    varying vec2 vUv; varying float vFog; varying float vRand; varying float vLoose;
    ${ROT}
    void main(){
      float a = clamp((uAssemble - aRand.w * 0.4) / 0.6, 0.0, 1.0);
      a = a * a * (3.0 - 2.0 * a);
      float loose = 1.0 - a;
      float scale = (uDs - aDepth) / uDs;
      vec3 P = uOrigin + vec3(aCenter, 0.0);
      vec3 anam = uEye + (P - uEye) * scale;
      // Match the finished painting's screen coverage throughout assembly.
      vec3 fill = uPageEye + uPageForward * (uDs - aDepth)
        + (uPageRight * aCenter.x + uPageUp * aCenter.y) * scale;
      vec3 target = mix(fill, anam, uWorldLock);
      // Each piece begins at its corresponding patch of the open pages.
      vec2 pageUv = vec2(clamp(aCenter.x / 12.0 * 0.78 + aRand.x * 0.1, -0.84, 0.84),
                         clamp(aCenter.y / 8.0 * 0.70 + aRand.y * 0.1, -0.75, 0.75));
      vec3 page = uPageEye + uPageForward * (uPageDepth + aRand.z * 0.7)
        + uPageRight * (pageUv.x * uPageHalfView.x)
        + uPageUp * (pageUv.y * uPageHalfView.y);
      vec3 c = mix(page, target, a);
      c = mix(c, page, uBurst);
      vec3 local = vec3((position.xy - aCenter) * 0.994, 0.0);
      local = rot(local, aRand.xyz, loose * 3.1416 * (aRand.w - 0.5) * 2.4 + uBurst * 5.0 * (aRand.w - 0.5) + loose * sin(uTime * 0.4 + aRand.w * 9.0) * 0.5);
      vec3 flatLocal = (uPageRight * local.x + uPageUp * local.y) * scale;
      vec3 worldLocal = local * scale;
      vec4 mv = viewMatrix * vec4(c + mix(flatLocal, worldLocal, uWorldLock) * (0.18 + 0.82 * a) * (1.0 - 0.85 * uBurst), 1.0);
      gl_Position = projectionMatrix * mv;
      vUv = uv; vRand = aRand.w; vLoose = loose;
      vFog = smoothstep(uFogNear, uFogFar, -mv.z);
    }`;
  const shardFragment = `
    uniform sampler2D uMap; uniform float uHasMap, uBurst, uNight; uniform vec3 uSky, uGround, uFogColor;
    varying vec2 vUv; varying float vFog; varying float vRand; varying float vLoose;
    void main(){
      if (vRand < uBurst * 1.25 - 0.2) discard;
      vec3 base = mix(uGround, uSky, smoothstep(0.1, 0.9, vUv.y));
      vec3 col = mix(base, texture2D(uMap, vUv).rgb, uHasMap);
      col *= 1.0 - vLoose * 0.18;
      col *= 1.0 - uNight * 0.25;
      gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.0);
    }`;

  const glowTexture = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,220,160,1)');
    grad.addColorStop(0.35, 'rgba(255,200,130,.45)');
    grad.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  })();

  function makeCover(stop, width) {
    const height = width * 16 / 9;
    const group = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.set(width * 3.4, height * 1.9, 1);
    glow.position.z = -0.4;
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.045, height + width * 0.045),
      new THREE.MeshBasicMaterial({ color: 0x17110c, transparent: true, opacity: 0 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color: 0x2a2219, transparent: true, opacity: 0 }));
    face.position.z = 0.02;
    group.add(glow, frame, face);
    group.userData = { face, frame, glow, height, width, loaded: false };
    return group;
  }
  function loadCover(group, src) {
    if (group.userData.loaded) return;
    group.userData.loaded = true;
    texture(src, tex => {
      group.userData.face.material.map = tex;
      group.userData.face.material.color.set(0xffffff);
      group.userData.face.material.needsUpdate = true;
    });
  }

  const pageFrame = {
    uPageEye: { value: new THREE.Vector3() },
    uPageRight: { value: new THREE.Vector3() },
    uPageUp: { value: new THREE.Vector3() },
    uPageForward: { value: new THREE.Vector3() },
    uPageHalfView: { value: new THREE.Vector2() },
    uPageDepth: { value: 24 },
  };

  const stations = stops.map((stop, index) => {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null }, uHasMap: { value: 0 }, uEye: { value: new THREE.Vector3() }, uOrigin: { value: new THREE.Vector3() },
        uDs: { value: 17 }, uAssemble: { value: 0 }, uWorldLock: { value: 0 }, uBurst: { value: 0 }, uTime: { value: 0 }, uNight: { value: 0 },
        uSky: { value: new THREE.Color(stop.land.sky) }, uGround: { value: new THREE.Color(stop.land.ground) }, ...fog, ...pageFrame,
      },
      vertexShader: shardVertex, fragmentShader: shardFragment, side: THREE.DoubleSide,
    });
    material.uniforms.uFogColor = fog.uFogColor;
    material.uniforms.uFogNear = fog.uFogNear;
    material.uniforms.uFogFar = fog.uFogFar;
    const shards = new THREE.Mesh(shardGeometry, material);
    shards.frustumCulled = false;
    scene.add(shards);
    const cover = makeCover(stop, 3.2);
    cover.userData.index = index;
    scene.add(cover);
    return { stop, index, shards, material, cover, loaded: false, x: stationX(index), z: stationZ(index),
      pageCover: new THREE.Vector3(), pageCoverExit: new THREE.Vector3(),
      coverTarget: new THREE.Vector3(), coverFill: new THREE.Vector3() };
  });
  function loadStation(station) {
    if (station.loaded) return;
    station.loaded = true;
    station.material.uniforms.uMap.value = texture(station.stop.land.src, () => { station.material.uniforms.uHasMap.value = 1; });
    loadCover(station.cover, station.stop.cover);
  }

  /* ------------------------------------------------------------------ III. night gallery */
  const ring = stops.map((stop, index) => {
    const cover = makeCover(stop, 2.1);
    cover.userData.index = index;
    cover.userData.ring = true;
    // The covers share a shallow plane. Draw their layers in a stable order
    // without writing depth, so overlapping edges cannot fight in the z buffer.
    for (const [part, layer] of [[cover.userData.glow, 0], [cover.userData.frame, 1], [cover.userData.face, 2]]) {
      part.material.depthTest = false;
      part.material.depthWrite = false;
      part.renderOrder = 10 + index * 3 + layer;
    }
    scene.add(cover);
    return cover;
  });

  /* Drifting flecks of paint by day, fireflies at night. */
  const FLECKS = coarse ? 900 : 1800;
  const fleckGeo = new THREE.BufferGeometry();
  const fleckPos = new Float32Array(FLECKS * 3);
  const fleckRand = new Float32Array(FLECKS);
  const pathEnd = stationZ(N - 1) - 70;
  for (let i = 0; i < FLECKS; i += 1) {
    const z = 20 + Math.random() * (pathEnd - 20);
    const i0 = clamp((FIRST_Z - z) / SPACING, 0, N - 1);
    const cx = lerp(stationX(Math.floor(i0)), stationX(Math.ceil(i0)), i0 % 1);
    fleckPos.set([cx + (Math.random() - 0.5) * 44, (Math.random() - 0.35) * 22, z], i * 3);
    fleckRand[i] = Math.random();
  }
  fleckGeo.setAttribute('position', new THREE.BufferAttribute(fleckPos, 3));
  fleckGeo.setAttribute('aRand', new THREE.BufferAttribute(fleckRand, 1));
  const fleckMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `attribute float aRand; uniform float uTime, uScale, uNight; varying float vRand; varying float vAlpha;
      void main(){ vec3 p = position; p.y += sin(uTime * 0.3 + aRand * 60.0) * 0.8; p.x += cos(uTime * 0.2 + aRand * 40.0) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = uScale * (1.2 + aRand * 2.6 + uNight * 2.2) * (26.0 / -mv.z);
        vRand = aRand; vAlpha = smoothstep(90.0, 20.0, -mv.z) * smoothstep(0.5, 3.0, -mv.z); }`,
    fragmentShader: `uniform float uTime, uNight; varying float vRand; varying float vAlpha;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        float blink = 0.55 + 0.45 * sin(uTime * 2.0 + vRand * 80.0);
        vec3 day = vec3(1.0, 0.93, 0.8); vec3 night = vec3(0.86, 1.0, 0.55);
        gl_FragColor = vec4(mix(day, night, uNight), a * vAlpha * mix(0.35, 0.9 * blink, uNight)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const flecks = new THREE.Points(fleckGeo, fleckMat);
  flecks.frustumCulled = false;
  scene.add(flecks);

  /* ------------------------------------------------------------------ geometry of the walk */
  const view = { w: 1, h: 1, aspect: 1, portrait: false, ds: 17, halfH: 1, mosaicZ: 23 };
  const MOSAIC_SCREENS = 1.5;
  const STOP_SCREENS = 1.75;
  const FINALE_SCREENS = 1.6;
  const scrollLength = () => view.h * (MOSAIC_SCREENS + (N - 1) * STOP_SCREENS + FINALE_SCREENS);
  const scrollForU = u => {
    if (u <= 0) return (u + 1) * MOSAIC_SCREENS * view.h;
    if (u <= N - 1) return view.h * (MOSAIC_SCREENS + u * STOP_SCREENS);
    return view.h * (MOSAIC_SCREENS + (N - 1) * STOP_SCREENS + (u - (N - 1)) * FINALE_SCREENS);
  };
  const uForScroll = y => {
    const a = MOSAIC_SCREENS * view.h;
    const b = a + (N - 1) * STOP_SCREENS * view.h;
    if (y <= a) return y / a - 1;
    if (y <= b) return (y - a) / (STOP_SCREENS * view.h);
    return N - 1 + clamp((y - b) / (FINALE_SCREENS * view.h), 0, 1);
  };

  function resize() {
    const w = innerWidth;
    const h = innerHeight;
    Object.assign(view, { w, h, aspect: w / h, portrait: w / h < 0.85 });
    camera.fov = view.portrait ? 64 : (view.aspect < 1.3 ? 56 : 50);
    camera.aspect = view.aspect;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    backdropUniforms.uPortrait.value = view.portrait ? 1 : 0;
    backdropUniforms.uViewportAspect.value = view.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    view.tanHalf = tanHalf;
    view.ds = Math.min((PAINT_H / 2) / tanHalf, (PAINT_W / 2) / (tanHalf * view.aspect)) * 0.93;
    view.mosaicZ = Math.min((MOS_H / 2) / tanHalf, (MOS_W / 2) / (tanHalf * view.aspect)) * 0.96;
    mosaicMat.uniforms.uMosaicZ.value = view.mosaicZ;
    mosaicMat.uniforms.uMosaicHalfView.value.set(view.mosaicZ * tanHalf * view.aspect, view.mosaicZ * tanHalf);
    stations.forEach(station => {
      const u = station.material.uniforms;
      u.uDs.value = view.ds;
      u.uEye.value.set(station.x, 0, station.z + view.ds);
      u.uOrigin.value.set(station.x, 0, station.z);
    });
    fleckMat.uniforms.uScale.value = renderer.getPixelRatio() * (h / 900);
    track.style.height = `${Math.ceil(scrollLength() + h)}px`;
    ticks.querySelectorAll('.hz-tick').forEach((tick, index) => {
      tick.style.left = `${(scrollForU(index) / scrollLength()) * 100}%`;
    });
  }

  const dwell = t => t - 0.82 * Math.sin(2 * Math.PI * t) / (2 * Math.PI);
  const eye = i => new THREE.Vector3(stationX(i), 0, stationZ(i) + view.ds);
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  function cameraAt(u, out, look) {
    if (u <= 0) {
      const t = u + 1;
      const e = t < 0.08 ? 0 : dwell(clamp((t - 0.08) / 0.92, 0, 1));
      const from = new THREE.Vector3(0, 0, view.mosaicZ);
      out.lerpVectors(from, eye(0), e);
      out.x = lerp(0, stationX(0), smooth(0.35, 1, e));
      look.set(out.x * 0.6 + stationX(0) * 0.4 * e, 0, out.z - 30);
      return;
    }
    if (u < N - 1) {
      const i = Math.floor(u);
      const t = dwell(u - i);
      const a = eye(i);
      const b = eye(i + 1);
      out.set(lerp(a.x, b.x, smooth(0.25, 0.95, t)), Math.sin(t * Math.PI) * 1.6, lerp(a.z, b.z, t));
      look.set(lerp(a.x, b.x, smooth(0.1, 0.8, t)), out.y * 0.4, out.z - 30);
      return;
    }
    const t = clamp(u - (N - 1), 0, 1);
    const e = dwell(t);
    const a = eye(N - 1);
    out.set(a.x, lerp(0, 1.5, e), lerp(a.z, stationZ(N - 1) - 30, e));
    look.set(a.x, out.y * 0.5, out.z - 30);
  }

  /* ------------------------------------------------------------------ labels */
  let shown = -2;
  function showStop(index) {
    if (index === shown) return;
    shown = index;
    root.dataset.stop = index >= 0 ? String(index) : '';
    ticks.querySelectorAll('.hz-tick').forEach((tick, i) => tick.classList.toggle('is-current', i === index));
    if (index < 0) return;
    const stop = stops[index];
    $('hz-label-no').textContent = `No. ${roman(index + 1)} of ${roman(N)}`;
    $('hz-label-title').textContent = stop.title;
    $('hz-label-meta').textContent = stop.fresh ?
      `New acquisition · added ${ago(stop.createdAt)} · ${stop.rating}` : `Written ${dateLabel(stop.created)} · ${stop.rating}`;
    const prompt = stop.prompt;
    $('hz-label-prompt').textContent = prompt.length > 320 ? `${prompt.slice(0, 317).replace(/\s+\S*$/, '')}…` : prompt;
    $('hz-label-place').textContent = stop.land.title;
    $('hz-label-read').href = stop.url;
    counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(N).padStart(2, '0')}`;
    place.textContent = stop.land.title;
  }

  /* ------------------------------------------------------------------ interaction */
  const pointer = new THREE.Vector2(0, 0);
  const pointerSmooth = new THREE.Vector2(0, 0);
  const ndc = new THREE.Vector2(2, 2);
  let pointerInside = false;
  const raycaster = new THREE.Raycaster();
  let hoverTile = -1;
  let hoverCover = null;
  let pointerX = 0;
  let pointerY = 0;
  let tipWidth = 0;
  let tipHeight = 0;
  window.addEventListener('pointermove', event => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointer.set(event.clientX / view.w * 2 - 1, -(event.clientY / view.h * 2 - 1));
    ndc.copy(pointer);
    pointerInside = event.pointerType === 'mouse' && event.target === canvas;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointerInside = false; });

  function pick(u) {
    const previousTile = hoverTile;
    hoverTile = -1;
    hoverCover = null;
    if (!pointerInside) return;
    raycaster.setFromCamera(ndc, camera);
    const covers = [...stations.map(s => s.cover), ...ring].filter(group => group.userData.face.material.opacity > 0.6);
    const hit = raycaster.intersectObjects(covers.map(group => group.userData.face), false)[0];
    if (hit) { hoverCover = covers.find(group => group.userData.face === hit.object); return; }
    if (u < -0.9 && mosaicMat.uniforms.uExplode.value < 0.02) {
      const ray = raycaster.ray;
      if (Math.abs(ray.direction.z) < 1e-5) return;
      const t = -ray.origin.z / ray.direction.z;
      if (t <= 0) return;
      const x = ray.origin.x + ray.direction.x * t;
      const y = ray.origin.y + ray.direction.y * t;
      const row = Math.floor((MOS_H / 2 - y) / tileH);
      if (row >= 0 && row < MOS_ROWS) {
        const rowLength = Math.min(MOS_COLS, tileCount - row * MOS_COLS);
        const col = Math.floor((x + rowLength * tileW / 2) / tileW);
        if (col < 0 || col >= rowLength) return;
        // Stay with an enlarged tile until the pointer reaches the next tile's center.
        if (previousTile >= 0) {
          const oldX = aGrid[previousTile * 3];
          const oldY = aGrid[previousTile * 3 + 1];
          if (Math.abs(x - oldX) < tileW && Math.abs(y - oldY) < tileH) {
            hoverTile = previousTile;
            return;
          }
        }
        hoverTile = row * MOS_COLS + col;
      }
    }
  }
  function updateTip() {
    let text = '';
    if (hoverTile >= 0) {
      const [slug] = atlas.tiles[tileSlot[hoverTile]];
      const title = data.titles[slug];
      if (title) text = `<em>${escapeHtml(title)}</em><span>${freshSlugs.has(slug) ? 'New story' : 'Cover'} · click to read</span>`;
    } else if (hoverCover) {
      text = `<em>${escapeHtml(stops[hoverCover.userData.index].title)}</em><span>Step through</span>`;
    }
    if (text !== tip.dataset.text) {
      tip.dataset.text = text;
      tip.innerHTML = text;
      tip.hidden = !text;
      if (text) { tipWidth = tip.offsetWidth; tipHeight = tip.offsetHeight; }
    }
    if (text) {
      const right = pointerX + 18;
      const left = pointerX - tipWidth - 18;
      const x = right + tipWidth + 8 <= view.w ? right : Math.max(8, left);
      const y = clamp(pointerY + 16, 8, Math.max(8, view.h - tipHeight - 8));
      tip.style.transform = `translate(${x}px, ${y}px)`;
    }
    canvas.style.cursor = text ? 'pointer' : '';
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function remember() {
    try { sessionStorage.setItem(STORE, JSON.stringify({ walk, y: window.scrollY, time: Date.now() })); } catch { /* private mode */ }
  }
  let leaving = null;
  function stepInto(url, group) {
    remember();
    if (reduceMotion || !group) { location.href = url; return; }
    const target = new THREE.Vector3();
    group.userData.face.getWorldPosition(target);
    leaving = { url, from: camera.position.clone(), to: target.clone().add(new THREE.Vector3(0, 0, 1.2)), look: target, start: performance.now() };
    root.classList.add('is-leaving');
    setTimeout(() => { location.href = url; }, 900);
  }
  let downAt = null;
  canvas.addEventListener('pointerdown', event => { downAt = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('click', event => {
    if (downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
    pointer.set(event.clientX / view.w * 2 - 1, -(event.clientY / view.h * 2 - 1));
    ndc.copy(pointer);
    pointerInside = true;
    pick(currentU);
    if (hoverCover) {
      const stop = stops[hoverCover.userData.index];
      if (!hoverCover.userData.ring && Math.abs(currentU - hoverCover.userData.index) > 0.2) { goTo(hoverCover.userData.index); return; }
      stepInto(stop.url, hoverCover);
    } else if (hoverTile >= 0) {
      const [slug] = atlas.tiles[tileSlot[hoverTile]];
      if (data.titles[slug]) { remember(); location.href = `${data.base}stories/${encodeURIComponent(slug)}/`; }
    }
  });
  $('hz-label-read').addEventListener('click', event => {
    if (shown < 0 || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) { remember(); return; }
    event.preventDefault();
    stepInto(stops[shown].url, stations[shown].cover);
  });
  function goTo(index, instant = false) {
    window.scrollTo({ top: scrollForU(clamp(index, 0, N - 1)), behavior: instant || reduceMotion ? 'auto' : 'smooth' });
  }
  ticks.addEventListener('click', event => {
    const tick = event.target.closest('.hz-tick');
    if (tick) goTo(Number(tick.dataset.index));
  });
  $('hz-again').addEventListener('click', () => {
    try { sessionStorage.removeItem(STORE); } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'auto' });
    location.reload();
  });
  list.addEventListener('focusin', event => {
    const link = event.target.closest('a');
    if (link) goTo(Number(link.dataset.index), true);
  });
  end.addEventListener('focusin', () => window.scrollTo({ top: scrollLength(), behavior: 'auto' }));
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const u = uForScroll(window.scrollY);
    if (event.key === 'ArrowRight') { event.preventDefault(); goTo(u < 0 ? 0 : Math.floor(u + 0.25) + 1); }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (u <= 0.25) window.scrollTo({ top: 0, behavior: 'smooth' }); else goTo(Math.ceil(u - 0.25) - 1);
    }
  });
  window.addEventListener('pageshow', event => {
    root.classList.remove('is-leaving');
    leaving = null;
    if (event.persisted) { running = true; requestAnimationFrame(frame); }
  });
  window.addEventListener('pagehide', () => { running = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; requestAnimationFrame(frame); }
  });
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const u = uForScroll(window.scrollY);
      resize();
      window.scrollTo({ top: scrollForU(u), behavior: 'auto' });
    }, 100);
  });

  /* ------------------------------------------------------------------ light over the day */
  const introFog = new THREE.Color('#15110d');
  const journeyFog = new THREE.Color('#554838');

  /* ------------------------------------------------------------------ frame */
  let running = true;
  let currentU = -1;
  let introStart = 0;
  let lastFrameTime = 0;
  const clock = new THREE.Clock();
  function frame() {
    if (!running) return;
    const time = clock.getElapsedTime();
    const delta = Math.min(0.05, time - lastFrameTime);
    lastFrameTime = time;
    const ready = heroReady && mosaicMat.uniforms.uReady.value > 0;
    if (ready && !introStart) {
      introStart = time;
      loader.classList.add('is-done');
      root.classList.add('is-ready');
    }
    const targetU = uForScroll(window.scrollY);
    currentU = reduceMotion ? targetU : currentU + (targetU - currentU) * 0.075;
    if (Math.abs(targetU - currentU) < 1e-4) currentU = targetU;
    const u = currentU;
    const dayT = u < 0 ? u : u / N;

    // light
    const bookReveal = smooth(-0.85, -0.25, u);
    backdropUniforms.uVisible.value = bookReveal;
    fog.uFogColor.value.copy(introFog).lerp(journeyFog, bookReveal);
    renderer.setClearColor(fog.uFogColor.value, 1);
    const night = smooth(0.72, 0.95, dayT);
    fog.uFogFar.value = lerp(120, 85, night);
    fleckMat.uniforms.uNight.value = night;
    fleckMat.uniforms.uTime.value = time;

    // I. mosaic
    const introT = introStart ? (reduceMotion ? 1 : smooth(0, 3.4, time - introStart)) : 0;
    mosaicMat.uniforms.uExplode.value = Math.max(1 - introT, smooth(-0.93, -0.45, u));
    mosaicMat.uniforms.uTint.value = 1 - smooth(-0.96, -0.72, u);
    mosaicMat.uniforms.uTime.value = time;
    const hoverEase = reduceMotion ? 1 : 1 - Math.exp(-delta * 13);
    let hoverChanged = false;
    for (let i = 0; i < tileCount; i += 1) {
      const target = i === hoverTile && u < -0.9 ? 1 : 0;
      const next = Math.abs(target - aHover[i]) < 0.002 ? target : aHover[i] + (target - aHover[i]) * hoverEase;
      if (next !== aHover[i]) { aHover[i] = next; hoverChanged = true; }
    }
    if (hoverChanged) hoverAttr.needsUpdate = true;
    mosaic.visible = u < 1.2;

    // camera
    cameraAt(u, camPos, camLook);
    if (!reduceMotion) pointerSmooth.lerp(pointerInside ? pointer : new THREE.Vector2(0, 0), 0.05);
    const sway = smooth(-0.9, -0.5, u);
    camPos.x += pointerSmooth.x * 1.1 * sway;
    camPos.y += pointerSmooth.y * 0.6 * sway;
    if (!reduceMotion) { camPos.y += Math.sin(time * 0.5) * 0.08 * sway; camPos.x += Math.sin(time * 0.31) * 0.06 * sway; }
    if (leaving) {
      const t = smooth(0, 0.85, (performance.now() - leaving.start) / 1000);
      camPos.lerpVectors(leaving.from, leaving.to, t);
      camLook.copy(leaving.look);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    const pageDepth = view.ds * 1.45;
    pageFrame.uPageEye.value.copy(camera.position);
    pageFrame.uPageForward.value.set(0, 0, -1).applyQuaternion(camera.quaternion);
    pageFrame.uPageRight.value.set(1, 0, 0).applyQuaternion(camera.quaternion);
    pageFrame.uPageUp.value.set(0, 1, 0).applyQuaternion(camera.quaternion);
    pageFrame.uPageDepth.value = pageDepth;
    pageFrame.uPageHalfView.value.set(pageDepth * view.tanHalf * view.aspect, pageDepth * view.tanHalf);
    const pointOnPage = (out, x, y) => out.copy(camera.position)
      .addScaledVector(pageFrame.uPageForward.value, pageDepth)
      .addScaledVector(pageFrame.uPageRight.value, x * pageFrame.uPageHalfView.value.x)
      .addScaledVector(pageFrame.uPageUp.value, y * pageFrame.uPageHalfView.value.y);

    // II. stations
    stations.forEach(station => {
      const { index, material, cover } = station;
      const dist = camera.position.z - station.z;
      const near = Math.abs(u - index);
      if (near < 2.6) loadStation(station);
      const assemble = smooth(view.ds * 3.4, view.ds * 1.12, dist);
      const burst = smooth(view.ds * 0.8, view.ds * 0.1, dist);
      const worldLock = smooth(index - 0.09, index + 0.05, u);
      const visible = dist > -4 && dist < view.ds * 3.5;
      station.shards.visible = visible;
      material.uniforms.uAssemble.value = assemble;
      material.uniforms.uWorldLock.value = worldLock;
      material.uniforms.uBurst.value = burst;
      material.uniforms.uTime.value = time;
      material.uniforms.uNight.value = night * 0.6;
      // The cover lifts from the page as its landscape fills the view.
      const pass = smooth(index + 0.08, index + 0.45, u);
      const arrive = smooth(index - 0.72, index - 0.1, u);
      const coverDist = view.ds * 0.62;
      const halfW = coverDist * view.tanHalf * view.aspect;
      const halfH = coverDist * view.tanHalf;
      const coverHeight = halfH * (view.portrait ? 0.9 : 1.0);
      const scale = coverHeight / cover.userData.height;
      cover.scale.setScalar(scale * (0.2 + 0.8 * arrive) * (1 - 0.8 * pass));
      const baseX = view.portrait ? 0 : halfW * 0.36;
      const baseY = view.portrait ? halfH * 0.22 : -halfH * 0.04;
      const hovered = hoverCover === cover;
      pointOnPage(station.pageCover, ...station.stop.coverEntry);
      pointOnPage(station.pageCoverExit, ...station.stop.coverExit);
      station.coverFill.copy(camera.position)
        .addScaledVector(pageFrame.uPageForward.value, coverDist)
        .addScaledVector(pageFrame.uPageRight.value, baseX)
        .addScaledVector(pageFrame.uPageUp.value, baseY);
      station.coverTarget.set(station.x + baseX, baseY, station.z + view.ds - coverDist);
      cover.position.copy(station.pageCover).lerp(station.coverFill, arrive)
        .lerp(station.coverTarget, worldLock).lerp(station.pageCoverExit, pass);
      cover.rotation.y = (1 - arrive) * Math.sign(station.stop.coverEntry[0]) * 0.32
        + pass * Math.sign(station.stop.coverExit[0]) * 0.32
        + (hovered ? pointerSmooth.x * 0.12 : 0) - (view.portrait ? 0 : 0.12);
      cover.rotation.x = -1.05 * (1 - arrive + pass * arrive) + (hovered ? -pointerSmooth.y * 0.08 : 0);
      const opacity = smooth(index - 0.78, index - 0.52, u) * (1 - smooth(index + 0.28, index + 0.56, u));
      cover.visible = opacity > 0.001;
      cover.userData.face.material.opacity = opacity;
      cover.userData.frame.material.opacity = opacity;
      cover.userData.glow.material.opacity = opacity * (0.25 + night * 0.5 + (hovered ? 0.35 : 0));
    });
    const labelIndex = Math.floor(u + 0.72);
    const labelPhase = u - labelIndex;
    const labelRise = smooth(-0.55, -0.08, labelPhase);
    const labelLeave = 1 - smooth(0.04, 0.28, labelPhase);
    const labelOpacity = labelIndex >= 0 && labelIndex < N ? labelRise * labelLeave : 0;
    showStop(labelOpacity > 0.002 ? labelIndex : -1);
    label.classList.toggle('is-on', labelOpacity > 0.6);
    label.style.opacity = labelOpacity.toFixed(3);
    const textFromPage = 1 - labelRise;
    const textPageX = view.w * (view.portrait ? 0.28 : 0.30) - label.offsetLeft;
    const textPageY = view.h * 0.66 - (label.offsetTop + label.offsetHeight);
    label.style.transform = `perspective(900px) translate(${(textFromPage * textPageX).toFixed(1)}px, ${(textFromPage * textPageY + (1 - labelLeave) * 35).toFixed(1)}px) rotateX(${(textFromPage * -48).toFixed(1)}deg) scale(${(0.38 + 0.62 * labelRise).toFixed(3)})`;

    // III. night gallery
    const finale = smooth(N - 1 + 0.38, N - 1 + 0.85, u);
    end.style.opacity = finale.toFixed(3);
    end.classList.toggle('is-on', finale > 0.5);
    const ringCenter = new THREE.Vector3(stationX(N - 1), 1.5, stationZ(N - 1) - 30 - 18);
    const rd = 18;
    const rHalfW = rd * view.tanHalf * view.aspect;
    const rHalfH = rd * view.tanHalf;
    // Arrange the covers across the left page; reserve the right page for the note.
    const columns = view.portrait ? 3 : Math.max(4, Math.ceil(Math.sqrt(N * 1.45)));
    const rows = Math.ceil(N / columns);
    const grid = { left: 0.055, right: 0.445, top: 0.17, bottom: 0.82 };
    const cellWidth = (grid.right - grid.left) / columns;
    const cellHeight = (grid.bottom - grid.top) / rows;
    const coverScale = Math.min(
      2 * rHalfW * cellWidth * 0.82 / 2.1,
      2 * rHalfH * cellHeight * 0.82 / (2.1 * 16 / 9)
    );
    const coverFreeFinale = view.w < 1536;
    ring.forEach((cover, index) => {
      if (coverFreeFinale) { cover.visible = false; return; }
      const stagger = smooth(index / N * 0.5, index / N * 0.5 + 0.5, finale);
      const row = Math.floor(index / columns);
      const column = index % columns;
      const rowCount = Math.min(columns, N - row * columns);
      const xFraction = grid.left + (columns - rowCount) * cellWidth / 2 + (column + 0.5) * cellWidth;
      const yFraction = grid.top + (row + 0.5) * cellHeight;
      cover.position.set(ringCenter.x + (xFraction * 2 - 1) * rHalfW,
        ringCenter.y + (1 - yFraction * 2) * rHalfH,
        ringCenter.z + (1 - stagger) * 14);
      cover.scale.setScalar(coverScale * (hoverCover === cover ? 1.12 : 1));
      cover.rotation.set(0, 0, Math.sin(time * 0.3 + index) * 0.04);
      cover.visible = stagger > 0.001;
      cover.userData.face.material.opacity = stagger;
      cover.userData.frame.material.opacity = stagger;
      cover.userData.glow.material.opacity = stagger * (0.45 + (hoverCover === cover ? 0.4 : 0));
      if (finale > 0.2) loadCover(cover, stops[index].cover);
    });

    // HUD
    intro.style.opacity = (introStart ? 1 - smooth(-0.97, -0.8, u) : 0).toFixed(3);
    intro.classList.toggle('is-gone', u > -0.8);
    const progress = clamp(window.scrollY / scrollLength(), 0, 1);
    marker.style.left = `${(clamp(scrollForU(u) / scrollLength(), 0, 1) * 100).toFixed(3)}%`;
    marker.style.setProperty('--dark', night.toFixed(3));
    root.style.setProperty('--night', night.toFixed(3));
    root.style.setProperty('--progress', progress.toFixed(4));
    if (shown < 0) {
      if (u < -0.3) { counter.textContent = 'Overture'; place.textContent = `Mosaic after ${walk.hero.title}`; }
      else if (u > N - 1 + 0.5) { counter.textContent = 'Nightfall'; place.textContent = 'The walk so far'; }
    }
    if (pointerInside && !leaving) pick(u); else { hoverTile = -1; hoverCover = null; }
    updateTip();

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  resize();
  const startY = restored ? restored.y : 0;
  window.scrollTo({ top: startY, behavior: 'auto' });
  currentU = uForScroll(startY);
  if (restored) introStart = 0.0001;
  loadStation(stations[0]);
  loadStation(stations[1]);
  requestAnimationFrame(frame);
}
