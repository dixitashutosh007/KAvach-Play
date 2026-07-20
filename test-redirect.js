const https = require('https');

function getRedirectUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(url);
      }
    }).on('error', reject);
  });
}

getRedirectUrl('https://maps.app.goo.gl/9uH1mQn4Z4H3C8nB8').then(console.log).catch(console.error); // just a random or dummy
