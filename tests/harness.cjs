const fs = require('node:fs');
const vm = require('node:vm');
module.exports = function loadGame() {
  const events = {}, elements = new Map(), store = new Map();
  const drawing = new Proxy({}, {get: (t,k) => t[k] || (t[k] = k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({addColorStop(){}}) : () => {}),set: (t,k,v) => (t[k]=v,true)});
  const el = id => {
    if (!elements.has(id)) elements.set(id, {style:{},dataset:{},classList:{toggle(){},add(){},remove(){}},clientWidth:1200,clientHeight:800,width:1200,height:800,textContent:'',value:'',setAttribute(){},getContext:()=>drawing,getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){},addEventListener:(name,fn)=>{events[id+':'+name]=fn;},click(){},appendChild(){},remove(){}});
    return elements.get(id);
  };
  const document={getElementById:el,querySelectorAll:()=>[],createElement:()=>el('created'),documentElement:{dataset:{},style:{setProperty(){}}},body:el('body')};
  const sandbox={console,document,location:{search:'?seed=42'},performance:{now:()=>0},requestAnimationFrame(){},setInterval(){},setTimeout(){},clearTimeout(){},addEventListener:(name,fn)=>{events['window:'+name]=fn;},devicePixelRatio:1,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}},confirm:()=>true};
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  for (const file of ['road-editor.js','city-save.js','game.js']) if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
  return {api:sandbox.ARTERIAL,events,elements,context:sandbox,el};
};
