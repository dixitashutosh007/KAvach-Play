export const compressImage = (base64Str: string, maxWidth = 1000, maxHeight = 1000): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (base64Str && !base64Str.startsWith('data:')) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }
      
      // Preserve transparency if PNG
      if (base64Str.startsWith('data:image/png')) {
        ctx.clearRect(0, 0, width, height);
      } else {
        // Fill white background for JPEGs
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      // Use data URL instead of blob URL to fix iOS html-to-image bug
      const dataUrl = canvas.toDataURL(base64Str.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', 0.85);
      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error("Failed to load image for compression"));
    img.src = base64Str;
  });
};
