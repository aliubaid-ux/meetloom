const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const SCOPES = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.force-ssl'
];

/**
 * Creates Google OAuth2 Client
 */
function createOAuthClient() {
    const redirectUri = REDIRECT_URI || 'http://localhost:3000/auth/google/callback';
    console.log('[OAuth] Using redirect URI:', redirectUri);
    return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
}

/**
 * Generate Google OAuth Auth URL
 */
exports.getAuthUrl = () => {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
};

/**
 * Exchange auth code for tokens
 */
exports.getTokensAndClient = async (code) => {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    return { tokens, oauth2Client };
};

/**
 * Upload chunked webm file to YouTube
 */
exports.uploadVideo = async (filePath, metadata, tokens) => {
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    return youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
            snippet: {
                title: metadata.title,
                description: metadata.description,
                categoryId: '22', // People & Blogs
            },
            status: {
                privacyStatus: 'unlisted', // Emulate Loom-style privacy by default
                selfDeclaredMadeForKids: false
            }
        },
        media: {
            body: fs.createReadStream(filePath)
        }
    });
};

/**
 * Set privacy explicitly to unlisted (though it's set in upload, it's good to have)
 */
exports.setUnlistedPrivacy = async (videoId, tokens) => {
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    return youtube.videos.update({
        part: 'status',
        requestBody: {
            id: videoId,
            status: {
                privacyStatus: 'unlisted'
            }
        }
    });
};

/**
 * Fetch YouTube Captions for a given video ID
 */
exports.fetchCaptions = async (videoId, tokens) => {
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // 1. List captions track for the video
    const captionListResponse = await youtube.captions.list({
        part: 'snippet',
        videoId: videoId
    });

    const items = captionListResponse.data.items;
    if (!items || items.length === 0) {
        throw new Error('No captions available yet.');
    }

    // Get the first track (usually ASR auto-generated)
    const captionTrack = items[0];
    const captionId = captionTrack.id;

    // 2. Download caption track (VTT or similar format)
    const downloadResponse = await youtube.captions.download({
        id: captionId,
        tfmt: 'vtt' // specify format if needed
    });

    return downloadResponse.data; // Raw caption text
};

/**
 * Simulates polling (often frontend handles polling, but this is server logic mapping)
 */
exports.pollUntilProcessingComplete = async (videoId, tokens) => {
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials(tokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Quick polling check
    const response = await youtube.videos.list({
        part: 'processingDetails,status',
        id: videoId
    });

    if (response.data.items.length === 0) {
        throw new Error('Video not found');
    }

    const video = response.data.items[0];
    return video.processingDetails;
};
