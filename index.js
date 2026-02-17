const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/watch', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'watch.html'));
});

// API Proxy route to avoid CORS issues
app.get('/api/*', async (req, res) => {
    try {
        const fetch = (await import('node-fetch')).default;
        const apiUrl = `https://anime-apis-rosy.vercel.app/api/${req.params[0]}${req.url.replace(/^\/api\/[^/]*/, '')}`;
        
        console.log(`Proxying to: ${apiUrl}`); // Debug log
        
        const response = await fetch(apiUrl);
        const data = await response.json();
        
        res.json(data);
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch from anime API',
            details: error.message 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        success: false, 
        error: 'Something went wrong!',
        message: err.message 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════╗
    ║         MarcAnime Server Running         ║
    ╠════════════════════════════════════╣
    ║  • Port: ${PORT}                       ║
    ║  • Home: http://localhost:${PORT}      ║
    ║  • Watch: http://localhost:${PORT}/watch?id=one-piece-100 ║
    ║  • Health: http://localhost:${PORT}/health ║
    ╚════════════════════════════════════╝
    `);
});
