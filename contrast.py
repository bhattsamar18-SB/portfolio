def lin(c):
    c/=255.0
    return c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
def rgb(h):
    h=h.lstrip("#"); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def lum(c):
    r,g,b=c; return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b)
def ratio(fg,bg):
    a,b=lum(fg),lum(bg); hi,lo=max(a,b),min(a,b); return (hi+0.05)/(lo+0.05)
def blend(fg,bg,a):
    return tuple(round(f*a+b*(1-a)) for f,b in zip(fg,bg))

print("1) .nav__brandText i  -> switch text-3 to text-2")
for bg,name,fg in [("#121215","dark nav","#a9a9bd"),("#fcfcfe","light nav","#5a5a75")]:
    print(f"   {name:10} {fg} on {bg}: {ratio(rgb(fg),rgb(bg)):.2f}:1")

print()
print("2) mobile-menu numbers: need >=4.5 on light #f6f6fb")
for c in ["#a78bfa","#7c5cff","#6a4bf0","#6d5bd0","#5f43d6"]:
    print(f"   {c}: light {ratio(rgb(c),rgb('#f6f6fb')):.2f}:1   dark {ratio(rgb(c),rgb('#07070b')):.2f}:1")

print()
print("3) marquee span: color var(--text) with opacity, bg #fcfcfe (light) / #0e0e13 (dark)")
for a in [0.5,0.6,0.65,0.7,0.72,0.75,0.8]:
    lt=blend(rgb("#12122b"),rgb("#fcfcfe"),a)
    dk=blend(rgb("#f2f2f7"),rgb("#0e0e13"),a)
    print(f"   opacity {a}: light {ratio(lt,rgb('#fcfcfe')):.2f}:1  dark {ratio(dk,rgb('#0e0e13')):.2f}:1")
