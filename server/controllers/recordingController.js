const fs = require('fs');
const youtubeService = require('../services/youtubeService');

// Handles POST /api/upload
exports.handleVideoUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No video file provided' });
        }

        const filePath = req.file.path;

        // Ensure user is authenticated via OAuth
        const tokens = req.session ? req.session.googleTokens : null;
        if (!tokens) {
            fs.unlinkSync(filePath); // Cleanup temp file
            return res.status(401).json({ error: 'User not authenticated with Google' });
        }

        // Upload to YouTube
        console.log(`Starting upload to YouTube for file: ${filePath}`);

        // Setup metadata for YouTube
        const metadata = {
            title: `QuickMeet Recording - ${new Date().toLocaleString()}`,
            description: 'Recorded via QuickMeet App (Hybrid Meeting & Loom platform)'
        };

        const uploadResult = await youtubeService.uploadVideo(filePath, metadata, tokens);

        // Cleanup temp file after upload finishes
        fs.unlinkSync(filePath);

        // Upload is complete, we get the videoId
        const videoId = uploadResult.data.id;

        // The watch page URL
        const videoUrl = `/watch/${videoId}`;

        // Return immediately to frontend so they can navigate to watch page
        // Note: YouTube processing takes time. Captions won't be ready immediately.
        res.json({
            success: true,
            videoId: videoId,
            videoUrl: videoUrl,
            message: 'Video uploaded successfully. It may take a few minutes for YouTube to process and generate captions.'
        });

    } catch (error) {
        console.error('Error handling video upload:', error);

        // Attempt cleanup if exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({ error: 'Failed to upload video to YouTube' });
    }
};

// Handles GET /api/transcript/:videoId
exports.getVideoTranscript = async (req, res) => {
    const { videoId } = req.params;

    // Ensure tokens
    const tokens = req.session ? req.session.googleTokens : null;
    if (!tokens) {
        return res.status(401).json({ error: 'Not authenticated with Google' });
    }

    try {
        // Try getting captions
        const transcriptText = await youtubeService.fetchCaptions(videoId, tokens);
        res.json({ success: true, transcript: transcriptText });
    } catch (error) {
        // Captions might still be generating or failed
        res.status(404).json({ success: false, error: 'Transcript currently missing or still processing.', details: error.message });
    }
};
