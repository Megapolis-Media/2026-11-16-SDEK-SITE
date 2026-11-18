// Run inside the deployed container: docker compose exec -T web node scripts/register-support.mjs
// Domain verification calls the site's public bridge, so run after it is serving.
const key = process.env.CDEK_SUPPORT_PLATFORM_KEY?.trim() ?? '';
const base = new URL(process.env.CDEK_SUPPORT_PLATFORM_URL || 'https://help.megapolis.media/websites/api/v1');
const site = new URL(process.env.CDEK_SUPPORT_SITE_ORIGIN || 'https://cdek-fm.ru');
if (!/^[A-Za-z0-9_-]{20,512}$/.test(key) || [base, site].some(url => url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
  || site.pathname !== '/') throw new Error('Configure the server-only support URL, origin and integration key first.');
const response = await fetch(base.href.replace(/\/$/, '') + '/register', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
  headers: { authorization: 'Bearer ' + key, 'X-Support-Origin': site.origin, 'content-type': 'application/json' },
  body: JSON.stringify({ origin: site.origin, name: 'CDEK FM' }),
});
if (!response.ok) { await response.body?.cancel(); throw new Error('Support domain registration returned HTTP ' + response.status); }
const data = await response.json();
if (data?.domain?.origin !== site.origin || data.domain.status !== 'healthy' || !data.domain.verifiedAt)
  throw new Error('Support bridge is not verified. Check the public proof endpoint and configured integration.');
console.log('Central support bridge verified for ' + site.origin);
