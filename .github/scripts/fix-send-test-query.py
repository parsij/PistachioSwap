from pathlib import Path

path = Path('src/features/wallet/components/wallet/SendAssetDialog.test.jsx')
text = path.read_text()
old = "        expect(screen.getByText('Unverified token')).toBeTruthy()\n"
new = "        expect(screen.getByText('Unverified token', { selector: 'strong' })).toBeTruthy()\n"
if text.count(old) != 1:
    raise SystemExit(f'expected one ambiguous Unverified token assertion, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
