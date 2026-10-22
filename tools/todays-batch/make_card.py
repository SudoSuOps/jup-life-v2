#!/usr/bin/env python3
"""JUP LIFE Today's Batch generator.  Usage: python3 make_card.py batch.yaml [--out DIR]
Exports a 3.5in print card (PDF+PNG), social feed 1080x1350, story 1080x1920, web banner 1600x600, and today.html."""
import sys, os, re, base64, datetime, subprocess, argparse, html, yaml
from reportlab.pdfgen import canvas
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.colors import HexColor as H
HERE=os.path.dirname(os.path.abspath(__file__))
for w in ['500','600','700','800','500Italic','600Italic']:
    pdfmetrics.registerFont(TTFont('M'+w,f'{HERE}/fonts/Montserrat-{w}.ttf'))
LOGO=f'{HERE}/logo.png'
# ---- LOCKED brand copy / colors ----
KRAFT=H('#E9D9BC'); COCOA=H('#4A2F22'); TERRA=H('#B8603E'); SAGE=H('#6E7D50'); CHALK=H('#2F3A2C'); CREAM=H('#F4EBDD'); FRAME=H('#8B6A47'); GOLD=H('#E8B27A')
TITLE="TODAY'S BATCH"; LOCAL='Locally grown in Jupiter, FL'; CLAIM='Washable, dishwasher safe TPU  ·  Built different.'
SITE='juplifestudio.com'; CONTACT='Wholesale: Smash  ·  561-532-7120'
MIN_PT=6.0; WARN=[]
sw=pdfmetrics.stringWidth
def fit(text,font,size,maxw,minsize,label):
    s=size
    while sw(text,font,s)>maxw and s>minsize: s-=0.1
    if sw(text,font,s)>maxw: WARN.append(f'{label}: "{text}" does not fit even at {minsize:.1f}pt (needs {sw(text,font,minsize):.0f} of {maxw:.0f}). Shorten it.')
    elif s<size-0.01: WARN.append(f'note: {label} auto-shrunk to {s:.1f}pt')
    return s
def load(fn):
    b=yaml.safe_load(open(fn))
    b.setdefault('tiers',[{'qty':100,'price':2.00},{'qty':500,'price':1.60},{'qty':1000,'price':1.20}])
    b.setdefault('samples_free',True); b.setdefault('chefs_special',''); b.setdefault('batch_no','')
    if len(b['flavors'])>6: sys.exit('max 6 flavors')
    d=b.get('date'); b['_date']=datetime.date.fromisoformat(str(d)) if d else None
    return b
def datestr(b): return b['_date'].strftime('%a %b ')+str(b['_date'].day) if b['_date'] else ''
def subline(b): return f"{LOCAL}  ·  Harvested {b['harvest']}"
def divlabel(b): return ' · '.join(x for x in [b['season'].upper(), datestr(b).upper()] if x)
# ---- primitives (all in points, k = scale) ----
def tag(c,x,y,w,h,f,k,minpt,lab,nr=0.62):
    c.setFillColor(CREAM); c.setStrokeColor(COCOA); c.setLineWidth(0.5*k)
    p=c.beginPath(); n=0.55*h; p.moveTo(x+n,y); p.lineTo(x+w,y); p.lineTo(x+w,y+h); p.lineTo(x+n,y+h); p.lineTo(x,y+h/2); p.close(); c.drawPath(p,1,1)
    c.setFillColor(KRAFT); c.circle(x+n*0.85,y+h/2,0.1*h,1,1)
    dx=x+n*0.85+0.75*h; c.setFillColor(H(f['color'])); c.setStrokeColor(COCOA); c.setLineWidth(0.3*k); c.circle(dx,y+h/2,0.25*h,1,1)
    nf=nr*h; tx=dx+0.42*h; c.setFillColor(COCOA); c.setFont('M700',nf); c.drawString(tx,y+h*0.3,f['name'])
    room=x+w-0.3*h-(tx+sw(f['name'],'M700',nf)+0.35*h)
    s=fit(f.get('note',''),'M500Italic',0.5*h,room,minpt,lab+' note '+f['name'])
    c.setFont('M500Italic',s); c.drawRightString(x+w-0.3*h,y+h*0.31,f.get('note',''))
