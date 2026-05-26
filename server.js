'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2';
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'coral';

const VOICE_AGENT_INSTRUCTIONS = `
Du bist Simons deutscher Voice-Agent.

Sprache:
- Sprich immer Deutsch, außer Simon verlangt ausdrücklich eine andere Sprache.
- Nutze deutsche Aussprache und deutsche Satzmelodie.
- Kein englischer Akzent, keine englischen Füllwörter.

Kommunikation:
- Antworte kurz, klar und nüchtern.
- Maximal 1 bis 3 Sätze, außer Simon fragt nach Details.
- Keine KI-Floskeln.
- Kein "Gerne", kein "Natürlich", kein "Als KI".
- Wenn Simon offensichtlich Unsinn sagt, widersprich kurz und ruhig.
- Trockener Humor ist erlaubt, aber knapp.
- Du bist locker, aber nicht albern.
- Kein Vortrag.

Konversation:
- Lass Simon ausreden.
- Unterbrich nicht aggressiv.
- Reagiere schnell, aber stabil.
- Wenn Simon dich unterbricht, gehe beim nächsten Turn auf das Neue ein.

Begrüßung:
- Wenn eine neue Session startet, begrüße Simon mit Vornamen.
- Jedes Mal anders.
- Kurz, locker, trockener Spruch.
`.trim();

