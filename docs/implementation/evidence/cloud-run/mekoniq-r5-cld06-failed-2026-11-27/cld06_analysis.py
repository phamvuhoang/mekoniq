import json,sys,gzip,glob,math
A='/Users/hoangpham/source/prv/robot/evidence-archive/'
MAC=A+'r5-cld06-0d365afd/mac-stop-report.json';CLD=A+'r5-cld06-0d365afd/stop-report.json'
RUN=A+'r5-chain-0d365afd/r5-candidate-02/inputs/stop/s1-emergency-coast/run/physics/'
DT=0.02;wrap=lambda a:(a+math.pi)%(2*math.pi)-math.pi
def tel(p):
  r=json.load(open(p));s={int(x['simTimeNs'])//20_000_000:x['observed'] for x in r['telemetry']['samples'] if x['entityId']=='amr-1'};return r,s
def kin(s):
  """central difference over the neighbouring samples: v along heading (m/s), omega (rad/s)"""
  t=sorted(s);out={}
  for a,b,c in zip(t,t[1:],t[2:]):
    pa,pc=s[a],s[c];dt=(c-a)*DT;y=s[b]['yawRad']
    dx,dy=pc['xM']-pa['xM'],pc['yM']-pa['yM']
    out[b]=dict(yaw=y,v=(dx*math.cos(y)+dy*math.sin(y))/dt,w=wrap(pc['yawRad']-pa['yawRad'])/dt,x=s[b]['xM'],y_=s[b]['yM'])
  return out
rm,sm=tel(MAC);rc,sc=tel(CLD);km,kc=kin(sm),kin(sc)
# Mac per tick from physics
P={}
for f in sorted(glob.glob(RUN+'physics-*.ndjson.gz')):
  for l in gzip.open(f,'rt'):
    r=json.loads(l);P[r['tick']]=r
def yawq(q):x,y,z,w=q;return math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))
def ptick(t):
  a,b=P[t-1]['base'][0]['poseMap'],P[t]['base'][0]['poseMap'];y=yawq(b['quaternionXyzw'])
  dx,dy=b['positionM'][0]-a['positionM'][0],b['positionM'][1]-a['positionM'][1]
  d=P[t]['drives'];return dict(yaw=y,v=(dx*math.cos(y)+dy*math.sin(y))/DT,w=wrap(y-yawq(a['quaternionXyzw']))/DT,tq=[x['torqueNm'] for x in d],wv=[x['actualVelocityRadS'] for x in d])
common=sorted(set(km)&set(kc))
f=lambda x:'%+.4f'%x
print('## M1 yaw divergence')
for th in (1e-4,1e-3,1e-2,0.1):
  t=next(t for t in common if abs(wrap(km[t]['yaw']-kc[t]['yaw']))>th);print('first |dyaw|>%g at tick %d'%(th,t))
def straight(k):
  ts=sorted(k)
  for i,t in enumerate(ts):
    if t>100 and all(abs(k[u]['w'])<0.05 and k[u]['v']>0.05 for u in ts[i:i+3]):return t
ms,cs=straight(km),straight(kc)
def row(lbl,t):
  m,c=km.get(t),kc.get(t);p=ptick(t) if t in P and t-1 in P else None
  print('|%s|%d|%s|%s|%s|%s|%s|%s|%s|%s|%s|'%(lbl,t,f(m['yaw']),f(c['yaw']),f(m['v']),f(c['v']),f(m['w']),f(c['w']),f(p['yaw']) if p else '-',f(p['v']) if p else '-',f(p['w']) if p else '-'))
print('\n|mốc|tick|yaw Mac|yaw cloud|v Mac|v cloud|ω Mac|ω cloud|yaw Mac/tick|v Mac/tick|ω Mac/tick|')
for t in (40,60,80,100,140,160,180):row('xoay',t)
row('Mac chạy thẳng',ms);row('cloud chạy thẳng',cs);row('trước 412',410)
print('\n## after 412: torque')
for t in range(409,416):
  p=ptick(t);print('mac tick',t,'torque L/R',['%.4f'%x for x in p['tq']],'wheel rad/s',['%.3f'%x for x in p['wv']])
for lbl,r in (('mac',rm),('cloud',rc)):
  m=r['stopReport']['metrics'];print(lbl,'torqueZeroTick(all axes)',m['torqueZeroTick'],'stopTimeMs',m['stopTimeMs'],'restTick',412+m['stopTimeMs']//20,'stopDistanceM',m['stopDistanceM'],'peakDecel',m['peakDecelerationMps2'],'cupMaxSlipMm',m['cupMaxSlipMm'],'drift',m['postStopDriftMm'],'drives',r['stopReport']['drives'])
print('\n## speed profile (telemetry, |v| m/s)\n|tick|Mac|cloud|Mac/tick|')
for t in [x for x in sorted(set(km)|set(kc)) if 405<=x<=600]:
  p=ptick(t) if t in P else None
  print('|%d|%s|%s|%s|'%(t,'%.4f'%km[t]['v'] if t in km else '-','%.4f'%kc[t]['v'] if t in kc else '-','%.4f'%p['v'] if p else '-'))
def path(s,a,b):
  t=[x for x in sorted(s) if a<=x<=b];return sum(math.hypot(s[v]['xM']-s[u]['xM'],s[v]['yM']-s[u]['yM']) for u,v in zip(t,t[1:]))
for lbl,s,r in (('mac',sm,rm),('cloud',sc,rc)):
  rest=412+r['stopReport']['metrics']['stopTimeMs']//20;print(lbl,'telemetry path 412->rest(%d) = %.4f m'%(rest,path(s,412,rest)),' 0->412 = %.4f m'%path(s,0,412))
print('\n## same entry speed: Mac coast from the tick its speed falls to the cloud speed at 412')
vc=kc[412]['v'];t0=next(t for t in range(413,700) if ptick(t)['v']<=vc)
rest=572;d=sum(math.hypot(P[t]['base'][0]['poseMap']['positionM'][0]-P[t-1]['base'][0]['poseMap']['positionM'][0],P[t]['base'][0]['poseMap']['positionM'][1]-P[t-1]['base'][0]['poseMap']['positionM'][1]) for t in range(t0+1,rest+1))
print('cloud v@412=%.4f; Mac reaches it at tick %d (v=%.4f); Mac distance %d->rest %d = %.4f m over %d ms; cloud 0.1629 m over 1380 ms'%(vc,t0,ptick(t0)['v'],t0,rest,d,(rest-t0)*20))
for lbl,k,a,b in (('mac',None,412,572),('cloud',kc,412,481)):
  if k is None: va,vb=ptick(a)['v'],ptick(b-25)['v']
print('mean decel Mac 412->572: %.4f m/s2; cloud 412->481: %.4f m/s2'%(ptick(412)['v']/3.2,kc[412]['v']/1.38))
