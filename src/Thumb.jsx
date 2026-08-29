import { useEffect, useRef } from 'react';
import { drawVector } from './frame.js';

export default function Thumb({ frame }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);

    if (frame.srcThumb) {                       // uploaded photo: show it, model outline on top
      const img = new Image();
      img.onload = () => {
        x.clearRect(0, 0, c.width, c.height);
        const s = Math.max(c.width / img.width, c.height / img.height);
        x.globalAlpha = 0.55;
        x.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
        x.globalAlpha = 1;
        x.save();
        x.translate(c.width / 2, c.height / 2); x.scale(c.width, c.width);
        drawVector(x, frame.shape, '#f2f0eb', '#00000000', 0, frame.rim || 1);
        x.restore();
      };
      img.src = frame.srcThumb;
      return;
    }

    x.save();
    x.translate(c.width / 2, c.height / 2); x.scale(c.width, c.width);
    if (frame.canvas) {
      const ar = frame.canvas.height / frame.canvas.width;
      x.drawImage(frame.canvas, -0.5, -ar / 2, 1, ar);
    } else drawVector(x, frame.shape, '#f2f0eb', '#ffffff10', 0, frame.rim || 1);
    x.restore();
  }, [frame]);
  return <canvas ref={ref} width={176} height={88} />;
}