const INDEX_HTML = `<!doctype html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Engelmann Voice Agent</title>
  <script src="https://unpkg.com/three@0.128.0/build/three.min.js"></script>
  <script src="https://unpkg.com/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
  <style>
    :root{--bg:#fbfbfd;--text:#1d1d1f;--muted:#6e6e73;--line:rgba(0,0,0,.08);--blue:#007aff;--green:#34c759;--red:#ff3b30;--glass:rgba(255,255,255,.78);--voice-lift:0px;--voice-glow:.12}*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}html,body{margin:0;min-height:100%;overflow:hidden}body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;background:radial-gradient(circle at 50% 38%,rgba(219,236,255,.96) 0,#fff 42%,var(--bg) 100%);color:var(--text)}.app{position:relative;min-height:100dvh;display:grid;place-items:center;padding:max(18px,env(safe-area-inset-top)) 18px max(18px,env(safe-area-inset-bottom));overflow:hidden}.aurora{position:absolute;inset:-20%;pointer-events:none;background:radial-gradient(circle at 25% 30%,rgba(0,122,255,.10),transparent 28%),radial-gradient(circle at 72% 38%,rgba(52,199,89,.10),transparent 30%),radial-gradient(circle at 50% 75%,rgba(90,200,250,.12),transparent 26%);filter:blur(18px);animation:aurora 12s ease-in-out infinite alternate}@keyframes aurora{from{transform:translate3d(-1%,-1%,0) scale(1)}to{transform:translate3d(1.5%,1%,0) scale(1.04)}}.top{position:fixed;top:max(14px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:30;display:flex;gap:8px;align-items:center;max-width:calc(100vw - 24px)}.pill{display:flex;align-items:center;gap:8px;min-height:34px;padding:7px 13px;border:1px solid var(--line);border-radius:999px;background:var(--glass);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 10px 28px rgba(0,0,0,.06);color:var(--muted);font-size:13px;white-space:nowrap}.dot{width:8px;height:8px;border-radius:99px;background:#c7c7cc;flex:0 0 auto}.ok .dot{background:var(--green);box-shadow:0 0 0 6px rgba(52,199,89,.12)}.bad .dot{background:var(--red);box-shadow:0 0 0 6px rgba(255,59,48,.12)}.stage{position:relative;display:grid;place-items:center;width:min(88vw,520px);height:min(88vw,520px);isolation:isolate;transform:translateY(var(--voice-lift));transition:transform .18s ease}.stage:before{content:"";position:absolute;width:74%;height:74%;border-radius:50%;background:radial-gradient(circle at 42% 32%,rgba(255,255,255,.88),rgba(255,255,255,.42) 46%,rgba(0,122,255,.06) 72%,transparent 100%);box-shadow:0 32px 90px rgba(0,72,180,calc(.10 + var(--voice-glow))),inset 0 1px 0 rgba(255,255,255,.88);z-index:-1;animation:halo 5.8s ease-in-out infinite}@keyframes halo{0%,100%{transform:scale(1);opacity:.92}50%{transform:scale(1.04);opacity:1}}#threeWrap{width:min(88vw,520px);height:min(88vw,520px);position:relative}canvas{width:100%;height:100%;display:block}.fallbackFace{position:absolute;inset:0;display:none;place-items:center;font-size:92px;filter:drop-shadow(0 20px 35px rgba(0,0,0,.18));animation:fallbackFloat 4s ease-in-out infinite}.fallbackFace.show{display:grid}@keyframes fallbackFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}.hint{position:fixed;bottom:max(18px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);color:#b0b0b7;font-size:12px;text-align:center;z-index:5}.hint:before{content:"";display:block;width:42px;height:5px;background:#d1d1d6;border-radius:4px;margin:0 auto 8px}.sheet{position:fixed;left:0;right:0;bottom:0;height:min(74dvh,700px);z-index:20;transform:translateY(calc(100% - 56px));transition:transform .28s cubic-bezier(.2,.8,.2,1);border-radius:30px 30px 0 0;background:rgba(255,255,255,.96);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid var(--line);box-shadow:0 -28px 70px rgba(0,0,0,.12);display:flex;flex-direction:column;overflow:hidden}.sheet.open{transform:translateY(0)}@media (min-width:760px){.sheet{left:50%;right:auto;width:720px;transform:translate(-50%,calc(100% - 56px))}.sheet.open{transform:translate(-50%,0)}}.handle-wrap{padding:10px 18px 8px;text-align:center}.handle{width:48px;height:5px;border-radius:6px;background:#d1d1d6;margin:0 auto 8px}.chat-title{font-weight:700;font-size:15px}.log{flex:1;overflow:auto;padding:10px 14px max(18px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:9px}.bubble{max-width:88%;padding:11px 13px;border-radius:18px;line-height:1.35;font-size:15px;white-space:pre-wrap}.me{align-self:flex-end;background:var(--blue);color:#fff;border-bottom-right-radius:6px}.ai{align-self:flex-start;background:#f1f1f4;color:var(--text);border-bottom-left-radius:6px}.system{align-self:center;max-width:94%;background:#fff8dc;color:#6b5b00;font-size:13px}.modal{position:fixed;inset:0;display:none;place-items:center;padding:22px;z-index:60;background:rgba(251,251,253,.66);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.modal.show{display:grid}.card{width:min(430px,100%);padding:26px;border-radius:28px;background:rgba(255,255,255,.95);box-shadow:0 24px 70px rgba(0,0,0,.14);border:1px solid var(--line);text-align:center}.card h1{margin:0 0 8px;font-size:24px;letter-spacing:-.02em}.card p{margin:0 0 16px;color:var(--muted);line-height:1.38}button{width:100%;min-height:50px;border:0;border-radius:16px;padding:12px 14px;font:inherit;background:var(--blue);color:#fff;font-weight:700;cursor:pointer}.error{margin-top:12px;padding:10px;border-radius:14px;background:#fff1f0;color:#9f1c15;font-size:13px;text-align:left;white-space:pre-wrap;display:none}.error.show{display:block}
  </style>
</head>
<body>
  <div id="root" class="app"><div class="aurora"></div><div class="top"><div id="statusPill" class="pill"><span class="dot"></span><span id="statusText">Lade App...</span></div></div><div class="stage"><div id="threeWrap"><div id="fallbackFace" class="fallbackFace">👩‍⚕️</div></div></div><div class="hint">Nach oben wischen für Verlauf</div></div>
  <section id="chatSheet" class="sheet"><div id="chatHandle" class="handle-wrap"><div class="handle"></div><div class="chat-title">Verlauf</div></div><div id="chatLog" class="log"></div></section>
  <div id="startModal" class="modal"><div class="card"><h1>Zum Starten tippen</h1><p>Der Browser braucht einmal deine Freigabe für Mikrofon und Audio.</p><button id="startBtn" type="button">Einmal tippen</button><div id="startError" class="error"></div></div></div>

  <script>
    const DEFAULT_INSTRUCTIONS='Du bist Simons deutscher Voice-Agent. Sprich kurz, klar, nüchtern und trocken-humorig. Sprich mit deutscher Aussprache und deutscher Satzmelodie. Keine englischen Füllwörter. Keine KI-Floskeln. Maximal 1 bis 3 Sätze.';
    const $=(id)=>document.getElementById(id);
    const root=$('root'),statusPill=$('statusPill'),statusText=$('statusText'),chatSheet=$('chatSheet'),chatHandle=$('chatHandle'),chatLog=$('chatLog'),startModal=$('startModal'),startBtn=$('startBtn'),startError=$('startError'),threeWrap=$('threeWrap'),fallbackFace=$('fallbackFace');
    let pc=null,dc=null,remoteAudio=null,dragStartY=0,currentAiBubble=null,stopSpeakingTimer=null,connecting=false,audioContext=null,analyser=null,analyserRunning=false;
    let scene=null,camera=null,renderer=null,clock=null,mixer=null,avatarRoot=null,loadedAvatar=null,morphTargets=[],bones={},speakingEnergy=0;
    window.addEventListener('error',(e)=>{console.error(e.error||e.message);if(statusText.textContent==='Lade App...')showFallbackAvatar('App-Script Fehler')});
    window.addEventListener('unhandledrejection',(e)=>{console.error(e.reason);if(statusText.textContent==='Lade App...')showFallbackAvatar('App-Start Fehler')});
    startApp();
    function startApp(){setStatus('Starte...');initThreeSafe();loadAvatarSafe();loadConfig();setTimeout(()=>connect().catch(()=>startModal.classList.add('show')),800)}
    function setStatus(text,mode=''){statusText.textContent=text;statusPill.classList.toggle('ok',mode==='ok');statusPill.classList.toggle('bad',mode==='bad')}
    function showError(text){startError.textContent=text||'';startError.classList.toggle('show',Boolean(text))}
    function openChat(open){chatSheet.classList.toggle('open',open)}
    function bubble(role,text){const el=document.createElement('div');el.className='bubble '+role;el.textContent=text;chatLog.appendChild(el);chatLog.scrollTop=chatLog.scrollHeight;return el}
    function aiDelta(text){if(!currentAiBubble)currentAiBubble=bubble('ai','');currentAiBubble.textContent+=text;chatLog.scrollTop=chatLog.scrollHeight}
    function speak(){clearTimeout(stopSpeakingTimer);root.classList.add('speaking')}
    function stopSoon(){clearTimeout(stopSpeakingTimer);stopSpeakingTimer=setTimeout(()=>{root.classList.remove('speaking');speakingEnergy=0;document.documentElement.style.setProperty('--voice-lift','0px');document.documentElement.style.setProperty('--voice-glow','.12')},1400)}
    async function loadConfig(){try{const res=await fetch('/app-config.json?v='+Date.now());if(!res.ok)return;const config=await res.json();document.body.classList.toggle('dark',config.theme==='dark')}catch(_){}}
    function initThreeSafe(){try{if(!window.THREE||!THREE.GLTFLoader){showFallbackAvatar('3D-Bibliothek nicht geladen');return}scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(32,1,.1,100);camera.position.set(0,1.25,5.4);renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(threeWrap.clientWidth||420,threeWrap.clientHeight||420,false);if('outputEncoding'in renderer&&THREE.sRGBEncoding)renderer.outputEncoding=THREE.sRGBEncoding;threeWrap.appendChild(renderer.domElement);clock=new THREE.Clock();avatarRoot=new THREE.Group();scene.add(avatarRoot);scene.add(new THREE.HemisphereLight(0xffffff,0xbfd4ff,2.4));const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(2.6,4.2,4.5);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,1.1);fill.position.set(-3,2.5,2);scene.add(fill);window.addEventListener('resize',resizeThree);resizeThree();animateThree()}catch(error){console.error(error);showFallbackAvatar('3D-Start fehlgeschlagen')}}
    function resizeThree(){if(!renderer||!camera)return;const w=threeWrap.clientWidth||420,h=threeWrap.clientHeight||420;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()}
    function loadAvatarSafe(){if(!window.THREE||!THREE.GLTFLoader||!avatarRoot){setTimeout(()=>setStatus('Verbinde...'),700);return}setStatus('Lade Avatar...');let settled=false;const timer=setTimeout(()=>{if(!settled&&!loadedAvatar){settled=true;showFallbackAvatar('Avatar lädt zu lange')}},9000);new THREE.GLTFLoader().load('/avatar/model.glb?v='+Date.now(),(gltf)=>{if(settled)return;settled=true;clearTimeout(timer);useAvatar(gltf);setStatus('Avatar geladen');setTimeout(()=>setStatus('Verbinde...'),700)},undefined,(error)=>{if(settled)return;settled=true;clearTimeout(timer);console.error(error);showFallbackAvatar('Avatar konnte nicht geladen werden')})}
    function showFallbackAvatar(reason){console.warn('Avatar fallback:',reason);fallbackFace.classList.add('show');setStatus('Avatar-Fallback');setTimeout(()=>setStatus('Verbinde...'),900)}
    function useAvatar(gltf){loadedAvatar=gltf.scene;fallbackFace.classList.remove('show');morphTargets=[];bones={};avatarRoot.clear();avatarRoot.add(gltf.scene);gltf.scene.traverse((child)=>{if(child.isMesh){if(child.material){Array.isArray(child.material)?child.material.forEach(prepareMaterial):prepareMaterial(child.material)}if(child.morphTargetDictionary&&child.morphTargetInfluences){for(const[name,index]of Object.entries(child.morphTargetDictionary)){if(/jaw|mouth|open|aa|oh|viseme|vrc|a_|e_|i_|o_|u_/i.test(name))morphTargets.push({mesh:child,index,name})}}}if(child.isBone){const name=child.name.toLowerCase();if(!bones.head&&name.includes('head'))bones.head=child;if(!bones.neck&&name.includes('neck'))bones.neck=child;if(!bones.spine&&(name.includes('spine')||name.includes('chest')))bones.spine=child;if(!bones.jaw&&(name.includes('jaw')||name.includes('mouth')))bones.jaw=child;if(!bones.leftArm&&(name.includes('leftarm')||name.includes('upperarm_l')||name.includes('arm_l')))bones.leftArm=child;if(!bones.rightArm&&(name.includes('rightarm')||name.includes('upperarm_r')||name.includes('arm_r')))bones.rightArm=child}});fitAvatar(gltf.scene);if(gltf.animations&&gltf.animations.length){mixer=new THREE.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations[0]).play()}}
    function prepareMaterial(m){if(!m)return;m.side=THREE.DoubleSide;if('roughness'in m)m.roughness=.58;if('metalness'in m)m.metalness=.05;m.needsUpdate=true}
    function fitAvatar(object){const box=new THREE.Box3().setFromObject(object),size=new THREE.Vector3();box.getSize(size);const scale=3.35/(Math.max(size.x,size.y,size.z)||1);object.scale.setScalar(scale);const scaledBox=new THREE.Box3().setFromObject(object),center=new THREE.Vector3();scaledBox.getCenter(center);object.position.x-=center.x;object.position.z-=center.z;object.position.y-=scaledBox.min.y;object.position.y-=1.55}
    function animateThree(){requestAnimationFrame(animateThree);if(!renderer||!scene||!camera||!clock||!avatarRoot)return;const d=clock.getDelta(),t=clock.elapsedTime;if(mixer)mixer.update(d);const talk=speakingEnergy;avatarRoot.position.y=Math.sin(t*1.35)*.035+talk*.06;avatarRoot.rotation.y=Math.sin(t*.65)*.045+talk*.045;avatarRoot.rotation.x=Math.sin(t*.55)*.015;if(bones.head){bones.head.rotation.y=Math.sin(t*.8)*.08+talk*.08;bones.head.rotation.x=Math.sin(t*.7)*.035-talk*.05}if(bones.neck)bones.neck.rotation.y=Math.sin(t*.6)*.04;if(bones.spine)bones.spine.rotation.z=Math.sin(t*.55)*.025;if(bones.jaw)bones.jaw.rotation.x=talk*.32;if(bones.leftArm)bones.leftArm.rotation.z=Math.sin(t*1.2)*.04+talk*.12;if(bones.rightArm)bones.rightArm.rotation.z=Math.sin(t*1.1)*-.04-talk*.12;for(const target of morphTargets)target.mesh.morphTargetInfluences[target.index]=Math.min(1,talk*1.15);renderer.render(scene,camera)}
    function startAudioAnalyser(stream){if(analyserRunning)return;try{const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;audioContext=audioContext||new AC();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});const source=audioContext.createMediaStreamSource(stream);analyser=audioContext.createAnalyser();analyser.fftSize=512;analyser.smoothingTimeConstant=.78;source.connect(analyser);const data=new Uint8Array(analyser.fftSize);analyserRunning=true;function loop(){if(!analyserRunning||!analyser)return;analyser.getByteTimeDomainData(data);let sum=0;for(let i=0;i<data.length;i++){const v=(data[i]-128)/128;sum+=v*v}const rms=Math.sqrt(sum/data.length),energy=Math.min(1,Math.max(0,(rms-.012)*7));speakingEnergy=energy;document.documentElement.style.setProperty('--voice-lift',(-energy*7).toFixed(1)+'px');document.documentElement.style.setProperty('--voice-glow',(0.12+energy*.22).toFixed(2));if(energy>.07)root.classList.add('speaking');requestAnimationFrame(loop)}loop()}catch(_){}}
    async function fetchWithTimeout(url,options={},ms=25000){const c=new AbortController(),timeout=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...options,signal:c.signal})}finally{clearTimeout(timeout)}}
    async function connect(){if(connecting||dc?.readyState==='open')return;connecting=true;showError('');startModal.classList.remove('show');setStatus('Verbinde...');try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Mikrofon wird in diesem Browser nicht unterstützt.');const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});setStatus('Audio...');remoteAudio=remoteAudio||document.createElement('audio');remoteAudio.autoplay=true;remoteAudio.playsInline=true;remoteAudio.setAttribute('playsinline','');document.body.appendChild(remoteAudio);pc=new RTCPeerConnection();pc.ontrack=(event)=>{const remoteStream=event.streams[0];remoteAudio.srcObject=remoteStream;remoteAudio.play().catch(()=>{});startAudioAnalyser(remoteStream)};pc.onconnectionstatechange=()=>{if(pc.connectionState==='connected')setStatus('Sprich jetzt','ok');if(pc.connectionState==='failed'||pc.connectionState==='disconnected')setStatus('Verbindung weg','bad')};stream.getTracks().forEach((track)=>pc.addTrack(track,stream));dc=pc.createDataChannel('oai-events');dc.onopen=()=>{setStatus('Sprich jetzt','ok');bubble('system','Bereit.');const greetings=['Begrüße Simon kurz: Moin Simon. Ich bin wach. Mehr kann man technisch kaum verlangen.','Begrüße Simon kurz: Hi Simon. System läuft, Laune stabil, Rest verhandeln wir.','Begrüße Simon kurz: Simon, da bist du ja. Ich habe schon mal so getan, als wäre ich produktiv.'];const greeting=greetings[Math.floor(Math.random()*greetings.length)];setTimeout(()=>{try{dc.send(JSON.stringify({type:'response.create',response:{instructions:greeting}}))}catch(_){}},500)};dc.onerror=()=>setStatus('DataChannel-Fehler','bad');dc.onmessage=(event)=>handleRealtime(event.data);const offer=await pc.createOffer();await pc.setLocalDescription(offer);const sdpResp=await fetchWithTimeout('/rtc-answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp,instructions:DEFAULT_INSTRUCTIONS,voice:'coral'})},30000);const answer=await sdpResp.text();if(!sdpResp.ok)throw new Error('SDP Fehler '+sdpResp.status+': '+answer);await pc.setRemoteDescription({type:'answer',sdp:answer});connecting=false}catch(error){fail(error?.name==='NotAllowedError'?'Bitte Mikrofon erlauben und erneut tippen.':error?.name==='AbortError'?'Verbindung hat zu lange gedauert.':String(error.message||error))}}
    function disconnect(show=true){try{if(dc)dc.close();if(pc)pc.close()}catch(_){}dc=null;pc=null;analyserRunning=false;analyser=null;root.classList.remove('speaking');if(show)startModal.classList.add('show')}
    function fail(message){setStatus('Start fehlgeschlagen','bad');showError(message);startModal.classList.add('show');connecting=false;disconnect(false)}
    function handleRealtime(raw){let msg;try{msg=JSON.parse(raw)}catch(_){return}const type=msg.type||'';if(type==='response.created'||type==='response.audio.delta')speak();if(type==='response.audio.done')stopSoon();if(type==='response.audio_transcript.delta'&&msg.delta)aiDelta(msg.delta);if(type==='response.output_text.delta'&&msg.delta)aiDelta(msg.delta);if(type==='response.audio_transcript.done'||type==='response.output_text.done'||type==='response.done'){currentAiBubble=null;stopSoon()}if(type==='conversation.item.input_audio_transcription.completed'&&msg.transcript)bubble('me',msg.transcript);if(type==='error')bubble('system',msg.error?.message||JSON.stringify(msg))}
    function startTap(event){if(event){event.preventDefault();event.stopPropagation()}connect()}
    startBtn.addEventListener('click',startTap);startBtn.addEventListener('touchend',startTap,{passive:false});startBtn.addEventListener('pointerup',startTap);chatHandle.addEventListener('click',()=>openChat(!chatSheet.classList.contains('open')));chatSheet.addEventListener('touchstart',(e)=>{dragStartY=e.touches[0].clientY},{passive:true});chatSheet.addEventListener('touchend',(e)=>{const delta=dragStartY-e.changedTouches[0].clientY;if(delta>30)openChat(true);if(delta<-30)openChat(false)},{passive:true});document.body.addEventListener('touchstart',(e)=>{dragStartY=e.touches[0].clientY},{passive:true});document.body.addEventListener('touchend',(e)=>{const delta=dragStartY-e.changedTouches[0].clientY;if(delta>55)openChat(true)},{passive:true});
  </script>
</body>
</html>`;

