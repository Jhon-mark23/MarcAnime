const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const { createProxyMiddleware } = require('http-proxy-middleware');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Comprehensive CORS and security headers
app.use((req, res, next) => {
    // Allow iframe embedding from anywhere (needed for video players)
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', 
        "frame-ancestors *; " +
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
        "script-src * 'unsafe-inline' 'unsafe-eval'; " +
        "style-src * 'unsafe-inline'; " +
        "img-src * data: blob:; " +
        "media-src *; " +
        "connect-src *;"
    );
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Serve static files from Public folder
app.use(express.static(path.join(__dirname, 'Public')));

// API Base URL
const API_BASE = 'https://anime-apis-rosy.vercel.app/api';

// Helper function for API requests with timeout and retry
async function fetchAPI(endpoint, retries = 3) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'ZenStream/2.0',
                    'Accept': 'application/json',
                    'Origin': 'https://anime-apis-rosy.vercel.app',
                    'Referer': 'https://anime-apis-rosy.vercel.app/'
                }
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`API responded with status ${response.status}`);
            }

            const data = await response.json();
            return { success: true, data };
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (i === retries - 1) {
                if (error.name === 'AbortError') {
                    return { success: false, error: 'Request timeout after 15 seconds' };
                }
                return { success: false, error: error.message };
            }
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    
    return { success: false, error: 'Max retries exceeded' };
}

// Route handlers
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});

app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'Public', 'watch.html'));
});

// Enhanced stream endpoint with iframe fixing
app.get('/api/stream', async (req, res) => {
    try {
        const { id, server = 'hd-2', type = 'sub' } = req.query;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing id parameter' 
            });
        }

        // Construct query parameters
        const queryParams = new URLSearchParams({
            id: id,
            server: server,
            type: type
        }).toString();
        
        const result = await fetchAPI(`/stream?${queryParams}`);
        
        if (result.success) {
            // Fix iframe URLs to prevent cross-origin issues
            if (result.data.results?.streamingLink?.iframe) {
                let iframeUrl = result.data.results.streamingLink.iframe;
                
                // Convert to HTTPS if needed
                iframeUrl = iframeUrl.replace('http://', 'https://');
                
                // Add cross-origin fixes
                if (iframeUrl.includes('gogoanime') || iframeUrl.includes('gogocdn')) {
                    // Use our proxy for gogoanime iframes
                    const encodedUrl = Buffer.from(iframeUrl).toString('base64');
                    result.data.results.streamingLink.iframe = `/proxy/iframe?url=${encodedUrl}`;
                } else {
                    // Add parameters to prevent cross-origin issues
                    const separator = iframeUrl.includes('?') ? '&' : '?';
                    iframeUrl = `${iframeUrl}${separator}referrer=same-origin&allow=autoplay*;fullscreen*;encrypted-media*`;
                    result.data.results.streamingLink.iframe = iframeUrl;
                }
            }
            
            // Add our own embed options
            result.data.results.embedOptions = {
                useProxy: true,
                baseUrl: `${req.protocol}://${req.get('host')}`,
                servers: result.data.results.servers || []
            };
            
            res.json(result.data);
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error,
                message: 'Failed to fetch stream'
            });
        }
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            message: 'Internal server error'
        });
    }
});

// Proxy for iframes to bypass CORS
app.get('/proxy/iframe', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).send('Missing URL parameter');
        }
        
        // Decode the URL
        const decodedUrl = Buffer.from(url, 'base64').toString('utf-8');
        
        // Fetch the iframe content
        const response = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Referer': 'https://gogoanime.cl/',
                'Origin': 'https://gogoanime.cl'
            }
        });
        
        const html = await response.text();
        
        // Modify the HTML to allow embedding
        const modifiedHtml = html
            .replace(/<head>/i, '<head><base href="' + decodedUrl.split('/').slice(0, -1).join('/') + '/">')
            .replace(/x-frame-options/gi, 'X-Frame-Options-Allow')
            .replace(/frame-ancestors/gi, 'frame-ancestors-allow');
        
        res.send(modifiedHtml);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).send('Proxy error: ' + error.message);
    }
});

// Direct video proxy
app.get('/proxy/video', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).send('Missing URL parameter');
        }
        
        const decodedUrl = Buffer.from(url, 'base64').toString('utf-8');
        
        const response = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://gogoanime.cl/',
                'Range': req.headers.range || ''
            }
        });
        
        // Forward headers
        const headers = {
            'Content-Type': response.headers.get('content-type'),
            'Content-Length': response.headers.get('content-length'),
            'Accept-Ranges': 'bytes'
        };
        
        if (response.headers.get('content-range')) {
            headers['Content-Range'] = response.headers.get('content-range');
        }
        
        res.writeHead(response.status, headers);
        response.body.pipe(res);
    } catch (error) {
        console.error('Video proxy error:', error);
        res.status(500).send('Video proxy error');
    }
});

// Other API endpoints
app.get('/api/home', async (req, res) => {
    try {
        const result = await fetchAPI('');
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/episodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ success: false, error: 'Missing anime ID' });
        }

        const result = await fetchAPI(`/episodes/${id}`);
        
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const { keyword } = req.query;
        
        if (!keyword) {
            return res.status(400).json({ success: false, error: 'Missing keyword parameter' });
        }
        
        const result = await fetchAPI(`/search?keyword=${encodeURIComponent(keyword)}`);
        
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        vercel: process.env.VERCEL ? true : false,
        api: {
            base: API_BASE,
            status: 'connected'
        }
    });
});

// 404 handler
app.use((req, res) => {
    if (req.url.startsWith('/api/')) {
        res.status(404).json({
            success: false,
            error: 'API endpoint not found',
            path: req.url
        });
    } else {
        res.status(404).sendFile(path.join(__dirname, 'Public', '404.html'));
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    
    if (req.url.startsWith('/api/')) {
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    } else {
        res.status(500).send('500 - Internal Server Error');
    }
});

// Start server if not in Vercel
if (require.main === module) {
    // Check if Public folder exists
    const fs = require('fs');
    if (!fs.existsSync(path.join(__dirname, 'Public'))) {
        console.error('\n❌ Error: Public folder not found!');
        console.error('   Please create a "Public" folder with index.html and watch.html\n');
        process.exit(1);
    }
    
    app.listen(PORT, () => {
        console.log(`
    ╔══════════════════════════════════════════════╗
    ║         ZenStream Server Running             ║
    ╠══════════════════════════════════════════════╣
    ║  • Local URL: http://localhost:${PORT}           ║
    ║  • Watch: http://localhost:${PORT}/watch?id=one-piece-100 ║
    ║  • API Proxy: http://localhost:${PORT}/api        ║
    ║  • Health: http://localhost:${PORT}/health       ║
    ║  • Public folder: ${path.join(__dirname, 'Public')}   ║
    ║  • Environment: ${process.env.NODE_ENV || 'development'}        ║
    ╚══════════════════════════════════════════════╝
        `);
    });
}

module.exports = app;