 import axios from "axios";

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36";

export default async function handler(req, res) {
  let { url } = req.query;

  if (!url) return res.status(400).send("Missing url");

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://megacloud.blog/",
      },
      responseType: "arraybuffer",
    });

    let contentType = response.headers["content-type"];

    // If HTML, rewrite all links
    if (contentType && contentType.includes("text/html")) {
      let html = response.data.toString("utf-8");

      const base = new URL(url).origin;

      // Rewrite src="/..."
      html = html.replace(
        /src="\/(.*?)"/g,
        `src="/api/proxy?url=${base}/$1"`
      );

      html = html.replace(
        /href="\/(.*?)"/g,
        `href="/api/proxy?url=${base}/$1"`
      );

      html = html.replace(
        /src="https:\/\/(.*?)"/g,
        `src="/api/proxy?url=https://$1"`
      );

      html = html.replace(
        /href="https:\/\/(.*?)"/g,
        `href="/api/proxy?url=https://$1"`
      );

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } else {
      // For JS, CSS, m3u8, ts
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.send(response.data);
    }
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}