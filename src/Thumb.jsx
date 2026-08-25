import { useEffect, useRef } from 'react';
import { drawVector } from './frame.js';

export default function Thumb({ frame }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.save();
    x.translate(c.width / 2, c.height / 2); x.scale(c.width, c.width);
    if (frame.canvas) {
      const ar = frame.canvas.height / frame.canvas.width;
      x.drawImage(frame.canvas, -0.5, -ar / 2, 1, ar);
    } else drawVector(x, frame.shape, '#f2f0eb', '#ffffff10');
    x.restore();
  }, [frame]);
  return <canvas ref={ref} width={176} height={88} />;
}