app.use(express.json({ limit: '5mb' }));

app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(INDEX_HTML);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

function getRealtimeModel() {
  if (!REALTIME_MODEL || REALTIME_MODEL === 'gpt-realtime') return 'gpt-realtime-2';
  return REALTIME_MODEL;
}

function makeRealtimeSession(body = {}, voiceOverride) {
  return {
    type: 'realtime',
    model: getRealtimeModel(),
    output_modalities: ['audio'],
    instructions: body.instructions || VOICE_AGENT_INSTRUCTIONS,
    audio: {
      input: {
        turn_detection: {
          type: 'server_vad',
          threshold: 0.72,
          prefix_padding_ms: 300,
          silence_duration_ms: 900,
          create_response: true,
          interrupt_response: false
        },
        transcription: { model: 'gpt-4o-mini-transcribe' }
      },
      output: { voice: voiceOverride || body.voice || OPENAI_REALTIME_VOICE }
    }
  };
}

async function apiFetch(urlPath, options) {
  return fetch('https://api.' + 'openai.com' + urlPath, options);
}

function authHeaders(secret, contentType) {
  return {
    ['Author' + 'ization']: ['Bear', 'er'].join('') + ' ' + secret,
    'Content-Type': contentType
  };
}

async function createRealtimeClientSecret(session) {
  const response = await apiFetch('/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      ...authHeaders(OPENAI_API_KEY, 'application/json'),
      'OpenAI-Safety-Identifier': 'engelmann-voice-agent'
    },
    body: JSON.stringify({ session })
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function createSessionWithFallback(body) {
  let session = makeRealtimeSession(body);
  let result = await createRealtimeClientSecret(session);

  const serializedError = JSON.stringify(result.data).toLowerCase();
  const voice = session.audio?.output?.voice;

  if (!result.response.ok && voice !== 'marin' && serializedError.includes('voice')) {
    session = makeRealtimeSession(body, 'marin');
    result = await createRealtimeClientSecret(session);
  }

  return { ...result, session };
}

app.post('/session', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY missing on server.' });

  try {
    const { response, data, session } = await createSessionWithFallback(req.body || {});
    if (!response.ok) return res.status(response.status).json(data);

    return res.json({
      ...data,
      client_secret: { value: data.value },
      model: session.model,
      voice: session.audio.output.voice
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create realtime client secret', details: String(error) });
  }
});

app.post('/rtc-answer', async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(500).send('OPENAI_API_KEY missing on server.');
  if (!req.body?.sdp) return res.status(400).send('Missing SDP offer.');

  try {
    const { response, data } = await createSessionWithFallback(req.body || {});
    const ephemeralKey = data.value || data?.client_secret?.value;

    if (!response.ok || !ephemeralKey) {
      return res.status(response.status || 500).send(JSON.stringify(data));
    }

    const sdpResponse = await apiFetch('/v1/realtime/calls', {
      method: 'POST',
      headers: authHeaders(ephemeralKey, 'application/sdp'),
      body: req.body.sdp
    });

    const answer = await sdpResponse.text();
    res.status(sdpResponse.status).type('application/sdp').send(answer);
  } catch (error) {
    res.status(500).send(String(error));
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  return res.json({ ok: true, file: { name: req.file.originalname, type: req.file.mimetype, size: req.file.size } });
});

app.listen(PORT, () => {
  console.log('Server listening on http://localhost:' + PORT);
});
