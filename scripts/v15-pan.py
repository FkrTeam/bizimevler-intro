"""Dikey kadrajın pan bölümünü (kare 147→329, saf öteleme) 120 fps'e çıkarır: adım başına
alt-piksel kayma ölçülür, ara kareler Fourier kaydırması + çapraz geçişle üretilir.
   python scripts/v15-pan.py mobile.mp4 pan_syn.mkv
"""
import subprocess, numpy as np, os, sys
W,H=900,1300
src=sys.argv[1] if len(sys.argv)>1 else "mobile.mp4"
OUT=sys.argv[2] if len(sys.argv)>2 else "pan_syn.mkv"
LIMIT=int(os.environ.get("PAN_LIMIT","0"))
START=147
raw=subprocess.run(["ffmpeg","-v","error","-i",src,"-vf",f"select='gte(n,{START})',scale=in_color_matrix=bt709:flags=accurate_rnd+full_chroma_int","-fps_mode","passthrough","-pix_fmt","gbrp16le","-f","rawvideo","-"],capture_output=True).stdout
F=np.frombuffer(raw,np.uint16).reshape(-1,3,H,W).astype(np.float32)
if LIMIT: F=F[:LIMIT]
N=len(F); print("frames",N)
g=F[:,0]  # green plane as luma proxy
# --- global translation track, least squares over several baselines
y0,x0,PH,PW=250,194,1024,512
win=np.outer(np.hanning(PH),np.hanning(PW))
def shift(a,b):
    A=np.fft.rfft2((a-a.mean())*win);B=np.fft.rfft2((b-b.mean())*win)
    R=A*np.conj(B);R/=np.abs(R)+1e-3
    r=np.fft.irfft2(R,s=(PH,PW));y,x=np.unravel_index(r.argmax(),r.shape)
    # parabolic sub-pixel refinement
    def ref(c,m,p): 
        d=(m-2*c+p); return 0 if d==0 else 0.5*(m-p)/d
    sx=ref(r[y,x],r[y,(x-1)%PW],r[y,(x+1)%PW]); sy=ref(r[y,x],r[(y-1)%PH,x],r[(y+1)%PH,x])
    x=x-PW if x>PW//2 else x; y=y-PH if y>PH//2 else y
    return x+sx,y+sy
# per-step refinement: minimise the aligned residual directly on a crop
cy,cx,CH,CW=250,194,1024,512
fyc=np.fft.fftfreq(CH)[:,None]; fxc=np.fft.rfftfreq(CW)[None,:]
def refine(a,b,dx0,dy0):
    SA=np.fft.rfft2(a); best=(1e18,dx0,dy0)
    bb=b[32:-32,32:-32]
    def err(dx,dy):
        w=np.fft.irfft2(SA*np.exp(-2j*np.pi*(fxc*dx+fyc*dy)),s=a.shape)
        return float(np.abs(w[32:-32,32:-32]-bb).mean())
    dx,dy=dx0,dy0
    for span,step in ((1.2,0.2),(0.2,0.04),(0.04,0.01)):
        c=[(err(dx+o,dy),dx+o) for o in np.arange(-span,span+1e-9,step)]; dx=min(c)[1]
        c=[(err(dx,dy+o),dy+o) for o in np.arange(-span/2,span/2+1e-9,step)]; dy=min(c)[1]
    return dx,dy,err(dx,dy),err(dx0,dy0)
DX=[];DY=[]
for n in range(N-1):
    dx,dy,e1,e0=refine(g[n,cy:cy+CH,cx:cx+CW],g[n+1,cy:cy+CH,cx:cx+CW],*[-v for v in shift(g[n,y0:y0+PH,x0:x0+PW],g[n+1,y0:y0+PH,x0:x0+PW])])
    DX.append(dx);DY.append(dy)
    if n<6 or n%30==0 or n>N-6: print(n,"dx %.2f dy %.2f resid %.1f (track %.1f)"%(dx,dy,e1,e0))
# --- Fourier shift with reflect padding
PAD=32
fy=np.fft.fftfreq(H+2*PAD)[:,None]; fx=np.fft.rfftfreq(W+2*PAD)[None,:]
def fshift(img,dx,dy):   # content moves by (+dx,+dy)
    p=np.pad(img,((0,0),(PAD,PAD),(PAD,PAD)),mode="reflect")
    S=np.fft.rfft2(p)*np.exp(-2j*np.pi*(fx*dx+fy*dy))
    return np.fft.irfft2(S,s=p.shape[1:])[:,PAD:-PAD,PAD:-PAD]
ff=subprocess.Popen(["ffmpeg","-v","error","-y","-f","rawvideo","-pix_fmt","gbrp16le","-s",f"{W}x{H}","-r","120","-i","-","-c:v","ffv1","-pix_fmt","gbrp16le",OUT],stdin=subprocess.PIPE)
def emit(a): ff.stdin.write(np.clip(a+0.5,0,65535).astype(np.uint16).tobytes())
for n in range(N-1):
    dx=DX[n]; dy=DY[n]
    emit(F[n])
    for al in (0.25,0.5,0.75):
        wa=fshift(F[n],al*dx,al*dy); wb=fshift(F[n+1],-(1-al)*dx,-(1-al)*dy)
        out=(1-al)*wa+al*wb          # both are exactly aligned, so this is a noise cross-fade, not a ghost
        ma=int(np.ceil(abs(al*dx)))+2; mb=int(np.ceil(abs((1-al)*dx)))+2
        if dx>0: out[:,:,:ma]=wb[:,:,:ma]; out[:,:,-mb:]=wa[:,:,-mb:]
        else:    out[:,:,-ma:]=wb[:,:,-ma:]; out[:,:,:mb]=wa[:,:,:mb]
        emit(out)
emit(F[N-1]); ff.stdin.close(); ff.wait()
