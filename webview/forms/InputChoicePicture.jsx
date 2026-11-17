import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { standardPicture } from './standard-pictures.mjs';
import { choicePictureBounds, inactiveChoicePicture } from './choice-picture-paint.mjs';
import { paintCanvas } from './native-control-paint.js';
import { useStandardPicturePixelScale, useStandardPictureVariant } from './NativeStandardPicture.jsx';
import { scaleRaster } from './raster-scale.mjs';

function ChoicePictureRaster(props) {
  let canvas;
  const [common, setCommon] = createSignal();
  const [variantImage, setVariantImage] = createSignal();
  const asset = createMemo(() => {
    if (props.picture.kind !== 'common') return;
    const picture = props.assets.find(asset => asset.id === props.picture.source)?.picture;
    // Reconciliation preserves the resource identity when an external file changes.
    return picture && { source: `data:${picture.mimeType};base64,${picture.data}`, isTemplate: picture.isTemplate };
  });
  const standard = createMemo(() => props.picture.kind === 'standard' ? standardPicture(props.picture.name) : undefined);
  const scalable = () => props.os === 'linux' && !!standard() && !standard().isTemplate;
  const variant = useStandardPictureVariant(() => props.picture.name, scalable);
  const standardScale = useStandardPicturePixelScale();
  const pixelScale = () => scalable() ? standardScale() : undefined;
  createEffect(on(variant, source => {
    setVariantImage(undefined);
    if (!source) return;
    const image = new Image();
    image.onload = () => setVariantImage({ image, source });
    image.src = source;
    onCleanup(() => { image.onload = null; });
  }));
  createEffect(on(asset, value => {
    setCommon(undefined);
    if (!value) return;
    const image = new Image();
    image.onload = () => setCommon({
      image, width: image.naturalWidth, height: image.naturalHeight, isTemplate: value.isTemplate,
    });
    image.src = value.source;
    onCleanup(() => { image.onload = null; });
  }));
  const logicalImage = () => standard() ?? common();
  const bounds = createMemo(() => logicalImage() && choicePictureBounds(logicalImage(), props.height));
  createEffect(() => {
    const image = logicalImage(), box = bounds();
    if (!canvas || !box || !image) return;
    const scale = pixelScale();
    const width = Math.max(1, Math.round(box.width * (scale ?? 1)));
    const height = Math.max(1, Math.round(box.height * (scale ?? 1)));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    const loaded = variantImage();
    if (loaded && variant() === loaded.source) {
      context.drawImage(loaded.image, 0, 0, width, height);
    } else if (image.rgba && (scale || image.width === width && image.height === height)) {
      paintCanvas(canvas, scaleRaster(image, width, height));
    } else {
      let source = image.image;
      if (image.rgba) {
        source = document.createElement('canvas');
        paintCanvas(source, image);
      }
      context.drawImage(source, 0, 0, width, height);
    }
    if (image.isTemplate) {
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = getComputedStyle(canvas).color;
      context.fillRect(0, 0, width, height);
    }
    if (props.inactive && props.os === 'linux') {
      const pixels = context.getImageData(0, 0, width, height);
      inactiveChoicePicture(pixels.data);
      context.putImageData(pixels, 0, 0);
    }
  });
  return <Show when={bounds()} fallback={props.fallback}>
    {box => <canvas ref={canvas} class="taxi-input-choice-picture" aria-hidden="true"
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
