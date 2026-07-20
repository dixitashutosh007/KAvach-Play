const fetch = require('node-fetch');

async function getExpandedUrl() {
  try {
    const res = await fetch('https://t.co/fB29yMvMhG', { method: 'HEAD', redirect: 'follow' }); // twitter short link to a youtube video maybe?
    console.log('Final URL:', res.url);
  } catch(e) {
      console.error(e);
  }
}
getExpandedUrl();
