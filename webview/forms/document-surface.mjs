import {number} from './model.mjs';

/** Measured empty native document surfaces use form-character width and editor-row height. */
export function documentSurfaceMetrics(node,os){
 const value=node.presentation.font,width=number(node,'Width'),height=number(node,'Height');
 const font=value.points===10&&value.weight===400&&!value.italic&&!value.underline&&!value.strikeout
  &&(!value.face||['Arial','Liberation Sans'].includes(value.face));
 const dimensions=(width===0||Number.isInteger(width)&&width>=15)&&(height===0||Number.isInteger(height)&&height>=2);
 const calibrated=os==='linux'&&font&&dimensions;
 return {calibrated,width:width>0?calibrated?width*10:Math.max(15,width)*8+4:500,
  height:height>0?calibrated?height*25-7:Math.max(2,height)*20+3:243};
}
