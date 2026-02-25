// ─── Recording Module ──────────────────────────────────────
// Handles: MediaRecorder, PiP webcam overlay via Canvas, upload

let mediaRecorder;
let recordedChunks = [];
let recordingStream;
let recordingTimerInterval;
let secondsRecorded = 0;
let pipCanvas, pipCtx, pipAnimFrame;

const MAX_RECORDING_TIME = 15 * 60; // 15 minutes

const btnRecordStart = document.getElementById('btn-record-start');
const btnRecordStop = document.getElementById('btn-record-stop');
const recordingIndicator = document.getElementById('recording-indicator');
const timerDisplay = document.getElementById('recording-timer');
const uploadOverlay = document.getElementById('upload-overlay');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressBar = document.getElementById('upload-progress-bar');

// Auto-record mode from URL
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('record') === 'true') {
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(() => checkOAuthOrPrompt(), 1500); // Give webcam time to load
}

// ─── OAuth Check ───────────────────────────────────────────
async function checkOAuthOrPrompt() {
    try {
        const res = await fetch('/auth/status');
        const data = await res.json();
        if (data.authenticated) {
            startRecordingProcess();
        } else {
            openOAuthPopup();
        }
    } catch (e) {
        console.error('Auth check failed:', e);
    }
}

function openOAuthPopup() {
    const w = 500, h = 600;
    const left = (screen.width / 2) - (w / 2);
    const top = (screen.height / 2) - (h / 2);
    window.open('/auth/google', 'Google OAuth', `width=${w},height=${h},top=${top},left=${left}`);
}

window.addEventListener('message', e => { if (e.data === 'oauth-success') startRecordingProcess(); });
btnRecordStart.addEventListener('click', () => checkOAuthOrPrompt());

// ─── Start Recording with PiP Canvas Compositing ──────────
async function startRecordingProcess() {
    try {
        // 1. Capture screen
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const displayTrack = displayStream.getVideoTracks()[0];

        // 2. Get webcam stream for PiP overlay
        const webcamStream = window.myStream || await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        const webcamTrack = webcamStream.getVideoTracks()[0];

        // 3. Create PiP canvas compositing (screen + webcam bubble overlay)
        pipCanvas = document.createElement('canvas');
        pipCanvas.width = 1920;
        pipCanvas.height = 1080;
        pipCtx = pipCanvas.getContext('2d');

        const screenVideo = document.createElement('video');
        screenVideo.srcObject = new MediaStream([displayTrack]);
        screenVideo.muted = true;
        screenVideo.play();

        const webcamVideo = document.createElement('video');
        webcamVideo.srcObject = new MediaStream([webcamTrack]);
        webcamVideo.muted = true;
        webcamVideo.play();

        // Composite loop: draw screen full + webcam as PiP circle in bottom-right
        function drawFrame() {
            pipCtx.drawImage(screenVideo, 0, 0, pipCanvas.width, pipCanvas.height);

            // PiP webcam bubble (bottom-right, circular)
            const pipSize = 180;
            const margin = 30;
            const x = pipCanvas.width - pipSize - margin;
            const y = pipCanvas.height - pipSize - margin;

            pipCtx.save();
            pipCtx.beginPath();
            pipCtx.arc(x + pipSize / 2, y + pipSize / 2, pipSize / 2, 0, Math.PI * 2);
            pipCtx.closePath();
            pipCtx.clip();
            pipCtx.drawImage(webcamVideo, x, y, pipSize, pipSize);
            pipCtx.restore();

            // PiP border ring
            pipCtx.beginPath();
            pipCtx.arc(x + pipSize / 2, y + pipSize / 2, pipSize / 2, 0, Math.PI * 2);
            pipCtx.strokeStyle = '#3b82f6';
            pipCtx.lineWidth = 3;
            pipCtx.stroke();

            pipAnimFrame = requestAnimationFrame(drawFrame);
        }
        drawFrame();

        // 4. Capture canvas stream and add audio
        const canvasStream = pipCanvas.captureStream(30);
        const audioTracks = [
            ...(displayStream.getAudioTracks()),
            ...(webcamStream.getAudioTracks())
        ];
        audioTracks.forEach(t => canvasStream.addTrack(t));

        recordingStream = canvasStream;
        recordingStream._displayStream = displayStream; // store ref for cleanup

        // 5. Setup MediaRecorder
        const options = { mimeType: 'video/webm; codecs=vp9' };
        mediaRecorder = new MediaRecorder(recordingStream, options);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
        mediaRecorder.onstop = uploadRecording;

        // 6. UI updates
        btnRecordStart.classList.add('hidden');
        btnRecordStop.classList.remove('hidden');
        recordingIndicator.classList.remove('hidden');
        recordingIndicator.classList.add('flex');

        mediaRecorder.start(1000);
        startTimer();

        // Handle user stopping screen share from browser controls
        displayTrack.onended = () => stopRecordingProcess();

    } catch (err) {
        console.error('Recording error:', err);
        alert('Failed to start recording. Please grant permissions.');
    }
}

