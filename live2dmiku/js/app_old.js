// ---------------------------------------------------
// Pipsqueak Miku Viewer
// Optimized Live2D Viewer
// ---------------------------------------------------

const MODEL_PATH = "/model/MikuPipsqueak.model3.json";

let app;
let model;

let dragging = false;

let dragStart = {
    x:0,
    y:0
};

let modelStart = {
    x:0,
    y:0
};

let scale = Number(localStorage.getItem("live2dScale")) || 0.32;

const savedX = Number(localStorage.getItem("live2dX"));
const savedY = Number(localStorage.getItem("live2dY"));

const canvas = document.getElementById("viewer");

async function init(){

    app = new PIXI.Application({

        view:canvas,

        resizeTo:window,

        antialias:true,

        autoDensity:true,

        resolution:window.devicePixelRatio,

        backgroundAlpha:0,

        powerPreference:"high-performance"

    });

    document.getElementById("status").innerHTML="Loading model...";

    model = await PIXI.live2d.Live2DModel.from(MODEL_PATH);

    app.stage.addChild(model);

    model.anchor.set(.5,.5);

    if(savedX){

        model.x=savedX;
        model.y=savedY;

    }else{

        model.x=window.innerWidth*0.5;
        model.y=window.innerHeight*0.78;

    }

    model.scale.set(scale);

    model.interactive=true;

    installMouse();

    installKeyboard();

    installButtons();
    
    //
    buildMotionMenu();
    buildExpressionMenu();

    startFPSCounter();

    randomIdle();

    document.getElementById("status").innerHTML="Model Loaded";

}

function installMouse(){

canvas.addEventListener("mousedown",e=>{

dragging=true;

dragStart.x=e.clientX;
dragStart.y=e.clientY;

modelStart.x=model.x;
modelStart.y=model.y;

});

window.addEventListener("mouseup",()=>{

dragging=false;

saveState();

});

window.addEventListener("mousemove",e=>{

if(!dragging)return;

model.x=modelStart.x+(e.clientX-dragStart.x);
model.y=modelStart.y+(e.clientY-dragStart.y);

});

canvas.addEventListener("wheel",e=>{

e.preventDefault();

const delta=e.deltaY>0?-0.05:0.05;

scale=Math.max(.08,Math.min(1.4,scale+delta));

model.scale.set(scale);

saveState();

});

}

function saveState(){

localStorage.setItem("live2dScale",scale);

localStorage.setItem("live2dX",model.x);

localStorage.setItem("live2dY",model.y);

}

function resetCamera(){

scale=.32;

model.scale.set(scale);

model.x=window.innerWidth/2;

model.y=window.innerHeight*0.78;

saveState();

}

function installButtons(){

document.getElementById("resetCamera").onclick=resetCamera;

document.getElementById("fullscreen").onclick=()=>{

document.body.requestFullscreen();

};

document.getElementById("randomExpression").onclick=randomExpression;

document.getElementById("randomMotion").onclick=randomMotion;

document.getElementById("idleMotion").onclick=randomIdle;

document.getElementById("resetExpression").onclick=()=>{

if(model.internalModel.motionManager.expressionManager){

model.internalModel.motionManager.expressionManager.resetExpression();

}

};

}

function installKeyboard(){

window.addEventListener("keydown",e=>{

switch(e.code){

case"Space":

e.preventDefault();

randomMotion();

break;

case"KeyR":

resetCamera();

break;

}

});

}

function getMotionGroups(){

const defs=model.internalModel.settings.motions;

return Object.keys(defs);

}

function randomMotion(){

const groups=getMotionGroups();

if(groups.length===0)return;

const group=groups[Math.floor(Math.random()*groups.length)];

const list=model.internalModel.settings.motions[group];

const index=Math.floor(Math.random()*list.length);

model.motion(group,index);

}

function randomIdle(){

const groups=getMotionGroups();

if(groups.includes("Idle")){

model.motion("Idle");

return;

}

randomMotion();

}

function randomExpression(){

const exp=model.internalModel.settings.expressions;

if(!exp)return;

const id=Math.floor(Math.random()*exp.length);

model.expression(id);

}

function startFPSCounter(){

const label=document.getElementById("fps");

let frames=0;

let last=performance.now();

function loop(){

frames++;

const now=performance.now();

if(now-last>=1000){

label.innerHTML="FPS "+frames;

frames=0;

last=now;

}

requestAnimationFrame(loop);

}

loop();

}

document.addEventListener("visibilitychange",()=>{

if(document.hidden){

app.ticker.stop();

}else{

app.ticker.start();

}

});

canvas.addEventListener("webglcontextlost",e=>{

e.preventDefault();

});

canvas.addEventListener("webglcontextrestored",()=>{

location.reload();

});

window.addEventListener("resize",()=>{

if(model){

model.y=window.innerHeight*0.78;

}

});

init();

// ================

// -------------------------------------------
// Dynamic Motion Menu
// -------------------------------------------

function buildMotionMenu(){

    const panel=document.querySelector(".panel");

    const title=document.createElement("div");

    title.className="group";

    title.innerHTML="<h3>All Motions</h3>";

    panel.appendChild(title);

    const motions=model.internalModel.settings.motions;

    Object.keys(motions).forEach(group=>{

        motions[group].forEach((m,index)=>{

            const btn=document.createElement("button");

            btn.innerText=`🎬 ${group} ${index}`;

            btn.onclick=()=>{

                model.motion(group,index);

            };

            title.appendChild(btn);

        });

    });

}


function buildExpressionMenu(){

    const panel=document.querySelector(".panel");

    const group=document.createElement("div");

    group.className="group";

    group.innerHTML="<h3>Expressions</h3>";

    panel.appendChild(group);

    const list=model.internalModel.settings.expressions;

    if(!list)return;

    list.forEach((exp,index)=>{

        const btn=document.createElement("button");

        btn.innerText="😊 "+exp.Name;

        btn.onclick=()=>{

            model.expression(index);

        };

        group.appendChild(btn);

    });

}


//}

// Слежка глазами модели за курсором мышки
window.addEventListener("mousemove",e=>{

    if(!model)return;

    const mx=e.clientX/window.innerWidth-.5;
    const my=e.clientY/window.innerHeight-.5;

    const core=model.internalModel.coreModel;

    core.setParameterValueById("ParamAngleX",mx*30);

    core.setParameterValueById("ParamAngleY",-my*30);

    core.setParameterValueById("ParamEyeBallX",mx);

    core.setParameterValueById("ParamEyeBallY",-my);

});

// АвтоFPS
let targetFPS=60;
function updateFPS(){

    targetFPS=document.hidden?15:60;

    app.ticker.maxFPS=targetFPS;

}
document.addEventListener(
    "visibilitychange",
    updateFPS
);
updateFPS();