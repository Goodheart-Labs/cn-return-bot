import subprocess, sys, time, os
cmds = [l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]
for c in cmds:
    load = os.getloadavg()[0]
    t = time.time()
    r = subprocess.run(c, shell=True, capture_output=True, text=True)
    out = (r.stdout + r.stderr)
    errs = out.count('error TS')
    print(f"{time.time()-t:7.1f}s exit={r.returncode} load={load:.1f} errTS={errs} :: {c}", flush=True)
    open(sys.argv[1]+'.'+str(cmds.index(c))+'.log','w').write(out)
