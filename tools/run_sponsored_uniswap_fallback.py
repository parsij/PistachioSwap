from pathlib import Path

path = Path('tools/apply_sponsored_uniswap_fallback.py')
source = path.read_text()
source = source.replace(
    "\n                       'normal-sponsored-swap'",
    "\n                      'normal-sponsored-swap'",
)
exec(compile(source, str(path), 'exec'))
