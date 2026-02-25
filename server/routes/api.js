const express = require('express');
const router = express.Router();
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const recordingController = require('../controllers/recordingController');

// Rate limiting for the upload API to prevent abuse
// Max 10 uploads per hour per IP
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many uploads from this IP, please try again after an hour' }
});

// Configure multer for saving uploaded video blobs (Max 500MB)
// In a full production scenario this might upload directly to S3 or process as stream
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Upload to a temporary OS directory or local tmp folder
        const fs = require('fs');
        const dir = './tmp_uploads';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `recording-${uniqueSuffix}.webm`); // Standard blob format
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit
});

// POST /api/upload
// Receives the blob and sends it to the recording controller processing
router.post('/upload', uploadLimiter, upload.single('video'), recordingController.handleVideoUpload);

// GET /api/transcript/:videoId
// Retrieve captions/transcript for a given video
router.get('/transcript/:videoId', recordingController.getVideoTranscript);

module.exports = router;