// ─── Stop Recording ────────────────────────────────────────
function stopRecordingProcess() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();

        // Cleanup PiP canvas
        if (pipAnimFrame) cancelAnimationFrame(pipAnimFrame);

        // Stop display stream tracks
        if (recordingStream._displayStream) {
            recordingStream._displayStream.getTracks().forEach(t => t.stop());
        }

        stopTimer();
        btnRecordStop.classList.add('hidden');
        recordingIndicator.classList.add('hidden');
    }
}

btnRecordStop.addEventListener('click', stopRecordingProcess);

// ─── Timer ─────────────────────────────────────────────────
function startTimer() {
    secondsRecorded = 0;
    recordingTimerInterval = setInterval(() => {
        secondsRecorded++;
        const m = Math.floor(secondsRecorded / 60).toString().padStart(2, '0');
        const s = (secondsRecorded % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${m}:${s}`;
        timerDisplay.classList.add('text-red-400');

        if (secondsRecorded >= MAX_RECORDING_TIME) {
            stopRecordingProcess();
            alert('Maximum recording time of 15 minutes reached.');
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(recordingTimerInterval);
    timerDisplay.classList.remove('text-red-400');
}

// ─── Upload ────────────────────────────────────────────────
async function uploadRecording() {
    uploadOverlay.classList.remove('hidden');
    uploadProgressContainer.classList.remove('hidden');
    uploadProgressContainer.classList.add('flex');
    uploadProgressBar.style.width = '15%';

    const blob = new Blob(recordedChunks, { type: 'video/webm' });

    if (blob.size > 500 * 1024 * 1024) {
        alert('Recording exceeds 500MB limit.');
        uploadOverlay.classList.add('hidden');
        btnRecordStart.classList.remove('hidden');
        recordedChunks = [];
        return;
    }

    const formData = new FormData();
    formData.append('video', blob, 'recording.webm');

    try {
        // Simulate progress
        setTimeout(() => uploadProgressBar.style.width = '50%', 800);
        setTimeout(() => uploadProgressBar.style.width = '75%', 2000);

        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json();

        uploadProgressBar.style.width = '100%';

        if (data.success && data.videoUrl) {
            // Save to localStorage for My Recordings page
            saveRecordingToHistory(data.videoId || data.videoUrl.split('/').pop(), secondsRecorded);
            setTimeout(() => { window.location.href = data.videoUrl; }, 800);
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (err) {
        console.error('Upload error:', err);
        alert('Upload failed: ' + err.message);
        uploadOverlay.classList.add('hidden');
        uploadProgressContainer.classList.add('hidden');
        btnRecordStart.classList.remove('hidden');
    } finally {
        recordedChunks = [];
    }
}

// ─── Save to Local History ─────────────────────────────────
function saveRecordingToHistory(videoId, durationSecs) {
    const recordings = JSON.parse(localStorage.getItem('quickmeet_recordings') || '[]');
    const m = Math.floor(durationSecs / 60).toString().padStart(2, '0');
    const s = (durationSecs % 60).toString().padStart(2, '0');
    recordings.push({
        videoId: videoId,
        title: 'MeetLoom Recording',
        date: new Date().toISOString(),
        duration: `${m}:${s}`,
        room: window.ROOM_ID || ''
    });
    // Keep max 50 recordings
    while (recordings.length > 50) recordings.shift();
    localStorage.setItem('quickmeet_recordings', JSON.stringify(recordings));
}
