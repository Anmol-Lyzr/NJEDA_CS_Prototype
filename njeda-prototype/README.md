## NJEDA Program Advisor (Prototype)

Mock NJEDA landing page + embedded **Program Advisor** that calls a **Lyzr Studio agent** and renders recommendations as **card-style results** (Warby-Parker-style), not plain text.

## Getting Started

### 1) Configure env

Create a `.env.local` in this folder:

```bash
cp .env.local.example .env.local
```

Set:

- `LYZR_API_KEY`
- `LYZR_AGENT_ID` (your NJEDA agent)
- `LYZR_USER_ID` (optional)

### 2) Run the dev server

```bash
npm run dev
```

Open `http://localhost:3000`.

## How it works (high-level)

- The UI calls `POST /api/chat`
- The server route proxies to Lyzr (`https://agent-prod.studio.lyzr.ai/v3/inference/chat/`) with your `x-api-key`
- The UI renders `recommendations[]` into cards in the Program Advisor modal

## Notes

- Don’t call the Lyzr endpoint directly from the browser (it would expose your API key).
- If the agent returns a JSON string, the server attempts to extract recommendations from it.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
