// proxy-server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store for active streams
// streamId -> { baseUrl, headers }
const streams = new Map();

// 1. Register a stream and its headers
app.post('/register', (req, res) => {
    const { url, headers } = req.body;
    const streamId = Math.random().toString(36).substring(2, 15);
    streams.set(streamId, { baseUrl: url, headers: headers || {} });
    console.log(`[Proxy] Registered stream ${streamId} -> ${url}`);
    res.json({ streamId });
});

// 2. Proxy the stream (manifests and segments)
app.get('/proxy', async (req, res) => {
    const { streamId, url } = req.query;
    const stream = streams.get(streamId);

    if (!stream) {
        return res.status(404).send('Stream not found. Register first.');
    }

    const targetUrl = url || stream.baseUrl;

    try {
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            headers: stream.headers,
            responseType: 'arraybuffer',
            validateStatus: () => true // Don't throw on 403, let the client handle it
        });

        let data = response.data;
        const contentType = response.headers['content-type'] || '';

        // Rewrite manifests to point back to this proxy
        if (targetUrl.includes('.mpd') || targetUrl.includes('.m3u8')) {
            let text = data.toString('utf-8');
            const proxyBase = `http://localhost:3000/proxy?streamId=${streamId}&url=`;
            
            // Basic regex to replace absolute http/https URLs with proxied versions
            // This handles both MPD and M3U8 manifests
            text = text.replace(/https?:\/\/[^"'\s<>]+/g, (match) => {
                // Avoid double-proxying
                if (match.includes('localhost:3000')) return match;
                return `${proxyBase}${encodeURIComponent(match)}`;
            });
            
            data = Buffer.from(text, 'utf-8');
            console.log(`[Proxy] Rewrote manifest for ${streamId}`);
        }

        // Send the response with the original content type
        res.set('Content-Type', contentType);
        res.status(response.status).send(data);

    } catch (err) {
        console.error(`[Proxy] Error fetching ${targetUrl}:`, err.message);
        res.status(500).send(err.message);
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`\n✅ Proxy server running at http://localhost:${PORT}`);
    console.log(`👉 Open your web player (index.html) in the browser.\n`);
});
