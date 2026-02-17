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
          'X-Requested-With': 'XMLHttpRequest'
        }
      }
    );

    if (!episodeResponse.ok) {
      throw new Error(`Failed to fetch episode sources: ${episodeResponse.status} ${episodeResponse.statusText}`);
    }

    const data = await episodeResponse.json();
    
    // Handle the actual response structure
    const responseData = {
      success: true,
      episodeId: id,
      type: data.type || 'iframe',
      link: data.link || null,
      server: data.server || null,
      embedData: null,
      sources: [],
      tracks: []
    };

    // If there's an iframe link, try to fetch its content
    if (data.link) {
      try {
        // Attempt to fetch the iframe content to get actual video sources
        const embedResponse = await fetch(data.link, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://hianime.to/'
          }
        });

        if (embedResponse.ok) {
          const embedHtml = await embedResponse.text();
          
          // Try to extract video sources from the embed HTML
          // This is a simple example - you might need more sophisticated parsing
          const sourceMatches = embedHtml.match(/source src="([^"]+)"|file:"([^"]+)"|url:"([^"]+)"/g);
          
          if (sourceMatches) {
            responseData.embedData = {
              html: embedHtml.substring(0, 500) + '...', // First 500 chars
              sourceCount: sourceMatches.length
            };
          }
        }
      } catch (embedError) {
        console.error('Error fetching embed:', embedError.message);
        responseData.embedError = embedError.message;
      }
    }

    // If there are sources in the response, use them
    if (data.sources && data.sources.length > 0) {
      responseData.sources = data.sources;
    }

    // If there are tracks in the response, use them
    if (data.tracks && data.tracks.length > 0) {
      responseData.tracks = data.tracks;
    }

    // Add a note about the iframe structure
    if (data.type === 'iframe' && data.link) {
      responseData.note = 'This episode uses an iframe embed. The actual video source is at the link URL. You may need to extract the video URL from the embedded page.';
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