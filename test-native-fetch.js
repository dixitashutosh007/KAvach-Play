async function getExpandedUrl() {
  try {
    const res = await fetch('https://t.co/fB29yMvMhG', { method: 'HEAD', redirect: 'follow' }); 
    console.log('Final URL:', res.url);
  } catch(e) {
      console.error(e);
  }
}
getExpandedUrl();
