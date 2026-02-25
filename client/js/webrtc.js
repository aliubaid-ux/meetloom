// ─── Socket & Peer Setup ──────────────────────────────────
const socket = io('/');
const videoGrid = document.getElementById('video-grid');
const videoSkeleton = document.getElementById('video-skeleton');
const myVideo = document.createElement('video');
myVideo.muted = true;

const myPeer = new Peer();
const peers = {};
let myStream;
let screenStream = null;
let isChatOpen = false;
let unreadMessages = 0;

// ─── Parse URL Params (from pre-join page) ─────────────────
const params = new URLSearchParams(window.location.search);
const MY_NAME = params.get('name') || 'Guest';
const initialMic = params.get('mic') !== 'false';
const initialCam = params.get('cam') !== 'false';
// Clean URL
window.history.replaceState({}, '', window.location.pathname + (params.get('record') === 'true' ? '?record=true' : ''));

// ─── DOM Elements ─────────────────────────────────────────
const btnMic = document.getElementById('btn-toggle-mic');
const btnCam = document.getElementById('btn-toggle-cam');
const btnScreenShare = document.getElementById('btn-screen-share');
const btnLeave = document.getElementById('btn-leave');
const btnCopy = document.getElementById('btn-copy-link');
const btnChat = document.getElementById('btn-toggle-chat');
const btnCloseChat = document.getElementById('btn-close-chat');
const btnSendChat = document.getElementById('btn-send-chat');
const chatPanel = document.getElementById('chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatBadge = document.getElementById('chat-badge');
const pCountEl = document.getElementById('p-count');
const shortcutToast = document.getElementById('shortcut-toast');
const btnSetPassword = document.getElementById('btn-set-password');
const reactionsContainer = document.getElementById('reactions-container');
const btnHandRaise = document.getElementById('btn-hand-raise');
const meetingTimerEl = document.getElementById('meeting-timer');

// ─── Meeting Duration Timer ────────────────────────────────
let meetingSeconds = 0;
setInterval(() => {
    meetingSeconds++;
    const h = Math.floor(meetingSeconds / 3600);
    const m = Math.floor((meetingSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (meetingSeconds % 60).toString().padStart(2, '0');
    if (meetingTimerEl) {
        meetingTimerEl.textContent = h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
    }
}, 1000);

// ─── Join/Leave Sound Effects ──────────────────────────────
function playJoinSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.1;
        osc.start(); osc.stop(ctx.currentTime + 0.15);
        setTimeout(() => {
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2); gain2.connect(ctx.destination);
            osc2.frequency.value = 1000;
            gain2.gain.value = 0.1;
            osc2.start(); osc2.stop(ctx.currentTime + 0.15);
        }, 150);
    } catch (e) { }
}
function playLeaveSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 600;
        gain.gain.value = 0.1;
        osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch (e) { }
}

// ─── Get User Media ────────────────────────────────────────
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        myStream = stream;
        window.myStream = stream;

        // Apply initial mic/cam state from pre-join
        if (!initialMic) { stream.getAudioTracks()[0].enabled = false; micOn = false; updateMicUI(); }
        if (!initialCam) { stream.getVideoTracks()[0].enabled = false; camOn = false; updateCamUI(); }

        if (videoSkeleton) videoSkeleton.remove();
        addVideoStream(myVideo, stream, MY_NAME, true);

        // Start mic speaking animation for main room
        startRoomMicCheck(stream);

        myPeer.on('call', call => {
            call.answer(stream);
            const video = document.createElement('video');
            call.on('stream', userVideoStream => addVideoStream(video, userVideoStream, call.metadata?.name || 'Peer'));
        });

        socket.on('user-connected', (userId, userName) => {
            playJoinSound();
            showToast(`${userName || 'Someone'} joined`);
            connectToNewUser(userId, stream, userName);
        });
    })
    .catch(err => {
        console.error('Camera/Mic Error:', err);
        if (videoSkeleton) videoSkeleton.innerHTML = `<div class="flex items-center justify-center h-full text-slate-500"><i class="fa-solid fa-video-slash text-3xl"></i></div>`;
    });

