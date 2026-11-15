"""Offline read-only rosbag2 SQLite coverage, derived from actual messages (not metadata claims)."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def inspect_bag(directory):
    root=Path(directory);files=sorted(root.glob('*.db3'))
    if not files:raise ValueError('BAG_STORAGE_MISSING')
    rows={}
    for file in files:
        if file.is_symlink():raise ValueError('BAG_SYMLINK')
        conn=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True)
        try:
            if conn.execute('pragma quick_check').fetchone()[0]!='ok':raise ValueError('BAG_CORRUPT')
            for topic,stamp in conn.execute('select topics.name,messages.timestamp from messages join topics on topics.id=messages.topic_id order by messages.timestamp'):
                rows.setdefault(topic,[]).append(stamp)
        finally:conn.close()
    topics={}
    for topic,stamps in rows.items():
        stamps.sort();topics[topic]={'count':len(stamps),'firstNs':str(stamps[0]),'lastNs':str(stamps[-1]),'maxGapNs':str(max((b-a for a,b in zip(stamps,stamps[1:])),default=0))}
    return {'storageId':'sqlite3','topics':topics}

def retain_recovered_bag(source,destination):
    original=Path(source);target=Path(destination)
    if target.exists():return
    files=sorted(original.glob('*.db3'))
    if not files:raise ValueError('BAG_STORAGE_MISSING')
    target.mkdir()
    records=[]
    for file in files:
        if file.is_symlink():raise ValueError('BAG_SYMLINK')
        src=sqlite3.connect(file.resolve().as_uri()+'?mode=ro',uri=True)
        copy=sqlite3.connect(target/file.name)
        def digest(connection):
            h=hashlib.sha256()
            for row in connection.execute('select topic_id,timestamp,data from messages order by id'):
                h.update(str(row[0]).encode()+b'\0'+str(row[1]).encode()+b'\0'+row[2])
            return h.hexdigest()
        try:
            before=digest(src);src.backup(copy);after=digest(copy)
            if before!=after or copy.execute('pragma quick_check').fetchone()[0]!='ok':raise ValueError('BAG_COPY_MISMATCH')
            records.append({'file':file.name,'messageDigest':after,'method':'sqlite-readonly-backup-after-owned-worker-loss'})
        finally:copy.close();src.close()
    (target/'retention.json').write_text(json.dumps(records,sort_keys=True))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--retain-from');args=parser.parse_args()
    if args.retain_from:retain_recovered_bag(args.retain_from,args.input)
    print(json.dumps(inspect_bag(args.input),sort_keys=True))
