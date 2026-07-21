from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected one occurrence, found {count}: {old[:100]!r}"
        )
    file.write_text(text.replace(old, new))


# Pass a detached array to the submission callback so clearing the temporary
# raw-signature accumulator cannot mutate a callback result that reuses it.
replace(
    "src/features/gas-assist/services/rawTransactionSigning.js",
    "        return await submitSignedPackage(signedTransactions)\n",
    """        return await submitSignedPackage(
            signedTransactions.map((transaction) => ({ ...transaction })),
        )
""",
)

# Keep the explicit non-atomic disclosure while explaining the one-review,
# pre-signed experience.
replace(
    "src/features/gas-assist/components/GasAssistPrepaymentDialog.jsx",
    """                                <span>The backend stores all three raw transactions first, then broadcasts them sequentially after each on-chain confirmation.</span>""",
    """                                <span>The backend stores all three raw transactions first, then broadcasts them sequentially after each on-chain confirmation.</span>
                                <span>They remain separate transactions and are not atomic.</span>""",
)

Path(".github/fix-presigned-validation.py").unlink()
