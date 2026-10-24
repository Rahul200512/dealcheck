# DealCheck — is that used car a good deal?

Paste a listing (or fill in the details), add the asking price, and DealCheck tells you:

- **the fair price**, with an 80 % price range, from a machine-learning model
- **a deal rating**: great deal, good deal, fair price, above market or overpriced
- **what moves the price**: e.g. "reported accident −$800", "30,000 miles vs 99,000 typical +$1,650"
- **a warning** when a price is so low it looks too good to be true

Built with Next.js 16, React 19, TypeScript, Tailwind, Zod and Vitest.

## How it works

```
"2019 Civic EX, 64k miles,      ┌──────────────┐   fields    ┌───────────────┐  estimate   ┌──────────────┐
 one owner, asking $17,900" ──▶ │  /api/parse  │ ──────────▶ │  price model  │ ──────────▶ │  /api/deal   │ ──▶ rating + reasons
                                │  Gemini LLM  │  validated  │ (gradient     │  + range    │  rateDeal()  │
                                └──────────────┘  with Zod   │  boosting)    │             │ explainPrice │
                                                             └───────────────┘             └──────────────┘
```

1. **Plain-English input** (`src/lib/parse-listing.ts`). Gemini only *extracts* fields as JSON. The answer is never
   trusted directly: it is validated with Zod, makes/models are matched against the cars the model knows,
   synonyms are normalised ("chevy" → Chevrolet, "4x4" → 4WD) and impossible values are dropped. If the AI is
   not configured or fails, the normal form still works.
2. **Price estimate** (`src/ml/`). Gradient boosting, random forest and linear regression are trained and compared
   with 5-fold cross-validation; the best one serves predictions from a JSON artifact, so there is no Python
   or paid API at runtime. Details: `reports/training_report.md`.
3. **Deal check** (`src/ml/deal.ts`). `rateDeal` compares the asking price with the estimate and its range.
   `explainPrice` re-prices the car with one characteristic set to a typical value (typical mileage for its age,
   no accident, good condition, one owner); the difference is that factor's dollar impact.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # vitest
npx tsc --noEmit     # typecheck
npm run build
```

All environment variables are optional (see `.env.example`):

| Variable | Used for |
|---|---|
| `GEMINI_API_KEY` | plain-English input (free key from Google AI Studio) |
| `GEMINI_MODEL` | override the Gemini model (default `gemini-3.5-flash-lite`) |
| `DATABASE_URL` | Postgres prediction log; without it nothing is logged |

## Deploy on Vercel (free)

Import the repo in Vercel, keep the Next.js preset, add `GEMINI_API_KEY` under
Settings → Environment Variables and redeploy. No database is needed.

## API

| Method | Path | What it does |
|---|---|---|
| POST | `/api/deal` | estimate + deal rating + price factors for a vehicle and `asking_price` |
| POST | `/api/parse` | plain-English text → form fields (Gemini) |
| POST | `/api/predict` | price estimate for one vehicle |
| POST | `/api/predict/batch` | up to 100 vehicles |
| GET | `/api/model`, `/api/options`, `/api/health` | model info, form options, health |

Full OpenAPI spec at `/api/openapi`, rendered at `/docs`.

## Limits

- The training data is **simulated** (`src/ml/synthetic.ts`), so prices are realistic in shape but are not
  real market quotes. Don't use the numbers to buy a car.
- Price factors are one-at-a-time comparisons, not a full attribution of the price.
