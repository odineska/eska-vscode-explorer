import { Show, createContext, createMemo, useContext } from 'solid-js';
import { standardPicture } from './standard-pictures.mjs';
import { standardPicturePixelScale } from './standard-picture-density.mjs';

export const StandardPictureScaleContext = createContext();

export function useStandardPicturePixelScale(isRaster) {
  const scale = useContext(StandardPictureScaleContext);
  return createMemo(() => {
    if (!scale) return;
    const { zoom, pixelRatio } = scale();
    return standardPicturePixelScale(zoom, pixelRatio, isRaster());
  });
}

export function useStandardPicture(name, variant = () => undefined) {
  const scale = useContext(StandardPictureScaleContext);
  const root = document.getElementById('form-preview-script')?.dataset.pictureRoot;
  return createMemo(() => standardPicture(name(), variant(), root && { root, ...scale?.() }), undefined, {
    equals: (previous, next) => previous === next
      || (previous?.isRaster === true && next?.isRaster === true && previous.source === next.source),
  });
}

export function TemplatePicture(props) {
  const glyphStyle = () => props.glyph ? { width: `${props.glyph.width}px`, height: `${props.glyph.height}px` } : {};
  return <span class="taxi-picture-template" style={{ '--taxi-picture-mask': `url("${props.source}")`, '--taxi-picture-mask-size': props.glyph ? 'auto' : undefined, '--taxi-picture-mask-position': props.glyph ? 'left top' : undefined, ...glyphStyle() }}>
    <img class="taxi-picture-resource" style={{ ...glyphStyle(), 'object-fit': props.glyph ? 'none' : undefined, 'object-position': props.glyph ? 'left top' : undefined }} data-picture-index={props.glyph ? '0' : undefined} src={props.source} data-native-picture={props.vector ? 'vector' : undefined} alt="" draggable="false"/>
  </span>;
}

export function NativeStandardPicture(props) {
  return <Show when={props.image.isTemplate} fallback={
    <img class="taxi-icon" data-native-picture={props.image.isRaster ? 'raster' : 'vector'} src={props.image.source} alt=""
      draggable="false" aria-hidden="true" style={{ 'pointer-events': 'none' }}/>
  }>
    <TemplatePicture source={props.image.source} vector/>
  </Show>;
}