// ─── Room Audio Analyser (Speaking Indicator) ──────────────
let roomAudioCtx, roomAnalyser, roomMicSource, roomVolArray;
function startRoomMicCheck(stream) {
    try {
        if (!roomAudioCtx) roomAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (roomAudioCtx.state === 'suspended') roomAudioCtx.resume();
        roomAnalyser = roomAudioCtx.createAnalyser();
        roomAnalyser.smoothingTimeConstant = 0.5;
        roomAnalyser.fftSize = 256;
        roomMicSource = roomAudioCtx.createMediaStreamSource(stream);
        roomMicSource.connect(roomAnalyser);
        roomVolArray = new Uint8Array(roomAnalyser.frequencyBinCount);

        function measureRoomMic() {
            if (!micOn || !myStream) {
                btnMic.style.boxShadow = 'none';
                requestAnimationFrame(measureRoomMic);
                return;
            }
            roomAnalyser.getByteFrequencyData(roomVolArray);
            let sum = 0;
            for (let i = 0; i < roomVolArray.length; i++) sum += roomVolArray[i];
            let avg = sum / roomVolArray.length;

            if (avg > 10) {
                const glow = Math.min(avg / 2, 20);
                btnMic.style.boxShadow = `0 0 ${glow}px ${glow / 2}px rgba(59, 130, 246, 0.6)`;
            } else {
                btnMic.style.boxShadow = 'none';
            }
            requestAnimationFrame(measureRoomMic);
        }
        measureRoomMic();
    } catch (e) { console.warn('Room Audio check error', e); }
}

// ─── Socket Events ─────────────────────────────────────────
socket.on('user-disconnected', userId => {
    playLeaveSound();
    if (peers[userId]) peers[userId].close();
    // Remove their video wrapper
    const wrapper = document.getElementById(`video-${userId}`);
    if (wrapper) wrapper.remove();
});
socket.on('participant-count', count => { if (pCountEl) pCountEl.textContent = count; });

// Password-protected room: prompt user instead of rejecting immediately
socket.on('room-error', msg => {
    if (msg === 'Invalid room password') {
        const pwd = prompt('This room is password-protected. Enter the room password:');
        if (pwd) {
            // Retry join with the entered password
            myPeer.on('open', id => {
                socket.emit('join-room', window.ROOM_ID, id, pwd, MY_NAME);
            });
            // If peer is already open, emit immediately
            if (myPeer.id) {
                socket.emit('join-room', window.ROOM_ID, myPeer.id, pwd, MY_NAME);
            }
        } else {
            alert('Password required to join this room.');
            window.location.href = '/';
        }
    } else {
        alert(msg);
        window.location.href = '/';
    }
});

myPeer.on('open', id => {
    socket.emit('join-room', window.ROOM_ID, id, null, MY_NAME);
});

function connectToNewUser(userId, stream, userName) {
    const call = myPeer.call(userId, stream, { metadata: { name: MY_NAME } });
    const video = document.createElement('video');
    call.on('stream', userVideoStream => addVideoStream(video, userVideoStream, userName || 'Peer', false, userId));
    call.on('close', () => {
        const wrapper = document.getElementById(`video-${userId}`);
        if (wrapper) wrapper.remove();
    });
    peers[userId] = call;
}

// ─── Add Video with Name Label & Avatar ────────────────────
function addVideoStream(video, stream, name = 'Guest', isLocal = false, peerId = '') {
    video.srcObject = stream;
    video.addEventListener('loadedmetadata', () => video.play());

    // Create wrapper div
    const wrapper = document.createElement('div');
    wrapper.className = 'relative';
    wrapper.style.cssText = 'display:flex;align-items:center;justify-content:center;';
    if (peerId) wrapper.id = `video-${peerId}`;

    // Name label (like Google Meet)
    const label = document.createElement('div');
    label.className = 'absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm text-white text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-2 z-10';
    label.innerHTML = `${isLocal ? '<i class="fa-solid fa-user text-blue-400" style="font-size:9px"></i>' : ''} ${name}${isLocal ? ' (You)' : ''}`;

    // Avatar placeholder (shown when cam is off)
    const initial = name.charAt(0).toUpperCase();
    const colors = ['from-blue-500 to-purple-600', 'from-emerald-500 to-teal-600', 'from-orange-500 to-red-600', 'from-pink-500 to-rose-600', 'from-cyan-500 to-blue-600'];
    const colorClass = colors[name.length % colors.length];
    const avatar = document.createElement('div');
    avatar.className = `hidden absolute inset-0 bg-[#202124] rounded-2xl flex items-center justify-center z-5`;
    avatar.innerHTML = `<div class="w-20 h-20 rounded-full bg-gradient-to-br ${colorClass} flex items-center justify-center text-3xl font-bold text-white shadow-lg">${initial}</div>`;
    avatar.id = isLocal ? 'my-avatar' : '';

    wrapper.appendChild(video);
    wrapper.appendChild(label);
    wrapper.appendChild(avatar);
    videoGrid.append(wrapper);
}

