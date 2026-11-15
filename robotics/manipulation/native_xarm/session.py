"""Durable single-flight finite trajectory session. No retry, reattach or resume after uncertainty."""
import json
import math
import os
from pathlib import Path
import threading
import time
from .policy import load_profile,validate_trajectory

class Session:
    def __init__(self,journal,port,run_id,boot_id,epoch,now=None):
        self.path=Path(journal);self.port=port;self.run_id=run_id;self.boot_id=boot_id;self.epoch=epoch;self.now=now or (lambda:time.monotonic()*1000)
        self.lock=threading.RLock();self.receipts={};self.active=None;self.fatal=None;self.sample=None;self.received=None;self.clock_advanced=None;self.seq=0
        try:
            with self.path.open('x') as f:f.write('{}');f.flush();os.fsync(f.fileno())
        except FileExistsError:raise RuntimeError('RESTART_RECONCILE_REQUIRED') from None
        self.persist()

    def persist(self):
        temporary=self.path.with_suffix('.tmp')
        with temporary.open('w') as stream:
            json.dump({'schemaVersion':1,'runId':self.run_id,'bootId':self.boot_id,'epoch':self.epoch,'evidenceKind':self.port.evidence_kind,'fatal':self.fatal,'receipts':self.receipts},stream,allow_nan=False);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,self.path)
        descriptor=os.open(self.path.parent,os.O_RDONLY)
        try:os.fsync(descriptor)
        finally:os.close(descriptor)

    def unknown(self,reason):
        self.fatal=self.fatal or reason
        for r in self.receipts.values():
            if r['status'] in ('intent','accepted','running','unknown'):r['status']='unknown';r['answer']={'accepted':False,'unknown':True,'reason':self.fatal}
        self.persist()

    def observe(self,sample,received=None):
        with self.lock:
            if self.fatal:return
            at=sample.get('receivedMs',self.now()) if received is None else received
            try:
                if sample['bootId']!=self.boot_id or sample['epoch']!=self.epoch:raise ValueError('CONTROLLER_RESTART')
                if not isinstance(sample['seq'],int) or sample['seq']<=self.seq:raise ValueError('SEQUENCE_STALE')
                for k,n in [('actualRad',6),('commandedRad',6),('tcpM',3)]:
                    if not isinstance(sample.get(k),list) or len(sample[k])!=n or not all(isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x) for x in sample[k]):raise ValueError('ACTUAL_FEEDBACK_MISSING')
                clock,stamp=sample['clockNs'],sample['stampNs']
                if not isinstance(clock,int) or not isinstance(stamp,int) or not 0<=stamp<=clock or clock-stamp>500_000_000:raise ValueError('FEEDBACK_STALE')
                if self.sample and (clock<self.sample['clockNs'] or stamp<=self.sample['stampNs'] or at<self.received):raise ValueError('CLOCK_OR_FEEDBACK_RESET')
                if not self.sample or clock>self.sample['clockNs']:self.clock_advanced=at
                self.sample=sample.copy();self.seq=sample['seq'];self.received=at
            except (KeyError,TypeError,ValueError) as error:self.unknown(str(error))

    def healthy(self):
        if not self.fatal and (self.received is None or not 0<=self.now()-self.received<=500 or self.clock_advanced is None or not 0<=self.now()-self.clock_advanced<=500):self.unknown('FEEDBACK_STALE')
        return not self.fatal

    def execute(self,command_id,payload_hash,points):
        with self.lock:
            if command_id in self.receipts:
                r=self.receipts[command_id]
                if r['hash']!=payload_hash or r['points']!=points:return {'accepted':False,'unknown':False,'reason':'COMMAND_ID_CONFLICT'}
                return r['answer']
            if not self.healthy():return {'accepted':False,'unknown':True,'reason':self.fatal}
            if self.active is not None:return {'accepted':False,'unknown':False,'reason':'TRAJECTORY_BUSY'}
            try:validate_trajectory(points,self.sample['actualRad'])
            except ValueError as error:return {'accepted':False,'unknown':False,'reason':str(error)}
            r={'hash':payload_hash,'points':points,'status':'intent','startedMs':self.now(),'startedSeq':self.seq,'answer':{'accepted':False,'unknown':True}};self.receipts[command_id]=r;self.active=command_id;self.persist()
            try:
                answer=self.port.send(points)
                if answer not in ('accepted','rejected'):raise RuntimeError('ACK_UNKNOWN')
                r['status']='accepted' if answer=='accepted' else 'failed';r['answer']={'accepted':answer=='accepted','unknown':False}
                if answer=='rejected':self.active=None
                self.persist()
            except Exception:self.unknown('ACK_UNKNOWN')
            return r['answer']

    def query(self,command_id):
        with self.lock:
            r=self.receipts.get(command_id)
            if not r:return {'status':'not_found','evidence':{}}
            self.healthy()
            if self.fatal:return {'status':'unknown','evidence':{'reason':self.fatal}}
            if r['status'] in ('accepted','running'):
                try:
                    status=self.port.result()
                    if status not in ('running','completed','failed','canceled'):raise RuntimeError('RESULT_LOST')
                    if self.now()-r['startedMs']>r['points'][-1]['timeS']*1000+load_profile()['resultGraceMs']:raise RuntimeError('RESULT_TIMEOUT')
                    if status=='completed' and (self.seq<=r['startedSeq'] or max(abs(a-b) for a,b in zip(self.sample['actualRad'],r['points'][-1]['positions']))>load_profile()['trajectory']['goalToleranceRad']):raise RuntimeError('TARGET_NOT_OBSERVED')
                    r['terminalReason']=status;r['status']='failed' if status=='canceled' else status
                    if status!='running':self.active=None
                    self.persist()
                except Exception:self.unknown('RESULT_UNKNOWN')
            return {'status':r['status'],'evidence':{'evidenceKind':self.port.evidence_kind,'terminalReason':r.get('terminalReason'),'actualRad':self.sample['actualRad'],'commandedRad':self.sample['commandedRad'],'tcpM':self.sample['tcpM']}}

    def cancel(self,command_id):
        with self.lock:
            if self.active!=command_id:return {'acknowledged':False,'unknown':bool(self.fatal)}
            try:
                if not self.port.cancel():raise RuntimeError('CANCEL_TIMEOUT')
                # Cancel acknowledgement is not a stopped-controller observation. Query must observe terminal cancellation.
                return {'acknowledged':True,'unknown':False}
            except Exception:self.unknown('CANCEL_UNKNOWN');return {'acknowledged':False,'unknown':True}
