const express = require('express');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.vercel.app http://localhost:*");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Serve static files from Public folder (case sensitive)
app.use(express.static(path.join(__dirname, 'Public')));

// API Base URL
const API_BASE = 'https://anime-apis-rosy.vercel.app/api';

// Helper function for API requests with timeout
async function fetchAPI(endpoint) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'ZenStream/1.0',
                'Accept': 'application/json'
            }
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            return { 
                success: false, 
                error: `API responded with status ${response.status}`,
                status: response.status 
            };
        }

        const data = await response.json();
        return { success: true, data };
    } catch (error) {
        clearTimeout(timeoutId);
        
        if (error.name === 'AbortError') {
            return { success: false, error: 'Request timeout after 10 seconds' };
        }
        
        console.error(`API Error: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// Route handlers with error handling
app.get('/', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'Public', 'index.html'));
    } catch (error) {
        res.status(500).send('Error loading home page');
    }
});

app.get('/watch', (req, res) => {
    try {
        res.sendFile(path.join(__dirname, 'Public', 'watch.html'));
    } catch (error) {
        res.status(500).send('Error loading watch page');
    }
});

// API Routes with comprehensive error handling
app.get('/api/home', async (req, res) => {
    try {
        const result = await fetchAPI('');
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(500).json({ 
                success: false, 
                error: result.error,
                message: 'Failed to fetch home data'
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

app.get('/api/episodes/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing anime ID' 
            });
        }

        const result = await fetchAPI(`/episodes/${id}`);
        
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(result.status || 500).json({ 
                success: false, 
                error: result.error,
                message: 'Failed to fetch episodes'
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
            // Modify iframe URL if needed
            if (result.data.results?.streamingLink?.iframe) {
                let iframeUrl = result.data.results.streamingLink.iframe;
                
                // Add referrer policy for external iframes
                if (iframeUrl.includes('gogoanime') || iframeUrl.includes('gogocdn')) {
                    result.data.results.streamingLink.iframe = iframeUrl + 
                        (iframeUrl.includes('?') ? '&' : '?') + 
                        'referrer=same-origin';
                }
            }
            res.json(result.data);
        } else {
            res.status(result.status || 500).json({ 
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

app.get('/api/search', async (req, res) => {
    try {
        const { keyword } = req.query;
        
        if (!keyword) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing keyword parameter' 
            });
        }
        
        const result = await fetchAPI(`/search?keyword=${encodeURIComponent(keyword)}`);
        
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(result.status || 500).json({ 
                success: false, 
                error: result.error,
                message: 'Failed to fetch search results'
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

// Catch-all API route for any other endpoints
app.get('/api/*', async (req, res) => {
    try {
        const endpoint = req.url.replace('/api', '');
        const result = await fetchAPI(endpoint);
        
        if (result.success) {
            res.json(result.data);
        } else {
            res.status(result.status || 500).json({ 
                success: false, 
                error: result.error,
                message: 'Failed to fetch data'
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

// Health check endpoint
app.get('/health', (req, res) => {
    try {
        res.json({
            success: true,
            status: 'OK',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV || 'development',
            vercel: process.env.VERCEL ? true : false,
            memory: process.memoryUsage(),
            node: process.version
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 404 handler for HTML pages
app.use((req, res, next) => {
    // Check if the request is for an API route
    if (req.url.startsWith('/api/')) {
        return next();
    }
    
    // Check if the request accepts HTML
    const accept = req.headers.accept || '';
    if (accept.includes('text/html')) {
        try {
            res.status(404).sendFile(path.join(__dirname, 'Public', '404.html'));
        } catch (error) {
            res.status(404).send('404 - Page Not Found');
        }
    } else {
        next();
    }
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        path: req.url
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    
    // Check if the request is for an API route
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

// Start server if not in Vercel environment
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`
    ╔══════════════════════════════════════════╗
    ║       ZenStream Server Running           ║
    ╠══════════════════════════════════════════╣
    ║  • Local: http://localhost:${PORT}           ║
    ║  • Watch: http://localhost:${PORT}/watch?id=one-piece-100 ║
    ║  • Health: http://localhost:${PORT}/health   ║
    ║  • Public folder: ${path.join(__dirname, 'Public')} ║
    ║  • Environment: ${process.env.NODE_ENV || 'development'}        ║
    ╚══════════════════════════════════════════╝
        `);
        
        // Check if Public folder exists
        const fs = require('fs');
        if (!fs.existsSync(path.join(__dirname, 'Public'))) {
            console.warn('\n⚠️  Warning: Public folder not found!');
            console.warn('   Create a "Public" folder with index.html and watch.html');
        }
    });
}

// Export for Vercel
module.exports = app;
