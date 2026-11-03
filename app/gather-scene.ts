import {officeAgents, officeWalls, officeFurniture} from '../lib/office.mjs';
import type {Projection, SceneController, WorldPoint} from './world-scene';
import {paintWood, paintCarpet} from './pixel-textures';
import {pixelPlant, pixelShelf, pixelSofa, pixelPoster, pixelCoffee, pixelWaterCooler, pixelServer, pixelEasel, pixelWhiteboard} from './pixel-decor';

type Context = CanvasRenderingContext2D;
type Rect = {x:number;y:number;width:number;height:number};
type Agent = {id:string;name:string;role:string;color:string;x:number;y:number};
type Options = {reduced:boolean;project:(labels:Projection[])=>void};
type Item = {depth:number;x:number;y:number;canvas:HTMLCanvasElement};
type Direction = 'down'|'up'|'left'|'right';
const agents = officeAgents as readonly Agent[];
const walls = officeWalls as readonly Rect[];
const desks = officeFurniture as readonly Rect[];
const WIDTH = 1000, HEIGHT = 600;
const rect = (c:Context,x:number,y:number,w:number,h:number,color:string) => {
  c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
};
function outline(c:Context,x:number,y:number,w:number,h:number,fill:string,edge='#48555b',thickness=2) {
  rect(c,x,y,w,h,edge);rect(c,x+thickness,y+thickness,w-thickness*2,h-thickness*2,fill);
}
function shadow(c:Context,x:number,y:number,w:number,h:number) {
  rect(c,x+3,y,w-6,h,'#42494718');rect(c,x,y+2,w,h-4,'#42494718');
}
function pixelText(c:Context,text:string,x:number,y:number,color:string,size=9) {
  c.font=`600 ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  c.textBaseline='top';c.fillStyle=color;c.fillText(text,x,y);
}
function paper(c:Context,x:number,y:number,w=16,h=20,accent='#91bbb3') {
  rect(c,x+2,y+2,w,h,'#6d777833');outline(c,x,y,w,h,'#f8f1d9','#bcbca7',1);
  rect(c,x+3,y+4,w-6,2,accent);rect(c,x+3,y+9,w-6,1,'#9fa8a2');rect(c,x+3,y+12,w-8,1,'#b4b8ad');
}
function book(c:Context,x:number,y:number,w:number,color:string) {
  outline(c,x,y,w,5,color,'#6b6865',1);rect(c,x+2,y+1,w-4,1,'#e4d8ba');
}
function mug(c:Context,x:number,y:number,color='#f4e8cc') {
  rect(c,x+1,y+7,9,2,'#42545b30');outline(c,x,y,8,8,color,'#687478',1);
  rect(c,x+8,y+2,3,4,'#637579');rect(c,x+8,y+3,2,2,color);rect(c,x+2,y+1,4,2,'#8d6248');
}

/** Interface illustrations decorate the monitors; they never impersonate live analytics. */
function monitor(c:Context,x:number,y:number,w:number,h:number,kind:number,color:string) {
  rect(c,x+4,y+h+4,w-3,5,'#59697426');rect(c,x+w/2-3,y+h-1,6,9,'#65737d');
  outline(c,x+w/2-10,y+h+6,20,4,'#98a6b1','#576774',1);
  outline(c,x,y,w,h,'#536571','#3f505e',2);
  rect(c,x+3,y+3,w-6,h-7,'#d4e6ea');rect(c,x+4,y+4,w-8,4,'#a2becb');
  rect(c,x+4,y+8,9,h-13,'#b8d3d6');rect(c,x+6,y+11,5,2,color);
  rect(c,x+6,y+16,5,2,'#f4ead0');rect(c,x+6,y+21,5,2,'#8fadb7');
  const bx=x+16, by=y+11, bw=w-22, bh=h-20;
  if(kind===0) {
    rect(c,bx,by,bw,3,'#7996a1');
    for(let i=0;i<3;i++){rect(c,bx,by+7+i*5,bw,3,['#d2ba85','#87b7a9','#95b0cc'][i]);rect(c,bx+bw-6,by+7+i*5,6,3,'#ecf1e5');}
  } else if(kind===1) {
    for(let i=0;i<3;i++){outline(c,bx+i*Math.floor(bw/3),by,Math.floor(bw/3)-2,bh,'#eef0dd','#a1b8bd',1);rect(c,bx+2+i*Math.floor(bw/3),by+3,Math.floor(bw/3)-6,3,['#dfbb82','#95bdb5','#aea7d1'][i]);}
  } else if(kind===2) {
    const cw=Math.floor((bw-3)/2),ch=Math.floor((bh-3)/2);
    for(let i=0;i<4;i++){const ax=bx+(i%2)*(cw+3),ay=by+Math.floor(i/2)*(ch+3);rect(c,ax,ay,cw,ch,['#b9a7cf','#88b8a6','#dfb98d','#99b9cc'][i]);rect(c,ax+2,ay+2,cw-4,2,'#f1eddb');}
  } else {
    for(let i=0;i<3;i++){rect(c,bx+i*2,by+i*6,bw-i*4,4,['#9bbcab','#bdacd0','#d3bf92'][i]);rect(c,bx+3+i*2,by+1+i*6,2,2,'#eaf1e3');}
  }
  rect(c,x+3,y+h-4,w-6,1,'#91a4af');rect(c,x+w/2-1,y+h-3,2,1,'#c5d7ce');
}
function keyboard(c:Context,x:number,y:number,w=44) {
  outline(c,x,y,w,12,'#b5c0bd','#69777c',1);rect(c,x+2,y+2,w-4,8,'#dbe0cd');
  for(let row=0;row<3;row++)for(let key=0;key<10;key++)rect(c,x+3+key*(w-6)/10,y+2+row*3,2,2,'#7d8b89');
  rect(c,x+12,y+9,w-24,1,'#8c9b95');
}
function desk(c:Context,x:number,y:number,w:number,h:number,index:number) {
  const tops=['#cba082','#bac6c3','#c7b7cd','#d3b291'];
  const fronts=['#95745d','#8e9ca0','#9b8ca4','#9d7e66'];
  shadow(c,x-3,y+h-4,w+10,11);
  outline(c,x+8,y+30,40,h-25,fronts[index],'#5c6263',2);
  outline(c,x+w-49,y+30,40,h-25,fronts[index],'#5c6263',2);
  for(const px of [x+10,x+w-47])for(let row=0;row<2;row++){rect(c,px,y+36+row*12,36,1,'#6c6c69');rect(c,px+13,y+40+row*12,10,2,'#c7c9bc');}
  rect(c,x+57,y+38,w-114,5,'#647072');rect(c,x+68,y+42,5,h-42,'#697576');rect(c,x+w-73,y+42,5,h-42,'#697576');
  outline(c,x,y,w,h-13,tops[index],'#566367',2);
  rect(c,x+3,y+3,w-6,2,['#edd1ae','#d8e2d8','#ded2dc','#efd7b5'][index]);
  rect(c,x+3,y+h-21,w-6,6,fronts[index]);rect(c,x+3,y+h-15,w-6,2,'#d9c6ab');
  for(let i=0;i<13;i++){const px=x+6+i*16;rect(c,px,y+12+(i%3)*8,8+(i%3)*2,1,index===1?'#a6b5af':'#b7927955');}
  const color=agents[index].color;
  monitor(c,x+36,y-21,61,39,index,color);monitor(c,x+105,y-17,58,36,(index+1)%4,color);
  keyboard(c,x+68,y+24,52);outline(c,x+124,y+25,16,14,'#a3b2ac','#8a9895',1);outline(c,x+128,y+27,6,9,'#e0e2cf','#7c8e8d',1);
  outline(c,x+174,y+3,26,18,'#8fabb3','#576a74',1);rect(c,x+177,y+6,20,11,'#c0dce1');rect(c,x+180,y+8,14,2,color);rect(c,x+176,y+21,24,6,'#9eaaac');
  paper(c,x+11,y+12,17,21,color);mug(c,x+153,y+31,index===2?'#d3bfdf':'#d6e6d0');
  book(c,x+183,y+32,23,'#b4a0bf');book(c,x+185,y+28,22,'#b9cba9');
  outline(c,x+14,y-6,12,13,'#ded5c0','#78817b',1);rect(c,x+17,y-13,6,12,'#568f70');rect(c,x+13,y-10,4,5,'#75aa7e');rect(c,x+22,y-11,4,6,'#88b58b');rect(c,x+18,y-14,3,7,'#9ec497');
  // Cable channels, equipment feet and tiny personal tools are drawn once into the desk sprite.
  rect(c,x+89,y+17,1,5,'#697b81');rect(c,x+88,y+21,16,1,'#697b81');rect(c,x+151,y+17,1,7,'#697b81');
  rect(c,x+91,y+49,2,6,'#4b5b63');rect(c,x+91,y+54,38,2,'#4b5b63');rect(c,x+127,y+54,2,7,'#4b5b63');
  rect(c,x+129,y+58,8,2,'#4b5b63');rect(c,x+134,y+58,2,4,'#4b5b63');
  if(index===0) {
    // Small audio headset, USB hub and Ethernet ends; the ports do not imply activity.
    rect(c,x+31,y+28,17,2,'#536473');rect(c,x+29,y+30,3,9,'#536473');rect(c,x+46,y+30,3,9,'#536473');
    outline(c,x+27,y+33,7,8,'#a4b8b3','#516574',1);outline(c,x+44,y+33,7,8,'#a4b8b3','#516574',1);
    outline(c,x+203,y+9,11,16,'#526774','#3d515e',1);for(let k=0;k<3;k++)rect(c,x+206,y+12+k*4,5,2,'#bbd4ca');
  } else if(index===1) {
    outline(c,x+32,y+24,19,18,'#657d80','#48636c',1);rect(c,x+35,y+27,13,4,'#bfd3bd');
    for(let row=0;row<2;row++)for(let key=0;key<4;key++)rect(c,x+35+key*3,y+33+row*4,2,2,key===3?'#d0b37c':'#d1d9c6');
    paper(c,x+202,y+4,12,19,'#c4ac7b');rect(c,x+205,y+6,6,2,'#e6d4a9');
  } else if(index===2) {
    const swatches=['#cf927f','#e4bf7f','#a0c5aa','#99bbd2','#b3a1cf'];
    swatches.forEach((ink,i)=>{outline(c,x+31+i*5,y+26+i%2,5,12,ink,'#a89f9a',1);});
    rect(c,x+35,y+39,22,1,'#665c69');rect(c,x+55,y+39,3,1,'#d8ccaa');
    outline(c,x+201,y+27,14,10,'#738690','#495b68',1);rect(c,x+205,y+24,6,3,'#526470');
    outline(c,x+205,y+29,7,6,'#9dc3d1','#405462',1);rect(c,x+207,y+30,3,3,'#c3d9d7');
  } else {
    outline(c,x+31,y+25,24,17,'#90a5a9','#637a84',1);rect(c,x+33,y+27,20,13,'#f2ecd5');
    for(let row=0;row<2;row++)for(let col=0;col<3;col++){rect(c,x+35+col*6,y+30+row*5,4,3,['#a8c3b3','#d6bc8e','#b8aad0'][(row+col)%3]);}
    outline(c,x+203,y+4,11,21,'#b7b3a1','#7b8b8a',1);rect(c,x+206,y+8,5,2,'#d8e4d6');rect(c,x+206,y+14,5,2,'#d8e4d6');
  }
}
function chair(c:Context,x:number,y:number,color:string) {
  shadow(c,x-16,y+12,32,7);rect(c,x-2,y+3,4,12,'#63727a');rect(c,x-14,y+13,28,3,'#5c6870');
  rect(c,x-13,y+15,5,3,'#4b5963');rect(c,x+8,y+15,5,3,'#4b5963');
  outline(c,x-14,y-11,28,23,color,'#4f6370',2);rect(c,x-11,y-8,22,3,'#b5c4bb');
  outline(c,x-12,y+3,24,12,color,'#4f6370',2);rect(c,x-10,y+4,20,3,'#ffffff27');
  rect(c,x-18,y-1,5,13,'#546a74');rect(c,x+13,y-1,5,13,'#546a74');
}
function wall(c:Context,r:Rect) {
  const {x,y,width:w,height:h}=r;shadow(c,x+4,y+h-2,w+5,8);
  if(w>h) {
    rect(c,x,y-9,w,h+9,'#586773');rect(c,x+2,y-7,w-4,9,'#b7c3c1');
    rect(c,x+2,y+2,w-4,h-3,'#85969b');rect(c,x+2,y+2,w-4,2,'#d3d8ca');rect(c,x+2,y+h-4,w-4,3,'#687c84');
    for(let px=x+14;px<x+w-4;px+=38)rect(c,px,y+7,1,h-14,'#7b8d94');
  } else {
    rect(c,x,y-9,w,h+9,'#586773');rect(c,x+2,y-7,w-4,h-1,'#9ba9ac');
    rect(c,x+2,y-7,3,h-1,'#d2d9cd');rect(c,x+w-5,y-5,3,h-1,'#6f838c');
    for(let py=y+12;py<y+h-4;py+=28)rect(c,x+6,py,w-12,1,'#8c9da1');rect(c,x+2,y+h-8,w-4,7,'#71858e');
  }
}
function windowWall(c:Context,x:number,y:number,w:number) {
  outline(c,x,y,w,31,'#c0d9dc','#617987',2);rect(c,x+4,y+3,w-8,21,'#b0d4d8');rect(c,x+5,y+5,w-10,4,'#d9e9dd');
  for(let i=1;i<4;i++){rect(c,x+i*w/4,y+2,3,25,'#77969e');rect(c,x+i*w/4+3,y+3,1,24,'#deeadc');}
  rect(c,x+4,y+25,w-8,3,'#f0e8d1');rect(c,x-2,y+30,w+4,4,'#a4b4af');
}
function noticeboard(c:Context,x:number,y:number,w:number,h:number,index:number) {
  outline(c,x,y,w,h,'#af987b','#697071',2);rect(c,x+3,y+3,w-6,h-6,'#d4bd91');
  for(let i=0;i<6;i++){
    const px=x+6+(i%3)*Math.floor((w-12)/3),py=y+6+Math.floor(i/3)*15;
    rect(c,px,py,13,10,['#f4e5b6','#bdd3c1','#c5c1dc'][(i+index)%3]);rect(c,px+5,py,2,2,'#9c7770');
    rect(c,px+3,py+4,8,1,'#7d8a8b');rect(c,px+3,py+6,6,1,'#a4a99b');
  }
}

function filingCabinet(c:Context) {
  shadow(c,1,55,53,8);outline(c,3,15,44,44,'#a5b5ad','#5b7078',2);
  rect(c,5,17,40,3,'#d5ddd0');
  for(let row=0;row<3;row++) {
    const y=22+row*12;outline(c,6,y,38,11,'#aabbb1','#7e938e',1);
    outline(c,16,y+3,15,4,'#e1e4cd','#8a9c90',1);rect(c,20,y+7,7,1,'#637b7a');
    rect(c,8,y+2,1,6,'#cad4bd');
  }
  // File folders, loose pages and an in-tray occupy the cabinet's top surface.
  outline(c,7,7,34,11,'#c4a56f','#7d7e6e',1);rect(c,10,5,8,3,'#dec590');
  paper(c,12,0,18,14,'#cbbd92');rect(c,31,2,6,15,'#a1b5a5');rect(c,33,4,2,8,'#e2e9ce');
  outline(c,36,34,16,20,'#d0c3a3','#7f8d82',1);rect(c,38,37,12,2,'#e5d6b7');
  rect(c,39,41,10,1,'#a5ac9b');rect(c,39,45,8,1,'#a5ac9b');rect(c,39,49,10,1,'#a5ac9b');
}
function floorLamp(c:Context) {
  shadow(c,1,61,22,6);rect(c,10,18,3,44,'#6a797a');rect(c,8,21,1,38,'#b1bdb0');
  outline(c,3,60,20,5,'#9eaea8','#5e7379',1);rect(c,4,9,18,15,'#5e7379');
  rect(c,6,5,14,4,'#6b7f7a');rect(c,6,10,14,12,'#e7d3a4');rect(c,7,10,2,11,'#f7e7bc');
  rect(c,18,10,2,11,'#cbb88e');rect(c,9,22,8,2,'#e9c987');rect(c,15,26,1,6,'#9d9275');
}
function sideTable(c:Context) {
  shadow(c,1,24,27,6);rect(c,5,12,3,15,'#6c6f65');rect(c,23,12,3,15,'#6c6f65');
  outline(c,0,6,29,13,'#c5a37d','#72796d',1);rect(c,2,8,25,2,'#e9ceaa');
  mug(c,6,8,'#e4dbbd');outline(c,18,1,7,11,'#9daf9a','#6c8575',1);rect(c,20,0,3,6,'#779d76');
}

/** Four-frame original walking sprites, with directional silhouettes and a fixed pixel outline. */
function person(c:Context,x:number,y:number,index:number,direction:Direction,frame:number,walking:boolean) {
  const skins=['#dca78b','#ba866c','#e6b78f','#9d705d','#d7a284'];
  const clothes=['#548c7b','#b08b51','#8d77a7','#5e8ea5','#c99062'];
  const hair=['#514945','#6c5445','#403e4b','#3e434a','#434b50'];
  const skin=skins[index],shirt=clothes[index],dark='#3e4853';
  const step=walking?[0,2,0,-2][frame%4]:0,bob=walking&&frame%2?1:0;
  x=Math.round(x);y=Math.round(y);shadow(c,x-12,y-3,24,7);
  c.save();c.translate(x-16,y-45+bob);
  if(index===0||index===2){rect(c,6,4,20,23,dark);rect(c,4,10,24,14,hair[index]);rect(c,6,22,20,7,hair[index]);}
  rect(c,9,31,6,11+step,dark);rect(c,18,31,6,11-step,dark);
  rect(c,10,31,3,8+step,'#6a7b86');rect(c,19,31,3,8-step,'#6a7b86');
  rect(c,7,40+step,9,4,'#374753');rect(c,17,40-step,9,4,'#374753');
  rect(c,7,40+step,6,1,'#92a0a4');rect(c,18,40-step,6,1,'#92a0a4');
  outline(c,7,21,19,14,shirt,dark,2);rect(c,10,22,13,2,'#ffffff26');rect(c,10,32,13,2,'#344f5c44');
  if(direction==='left'||direction==='right') {
    const isRight=direction==='right',arm=isRight?19:8;
    rect(c,arm,24-step,6,11,dark);rect(c,arm+1,25-step,4,7,shirt);rect(c,arm+1,32-step,4,5,skin);
    outline(c,isRight?9:6,5,18,18,skin,dark,2);rect(c,isRight?25:4,13,3,6,skin);
    rect(c,isRight?10:7,5,16,6,hair[index]);rect(c,isRight?9:6,8,6,12,hair[index]);
    rect(c,isRight?22:9,13,2,3,'#35434d');rect(c,isRight?23:7,19,3,1,'#a06b5e');rect(c,isRight?17:12,6,7,2,'#ffffff14');
  } else {
    const back=direction==='up';
    rect(c,3,24+step,6,11,dark);rect(c,4,25+step,4,7,shirt);rect(c,4,32+step,4,5,skin);
    rect(c,25,24-step,5,11,dark);rect(c,26,25-step,3,7,shirt);rect(c,26,32-step,3,5,skin);
    outline(c,7,4,20,20,back?hair[index]:skin,dark,2);rect(c,9,2,16,3,dark);
    rect(c,9,4,16,7,hair[index]);rect(c,7,8,4,9,hair[index]);rect(c,24,8,3,9,hair[index]);rect(c,10,4,12,2,'#ffffff18');
    if(!back){rect(c,12,13,2,3,'#38444d');rect(c,21,13,2,3,'#38444d');rect(c,16,19,5,1,'#a27261');rect(c,15,16,3,2,'#c48e74');rect(c,9,17,3,2,'#ffffff14');}
    else {rect(c,10,10,14,10,hair[index]);rect(c,12,20,10,3,'#ffffff0e');rect(c,15,25,4,7,'#ffffff17');}
  }
  if(index===1){rect(c,9,3,5,3,'#806047');rect(c,18,2,5,3,'#806047');}
  if(index===2){rect(c,23,11,3,4,'#b9a5d5');rect(c,25,12,2,2,'#d5c4e8');}
  if(index===3){rect(c,10,4,14,3,'#577183');rect(c,8,8,19,2,'#465d71');}
  if(index===4){rect(c,12,23,5,8,'#e9dfbd');rect(c,17,23,4,2,'#e9dfbd');}
  c.restore();
}

/** Original top-down office: Canvas-only, no remote assets or GPU required. */
export function createGatherScene(canvas:HTMLCanvasElement,options:Options):SceneController {
  const context=canvas.getContext('2d',{alpha:false});if(!context)throw new Error('Canvas2D indisponível.');
  const c=context,floor=document.createElement('canvas');floor.width=WIDTH;floor.height=HEIGHT;
  const fc=floor.getContext('2d');if(!fc)throw new Error('Canvas2D indisponível.');
  const world=document.createElement('canvas');world.width=WIDTH;world.height=HEIGHT;
  const worldContext=world.getContext('2d',{alpha:false});if(!worldContext)throw new Error('Canvas2D indisponível.');const wc:Context=worldContext;
  const items:Item[]=[];
  let w=1000,h=650,dpr=1,zoom=1,panX=0,panY=0,selected:string|null=null;
  let states:Record<string,{label:string;tone:string}>={};
  let target:WorldPoint={x:500,y:300},visitor={x:500,y:300},walking=false,direction:Direction='down';
  let gait=0,last=0,raf=0,disposed=false,dirty=true,previousProjection='';
  function addItem(x:number,y:number,width:number,height:number,depth:number,draw:(c:Context)=>void) {
    const sprite=document.createElement('canvas');sprite.width=width;sprite.height=height;
    const sc=sprite.getContext('2d');if(!sc)return;sc.imageSmoothingEnabled=false;draw(sc);items.push({x,y,canvas:sprite,depth});
  }
  rect(fc,0,0,WIDTH,HEIGHT,'#c8d2c7');
  for(let y=0;y<HEIGHT;y+=8)for(let x=0;x<WIDTH;x+=8)if(((x*13+y*7)%19)<4)rect(fc,x,y,2,2,'#d8dfd1');
  rect(fc,13,22,978,572,'#9aa69c');rect(fc,10,16,978,574,'#65766f');rect(fc,12,16,976,570,'#c1b69b');paintWood(fc,16,20,968,562);
  rect(fc,16,580,968,3,'#a78e71');rect(fc,18,583,964,4,'#7b8174');
  paintCarpet(fc,38,47,432,188,'sage','floral');paintCarpet(fc,530,47,432,188,'sand','diamond');
  paintCarpet(fc,38,358,432,209,'lilac','diamond');paintCarpet(fc,530,358,432,209,'blue','floral');
  for(const y of [267,327])for(const x of [204,724]){
    rect(fc,x,y,72,2,'#a68b68');rect(fc,x+2,y+2,68,1,'#eed8a8');for(let px=x+5;px<x+70;px+=8)rect(fc,px,y,2,3,'#d4bb90');
  }
  rect(fc,450,283,100,32,'#b3957088');rect(fc,452,285,96,28,'#e0c9a5');rect(fc,457,290,86,18,'#b39570');rect(fc,459,292,82,14,'#e8d8b8');pixelText(fc,'B U N K E R',464,294,'#6b7d70',9);
  const roomNames=['TRÁFEGO','ORÇAMENTO','CRIATIVOS','OPERAÇÃO'];
  agents.forEach((a,i)=>{
    const rx=i%2?520:28,ry=i<2?26:346;
    rect(fc,rx+8,ry,98,16,'#7e8f84');rect(fc,rx+9,ry+1,96,14,'#e8dfc4');rect(fc,rx+11,ry+3,3,10,a.color);pixelText(fc,roomNames[i],rx+19,ry+4,'#657365',8);
  });
  for(const x of [134,654])addItem(x,18,213,36,24,cc=>windowWall(cc,0,0,212));
  for(const [i,dx,dy] of [[0,0,0],[1,520,0],[2,0,310],[3,520,310]] as const) {
    addItem(47+dx,66+dy,44,55,112+dy,cc=>pixelShelf(cc,0,0,44,50));
    addItem(396+dx,49+dy,56,40,72+dy,cc=>pixelPoster(cc,0,0,54,36));
    addItem(434+dx,114+dy,28,43,150+dy,cc=>pixelPlant(cc,0,0));
    addItem(65+dx,175+dy,28,43,211+dy,cc=>pixelPlant(cc,0,0));
    addItem(365+dx,175+dy,87,48,219+dy,cc=>pixelSofa(cc,0,0,84,['#789c89','#b59a79','#9a8eb1','#7b9cb7'][i]));
    addItem(50+dx,129+dy,59,43,165+dy,cc=>noticeboard(cc,0,0,58,38,i));
  }
  // Four distinct working corners. The solid bases are registered by the shared navigation.
  addItem(365,97,46,58,155,cc=>pixelServer(cc,0,0));
  addItem(413,87,39,36,123,cc=>{
    shadow(cc,1,29,37,6);outline(cc,0,12,37,20,'#a5b4b7','#576c77',1);
    outline(cc,5,5,28,14,'#ced8cb','#6c8188',1);paper(cc,10,0,19,14,'#abc2b3');
    rect(cc,5,18,27,3,'#607986');rect(cc,7,23,23,7,'#80969a');rect(cc,9,23,19,2,'#e7ead5');
    rect(cc,30,13,3,2,'#b7c9c1');rect(cc,3,27,4,2,'#cbd5c8');
  });
  // Pixel cable routing on the rug connects equipment without inventing a live status.
  rect(fc,354,148,7,2,'#687b79');rect(fc,359,148,2,13,'#687b79');rect(fc,359,159,14,2,'#687b79');
  rect(fc,369,159,2,9,'#687b79');rect(fc,369,166,27,2,'#687b79');rect(fc,394,152,2,16,'#687b79');
  addItem(885,99,54,64,160,cc=>filingCabinet(cc));
  addItem(936,132,16,27,158,cc=>{
    outline(cc,0,4,15,20,'#c4a97d','#7a8b7c',1);rect(cc,2,0,5,5,'#d6be95');
    paper(cc,3,3,9,15,'#a9c0aa');rect(cc,2,19,11,3,'#a48f6f');
  });
  addItem(365,398,54,70,468,cc=>pixelEasel(cc,0,0));
  addItem(421,403,26,68,468,cc=>floorLamp(cc));
  addItem(885,404,64,52,456,cc=>pixelWhiteboard(cc,0,0));
  // Shared café and a reading corner occupy the corridor ends, never its doorways.
  paintCarpet(fc,25,274,155,49,'sand','weave');paintCarpet(fc,812,274,162,49,'sage','weave');
  addItem(31,268,70,54,322,cc=>pixelCoffee(cc,0,0));
  addItem(115,272,24,50,322,cc=>pixelWaterCooler(cc,0,0));
  addItem(154,280,24,38,318,cc=>pixelPlant(cc,0,0));
  addItem(812,280,24,38,318,cc=>pixelPlant(cc,0,0));
  addItem(846,275,87,44,319,cc=>pixelSofa(cc,0,0,87,'#8a9f93'));
  addItem(941,286,29,30,316,cc=>sideTable(cc));
  desks.forEach((d,i)=>addItem(d.x-4,d.y-27,d.width+8,d.height+39,d.y+d.height,cc=>desk(cc,4,27,d.width,d.height,i)));
  agents.forEach((a,i)=>addItem(a.x-21,a.y-24,43,49,a.y-4,cc=>chair(cc,21,18,['#7a9e91','#ac9576','#9f93b3','#7d9db5'][i])));
  walls.forEach(r=>addItem(r.x-1,r.y-10,r.width+12,r.height+21,r.y+r.height,cc=>wall(cc,{x:1,y:10,width:r.width,height:r.height})));
  addItem(8,8,984,24,21,cc=>{
    rect(cc,0,0,984,20,'#667a7f');rect(cc,2,1,980,5,'#cad0bd');rect(cc,2,6,980,9,'#99a9aa');rect(cc,2,15,980,5,'#b6c3bb');for(let x=12;x<980;x+=52)rect(cc,x,7,1,7,'#82999b');
  });
  addItem(8,20,9,566,590,cc=>{rect(cc,0,0,9,566,'#73878b');rect(cc,1,0,3,566,'#c9d0bb');rect(cc,5,0,3,566,'#94a6a5');});
  addItem(983,20,9,566,590,cc=>{rect(cc,0,0,9,566,'#73878b');rect(cc,1,0,3,566,'#c9d0bb');rect(cc,5,0,3,566,'#94a6a5');});
  items.sort((a,b)=>a.depth-b.depth);

  function transform() {
    const scale=Math.max(.01,Math.min((w-28)/WIDTH,(h-56)/HEIGHT))*zoom;
    return {scale,ox:Math.round(w/2-WIDTH*scale/2+panX),oy:Math.round(h/2-HEIGHT*scale/2+panY+12)};
  }
  function projected(x:number,y:number) {const t=transform();return {x:Math.round(t.ox+x*t.scale),y:Math.round(t.oy+y*t.scale)};}
  function publishProjection() {
    const labels=agents.map(a=>{
      const p=projected(a.x,a.y+78);return {id:a.id,...p,visible:p.x>35&&p.x<w-35&&p.y>60&&p.y<h-20};
    });
    const p=projected(visitor.x,visitor.y-50);labels.push({id:'visitor',...p,visible:p.x>15&&p.x<w-15&&p.y>50&&p.y<h-20});
    const signature=labels.map(v=>`${v.id}:${v.x},${v.y},${v.visible}`).join('|');
    if(signature!==previousProjection){previousProjection=signature;options.project(labels);}
  }
  function draw(now:number) {
    const delta=Math.min(50,last?now-last:16);last=now;
    const dx=target.x-visitor.x,dy=target.y-visitor.y,distance=Math.hypot(dx,dy),active=distance>.1;
    if(active) {
      direction=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
      const progress=options.reduced?1:Math.min(1,delta/42);visitor.x+=dx*progress;visitor.y+=dy*progress;
      if(distance<.5)visitor={...target};dirty=true;
    }
    if((walking||active)&&!options.reduced){gait+=delta;dirty=true;}
    if(dirty) {
      dirty=false;c.setTransform(dpr,0,0,dpr,0,0);c.imageSmoothingEnabled=false;rect(c,0,0,w,h,'#d9d8c5');
      c.fillStyle='#c5cebf';for(let yy=4;yy<h;yy+=16)for(let xx=(yy%32?4:12);xx<w;xx+=16)c.fillRect(xx,yy,1,1);
      const t=transform();wc.imageSmoothingEnabled=false;wc.drawImage(floor,0,0);
      if(selected) {
        const a=agents.find(a=>a.id===selected);
        if(a){rect(wc,a.x-20,a.y-2,40,8,'#fbf0bd');rect(wc,a.x-17,a.y-5,34,14,'#fbf0bd');rect(wc,a.x-14,a.y-3,28,10,'#819c87');rect(wc,a.x-11,a.y-1,22,6,'#d9e7b9');}
      }
      const dynamic=[...agents.map((a,index)=>({x:a.x,y:a.y,index})),{...visitor,index:4}].sort((a,b)=>a.y-b.y);
      let di=0;
      const drawPerson=(p:{x:number;y:number;index:number})=>person(wc,p.x,p.y,p.index,p.index===4?direction:'down',Math.floor(gait/110)%4,p.index===4&&(walking||active)&&!options.reduced);
      for(const item of items){while(di<dynamic.length&&dynamic[di].y<item.depth)drawPerson(dynamic[di++]);wc.drawImage(item.canvas,item.x,item.y);}
      while(di<dynamic.length)drawPerson(dynamic[di++]);
      agents.forEach(a=>{
        const tone=states[a.id]?.tone||'gray',color=/working|green|ready|active/.test(tone)?'#86b69a':/amber|pending|yellow/.test(tone)?'#d5b479':/red|error/.test(tone)?'#ca8d7b':'#a1afa8';
        outline(wc,a.x+11,a.y-42,7,7,color,'#f0e9d6',1);
      });
      c.drawImage(world,t.ox,t.oy,WIDTH*t.scale,HEIGHT*t.scale);publishProjection();
    }
    if(!disposed&&!document.hidden)raf=requestAnimationFrame(frame);
  }
  function requestDraw(){dirty=true;if(!disposed&&!document.hidden&&!raf)raf=requestAnimationFrame(frame);}
  function frame(now:number){raf=0;draw(now);}
  function visibility(){if(document.hidden){cancelAnimationFrame(raf);raf=0;last=0;}else{last=0;dirty=true;if(!raf)raf=requestAnimationFrame(frame);}}
  document.addEventListener('visibilitychange',visibility);raf=requestAnimationFrame(frame);
  return {
    resize(width,height) {
      w=Math.max(1,width);h=Math.max(1,height);dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);c.imageSmoothingEnabled=false;requestDraw();
    },
    setVisitor(point,isMoving) {
      if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return;target={...point};walking=isMoving;if(options.reduced)visitor={...target};requestDraw();
    },
    setStates(value){states=value;requestDraw();},
    setSelected(id){selected=id;requestDraw();},
    rotate(dx,dy){panX=Math.min(w*.8,Math.max(-w*.8,panX+dx));panY=Math.min(h*.8,Math.max(-h*.8,panY+dy));requestDraw();},
    zoom(factor){if(Number.isFinite(factor)&&factor>0)zoom=Math.min(2.5,Math.max(.65,zoom*factor));requestDraw();return Math.round(zoom*100);},
    reset(){zoom=1;panX=0;panY=0;requestDraw();},
    pick(x,y) {
      const t=transform(),point={x:(x-t.ox)/t.scale,y:(y-t.oy)/t.scale};
      for(const a of agents)if(Math.abs(point.x-a.x)<23&&point.y>a.y-50&&point.y<a.y+9)return {agentId:a.id};
      if(point.x<18||point.x>982||point.y<20||point.y>582)return null;return {point};
    },
    dispose() {disposed=true;cancelAnimationFrame(raf);raf=0;document.removeEventListener('visibilitychange',visibility);floor.width=0;floor.height=0;world.width=0;world.height=0;items.forEach(item=>{item.canvas.width=0;item.canvas.height=0;});},
  };
}
