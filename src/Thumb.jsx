import { useEffect, useRef } from 'react';
import { drawAssetFront } from './assetRender.js';

export default function Thumb({ frame }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current, x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);

    const drawModel = () => {
      x.save();
      x.translate(c.width / 2, c.height / 2);
      x.scale(c.width * 0.86, c.width * 0.86);
      drawAssetFront(x, frame.asset, {
        frameColor: frame.overrides?.frameColor || '#f2f0eb',
        lensColor: '#000', lensOpacity: 0.05, temples: false,
        thickness: frame.overrides?.thickness ?? 1,
      });
      x.restore();
    };

    if (frame.srcThumb) {
      const img = new Image();
      img.onload = () => {
        x.clearRect(0, 0, c.width, c.height);
        const s = Math.max(c.width / img.width, c.height / img.height);
        x.globalAlpha = 0.5;
        x.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
        x.globalAlpha = 1;
        drawModel();
      };
      img.src = frame.srcThumb;
    } else {
      drawModel();
    }
  }, [frame]);
  return <canvas ref={ref} width={176} height={88} />;
}
