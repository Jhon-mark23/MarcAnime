export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    // Fetch episode sources from Hianime
    const episodeResponse = await fetch(
      `https://hianime.to/ajax/v2/episode/sources?id=${id}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://hianime.to/',
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    if (!episodeResponse.ok) {
      throw new Error(`Failed to fetch episode sources: ${episodeResponse.status}`);
    }

    const episodeData = await episodeResponse.json();

    // Extract sources from the response
    const sources = episodeData?.sources || [];
    const tracks = episodeData?.tracks || [];

    // If a specific server is requested, filter the sources
    let selectedSource = null;
    if (server && sources.length > 0) {
      // Find the source matching the requested server
      // You can customize this logic based on how servers are identified
      selectedSource = sources.find(source => 
        source.server?.toLowerCase() === server.toLowerCase() ||
        source.label?.toLowerCase() === server.toLowerCase()
      );
    }

    // Prepare response data
    const responseData = {
      success: true,
      episodeId: id,
      sources: sources,
      tracks: tracks,
      selectedServer: selectedSource || (sources.length > 0 ? sources[0] : null),
      availableServers: sources.map(source => ({
        server: source.server || 'unknown',
        label: source.label || `Server ${sources.indexOf(source) + 1}`,
        file: source.file
      }))
    };

    // Add a helpful message if server was requested but not found
    if (server && !selectedSource && sources.length > 0) {
      responseData.message = `Server '${server}' not found. Available servers: ${sources.map(s => s.server || s.label).join(', ')}`;
    }

    // Return the response
    res.status(200).json(responseData);

  } catch (error) {
    console.error('API Error:', error);
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
}