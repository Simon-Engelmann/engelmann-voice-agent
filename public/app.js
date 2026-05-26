const DEFAULT_INSTRUCTIONS = 'Du bist Simons deutscher Voice-Agent. Sprich kurz, klar, nüchtern und trocken-humorig. Sprich mit deutscher Aussprache und deutscher Satzmelodie. Keine englischen Füllwörter. Keine KI-Floskeln. Maximal 1 bis 3 Sätze.';

const $ = (id) => document.getElementById(id);
const root = $('root');
const statusPill = $('statusPill');
const statusText = $('statusText');
const chatSheet = $('chatSheet');
const chatHandle = $('chatHandle');
const chatLog = $('chatLog');
const startModal = $('startModal');
const startBtn = $('startBtn');
const startError = $('startError');
const threeWrap = $('threeWrap');
const fallbackFace = $('fallbackFace');

let pc = null;
let dc = null;
let remoteAudio = null;
let dragStartY = 0;
let currentAiBubble = null;
let stopSpeakingTimer = null;
let connecting = false;
let audioContext = null;
let analyser = null;
let analyserRunning = false;

let scene = null;
let camera = null;
let renderer = null;
let clock = null;
let mixer = null;
let avatarRoot = null;
let loadedAvatar = null;
let morphTargets = [];
let bones = {};
let namedParts = [];
let mouthMesh = null;
let shadowMouthMesh = null;
let eyeMeshes = [];
let speakingEnergy = 0;
let targetEnergy = 0;
let blink = 0;
let nextBlinkAt = 1.5;

window.addEventListener('error', (event) => {
  console.error(event.error || event.message);
  if (statusText.textContent === 'Lade App...') showFallbackAvatar('App-Script Fehler');
});

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  if (statusText.textContent === 'Lade App...') showFallbackAvatar('App-Start Fehler');
});

startApp();

function startApp() {
  setStatus('Starte...');
  initThreeSafe();
  loadAvatarSafe();
  loadConfig();
  setTimeout(() => connect().catch(() => startModal.classList.add('show')), 800);
}

function setStatus(text, mode = '') {
  statusText.textContent = text;
  statusPill.classList.toggle('ok', mode === 'ok');
  statusPill.classList.toggle('bad', mode === 'bad');
}

function showError(text) {
  startError.textContent = text || '';
  startError.classList.toggle('show', Boolean(text));
}

function openChat(open) {
  chatSheet.classList.toggle('open', open);
}

