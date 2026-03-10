#!/usr/bin/env python3
"""Analyze SSE trace file to debug chart rendering"""
import json

with open('/tmp/chart-trace.txt', 'r') as f:
    raw = f.read()

parts = raw.split('\n\n')
print(f'Total SSE blocks: {len(parts)}')

tool_end_count = 0
for i, p in enumerate(parts):
    p = p.strip()
    if not p:
        continue
    if 'tool_end' in p:
        data_lines = [l for l in p.split('\n') if l.startswith('data: ')]
        tool_end_count += 1
        print(f'\n--- tool_end Block {i} ({len(data_lines)} data line(s), {len(p)} chars) ---')
        
        if len(data_lines) == 1:
            try:
                obj = json.loads(data_lines[0][6:])
                tool_name = obj.get('tool', '?')
                has_data = 'data' in obj
                print(f'  tool: {tool_name}')
                print(f'  has data field: {has_data}')
                
                if has_data and obj['data']:
                    data_str = obj['data']
                    print(f'  data type: {type(data_str).__name__}, length: {len(str(data_str))}')
                    
                    if tool_name == 'create_chart':
                        inner = json.loads(data_str) if isinstance(data_str, str) else data_str
                        print(f'  create_chart config: {json.dumps(inner, indent=2)}')
                    elif tool_name == 'calculate_profit':
                        inner = json.loads(data_str) if isinstance(data_str, str) else data_str
                        print(f'  calculate_profit top keys: {list(inner.keys())}')
                        if 'product_breakdown' in inner:
                            pb = inner['product_breakdown']
                            print(f'  product_breakdown: {len(pb)} items, first keys: {list(pb[0].keys()) if pb else "empty"}')
                else:
                    print(f'  NO DATA in tool_end!')
                    
            except json.JSONDecodeError as e:
                print(f'  JSON PARSE ERROR: {e}')
                print(f'  Raw (first 200): {data_lines[0][:200]}')
        
        elif len(data_lines) > 1:
            print(f'  ⚠️  MULTIPLE data lines in one SSE block!')
            for j, dl in enumerate(data_lines):
                try:
                    obj = json.loads(dl[6:])
                    print(f'    line {j}: type={obj.get("type")}, tool={obj.get("tool")}')
                except:
                    print(f'    line {j}: PARSE FAILED')

print(f'\nTotal tool_end events found: {tool_end_count}')
