import { getPosts } from "../posts";
import { site } from "../site";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  const posts = await getPosts();
  const items = posts
    .map((post) => {
      const link = `${site.url}/blog/${post.id}/`;
      return `<item>
  <title>${escapeXml(post.data.title)}</title>
  <description>${escapeXml(post.data.description)}</description>
  <pubDate>${post.data.pubDate.toUTCString()}</pubDate>
  <link>${link}</link>
  <guid>${link}</guid>
</item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>${escapeXml(site.title)}</title>
  <description>${escapeXml(site.description)}</description>
  <link>${site.url}</link>
  ${items}
</channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
