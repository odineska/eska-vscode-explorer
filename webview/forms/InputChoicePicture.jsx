import { Show, createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js';
import { standardPicture } from './standard-pictures.mjs';
import { choicePictureBounds, inactiveChoicePicture } from './choice-picture-paint.mjs';
import { paintCanvas } from './native-control-paint.js';

function ChoicePictureRaster(props) {
  let canvas;
  const [common, setCommon] = createSignal();
  const asset = createMemo(() => {
    if (props.picture.kind !== 'common') return;
    const picture = props.assets.find(asset => asset.id === props.picture.source)?.picture;
    // Reconciliation preserves the resource identity when an external file changes.
    return picture && { source: `data:${picture.mimeType};base64,${picture.data}`, isTemplate: picture.isTemplate };
  });
  const standard = createMemo(() => props.picture.kind === 'standard' ? standardPicture(props.picture.name) : undefined);
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
  const source = () => standard() ?? common();
  const bounds = createMemo(() => source() && choicePictureBounds(source(), props.height));
  createEffect(() => {
    const image = source(), box = bounds();
    if (!canvas || !box) return;
    canvas.width = box.width;
    canvas.height = box.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (image.rgba && image.width === box.width && image.height === box.height) {
      paintCanvas(canvas, image);
    } else {
      let source = image.image;
      if (image.rgba) {
        source = document.createElement('canvas');
        paintCanvas(source, image);
      }
      context.drawImage(source, 0, 0, box.width, box.height);
    }
    if (image.isTemplate) {
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = getComputedStyle(canvas).color;
      context.fillRect(0, 0, box.width, box.height);
    }
    if (props.inactive && props.os === 'linux') {
      const pixels = context.getImageData(0, 0, box.width, box.height);
      inactiveChoicePicture(pixels.data);
      context.putImageData(pixels, 0, 0);
    }
  });
  return <Show when={bounds()} fallback={props.fallback}>
    {box => <canvas ref={canvas} class="taxi-input-choice-picture" aria-hidden="true"
      data-choice-picture-inactive={props.inactive ? '' : undefined}
      style={{ left: `${box().x}px`, top: `${box().y}px` }}/>}
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
