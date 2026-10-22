// /download sends the browser straight to the newest Windows installer, so visitors never land on GitHub.
// The redirect is cached at Netlify's edge to stay well under GitHub's unauthenticated API rate limit.
const RELEASES = 'https://api.github.com/repos/Fozmu/fs-editor-releases/releases/latest';
const FALLBACK = 'https://github.com/Fozmu/fs-editor-releases/releases/latest';

export default async () => {
  let location = FALLBACK;
  try {
    const res = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'editor.fozmu.com' } });
    if (res.ok) {
      const exe = (await res.json()).assets?.find((a: { name: string }) => a.name.endsWith('.exe'));
      if (exe) location = exe.browser_download_url;
    }
  } catch {
    // fall through to the releases page
  }
  const cached = location !== FALLBACK;
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'cache-control': 'no-store',
      'netlify-cdn-cache-control': cached ? 'public, s-maxage=300, stale-while-revalidate=86400' : 'no-store',
    },
  });
};

export const config = { path: '/download', cache: 'manual' };
