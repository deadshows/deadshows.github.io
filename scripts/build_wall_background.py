#!/usr/bin/env python3
"""Build a decorative vector interpretation of the Wall of Sound schematic.

Adapted from Ron Wickersham's schematic via Wikimedia Commons (CC BY-SA 4.0).
This is a simplified visual motif, not a technically accurate equipment plan.
"""
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://commons.wikimedia.org/wiki/File:Grateful_Dead%27s_Wall_of_sound_schematic.jpg'
parts = ['''<svg xmlns="http://www.w3.org/2000/svg" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" viewBox="0 0 1800 1200" fill="none" stroke="#45616b" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
<title>Wall of Sound — schematic background study</title>
<desc>Simplified speaker towers, suspended vocal and piano arrays, scaffold cross-bracing, and cable paths, inspired by Ron Wickersham's Wall of Sound schematic. Decorative interpretation, not a technical plan.</desc>
<metadata><rdf:RDF><cc:Work rdf:about=""><cc:license rdf:resource="https://creativecommons.org/licenses/by-sa/4.0/"/><cc:attributionName>Ron Wickersham; simplified vector adaptation by Deadshows</cc:attributionName><cc:attributionURL rdf:resource="''' + SOURCE + '''"/></cc:Work></rdf:RDF></metadata>
''']

def add(shape):
    parts.append(shape)

def line(x1,y1,x2,y2,**kwargs):
    extra=' '.join(f'{k}="{v}"' for k,v in kwargs.items())
    add(f'<path d="M{x1} {y1}L{x2} {y2}" {extra}/>')

def driver(x,y,size=42):
    add(f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="1"/>')
    cx,cy=x+size/2,y+size/2
    for ratio in [.37,.28,.105]:
        add(f'<circle cx="{cx}" cy="{cy}" r="{size*ratio:g}"/>')
    for dx,dy in [(5,5),(size-5,5),(5,size-5),(size-5,size-5)]:
        add(f'<circle cx="{x+dx}" cy="{y+dy}" r="1"/>')

def tower(x,rows,cols=1,size=42,bottom=1015):
    for row in range(rows):
        for col in range(cols):
            driver(x+col*size,bottom-(row+1)*size,size)

def rack(x,y,width=38,height=170):
    add(f'<rect x="{x}" y="{y}" width="{width}" height="{height}"/>')
    for row in range(8):
        yy=y+10+row*18
        add(f'<rect x="{x+5}" y="{yy}" width="{width-10}" height="12"/>')
        for col in range(3):
            add(f'<circle cx="{x+10+col*8}" cy="{yy+6}" r="1.6"/>')

def suspended_array(x,y,cols,rows,size):
    for col in range(cols):
        # A shallow bow references the curved original vocal cluster.
        offset=round(9*(1-((col-(cols-1)/2)/((cols-1)/2))**2),1)
        for row in range(rows):
            driver(x+col*size,y+offset+row*size,size)
    add(f'<path d="M{x} {y-10}Q{x+cols*size/2} {y+9} {x+cols*size} {y-10}"/>')
    for i in range(19):
        xx=x+cols*size*i/18
        line(round(xx,1),y-10,round(xx,1),y+3)

# Tall scaffolding, including the characteristic open cross-braced wings.
add('<g stroke-width="2.2">')
for left,right in [(140,705),(1095,1660)]:
    line(left,105,right,105)
    for x in range(left,right+1,141):
        line(x,105,x,1015)
        line(x+9,116,x+9,1004)
    for y in [120,315,510,705,900]:
        for x in range(left,right-140,141):
            line(x,y,x+141,y+175)
            line(x,y+175,x+141,y)
add('</g>')
# Center rigging and individual suspension/cable paths.
line(705,80,1095,80)
for x in [705,1095]:line(x,65,x,1015)
for x in [797,900,1003]:
    add(f'<ellipse cx="{x}" cy="107" rx="11" ry="26"/><rect x="{x-23}" y="137" width="46" height="17" rx="5"/>')
    line(x,154,x,465)
    line(x,434,x-17,467)
    line(x,434,x+17,467)
for x in [1473,1555]:
    add(f'<ellipse cx="{x}" cy="344" rx="10" ry="24"/><rect x="{x-21}" y="374" width="42" height="17" rx="5"/>')
    line(x,391,x,645)
# Stepped speaker columns rising toward the vocal cluster.
for x,rows in [(353,14),(397,13),(441,15),(485,18),(529,20),(573,18),(617,14)]:
    tower(x,rows,size=44)
for x,rows in [(1137,20),(1181,14),(1225,13),(1269,15)]:
    tower(x,rows,size=44)
suspended_array(716,476,10,5,36)
suspended_array(1355,654,7,4,33)
# Floor stacks, amplifier racks, fill speakers and the drawn stage edge.
for x,y,cols,rows,size in [(170,903,2,3,37),(250,941,1,2,37),(838,910,2,3,35),(1604,947,1,2,34)]:
    for row in range(rows):
        for col in range(cols):driver(x+col*size,y+row*size,size)
for x,y in [(296,845),(672,845),(780,840),(1008,840),(1054,870),(1323,866),(1534,868)]:
    rack(x,y)
add('<path d="M75 1098L140 1019H1660L1725 1098ZM75 1098V1105H1725V1098" stroke-width="2.2"/>')
# Fine cable runs stay geometric and do not cross the site's foreground layer.
for x in [201,272,318,380,520,688,861,1028,1159,1340,1553,1621]:
    add(f'<path d="M{x} 1022v24q0 12 16 12h{(900-x)//4}v35" stroke-width="1"/>')
add('</svg>\n')
path=ROOT/'public/assets/wall-of-sound-schematic.svg'
path.write_text(''.join(parts))
print(f'Built {path.name}: {path.stat().st_size:,} bytes')