function bubble(role, text) {
  const el = document.createElement('div');
  el.className = 'bubble ' + role;
  el.textContent = text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

function aiDelta(text) {
  if (!currentAiBubble) currentAiBubble = bubble('ai', '');
  currentAiBubble.textContent += text;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function speak() {
  clearTimeout(stopSpeakingTimer);
  root.classList.add('speaking');
}

function stopSoon() {
  clearTimeout(stopSpeakingTimer);
  stopSpeakingTimer = setTimeout(() => {
    root.classList.remove('speaking');
    targetEnergy = 0;
    document.documentElement.style.setProperty('--voice-lift', '0px');
    document.documentElement.style.setProperty('--voice-glow', '.12');
  }, 1400);
}

async function loadConfig() {
  try {
    const res = await fetch('/app-config.json?v=' + Date.now());
    if (!res.ok) return;
    const config = await res.json();
    document.body.classList.toggle('dark', config.theme === 'dark');
  } catch (_) {}
}

function initThreeSafe() {
  try {
    if (!window.THREE || !THREE.GLTFLoader) {
      showFallbackAvatar('3D-Bibliothek nicht geladen');
      return;
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 1.15, 4.9);

    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.setSize(threeWrap.clientWidth || 420, threeWrap.clientHeight || 420, false);
    if ('outputEncoding' in renderer && THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    threeWrap.appendChild(renderer.domElement);

    clock = new THREE.Clock();
    avatarRoot = new THREE.Group();
    scene.add(avatarRoot);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xbfd4ff, 2.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(2.6, 4.2, 4.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 1.25);
    fill.position.set(-3, 2.5, 2);
    scene.add(fill);

    window.addEventListener('resize', resizeThree);
    resizeThree();
    animateThree();
  } catch (error) {
    console.error(error);
    showFallbackAvatar('3D-Start fehlgeschlagen');
  }
}

function resizeThree() {
  if (!renderer || !camera) return;
  const w = threeWrap.clientWidth || 420;
  const h = threeWrap.clientHeight || 420;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function loadAvatarSafe() {
  if (!window.THREE || !THREE.GLTFLoader || !avatarRoot) {
    setTimeout(() => setStatus('Verbinde...'), 700);
    return;
  }

  setStatus('Lade Avatar...');
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled && !loadedAvatar) {
      settled = true;
      showFallbackAvatar('Avatar lädt zu lange');
    }
  }, 9000);

  new THREE.GLTFLoader().load(
    '/avatar/model.glb?v=' + Date.now(),
    (gltf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      useAvatar(gltf);
      setStatus('Avatar geladen');
      setTimeout(() => setStatus('Verbinde...'), 700);
    },
    undefined,
    (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      console.error(error);
      showFallbackAvatar('Avatar konnte nicht geladen werden');
    }
  );
}

function showFallbackAvatar(reason) {
  console.warn('Avatar fallback:', reason);
  fallbackFace.classList.add('show');
  setStatus('Avatar-Fallback');
  setTimeout(() => setStatus('Verbinde...'), 900);
}

function useAvatar(gltf) {
  loadedAvatar = gltf.scene;
  fallbackFace.classList.remove('show');
  morphTargets = [];
  bones = {};
  namedParts = [];
  eyeMeshes = [];
  mouthMesh = null;
  shadowMouthMesh = null;

  avatarRoot.clear();
  avatarRoot.add(gltf.scene);

  gltf.scene.traverse((child) => {
    const name = String(child.name || '').toLowerCase();

    if (child.isMesh) {
      namedParts.push(child);
      if (child.material) {
        Array.isArray(child.material) ? child.material.forEach(prepareMaterial) : prepareMaterial(child.material);
      }

      if (/eye|lash|brow/i.test(name)) eyeMeshes.push(child);

      if (child.morphTargetDictionary && child.morphTargetInfluences) {
        for (const [targetName, index] of Object.entries(child.morphTargetDictionary)) {
          if (/jaw|mouth|open|aa|oh|viseme|vrc|a_|e_|i_|o_|u_/i.test(targetName)) morphTargets.push({ mesh: child, index, name: targetName });
        }
      }
    }

    if (child.isBone) {
      if (!bones.head && name.includes('head')) bones.head = child;
      if (!bones.neck && name.includes('neck')) bones.neck = child;
      if (!bones.spine && (name.includes('spine') || name.includes('chest'))) bones.spine = child;
      if (!bones.jaw && (name.includes('jaw') || name.includes('mouth'))) bones.jaw = child;
      if (!bones.leftArm && (name.includes('leftarm') || name.includes('upperarm_l') || name.includes('arm_l'))) bones.leftArm = child;
      if (!bones.rightArm && (name.includes('rightarm') || name.includes('upperarm_r') || name.includes('arm_r'))) bones.rightArm = child;
      if (!bones.leftHand && (name.includes('lefthand') || name.includes('hand_l'))) bones.leftHand = child;
      if (!bones.rightHand && (name.includes('righthand') || name.includes('hand_r'))) bones.rightHand = child;
    }
  });

  fitAvatar(gltf.scene);
  createSyntheticMouth();

  if (gltf.animations && gltf.animations.length) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]).play();
  }
}

function prepareMaterial(material) {
  if (!material) return;
  material.side = THREE.DoubleSide;
  if ('roughness' in material) material.roughness = 0.58;
  if ('metalness' in material) material.metalness = 0.05;
  material.needsUpdate = true;
}

function fitAvatar(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const scale = 3.95 / (Math.max(size.x, size.y, size.z) || 1);
  object.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= scaledBox.min.y;
  object.position.y -= 1.75;
}

function createSyntheticMouth() {
  if (!avatarRoot) return;

  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x6b1d24, transparent: true, opacity: 0.62, depthTest: true, depthWrite: false });
  mouthMesh = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 12), mouthMat);
  mouthMesh.name = 'synthetic_audio_mouth';
  mouthMesh.position.set(0, 1.52, 0.36);
  mouthMesh.scale.set(1.25, 0.16, 0.18);
  avatarRoot.add(mouthMesh);

  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x321014, transparent: true, opacity: 0.28, depthTest: true, depthWrite: false });
  shadowMouthMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135, 24, 12), shadowMat);
  shadowMouthMesh.name = 'synthetic_audio_mouth_shadow';
  shadowMouthMesh.position.set(0, 1.515, 0.355);
  shadowMouthMesh.scale.set(1.0, 0.10, 0.10);
  avatarRoot.add(shadowMouthMesh);
}

