// Redimensiona una imagen EN EL NAVEGADOR (canvas) y la devuelve como data URL JPEG.
// Esto evita payloads enormes (otra causa de 400/413) y normaliza el formato.
// Es el único "procesamiento local"; no se sube nada a ningún servidor propio.

export function resizeImage(file, { maxDim = 1280, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`No se pudo leer "${file.name}".`));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(`"${file.name}" no es una imagen válida.`));
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; // JPEG no tiene transparencia
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        resolve({ dataUrl: canvas.toDataURL('image/jpeg', quality), name: file.name });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
