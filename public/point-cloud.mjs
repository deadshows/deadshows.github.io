const figure = document.querySelector('.point-cloud-art');
const canvas = document.getElementById('point-cloud');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function mount() {
  if (!figure || !canvas) return;
  const revision = new URL(import.meta.url).searchParams.get('v');
  const response = await fetch(`assets/rose-graph.json${revision ? `?v=${encodeURIComponent(revision)}` : ''}`);
  if (!response.ok) throw new Error('Rose geometry unavailable');
  const {points, edges} = await response.json();
  const context = canvas.getContext('2d');
  if (!context) return;
  const colors = {ink:'#21382f', red:'#c53c32', blue:'#30758a', stem:'#45634b', highlight:'#e28a65'};
  const positions = points.map(([x,y]) => [x,y]);
  const groups = Object.keys(colors).map(color => ({
    color, nodes: points.map((p,i) => p[2] === color ? i : -1).filter(i=>i>=0),
    edges: edges.filter(([a,b]) => points[a][2] === color && points[b][2] === color)
  }));
  const bridges = edges.filter(([a,b])=>points[a][2]!==points[b][2]);
  let visible = false, frame = 0, time = 0, previous = 0;
  let pointer = null, width = 0;
  function draw() {
    context.clearRect(0,0,616,616);
    for (let i=0;i<points.length;i++) {
      const [x,y] = points[i];
      const phase = i * 2.39996;
      const bloom = points[i][2] !== 'stem' ? Math.sin(time*.65 + Math.hypot(x-300,y-235)*.012)*.018 : 0;
      let dx = Math.sin(time*.45+phase)*.8 + (x-300)*bloom;
      let dy = Math.cos(time*.38+phase)*.8 + (y-235)*bloom;
      if (reducedMotion.matches) dx = dy = 0;
      if (pointer && !reducedMotion.matches) {
        const distance = Math.hypot(x-pointer[0], y-pointer[1]);
        const strength = Math.max(0,1-distance/220)*35;
        dx += (x-pointer[0])/Math.max(1,distance)*strength;
        dy += (y-pointer[1])/Math.max(1,distance)*strength;
      }
      positions[i][0] = x+dx+8; positions[i][1] = y+dy+8;
    }
    function lines(list, color, opacity) {
      context.strokeStyle = color; context.globalAlpha = opacity; context.lineWidth = .85;
      context.beginPath();
      for (const [a,b] of list) {context.moveTo(...positions[a]);context.lineTo(...positions[b]);}
      context.stroke();
    }
    lines(bridges, colors.ink, .15);
    for (const group of groups) {
      lines(group.edges, colors[group.color], group.color === 'stem' ? .06 : group.color === 'ink' ? .32 : .22 + Math.sin(time*.7)*.025);
      context.fillStyle = colors[group.color];
      // Three broad bands move slowly through the connected field.
      for (const i of group.nodes) {
        const [x,y] = positions[i];
        const pulse = (Math.sin(time*.9-y*.018+x*.005)+1)/2;
        context.globalAlpha = (.62 + pulse*.36) * (group.color === 'stem' ? .28 : 1);
        context.beginPath();context.arc(x,y,(1.65+pulse*.7)*points[i][3],0,Math.PI*2);context.fill();
      }
    }
    context.globalAlpha = 1;
  }
  function animate(now) {
    frame = 0;
    if (reducedMotion.matches || !visible || document.hidden) {previous=0;return;}
    if (previous) time += Math.min((now-previous)/1000,.05);
    previous = now; draw(); frame = requestAnimationFrame(animate);
  }
  function sync() {
    cancelAnimationFrame(frame); frame=0;previous=0;
    if (!reducedMotion.matches && visible && !document.hidden) frame=requestAnimationFrame(animate);
    else draw();
  }
  function resize() {
    const next = Math.round(canvas.getBoundingClientRect().width);
    if (!next || next===width) return;
    width=next;
    const ratio=Math.min(devicePixelRatio||1,2);
    canvas.width=canvas.height=Math.round(width*ratio);
    context.setTransform(canvas.width/616,0,0,canvas.height/616,0,0);
    draw();
  }
  reducedMotion.addEventListener('change',sync);
  document.addEventListener('visibilitychange',sync);
  canvas.addEventListener('pointermove',event=>{
    const box=canvas.getBoundingClientRect();
    pointer=[(event.clientX-box.left)/box.width*616-8,(event.clientY-box.top)/box.height*616-8];
  });
  canvas.addEventListener('pointerleave',()=>{pointer=null;});
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();},{threshold:.05}).observe(canvas);
  resize(); draw();figure.classList.add('graph-ready');sync();
}
mount().catch(()=>{}); // The existing SVG remains visible if canvas or data fails.