def chalk(c,x,y,w,h,b,k):
    c.setFillColor(FRAME); c.roundRect(x-2.5*k,y-2.5*k,w+5*k,h+5*k,4*k,0,1); c.setFillColor(CHALK); c.roundRect(x,y,w,h,3*k,0,1)
    cx=x+w/2; u=h/100; c.setFillColor(CREAM)
    c.setFont('M800',min(8.5*k,w/11)); c.drawCentredString(cx,y+h-14*u,'BY THE BATCH')
    c.setStrokeColor(CREAM); c.setLineWidth(0.4*k); c.setDash(k,1.5*k); c.line(x+8*k,y+h-19*u,x+w-8*k,y+h-19*u); c.setDash()
    c.setFont('M500',max(6,6*k)); c.drawCentredString(cx,y+h-27*u,'price per coaster')
    for i,t in enumerate(b['tiers'][:4]):
        yy=y+(62-i*15)*u; c.setFont('M600',7.5*k); c.drawString(x+8*k,yy,f"{t['qty']:,}")
        c.setFont('M800',8.5*k); c.drawRightString(x+w-17*k,yy,f"${t['price']:.2f}"); c.setFont('M500',6*k); c.drawRightString(x+w-7*k,yy,'ea')
    if b['samples_free']:
        c.setFillColor(GOLD); c.setFont('M600Italic',7*k); c.drawCentredString(cx,y+15*u,'Samples'); c.drawCentredString(cx,y+6*u,'on the house')
def ribbon(c,cx,y,text,k,maxw):
    s=fit('★ CHEF’S SPECIAL: '+text,'M700',7*k,maxw-16*k,6*k,'chefs_special')
    t='★ CHEF’S SPECIAL: '+text; w=sw(t,'M700',s)+16*k; h=s*1.9
    c.setFillColor(TERRA); p=c.beginPath(); x0=cx-w/2; x1=cx+w/2
    for xa,dirn in [(x0,-1),(x1,1)]:
        q=c.beginPath(); q.moveTo(xa,y); q.lineTo(xa+dirn*6*k,y); q.lineTo(xa+dirn*3*k,y+h/2); q.lineTo(xa+dirn*6*k,y+h); q.lineTo(xa,y+h); q.close(); c.setFillColor(H('#8F4A2F')); c.drawPath(q,0,1)
    c.setFillColor(TERRA); c.rect(x0,y,w,h,0,1); c.setFillColor(CREAM); c.setFont('M700',s); c.drawCentredString(cx,y+h*0.32,t)
def frame(c,W,H_,k,bleed=0):
    c.setFillColor(KRAFT); c.rect(-bleed,-bleed,W+2*bleed,H_+2*bleed,0,1)
    m=10*k; c.setStrokeColor(COCOA); c.setLineWidth(0.8*k); c.roundRect(m,m,W-2*m,H_-2*m,8*k); c.setLineWidth(0.4*k); c.roundRect(m+3*k,m+3*k,W-2*m-6*k,H_-2*m-6*k,6*k)
def header(c,x,ytop,k,b,maxw):
    c.drawImage(LOGO,x,ytop-28*k,34*k,28*k,mask='auto',preserveAspectRatio=True)
    ts=fit(TITLE,'M800',16*k,maxw-40*k,10*k,'title'); c.setFillColor(TERRA); c.setFont('M800',ts); c.drawString(x+40*k,ytop-16*k,TITLE)
    ss=fit(subline(b),'M600Italic',6.2*k,maxw-41*k,MIN_PT,'subline'); c.setFillColor(COCOA); c.setFont('M600Italic',ss); c.drawString(x+41*k,ytop-26*k,subline(b))
def divider(c,x0,x1,y,k,b):
    lab=divlabel(b); c.setFont('M700',6.2*k); w=sw(lab,'M700',6.2*k)+10*k; cx=(x0+x1)/2
    c.setStrokeColor(COCOA); c.setLineWidth(0.5*k); c.setDash(k,1.5*k); c.line(x0,y,cx-w/2,y); c.line(cx+w/2,y,x1,y); c.setDash()
    c.setFillColor(COCOA); c.drawCentredString(cx,y-2.2*k,lab)
def footer(c,W,y0,k,b):
    c.setFillColor(SAGE); c.setFont('M600',7.5*k); c.drawCentredString(W/2,y0+32*k,CLAIM)
    c.setFillColor(COCOA); c.setFont('M700',8.5*k); c.drawString(26*k,y0+16*k,'Batch # '+(str(b['batch_no']) if b['batch_no'] else '________'))
    c.setFont('M600',8.5*k); c.drawRightString(W-26*k,y0+16*k,SITE); c.setFont('M500',7*k); c.drawCentredString(W/2,y0,CONTACT)
