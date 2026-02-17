const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers to prevent iframe errors
app.use((req, res, next) => {
    // Allow iframe embedding for video players
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.vercel.app http://localhost:*");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API Base URL
const API_BASE = 'https://anime-apis-rosy.vercel.app/api';

// Helper function for API requests
async function fetchAPI(endpoint) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`);
        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        console.error(`API Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Home route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Watch route
app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// API Routes
app.get('/api/home', async (req, res) => {
    const result = await fetchAPI('');
    if (result.success) {
        res.json(result.data);
    } else {
        res.status(500).json({ success: false, error: result.error });
    }
});

app.get('/api/episodes/:id', async (req, res) => {
    const { id } = req.params;
    const result = await fetchAPI(`/episodes/${id}`);
    if (result.success) {
        res.json(result.data);
    } else {
        res.status(500).json({ success: false, error: result.error });
    }
});

app.get('/api/stream', async (req, res) => {
    const { id, server, type } = req.query;
    if (!id) {
        return res.status(400).json({ success: false, error: 'Missing id parameter' });
    }
    
    const queryParams = new URLSearchParams({
        id,
        ...(server && { server }),
        ...(type && { type })
    }).toString();
    
    const result = await fetchAPI(`/stream?${queryParams}`);
    if (result.success) {
        // Modify iframe URL to work with localhost/vercel
        if (result.data.results?.streamingLink?.iframe) {
            // Ensure iframe URL uses HTTPS and proper encoding
            let iframeUrl = result.data.results.streamingLink.iframe;
            if (iframeUrl.includes('gogoanime')) {
                // Add referrer policy for gogoanime iframes
                result.data.results.streamingLink.iframe = iframeUrl + (iframeUrl.includes('?') ? '&' : '?') + 'referrer=same-origin';
            }
        }
        res.json(result.data);
    } else {
        res.status(500).json({ success: false, error: result.error });
    }
});

app.get('/api/search', async (req, res) => {
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
});

// Proxy for any other API endpoints
app.get('/api/*', async (req, res) => {
    const endpoint = req.url.replace('/api', '');
    const result = await fetchAPI(endpoint);
    if (result.success) {
        res.json(result.data);
    } else {
        res.status(500).json({ success: false, error: result.error });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        vercel: process.env.VERCEL ? true : false
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server if not in Vercel environment
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`
    ╔══════════════════════════════════════════╗
    ║       MarcAnime Server Running           ║
    ╠══════════════════════════════════════════╣
    ║  • Local: http://localhost:${PORT}           ║
    ║  • Watch: http://localhost:${PORT}/watch?id=one-piece-100 ║
    ║  • Health: http://localhost:${PORT}/health   ║
    ║  • Environment: ${process.env.NODE_ENV || 'development'}        ║
    ╚══════════════════════════════════════════╝
        `);
    });
}

// Export for Vercel
module.exports = app;
