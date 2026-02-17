const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());

app.get('/api', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const response = await axios.get(decodeURIComponent(url), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Referer': 'https://hianime.to/',
        'Origin': 'https://hianime.to'
      }
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Proxy failed', message: error.message });
  }
});

module.exports = app;