// ─── Mic Toggle ────────────────────────────────────────────
let micOn = true;
btnMic.addEventListener('click', () => toggleMic());
function toggleMic() {
    if (!myStream) return;
    const track = myStream.getAudioTracks()[0];
    track.enabled = !track.enabled;
    micOn = track.enabled;
    updateMicUI();
    showToast(micOn ? 'Mic on' : 'Mic off');
}
function updateMicUI() {
    btnMic.innerHTML = micOn
        ? '<i class="fa-solid fa-microphone"></i>'
        : '<i class="fa-solid fa-microphone-slash text-red-400"></i>';
    btnMic.classList.toggle('!bg-red-500/20', !micOn);
}

// ─── Camera Toggle (with avatar show/hide) ─────────────────
let camOn = true;
btnCam.addEventListener('click', () => toggleCam());
function toggleCam() {
    if (!myStream) return;
    const track = myStream.getVideoTracks()[0];
    track.enabled = !track.enabled;
    camOn = track.enabled;
    updateCamUI();
    // Toggle avatar
    const avatar = document.getElementById('my-avatar');
    if (avatar) avatar.classList.toggle('hidden', camOn);
    showToast(camOn ? 'Camera on' : 'Camera off');
}
function updateCamUI() {
    btnCam.innerHTML = camOn
        ? '<i class="fa-solid fa-video"></i>'
        : '<i class="fa-solid fa-video-slash text-red-400"></i>';
    btnCam.classList.toggle('!bg-red-500/20', !camOn);
}

// ─── Screen Share ──────────────────────────────────────────
let isSharing = false;
btnScreenShare.addEventListener('click', async () => {
    if (isSharing) { stopScreenShare(); return; }
    try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        for (const userId in peers) {
            const sender = peers[userId].peerConnection?.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(screenTrack);
        }
        socket.emit('screen-share-started', window.ROOM_ID, myPeer.id);
        videoGrid.classList.add('has-screen-share');
        isSharing = true;
        btnScreenShare.classList.add('!bg-cyan-500/20', '!text-cyan-400');
        showToast('Screen sharing started');
        screenTrack.onended = () => stopScreenShare();
    } catch (e) { console.log('Screen share cancelled'); }
});

function stopScreenShare() {
    if (!isSharing) return;
    isSharing = false;
    const camTrack = myStream.getVideoTracks()[0];
    for (const userId in peers) {
        const sender = peers[userId].peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(camTrack);
    }
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    socket.emit('screen-share-stopped', window.ROOM_ID);
    videoGrid.classList.remove('has-screen-share');
    btnScreenShare.classList.remove('!bg-cyan-500/20', '!text-cyan-400');
    showToast('Screen sharing stopped');
}

socket.on('screen-share-started', () => videoGrid.classList.add('has-screen-share'));
socket.on('screen-share-stopped', () => videoGrid.classList.remove('has-screen-share'));

// ─── Chat ──────────────────────────────────────────────────
btnChat.addEventListener('click', () => toggleChat());
btnCloseChat.addEventListener('click', () => toggleChat());
function toggleChat() {
    isChatOpen = !isChatOpen;
    chatPanel.classList.toggle('open', isChatOpen);
    if (isChatOpen) { unreadMessages = 0; chatBadge.classList.add('hidden'); chatInput.focus(); }
}
btnSendChat.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });
function sendChatMessage() {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat-message', window.ROOM_ID, text);
    chatInput.value = '';
}
socket.on('chat-message', (msg) => {
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `<div class="sender">${msg.sender}</div><div class="text">${escapeHtml(msg.text)}</div><div class="time">${msg.timestamp}</div>`;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (!isChatOpen) { unreadMessages++; chatBadge.textContent = unreadMessages; chatBadge.classList.remove('hidden'); }
});
function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

