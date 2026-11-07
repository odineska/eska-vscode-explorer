import { Show, createEffect, createMemo } from 'solid-js';

function paint(canvas, image) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
}

export function TemplatePicture(props) {
  return <span class="taxi-picture-template" style={{ '--taxi-picture-mask': `url("${props.source}")` }}>
    <img class="taxi-picture-resource" src={props.source} data-native-picture={props.native ? 'ready' : undefined} alt="" draggable="false"/>
  </span>;
}

function NativeTemplatePicture(props) {
  const source = createMemo(() => {
    const canvas = document.createElement('canvas');
    paint(canvas, props.image);
    return canvas.toDataURL();
  });
  return <TemplatePicture source={source()} native/>;
}

export function NativeStandardPicture(props) {
  let canvas;
  createEffect(() => {
    if (!props.image.isTemplate) paint(canvas, props.image);
  });
  return <Show when={props.image.isTemplate} fallback={
    <canvas ref={canvas} class="taxi-icon" data-native-picture="ready" aria-hidden="true" style={{ 'pointer-events': 'none' }}/>
  }><NativeTemplatePicture image={props.image}/></Show>;
}
