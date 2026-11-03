/** Small, deterministic pixel patterns. All painting is clipped and restores canvas state. */
export type CarpetPalette='blue'|'sage'|'lilac'|'sand';
export type CarpetPattern='floral'|'diamond'|'weave';
type Ink={base:string;shade:string;line:string;light:string;glint:string};
const carpets:Record<CarpetPalette,Ink>={
 blue:{base:'#88a9d1',shade:'#80a0ca',line:'#a7c5d4',light:'#bdd5dd',glint:'#d7e4df'},
 sage:{base:'#91b49c',shade:'#86aa92',line:'#b6cfb6',light:'#d1dfc3',glint:'#e6ead3'},
 lilac:{base:'#b0a4cc',shade:'#a498c1',line:'#d0c1df',light:'#e3d5e9',glint:'#f0e6ec'},
 sand:{base:'#d4ba91',shade:'#c8ae85',line:'#e8d3ae',light:'#f4e5c6',glint:'#fbefda'},
};
function region(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,paint:(x:number,y:number,w:number,h:number)=>void){
 if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)return;
 const left=Math.floor(x),top=Math.floor(y),width=Math.ceil(x+w)-left,height=Math.ceil(y+h)-top;
 c.save();c.imageSmoothingEnabled=false;c.beginPath();c.rect(left,top,width,height);c.clip();paint(left,top,width,height);c.restore();
}
function block(c:CanvasRenderingContext2D,ink:string,x:number,y:number,w:number,h:number){c.fillStyle=ink;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
/** Maple boards are32×12 logical pixels, half-offset every other row. */
export function paintWood(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number){
 region(c,x,y,w,h,(left,top,width,height)=>{
  const tones=['#efdac2','#f0dcc5','#eed8bd','#f3dfc7','#f1ddc4','#edd7bc'];
  block(c,tones[0],left,top,width,height);
  for(let row=Math.floor(top/12)-1;row<=Math.ceil((top+height)/12);row++){
   const oy=row*12,offset=((row%2)+2)%2*16;
   for(let col=Math.floor((left-offset)/32)-1;col<=Math.ceil((left+width-offset)/32);col++){
    const ox=col*32+offset,variant=((col*7+row*11)%6+6)%6;
    block(c,tones[variant],ox,oy,32,12);
    block(c,'#e4c9a8',ox,oy+11,32,1);block(c,'#f7e6cf',ox,oy,32,1);
    block(c,'#e4c9aa',ox+31,oy+1,1,10);block(c,'#f7e4ca',ox,oy+1,1,10);
    // Long, gentle grain marks, never random speckles.
    block(c,'#e8ceb0',ox+3+(variant%3),oy+4,11+(variant%4),1);
    block(c,'#f8e7d1',ox+7,oy+5,15-(variant%4),1);
    block(c,'#e9d0b3',ox+13-(variant%4),oy+8,12,1);
    if((col+row)%4===0){block(c,'#e1c5a3',ox+23,oy+3,3,1);block(c,'#f7e5cc',ox+22,oy+2,4,1);}
   }
  }
 });
}
function diamond(c:CanvasRenderingContext2D,color:string,cx:number,cy:number,r:number,step=2){
 for(let dy=-r;dy<=r;dy+=step){const half=r-Math.abs(dy);block(c,color,cx-half,cy+dy,half*2+step,step);}
}
function turnedBlock(c:CanvasRenderingContext2D,color:string,ox:number,oy:number,x:number,y:number,w:number,h:number,quarter:number,scale=1){
 const positions=[[x,y,w,h],[32-y-h,x,h,w],[32-x-w,32-y-h,w,h],[y,32-x-w,h,w]];
 const p=positions[quarter];block(c,color,ox+Math.round(p[0]*scale),oy+Math.round(p[1]*scale),Math.max(1,Math.round(p[2]*scale)),Math.max(1,Math.round(p[3]*scale)));
}
function floral(c:CanvasRenderingContext2D,ox:number,oy:number,p:Ink){
 // The32-unit rosette is rasterized onto a24px tile with integer-edged pixels.
 const pixel=(ink:string,x:number,y:number,w:number,h:number)=>block(c,ink,ox+Math.round(x*.75),oy+Math.round(y*.75),Math.max(1,Math.round(w*.75)),Math.max(1,Math.round(h*.75)));
 for(const [dx,dy] of [[0,0],[16,16]]){
  pixel(p.shade,dx+2,dy+6,2,6);pixel(p.shade,dx+6,dy+2,6,2);
  pixel(p.line,dx+4,dy+4,4,2);pixel(p.line,dx+4,dy+6,2,2);
 }
 for(let turn=0;turn<4;turn++){
  const petal:[number,number,number,number][]=[[14,2,4,2],[10,4,12,2],[8,6,4,6],[20,6,4,6],[10,12,4,2],[18,12,4,2],[12,14,8,2]];
  for(const r of petal)turnedBlock(c,p.line,ox,oy,...r,turn,.75);
  turnedBlock(c,p.light,ox,oy,12,6,8,2,turn,.75);
  turnedBlock(c,p.light,ox,oy,10,8,2,4,turn,.75);
  turnedBlock(c,p.light,ox,oy,18,8,2,4,turn,.75);
  turnedBlock(c,p.shade,ox,oy,14,8,4,4,turn,.75);
 }
 diamond(c,p.light,ox+11,oy+11,2,2);block(c,p.glint,ox+11,oy+11,2,2);
 pixel(p.line,0,14,2,4);pixel(p.line,30,14,2,4);pixel(p.line,14,0,4,2);pixel(p.line,14,30,4,2);
}
function lozenge(c:CanvasRenderingContext2D,ox:number,oy:number,p:Ink){
 diamond(c,p.line,ox+15,oy+15,14);diamond(c,p.shade,ox+15,oy+15,10);diamond(c,p.light,ox+15,oy+15,6);diamond(c,p.base,ox+15,oy+15,2);
 for(const [dx,dy] of [[0,0],[28,0],[0,28],[28,28]])block(c,p.light,ox+dx,oy+dy,4,4);
 block(c,p.glint,ox+14,oy+8,2,2);block(c,p.glint,ox+14,oy+22,2,2);
}
function woven(c:CanvasRenderingContext2D,ox:number,oy:number,p:Ink){
 for(let iy=0;iy<32;iy+=8)for(let ix=0;ix<32;ix+=8){
  const vertical=((ix+iy)/8)%2===0;
  block(c,p.shade,ox+ix,oy+iy,8,8);
  if(vertical){block(c,p.line,ox+ix+2,oy+iy,2,8);block(c,p.light,ox+ix+4,oy+iy+2,2,4);}
  else{block(c,p.line,ox+ix,oy+iy+2,8,2);block(c,p.light,ox+ix+2,oy+iy+4,4,2);}
 }
}
function rugBorder(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,p:Ink){
 block(c,p.shade,x,y,w,2);block(c,p.shade,x,y+h-2,w,2);block(c,p.shade,x,y,2,h);block(c,p.shade,x+w-2,y,2,h);
 block(c,p.light,x+2,y+2,w-4,2);block(c,p.light,x+2,y+h-4,w-4,2);block(c,p.light,x+2,y+2,2,h-4);block(c,p.light,x+w-4,y+2,2,h-4);
 block(c,p.base,x+4,y+4,w-8,2);block(c,p.base,x+4,y+h-6,w-8,2);block(c,p.base,x+4,y+4,2,h-8);block(c,p.base,x+w-6,y+4,2,h-8);
 for(let px=x+10;px<x+w-8;px+=12){block(c,p.glint,px,y+3,2,2);block(c,p.glint,px,y+h-5,2,2);}
 for(let py=y+10;py<y+h-8;py+=12){block(c,p.glint,x+3,py,2,2);block(c,p.glint,x+w-5,py,2,2);}
 for(const [cx,cy] of [[x+5,y+5],[x+w-7,y+5],[x+5,y+h-7],[x+w-7,y+h-7]]){block(c,p.line,cx-2,cy-2,6,6);block(c,p.glint,cx,cy,2,2);}
}
/** Pastel woven rugs with repeating pixel ornaments and a stitched double border. */
export function paintCarpet(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,palette:CarpetPalette,pattern:CarpetPattern='floral'){
 region(c,x,y,w,h,(left,top,width,height)=>{
  const p=carpets[palette]||carpets.blue;block(c,p.base,left,top,width,height);
  const tile=pattern==='floral'?24:32;
  for(let oy=Math.floor(top/tile)*tile;oy<top+height;oy+=tile)for(let ox=Math.floor(left/tile)*tile;ox<left+width;ox+=tile){
   if(pattern==='diamond')lozenge(c,ox,oy,p);else if(pattern==='weave')woven(c,ox,oy,p);else floral(c,ox,oy,p);
  }
  if(width>=18&&height>=18)rugBorder(c,left,top,width,height,p);
 });
}
/** Small pale ceramic squares for a kitchenette or welcome area. */
export function paintTile(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,palette:'cream'|'stone'='cream'){
 region(c,x,y,w,h,(left,top,width,height)=>{
  const colors=palette==='stone'?['#b0bebc','#bac7c4','#9aada9','#d0d9d2']:['#f3e6cf','#f7ecd8','#dcc8a8','#fff4df'];
  block(c,colors[2],left,top,width,height);
  for(let oy=Math.floor(top/20)*20;oy<top+height;oy+=20)for(let ox=Math.floor(left/20)*20;ox<left+width;ox+=20){
   block(c,colors[((ox+oy)/20)%2===0?0:1],ox+1,oy+1,18,18);block(c,colors[3],ox+2,oy+2,16,1);block(c,colors[2],ox+18,oy+2,1,16);
   block(c,colors[2],ox+3,oy+16,3,1);block(c,colors[3],ox+13,oy+4,3,1);
  }
 });
}
