#!/usr/bin/env python3
"""Optional artwork regeneration; Pillow is needed only to regenerate the PNG."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]
S=2
im=Image.new('RGB',(1200*S,630*S),'#f4f0e4');draw=ImageDraw.Draw(im)
ink='#183d2b';blue='#2548c4'
font=lambda n:ImageFont.truetype(str(ROOT/'public/assets/fonts/bungee-shade/BungeeShade-Regular.ttf'),n*S)
solid=lambda n:ImageFont.truetype(str(ROOT/'public/assets/fonts/archivo-black/ArchivoBlack-Regular.ttf'),n*S)
for x in range(30,1200,32):
 for y in range(30,630,32):draw.ellipse((x*S,y*S,(x+1)*S,(y+1)*S),fill='#dfdfcd')
draw.rectangle((30*S,30*S,1170*S,600*S),outline=ink,width=3*S)
draw.text((65*S,75*S),'DEAD SHOWS',font=font(64),fill=ink)
draw.text((65*S,165*S),'ARCHIVE',font=font(80),fill=blue)
draw.text((70*S,325*S),'THIRTY YEARS OF LIVE DEAD',font=solid(23),fill=ink)
draw.text((70*S,382*S),'Shows · Songs · People · Eras',font=solid(18),fill=ink)
draw.text((70*S,525*S),'1965—1995  /  deadshows.github.io',font=solid(16),fill=blue)
graph=json.loads((ROOT/'public/assets/rose-graph.json').read_text())
colors={'ink':'#21382f','red':'#c53c32','blue':'#30758a','stem':'#a7b09b','highlight':'#e28a65'}
for x,y,c,r in graph['points']:
 px,py=(740+x*.67)*S,(175+y*.67)*S;radius=max(.75,r*1.1)*S
 draw.ellipse((px-radius,py-radius,px+radius,py+radius),fill=colors[c])
im.resize((1200,630),Image.Resampling.LANCZOS).save(ROOT/'public/assets/share-card.png',optimize=True)
