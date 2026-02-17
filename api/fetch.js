export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, User-Agent, X-Requested-With');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Only GET requests are supported' 
    });
  }

  try {
    // Get parameters from query string
    const { id, server } = req.query;

    // Validate ID parameter
    if (!id) {
      return res.status(400).json({
        error: 'Missing parameter',
        message: 'Episode ID is required'
      });
    }

    console.log(`Fetching episode sources for ID: ${id}`);

    // Fetch episode sources from Hianime
    const episodeResponse = await fetch(
      `https://hianime.to/ajax/v2/episode/sources?id=${id}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://hianime.to/',
          'Origin': 'https://hianime.to',
          'X-Requested-With': 'XMLHttpRequest',
          'Connection': 'keep-alive'
        }
      }
    );

    if (!episodeResponse.ok) {
      throw new Error(`Failed to fetch episode sources: ${episodeResponse.status} ${episodeResponse.statusText}`);
    }

    const episodeData = await episodeResponse.json();

    // Extract sources from the response
    const sources = episodeData?.sources || [];
    const tracks = episodeData?.tracks || [];

    // If sources is a string (sometimes it comes as JSON string), parse it
    let parsedSources = sources;
    if (typeof sources === 'string') {
      try {
        parsedSources = JSON.parse(sources);
      } catch (e) {
        console.error('Failed to parse sources string:', e);
      }
    }

    // Process sources to ensure they have proper format
    const processedSources = Array.isArray(parsedSources) ? parsedSources.map((source, index) => {
      if (typeof source === 'string') {
        return {
          file: source,
          label: `Server ${index + 1}`,
          server: `server${index + 1}`,
          type: 'hls'
        };
      }
      return {
        file: source.file || source.url || '',
        label: source.label || `Server ${index + 1}`,
        server: source.server || `server${index + 1}`,
        type: source.type || 'hls'
      };
    }) : [];

    // Server selection logic
    let selectedSource = null;
    if (server && processedSources.length > 0) {
      const serverLower = server.toLowerCase();
      
      // Try different matching strategies
      selectedSource = processedSources.find(source => 
        source.server?.toLowerCase() === serverLower ||
        source.label?.toLowerCase() === serverLower ||
        source.label?.toLowerCase().includes(serverLower)
      );

      // If no match found by name, try by index
      if (!selectedSource && !isNaN(parseInt(server))) {
        const index = parseInt(server);
        if (index >= 0 && index < processedSources.length) {
          selectedSource = processedSources[index];
        }
      }
    }

    // Prepare response data
    const responseData = {
      success: true,
      episodeId: id,
      sources: processedSources,
      tracks: tracks,
      selectedServer: selectedSource || (processedSources.length > 0 ? processedSources[0] : null),
      availableServers: processedSources.map((source, index) => ({
        server: source.server || `server${index + 1}`,
        label: source.label || `Server ${index + 1}`,
        file: source.file,
        type: source.type || 'hls'
      }))
    };

    // Add helpful message if server was requested but not found
    if (server && !selectedSource && processedSources.length > 0) {
      responseData.message = `Server '${server}' not found. Available servers: ${processedSources.map(s => s.label || s.server).join(', ')}`;
    }

    // Return the response
    res.status(200).json(responseData);

  } catch (error) {
    console.error('API Error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}