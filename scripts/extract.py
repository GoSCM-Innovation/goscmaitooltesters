import re

html_path = r"c:\Users\HaroldCaballero\Desktop\ibp-bom-v7\test_apps\sap_cids_doc_generator(9).html"
js_path = r"c:\Users\HaroldCaballero\Desktop\ibp-bom-v7\public\js\docs.js"

with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'<script>(.*?)</script>', content, re.DOTALL)
if not match:
    print("Script tags not found!")
    exit(1)

script_content = match.group(1).strip()

script_content = script_content.replace("const logEl   = document.getElementById('log');", "const docsLogEl   = document.getElementById('docs-log');")
script_content = script_content.replace("const logHint = document.getElementById('log-hint');", "const docsLogHint = document.getElementById('docs-log-hint');")

script_content = re.sub(r'(?<!\.)\blog\(', 'docsLog(', script_content)
script_content = script_content.replace("logEl.", "docsLogEl.")
script_content = script_content.replace("logHint.", "docsLogHint.")

with open(js_path, 'w', encoding='utf-8') as f:
    f.write(script_content)

print("Successfully replaced docs.js logic.")
