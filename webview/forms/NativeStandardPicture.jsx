import { Show, createContext, createEffect, createMemo, useContext } from 'solid-js';
import { scaleRaster } from './raster-scale.mjs';
import { selectStandardPictureVariant, standardPicturePixelScale } from './standard-picture-density.mjs';
import { usesStandardPictureArtwork } from './standard-pictures.mjs';
import { webStandardPictures } from './web-standard-pictures.mjs';

export const StandardPictureScaleContext = createContext();

export function useStandardPicturePixelScale() {
  const scale = useContext(StandardPictureScaleContext);
  return createMemo(() => {
    if (!scale) return;
    const { zoom, pixelRatio } = scale();
    return standardPicturePixelScale(zoom, pixelRatio);
  });
}

export function useStandardPictureVariant(name, enabled) {
  const scale = useContext(StandardPictureScaleContext);
  return createMemo(() => {
    if (!scale || !enabled() || typeof name() !== 'string') return;
    const key = name().replace(/^StdPicture\./, '');
    if (!Object.hasOwn(webStandardPictures, key)) return;
    const { zoom, pixelRatio } = scale();
    const variant = selectStandardPictureVariant(webStandardPictures[key], zoom, pixelRatio);
    if (variant) return variant.source;
  });
}

function paint(canvas, image) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
}

export function TemplatePicture(props) {
  const glyphStyle = () => props.glyph ? { width: `${props.glyph.width}px`, height: `${props.glyph.height}px` } : {};
  return <span class="taxi-picture-template" style={{ '--taxi-picture-mask': `url("${props.source}")`, '--taxi-picture-mask-size': props.glyph ? 'auto' : undefined, '--taxi-picture-mask-position': props.glyph ? 'left top' : undefined, ...glyphStyle() }}>
    <img class="taxi-picture-resource" style={{ ...glyphStyle(), 'object-fit': props.glyph ? 'none' : undefined, 'object-position': props.glyph ? 'left top' : undefined }} data-picture-index={props.glyph ? '0' : undefined} src={props.source} data-native-picture={props.native ? 'ready' : undefined} alt="" draggable="false"/>
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

function NativePictureCanvas(props) {
  let canvas;
  const pixelScale = useStandardPicturePixelScale();
  createEffect(() => {
    if (props.image.isTemplate) return;
    const image = props.image, scale = pixelScale() ?? 1;
    paint(canvas, scaleRaster(image, Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale))));
  });
  return <Show when={props.image.isTemplate} fallback={
    <canvas ref={canvas} class="taxi-icon" data-native-picture="ready" aria-hidden="true" style={{ 'pointer-events': 'none' }}/>
  }><NativeTemplatePicture image={props.image}/></Show>;
}

export function NativeStandardPicture(props) {
  const variant = useStandardPictureVariant(() => props.name, () => !props.image.isTemplate
    && usesStandardPictureArtwork(props.name, props.variant));
  return <Show when={variant()} fallback={<NativePictureCanvas image={props.image}/>}>
    {source => <img class="taxi-icon" data-native-picture="ready" src={source()} alt=""
      draggable="false" aria-hidden="true" style={{ 'pointer-events': 'none' }}/>}
  </Show>;
}
