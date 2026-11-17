#!/usr/bin/env python3
"""An original, asymmetric rose drawing sampled as a connected point field.

Petal contours are independently composed cubic curves, not a traced image.
"""
import json
import math
import random
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
rng = random.Random(1974)
points = []

def bezier(a,b,c,d,t):
    return tuple((1-t)**3*a[k]+3*(1-t)**2*t*b[k]+3*(1-t)*t*t*c[k]+t**3*d[k] for k in (0,1))

def contour(start,segments):
    result=[]
    for b,c,d in segments:
        n=max(12,round((math.dist(start,b)+math.dist(b,c)+math.dist(c,d))/3))
        result.extend(bezier(start,b,c,d,i/n) for i in range(n))
        start=d
    return result

def inside(x,y,poly):
    hit=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit

def shape(start,segments,color,spacing=5):
    global points
    poly=contour(start,segments)
    # Later petals occlude earlier ones; their folds remain readable.
    points=[p for p in points if not inside(p[0],p[1],poly)]
    lo_x,hi_x=min(p[0] for p in poly),max(p[0] for p in poly)
    lo_y,hi_y=min(p[1] for p in poly),max(p[1] for p in poly)
    for y in range(int(lo_y),int(hi_y)+1,spacing):
        for x in range(int(lo_x),int(hi_x)+1,spacing):
            px,py=x+rng.uniform(-1.4,1.4),y+rng.uniform(-1.4,1.4)
            if inside(px,py,poly):points.append([px,py,color,rng.uniform(.78,1.12)])
    for x,y in poly[::2]:points.append([x,y,'ink',1.05])

def line(start,segments,color='ink',size=.8):
    for x,y in contour(start,segments)[::2]:points.append([x,y,color,size])

# A short, quiet stem and two unequal blue-green leaves behind the bloom.
line((303,382),[((284,430),(313,475),(286,531))],'stem',.65)
shape((249,365),[((202,362),(153,329),(111,347)),((140,392),(192,425),(263,390)),((269,381),(260,371),(249,365))],'blue',6)
shape((347,352),[((398,306),(444,314),(489,287)),((475,351),(428,397),(355,383)),((346,376),(343,363),(347,352))],'blue',6)
line((128,353),[((172,372),(203,380),(252,382))])
line((355,372),[((409,356),(445,330),(475,305))])
for i in range(7):
    x=149+i*14;y=360+i*3
    line((x,y),[((x+3,y-10),(x+7,y-15),(x+10,y-17))],size=.65)
    x=379+i*12;y=363-i*7
    line((x,y),[((x+5,y+9),(x+12,y+12),(x+18,y+12))],size=.65)
# Broad irregular outer petals form a cupped bloom tilted to the right.
shape((180,235),[((143,192),(157,150),(184,123)),((211,143),(232,116),(255,143)),((289,188),(244,250),(180,235))],'red')
shape((219,162),[((213,122),(242,94),(261,72)),((291,86),(330,78),(347,112)),((352,146),(311,193),(273,207)),((242,211),(224,187),(219,162))],'red')
shape((309,142),[((331,103),(368,112),(389,99)),((402,130),(438,148),(426,188)),((411,223),(365,232),(335,211)),((313,192),(303,164),(309,142))],'red')
shape((177,207),[((143,222),(129,258),(155,287)),((151,315),(173,345),(209,345)),((240,329),(253,277),(236,237)),((221,210),(198,202),(177,207))],'red')
shape((383,188),[((415,174),(441,194),(454,224)),((440,251),(451,278),(423,306)),((390,333),(356,308),(345,272)),((336,234),(356,202),(383,188))],'red')
shape((187,304),[((170,344),(205,384),(250,399)),((294,422),(341,396),(376,363)),((396,339),(374,308),(345,303)),((300,337),(239,338),(187,304))],'red')
# Inner petals overlap as distinct folded ribbons around an offset heart.
shape((205,221),[((205,183),(238,160),(275,167)),((311,160),(350,168),(373,195)),((342,194),(309,200),(283,221)),((254,239),(228,244),(205,221))],'red')
shape((215,212),[((182,249),(199,299),(236,319)),((256,333),(283,322),(297,307)),((266,297),(250,276),(252,249)),((243,227),(228,218),(215,212))],'red')
shape((365,208),[((400,215),(409,253),(388,285)),((372,315),(342,327),(310,311)),((333,295),(351,267),(342,243)),((341,226),(347,215),(365,208))],'red')
shape((234,303),[((252,339),(290,364),(329,348)),((350,345),(369,329),(377,309)),((341,324),(321,320),(302,299)),((276,292),(251,294),(234,303))],'red')
shape((263,241),[((269,212),(301,198),(328,213)),((354,213),(365,230),(360,251)),((340,239),(325,237),(310,248)),((290,257),(277,260),(263,241))],'red',5)
shape((273,247),[((252,270),(278,301),(304,303)),((322,301),(336,287),(338,273)),((321,283),(307,279),(306,264)),((297,246),(287,240),(273,247))],'red',5)
shape((309,244),[((313,226),(337,230),(341,246)),((342,263),(325,279),(310,270)),((320,262),(324,251),(309,244))],'red',5)
# Sparse fold hatching, independently placed along the larger petal edges.
for i in range(8):
    x=239+i*10
    line((x,115+i*.4),[((x-5,130),(x+2,143),(x+8,151))],size=.65)
