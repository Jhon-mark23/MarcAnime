const express = require('express');
const axios = require('axios');
const cors = require('cors');

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
                          decodedUrl.includes('video');

    console.log(`Proxying ${isMegacloud ? 'Megacloud' : ''} request to:`, decodedUrl);

    // Set appropriate headers based on target domain
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'iframe',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache'
    };

    // Add domain-specific headers
    if (decodedUrl.includes('megacloud.blog') || decodedUrl.includes('megacloud.tv')) {
      headers['Referer'] = 'https://megacloud.blog/';
      headers['Origin'] = 'https://megacloud.blog';
      headers['Host'] = new URL(decodedUrl).hostname;
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
      timeout: 30000
    });

    // Copy relevant headers from the target response
    const headersToCopy = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'set-cookie',
      'cf-cache-status',
      'cf-ray'
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

    // Handle HTML responses (like Megacloud embeds)
    if (response.headers['content-type']?.includes('text/html')) {
      let html = response.data.toString('utf-8');
      
      // For Megacloud embeds, modify the HTML to work through proxy
      if (isMegacloud) {
        html = modifyMegacloudHtml(html, decodedUrl);
      } else {
        // General HTML modification
        html = modifyHtmlUrls(html, decodedUrl);
      }
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    // Handle video streaming
    if (isVideoRequest || response.headers['content-type']?.includes('video') || 
        response.headers['content-type']?.includes('application/vnd.apple.mpegurl')) {
      
      if (!res.getHeader('content-type')) {
        if (decodedUrl.includes('.m3u8')) {
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        } else if (decodedUrl.includes('.mp4')) {
          res.setHeader('Content-Type', 'video/mp4');
        }
      }

      if (req.headers.range) {
        res.status(206);
      }

      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(Buffer.from(response.data));
      
      return bufferStream.pipe(res);
    }

    // Handle JSON responses
    if (response.headers['content-type']?.includes('application/json')) {
      try {
        const jsonData = JSON.parse(response.data.toString('utf-8'));
        return res.json(jsonData);
      } catch {
        return res.send(response.data);
      }
    }

    // Default: send as is
    res.send(response.data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    
    // Return an error HTML page for iframe requests
    if (req.headers.accept?.includes('text/html')) {
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Proxy Error</title>
          <style>
            body { font-family: Arial; background: #1a1a2e; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .error { text-align: center; padding: 20px; background: #16213e; border-radius: 10px; border: 1px solid #ff4444; }
            h2 { color: #ff4444; }
            p { color: #888; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>❌ Proxy Error</h2>
            <p>${error.message}</p>
          </div>
        </body>
        </html>
      `);
    }
    
    res.status(500).json({ error: 'Proxy failed', message: error.message });
  }
});

// Special endpoint for Megacloud embeds
app.get('/embed/:id', async (req, res) => {
  const { id } = req.params;
  const { k = 1, autoPlay = 0, oa = 0, asi = 1 } = req.query;
  
  const embedUrl = `https://megacloud.blog/embed-2/v3/e-1/${id}?k=${k}&autoPlay=${autoPlay}&oa=${oa}&asi=${asi}`;
  
  try {
    const response = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Referer': 'https://megacloud.blog/',
        'Origin': 'https://megacloud.blog',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    let html = response.data;
    html = modifyMegacloudHtml(html, embedUrl);
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(html);
    
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="background:#1a1a2e; color:white; display:flex; justify-content:center; align-items:center; height:100vh;">
        <div style="text-align:center;">
          <h2 style="color:#ff4444;">Failed to load embed</h2>
          <p>${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Helper function to modify Megacloud HTML
function modifyMegacloudHtml(html, baseUrl) {
  try {
    const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    const proxyBase = `/api?url=`;
    
    // Add base tag and meta headers
    html = html.replace('<head>', 
      '<head>\n' +
      '<base href="' + base + '">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;">\n' +
      '<meta http-equiv="X-Content-Security-Policy" content="default-src * \'unsafe-inline\' \'unsafe-eval\' data: blob:;">\n'
    );
    
    // Modify script tags
    html = html.replace(/<script([^>]*) src="([^"]+)"([^>]*)>/gi, (match, before, src, after) => {
      if (!src.includes('googletagmanager') && !src.includes('cloudflareinsights')) {
        if (src.startsWith('/')) {
          const fullUrl = base + src.substring(1);
          return `<script${before} src="${proxyBase}${encodeURIComponent(fullUrl)}"${after}>`;
        } else if (!src.startsWith('http')) {
          const fullUrl = base + src;
          return `<script${before} src="${proxyBase}${encodeURIComponent(fullUrl)}"${after}>`;
        }
      }
      return match;
    });
    
    // Modify link tags for CSS
    html = html.replace(/<link([^>]*) href="([^"]+)"([^>]*)>/gi, (match, before, href, after) => {
      if (href.endsWith('.css')) {
        if (href.startsWith('/')) {
          const fullUrl = base + href.substring(1);
          return `<link${before} href="${proxyBase}${encodeURIComponent(fullUrl)}"${after}>`;
        } else if (!href.startsWith('http')) {
          const fullUrl = base + href;
          return `<link${before} href="${proxyBase}${encodeURIComponent(fullUrl)}"${after}>`;
        }
      }
      return match;
    });
    
    // Add proxy interceptor script
    const interceptorScript = `
    <script>
      // Intercept and proxy resource requests
      (function() {
        const originalFetch = window.fetch;
        const PROXY_URL = '${proxyBase}';
        
        window.fetch = function(url, options = {}) {
          if (typeof url === 'string' && url.startsWith('http') && !url.includes('${base}')) {
            url = PROXY_URL + encodeURIComponent(url);
          }
          return originalFetch.call(this, url, options);
        };
        
        // Proxy XMLHttpRequest
        const XHR = XMLHttpRequest;
        window.XMLHttpRequest = function() {
          const xhr = new XHR();
          const open = xhr.open;
          xhr.open = function(method, url, ...args) {
            if (typeof url === 'string' && url.startsWith('http') && !url.includes('${base}')) {
              url = PROXY_URL + encodeURIComponent(url);
            }
            return open.call(this, method, url, ...args);
          };
          return xhr;
        };
        
        // Handle dynamically added scripts
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.tagName === 'SCRIPT' && node.src) {
                if (node.src.startsWith('http') && !node.src.includes('${base}')) {
                  node.src = PROXY_URL + encodeURIComponent(node.src);
                }
              }
            });
          });
        });
        
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
        
        console.log('Proxy interceptor active');
      })();
    </script>
    `;
    
    html = html.replace('</head>', interceptorScript + '\n</head>');
    
    return html;
    
  } catch (e) {
    console.error('Error modifying HTML:', e);
    return html;
  }
}

// Helper function to modify HTML URLs
function modifyHtmlUrls(html, baseUrl) {
  try {
    const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
    const proxyBase = `/api?url=`;
    
    html = html.replace(/(src|href)="([^"]+)"/gi, (match, attr, value) => {
      if (value.startsWith('http') || value.startsWith('//')) {
        return match;
      }
      if (value.startsWith('/')) {
        const fullUrl = base + value.substring(1);
        return `${attr}="${proxyBase}${encodeURIComponent(fullUrl)}"`;
      } else if (!value.startsWith('#') && !value.startsWith('data:')) {
        const fullUrl = base + value;
        return `${attr}="${proxyBase}${encodeURIComponent(fullUrl)}"`;
      }
      return match;
    });
    
    return html;
    
  } catch (e) {
    console.error('Error modifying URLs:', e);
    return html;
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Proxy is running',
    endpoints: ['/api', '/embed/:id', '/health']
  });
});

// Handle 404
app.use((req, res) => {
  if (req.headers.accept?.includes('text/html')) {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head><title>404 Not Found</title></head>
      <body style="background:#1a1a2e; color:white; display:flex; justify-content:center; align-items:center; height:100vh;">
        <div style="text-align:center;">
          <h2 style="color:#ff4444;">404 - Not Found</h2>
          <p>The requested endpoint does not exist</p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

module.exports = app;