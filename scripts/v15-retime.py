import subprocess, sys, numpy as np
src, W, H, dirn, moving_end = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5])
# moving_end: first frame index of the part that is NOT drop-cadence footage
raw = subprocess.run(["ffmpeg","-v","error","-i",src,"-vf",f"scale={W}:{H}","-pix_fmt","gray","-f","rawvideo","-"],capture_output=True).stdout
f = np.frombuffer(raw,np.uint8).reshape(-1,H,W).astype(np.float32)
N=len(f)
d=[0]+[float(np.abs(f[i]-f[i-1])[H//2:].mean()) for i in range(1,N)]
keep=[0]+[i for i in range(1,moving_end) if d[i]>1.2]          # drop padded duplicates
# diff between consecutive KEPT frames
kd=[float(np.abs(f[keep[j]]-f[keep[j-1]])[H//2:].mean()) for j in range(1,len(keep))]
P=128
win=np.outer(np.hanning(P),np.hanning(P))
def shift(a,b):
    A=np.fft.fft2((a-a.mean())*win);B=np.fft.fft2((b-b.mean())*win)
    R=A*np.conj(B);R/=np.abs(R)+1e-6
    r=np.abs(np.fft.ifft2(R));y,x=np.unravel_index(r.argmax(),r.shape)
    if y>P//2:y-=P
    if x>P//2:x-=P
    return np.hypot(x,y), r.max()
def motion(a,b):
    m=[]
    for y in range(H//2,H-P+1,P//2):
        for x in range(0,W-P+1,P//2):
            dd,c=shift(a[y:y+P,x:x+P],b[y:y+P,x:x+P])
            if c>0.05:m.append(dd)
    return float(np.median(m)) if m else 0.0
km=[motion(f[keep[j-1]],f[keep[j]]) for j in range(1,len(keep))]
big=[]
for j,v in enumerate(km):
    nb=[km[k] for k in range(max(0,j-4),min(len(km),j+5)) if k!=j]
    med=np.median(nb)
    if med>=1.8: big.append(v>1.4*med)
    else:
        nbd=[kd[k] for k in range(max(0,j-4),min(len(kd),j+5)) if k!=j]
        big.append(kd[j]>1.3*np.median(nbd))
def score(j):
    nbd=[kd[k] for k in range(max(0,j-3),min(len(kd),j+4)) if k!=j]
    return kd[j]/np.median(nbd)
# the drop cadence is periodic (every 4th step, now and then every 3rd): fill what the detector missed
pos=[j for j,b in enumerate(big) if b]
while pos[0]>4: pos.insert(0,pos[0]-4)
filled=[pos[0]]
for p in pos[1:]:
    while p-filled[-1]>5:
        c=max((filled[-1]+4,filled[-1]+3),key=score)
        filled.append(c)
    filled.append(p)
big=[j in filled for j in range(len(kd))]
print("gaps",[b-a for a,b in zip(filled,filled[1:])])
print("scores of filled-in",[(j,round(score(j),2)) for j in filled if j not in pos])
for j,v in enumerate([]):
    nb=[kd[k] for k in range(max(0,j-4),min(len(kd),j+5)) if k!=j]
    big.append(v>1.22*np.median(nb))
print("kept",len(keep),"of",moving_end,"big steps",sum(big))
print("".join("B" if b else "." for b in big))
ticks=[8 if b else 4 for b in big]
lines=["ffconcat version 1.0"]
def add(i,t):
    lines.append(f"file '{dirn}/{i+1:04d}.png'"); lines.append("option framerate 120"); lines.append(f"duration {t/120:.9f}")
for j in range(len(keep)-1): add(keep[j],ticks[j])
total=sum(ticks)
print("moving part ticks",total,"=",total/120,"s; original",moving_end/ (N/11.0),"s")
open(dirn+"_ticks.txt","w").write(f"{total}\n")
# hand-off frame and the rest are written by the caller-specific tail
tail=sys.argv[6]  # "interp4" | "none"
last=keep[-1]
if tail=="interp4":
    add(last,4)
    for i in range(moving_end,N): add(i,4)
else:
    add(last,4)
for _ in range(3): add(N-1 if tail=="interp4" else last,4)   # padding so the filter flushes
open(dirn+".ffconcat","w").write("\n".join(lines)+"\n")
import json
json.dump({"keep":keep,"big":[bool(b) for b in big],"N":N,"moving_end":moving_end},open(dirn+".json","w"))
