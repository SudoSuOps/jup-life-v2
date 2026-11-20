// Google Search Console ownership file. Served by a Function so Pages doesn't 308 it to the extensionless URL.
export const onRequestGet = () =>
  new Response('google-site-verification: google05d7f4db1ec67c25.html', {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
