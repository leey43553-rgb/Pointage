const MAX_WIDTH_PX = 800;
const MAX_TARGET_BYTES = 150 * 1024; // 150 KB

function loadImageFromFile(file: File): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ img, revoke: () => URL.revokeObjectURL(objectUrl) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Impossible de lire l'image capturée."));
    };
    img.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Échec de la compression de l'image."));
          return;
        }
        resolve(blob);
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Compresses an image in the browser (max 800px wide, JPEG quality ~0.7)
 * so the resulting file is under 150 KB.
 */
export async function compressAttendancePhoto(
  file: File
): Promise<{ blob: Blob; previewUrl: string }> {
  try {
    const { img, revoke } = await loadImageFromFile(file);

    try {
      let targetWidth = img.naturalWidth || img.width || MAX_WIDTH_PX;
      let targetHeight = img.naturalHeight || img.height || MAX_WIDTH_PX;

      if (targetWidth > MAX_WIDTH_PX) {
        targetHeight = Math.max(1, Math.round((targetHeight * MAX_WIDTH_PX) / targetWidth));
        targetWidth = MAX_WIDTH_PX;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Navigateur incompatible avec le traitement photo.');
      }

      const drawAndEncode = async (w: number, h: number, quality: number): Promise<Blob> => {
        canvas.width = w;
        canvas.height = h;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        return canvasToJpegBlob(canvas, quality);
      };

      const qualities = [0.7, 0.55, 0.42, 0.3];
      let blob = await drawAndEncode(targetWidth, targetHeight, qualities[0]);

      for (let i = 1; i < qualities.length && blob.size > MAX_TARGET_BYTES; i++) {
        blob = await drawAndEncode(targetWidth, targetHeight, qualities[i]);
      }

      // If still above 150 KB on very high-detail sensors, step down dimensions slightly
      if (blob.size > MAX_TARGET_BYTES && targetWidth > 600) {
        const smallerWidth = 600;
        const smallerHeight = Math.max(1, Math.round((targetHeight * smallerWidth) / targetWidth));
        blob = await drawAndEncode(smallerWidth, smallerHeight, 0.55);
        if (blob.size > MAX_TARGET_BYTES) {
          blob = await drawAndEncode(smallerWidth, smallerHeight, 0.35);
        }
      }

      const previewUrl = URL.createObjectURL(blob);
      return { blob, previewUrl };
    } finally {
      revoke();
    }
  } catch (err) {
    if (
      file.size > 0 &&
      file.size <= MAX_TARGET_BYTES &&
      (!file.type || /^image\/(jpeg|png|webp)$/i.test(file.type))
    ) {
      return {
        blob: file,
        previewUrl: URL.createObjectURL(file),
      };
    }
    throw err;
  }
}
