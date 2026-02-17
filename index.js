const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept, Accept-Encoding');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Cache-Control');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// Main proxy endpoint
app.get('/proxy', async (req, res) => {
    const url = req.query.url;
    const referer = req.query.referer;

    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required' });
    }

    try {
        // Determine the correct referer
        let targetReferer = referer || 'https://megacloud.tv/';
        const targetUrl = new URL(url);
        
        // Special handling for cdn.dotstream.buzz (megaplay CDN)
        if (targetUrl.hostname === 'cdn.dotstream.buzz') {
            targetReferer = 'https://megaplay.buzz/';
        }
        // If referer is just megacloud domain, construct a full embed URL
        else if (targetReferer === 'https://megacloud.tv' || targetReferer === 'https://megacloud.tv/') {
            const urlPath = targetUrl.pathname;
            const videoIdMatch = urlPath.match(/\/([a-f0-9]{64,})\//);
            if (videoIdMatch) {
                targetReferer = `https://megacloud.tv/embed-2/e-1/${videoIdMatch[1]}`;
            } else {
                targetReferer = 'https://megacloud.tv/embed-2/e-1/';
            }
        }

        const headersMap = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'identity',
            'Referer': targetReferer,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'cross-site',
            'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
        };

        const rangeHeader = req.headers['range'];
        if (rangeHeader) headersMap['Range'] = rangeHeader;

        const xRequestedWith = req.headers['x-requested-with'];
        if (xRequestedWith) headersMap['X-Requested-With'] = xRequestedWith;

        // Fetch the content
        const response = await fetch(url, {
            method: 'GET',
            headers: headersMap,
            redirect: 'follow'
        });

        if (!response.ok && response.status !== 206) {
            return res.status(response.status).send(`Upstream error ${response.status}`);
        }

        // Copy headers from the response
        const contentType = response.headers.get('content-type') || '';
        
        // Set response headers
        res.set({
            'Access-Control-Allow-Origin': '*',
            'X-Proxy-Version': '1.2.1-node',
            'Cache-Control': response.headers.get('cache-control') || 'no-cache'
        });

        // Copy relevant headers
        const headersToCopy = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
        headersToCopy.forEach(header => {
            const value = response.headers.get(header);
            if (value) res.set(header, value);
        });

        // Remove security headers
        res.removeHeader('content-security-policy');
        res.removeHeader('x-frame-options');

        // HLS manifest rewriting
        if (contentType.includes('mpegurl') || url.includes('.m3u8')) {
            const manifestText = await response.text();
            const basePath = url.substring(0, url.lastIndexOf('/') + 1);
            const workerUrl = `${req.protocol}://${req.get('host')}${req.path}`;

            const proxyLine = (line) => {
                let fullUrl = line;
                if (!line.startsWith('http')) {
                    if (line.startsWith('/')) {
                        fullUrl = new URL(url).origin + line;
                    } else {
                        fullUrl = basePath + line;
                    }
                }
                return `${workerUrl}?url=${encodeURIComponent(fullUrl)}&referer=${encodeURIComponent(targetReferer)}`;
            };

            const lines = manifestText.split('\n');
            const newLines = lines.map(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return line;
                if (trimmedLine.startsWith('#')) {
                    return trimmedLine.replace(/URI=["']([^"']+)["']/, (match, uri) => {
                        return `URI="${proxyLine(uri)}"`;
                    });
                }
                return proxyLine(trimmedLine);
            });

            return res.send(newLines.join('\n'));
        }

        // For segments or binary data, pipe the response
        response.body.pipe(res);

    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.2.1-node' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
    console.log(`- Proxy endpoint: http://localhost:${PORT}/proxy?url=VIDEO_URL&referer=REFERER`);
    console.log(`- Health check: http://localhost:${PORT}/health`);
});