const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Referer', 'Origin', 'User-Agent', 'Range']
}));

// Handle OPTIONS requests for CORS preflight
app.options('*', cors());

// Main proxy endpoint
app.get('/api', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    
    // Check if it's a video/streaming request based on file extension or embed pattern
    const isVideoRequest = decodedUrl.includes('.mp4') || 
                          decodedUrl.includes('.m3u8') || 
                          decodedUrl.includes('.ts') ||
                          decodedUrl.includes('video') ||
                          decodedUrl.includes('embed') ||
                          decodedUrl.includes('iframe') ||
                          decodedUrl.includes('rapid-cloud') ||
                          decodedUrl.includes('megacloud');
    
    // Set appropriate headers for the request
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Accept': isVideoRequest ? '*/*' : 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': isVideoRequest ? 'iframe' : 'empty',
      'Sec-Fetch-Mode': isVideoRequest ? 'navigate' : 'cors',
      'Sec-Fetch-Site': 'cross-site',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache'
    };

    // Add referer and origin based on the domain
    if (decodedUrl.includes('hianime.to')) {
      headers['Referer'] = 'https://hianime.to/';
      headers['Origin'] = 'https://hianime.to';
    } else if (decodedUrl.includes('rapid-cloud.co')) {
      headers['Referer'] = 'https://rapid-cloud.co/';
      headers['Origin'] = 'https://rapid-cloud.co';
    } else if (decodedUrl.includes('megacloud.tv')) {
      headers['Referer'] = 'https://megacloud.tv/';
      headers['Origin'] = 'https://megacloud.tv';
    }

    // Handle range requests for video streaming
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    console.log(`Proxying ${isVideoRequest ? 'video' : 'API'} request to:`, decodedUrl);

    // Make the proxy request
    const response = await axios({
      method: req.method,
      url: decodedUrl,
      headers: headers,
      responseType: isVideoRequest ? 'stream' : 'arraybuffer',
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
      timeout: 30000 // 30 seconds timeout
    });

    // Copy relevant headers from the target response
    const headersToCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'expires',
      'last-modified',
      'etag'
    ];

    headersToCopy.forEach(header => {
      if (response.headers[header]) {
        res.setHeader(header, response.headers[header]);
      }
    });

    // Set CORS headers for the response
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    // Handle video streaming responses
    if (isVideoRequest) {
      // Set proper content type for video
      if (!res.getHeader('content-type')) {
        if (decodedUrl.includes('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (decodedUrl.includes('.mp4')) {
          res.setHeader('Content-Type', 'video/mp4');
        } else if (decodedUrl.includes('.ts')) {
          res.setHeader('Content-Type', 'video/MP2T');
        }
      }

      // Handle range requests (partial content)
      if (req.headers.range) {
        res.status(206);
      }

      // Stream the video data
      response.data.pipe(res);
      
      // Handle stream errors
      response.data.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream failed', message: err.message });
        }
      });
    } else {
      // Handle API/HTML responses
      if (response.headers['content-type']?.includes('application/json')) {
        try {
          const jsonData = JSON.parse(response.data.toString('utf-8'));
          res.json(jsonData);
        } catch {
          res.setHeader('Content-Type', 'application/json');
          res.send(response.data);
        }
      } else {
        // Send as text/html or other format
        res.setHeader('Content-Type', response.headers['content-type'] || 'text/plain');
        res.send(response.data);
      }
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    // Handle different types of errors
    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Proxy timeout', message: 'The request timed out' });
    } else if (error.response) {
      // The request was made and the server responded with a status code outside of 2xx
      res.status(error.response.status).json({
        error: 'Target server error',
        status: error.response.status,
        message: error.message,
        data: error.response.data
      });
    } else if (error.request) {
      // The request was made but no response was received
      res.status(502).json({ error: 'No response from target', message: error.message });
    } else {
      // Something happened in setting up the request
      res.status(500).json({ error: 'Proxy failed', message: error.message });
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Proxy is running' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', message: 'The requested endpoint does not exist' });
});

module.exports = app;