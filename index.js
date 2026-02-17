const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cheerio = require('cheerio'); // You'll need to install this: npm install cheerio

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Referer', 'Origin', 'User-Agent', 'Range', 'X-Requested-With']
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
    
    // Detect if it's a Megacloud embed
    const isMegacloud = decodedUrl.includes('megacloud.blog') || decodedUrl.includes('megacloud.tv');
    const isVideoRequest = decodedUrl.includes('.mp4') || 
                          decodedUrl.includes('.m3u8') || 
                          decodedUrl.includes('.ts') ||
                          decodedUrl.includes('video') ||
                          decodedUrl.includes('embed');

    console.log(`Proxying ${isMegacloud ? 'Megacloud' : ''} request to:`, decodedUrl);

    // Set appropriate headers based on target domain
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    };

    // Add domain-specific headers
    if (decodedUrl.includes('megacloud.blog') || decodedUrl.includes('megacloud.tv')) {
      headers['Referer'] = 'https://megacloud.blog/';
      headers['Origin'] = 'https://megacloud.blog';
      headers['Host'] = new URL(decodedUrl).hostname;
    } else if (decodedUrl.includes('hianime.to')) {
      headers['Referer'] = 'https://hianime.to/';
      headers['Origin'] = 'https://hianime.to';
    } else if (decodedUrl.includes('rapid-cloud.co')) {
      headers['Referer'] = 'https://rapid-cloud.co/';
      headers['Origin'] = 'https://rapid-cloud.co';
    }

    // Handle range requests for video streaming
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // Make the proxy request
    const response = await axios({
      method: req.method,
      url: decodedUrl,
      headers: headers,
      responseType: 'arraybuffer',
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
      timeout: 30000,
      withCredentials: true
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
      'etag',
      'set-cookie',
      'cf-cache-status',
      'cf-ray',
      'alt-svc',
      'strict-transport-security',
      'x-content-type-options'
    ];

    headersToCopy.forEach(header => {
      if (response.headers[header]) {
        res.setHeader(header, response.headers[header]);
      }
    });

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Referer, Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Set-Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cross-Origin-Embedder-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // For Megacloud embeds, we might want to extract the actual video URL
    if (isMegacloud && response.headers['content-type']?.includes('text/html')) {
      const html = response.data.toString('utf-8');
      
      // Try to extract video data from the HTML
      const videoData = extractVideoData(html, decodedUrl);
      
      if (videoData) {
        // Return extracted video data as JSON
        res.setHeader('Content-Type', 'application/json');
        return res.json({
          type: 'megacloud_embed',
          originalUrl: decodedUrl,
          videoData: videoData,
          html: html // Include original HTML if needed
        });
      }
    }

    // Handle video streaming responses
    if (isVideoRequest || response.headers['content-type']?.includes('video') || 
        response.headers['content-type']?.includes('application/vnd.apple.mpegurl')) {
      
      // Set proper content type if not already set
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

      // Convert buffer to stream for video
      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(Buffer.from(response.data));
      
      bufferStream.pipe(res);
      
      bufferStream.on('error', (err) => {
        console.error('Stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream failed', message: err.message });
        }
      });
    } else {
      // Handle HTML/JSON/text responses
      if (response.headers['content-type']?.includes('application/json')) {
        try {
          const jsonData = JSON.parse(response.data.toString('utf-8'));
          res.json(jsonData);
        } catch {
          res.setHeader('Content-Type', 'application/json');
          res.send(response.data);
        }
      } else if (response.headers['content-type']?.includes('text/html')) {
        // For HTML responses, we might want to modify links to go through proxy
        let html = response.data.toString('utf-8');
        
        // Modify resource URLs to go through proxy if needed
        html = modifyHtmlUrls(html, decodedUrl);
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      } else {
        // Send as is
        res.send(response.data);
      }
    }

  } catch (error) {
    console.error('Proxy error:', error.message);
    console.error('Error details:', error.response?.data || 'No response data');
    
    if (error.code === 'ECONNABORTED') {
      res.status(504).json({ error: 'Proxy timeout', message: 'The request timed out' });
    } else if (error.response) {
      res.status(error.response.status).json({
        error: 'Target server error',
        status: error.response.status,
        message: error.message,
        data: error.response.data ? error.response.data.toString().substring(0, 500) : null
      });
    } else if (error.request) {
      res.status(502).json({ error: 'No response from target', message: error.message });
    } else {
      res.status(500).json({ error: 'Proxy failed', message: error.message });
    }
  }
});

