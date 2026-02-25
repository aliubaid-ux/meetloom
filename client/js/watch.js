// ─── Watch Page Logic ──────────────────────────────────────
const videoContainer = document.getElementById('video-container');
const videoSkeleton = document.getElementById('video-skeleton');
const transcriptContainer = document.getElementById('transcript-container');
const transcriptLoading = document.getElementById('transcript-loading');
const btnDownloadTxt = document.getElementById('btn-download-txt');
const btnCopyLink = document.getElementById('btn-copy-link');
const btnCopyTranscript = document.getElementById('btn-copy-transcript');
const btnRefresh = document.getElementById('btn-refresh-transcript');
const youtubeLink = document.getElementById('youtube-link');

let cachedTranscript = '';

// ─── Embed YouTube Video ───────────────────────────────────
if (window.VIDEO_ID) {
    // Set YouTube external link
    youtubeLink.href = `https://www.youtube.com/watch?v=${window.VIDEO_ID}`;

    // Embed iframe
    videoContainer.innerHTML = `
        <iframe 
            width="100%" 
            height="100%" 
            src="https://www.youtube.com/embed/${window.VIDEO_ID}?rel=0&autoplay=1&modestbranding=1" 
            title="Recording Playback" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen
            style="border-radius: 1rem;">
        </iframe>
    `;

    // Fetch transcript
    fetchTranscript();
}

// ─── Fetch Transcript ──────────────────────────────────────
async function fetchTranscript() {
    try {
        const res = await fetch(`/api/transcript/${window.VIDEO_ID}`);
        const data = await res.json();

        if (data.success && data.transcript) {
            cachedTranscript = data.transcript;
            renderTranscript(cachedTranscript);
        } else {
            console.log('Transcript not ready:', data.error);
        }
    } catch (err) {
        console.error('Transcript fetch failed:', err);
    }
}

// ─── Render VTT to clean paragraphs ───────────────────────
function renderTranscript(text) {
    const lines = text.split('\n');
    let html = '';
    let buffer = '';
    let timeLabel = '';

    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed === 'WEBVTT') return;

        if (trimmed.includes('-->')) {
            // Flush previous buffer
            if (buffer) {
                html += createTranscriptBlock(timeLabel, buffer);
                buffer = '';
            }
            timeLabel = trimmed.split('-->')[0].trim();
        } else if (!trimmed.match(/^\d+$/)) {
            // Skip sequence numbers, collect text
            buffer += trimmed + ' ';
        }
    });
    // Flush last buffer
    if (buffer) {
        html += createTranscriptBlock(timeLabel, buffer);
    }

    if (html.length < 10) {
        html = `<div class="text-center text-slate-500 mt-10 italic">Transcript is empty or still processing.</div>`;
    }

    // Hide loading, show transcript
    if (transcriptLoading) transcriptLoading.classList.add('hidden');
    transcriptContainer.innerHTML += html;
}

function createTranscriptBlock(time, text) {
    const shortTime = time ? time.split('.')[0] : '';
    return `
        <div class="p-3 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 transition-all border border-transparent hover:border-white/5 cursor-default group">
            ${shortTime ? `<span class="text-[10px] text-blue-400 font-mono font-semibold group-hover:text-blue-300">${shortTime}</span>` : ''}
            <p class="text-slate-300 mt-1">${text.trim()}</p>
        </div>
    `;
}

// ─── Refresh Transcript ────────────────────────────────────
if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
        btnRefresh.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Checking...';
        fetchTranscript().finally(() => {
            btnRefresh.innerHTML = '<i class="fa-solid fa-arrows-rotate mr-1"></i> Check Again';
        });
    });
}

// ─── Download Transcript ───────────────────────────────────
btnDownloadTxt.addEventListener('click', () => {
    if (!cachedTranscript) return alert('No transcript available to download yet.');
    const blob = new Blob([cachedTranscript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${window.VIDEO_ID}.txt`;
    a.click();
    URL.revokeObjectURL(url);
});

// ─── Copy Transcript ──────────────────────────────────────
btnCopyTranscript.addEventListener('click', () => {
    if (!cachedTranscript) return alert('No transcript available yet.');
    navigator.clipboard.writeText(cachedTranscript);
    btnCopyTranscript.innerHTML = '<i class="fa-solid fa-check text-green-400 text-sm"></i>';
    setTimeout(() => { btnCopyTranscript.innerHTML = '<i class="fa-regular fa-clipboard text-sm"></i>'; }, 2000);
});

// ─── Copy Page Link ────────────────────────────────────────
btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    btnCopyLink.innerHTML = '<i class="fa-solid fa-check mr-1"></i> Copied!';
    setTimeout(() => { btnCopyLink.innerHTML = '<i class="fa-regular fa-copy mr-1"></i> Copy Link'; }, 2000);
});