for i in range(6):
    y=239+i*10
    line((166,y),[((175,y+1),(182,y+9),(185,y+16))],size=.65)
for i in range(7):
    x=244+i*12
    line((x,377-abs(3-i)*2),[((x+9,375),(x+16,368),(x+20,361))],size=.65)
# Fine folded rims follow the inner face of individual petals.
for start,segments in [
    ((182,145),[((174,169),(180,188),(190,199))]),
    ((241,154),[((265,140),(302,151),(322,160))]),
    ((352,128),[((374,133),(390,153),(395,176))]),
    ((158,259),[((165,280),(169,299),(184,311))]),
    ((412,217),[((429,240),(418,266),(407,277))]),
    ((212,345),[((239,376),(269,386),(297,379))]),
    ((244,194),[((275,179),(316,181),(337,191))]),
    ((222,248),[((214,269),(226,289),(243,299))]),
    ((372,233),[((386,255),(370,279),(359,290))]),
    ((266,323),[((287,343),(315,340),(333,334))]),
    ((287,227),[((303,215),(324,217),(335,227))]),
    ((283,263),[((278,274),(290,286),(302,288))]),
]: line(start,segments,'highlight',.55)
# Short tapering striations give the folds a finer engraved texture.
for i in range(11):
    x=253+i*7
    line((x,175+(i-5)**2*.2),[((x+2,182),(x-2,187),(x-5,190))],size=.43)
for i in range(12):
    x=222+i*9
    y=348+16*math.sin(i/11*math.pi)
    line((x,y),[((x+2,y+6),(x+6,y+10),(x+9,y+12))],size=.45)
for i in range(10):
    x=157+i*8;y=365+i*2
    line((x,y),[((x-4,y+9),(x+1,y+16),(x+8,y+20))],size=.45)
for i in range(9):
    x=381+i*9;y=358-i*5
    line((x,y),[((x-4,y-10),(x-3,y-16),(x+2,y-21))],size=.45)
# Enlarge the artwork 30% inside the same canvas; retain air around its edges.
points=[[round(300+(x-300)*1.3,2),round(280+(y-280)*1.3,2),c,
         round(size*(.84 if c in ('red','blue') else 1),2)]
        for x,y,c,size in points]

# Spatial neighbors form the local mesh without long lines across petal gaps.
edges=set();cells=defaultdict(list)
for i,(x,y,*_) in enumerate(points):cells[(int(x//16),int(y//16))].append(i)
for i,(x,y,c,_) in enumerate(points):
    cx,cy=int(x//16),int(y//16)
    near=[]
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            for j in cells[(cx+dx,cy+dy)]:
                if j!=i and points[j][2]==c:near.append(((x-points[j][0])**2+(y-points[j][1])**2,j))
    for distance,j in sorted(near)[:3]:
        if distance<15**2:edges.add(tuple(sorted((i,j))))
# A sparse scaffold joins remaining components into one connected graph.
parent=list(range(len(points)))
def find(i):
    while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
    return i
for a,b in edges:parent[find(a)]=find(b)
components=defaultdict(list)
for i in range(len(points)):components[find(i)].append(i)
joined=max(components.values(),key=len)[:]
remaining=[v for v in components.values() if v!=joined]
for group in sorted(remaining,key=len,reverse=True):
    _,a,b=min(((points[a][0]-points[b][0])**2+(points[a][1]-points[b][1])**2,a,b) for a in joined for b in group)
    edges.add(tuple(sorted((a,b))));joined.extend(group)
graph={'viewBox':[-8,-8,616,616],'points':points,'edges':sorted(edges),'description':'Original asymmetric rose with independently composed cubic petal contours.'}
(ROOT/'public/assets/rose-graph.json').write_text(json.dumps(graph,separators=(',',':'))+'\n')
colors={'ink':'#21382f','red':'#c53c32','blue':'#30758a','stem':'#45634b','highlight':'#e28a65'}
svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 616 616">'
for color,hexcolor in colors.items():
    opacity=.28 if color=='stem' else .9
    svg+=f'<g fill="{hexcolor}" fill-opacity="{opacity}">'+''.join(f'<circle cx="{x}" cy="{y}" r="{1.65*s:.2f}"/>' for x,y,c,s in points if c==color)+'</g>'
svg+='</svg>\n'
(ROOT/'public/assets/rose-point-cloud.svg').write_text(svg)
print(f'Rose: {len(points)} points, {len(edges)} edges')
