const express = require('express');
const router = express.Router();
const path = require('path');

// ─── Human-readable Room ID generator ─────────────────────
const adjectives = ['brave', 'calm', 'cool', 'eager', 'fair', 'glad', 'happy', 'keen', 'kind', 'neat', 'proud', 'quick', 'sharp', 'smart', 'warm', 'bold', 'bright', 'swift', 'vivid', 'witty'];
const colors = ['amber', 'aqua', 'azure', 'coral', 'crimson', 'cyan', 'gold', 'green', 'ivory', 'jade', 'lime', 'mint', 'navy', 'olive', 'pearl', 'plum', 'rose', 'ruby', 'sage', 'teal'];
const animals = ['bear', 'crow', 'deer', 'dove', 'eagle', 'fox', 'hawk', 'hare', 'lion', 'lynx', 'orca', 'owl', 'puma', 'raven', 'robin', 'seal', 'swan', 'tiger', 'wolf', 'wren'];

function generateRoomId() {
    const a = adjectives[Math.floor(Math.random() * adjectives.length)];
    const c = colors[Math.floor(Math.random() * colors.length)];
    const n = animals[Math.floor(Math.random() * animals.length)];
    return `${a}-${c}-${n}`;
}

// ─── Page Routes ──────────────────────────────────────────

// Landing Page
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/pages/index.html'));
});

// Creates a room with a random readable ID
router.get('/create-room', (req, res) => {
    const roomId = generateRoomId();
    const record = req.query.record === 'true' ? '?record=true' : '';
    res.redirect(`/join/${roomId}${record}`);
});

// Join with custom room name (POST from homepage form)
router.post('/join-custom', (req, res) => {
    let customName = (req.body.roomName || '').trim().toLowerCase();
    // Sanitize: only allow a-z, 0-9, hyphens
    customName = customName.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!customName || customName.length < 2) {
        customName = generateRoomId();
    }
    if (customName.length > 40) {
        customName = customName.substring(0, 40);
    }
    res.redirect(`/join/${customName}`);
});

// Pre-Join Preview (see yourself before entering the room)
router.get('/join/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/pages/prejoin.html'));
});

// Meeting Room
router.get('/room/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/pages/room.html'));
});

// Watch Page
router.get('/watch/:id', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/pages/watch.html'));
});

// My Recordings Page
router.get('/recordings', (req, res) => {
    res.sendFile(path.join(__dirname, '../../client/pages/recordings.html'));
});

module.exports = router;
