import express from "express";

// 1. CREATE THE APPLICATION
const app = express();

// 2. REGISTER THE HEALTH ROUTE
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "graphql-engineering-lab",
  });
});

// 3. START LISTENING FOR REQUESTS
const port = 4000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Express server listening on port ${port}`);
});
