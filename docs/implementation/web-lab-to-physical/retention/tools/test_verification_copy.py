"""Synthetic signing keys and records exist only inside each temporary directory."""
import base64
import gzip
import hashlib
import json
import os
import sqlite3
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

SCRIPT = Path(__file__).with_name('verification-copy.py')


def digest(data):
    return hashlib.sha256(data).hexdigest()


class VerificationCopyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.source = self.folder/'original'
        self.case = self.source/'fd01-drive-ideal-v1-s7'
        self.run = self.case/'run'
        self.run.mkdir(parents=True)
        self.key = self.run/'signing-key.json'
        self.key.write_bytes(subprocess.check_output(['node','-e',
            "console.log(JSON.stringify(require('crypto').generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'})))"]))
        self.journal = self.run/'journal.db'
        self.journal.write_bytes(b'SQLite fixture; signed journal entry bytes')
        self.index = self.folder/'original.members.json'
        self.archive = self.folder/'original.tar.gz'
        self.archive.write_bytes(b'original transport digest reference')
        self.out = self.folder/'original-verification'
        self.seal()

    def seal(self):
        inventory = [dict(path=p.relative_to(self.case).as_posix(),bytes=p.stat().st_size,sha256=digest(p.read_bytes()))
                     for p in sorted(self.run.iterdir()) if p.is_file()]
        (self.case/'case.json').write_text(json.dumps(dict(artifacts=inventory,accepted=False)))
        (self.source/'campaign.json').write_text('{"campaign":{"id":"cil-v2"},"accepted":false}')
        files = sorted(p for p in self.source.rglob('*') if p.is_file() and p.name!='SHA256SUMS')
        (self.source/'SHA256SUMS').write_text(''.join(f'{digest(p.read_bytes())}  {p.relative_to(self.source)}\n' for p in files))
        files.append(self.source/'SHA256SUMS')
        self.index.write_text(json.dumps(dict(source=str(self.source),archive=str(self.archive),archiveSha256=digest(self.archive.read_bytes()),
            directories=[str(p.relative_to(self.source)) for p in self.source.rglob('*') if p.is_dir()],declaredDependencySymlinks=[],
            files=[dict(path=str(p.relative_to(self.source)),sha256=digest(p.read_bytes()),bytes=p.stat().st_size) for p in files])))

    def invoke(self, *args):
        return subprocess.run([sys.executable,'-B',str(SCRIPT),*map(str,args)],capture_output=True)

    def project(self):
        return self.invoke('project',self.source,self.index,self.archive,self.out)

    def test_preserves_journal_and_original_reseals_inventories_and_records_provenance(self):
        original = {p:p.read_bytes() for p in self.source.rglob('*') if p.is_file()}
        result = self.project()
        self.assertEqual(result.returncode,0,result.stderr)
        projected = self.out/self.key.relative_to(self.source)
        self.assertEqual(json.loads(projected.read_bytes()),{k:v for k,v in json.loads(original[self.key]).items() if k!='d'})
        self.assertEqual((self.out/self.journal.relative_to(self.source)).read_bytes(),original[self.journal])
        self.assertTrue(all(p.read_bytes()==data for p,data in original.items()))
        case = json.loads((self.out/self.case.relative_to(self.source)/'case.json').read_bytes())
        self.assertIn(dict(path='run/signing-key.json',sha256=digest(projected.read_bytes()),bytes=projected.stat().st_size),case['artifacts'])
        for line in (self.out/'SHA256SUMS').read_text().splitlines():
            sha,name=line.split('  ',1)
            self.assertEqual(digest((self.out/name).read_bytes()),sha)
        receipt=json.loads((self.out/'verification-copy.json').read_bytes())
        self.assertEqual(receipt['originalArchiveSha256'],digest(self.archive.read_bytes()))
        self.assertEqual(receipt['originalMemberIndexSha256'],digest(self.index.read_bytes()))
        self.assertEqual({r['path'] for r in receipt['members']},{str(p.relative_to(self.source)) for p in original})
        self.assertEqual(sum(r['originalSha256']!=r['projectedSha256'] for r in receipt['members']),3)
        self.assertNotEqual(self.project().returncode,0)
        another=self.folder/'second-copy'
        self.assertEqual(self.invoke('project',self.source,self.index,self.archive,another).returncode,0)
        for p in self.out.rglob('*'):
            if p.is_file():
                self.assertEqual(p.read_bytes(),(another/p.relative_to(self.out)).read_bytes())

    def test_refuses_malformed_and_unexpected_key_fields(self):
        key=json.loads(self.key.read_bytes())
        for updates in [{'crv':'other'},{'x':'invalid'},{'d':base64.urlsafe_b64encode(bytes(32)).decode().rstrip('=')},{'extra':'private'}]:
            with self.subTest(fields=list(updates)):
                self.key.write_text(json.dumps({**key,**updates}));self.seal()
                result=self.project()
                self.assertNotEqual(result.returncode,0)
                self.assertIn(b'SIGNING_KEY',result.stderr)
                self.assertFalse(self.out.exists())

    def test_refuses_symlinks_unlisted_files_and_unsafe_member_names(self):
        link=self.run/'external';link.symlink_to(self.index)
        self.assertIn(b'UNSAFE',self.project().stderr);link.unlink()
        (self.source/'unlisted.txt').touch()
        self.assertIn(b'INVENTORY',self.project().stderr)
        doc=json.loads(self.index.read_bytes());doc['files'][0]['path']='../../outside';self.index.write_text(json.dumps(doc))
        self.assertIn(b'UNSAFE',self.project().stderr);self.assertFalse(self.out.exists())

    def test_refuses_embedded_credentials_private_jwk_and_nested_logs_without_disclosing_values(self):
        secret='synthetic-test-value-for-scan'
        for i,data in enumerate([json.dumps({'payload':json.dumps({'sessionToken':secret})}).encode(),
                f'Authorization: Bearer {secret}'.encode(),self.key.read_bytes(),f'pairing code: {secret}'.encode(),f'Pairing token (expires in 5 minutes; one use): {secret}'.encode(),
                f'MEKONIQ_LAB_ACCESS_KEY={secret}'.encode(),f'-----BEGIN PRIVATE KEY-----\n{secret}'.encode()]):
            with self.subTest(case=i):
                p=self.source/'nested.log.gz';p.write_bytes(gzip.compress(data));self.seal()
                result=self.project();self.assertIn(b'SENSITIVE',result.stderr);self.assertNotIn(secret.encode(),result.stderr)
                self.assertFalse(self.out.exists())
        z=self.folder/'native.zip'
        with ZipFile(z,'w') as ar:ar.writestr('job.log',f'mekoniq_lab_session={secret}')
        result=self.invoke('scan',z);self.assertIn(b'SENSITIVE',result.stderr);self.assertNotIn(secret.encode(),result.stderr)

    def test_scans_unlabelled_github_credentials_at_family_and_length_boundaries(self):
        path=self.folder/'job.log'
        for prefix in ('ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'):
            for size,leading,refused in ((19,b'',False),(20,b'',True),(21,b'(',True),(20,b'x',False)):
                with self.subTest(family=prefix,length=size,leading=leading):
                    sample=prefix.encode()+b'a'*size
                    path.write_bytes(leading+sample+b'\n')
                    result=self.invoke('scan',path)
                    self.assertEqual(result.returncode,1 if refused else 0)
                    if refused:
                        self.assertIn(b'SENSITIVE_CONTENT',result.stderr)
                    self.assertFalse(sample in result.stdout or sample in result.stderr)

    def test_scans_sqlite_rows_in_scratch_and_leaves_original_bytes_untouched(self):
        file=self.folder/'store.db'
        with sqlite3.connect(file) as db:
            db.execute('CREATE TABLE journal(payload)')
            db.execute('INSERT INTO journal VALUES(?)',(' '*10000+json.dumps({'sessionToken':'synthetic-value-for-test'}),))
        before=digest(file.read_bytes())
        result=self.invoke('scan',file)
        self.assertIn(b'SENSITIVE',result.stderr)
        self.assertEqual(digest(file.read_bytes()),before)

    @unittest.skipUnless(os.getenv('CIL_VERIFICATION_COPY'),'supply a retained public CIL copy')
    def test_actual_copy_preserves_raw_journals_and_passes_standard_verifier(self):
        copy=Path(os.environ['CIL_VERIFICATION_COPY'])
        receipt=json.loads((copy/'verification-copy.json').read_bytes())
        checked=0
        for row in receipt['members']:
            if row['path'].endswith('/journal.db'):
                self.assertEqual(digest((copy/row['path']).read_bytes()),row['originalSha256'])
                checked+=1
        self.assertEqual(checked,receipt['publicKeyCount'])
        verify=subprocess.run(['node','scripts/lab-mujoco.mjs','verify','--input',str(copy)],capture_output=True,timeout=480)
        self.assertEqual(verify.returncode,0,verify.stderr)
        verdict=json.loads(verify.stdout)
        self.assertEqual(verdict['issues'],[])
        self.assertGreater(verdict['completedCases'],0)
        self.assertEqual(verdict['completedCases'],verdict['expectedRuns'])

if __name__=='__main__':
    unittest.main()
