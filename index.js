 // index.js - Simplified Megacloud Proxy
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['*']
}));

// Handle OPTIONS preflight
app.options('*', cors());

// Main endpoint for Megacloud embeds
app.get('/proxy', async (req, res) => {
  const { id, k = 1, autoPlay = 1, oa = 0, asi = 1 } = req.query;
  
  if (!id) {
    return res.status(400).send('Missing ID parameter');
  }

  const embedUrl = `https://megacloud.blog/embed-2/v3/e-1/${id}?k=${k}&autoPlay=${autoPlay}&oa=${oa}&asi=${asi}`;
  
  try {
    console.log(`Fetching embed: ${embedUrl}`);
    
    // Fetch the embed page
    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://megacloud.blog/',
        'Origin': 'https://megacloud.blog',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    // Modify the HTML to work through our proxy
    let html = response.data;
    
    // Add base tag and CSP headers
    html = html.replace('<head>', 
      '<head>\n' +
      '<base href="https://megacloud.blog/embed-2/v3/e-1/">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;">'
    );

    // Replace all resource URLs to go through our proxy
    html = html.replace(/(src|href)="\/([^"]+)"/g, (match, attr, path) => {
      return `${attr}="/resource?url=${encodeURIComponent('https://megacloud.blog/' + path)}"`;
    });

    // Add our proxy interceptor script
    const interceptorScript = `
    <script>
      // Override fetch and XHR to use proxy
      (function() {
        const PROXY_URL = '/resource?url=';
        
        // Override fetch
        const originalFetch = window.fetch;
        window.fetch = function(url, options = {}) {
          if (typeof url === 'string' && url.startsWith('http')) {
            url = PROXY_URL + encodeURIComponent(url);
          }
          return originalFetch.call(this, url, options);
        };
        
        // Override XMLHttpRequest
        const XHR = XMLHttpRequest;
        window.XMLHttpRequest = function() {
          const xhr = new XHR();
          const open = xhr.open;
          xhr.open = function(method, url, ...args) {
            if (typeof url === 'string' && url.startsWith('http')) {
              url = PROXY_URL + encodeURIComponent(url);
            }
            return open.call(this, method, url, ...args);
          };
          return xhr;
        };
        
        // Override Image constructor
        const OriginalImage = Image;
        window.Image = function() {
          const img = new OriginalImage();
          const originalSrc = Object.getOwnPropertyDescriptor(img, 'src');
          Object.defineProperty(img, 'src', {
            get: function() { return originalSrc.get.call(this); },
            set: function(value) {
              if (value && value.startsWith('http')) {
                value = PROXY_URL + encodeURIComponent(value);
              }
              originalSrc.set.call(this, value);
            }
          });
          return img;
        };
        
        console.log('Proxy interceptor active');
      })();
    </script>
    `;
    
    html = html.replace('</head>', interceptorScript + '</head>');
    
    // Send the modified HTML
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(html);
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="background:#1a1a2e; color:white; font-family:Arial; display:flex; justify-content:center; align-items:center; height:100vh;">
        <div style="text-align:center; padding:20px; background:#16213e; border-radius:10px;">
          <h2 style="color:#ff4444;">Failed to load</h2>
          <p>${error.message}</p>
          <p>Try accessing: /proxy?id=5iw4w6QUxVz8</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Resource proxy endpoint
app.get('/resource', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).send('Missing URL parameter');
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    console.log(`Fetching resource: ${decodedUrl}`);

    // Special handling for m3u8/manifest files
    const isManifest = decodedUrl.includes('.m3u8') || decodedUrl.includes('master.json');
    
    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://megacloud.blog/',
        'Origin': 'https://megacloud.blog',
        'Accept': '*/*'
      },
      responseType: isManifest ? 'text' : 'arraybuffer',
      maxRedirects: 5
    });

    // Copy content-type
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    // For manifest files, modify URLs to go through proxy
    if (isManifest && typeof response.data === 'string') {
      let data = response.data;
      
      // If it's an m3u8 playlist, modify segment URLs
      if (decodedUrl.includes('.m3u8')) {
        const baseUrl = decodedUrl.substring(0, decodedUrl.lastIndexOf('/') + 1);
        data = data.split('\n').map(line => {
          if (line && !line.startsWith('#') && !line.startsWith('http')) {
            // This is a segment URL, proxy it
            const fullUrl = baseUrl + line;
            return `/resource?url=${encodeURIComponent(fullUrl)}`;
          }
          return line;
        }).join('\n');
      }
      
      return res.send(data);
    }

    // For video segments and other binary data
    res.send(response.data);
    
  } catch (error) {
    console.error('Resource error:', error.message);
    res.status(500).send('Error fetching resource');
  }
});

// Direct video proxy for segments
app.get('/video', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).send('Missing URL');
  }

  try {
    const decodedUrl = decodeURIComponent(url);
    
    const response = await axios({
      method: 'GET',
      url: decodedUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://megacloud.blog/',
        'Range': req.headers.range || 'bytes=0-'
      },
      responseType: 'stream',
      maxRedirects: 5
    });

    // Copy relevant headers
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
      res.status(206);
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Accept-Ranges', 'bytes');
    
    response.data.pipe(res);
    
  } catch (error) {
    console.error('Video error:', error.message);
    res.status(500).send('Video error');
  }
});

// Simple test page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Megacloud Proxy</title>
      <style>
        body { background: #1a1a2e; color: #fff; font-family: Arial; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        input { padding: 10px; width: 300px; margin-right: 10px; }
        button { padding: 10px 20px; background: #0f3460; color: white; border: none; cursor: pointer; }
        iframe { width: 100%; height: 500px; border: none; margin-top: 20px; background: #16213e; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎬 Megacloud Proxy</h1>
        <p>Enter video ID (e.g., 5iw4w6QUxVz8):</p>
        <input type="text" id="videoId" placeholder="Video ID" value="5iw4w6QUxVz8">
        <button onclick="loadVideo()">Load Video</button>
        <div id="player"></div>
      </div>
      
      <script>
        function loadVideo() {
          const id = document.getElementById('videoId').value;
          if (id) {
            document.getElementById('player').innerHTML = 
              '<iframe src="/proxy?id=' + id + '&autoPlay=1"></iframe>';
          }
        }
        
        // Auto-load example
        window.onload = function() {
          loadVideo();
        };
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`✅ Megacloud proxy running on http://localhost:${PORT}`);
  console.log(`📺 Try: http://localhost:${PORT}/proxy?id=5iw4w6QUxVz8`);
});