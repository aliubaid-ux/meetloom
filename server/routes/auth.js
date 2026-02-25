const express = require('express');
const router = express.Router();
const { getAuthUrl, getTokensAndClient } = require('../services/youtubeService');

// GET /auth/google
// Triggers the OAuth flow. Used right before user clicks upload or auto-triggered if they need tokens
router.get('/google', (req, res) => {
    const url = getAuthUrl();
    res.redirect(url);
});

// GET /auth/google/callback
// Callback from Google OAuth flow
router.get('/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) {
        return res.status(400).send('Authorization code missing');
    }

    try {
        const { tokens } = await getTokensAndClient(code);
        // Store tokens in session. WARNING: these are tied to the session ID. 
        // If session goes away, the user needs to re-authenticate.
        req.session.googleTokens = tokens;

        // Since we are likely triggering this from the room, ideally it should close the popup or redirect back.
        // Returning a small HTML snippet that posts message to opener and closes itself is a common pattern.
        res.send(`
            <script>
                if (window.opener) {
                    window.opener.postMessage('oauth-success', '*');
                    window.close();
                } else {
                    window.location.href = '/';
                }
            </script>
        `);
    } catch (error) {
        console.error('OAuth Callback Error:', error);
        res.status(500).send('Authentication failed');
    }
});

// GET /auth/status
// Check if the current session has valid Google tokens
router.get('/status', (req, res) => {
    if (req.session && req.session.googleTokens) {
        res.json({ authenticated: true });
    } else {
        res.json({ authenticated: false });
    }
});

module.exports = router;
