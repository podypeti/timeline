const canvas=document.getElementById('timelineCanvas');
const ctx=canvas.getContext('2d');
canvas.width=1200; canvas.height=400;

let scale=1;

document.getElementById('zoomIn').onclick=()=>{ scale*=1.2; draw(); };
document.getElementById('zoomOut').onclick=()=>{ scale/=1.2; draw(); };

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.scale(scale,1);
  ctx.fillText("Timeline placeholder",50,200);
  ctx.restore();
}
draw();