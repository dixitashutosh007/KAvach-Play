const https = require('https');

function resolveUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Location:', res.headers.location);
      if (res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(url);
      }
    });
  });
}

resolveUrl('https://maps.app.goo.gl/9c38oHjK1dC5xJj26').then(console.log); // I just made this up, probably 404.