// ─── Emoji Reactions ───────────────────────────────────────
document.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => socket.emit('reaction', window.ROOM_ID, btn.dataset.emoji));
});
socket.on('reaction', (data) => spawnReaction(data.emoji));
function spawnReaction(emoji) {
    const el = document.createElement('div');
    el.className = 'reaction-float';
    el.textContent = emoji;
    el.style.left = (20 + Math.random() * 60) + '%';
    reactionsContainer.appendChild(el);
    setTimeout(() => el.remove(), 2000);
}

// ─── Hand Raise ────────────────────────────────────────────
let handRaised = false;
if (btnHandRaise) {
    btnHandRaise.addEventListener('click', () => {
        handRaised = !handRaised;
        socket.emit('reaction', window.ROOM_ID, handRaised ? '✋' : '👇');
        btnHandRaise.classList.toggle('!bg-yellow-500/20', handRaised);
        btnHandRaise.classList.toggle('!text-yellow-400', handRaised);
        showToast(handRaised ? 'Hand raised ✋' : 'Hand lowered');
    });
}

// ─── Password Room ─────────────────────────────────────────
btnSetPassword.addEventListener('click', () => {
    const pw = prompt('Set a room password (blank to remove):');
    if (pw !== null) {
        socket.emit('set-room-password', window.ROOM_ID, pw || null);
        showToast(pw ? 'Password set!' : 'Password removed');
    }
});

// ─── Copy Link ─────────────────────────────────────────────
btnCopy.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.origin + '/join/' + window.ROOM_ID);
    btnCopy.innerHTML = '<i class="fa-solid fa-check text-green-400 text-sm"></i>';
    showToast('Invite link copied!');
    setTimeout(() => { btnCopy.innerHTML = '<i class="fa-regular fa-copy text-sm"></i>'; }, 2000);
});

// ─── Leave ─────────────────────────────────────────────────
btnLeave.addEventListener('click', () => { window.location.href = '/'; });

// ─── Keyboard Shortcuts ───────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key.toLowerCase()) {
        case 'm': toggleMic(); break;
        case 'v': toggleCam(); break;
        case 'c': toggleChat(); break;
        case 'n': toggleNotes(); break;
        case 's': btnScreenShare.click(); break;
        case 'h': if (btnHandRaise) btnHandRaise.click(); break;
        case 'escape': window.location.href = '/'; break;
    }
});

// ─── Toast ─────────────────────────────────────────────────
function showToast(text) {
    shortcutToast.textContent = text;
    shortcutToast.classList.remove('hidden');
    setTimeout(() => shortcutToast.classList.add('hidden'), 1500);
}

