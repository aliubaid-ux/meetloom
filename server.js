const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

// ─── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'super_secret_fallback_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Serve static assets from 'client'
app.use(express.static(path.join(__dirname, 'client')));

// ─── Routes ──────────────────────────────────────────────────
const apiRoutes = require('./server/routes/api');
const pageRoutes = require('./server/routes/pages');
const authRoutes = require('./server/routes/auth');

app.use('/api', apiRoutes);
app.use('/auth', authRoutes);
app.use('/', pageRoutes);

// ─── In-memory room store (passwords, viewer analytics) ─────
const rooms = {};
// rooms[roomId] = { password: null | string, viewers: {}, createdAt: Date }

// ─── Socket.io Signaling + Chat + Reactions ─────────────────
io.on('connection', (socket) => {

    // ── Room Join with optional password ──
    socket.on('join-room', (roomId, userId, password, userName) => {
        // Initialize room if needed
        if (!rooms[roomId]) {
            rooms[roomId] = { password: null, viewers: {}, createdAt: new Date() };
        }

        // Password check
        if (rooms[roomId].password && rooms[roomId].password !== password) {
            socket.emit('room-error', 'Invalid room password');
            return;
        }

        socket.join(roomId);
        socket.roomId = roomId;
        socket.peerId = userId;
        socket.userName = userName || 'Guest';

        // Track viewer for analytics
        rooms[roomId].viewers[userId] = { joinedAt: new Date(), name: userName || userId.substring(0, 6) };

        socket.to(roomId).emit('user-connected', userId, userName || 'Guest');

        // Send current participant count
        const participantCount = io.sockets.adapter.rooms.get(roomId)?.size || 0;
        io.to(roomId).emit('participant-count', participantCount);

        socket.on('disconnect', () => {
            socket.to(roomId).emit('user-disconnected', userId);
            if (rooms[roomId]) {
                delete rooms[roomId].viewers[userId];
            }
            const remaining = io.sockets.adapter.rooms.get(roomId)?.size || 0;
            io.to(roomId).emit('participant-count', remaining);
        });
    });

    // ── Set Room Password ──
    socket.on('set-room-password', (roomId, password) => {
        if (rooms[roomId]) {
            rooms[roomId].password = password;
            socket.emit('password-set', true);
        }
    });

    // ── Chat Messages ──
    socket.on('chat-message', (roomId, message) => {
        io.to(roomId).emit('chat-message', {
            id: Date.now(),
            sender: socket.userName || 'Guest',
            text: message,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    // ── Emoji Reactions ──
    socket.on('reaction', (roomId, emoji) => {
        io.to(roomId).emit('reaction', {
            sender: socket.userName || 'Guest',
            emoji: emoji
        });
    });

    // ── Screen Share signaling ──
    socket.on('screen-share-started', (roomId, peerId) => {
        socket.to(roomId).emit('screen-share-started', peerId);
    });

    socket.on('screen-share-stopped', (roomId) => {
        socket.to(roomId).emit('screen-share-stopped');
    });

    // ── Collaborative Meeting Notes ──
    socket.on('notes-update', (roomId, text) => {
        socket.to(roomId).emit('notes-update', text);
    });
});

// ─── Viewer Analytics endpoint ──────────────────────────────
app.get('/api/room/:id/analytics', (req, res) => {
    const room = rooms[req.params.id];
    if (!room) return res.json({ viewers: 0, details: [], exists: false });

    const ageMs = Date.now() - new Date(room.createdAt).getTime();
    const ttlMs = 24 * 60 * 60 * 1000; // 24 hours
    const remainingMs = Math.max(0, ttlMs - ageMs);
    const remainingHours = Math.round(remainingMs / (60 * 60 * 1000) * 10) / 10;

    res.json({
        exists: true,
        viewers: Object.keys(room.viewers).length,
        details: Object.values(room.viewers),
        createdAt: room.createdAt,
        expiresInHours: remainingHours,
        hasPassword: !!room.password
    });
});

// ─── Room Expiry: Clean up rooms older than 24 hours ────────
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const roomId in rooms) {
        const age = now - new Date(rooms[roomId].createdAt).getTime();
        if (age > ROOM_TTL_MS) {
            delete rooms[roomId];
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`🧹 Cleaned up ${cleaned} expired room(s)`);
}, 60 * 60 * 1000); // Check every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 QuickMeet running on http://localhost:${PORT}`));