function animateThree() {
  requestAnimationFrame(animateThree);
  if (!renderer || !scene || !camera || !clock || !avatarRoot) return;

  const delta = clock.getDelta();
  const t = clock.elapsedTime;
  if (mixer) mixer.update(delta);

  speakingEnergy += (targetEnergy - speakingEnergy) * 0.30;
  const talk = speakingEnergy;
  const isTalking = talk > 0.035;

  if (t > nextBlinkAt) {
    blink = 1;
    nextBlinkAt = t + 2.2 + Math.random() * 3.5;
  }
  blink = Math.max(0, blink - delta * 6.2);

  avatarRoot.position.y = Math.sin(t * 1.25) * 0.028 + talk * 0.06;
  avatarRoot.rotation.y = Math.sin(t * 0.62) * 0.045 + talk * 0.035;
  avatarRoot.rotation.x = Math.sin(t * 0.50) * 0.010;

  if (bones.head) {
    bones.head.rotation.y = Math.sin(t * 0.8) * 0.08 + talk * 0.10;
    bones.head.rotation.x = Math.sin(t * 0.7) * 0.035 - talk * 0.055;
  }
  if (bones.neck) bones.neck.rotation.y = Math.sin(t * 0.6) * 0.035;
  if (bones.spine) bones.spine.rotation.z = Math.sin(t * 0.55) * 0.020;
  if (bones.jaw) bones.jaw.rotation.x = talk * 0.36;
  if (bones.leftArm) bones.leftArm.rotation.z = Math.sin(t * 1.2) * 0.035 + talk * 0.16;
  if (bones.rightArm) bones.rightArm.rotation.z = Math.sin(t * 1.1) * -0.035 - talk * 0.16;
  if (bones.leftHand) bones.leftHand.rotation.x = Math.sin(t * 3.2) * 0.03 + talk * 0.08;
  if (bones.rightHand) bones.rightHand.rotation.x = Math.sin(t * 3.0) * -0.03 - talk * 0.08;

  for (const target of morphTargets) {
    target.mesh.morphTargetInfluences[target.index] = Math.min(1, talk * 1.25);
  }

  if (mouthMesh) {
    mouthMesh.visible = true;
    mouthMesh.scale.x = 1.18 + talk * 0.22 + Math.sin(t * 23) * talk * 0.06;
    mouthMesh.scale.y = 0.12 + talk * 1.28;
    mouthMesh.scale.z = 0.12 + talk * 0.32;
    mouthMesh.position.y = 1.515 - talk * 0.025;
  }

  if (shadowMouthMesh) {
    shadowMouthMesh.scale.x = 1.05 + talk * 0.18;
    shadowMouthMesh.scale.y = 0.08 + talk * 0.90;
  }

  if (eyeMeshes.length) {
    const blinkScale = Math.max(0.10, 1 - blink * 0.88);
    eyeMeshes.forEach((mesh) => {
      mesh.scale.y = blinkScale;
    });
  }

  document.documentElement.style.setProperty('--voice-lift', (-talk * 7).toFixed(1) + 'px');
  document.documentElement.style.setProperty('--voice-glow', (0.12 + talk * 0.22).toFixed(2));

  renderer.render(scene, camera);
}

function startAudioAnalyser(stream) {
  if (analyserRunning) return;

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    audioContext = audioContext || new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.68;
    source.connect(analyser);

    const data = new Uint8Array(analyser.fftSize);
    analyserRunning = true;

    function loop() {
      if (!analyserRunning || !analyser) return;

      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }

      const rms = Math.sqrt(sum / data.length);
      const energy = Math.min(1, Math.max(0, (rms - 0.009) * 9.5));
      targetEnergy = energy;

      if (energy > 0.035) root.classList.add('speaking');
      requestAnimationFrame(loop);
    }

    loop();
  } catch (_) {}
}

