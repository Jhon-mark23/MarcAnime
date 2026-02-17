async function getEpisodeServers(episodeId) {
  try {
    const res = await fetch(
      `https://hianime.to/ajax/v2/episode/servers?episodeId=${episodeId}`,
      {
        method: "GET",
        credentials: "include", // important for cookies
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json"
        }
      }
    );

    if (!res.ok) throw new Error("Failed to fetch servers");

    const data = await res.json();
    console.log("Servers:", data);
    return data;
  } catch (err) {
    console.error(err);
  }
}

async function getEpisodeSources(id) {
  try {
    const res = await fetch(
      `https://hianime.to/ajax/v2/episode/sources?id=${id}`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json"
        }
      }
    );

    if (!res.ok) throw new Error("Failed to fetch sources");

    const data = await res.json();
    console.log("Sources:", data);
    return data;
  } catch (err) {
    console.error(err);
  }
}

// Example usage
getEpisodeServers(641755);
getEpisodeSources(641755);