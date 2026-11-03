import {MAX_PHOTO_BYTES} from './photos.ts';

const longestSide = 1600;
const maxOriginalBytes = 100 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Your browser could not read this photo. Choose a JPEG, PNG or WebP image.'));
    };
    image.src = url;
  });
}

export async function compressPhoto(file: File): Promise<Blob> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP photo. For HEIC, export a JPEG copy first.');
  }
  if (file.size > maxOriginalBytes) throw new Error('Choose a photo up to 100 MB.');

  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    while (true) {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare this photo.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.86, 0.74, 0.62]) {
        const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!jpeg) throw new Error('Your browser could not compress this photo.');
        if (jpeg.type === 'image/jpeg' && jpeg.size > 0 && jpeg.size <= MAX_PHOTO_BYTES) return jpeg;
      }
      if (Math.max(width, height) <= 256) throw new Error('Could not prepare a small enough JPEG. Try another photo.');
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
  } finally {
    canvas.width = canvas.height = 1;
    image.removeAttribute('src');
  }
}
