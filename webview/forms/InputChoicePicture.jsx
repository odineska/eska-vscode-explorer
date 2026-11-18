import { Show, createEffect, createMemo, createSignal } from 'solid-js';
import { choicePictureBounds, inactiveChoicePicture } from './choice-picture-paint.mjs';
import { useStandardPicture, useStandardPicturePixelScale } from './NativeStandardPicture.jsx';

function ChoicePictureRaster(props) {
  let canvas;
  const [loaded, setLoaded] = createSignal();
  const standard = useStandardPicture(() => props.picture.kind === 'standard' ? props.picture.name : undefined);
  const asset = createMemo(() => {
    if (standard()) return standard();
    if (props.picture.kind !== 'common') return;
    const picture = props.assets.find(asset => asset.id === props.picture.source)?.picture;
    // Reconciliation preserves the resource identity when an external file changes.
    return picture && { source: `data:${picture.mimeType};base64,${picture.data}`, isTemplate: picture.isTemplate };
  });
  const standardScale = useStandardPicturePixelScale(() => standard()?.isRaster);
  const pixelScale = () => standard()?.isRaster || props.os === 'linux' && standard() && !standard().isTemplate
    ? standardScale() : undefined;
  createEffect(asset, value => {
    setLoaded(undefined);
    if (!value) return;
    const image = new Image();
    image.onload = () => setLoaded({
      image, width: value.isRaster ? value.width : image.naturalWidth,
      height: value.isRaster ? value.height : image.naturalHeight, isTemplate: value.isTemplate,
    });
    if (value.isRaster) image.crossOrigin = 'anonymous';
    image.src = value.source;
    return () => { image.onload = null; };
  });
  const logicalImage = loaded;
  const bounds = createMemo(() => logicalImage() && choicePictureBounds(logicalImage(), props.height));
  createEffect(() => [logicalImage(), bounds(), pixelScale(), props.inactive && props.os === 'linux'],
    ([image, box, scale, inactive]) => {
    if (!canvas || !box || !image) return;
    const width = Math.max(1, Math.round(box.width * (scale ?? 1)));
    const height = Math.max(1, Math.round(box.height * (scale ?? 1)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(image.image, 0, 0, width, height);
    if (image.isTemplate) {
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = getComputedStyle(canvas).color;
      context.fillRect(0, 0, width, height);
    }
    if (inactive) {
      const pixels = context.getImageData(0, 0, width, height);
      inactiveChoicePicture(pixels.data);
      context.putImageData(pixels, 0, 0);
    }
  });
  return <Show when={bounds()} fallback={props.fallback}>
    {box => <canvas ref={canvas} class="taxi-input-choice-picture" aria-hidden="true"
      data-native-picture={standard()?.isRaster ? 'raster' : undefined}
      data-choice-picture-inactive={props.inactive ? '' : undefined}
      style={{
        left: `${box().x}px`, top: `${box().y}px`,
        width: pixelScale() ? `${box().width}px` : undefined,
        height: pixelScale() ? `${box().height}px` : undefined,
      }}/>}
  </Show>;
}

/** An explicit empty selection owns the face. Missing or unloaded assets keep the built-in glyph. */
export function InputChoicePicture(props) {
  return <Show when={props.picture !== null}>
    <Show when={props.picture?.kind !== 'missing' && props.picture} fallback={props.fallback}>
      {picture => <ChoicePictureRaster {...props} picture={picture()}/>}
    </Show>
  </Show>;
}
