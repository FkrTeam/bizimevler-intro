import json
def picks(c):
    j=json.load(open(c+".json")); L=[]
    for s,b in enumerate(j["big"]):
        for off in (range(8) if b else (0,2,4,6)):
            L.append((f"{c}_out/{s*8+off+1:08d}.png",1))
    return j,L
def write(name,L):
    out=["ffconcat version 1.0"]
    for f,t in L+[L[-1]]:
        out+= [f"file '{f}'","option framerate 120",f"duration {t/120:.9f}"]
    open(name,"w").write("\n".join(out)+"\n")
    n=sum(t for _,t in L); print(name,n,"frames",n/120,"s"); return n
j,L=picks("d")
L+=[(f"d/{i+1:04d}.png",5) for i in range(j["keep"][-1],j["N"])]
nd=write("d120.ffconcat",L)
j,L=picks("m")
npan=j["N"]-j["keep"][-1]
L+=[(f"p_out/{k+1:08d}.png",1) for k in range((npan-1)*4+1)]
nm=write("m120.ffconcat",L)
open("counts.txt","w").write(f"{nd} {nm}\n")