// ─── Video Zoom Control ────────────────────────────────────
document.querySelectorAll('.video-zoom-control button').forEach(btn => {
    btn.addEventListener('click', () => {
        const zoom = btn.dataset.zoom;
        videoGrid.classList.remove('zoom-contain', 'zoom-cover', 'zoom-fill');
        videoGrid.classList.add(`zoom-${zoom}`);
        document.querySelectorAll('.video-zoom-control button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Video: ${btn.title}`);
    });
});

// ─── Dynamic Grid Layout ──────────────────────────────────
function updateGridLayout() {
    const count = videoGrid.querySelectorAll('.relative').length;
    videoGrid.classList.remove('participants-3', 'participants-4', 'participants-many');
    if (count >= 5) videoGrid.classList.add('participants-many');
    else if (count === 4) videoGrid.classList.add('participants-4');
    else if (count === 3) videoGrid.classList.add('participants-3');
}
const gridObserver = new MutationObserver(updateGridLayout);
gridObserver.observe(videoGrid, { childList: true });

// ═══════════════════════════════════════════════════════════
// ─── MEETING NOTES (Collaborative via Socket.io) ──────────
// ═══════════════════════════════════════════════════════════
const notesPanel = document.getElementById('notes-panel');
const notesEditor = document.getElementById('notes-editor');
const btnToggleNotes = document.getElementById('btn-toggle-notes');
const btnCloseNotes = document.getElementById('btn-close-notes');
const btnDownloadNotes = document.getElementById('btn-download-notes');
let isNotesOpen = false;
let notesDebounce = null;

function toggleNotes() {
    isNotesOpen = !isNotesOpen;
    // Close chat if notes opens (share same panel style)
    if (isNotesOpen && isChatOpen) toggleChat();
    notesPanel.classList.toggle('open', isNotesOpen);
    if (isNotesOpen) notesEditor.focus();
}

btnToggleNotes.addEventListener('click', toggleNotes);
btnCloseNotes.addEventListener('click', toggleNotes);

// Broadcast notes changes with debounce
notesEditor.addEventListener('input', () => {
    clearTimeout(notesDebounce);
    notesDebounce = setTimeout(() => {
        socket.emit('notes-update', window.ROOM_ID, notesEditor.value);
    }, 300);
});

// Receive notes updates from other participants
socket.on('notes-update', (text) => {
    const cursor = notesEditor.selectionStart;
    notesEditor.value = text;
    notesEditor.selectionStart = notesEditor.selectionEnd = cursor;
});

// Download notes as .txt
btnDownloadNotes.addEventListener('click', () => {
    const blob = new Blob([notesEditor.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-notes-${window.ROOM_ID}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Notes downloaded!');
});

// ═══════════════════════════════════════════════════════════
// ─── NOISE SUPPRESSION (WebAudio Filters) ─────────────────
// ═══════════════════════════════════════════════════════════
const btnNoise = document.getElementById('btn-noise-suppress');
let noiseEnabled = false;
let audioCtx, sourceNode, highpassFilter, lowpassFilter, destNode;

btnNoise.addEventListener('click', () => {
    if (!myStream) return;
    noiseEnabled = !noiseEnabled;

    if (noiseEnabled) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            sourceNode = audioCtx.createMediaStreamSource(myStream);

            // Highpass: cut rumble below 85Hz
            highpassFilter = audioCtx.createBiquadFilter();
            highpassFilter.type = 'highpass';
            highpassFilter.frequency.value = 85;

            // Lowpass: cut hiss above 14kHz
            lowpassFilter = audioCtx.createBiquadFilter();
            lowpassFilter.type = 'lowpass';
            lowpassFilter.frequency.value = 14000;

            // Compressor: even out volume
            const compressor = audioCtx.createDynamicsCompressor();
            compressor.threshold.value = -50;
            compressor.knee.value = 40;
            compressor.ratio.value = 12;
            compressor.attack.value = 0;
            compressor.release.value = 0.25;

            destNode = audioCtx.createMediaStreamDestination();
            sourceNode.connect(highpassFilter);
            highpassFilter.connect(lowpassFilter);
            lowpassFilter.connect(compressor);
            compressor.connect(destNode);

            // Replace audio track in stream
            const cleanTrack = destNode.stream.getAudioTracks()[0];
            const originalTrack = myStream.getAudioTracks()[0];
            myStream.removeTrack(originalTrack);
            myStream.addTrack(cleanTrack);
        } catch (e) {
            console.error('Noise suppression error:', e);
            noiseEnabled = false;
        }
    } else {
        // Restore original audio (simplified: reload stream)
        if (audioCtx) audioCtx.close();
    }

    btnNoise.classList.toggle('!bg-green-500/20', noiseEnabled);
    btnNoise.classList.toggle('!text-green-400', noiseEnabled);
    showToast(noiseEnabled ? 'Noise suppression ON' : 'Noise suppression OFF');
});

// ═══════════════════════════════════════════════════════════
// ─── BACKGROUND BLUR (CSS Filter on local video) ──────────
// ═══════════════════════════════════════════════════════════
const btnBgBlur = document.getElementById('btn-bg-blur');
let blurEnabled = false;

btnBgBlur.addEventListener('click', () => {
    blurEnabled = !blurEnabled;

    // Apply CSS blur to local video element
    if (myVideo) {
        myVideo.style.filter = blurEnabled ? 'blur(4px) brightness(0.95)' : 'none';
        myVideo.style.transform = blurEnabled ? 'scale(1.1)' : 'none'; // Scale up to hide blur edges
    }

    btnBgBlur.classList.toggle('!bg-indigo-500/20', blurEnabled);
    btnBgBlur.classList.toggle('!text-indigo-400', blurEnabled);
    showToast(blurEnabled ? 'Background blur ON (preview)' : 'Background blur OFF');
});

// ═══════════════════════════════════════════════════════════
// ─── CUSTOM BRANDING (Logo upload, saved in localStorage) ─
// ═══════════════════════════════════════════════════════════
const brandName = document.getElementById('brand-name');
const brandLogo = document.getElementById('brand-logo');
const brandUpload = document.getElementById('brand-upload');

// Load saved branding
const savedLogo = localStorage.getItem('quickmeet_brand_logo');
if (savedLogo) {
    brandLogo.src = savedLogo;
    brandLogo.classList.remove('hidden');
    brandName.classList.add('hidden');
}

// Click to upload logo
brandName.addEventListener('click', () => brandUpload.click());
brandLogo.addEventListener('click', () => brandUpload.click());

brandUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        localStorage.setItem('quickmeet_brand_logo', dataUrl);
        brandLogo.src = dataUrl;
        brandLogo.classList.remove('hidden');
        brandName.classList.add('hidden');
        showToast('Custom logo set!');
    };
    reader.readAsDataURL(file);
});