# ---- layouts ----
def card(b,fn):
    S=252; B=9; c=canvas.Canvas(fn,pagesize=(S+2*B,S+2*B)); c.translate(B,B); k=1; frame(c,S,S,k,B)
    header(c,22,S-22,k,b,S-44); divider(c,24,S-24,S-56,k,b)
    rows=b['flavors']; rh=13; gap=4 if b['chefs_special'] else 6; y=S-77
    for i,f in enumerate(rows): tag(c,24,y-i*(rh+gap)-3,118,rh,f,k,MIN_PT,'card')
    n=len(rows); bot=y-(n-1)*(rh+gap)-3
    chalk(c,150,bot,S-174,(y+rh-3)-bot,b,k)
    if b['chefs_special']: ribbon(c,S/2,bot-17,b['chefs_special'],k,S-48)
    footer(c,S,24,k,b); c.save()
def social(b,fn,W,H_):
    k=W/252*0.95; c=canvas.Canvas(fn,pagesize=(W,H_)); frame(c,W,H_,k*0.6)
    top=H_-40*k*0.6; hk=k*(1.25 if H_/W>1.5 else 1)
    header(c,(W-(41*hk+max(sw(TITLE,'M800',16*hk),sw(subline(b),'M600Italic',6.2*hk))))/2,top-(30*k if H_/W>1.5 else 0),hk,b,W-60)
    divider(c,40,W-40,top-36*hk-(30*k if H_/W>1.5 else 0),k,b)
    n=len(b['flavors']); tall=H_/W>1.5
    if tall:  # story: full-width tags then chalkboard
        rh=17*k; gap=6*k; y=top-112*k
        for i,f in enumerate(b['flavors']): tag(c,60,y-i*(rh+gap),W-120,rh,f,k,0.36*rh,'story')
        cb=y-(n-1)*(rh+gap)-20*k-108*k; chalk(c,W/2-90*k,cb,180*k,108*k,b,k*1.2)
        if b['chefs_special']: ribbon(c,W/2,cb-30*k,b['chefs_special'],k*1.15,W-120)
    else:
        rh=19*k; gap=(7 if b['chefs_special'] else 11)*k; y=top-75*k; tw=W*0.55
        for i,f in enumerate(b['flavors']): tag(c,50,y-i*(rh+gap),tw,rh,f,k,0.36*rh,'feed',0.5)
        bot=y-(n-1)*(rh+gap); chalk(c,50+tw+28,bot,W-50-tw-28-50,y+rh-bot,b,k*1.1)
        if b['chefs_special']: ribbon(c,W/2,bot-30*k,b['chefs_special'],k*1.2,W-100)
    footer(c,W,40,k,b) if False else None
    s=k; c.setFillColor(SAGE); c.setFont('M600',7.5*s); c.drawCentredString(W/2,40+40*s,CLAIM)
    c.setFillColor(COCOA); c.setFont('M700',8.5*s); c.drawCentredString(W/2,40+22*s,SITE)
    c.setFont('M500',7*s); c.drawCentredString(W/2,40+6*s,CONTACT); c.save()
def banner(b,fn):
    W,H_=1600,600; k=2.4; c=canvas.Canvas(fn,pagesize=(W,H_)); frame(c,W,H_,1.6)
    header(c,50,H_-60,k*1.25,b,560); 
    c.setFillColor(COCOA); c.setFont('M700',22); c.drawString(102,H_-190,divlabel(b))
    c.setFillColor(SAGE); c.setFont('M600',19); c.drawString(102,H_-225,'Washable, dishwasher safe TPU · Built different.')
    c.setFillColor(COCOA); c.setFont('M700',26); c.drawString(102,110,SITE); c.setFont('M500',19); c.drawString(102,78,CONTACT)
    if b['chefs_special']: ribbon(c,330,170,b['chefs_special'],2.6,540)
    rh=34; gap=14; x=640; y=H_-110
    for i,f in enumerate(b['flavors']): tag(c,x,y-i*(rh+gap),470,rh,f,2.4,14,'banner')
    bot=y-(len(b['flavors'])-1)*(rh+gap); chalk(c,1160,bot,380,y+rh-bot,b,3.0); c.save()
