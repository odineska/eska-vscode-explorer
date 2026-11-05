import {createEffect} from 'solid-js';

export function NativeStandardPicture(props) {
  let canvas;
  createEffect(() => {
    const image = props.image;
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  });
  return <canvas ref={canvas} class="taxi-icon" data-native-picture="ready" aria-hidden="true" style={{'pointer-events':'none'}}/>;
}
