/** Original top-down pixel furniture. All anchors are TOP LEFT in logical map pixels.
 * Rectangles only: no bitmap assets, gradients, shadows, fonts, or antialiased paths.
 */
type C=CanvasRenderingContext2D;
function shade(color:string,amount:number){const n=/^#[0-9a-f]{6}$/i.test(color)?color:'#6c8eb9';return '#'+[1,3,5].map(i=>Math.max(0,Math.min(255,parseInt(n.slice(i,i+2),16)+amount)).toString(16).padStart(2,'0')).join('');}
const ink='#46515b',wood='#a98263',woodLight='#cfad86',woodDark='#755b4d';
function r(c:C,x:number,y:number,w:number,h:number,color:string){if(w<=0||h<=0)return;c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function at(c:C,x:number,y:number,paint:()=>void){c.save();c.translate(Math.round(x),Math.round(y));c.imageSmoothingEnabled=false;paint();c.restore();}
function box(c:C,x:number,y:number,w:number,h:number,base:string,light:string,dark:string,edge=ink){
 r(c,x,y,w,h,edge);r(c,x+1,y+1,w-2,h-2,base);r(c,x+1,y+1,w-2,1,light);r(c,x+1,y+2,1,h-3,light);r(c,x+1,y+h-2,w-2,1,dark);r(c,x+w-2,y+2,1,h-4,dark);
}
function leaf(c:C,x:number,y:number,w:number,h:number,n=0){
 const dark=['#2f6d4a','#326e54','#3c7850'][n%3],mid=['#4b995d','#5aa16a','#65a665'][n%3],light=['#8bc17b','#91c68a','#9ac87d'][n%3];
 r(c,x+2,y,w-4,1,dark);r(c,x+1,y+1,w-2,h-2,dark);r(c,x,y+2,w,h-4,dark);
 r(c,x+2,y+1,w-4,h-3,mid);r(c,x+1,y+2,w-3,h-5,mid);
 r(c,x+2,y+2,Math.max(1,w-5),1,light);r(c,x+3,y+3,1,Math.max(1,h-5),light);
 r(c,x+Math.floor(w/2),y+2,1,Math.max(1,h-4),'#397c4c');
 r(c,x+w-3,y+h-3,1,1,dark);r(c,x+2,y+h-4,1,1,light);r(c,x+w-4,y+3,1,1,light);
}
/** 24 × 38, multiplied by integer scale. A dense many-leaved floor plant. */
export function pixelPlant(c:C,x:number,y:number,scale=1){at(c,x,y,()=>{
 c.scale(Math.max(1,Math.round(scale)),Math.max(1,Math.round(scale)));
 r(c,5,36,15,2,'#7f8a7b');r(c,7,27,12,10,'#69757b');r(c,6,27,14,6,'#899297');
 r(c,8,29,10,7,'#dce3da');r(c,7,28,12,2,'#f0f0dc');r(c,9,35,8,2,'#adbdb5');r(c,17,30,2,5,'#b2c3b9');r(c,7,27,13,1,'#5c6c64');r(c,10,32,1,3,'#f0f0dc');r(c,14,33,1,2,'#c3d2c5');r(c,8,36,2,1,'#778f82');
 r(c,11,8,2,22,'#427b4d');r(c,8,16,1,13,'#528a54');r(c,16,12,1,17,'#3b774f');
 leaf(c,8,0,7,10,1);leaf(c,2,4,8,9,0);leaf(c,14,3,8,10,2);leaf(c,7,7,9,9,2);
 leaf(c,0,12,9,8,1);leaf(c,14,12,10,9,0);leaf(c,6,14,10,10,0);
 leaf(c,2,20,9,8,2);leaf(c,13,21,9,8,1);leaf(c,8,21,8,9,2);
 r(c,5,7,2,1,'#afd294');r(c,18,7,1,2,'#b1d794');r(c,3,15,2,1,'#8dbb71');r(c,19,16,2,1,'#8dbb71');r(c,10,18,2,1,'#b3ce8b');
});}
/** w × h. Three shelves, uneven spines, folders, labelled boxes, and a mug. */
export function pixelShelf(c:C,x:number,y:number,w=44,h=50){at(c,x,y,()=>{
 w=Math.max(28,Math.round(w));h=Math.max(35,Math.round(h));
 box(c,0,0,w,h,wood,woodLight,woodDark);r(c,3,4,w-6,h-9,'#53616a');r(c,4,5,w-8,h-11,'#68747b');
 const shelfH=Math.floor((h-8)/3),colors=['#8fadc0','#b67964','#c7b478','#739b8d','#9f8caa','#d6d2b6','#647d9f'];
 for(let row=0;row<3;row++){
  const bottom=5+(row+1)*shelfH;r(c,2,bottom,w-4,3,woodDark);r(c,2,bottom,w-4,1,'#d7b18a');
  let bx=5;for(let b=0;b<6&&bx<w-8;b++){
   const bw=3+(b+row)%3,bh=Math.max(6,shelfH-3-((b*3+row)%4));
   r(c,bx,bottom-bh,bw,bh,colors[(b+row*2)%colors.length]);r(c,bx,bottom-bh,1,bh,'#ffffff20');
   r(c,bx,bottom-bh+2,bw,1,'#d3d5c0');r(c,bx+1,bottom-3,Math.max(1,bw-2),1,'#52626b');bx+=bw+1;
  }
  if(row===0&&w>38){box(c,w-11,bottom-9,7,8,'#c2c7bf','#e2e1c9','#939d98');r(c,w-9,bottom-6,3,1,'#677883');}
  if(row===1&&w>38){r(c,w-10,bottom-6,6,5,'#d9ddca');r(c,w-9,bottom-7,4,2,'#f3efd8');r(c,w-4,bottom-5,2,3,'#c4cdbd');r(c,w-9,bottom-6,4,1,'#69655a');}
 }
 for(let yy=7;yy<h-5;yy+=9){r(c,1,yy,1,3,'#b58c64');r(c,w-3,yy+2,1,2,'#83614c');}
 r(c,0,1,2,h-2,'#e0bc91');r(c,w-2,2,2,h-2,'#654f48');r(c,3,h-3,5,3,'#514d49');r(c,w-8,h-3,5,3,'#514d49');
});}
/** w × 44. Upholstered three-cushion sofa, with seams, feet, and a throw. */
export function pixelSofa(c:C,x:number,y:number,w=84,color='#6c8eb9'){at(c,x,y,()=>{
 w=Math.max(50,Math.round(w));const light=shade(color,43),mid=shade(color,12),dark=shade(color,-35);
 r(c,4,41,w-8,3,'#7f8883');r(c,7,38,7,5,'#595454');r(c,w-14,38,7,5,'#595454');
 box(c,2,0,w-4,36,color,light,dark);r(c,6,4,w-12,9,mid);r(c,6,5,w-12,1,light);
 const seatW=Math.floor((w-16)/3);
 for(let i=0;i<3;i++){
  const sx=8+i*seatW,sw=i===2?w-8-sx:seatW-1;
  r(c,sx,14,sw,16,mid);r(c,sx+1,15,sw-2,1,light);r(c,sx,29,sw,2,dark);r(c,sx+sw-1,16,1,13,dark);
  r(c,sx+2,26,sw-5,1,shade(color,24));r(c,sx+3,17,2,2,light);
 }
 box(c,0,11,8,26,color,light,dark);box(c,w-8,11,8,26,color,light,dark);
 r(c,8,33,w-16,5,dark);r(c,9,33,w-18,1,mid);r(c,6,39,w-12,2,shade(color,-47));
 // A folded ochre blanket on one arm breaks the repeated blue pattern.
 r(c,w-23,13,12,17,'#d2b47b');r(c,w-22,14,10,1,'#f0d49b');r(c,w-20,16,1,13,'#b59065');r(c,w-15,16,1,13,'#b59065');r(c,w-23,28,12,2,'#ad855e');
 for(let xx=11;xx<w-12;xx+=6){r(c,xx,7,1,1,shade(color,34));r(c,xx+2,23,1,1,shade(color,22));r(c,xx,35,1,1,shade(color,-17));}
 r(c,w-22,18,10,1,'#e3c68e');r(c,w-22,24,10,1,'#e3c68e');for(let xx=w-22;xx<w-11;xx+=3)r(c,xx,30,1,2,'#d4b67e');
});}
/** 70 × 54. Break-room coffee cabinet with machine, mugs, folders, and supplies. */
export function pixelCoffee(c:C,x:number,y:number){at(c,x,y,()=>{
 box(c,0,18,70,33,'#8a7361','#d7bc94','#5b5551');r(c,2,20,66,4,'#c7ad86');r(c,2,24,66,2,'#74675a');
 for(let i=0;i<3;i++){const dx=4+i*22;box(c,dx,28,19,20,'#a48a6d','#c7b296','#72675d');r(c,dx+12,31,4,2,'#48565a');r(c,dx+2,44,15,1,'#86725e');}
 r(c,3,51,6,3,'#495657');r(c,61,51,6,3,'#495657');
 // Counter machine: hopper, chrome face, display, spouts and drip grate.
 box(c,7,3,26,19,'#62737d','#b6c1bd','#3e4e59');box(c,11,0,17,6,'#6d665e','#a39b86','#4b4d4c');r(c,13,1,13,3,'#6c4939');
 r(c,10,8,20,8,'#d0d4c9');r(c,12,10,7,4,'#4c6b6f');r(c,13,11,5,1,'#94c7b5');r(c,23,10,3,3,'#bd8d65');
 r(c,15,16,2,4,'#354b53');r(c,24,16,2,4,'#354b53');r(c,11,21,18,2,'#3c4c52');
 for(let i=0;i<5;i++)r(c,13+i*3,21,1,2,'#9eaca8');
 // Two cups and a saucer, plus stacked tea packets.
 r(c,38,16,10,2,'#88877a');r(c,40,9,6,8,'#e9e5cf');r(c,41,9,4,2,'#71503a');r(c,46,11,3,4,'#bfc6b5');r(c,47,12,1,2,'#68766f');
 r(c,52,13,7,7,'#a9c5bf');r(c,53,13,5,1,'#eff0d8');r(c,59,15,2,3,'#7b9e9b');
 r(c,52,4,13,2,'#d2bc84');r(c,54,6,10,2,'#7f9f96');r(c,53,8,12,2,'#e2d5b2');r(c,61,4,2,6,'#786f5b');r(c,4,23,4,1,'#e2caa5');r(c,32,20,2,2,'#ead9b5');for(let xx=9;xx<63;xx+=11)r(c,xx,46,3,1,'#bca180');
});}
/** 24 × 50. Translucent blue jug, chrome taps, and ventilated dispenser. */
export function pixelWaterCooler(c:C,x:number,y:number){at(c,x,y,()=>{
 r(c,4,47,17,3,'#7d8b8a');box(c,3,18,18,29,'#bcc8ca','#e7e6d7','#899ba2');r(c,5,20,14,13,'#627d8a');
 r(c,6,21,12,9,'#cbd4ce');r(c,8,24,2,3,'#567fa8');r(c,14,24,2,3,'#bb7865');r(c,8,27,2,2,'#3e5964');r(c,14,27,2,2,'#3e5964');
 r(c,6,31,12,3,'#68818a');r(c,7,31,10,1,'#425d6b');r(c,6,36,12,8,'#9caeb5');for(let i=0;i<4;i++)r(c,7,37+i*2,10,1,'#788d99');
 r(c,7,1,10,2,'#4f6e92');r(c,5,3,14,13,'#659ebd');r(c,4,6,16,7,'#739fba');r(c,6,15,12,3,'#4b7b9e');r(c,9,18,6,2,'#526c80');
 r(c,7,4,3,9,'#a8d2df');r(c,7,4,9,1,'#b9e0e1');r(c,16,6,2,7,'#507a9d');r(c,7,10,9,1,'#8dbacb');r(c,10,5,4,1,'#cae3e4');r(c,8,12,2,1,'#b9d6dd');r(c,14,8,2,2,'#5e8fae');r(c,8,14,7,1,'#9ec1ce');
 r(c,18,38,2,7,'#aebfc3');r(c,3,46,18,1,'#5d7887');
});}
/** w × h. Framed pixel landscape with paper border, no canvas text rendering. */
export function pixelPoster(c:C,x:number,y:number,w=44,h=32){at(c,x,y,()=>{
 w=Math.max(24,Math.round(w));h=Math.max(20,Math.round(h));
 box(c,0,0,w,h,'#b98f64','#dec39b','#6e6258');r(c,3,3,w-6,h-6,'#ebe3c9');
 const ix=5,iy=5,iw=w-10,ih=h-10;
 r(c,ix,iy,iw,ih,'#96c6d2');r(c,ix,iy+Math.floor(ih*.56),iw,Math.ceil(ih*.44),'#9fb784');
 r(c,ix+Math.max(1,iw-10),iy+2,5,5,'#f0cf85');r(c,ix+Math.max(2,iw-11),iy+3,7,3,'#f0cf85');
 // Pixel-stepped distant hills and a warm meadow path.
 for(let i=0;i<iw;i+=3){const rise=3+Math.floor((Math.sin(i*.22)+1)*3),base=iy+Math.floor(ih*.55);r(c,ix+i,base-rise,Math.min(3,iw-i),rise+2,'#6e9d8c');}
 const ground=iy+Math.floor(ih*.7);r(c,ix,ground,iw,ih-(ground-iy),'#71956c');
 for(let i=0;i<4;i++){const yy=ground+i*2,ww=2+i*2;if(yy<iy+ih)r(c,ix+Math.floor(iw*.55)-i,yy,ww,Math.min(2,iy+ih-yy),'#d2b584');}
 for(let i=2;i<iw-2;i+=7){r(c,ix+i,iy+ih-3,1,1,'#e1d6a0');r(c,ix+i+1,iy+ih-4,1,1,'#b2c782');}
 for(let i=1;i<iw-1;i+=5){const yy=iy+ih-2-(i%3);r(c,ix+i,yy,1,1,'#b3c58b');if(i+2<iw)r(c,ix+i+1,yy+1,1,1,'#547b62');}
 r(c,1,1,w-2,1,'#ecd0a5');r(c,w-2,2,1,h-4,'#87694f');
});}

/** 52 × 45. Scanner/printer with paper feed, status panel and printed output. */
export function pixelPrinter(c:C,x:number,y:number){at(c,x,y,()=>{
 r(c,5,43,43,2,'#818d8a');
 box(c,9,0,34,19,'#829298','#cad2c9','#52656f');r(c,12,2,28,14,'#edf0dd');
 r(c,14,4,17,1,'#9aabb0');r(c,14,7,22,1,'#b4bfc0');r(c,14,10,19,1,'#b4bfc0');r(c,14,13,22,1,'#b4bfc0');r(c,36,3,2,11,'#d4dccf');
 box(c,2,15,48,25,'#aab6bb','#e5e5d7','#657984');r(c,5,17,42,4,'#bbc9c8');r(c,6,18,31,1,'#f0eddb');
 box(c,7,22,17,7,'#506c79','#90a8ae','#415963');r(c,9,24,11,3,'#78a69e');r(c,10,24,5,1,'#c0d4b5');
 r(c,28,24,3,3,'#648e86');r(c,33,24,3,3,'#c7ad74');r(c,39,23,4,4,'#657c8c');r(c,40,24,2,1,'#d1d8ca');
 r(c,6,32,40,6,'#536c78');r(c,8,33,36,2,'#344d5c');
 r(c,11,35,31,8,'#c7d0c9');r(c,13,35,27,6,'#eef0df');r(c,14,36,13,1,'#809daa');r(c,15,39,3,2,'#7fa8b9');r(c,20,38,3,3,'#92b3a1');r(c,25,37,3,4,'#c6a36f');r(c,30,38,6,1,'#a8b8b7');
 r(c,2,29,2,8,'#8599a3');r(c,48,19,2,18,'#788e9a');r(c,4,40,5,3,'#5b6c71');r(c,43,40,5,3,'#5b6c71');
});}
/** 54 × 70. Wooden easel, painted canvas, paint shelf, brushes and color jars. */
export function pixelEasel(c:C,x:number,y:number){at(c,x,y,()=>{
 r(c,4,68,46,2,'#8b8d7a');
 for(let i=0;i<8;i++){r(c,13-i,49+i*2,4,5,'#785e4b');r(c,14-i,49+i*2,1,4,'#bf9b71');r(c,36+i,49+i*2,4,5,'#785e4b');r(c,37+i,49+i*2,1,4,'#bf9b71');}
 r(c,25,0,4,61,'#88654b');r(c,26,1,1,59,'#d1aa7b');
 box(c,7,5,40,44,'#b98d63','#dfbc88','#755b4a');r(c,10,8,34,37,'#e9e1c9');r(c,11,9,32,35,'#f0e8d2');
 // A little painted studio scene: sun, terraced hills, and water.
 r(c,13,11,28,15,'#9dbebf');r(c,33,12,5,5,'#e6c27e');r(c,32,13,7,3,'#e6c27e');
 for(let i=0;i<7;i++){const rise=3+(i*5)%7;r(c,13+i*4,27-rise,4,rise+4,'#6c9c8d');}
 r(c,13,29,28,12,'#76a3b3');r(c,13,30,16,1,'#b5cecb');r(c,20,34,20,1,'#9dbfc3');r(c,14,38,13,1,'#bfd2cb');
 r(c,13,32,5,7,'#8ba27c');r(c,13,39,12,2,'#c9ba8a');r(c,15,40,22,2,'#9ba97e');r(c,30,36,3,1,'#d2dad0');
 box(c,4,47,46,6,'#ab825c','#dbb98b','#705944');r(c,7,49,39,1,'#b59a6f');
 r(c,13,51,6,6,'#6d9f98');r(c,14,51,4,1,'#dce4c9');r(c,22,51,6,6,'#c79b68');r(c,23,51,4,1,'#e6d2a2');r(c,31,51,6,6,'#ad869c');r(c,32,51,4,1,'#e0c8cf');
 r(c,43,57,8,10,'#8b9f9f');r(c,44,56,6,2,'#d0d7c2');r(c,45,48,1,10,'#80614d');r(c,48,49,1,9,'#ac8458');r(c,45,47,1,3,'#617e81');r(c,48,48,1,2,'#ae7c8a');r(c,44,60,2,5,'#b6c7bb');
 r(c,10,10,1,27,'#f6eed8');r(c,41,40,2,3,'#ded4b9');
});}
/** 46 × 58. Quiet data cabinet with six rack units, vents, indicator pixels and cabling. */
export function pixelServer(c:C,x:number,y:number){at(c,x,y,()=>{
 r(c,2,56,42,2,'#7e8a89');box(c,4,0,37,56,'#667784','#b1bdbe','#3d5365');
 r(c,8,4,29,47,'#354b5c');r(c,6,3,1,47,'#8fa4ae');r(c,38,4,1,45,'#8398a4');
 for(let row=0;row<6;row++){
  const yy=5+row*7;box(c,9,yy,27,6,'#526d7e','#8ba2ad','#30495b');
  r(c,11,yy+2,11,2,'#2d4455');for(let i=0;i<4;i++)r(c,12+i*3,yy+2,1,2,'#708797');
  r(c,26,yy+2,2,2,row===4?'#d9af68':'#85b7a1');r(c,30,yy+2,1,1,'#9fc3c5');r(c,33,yy+2,1,2,'#a5b1b1');
 }
 r(c,11,49,23,3,'#2e4859');for(let i=0;i<10;i++)r(c,12+i*2,49,1,2,'#7a92a0');
 r(c,11,1,20,1,'#cad1c7');r(c,8,53,5,2,'#cad0c4');r(c,32,53,5,2,'#405768');
 r(c,41,43,2,10,'#4e625f');r(c,42,51,4,2,'#4e625f');r(c,44,47,2,5,'#4e625f');r(c,42,43,1,5,'#8d9e82');r(c,10,56,4,2,'#455965');r(c,32,56,4,2,'#455965');
});}
/** 64 × 52. Framed whiteboard with marker diagrams, notes, pen tray and rolling legs. */
export function pixelWhiteboard(c:C,x:number,y:number){at(c,x,y,()=>{
 r(c,7,50,51,2,'#8e948a');box(c,0,0,64,40,'#9baeb1','#dce2d7','#6e858d');r(c,3,3,58,33,'#e8eadb');r(c,4,4,56,31,'#f2f0df');
 r(c,7,6,23,2,'#6e8f9c');r(c,7,10,16,1,'#8faaa9');
 // The marks form a tiny workflow and a bar chart, rather than illegible canvas text.
 box(c,7,16,10,7,'#b7d0c5','#d1dfcc','#8aa9a1','#6f9294');box(c,25,16,10,7,'#c3cad8','#e1e2dc','#99aaba','#7c93a3');
 r(c,18,19,6,1,'#78979b');r(c,21,17,1,5,'#78979b');r(c,22,18,1,3,'#78979b');
 r(c,9,28,26,1,'#a9beba');r(c,10,27,4,1,'#a9beba');r(c,16,31,19,1,'#a9beba');
 r(c,40,15,1,17,'#9aaeb1');r(c,40,31,17,1,'#9aaeb1');r(c,43,25,3,6,'#87b7a3');r(c,48,21,3,10,'#87a9c0');r(c,53,17,3,14,'#c6a572');
 r(c,43,5,7,7,'#e1c78a');r(c,44,6,5,1,'#f0dba5');r(c,45,9,3,1,'#b3a274');r(c,53,6,5,5,'#bbcfbe');
 r(c,2,38,60,4,'#687f8a');r(c,3,38,58,1,'#b5c3be');r(c,10,37,9,2,'#728faa');r(c,23,37,8,2,'#b77a70');r(c,44,36,10,3,'#657b7f');
 r(c,8,42,3,8,'#738b93');r(c,53,42,3,8,'#738b93');r(c,6,49,8,2,'#4e666f');r(c,51,49,8,2,'#4e666f');
 r(c,1,1,2,1,'#f4edda');r(c,60,1,2,1,'#f4edda');r(c,1,36,1,1,'#607b83');r(c,62,36,1,1,'#607b83');
});}
