// proxy-server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory store for active streams
const streams = new Map();

// 1. Register a stream and its configuration
app.post('/register', (req, res) => {
    const { url, headers, dohEndpoint } = req.body;
    const streamId = Math.random().toString(36).substring(2, 15);
    streams.set(streamId, { baseUrl: url, headers: headers || {}, dohEndpoint });
    console.log(`[Proxy] Registered stream ${streamId} -> ${url}`);
    res.json({ streamId });
});

// 2. Proxy the stream
app.get('/proxy', async (req, res) => {
    const { streamId, url } = req.query;
    const stream = streams.get(streamId);

    if (!stream) {
        return res.status(404).send('Stream not found. Register first.');
    }

    const targetUrl = url || stream.baseUrl;

    try {
        // Configure DoH if provided
        let agent = undefined;
        if (stream.dohEndpoint) {
            // Note: True DoH in Node.js requires a custom agent or library.
            // For simplicity, we log it and use the system DNS.
            // A production app would use 'dohjs' or 'undici' with a DoH dispatcher.
            console.log(`[Proxy] DoH requested: ${stream.dohEndpoint} (using system DNS for now)`);
        }

        const response = await axios({
            method: 'GET',
            url: targetUrl,
            headers: stream.headers,
            responseType: 'arraybuffer',
            httpsAgent: agent,
            validateStatus: () => true
        });

        let data = response.data;
        const contentType = response.headers['content-type'] || '';

        // Rewrite manifests (MPD / M3U8) to point back to this proxy
        if (targetUrl.includes('.mpd') || targetUrl.includes('.m3u8')) {
            let text = data.toString('utf-8');
            const proxyBase = `http://localhost:3000/proxy?streamId=${streamId}&url=`;
            
            text = text.replace(/https?:\/\/[^"'\s<>]+/g, (match) => {
                if (match.includes('localhost:3000')) return match;
                return `${proxyBase}${encodeURIComponent(match)}`;
            });
            
            data = Buffer.from(text, 'utf-8');
            console.log(`[Proxy] Rewrote manifest for ${streamId}`);
        }

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
