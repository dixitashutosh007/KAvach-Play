const fetch = require('node-fetch');

async function getExpandedUrl(shortUrl) {
  try {
    const res = await fetch(shortUrl, { redirect: 'manual' });
    console.log('Status:', res.status);
    console.log('Location:', res.headers.get('location'));
    if (res.status >= 300 && res.status < 400) {
        return res.headers.get('location');
    }
  } catch(e) {
      console.error(e);
  }
}
getExpandedUrl('https://goo.gl/maps/').then(console.log);
