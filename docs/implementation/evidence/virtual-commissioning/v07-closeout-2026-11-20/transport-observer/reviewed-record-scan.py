"""Transfer-only classifications for exact reviewed source diff bytes.
Usage: python3 -B reviewed-record-scan.py SCANNER CLASSIFICATION_JSON TARGET...
The classification JSON and this adapter must be independently reviewed and hash-bound
in the transport receipt. Never edits a candidate or exempts an entire path/file.
"""
from pathlib import Path
from collections import Counter
import hashlib,importlib.util,json,re,sys

def digest(data):
    return hashlib.sha256(data).hexdigest()

def normalize(data):
    for _ in range(5):
        plain=data.replace(b'\\\\',b'\\').replace(b'\\"',b'"')
        if b'\\u00' in plain:
            plain=re.sub(rb'\\u00([0-9a-fA-F]{2})',lambda m:bytes([int(m[1],16)]),plain)
        if plain==data:break
        data=plain
    return data

def main():
    scanner,manifest,*targets=sys.argv[1:]
    if not targets:raise ValueError('TARGET_REQUIRED')
    config=json.loads(Path(manifest).read_text())
    if digest(Path(scanner).read_bytes())!=config['scannerSha256']:raise ValueError('SCANNER_HASH_MISMATCH')
    spec=importlib.util.spec_from_file_location('verified_scanner',scanner)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    approved={row['sha256']:row for row in config['reviewedFiles']}
    if len(approved)!=len(config['reviewedFiles']):raise ValueError('DUPLICATE_CLASSIFICATION')
    base=module.Scan
    class ClassifiedScan(base):
        def text(self,name,data,sqlite=False):
            row=approved.get(self.scanned[name])
            if row is None:return super().text(name,data,sqlite)
            if sqlite or digest(data)!=self.scanned[name]:raise ValueError('CLASSIFICATION_INPUT_MISMATCH')
            normalized=normalize(data)
            matches=list(module.CREDENTIAL.finditer(normalized))
            if Counter(digest(m[0]) for m in matches)!=Counter(m['sha256'] for m in row['matches']):
                raise ValueError('CLASSIFICATION_MATCH_MISMATCH')
            for match in reversed(matches):
                normalized=normalized[:match.start()]+b' '*(match.end()-match.start())+normalized[match.end():]
            self.classify(name,'Exact source diff hash and every detector match reviewed; synthetic test literal or property expression, no credential material')
            return super().text(name,normalized,sqlite)
    module.Scan=ClassifiedScan
    return {'scannerSha256':config['scannerSha256'],'adapterSha256':digest(Path(__file__).read_bytes()),'classificationSha256':digest(Path(manifest).read_bytes()),'results':[module.scan_path(p) for p in targets]}

if __name__=='__main__':
    try:print(json.dumps(main(),indent=2))
    except Exception as exc:
        print(str(exc) if type(exc).__name__ in ('Refusal','ValueError') else 'MALFORMED_INPUT:'+type(exc).__name__,file=sys.stderr)
        sys.exit(1)
