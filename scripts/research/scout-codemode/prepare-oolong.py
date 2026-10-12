"""Materialize three pinned public OOLONG-synth rows, without model calls."""
import ast
import hashlib
import json
import pathlib
import sys
import urllib.request
import pyarrow.parquet as parquet

REVISION = 'f0d59eaf0febf130664cfceb710436c8e3216b2b'
CODE_REVISION = '0bb7eabe839218fee7fe8d007f41cfc2fd3ae24c'
SELECTION = [(3, 415040019, 'negation-32k'), (29, 316030027, 'agnews-64k'), (21, 517050022, 'yahoo-128k')]
output = pathlib.Path(sys.argv[1])
(output / 'inputs').mkdir(parents=True, exist_ok=True)
cache = pathlib.Path(sys.argv[2])
cache.mkdir(parents=True, exist_ok=True)
selected = []
shards = []
for shard, row_id, task_id in SELECTION:
    filename = f'test-{shard:05}-of-00041.parquet'
    url = f'https://huggingface.co/datasets/oolongbench/oolong-synth/resolve/{REVISION}/data/{filename}'
    local = cache / filename
    if not local.exists():
        with urllib.request.urlopen(url, timeout=60) as response:
            local.write_bytes(response.read())
    rows = parquet.read_table(local).to_pylist()
    matches = [row for row in rows if row['id'] == row_id]
    if len(matches) != 1:
        raise ValueError(f'Expected exactly one source row {row_id}')
    row = matches[0]
    text = row['context_window_text']  # Never materialize the with_labels column.
    path = output / 'inputs' / f'{task_id}.txt'
    path.write_bytes(text.encode('utf8'))
    gold = ast.literal_eval(row['answer'])
    if len(gold) != 1 or not isinstance(gold[0], (str, int)):
        raise ValueError('Only unambiguous scalar answers are admitted')
    selected.append({key: row[key] for key in ['id', 'dataset', 'context_len', 'context_window_id', 'task_group', 'task', 'answer_type', 'input_subset']} | {
        'taskId': task_id, 'inputFile': path.name, 'question': row['question'], 'expected': {'answer': gold[0]},
        'inputBytes': len(text.encode('utf8')), 'inputHash': hashlib.sha256(text.encode('utf8')).hexdigest(), 'labelsIncluded': False,
    })
    shards.append({'file': filename, 'url': url, 'sha256': hashlib.sha256(local.read_bytes()).hexdigest()})
provenance = {'dataset': 'oolongbench/oolong-synth', 'split': 'test', 'revision': REVISION,
    'officialCodeRevision': CODE_REVISION, 'variant': 'read-only file/tool adaptation of unlabeled OOLONG-synth',
    'selection': 'Explicit IDs frozen before any model calls; different datasets and nominal length tiers 32K/64K/128K. No model performance used for selection.',
    'shards': shards, 'tasks': selected}
(output / 'dataset-provenance.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n')
print(json.dumps([{key: task[key] for key in ['taskId','id','context_len','inputBytes']} for task in selected]))
