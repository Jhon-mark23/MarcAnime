import axios from "axios";

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("Missing url parameter");
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36",
        Referer:
          "https://megacloud.blog/embed-2/v3/e-1/4NambF7510bf?k=1&autoPlay=1&oa=0&asi=1",
      },
      responseType: "arraybuffer",
    });

    res.setHeader(
      "Content-Type",
      response.headers["content-type"] || "text/html"
    );

    res.setHeader("Access-Control-Allow-Origin", "*");

    res.send(response.data);
  } catch (error) {
    res.status(500).send("Proxy Error: " + error.message);
  }
}