def html_snippet(b,fn):
    logo=base64.b64encode(open(LOGO,'rb').read()).decode(); e=html.escape
    fl=''.join(f'<li style="display:flex;align-items:center;gap:10px;background:#F4EBDD;border:1px solid #4A2F22;border-radius:3px 6px 6px 3px;padding:6px 12px;margin:6px 0"><span style="width:14px;height:14px;border-radius:50%;background:{e(f["color"])};border:1px solid #4A2F22;flex:none"></span><b>{e(f["name"])}</b><i style="margin-left:auto;font-size:13px">{e(f.get("note",""))}</i></li>' for f in b['flavors'])
    tr=''.join(f'<tr><td>{t["qty"]:,}</td><td style="text-align:right"><b>${t["price"]:.2f}</b> ea</td></tr>' for t in b['tiers'])
    chef=f'<div style="display:inline-block;background:#B8603E;color:#F4EBDD;font-weight:700;padding:6px 14px;margin-top:10px;border-radius:3px">★ Chef’s Special: {e(b["chefs_special"])}</div>' if b['chefs_special'] else ''
    samp='<div style="color:#E8B27A;font-style:italic;margin-top:8px;text-align:center">Samples on the house</div>' if b['samples_free'] else ''
    dl=e(divlabel(b))
    out=f'''<!-- JUP LIFE Today's Batch embed: self-contained, paste anywhere -->
<div style="font-family:Montserrat,'Helvetica Neue',Arial,sans-serif;background:#E9D9BC;color:#4A2F22;border:2px solid #4A2F22;border-radius:12px;padding:20px 22px;max-width:640px;box-sizing:border-box">
<div style="display:flex;align-items:center;gap:14px"><img src="data:image/png;base64,{logo}" alt="JUP LIFE" style="height:48px"><div><div style="color:#B8603E;font-weight:800;font-size:30px;letter-spacing:.5px">TODAY'S BATCH</div><div style="font-style:italic;font-size:13px">{e(subline(b))}</div></div></div>
<div style="border-top:1px dashed #4A2F22;margin:12px 0 4px;text-align:center;font-weight:700;font-size:12px;letter-spacing:1px">{dl}</div>
<div style="display:flex;flex-wrap:wrap;gap:18px"><ul style="list-style:none;padding:0;margin:0;flex:1 1 300px">{fl}</ul>
<div style="flex:0 1 200px;background:#2F3A2C;color:#F4EBDD;border:5px solid #8B6A47;border-radius:6px;padding:12px 14px;align-self:center"><div style="font-weight:800;text-align:center">BY THE BATCH</div><div style="font-size:11px;text-align:center;border-top:1px dashed #F4EBDD;margin-top:4px;padding-top:4px">price per coaster</div><table style="width:100%;color:#F4EBDD;font-size:15px;margin-top:6px">{tr}</table>{samp}</div></div>
<div style="text-align:center">{chef}</div>
<div style="text-align:center;color:#6E7D50;font-weight:600;font-size:13px;margin-top:12px">{e(CLAIM)}</div>
<div style="display:flex;justify-content:space-between;font-weight:700;margin-top:8px;font-size:14px"><span>Batch # {e(str(b['batch_no']) or '________')}</span><a href="https://{SITE}" style="color:#4A2F22">{SITE}</a></div>
<div style="text-align:center;font-size:12px;margin-top:4px">{e(CONTACT)}</div></div>
'''
    open(fn,'w').write(out)
def png(pdf,dpi):
    subprocess.run(['pdftoppm','-png','-r',str(dpi),'-singlefile',pdf,pdf[:-4]],check=True)
if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('batch'); ap.add_argument('--out',default=None); a=ap.parse_args()
    b=load(a.batch); d=(b['_date'] or datetime.date.today()).isoformat()
    slug=re.sub(r'[^a-z0-9]+','_',b['season'].lower()).strip('_'); out=a.out or os.path.join(HERE,'out',f'{slug}_{d}'); os.makedirs(out,exist_ok=True)
    base=os.path.join(out,f'TodaysBatch_{slug}_{d}')
    card(b,base+'_card_3.5in.pdf'); png(base+'_card_3.5in.pdf',300)
    social(b,base+'_feed_1080x1350.pdf',1080,1350); png(base+'_feed_1080x1350.pdf',72)
    social(b,base+'_story_1080x1920.pdf',1080,1920); png(base+'_story_1080x1920.pdf',72)
    banner(b,base+'_banner_1600x600.pdf'); png(base+'_banner_1600x600.pdf',72)
    for x in ['feed_1080x1350','story_1080x1920','banner_1600x600']: os.remove(f'{base}_{x}.pdf')
    html_snippet(b,os.path.join(out,'today.html'))
    for w in WARN:
        if 'does not fit' in w or w.startswith('note: card'): print('WARNING:' if 'does not fit' in w else ' ', w)
    print('wrote',out); sys.exit(2 if any('does not fit' in w and w.startswith('card') for w in WARN) else 0)