// ─── Video Zoom Controls (Fit / Fill / Stretch) ────────────
document.querySelectorAll('.video-zoom-control button').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.zoom; // contain, cover, fill
        videoGrid.classList.remove('zoom-contain', 'zoom-cover', 'zoom-fill');
        videoGrid.classList.add(`zoom-${mode}`);
        document.querySelectorAll('.video-zoom-control button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        showToast(`Video: ${btn.textContent}`);
    });
});

// ─── Numeric Zoom (Scale Transform) ─────────────────────
let currentZoom = 100;
const zoomLevelEl = document.getElementById('zoom-level');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');

function applyZoom(pct) {
    currentZoom = Math.max(50, Math.min(200, pct));
    const scale = currentZoom / 100;
    videoGrid.style.transform = `scale(${scale})`;
    videoGrid.style.transformOrigin = 'center center';
    if (zoomLevelEl) zoomLevelEl.textContent = `${currentZoom}%`;
}

if (zoomInBtn) zoomInBtn.addEventListener('click', () => applyZoom(currentZoom + 10));
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => applyZoom(currentZoom - 10));

// Keyboard: Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 reset
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoom(currentZoom + 10); }
    if (e.ctrlKey && e.key === '-') { e.preventDefault(); applyZoom(currentZoom - 10); }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); applyZoom(100); }
});

// ─── Auto-Hide Bottom Toolbar ──────────────────────────────
const toolbar = document.querySelector('footer.fixed');
let toolbarTimer = null;
function showToolbar() {
    if (toolbar) {
        toolbar.style.opacity = '1';
        toolbar.style.pointerEvents = 'auto';
        toolbar.style.transform = 'translate(-50%, 0)';
    }
    clearTimeout(toolbarTimer);
    toolbarTimer = setTimeout(hideToolbar, 3500);
}
function hideToolbar() {
    // Don't hide if mouse is over toolbar
    if (toolbar && !toolbar.matches(':hover')) {
        toolbar.style.opacity = '0';
        toolbar.style.pointerEvents = 'none';
        toolbar.style.transform = 'translate(-50%, 20px)';
    }
}
// Set transition on toolbar
if (toolbar) {
    toolbar.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    toolbar.addEventListener('mouseenter', () => {
        clearTimeout(toolbarTimer);
        showToolbar();
    });
    toolbar.addEventListener('mouseleave', () => {
        toolbarTimer = setTimeout(hideToolbar, 2000);
    });
}
document.addEventListener('mousemove', showToolbar);
document.addEventListener('keydown', showToolbar);
// Initial show
showToolbar();