// Helper function to extract video data from Megacloud embed
function extractVideoData(html, originalUrl) {
  try {
    const $ = cheerio.load(html);
    
    // Look for video data in script tags
    const scripts = $('script').map((i, el) => $(el).html()).get();
    
    let videoData = null;
    let playerSettings = null;
    let playerScript = null;
    
    scripts.forEach(script => {
      if (script && script.includes('playerSettings')) {
        const match = script.match(/window\.playerSettings\s*=\s*({[^;]+})/);
        if (match) {
          try {
            playerSettings = JSON.parse(match[1].replace(/'/g, '"'));
          } catch (e) {
            console.log('Error parsing playerSettings:', e);
          }
        }
      }
      
      if (script && script.includes('jwplayer')) {
        playerScript = script;
      }
    });
    
    // Extract the embed ID from URL
    const idMatch = originalUrl.match(/\/e-1\/([^\/?]+)/);
    const embedId = idMatch ? idMatch[1] : null;
    
    // Get data attributes from player div
    const playerDiv = $('#megacloud-player');
    const dataId = playerDiv.data('id');
    const realId = playerDiv.data('realid');
    const mediaId = playerDiv.data('mediaid');
    
    videoData = {
      embedId: embedId,
      dataId: dataId,
      realId: realId,
      mediaId: mediaId,
      playerSettings: playerSettings,
      hasPlayerScript: !!playerScript
    };
    
    return videoData;
  } catch (e) {
    console.error('Error extracting video data:', e);
    return null;
  }
}

// Helper function to modify URLs in HTML to go through proxy
function modifyHtmlUrls(html, baseUrl) {
  try {
    const $ = cheerio.load(html);
    
    // Modify resource URLs
    $('link[rel="stylesheet"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('http')) {
        const absoluteUrl = new URL(href, baseUrl).toString();
        $(el).attr('href', `/api?url=${encodeURIComponent(absoluteUrl)}`);
      }
    });
    
    $('script[src]').each((i, el) => {
      const src = $(el).attr('src');
      if (src && !src.startsWith('http') && !src.includes('googletagmanager')) {
        const absoluteUrl = new URL(src, baseUrl).toString();
        $(el).attr('src', `/api?url=${encodeURIComponent(absoluteUrl)}`);
      }
    });
    
    return $.html();
  } catch (e) {
    console.error('Error modifying HTML URLs:', e);
    return html;
  }
}

// Dedicated endpoint for Megacloud embeds
app.get('/megacloud', async (req, res) => {
  const { id } = req.query;
  
  if (!id) {
    return res.status(400).json({ error: 'ID is required' });
  }
  
  const embedUrl = `https://megacloud.blog/embed-2/v3/e-1/${id}?k=1&autoPlay=1&oa=0&asi=1`;
  
  try {
    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Referer': 'https://megacloud.blog/',
        'Origin': 'https://megacloud.blog',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    const html = response.data;
    const videoData = extractVideoData(html, embedUrl);
    
    // Also look for the actual video sources in the loaded scripts
    // This would require additional requests to the JS files
    
    res.json({
      success: true,
      embedId: id,
      embedUrl: embedUrl,
      videoData: videoData,
      note: 'The actual video sources are loaded dynamically via JavaScript. Check the videoData.playerScript for more information.'
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch Megacloud embed', 
      message: error.message 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Proxy is running',
    endpoints: ['/api', '/megacloud', '/health']
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found', 
    message: 'The requested endpoint does not exist',
    availableEndpoints: ['/api', '/megacloud', '/health']
  });
});

module.exports = app;