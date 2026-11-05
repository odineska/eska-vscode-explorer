// Native spreadsheet headers use a fixed six-pixel bevel; text uses the shared font face.
const headers={"normal":{"topLeft":[[207,191,160,160,160,160],[191,239,255,255,255,255],[160,255,255,255,255,255],[160,255,255,255,255,255],[160,255,255,255,255,255],[160,255,255,255,255,255]],"topRight":[[160,160,160,160,191,207],[255,255,255,255,239,191],[255,255,255,251,250,160],[255,255,252,251,250,160],[255,253,252,251,250,160],[254,253,252,251,250,160]],"bottomLeft":[[160,255,255,255,255,254],[160,255,255,255,253,253],[160,255,255,252,252,252],[160,255,251,251,251,251],[191,239,250,250,250,250],[207,191,160,160,160,160]],"bottomRight":[[255,253,252,251,250,160],[253,255,252,251,250,160],[252,252,255,251,250,160],[251,251,251,255,250,160],[250,250,250,250,239,191],[160,160,160,160,191,207]],"top":[160,255,255,255,255,255],"bottom":[254,253,252,251,250,160],"left":[160,255,255,255,255,255],"right":[254,253,252,251,250,160],"center":255},"selected":{"topLeft":[[207,186,160,160,160,160],[186,225,244,244,244,244],[160,244,243,243,243,243],[160,244,243,242,242,242],[160,244,243,242,241,241],[160,244,243,242,241,240]],"topRight":[[160,160,160,160,186,207],[244,244,244,244,225,186],[243,243,243,235,234,160],[242,242,236,235,234,160],[241,237,236,235,234,160],[238,237,236,235,234,160]],"bottomLeft":[[160,244,243,242,241,238],[160,244,243,242,237,237],[160,244,243,236,236,236],[160,244,235,235,235,235],[186,225,234,234,234,234],[207,186,160,160,160,160]],"bottomRight":[[239,237,236,235,234,160],[237,239,236,235,234,160],[236,236,239,235,234,160],[235,235,235,239,234,160],[234,234,234,234,225,186],[160,160,160,160,186,207]],"top":[160,244,243,242,241,240],"bottom":[238,237,236,235,234,160],"left":[160,244,243,242,241,240],"right":[238,237,236,235,234,160],"center":239}};
export function spreadsheetSurfaceSize(width,height){return Number.isInteger(width)&&Number.isInteger(height)&&width>=15&&height>=16&&width<=4096&&height<=4096&&width*height<=4194304;}

/** Draws the static empty native spreadsheet, including numeric headers when requested. */
export function spreadsheetSurfaceRgba(width,height,grid=false,showHeaders=false,raster){
 if(!spreadsheetSurfaceSize(width,height)||showHeaders&&typeof raster!=='function')return undefined;
 const data=new Uint8ClampedArray((width-2)*(height-2)*4);data.fill(255);
 function pixel(x,y,rgb){if(x<=0||x>=width-1||y<=0||y>=height-1)return;const i=((y-1)*(width-2)+x-1)*4;for(let c=0;c<3;c++)data[i+c]=typeof rgb==='number'?rgb:rgb[c];}
 function rect(x,y,w,h,value){for(let b=y;b<y+h;b++)for(let a=x;a<x+w;a++)pixel(a,b,value);}
 function header(x,y,w,h,selected=false){const p=headers[selected?'selected':'normal'];for(let b=0;b<h;b++)for(let a=0;a<w;a++){
  const left=a<6,right=a>=w-6,top=b<6,bottom=b>=h-6,xx=right?a-w+6:a,yy=bottom?b-h+6:b;
  const value=top?left?p.topLeft[yy][xx]:right?p.topRight[yy][xx]:p.top[yy]:bottom?left?p.bottomLeft[yy][xx]:right?p.bottomRight[yy][xx]:p.bottom[yy]:left?p.left[xx]:right?p.right[xx]:p.center;pixel(x+a,y+b,value);
 }}
 function text(value,pen,baseline,bold){const valueRaster=raster(String(value),bold);for(const g of valueRaster.glyphs)for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++){
  const tx=pen+g.pen+g.left+x,ty=baseline-g.top+y;if(tx<=0||tx>=width-1||ty<=0||ty>=height-1)continue;const i=((ty-1)*(width-2)+tx-1)*4,a=(y*g.columns+x)*3;
  // The native LCD operation adds rounded premultiplied terms over the bevel.
  for(let c=0;c<3;c++){const coverage=g.coverage[a+c];data[i+c]=Math.round(51*coverage/255)+Math.round(data[i+c]*(255-coverage)/255);}
 }}
 let originX=0,originY=0;
 if(showHeaders){originX=35;originY=15;const columns=Math.ceil((width-2-35)/63),rows=Math.ceil((height-2-15)/15);
  for(let col=1;col<=columns;col++)header(35+(col-1)*63,1,64,15,col===1);
  for(let row=1;row<=rows;row++)header(1,row*15,35,16,row===1);
  header(1,1,35,15);
  for(let col=1;col<=columns;col++){const advance=String(col).length*6;text(col,Math.round(35+(col-1)*63+(63-advance)/2),13,col===1);}
  for(let row=1;row<=rows;row++){const advance=String(row).length*6;text(row,Math.round(1+(34-advance)/2),11+row*15,row===1);}
 }
 rect(originX+1,originY+1,64,16,[211,217,239]);rect(originX+2,originY+2,60,12,255);rect(originX+3,originY+3,58,10,[237,239,248]);
 if(grid){for(let x=originX+63;x<width-1;x+=63)rect(x,originY+1,1,height-2-originY,229);for(let y=originY+15;y<height-1;y+=15)rect(originX+1,y,width-2-originX,1,229);}
 return data;
}
