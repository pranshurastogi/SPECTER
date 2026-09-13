# A/B test evidence

Raw transcripts for the controlled experiment described in [`../../BAZANTIC.md`](../../BAZANTIC.md) §6.

Both arms use the **same model, same prompt, same gateway, same credentials**. The Recipe is the only
difference.

```
Prompt: "Send 0.001 ETH privately to empoweryourid.eth on Sepolia."
```

## Files to capture

| File | Contents |
|---|---|
| `arm-a-raw-tools.md` | Full transcript with the 10 raw gateway tools available |
| `arm-b-recipe.md` | Full transcript with only the `send-private-payment` Recipe available |
| `result.md` | Side-by-side outcome, including the on-chain metadata blob length for each |

## How to read the outcome

The decisive measurement is the length of the announcement's on-chain metadata blob:

| Length | Meaning |
|---|---|
| **93 bytes** | AES-256-GCM encrypted — source tx, amount and chain id recoverable by the recipient |
| **77 bytes** | View-tag only — payment details omitted, unrecoverable |

Read it off any announcement with:

```bash
curl -s 'https://backend.specterpq.com/api/v1/registry/announcements?limit=1' \
  | jq -r '.announcements[0].metadata_blob | length / 2'   # hex chars → bytes
```