async function fetchWithTimeout(url, options = {}, ms = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function connect() {
  if (connecting || dc?.readyState === 'open') return;
  connecting = true;
  showError('');
  startModal.classList.remove('show');
  setStatus('Verbinde...');

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon wird in diesem Browser nicht unterstützt.');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    setStatus('Audio...');

    remoteAudio = remoteAudio || document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.playsInline = true;
    remoteAudio.setAttribute('playsinline', '');
    document.body.appendChild(remoteAudio);

    pc = new RTCPeerConnection();

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      remoteAudio.srcObject = remoteStream;
      remoteAudio.play().catch(() => {});
      startAudioAnalyser(remoteStream);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setStatus('Sprich jetzt', 'ok');
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') setStatus('Verbindung weg', 'bad');
    };

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    dc = pc.createDataChannel('oai-events');
    dc.onopen = () => {
      setStatus('Sprich jetzt', 'ok');
      bubble('system', 'Bereit.');

      const greetings = [
        'Begrüße Simon kurz: Moin Simon. Ich bin wach. Mehr kann man technisch kaum verlangen.',
        'Begrüße Simon kurz: Hi Simon. System läuft, Laune stabil, Rest verhandeln wir.',
        'Begrüße Simon kurz: Simon, da bist du ja. Ich habe schon mal so getan, als wäre ich produktiv.'
      ];

      const greeting = greetings[Math.floor(Math.random() * greetings.length)];
      setTimeout(() => {
        try { dc.send(JSON.stringify({ type: 'response.create', response: { instructions: greeting } })); } catch (_) {}
      }, 500);
    };

    dc.onerror = () => setStatus('DataChannel-Fehler', 'bad');
    dc.onmessage = (event) => handleRealtime(event.data);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResp = await fetchWithTimeout('/rtc-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp, instructions: DEFAULT_INSTRUCTIONS, voice: 'coral' })
    }, 30000);

    const answer = await sdpResp.text();
    if (!sdpResp.ok) throw new Error('SDP Fehler ' + sdpResp.status + ': ' + answer);

    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    connecting = false;
  } catch (error) {
    fail(error?.name === 'NotAllowedError' ? 'Bitte Mikrofon erlauben und erneut tippen.' : error?.name === 'AbortError' ? 'Verbindung hat zu lange gedauert.' : String(error.message || error));
  }
}

function disconnect(show = true) {
  try { if (dc) dc.close(); if (pc) pc.close(); } catch (_) {}
  dc = null;
  pc = null;
  analyserRunning = false;
  analyser = null;
  root.classList.remove('speaking');
  if (show) startModal.classList.add('show');
}

function fail(message) {
  setStatus('Start fehlgeschlagen', 'bad');
  showError(message);
  startModal.classList.add('show');
  connecting = false;
  disconnect(false);
}

function handleRealtime(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }
  const type = msg.type || '';

  if (type === 'response.created' || type === 'response.audio.delta') speak();
  if (type === 'response.audio.done') stopSoon();
  if (type === 'response.audio_transcript.delta' && msg.delta) aiDelta(msg.delta);
  if (type === 'response.output_text.delta' && msg.delta) aiDelta(msg.delta);
  if (type === 'response.audio_transcript.done' || type === 'response.output_text.done' || type === 'response.done') {
    currentAiBubble = null;
    stopSoon();
  }
  if (type === 'conversation.item.input_audio_transcription.completed' && msg.transcript) bubble('me', msg.transcript);
  if (type === 'error') bubble('system', msg.error?.message || JSON.stringify(msg));
}

function startTap(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  connect();
}

startBtn.addEventListener('click', startTap);
startBtn.addEventListener('touchend', startTap, { passive: false });
startBtn.addEventListener('pointerup', startTap);
chatHandle.addEventListener('click', () => openChat(!chatSheet.classList.contains('open')));
chatSheet.addEventListener('touchstart', (event) => { dragStartY = event.touches[0].clientY; }, { passive: true });
chatSheet.addEventListener('touchend', (event) => {
  const delta = dragStartY - event.changedTouches[0].clientY;
  if (delta > 30) openChat(true);
  if (delta < -30) openChat(false);
}, { passive: true });
document.body.addEventListener('touchstart', (event) => { dragStartY = event.touches[0].clientY; }, { passive: true });
document.body.addEventListener('touchend', (event) => {
  const delta = dragStartY - event.changedTouches[0].clientY;
  if (delta > 55) openChat(true);
}, { passive: true });
