"""The Python executor consumes the exact JSON Schema and JCS vectors as TypeScript."""
from pathlib import Path
import copy
import hashlib
import json

import pytest
import rfc8785
from jsonschema import Draft7Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / 'packages/contracts/schemas/wire.schema.json').read_text())
FIXTURES = ROOT / 'tests/fixtures/contracts'


def validator(name):
    schema = {**SCHEMA, 'anyOf': [{'$ref': '#/definitions/' + name}]}
    return Draft7Validator(schema, format_checker=FormatChecker())


@pytest.mark.parametrize('fixture', json.loads((FIXTURES / 'canonical.json').read_text()))
def test_canonical_golden_bytes(fixture):
    encoded = rfc8785.dumps(fixture['input'])
    assert encoded == fixture['canonical'].encode('utf-8')
    assert hashlib.sha256(encoded).hexdigest() == fixture['sha256']


def test_command_fixture_matches_schema_and_hash():
    command = json.loads((FIXTURES / 'command-v1.json').read_text())
    validator('CommandEnvelope').validate(command)
    assert command['payloadHash'] == hashlib.sha256(rfc8785.dumps(command['payload'])).hexdigest()
    for change in [{'schemaVersion': 2}, {'extra': True}, {'organizationId': ''},
                   {'coordinatorEpoch': 9007199254740992}, {'occurredAt': '2026-10-30T00:00:00+07:00'}]:
        changed = {**copy.deepcopy(command), **change}
        assert not validator('CommandEnvelope').is_valid(changed)


@pytest.mark.parametrize('minor', ['-0', '01', '+1', '1.0', '1e2', '1' * 31])
def test_invalid_money(minor):
    assert not validator('Money').is_valid({'currency': 'VND', 'minor': minor})


def test_lossless_large_integer_money():
    value = {'currency': 'VND', 'minor': '999999999999999999999999999999'}
    validator('Money').validate(value)
    assert int(value['minor']) + 1 == 10 ** 30


def test_journal_sequence_is_decimal_string():
    definition = SCHEMA['definitions']['JournalEntry']['properties']['sequence']
    v = Draft7Validator(definition)
    assert v.is_valid('9007199254740993')
    for value in [1, '0', '-1', '01', '1.0']:
        assert not v.is_valid(value)
