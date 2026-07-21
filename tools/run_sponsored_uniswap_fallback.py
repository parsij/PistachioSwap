from pathlib import Path

path = Path('tools/apply_sponsored_uniswap_fallback.py')
source = path.read_text()
start = source.index('def replace_once')
end = source.index('\n\nreplace_once(', start)
helper = r'''def replace_once(path: str, old: str, new: str) -> None:
    import re
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count == 1:
        target.write_text(text.replace(old, new, 1))
        return
    if path.endswith('order-service.ts') and "$20,'0x',$21" in old:
        pattern = re.compile(
            r"\$20,'0x',\$21,\$22,\$23::jsonb,\$24::jsonb,\$25,\$26,true,\$27,\$28,\s*"
            r"'normal-sponsored-swap','prepaid-megafuel',\$29,\$30,\$31\)"
        )
        replacement = (
            "$20,$21,$22,$23,$24::jsonb,$25::jsonb,$26,$27,true,$28,$29,\n"
            "                      'normal-sponsored-swap','prepaid-megafuel',$30,$31,$32)"
        )
        updated, replacements = pattern.subn(replacement, text, count=1)
        if replacements == 1:
            target.write_text(updated)
            return
    raise RuntimeError(f"{path}: expected one match, found {count}")
'''
source = source[:start] + helper + source[end:]
exec(compile(source, str(path), 'exec'))
