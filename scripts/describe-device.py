#!/usr/bin/env python3
"""Summarise a CANopen EDS or an EtherCAT ESI into canonical JSON (DescriptionSummary). Stdlib only; the input is untrusted data.

usage: python3 -I -B scripts/describe-device.py FILE > FILE.summary.json
Exit 2 with DESCRIPTION_UNREADABLE on stderr when the file is not a usable description. The output has sorted keys, no timestamps and objects ordered by (index, subindex)."""
import sys, json, hashlib, configparser, xml.etree.ElementTree as ET

MODES = [('pp', 0), ('pv', 2), ('pt', 3), ('hm', 5), ('csp', 7), ('csv', 8), ('cst', 9)]
ACCESS = {'ro': 'ro', 'const': 'ro', 'wo': 'wo', 'rw': 'rw', 'rwr': 'rw', 'rww': 'rw'}


def fail(why):
    sys.stderr.write('DESCRIPTION_UNREADABLE %s\n' % why)
    sys.exit(2)


def num(text):
    t = (text or '').strip().lower().replace('#x', '0x').replace('$', '')
    try:
        return int(t, 16) if t.startswith('0x') else int(t, 10)
    except ValueError:
        return None


def hex32(text):
    n = num(text)
    return None if n is None else '0x%08X' % n


def modes(mask):
    return [name for name, bit in MODES if mask is not None and mask >> bit & 1]


def eds(raw):
    c = configparser.RawConfigParser(strict=False)
    c.optionxform = str
    try:
        c.read_string(raw.decode('latin-1'))
    except configparser.Error as e:
        fail('eds ' + str(e)[:80])
    if not c.has_section('DeviceInfo') or not c.has_section('FileInfo'):
        fail('eds has no FileInfo/DeviceInfo')
    d = c['DeviceInfo']
    objs, mask = [], None
    for s in c.sections():
        low = s.lower()
        head = low[:4]
        if len(head) != 4 or any(ch not in '0123456789abcdef' for ch in head):
            continue
        if int(head, 16) < 0x1000:
            continue
        if low == head:
            if c.get(s, 'ObjectType', fallback='7').strip() not in ('7', '0x7'):
                continue
            sub = 0
        elif low.startswith(head + 'sub'):
            sub = num('0x' + low[7:]) if all(ch in '0123456789abcdef' for ch in low[7:]) and low[7:] else None
            if sub is None:
                continue
        else:
            continue
        acc = ACCESS.get(c.get(s, 'AccessType', fallback='ro').strip().lower(), 'ro')
        pdo = c.get(s, 'PDOMapping', fallback='0').strip() in ('1', 'true')
        objs.append({'index': head.upper(), 'subindex': sub, 'name': c.get(s, 'ParameterName', fallback=s).strip(), 'access': acc, 'pdoMappable': pdo})
        if head == '6502' and sub == 0:
            mask = num(c.get(s, 'DefaultValue', fallback=''))
    if not objs:
        fail('eds has no objects')
    return {'kind': 'eds', 'vendorId': hex32(d.get('VendorNumber')), 'productCode': hex32(d.get('ProductNumber')), 'revision': hex32(d.get('RevisionNumber')), 'supportedModes': modes(mask), 'objects': objs}


def esi(raw):
    if b'<!ENTITY' in raw or b'<!DOCTYPE' in raw:
        fail('xml with DTD or entities')
    try:
        r = ET.fromstring(raw)
    except ET.ParseError as e:
        fail('xml ' + str(e)[:80])
    dev = next(iter(r.iter('Device')), None)
    if dev is None or dev.find('Type') is None or r.find('Vendor') is None:
        fail('esi has no Vendor/Device')
    t = dev.find('Type')
    types = {}
    for dt in r.iter('DataType'):
        name = dt.findtext('Name')
        subs = []
        for si in dt.findall('SubItem'):
            fl = si.find('Flags')
            subs.append((num(si.findtext('SubIdx')), (si.findtext('Name') or '').strip(), ACCESS.get((fl.findtext('Access') if fl is not None else 'ro') or 'ro', 'ro'), (fl.findtext('PdoMapping') if fl is not None else '') or ''))
        if name:
            types[name] = subs
    objs, mask = [], None
    for o in dev.iter('Object'):
        idx = num(o.findtext('Index'))
        if idx is None or idx < 0x1000:
            continue
        fl = o.find('Flags')
        acc = ACCESS.get(((fl.findtext('Access') if fl is not None else 'ro') or 'ro').strip().lower(), 'ro')
        pdo = ((fl.findtext('PdoMapping') if fl is not None else '') or '').strip().upper() in ('R', 'T', 'RT')
        name = (o.findtext('Name') or '').strip()
        subs = [s for s in types.get((o.findtext('Type') or '').strip(), []) if s[0] is not None]
        if subs:
            for sidx, sname, sacc, spdo in subs:
                objs.append({'index': '%04X' % idx, 'subindex': sidx, 'name': name + ' / ' + sname, 'access': sacc, 'pdoMappable': spdo.strip().upper() in ('R', 'T', 'RT')})
        else:
            objs.append({'index': '%04X' % idx, 'subindex': 0, 'name': name, 'access': acc, 'pdoMappable': pdo})
        if idx == 0x6502:
            info = o.find('Info')
            mask = num(info.findtext('DefaultData')) if info is not None and info.findtext('DefaultData') else None
    if not objs:
        fail('esi has no objects')
    v = r.find('Vendor')
    return {'kind': 'esi', 'vendorId': hex32(v.findtext('Id')), 'productCode': hex32(t.get('ProductCode')), 'revision': hex32(t.get('RevisionNo')), 'supportedModes': modes(mask), 'objects': objs}


def main():
    if len(sys.argv) != 2:
        fail('usage: describe-device.py FILE')
    try:
        raw = open(sys.argv[1], 'rb').read()
    except OSError as e:
        fail('read ' + str(e)[:80])
    out = esi(raw) if raw.lstrip()[:1] == b'<' else eds(raw)
    if not (out['vendorId'] and out['productCode'] and out['revision']):
        fail('missing vendor, product code or revision')
    out['fileSha256'] = hashlib.sha256(raw).hexdigest()
    out['objects'].sort(key=lambda o: (o['index'], o['subindex']))
    sys.stdout.write(json.dumps(out, sort_keys=True, separators=(',', ':')) + '\n')


main()
